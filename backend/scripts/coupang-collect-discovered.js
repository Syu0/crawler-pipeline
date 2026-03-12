#!/usr/bin/env node
/**
 * coupang-collect-discovered.js — DISCOVERED → COLLECTED 상세 수집
 *
 * coupang_datas 시트에서 status=DISCOVERED 인 행을 읽어
 * Playwright 상세 수집기로 상세 정보를 수집한 후 status=COLLECTED 로 업데이트.
 *
 * 흐름:
 *   1. getDiscoveredProducts() → DISCOVERED 행 목록
 *   2. 없으면 종료
 *   3. Playwright browser/context 초기화 (stealth + 쿠키 주입)
 *   4. warming + 블록 체크 (blockDetector.js 재사용)
 *   5. 행별 루프:
 *      a. scrapeCoupangProductPlaywright(productUrl, context)
 *      b. 성공: status=COLLECTED + 수집 필드 write
 *      c. 실패: status=ERROR + errorMessage write, 다음 행 계속
 *      d. 행 간 딜레이 2~4초
 *   6. 완료 요약
 *
 * CLI 옵션:
 *   --dry-run   시트 write 없이 수집 결과만 콘솔 출력
 *   --limit N   최대 N개만 처리 (기본값: 전체)
 */

'use strict';

require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
});

const { chromium: playwrightChromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

const {
  getSheetsClient,
  getDiscoveredProducts,
} = require('../coupang/sheetsClient');
const { ensureHeaders, upsertRow } = require('../coupang/sheetsClient');
const { scrapeCoupangProductPlaywright } = require('../coupang/playwrightScraper');
const cookieStore = require('../services/cookieStore');
const {
  isBlocked,
  wait,
  sendBlockAlertEmail,
  RETRY_WAIT_MS,
  RETRY_COUNT,
} = require('../coupang/blockDetector');

playwrightChromium.use(StealthPlugin());

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB = 'coupang_datas';
const HEADERS = [
  'vendorItemId', 'itemId', 'coupang_product_id', 'categoryId',
  'ProductURL', 'ItemTitle', 'ItemPrice', 'StandardImage',
  'ExtraImages', 'WeightKg', 'Options', 'ItemDescriptionText',
  'updatedAt', 'status', 'errorMessage',
];
const PRESERVE_ON_ERROR = [
  'coupang_product_id', 'categoryId', 'ProductURL', 'ItemTitle',
  'ItemPrice', 'StandardImage', 'ExtraImages', 'WeightKg',
  'Options', 'ItemDescriptionText',
];

// ── CLI 파싱 ─────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { dryRun: false, limit: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      result.dryRun = true;
    } else if (args[i] === '--limit' && args[i + 1]) {
      result.limit = parseInt(args[++i], 10);
    } else if (args[i].startsWith('--limit=')) {
      result.limit = parseInt(args[i].substring(8), 10);
    }
  }
  return result;
}

// ── 쿠키 문자열 파싱 ──────────────────────────────────────────────────────────
function parseCookieString(cookieStr) {
  if (!cookieStr) return [];
  return cookieStr
    .split(';')
    .map((part) => {
      const eqIdx = part.indexOf('=');
      if (eqIdx === -1) return null;
      const name = part.substring(0, eqIdx).trim();
      const value = part.substring(eqIdx + 1).trim();
      if (!name) return null;
      return { name, value, domain: '.coupang.com', path: '/' };
    })
    .filter(Boolean);
}

// ── Playwright browser + context 초기화 ──────────────────────────────────────
async function launchBrowser() {
  const headless = process.env.PLAYWRIGHT_HEADLESS !== '0';
  const browser = await playwrightChromium.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1280,900',
    ],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { 'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8' },
  });

  return { browser, context };
}

// ── 쿠키 주입 ────────────────────────────────────────────────────────────────
async function injectCookies(context) {
  let cookieStr = process.env.COUPANG_COOKIE;

  if (!cookieStr || !cookieStr.trim()) {
    if (cookieStore.isExpired()) {
      const data = cookieStore.loadCookieData();
      if (data) {
        throw new Error(
          `쿠팡 쿠키가 만료되었습니다. yam yam 버튼을 눌러 갱신해주세요.\n만료일: ${data.expiresAt}`
        );
      }
      return false;
    }
    cookieStr = cookieStore.loadCookies();
  }

  if (!cookieStr || !cookieStr.trim()) return false;

  const cookies = parseCookieString(cookieStr);
  if (cookies.length === 0) return false;

  await context.addCookies(cookies);
  return true;
}

// ── warming + 블록 감지 ───────────────────────────────────────────────────────
async function warmupAndCheckBlock(context) {
  const page = await context.newPage();
  try {
    console.log('[Playwright] 메인 페이지 warming 방문...');
    await page.goto('https://www.coupang.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page
      .waitForFunction(() => document.title.length > 0, { timeout: 45000 })
      .catch(() => {});
    const title = await page.title();
    console.log(`[Playwright] warming 완료 (title: ${title})`);

    const html = await page.content();
    return isBlocked(page, html);
  } finally {
    await page.close();
  }
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  const { dryRun, limit } = parseArgs();

  console.log('='.repeat(50));
  console.log('Coupang Collect Discovered');
  console.log('='.repeat(50));
  console.log(`Mode:  ${dryRun ? 'DRY-RUN (no sheet write)' : 'REAL'}`);
  if (limit) console.log(`Limit: ${limit}개`);
  console.log('');

  if (!SPREADSHEET_ID) {
    console.error('Error: GOOGLE_SHEET_ID not set in backend/.env');
    process.exit(1);
  }

  // 1. DISCOVERED 행 목록 조회
  console.log('[1/2] DISCOVERED 행 조회...');
  const sheets = await getSheetsClient();
  let products = await getDiscoveredProducts(sheets, SPREADSHEET_ID);

  if (products.length === 0) {
    console.log('수집 대상 없음 (DISCOVERED 행이 없습니다).');
    return;
  }

  if (limit && limit > 0) {
    products = products.slice(0, limit);
  }
  console.log(`  대상: ${products.length}개\n`);

  // 2. Playwright 초기화
  console.log('[2/2] 브라우저 초기화...');
  const { browser, context } = await launchBrowser();
  await injectCookies(context);

  // 헤더 보장 (errorMessage 컬럼 포함)
  if (!dryRun) {
    await ensureHeaders(SPREADSHEET_ID, TAB, HEADERS);
  }

  // 3. warming + 블록 체크
  let blocked = await warmupAndCheckBlock(context);
  if (blocked) {
    for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
      console.log(
        `[블록감지] Akamai IP 차단 감지. ${RETRY_WAIT_MS / 60000}분 대기 후 재시도 (${attempt}/${RETRY_COUNT})...`
      );
      await wait(RETRY_WAIT_MS);
      blocked = await warmupAndCheckBlock(context);
      if (!blocked) break;
      if (attempt === RETRY_COUNT) {
        await sendBlockAlertEmail();
        await browser.close();
        process.exit(1);
      }
    }
  }

  // 4. 행별 수집 루프
  let successCount = 0;
  let errorCount = 0;

  try {
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      console.log(`\n${'─'.repeat(40)}`);
      console.log(`[${i + 1}/${products.length}] ${product.vendorItemId || product.itemId}`);
      console.log(`  URL: ${product.productUrl}`);

      try {
        const scraped = await scrapeCoupangProductPlaywright(product.productUrl, context);

        if (dryRun) {
          console.log('  [DRY-RUN] 수집 결과:');
          console.log(`    ItemTitle: ${scraped.ItemTitle?.substring(0, 50)}`);
          console.log(`    ItemPrice: ${scraped.ItemPrice}`);
          console.log(`    StandardImage: ${scraped.StandardImage ? 'OK' : '없음'}`);
          successCount++;
          continue;
        }

        const data = {
          vendorItemId:        product.vendorItemId,
          itemId:              product.itemId,
          coupang_product_id:  scraped.coupang_product_id || '',
          categoryId:          scraped.categoryId || '',
          ProductURL:          scraped.ProductURL || product.productUrl,
          ItemTitle:           scraped.ItemTitle || '',
          ItemPrice:           scraped.ItemPrice != null ? String(scraped.ItemPrice) : '',
          StandardImage:       scraped.StandardImage || '',
          ExtraImages:         Array.isArray(scraped.ExtraImages)
                                 ? scraped.ExtraImages.join('|')
                                 : (scraped.ExtraImages || ''),
          WeightKg:            scraped.WeightKg || '',
          Options:             scraped.Options || '',
          ItemDescriptionText: scraped.ItemDescriptionText || '',
          updatedAt:           new Date().toISOString(),
          status:              'COLLECTED',
          errorMessage:        '',
        };

        await upsertRow(SPREADSHEET_ID, TAB, HEADERS, data, 'vendorItemId', 'itemId');
        console.log('  ✓ COLLECTED');
        successCount++;

      } catch (err) {
        console.error(`  ✗ 오류: ${err.message}`);
        errorCount++;

        if (!dryRun) {
          try {
            await upsertRow(
              SPREADSHEET_ID, TAB, HEADERS,
              {
                vendorItemId: product.vendorItemId,
                itemId:       product.itemId,
                updatedAt:    new Date().toISOString(),
                status:       'ERROR',
                errorMessage: err.message.substring(0, 500),
              },
              'vendorItemId', 'itemId',
              PRESERVE_ON_ERROR
            );
          } catch (writeErr) {
            console.error(`  ✗ 시트 ERROR 기록 실패: ${writeErr.message}`);
          }
        }
      }

      // 마지막 항목이 아니면 딜레이
      if (i < products.length - 1) {
        const delay = Math.floor(Math.random() * 2000 + 2000);
        console.log(`  [딜레이] ${delay}ms 대기...`);
        await wait(delay);
      }
    }
  } finally {
    await browser.close();
  }

  // 5. 완료 요약
  console.log(`\n${'='.repeat(50)}`);
  console.log('완료 요약');
  console.log('='.repeat(50));
  console.log(`  대상:   ${products.length}개`);
  console.log(`  성공:   ${successCount}개`);
  console.log(`  실패:   ${errorCount}개`);
  if (dryRun) console.log('  (DRY-RUN — 시트 write 없음)');
}

main().catch((err) => {
  console.error('\n✗ Error:', err.message);
  process.exit(1);
});
