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
 *   3. browserManager.launch() → 기존 브라우저 재사용 or 신규 기동
 *   4. browserManager.getContext() → 쿠키 주입된 컨텍스트 생성
 *   5. 행별 루프:
 *      a. scrapeCoupangProductPlaywright(productUrl, context)
 *      b. 성공: status=COLLECTED + 수집 필드 write
 *      c. 실패: status=ERROR + errorMessage write, 다음 행 계속
 *      d. 행 간 딜레이 2~4초
 *   6. 완료 요약
 *
 * CLI 옵션:
 *   --dry-run      시트 write 없이 수집 결과만 콘솔 출력
 *   --limit N      최대 N개만 처리 (기본값: 전체)
 *   --shutdown     완료 후 브라우저 종료 (기본: 브라우저 유지)
 */

'use strict';

require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
});

const {
  getSheetsClient,
  getDiscoveredProducts,
  ensureHeaders,
  upsertRow,
} = require('../coupang/sheetsClient');
const { COUPANG_DATA_HEADERS } = require('../coupang/sheetSchema');
const { scrapeCoupangProductPlaywright } = require('../coupang/playwrightScraper');
const browserManager = require('../coupang/browserManager');
const { wait } = require('../coupang/blockDetector');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB = 'coupang_datas';
const HEADERS = COUPANG_DATA_HEADERS;
const PRESERVE_ON_ERROR = [
  'coupang_product_id', 'categoryId', 'ProductURL', 'ItemTitle',
  'ItemPrice', 'StandardImage', 'ExtraImages', 'WeightKg',
  'Options', 'ItemDescriptionText',
];

// ── CLI 파싱 ─────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { dryRun: false, limit: null, shutdown: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      result.dryRun = true;
    } else if (args[i] === '--shutdown') {
      result.shutdown = true;
    } else if (args[i] === '--limit' && args[i + 1]) {
      result.limit = parseInt(args[++i], 10);
    } else if (args[i].startsWith('--limit=')) {
      result.limit = parseInt(args[i].substring(8), 10);
    }
  }
  return result;
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  const { dryRun, limit, shutdown } = parseArgs();

  console.log('='.repeat(50));
  console.log('Coupang Collect Discovered');
  console.log('='.repeat(50));
  console.log(`Mode:  ${dryRun ? 'DRY-RUN (no sheet write)' : 'REAL'}`);
  if (limit) console.log(`Limit: ${limit}개`);
  if (shutdown) console.log('Shutdown: 완료 후 브라우저 종료');
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

  // 2. 브라우저 획득 (기존 재사용 or 신규 기동)
  console.log('[2/2] 브라우저 초기화...');
  const browser = await browserManager.launch();
  const context = await browserManager.getContext(browser);

  // 헤더 보장
  if (!dryRun) {
    await ensureHeaders(SPREADSHEET_ID, TAB, HEADERS);
  }

  // 3. 행별 수집 루프
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
    await context.close();
    // --shutdown 플래그가 있을 때만 브라우저 종료 (기본: persistent)
    if (shutdown) {
      console.log('[Browser] --shutdown: 브라우저 종료');
      await browserManager.close(browser);
    }
  }

  // 4. 완료 요약
  console.log(`\n${'='.repeat(50)}`);
  console.log('완료 요약');
  console.log('='.repeat(50));
  console.log(`  대상:   ${products.length}개`);
  console.log(`  성공:   ${successCount}개`);
  console.log(`  실패:   ${errorCount}개`);
  if (dryRun) console.log('  (DRY-RUN — 시트 write 없음)');
  if (!shutdown) console.log('  브라우저: 유지 중 (npm run coupang:browser:stop 으로 종료)');
}

main().catch((err) => {
  console.error('\n✗ Error:', err.message);
  process.exit(1);
});
