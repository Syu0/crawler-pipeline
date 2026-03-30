#!/usr/bin/env node
/**
 * coupang-collect-one.js — 단일 상품 강제 재수집
 *
 * 시트에서 vendorItemId로 행을 찾아 status 무관 강제 재수집 후 COLLECTED로 업데이트.
 *
 * 사용법:
 *   node backend/scripts/coupang-collect-one.js --vendorItemId=86533289539
 *   npm run coupang:collect:one -- --vendorItemId=86533289539
 */

'use strict';

require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
});

const {
  getSheetsClient,
  ensureHeaders,
  upsertRow,
} = require('../coupang/sheetsClient');
const { COUPANG_DATA_HEADERS } = require('../coupang/sheetSchema');
const { collectProductData } = require('../coupang/coupangApiClient');
const { sendBlockAlertEmail } = require('../coupang/blockDetector');
const { setHardBlocked } = require('../coupang/blockStateManager');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB = 'coupang_datas';
const HEADERS = COUPANG_DATA_HEADERS;

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function parseArgs() {
  let vendorItemId = null;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--vendorItemId=')) {
      vendorItemId = arg.substring('--vendorItemId='.length);
    }
  }
  return { vendorItemId };
}

function extractProductId(productUrl) {
  if (!productUrl) return null;
  const m = productUrl.match(/\/vp\/products\/(\d+)/);
  return m ? m[1] : null;
}

function extractParamsFromUrl(productUrl) {
  if (!productUrl) return {};
  try {
    const u = new URL(productUrl);
    return {
      vendorItemId: u.searchParams.get('vendorItemId') || null,
      itemId: u.searchParams.get('itemId') || null,
    };
  } catch (_) {
    return {};
  }
}

// vendorItemId로 시트 행 탐색
async function findProductByVendorItemId(sheets, vendorItemId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!A:ZZ`,
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return null;

  const hdrs = rows[0];
  const vidIdx       = hdrs.indexOf('vendorItemId');
  const itemIdIdx    = hdrs.indexOf('itemId');
  const productUrlIdx = hdrs.indexOf('ProductURL');
  const statusIdx    = hdrs.indexOf('status');

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if ((row[vidIdx] || '') === vendorItemId) {
      return {
        row:         i + 1,
        vendorItemId: row[vidIdx]        || '',
        itemId:       row[itemIdIdx]     || '',
        productUrl:   row[productUrlIdx] || '',
        status:       row[statusIdx]     || '',
      };
    }
  }
  return null;
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  const { vendorItemId } = parseArgs();
  if (!vendorItemId) {
    console.error('Usage: node coupang-collect-one.js --vendorItemId=<id>');
    process.exit(1);
  }

  console.log('='.repeat(50));
  console.log(`Coupang Collect One`);
  console.log(`vendorItemId: ${vendorItemId}`);
  console.log('='.repeat(50));

  if (!SPREADSHEET_ID) {
    console.error('Error: GOOGLE_SHEET_ID not set in backend/.env');
    process.exit(1);
  }

  // 1. 시트에서 행 찾기
  console.log('\n[1/3] 시트에서 행 조회...');
  const sheets = await getSheetsClient();
  const product = await findProductByVendorItemId(sheets, vendorItemId);

  if (!product) {
    console.error(`  ✗ 행 없음: vendorItemId=${vendorItemId}`);
    process.exit(1);
  }
  console.log(`  행 발견: row=${product.row}  status=${product.status || '(없음)'}`);
  console.log(`  ProductURL: ${product.productUrl}`);

  // productId / itemId 추출
  const productId = extractProductId(product.productUrl);
  let { itemId } = product;
  if (!itemId) {
    const fromUrl = extractParamsFromUrl(product.productUrl);
    itemId = fromUrl.itemId;
  }

  if (!productId || !itemId) {
    console.error(
      `  ✗ 필수 ID 누락 — productId=${productId} itemId=${itemId}`
    );
    process.exit(1);
  }
  console.log(`  productId=${productId}  itemId=${itemId}`);

  // 2. 수집
  console.log('\n[2/3] Browser Relay 수집...');
  const collected = await collectProductData(productId, vendorItemId, itemId);

  if (collected.error) {
    console.error(`  ✗ ${collected.error}: ${collected.message || ''}`);
    process.exit(1);
  }

  if (collected.blocked) {
    console.warn(`  ⚠ HARD_BLOCK: HTTP ${collected.httpStatus}`);
    setHardBlocked();
    await sendBlockAlertEmail({
      hardBlock: 1, softBlock: 0, success: 0, rowError: 0, total: 1,
      triggerReason: 'HARD_BLOCK',
      lastUrl: product.productUrl,
    });
    process.exit(1);
  }

  console.log(`  CollectedPhases: [${collected.CollectedPhases || '없음'}]`);
  console.log(`  ItemTitle:       ${collected.ItemTitle?.substring(0, 50) ?? '(없음)'}`);
  console.log(`  ItemPrice:       ${collected.ItemPrice ?? '(없음)'}`);
  console.log(`  categoryId:      ${collected.categoryId ?? '(없음)'}`);
  console.log(`  StandardImage:   ${collected.StandardImage ? '✓' : '없음'}`);
  console.log(`  ExtraImages:     ${(collected.ExtraImages || []).length}개`);
  console.log(`  StockStatus:     ${collected.StockStatus ?? '(없음)'}`);
  console.log(`  ReviewCount:     ${collected.ReviewCount ?? '(없음)'}`);

  // 3. 시트 업데이트
  console.log('\n[3/3] 시트 업데이트...');
  await ensureHeaders(SPREADSHEET_ID, TAB, HEADERS);

  const ExtraImages = Array.isArray(collected.ExtraImages)
    ? collected.ExtraImages.join('|')
    : (collected.ExtraImages || '');

  const data = {
    vendorItemId:       product.vendorItemId,
    itemId:             product.itemId,
    coupang_product_id: productId,
    categoryId:         collected.categoryId                                      ?? '',
    ProductURL:         product.productUrl                                        || '',
    ItemTitle:          collected.ItemTitle                                       ?? '',
    ItemPrice:          collected.ItemPrice    != null ? String(collected.ItemPrice)    : '',
    StandardImage:      collected.StandardImage                                   ?? '',
    ExtraImages,
    OptionType:         collected.OptionType                                      ?? '',
    Options:            collected.Options                                         ?? '',
    StockStatus:        collected.StockStatus                                     ?? '',
    StockQty:           collected.StockQty     != null ? String(collected.StockQty)     : '',
    ReviewCount:        collected.ReviewCount  != null ? String(collected.ReviewCount)  : '',
    ReviewAvgRating:    collected.ReviewAvgRating != null
                          ? String(collected.ReviewAvgRating) : '',
    DetailImages:       collected.DetailImages                                    ?? JSON.stringify([]),
    ProductAttributes:  collected.ProductAttributes                               ?? JSON.stringify({}),
    CollectedPhases:    collected.CollectedPhases                                 || '',
    updatedAt:          new Date().toISOString(),
    status:             'COLLECTED',
    errorMessage:       '',
  };

  await upsertRow(SPREADSHEET_ID, TAB, HEADERS, data, 'vendorItemId', 'itemId');
  console.log(`  ✓ COLLECTED (CollectedPhases: ${collected.CollectedPhases})`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\n✗ Error:', err.message);
  process.exit(1);
});
