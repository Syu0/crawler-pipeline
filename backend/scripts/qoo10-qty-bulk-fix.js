#!/usr/bin/env node
/**
 * qoo10-qty-bulk-fix.js — 재고=0 판매중 상품 일괄 처리
 *
 * qoo10_inventory 시트에서 inventoryFlag='🔴 재고=0판매중' 행을 읽어
 * Qoo10 API로 판매상태 N 전환 또는 재고수량 업데이트.
 *
 * CLI:
 *   npm run qoo10:qty:fix:dry                               # 대상 목록만 출력
 *   npm run qoo10:qty:fix -- --mode=n                       # 판매상태 N 전환
 *   npm run qoo10:qty:fix -- --mode=qty --qty=10            # 재고수량 10으로 설정
 *   npm run qoo10:qty:fix -- --mode=qty --qty=10 --limit=3  # 최대 3개만 처리
 */

'use strict';

require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
});

const { getSheetsClient, upsertRow } = require('../coupang/sheetsClient');
const { QOO10_INVENTORY_SCHEMA }     = require('../coupang/sheetSchema');
const { qoo10PostMethod }            = require('../qoo10/client');
const { getItemDetailInfo }          = require('../qoo10/getItemDetailInfo');
const { updateGoods }                = require('../qoo10/client');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const INV_TAB        = QOO10_INVENTORY_SCHEMA.sheetName;
const INV_HEADERS    = QOO10_INVENTORY_SCHEMA.columns.map((c) => c.key);
const INV_PK         = QOO10_INVENTORY_SCHEMA.primaryKey;

const DEFAULT_LIMIT = 10;
const ROW_SLEEP_MS  = 1000;

// ── CLI 파싱 ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args   = process.argv.slice(2);
  const result = { dryRun: false, mode: null, qty: null, limit: DEFAULT_LIMIT };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      result.dryRun = true;
    } else if (args[i].startsWith('--mode=')) {
      result.mode = args[i].substring(7);
    } else if (args[i] === '--mode' && args[i + 1]) {
      result.mode = args[++i];
    } else if (args[i].startsWith('--qty=')) {
      result.qty = Number(args[i].substring(6));
    } else if (args[i] === '--qty' && args[i + 1]) {
      result.qty = Number(args[++i]);
    } else if (args[i].startsWith('--limit=')) {
      result.limit = parseInt(args[i].substring(8), 10);
    } else if (args[i] === '--limit' && args[i + 1]) {
      result.limit = parseInt(args[++i], 10);
    }
  }

  return result;
}

// ── 수면 ──────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── qoo10_inventory 시트에서 대상 rows 조회 ───────────────────────────────────

async function loadTargetRows(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${INV_TAB}!A:ZZ`,
  });

  const rows = res.data.values || [];
  if (rows.length < 2) return [];

  const headers          = rows[0];
  const inventoryFlagIdx = headers.indexOf('inventoryFlag');
  const qoo10ItemIdIdx   = headers.indexOf('qoo10ItemId');
  const sellerCodeIdx    = headers.indexOf('sellerCode');
  const itemNameIdx      = headers.indexOf('itemName');
  const priceJpyIdx      = headers.indexOf('priceJpy');
  const quantityIdx      = headers.indexOf('quantity');
  const itemStatusIdx    = headers.indexOf('itemStatus');

  const result = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!(row[inventoryFlagIdx] || '').includes('재고=0')) continue;
    result.push({
      sheetRow:    i + 1,
      qoo10ItemId: row[qoo10ItemIdIdx] || '',
      sellerCode:  row[sellerCodeIdx]  || '',
      itemName:    row[itemNameIdx]    || '',
      priceJpy:    row[priceJpyIdx]    || '',
      quantity:    row[quantityIdx]    || '',
      itemStatus:  row[itemStatusIdx]  || '',
    });
  }

  return result;
}

// ── mode=n: UpdateGoods로 GoodsStatus=N 전환 ─────────────────────────────────

async function setStatusN(itemCode) {
  // SecondSubCat 필수 — GetItemDetailInfo로 선행 조회
  const detail = await getItemDetailInfo(itemCode);
  const secondSubCat = detail.SecondSubCatCd || detail.SecondSubCat || detail.SecondSubCatNo || '';

  if (!secondSubCat) {
    throw new Error('SecondSubCat not found in GetItemDetailInfo');
  }

  const response = await updateGoods({
    returnType:          'application/json',
    ItemCode:            String(itemCode),
    SecondSubCat:        String(secondSubCat),
    ItemTitle:           String(detail.ItemTitle || ''),
    ItemPrice:           String(detail.ItemPrice  || '0').replace(/\.0+$/, ''),
    ItemQty:             String(detail.ItemQty    || '0'),
    GoodsStatus:         'N',
    ShippingNo:          String(detail.ShippingNo || '471554'),
    AdultYN:             String(detail.AdultYN    || 'N'),
    AvailableDateType:   String(detail.AvailableDateType  || '0'),
    AvailableDateValue:  String(detail.AvailableDateValue || '2'),
    ExpireDate:          String(detail.ExpireDate || '2030-12-31'),
    ProductionPlaceType: String(detail.ProductionPlaceType || '2'),
    ProductionPlace:     String(detail.ProductionPlace     || 'Overseas'),
  });

  const resultCode = Number(response?.ResultCode ?? response?.resultCode ?? -999);
  const resultMsg  = response?.ResultMsg || response?.resultMsg || 'Unknown';
  if (resultCode !== 0) throw new Error(`UpdateGoods failed: ResultCode=${resultCode}, ${resultMsg}`);
}

// ── mode=qty: SetGoodsPriceQty로 재고수량 업데이트 ───────────────────────────

async function setQty(itemCode, qty) {
  const response = await qoo10PostMethod('ItemsOrder.SetGoodsPriceQty', {
    returnType: 'application/json',
    ItemCode:   String(itemCode),
    ItemQty:    String(qty),
  }, '1.1');

  const resultCode = Number(response?.ResultCode ?? response?.resultCode ?? -999);
  const resultMsg  = response?.ResultMsg || response?.resultMsg || 'Unknown';
  if (resultCode !== 0) throw new Error(`SetGoodsPriceQty failed: ResultCode=${resultCode}, ${resultMsg}`);
}

// ── 시트 write-back ───────────────────────────────────────────────────────────

async function writeBack(row, updates) {
  await upsertRow(
    SPREADSHEET_ID, INV_TAB, INV_HEADERS,
    { qoo10ItemId: row.qoo10ItemId, ...updates },
    INV_PK, null, ['memo']
  );
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  const { dryRun, mode, qty, limit } = parseArgs();

  console.log('='.repeat(50));
  console.log('Qoo10 Qty Bulk Fix');
  console.log('='.repeat(50));
  console.log(`Mode:   ${dryRun ? 'DRY-RUN (API/시트 write 없음)' : `REAL (mode=${mode}${mode === 'qty' ? `, qty=${qty}` : ''})`}`);
  console.log(`Limit:  ${limit}개`);
  console.log('');

  if (!SPREADSHEET_ID) {
    console.error('Error: GOOGLE_SHEET_ID not set in backend/.env');
    process.exit(1);
  }

  if (!dryRun && !mode) {
    console.error('Error: --mode=n 또는 --mode=qty --qty=N 이 필요합니다.');
    process.exit(1);
  }

  if (!dryRun && mode === 'qty' && (qty == null || isNaN(qty))) {
    console.error('Error: --mode=qty 사용 시 --qty=N 이 필요합니다.');
    process.exit(1);
  }

  // 1. 대상 조회
  console.log('[1/2] 대상 조회...');
  const sheets      = await getSheetsClient();
  let   targetRows  = await loadTargetRows(sheets);

  console.log(`  재고=0 판매중: ${targetRows.length}개`);

  if (targetRows.length === 0) {
    console.log('처리 대상 없음.');
    return;
  }

  if (limit > 0) targetRows = targetRows.slice(0, limit);
  console.log(`  처리 예정:     ${targetRows.length}개 (limit=${limit})\n`);

  // dry-run: 목록만 출력
  if (dryRun) {
    console.log('대상 목록:');
    targetRows.forEach((row, i) => {
      console.log(`  [${i + 1}] ItemCode=${row.qoo10ItemId} SellerCode=${row.sellerCode} qty=${row.quantity} status=${row.itemStatus}`);
      console.log(`       ${row.itemName.substring(0, 60)}`);
    });
    console.log(`\n[DRY RUN] 대상 ${targetRows.length}개 — API/시트 write 없음`);
    return;
  }

  // 2. 처리
  console.log('[2/2] 처리 시작...');
  let successCount = 0;
  let failCount    = 0;

  for (let i = 0; i < targetRows.length; i++) {
    const row = targetRows[i];
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`[${i + 1}/${targetRows.length}] ItemCode=${row.qoo10ItemId} (${row.sellerCode})`);

    try {
      if (mode === 'n') {
        await setStatusN(row.qoo10ItemId);
        console.log(`  → GoodsStatus=N 전환 성공`);
        await writeBack(row, {
          itemStatus:      'N',
          inventoryFlag:   '',
          actionRequired:  '',
          lastSyncedAt:    new Date().toISOString(),
        });
      } else if (mode === 'qty') {
        await setQty(row.qoo10ItemId, qty);
        console.log(`  → qty=${qty} 업데이트 성공`);
        await writeBack(row, {
          quantity:       String(qty),
          inventoryFlag:  qty === 0 ? '🔴 재고=0판매중' : '',
          actionRequired: qty === 0 ? '즉시처리필요'    : '',
          lastSyncedAt:   new Date().toISOString(),
        });
      }
      successCount++;
    } catch (err) {
      console.error(`  ✗ 실패: ${err.message}`);
      failCount++;
    }

    if (i < targetRows.length - 1) {
      await sleep(ROW_SLEEP_MS);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log('완료 요약');
  console.log('='.repeat(50));
  console.log(`  처리완료: 성공${successCount} / 전체${targetRows.length}`);
  if (failCount > 0) console.log(`  실패: ${failCount}개`);
}

main().catch((err) => {
  console.error('\n✗ Error:', err.message);
  process.exit(1);
});
