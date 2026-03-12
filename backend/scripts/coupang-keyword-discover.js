#!/usr/bin/env node
/**
 * coupang-keyword-discover.js — 키워드 기반 쿠팡 상품 탐색 진입점
 *
 * 흐름:
 *   1. config 시트 로드 (가격 상한, 제외 카테고리)
 *   2. keywords 시트에서 ACTIVE 키워드 목록 로드
 *   3. Playwright browser/context 초기화 (stealth + 쿠키 주입)
 *   4. 키워드별:
 *      a. 검색결과 파싱 (keywordSearch.js)
 *      b. 필터 적용 (productFilters.js)
 *      c. DISCOVERED upsert (sheetsClient.js)
 *      d. keywords 시트 lastRunAt 업데이트
 *   5. 완료 요약 출력
 *
 * CLI 옵션:
 *   --dry-run          시트 write 없이 콘솔 출력만
 *   --keyword "..."    keywords 시트 무시, 단일 키워드로 실행 (테스트용)
 *
 * Usage:
 *   node backend/scripts/coupang-keyword-discover.js
 *   node backend/scripts/coupang-keyword-discover.js --dry-run
 *   node backend/scripts/coupang-keyword-discover.js --dry-run --keyword "텀블러"
 *   npm run coupang:discover:dry -- --keyword "텀블러"
 */

'use strict';

require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
});

const { chromium: playwrightChromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

const {
  getSheetsClient,
  getConfig,
  getActiveKeywords,
  updateKeywordLastRun,
  upsertDiscoveredProducts,
} = require('../coupang/sheetsClient');
const { searchCoupangByKeyword } = require('../coupang/keywordSearch');
const { applyFilters } = require('../coupang/productFilters');
const cookieStore = require('../services/cookieStore');

playwrightChromium.use(StealthPlugin());

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TRACE = process.env.COUPANG_TRACER === '1';

function trace(...args) {
  if (TRACE) console.log('[TRACER]', ...args);
}

// ── CLI 파싱 ─────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { dryRun: false, keyword: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      result.dryRun = true;
    } else if (args[i] === '--keyword' && args[i + 1]) {
      result.keyword = args[++i];
    } else if (args[i].startsWith('--keyword=')) {
      result.keyword = args[i].substring(10);
    }
  }
  return result;
}

// ── 쿠키 문자열 파싱 (playwrightScraper.js 와 동일한 형식) ───────────────────
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
  trace(`Launching Chromium + Stealth (headless=${headless})`);

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

// ── 메인 페이지 warming 방문 ──────────────────────────────────────────────────
// Akamai는 처음 접속 URL에 따라 정책이 다름.
// 검색 페이지(/np/search)를 바로 열면 쿠키가 있어도 Access Denied 반환.
// 메인 페이지를 먼저 방문해 Akamai 신뢰도를 쌓은 뒤 검색 URL로 이동.
async function warmupContext(context) {
  const page = await context.newPage();
  try {
    console.log('[Playwright] 메인 페이지 warming 방문...');
    await page.goto('https://www.coupang.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    const title = await page.title();
    console.log(`[Playwright] warming 완료 (title: ${title})`);
  } finally {
    await page.close();
  }
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
      return false; // 파일 없음 — 비인증으로 시도
    }
    cookieStr = cookieStore.loadCookies();
    if (cookieStr) trace(`cookieStore에서 쿠키 로드 (${cookieStore.daysUntilExpiry()}일 남음)`);
  }

  if (!cookieStr || !cookieStr.trim()) return false;

  const cookies = parseCookieString(cookieStr);
  if (cookies.length === 0) return false;

  trace(`Injecting ${cookies.length} cookies`);
  await context.addCookies(cookies);
  return true;
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  const { dryRun, keyword: cliKeyword } = parseArgs();

  console.log('='.repeat(50));
  console.log('Coupang Keyword Discovery');
  console.log('='.repeat(50));
  console.log(`Mode:     ${dryRun ? 'DRY-RUN (no sheet write)' : 'REAL'}`);
  if (cliKeyword) console.log(`Keyword:  "${cliKeyword}" (CLI override)`);
  console.log('');

  if (!SPREADSHEET_ID) {
    console.error('Error: GOOGLE_SHEET_ID not set in backend/.env');
    process.exit(1);
  }

  // Sheets 클라이언트 초기화
  const sheets = await getSheetsClient();

  // 1. config 로드
  console.log('[1/2] config 시트 로드...');
  const config = await getConfig(sheets, SPREADSHEET_ID);
  console.log(`  FILTER_PRICE_KRW_MAX:       ${config.FILTER_PRICE_KRW_MAX?.toLocaleString()} KRW`);
  console.log(`  EXCLUDED_CATEGORY_KEYWORDS: ${(config.EXCLUDED_CATEGORY_KEYWORDS || []).join(', ')}\n`);

  // 2. 키워드 목록
  let keywords;
  if (cliKeyword) {
    keywords = [{ row: null, keyword: cliKeyword, status: 'ACTIVE', lastRunAt: '', memo: 'CLI' }];
  } else {
    console.log('[2/2] keywords 시트 로드...');
    keywords = await getActiveKeywords(sheets, SPREADSHEET_ID);
    console.log(`  ACTIVE 키워드 ${keywords.length}개\n`);
  }

  if (keywords.length === 0) {
    console.log('ACTIVE 키워드가 없습니다. keywords 시트를 확인하세요.');
    return;
  }

  // 3. Playwright 초기화
  console.log('[Playwright] 브라우저 초기화...');
  const { browser, context } = await launchBrowser();
  await injectCookies(context);
  await warmupContext(context);

  // 4. 키워드별 루프
  let totalFound = 0;
  let totalFiltered = 0;
  let totalUpserted = 0;
  let totalSkipped = 0;

  try {
    for (const kw of keywords) {
      console.log(`\n${'─'.repeat(40)}`);
      console.log(`키워드: "${kw.keyword}"`);

      // a. 검색 + 파싱
      const items = await searchCoupangByKeyword(kw.keyword, context, { maxPages: 2 });
      totalFound += items.length;
      console.log(`  발견: ${items.length}개`);

      // b. 필터 적용
      const filtered = applyFilters(items, config);
      totalFiltered += filtered.length;
      console.log(`  필터 통과: ${filtered.length}개`);

      if (dryRun) {
        console.log('\n  [DRY-RUN] 필터 통과 상품:');
        filtered.slice(0, 10).forEach((item, i) => {
          console.log(
            `  ${i + 1}. ${item.itemTitle?.substring(0, 40)} | ${item.itemPrice?.toLocaleString()}원 | rocket=${item.isRocket}`
          );
        });
        if (filtered.length > 10) console.log(`  ... 외 ${filtered.length - 10}개`);
        continue;
      }

      // c. DISCOVERED upsert
      const { upserted, skipped } = await upsertDiscoveredProducts(
        sheets,
        SPREADSHEET_ID,
        filtered
      );
      totalUpserted += upserted;
      totalSkipped += skipped;
      console.log(`  upsert: ${upserted}개 / skip: ${skipped}개`);

      // d. lastRunAt 업데이트 (keywords 시트 행이 있을 때만)
      if (kw.row) {
        await updateKeywordLastRun(sheets, SPREADSHEET_ID, kw.row);
      }
    }
  } finally {
    await browser.close();
  }

  // 5. 완료 요약
  console.log(`\n${'='.repeat(50)}`);
  console.log('완료 요약');
  console.log('='.repeat(50));
  console.log(`  키워드 수:     ${keywords.length}개`);
  console.log(`  총 발견:       ${totalFound}개`);
  console.log(`  필터 통과:     ${totalFiltered}개`);
  if (!dryRun) {
    console.log(`  upsert 완료:   ${totalUpserted}개`);
    console.log(`  skip (중복):   ${totalSkipped}개`);
  } else {
    console.log(`  (DRY-RUN — 시트 write 없음)`);
  }
}

main().catch((err) => {
  console.error('\n✗ Error:', err.message);
  if (TRACE) console.error(err.stack);
  process.exit(1);
});
