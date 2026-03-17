#!/usr/bin/env node
/**
 * Coupang Playwright Scrape → Google Sheet
 *
 * 쿠팡 상품 URL을 Playwright로 수집해 Google Sheets에 upsert한다.
 *
 * Usage:
 *   node scripts/coupang-playwright-scrape.js --url "<COUPANG_URL>"
 *
 * Env flags:
 *   COUPANG_SCRAPE_DRY_RUN=1   - 시트 write 없이 payload만 출력
 *   COUPANG_TRACER=1           - 상세 로그
 *   PLAYWRIGHT_HEADLESS=0      - 브라우저 헤드리스 해제 (디버그)
 *   COUPANG_ID / COUPANG_PW    - 쿠팡 로그인 자격증명 (선택)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') });

const { scrapeCoupangProductPlaywright } = require('../backend/coupang/playwrightScraper');
const { collectAllPhases } = require('../backend/coupang/detailPageParser');
const { ensureHeaders, upsertRow, findRowByKey, getRowData } = require('./lib/sheetsClient');
const { checkAndNotify } = require('../backend/services/cookieExpiry');
const { COUPANG_DATA_HEADERS } = require('../backend/coupang/sheetSchema');

// 단독 실행용 경량 브라우저 팩토리 (browserManager 세션에 간섭하지 않음)
async function _launchOwnBrowser() {
  const { chromium: playwrightChromium } = require('playwright-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  playwrightChromium.use(StealthPlugin());

  const headless = process.env.PLAYWRIGHT_HEADLESS !== '0';
  const browser = await playwrightChromium.launch({
    headless,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,900',
    ],
  });

  // 쿠키 주입
  const cookieStore = require('../backend/services/cookieStore');
  let cookieStr = process.env.COUPANG_COOKIE;
  if (!cookieStr || !cookieStr.trim()) {
    cookieStr = cookieStore.isExpired() ? null : cookieStore.loadCookies();
  }

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { 'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8' },
  });

  if (cookieStr && cookieStr.trim()) {
    const cookies = cookieStr.split(';').map((part) => {
      const eqIdx = part.indexOf('=');
      if (eqIdx === -1) return null;
      const name = part.substring(0, eqIdx).trim();
      const value = part.substring(eqIdx + 1).trim();
      return name ? { name, value, domain: '.coupang.com', path: '/' } : null;
    }).filter(Boolean);
    if (cookies.length) await context.addCookies(cookies);
  }

  return { browser, context };
}

const SHEET_HEADERS = COUPANG_DATA_HEADERS;

// 이미 파이프라인 진행 중인 상태 — Playwright 수집기가 덮어쓰지 않는다
const PROTECTED_STATUSES = [
  'REGISTERING', 'REGISTERED', 'VALIDATING', 'LIVE', 'OUT_OF_STOCK', 'DEACTIVATED',
];

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { url: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      result.url = args[++i];
    } else if (args[i].startsWith('--url=')) {
      result.url = args[i].substring(6);
    } else if (!args[i].startsWith('-')) {
      result.url = args[i];
    }
  }
  return result;
}

async function main() {
  const { url } = parseArgs();

  if (!url) {
    console.error('Usage: node scripts/coupang-playwright-scrape.js --url "<COUPANG_URL>"');
    process.exit(1);
  }

  const isDryRun = process.env.COUPANG_SCRAPE_DRY_RUN === '1';
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const tabName = process.env.GOOGLE_SHEET_TAB_NAME || 'coupang_datas';

  console.log('='.repeat(50));
  console.log('Coupang Playwright Scrape to Sheet');
  console.log('='.repeat(50));
  console.log(`Mode:     ${isDryRun ? 'DRY-RUN (no sheet write)' : 'REAL'}`);
  console.log(`Sheet ID: ${sheetId || '(not set)'}`);
  console.log(`Tab:      ${tabName}`);
  console.log('');

  // 쿠키 만료 알림 (만료 3일 전 / 당일 이메일 발송)
  await checkAndNotify().catch((e) => console.warn('[notify]', e.message));

  let browser;
  try {
    // Phase 1 + 2-5 수집을 동일 브라우저 컨텍스트에서 실행 (browserManager 세션과 독립)
    const launched = await _launchOwnBrowser();
    browser = launched.browser;
    const { context } = launched;
    let productData;
    let phaseData = {};

    try {
      productData = await scrapeCoupangProductPlaywright(url, context);

      // Phase 2-5 수집
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        phaseData = await collectAllPhases(page, ['2', '3', '4', '5']);
      } finally {
        await page.close();
      }
    } finally {
      await context.close();
    }

    // Phase 2-5 결과 병합
    const mergedData = {
      ...productData,
      DetailImages:      phaseData.detailImages     || [],
      OptionType:        phaseData.optionType        || 'NONE',
      OptionsRaw:        phaseData.optionsRaw        || null,
      StockStatus:       phaseData.stockStatus       || 'UNKNOWN',
      StockQty:          phaseData.stockQty          ?? null,
      ReviewCount:       phaseData.reviewCount       ?? null,
      ReviewAvgRating:   phaseData.reviewAvgRating   ?? null,
      ReviewSummary:     phaseData.reviewSummary      || null,
      ProductAttributes: phaseData.productAttributes || null,
      CollectedPhases:   '1,2,3,4,5',
      WeightKg:          phaseData.weightKg != null ? phaseData.weightKg : (productData.WeightKg || 1),
    };

    if (isDryRun) {
      console.log('\n=== DRY-RUN: Payload ===\n');
      console.log(JSON.stringify(mergedData, null, 2));
      console.log('\n=== DRY-RUN COMPLETE ===');
      return;
    }

    if (!sheetId) throw new Error('GOOGLE_SHEET_ID not set in backend/.env');

    console.log('\n=== Writing to Google Sheet ===\n');
    await ensureHeaders(sheetId, tabName, SHEET_HEADERS);

    // 기존 row의 status 확인 — PROTECTED 상태면 COLLECTED로 덮어쓰지 않음
    const keyCol = mergedData.vendorItemId ? 'vendorItemId' : 'itemId';
    const keyValue = mergedData.vendorItemId || mergedData.itemId;
    const keyColIndex = SHEET_HEADERS.indexOf(keyCol);
    const existingRowNum = await findRowByKey(sheetId, tabName, keyColIndex, keyValue);
    if (existingRowNum && existingRowNum > 1) {
      const existingData = await getRowData(sheetId, tabName, existingRowNum, SHEET_HEADERS);
      if (!PROTECTED_STATUSES.includes(existingData?.status)) {
        mergedData.status = 'COLLECTED';
      }
    } else {
      mergedData.status = 'COLLECTED';
    }

    const result = await upsertRow(
      sheetId,
      tabName,
      SHEET_HEADERS,
      mergedData,
      'vendorItemId',
      'itemId'
    );

    console.log(`\n✓ Sheet ${result.action} (row ${result.row})`);
    console.log('\n=== COMPLETE ===');

  } catch (err) {
    console.error(`\n✗ Error: ${err.message}`);
    if (process.env.COUPANG_TRACER === '1') console.error(err.stack);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

main().then(() => process.exit(0));
