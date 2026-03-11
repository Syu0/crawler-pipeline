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
const { ensureHeaders, upsertRow } = require('./lib/sheetsClient');
const { checkAndNotify } = require('../backend/services/cookieExpiry');

const SHEET_HEADERS = [
  'vendorItemId',
  'itemId',
  'coupang_product_id',
  'categoryId',
  'ProductURL',
  'ItemTitle',
  'ItemPrice',
  'StandardImage',
  'ExtraImages',
  'WeightKg',
  'Options',
  'ItemDescriptionText',
  'updatedAt',
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

  try {
    const productData = await scrapeCoupangProductPlaywright(url);

    if (isDryRun) {
      console.log('\n=== DRY-RUN: Payload ===\n');
      console.log(JSON.stringify(productData, null, 2));
      console.log('\n=== DRY-RUN COMPLETE ===');
      return;
    }

    if (!sheetId) throw new Error('GOOGLE_SHEET_ID not set in backend/.env');

    console.log('\n=== Writing to Google Sheet ===\n');
    await ensureHeaders(sheetId, tabName, SHEET_HEADERS);

    const result = await upsertRow(
      sheetId,
      tabName,
      SHEET_HEADERS,
      productData,
      'vendorItemId',
      'itemId'
    );

    console.log(`\n✓ Sheet ${result.action} (row ${result.row})`);
    console.log('\n=== COMPLETE ===');

  } catch (err) {
    console.error(`\n✗ Error: ${err.message}`);
    if (process.env.COUPANG_TRACER === '1') console.error(err.stack);
    process.exit(1);
  }
}

main();
