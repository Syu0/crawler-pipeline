#!/usr/bin/env node
/**
 * qoo10-set-300g-inventory.js — 300g 1個/3個 옵션 재등록 one-off
 *
 * 1197862497 (300g MASTER) 에 1個/3個 옵션을 EditGoodsInventory로 등록.
 *
 * InventoryInfo: 数量||*1個||*0||*100||*1$$数量||*3個||*725||*100||*3
 *
 * Usage:
 *   node backend/scripts/qoo10-set-300g-inventory.js --dry-run
 *   node backend/scripts/qoo10-set-300g-inventory.js
 */

'use strict';

require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
});

const { editGoodsInventory, buildInventoryInfo } = require('../qoo10/editGoodsInventory');
const { getSheetsClient } = require('../coupang/sheetsClient');
const { COUPANG_DATA_HEADERS } = require('../coupang/sheetSchema');
const { decideItemPriceJpy } = require('../pricing/priceDecision');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB = 'coupang_datas';
const DRY_RUN = process.argv.includes('--dry-run');

const ITEM_CODE = '1197862497';
const MASTER_VENDOR_ID = '77232047334';  // 1個
const SLAVE_VENDOR_ID  = '86533289327';  // 3個

async function loadRow(sheets, vendorItemId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!A:ZZ`,
  });
  const rawRows = res.data.values || [];
  const headers = rawRows[0];
  const colIdx = {};
  for (const key of COUPANG_DATA_HEADERS) colIdx[key] = headers.indexOf(key);

  const dataRows = rawRows.slice(1).map((row) => {
    const obj = {};
    for (const key of COUPANG_DATA_HEADERS) {
      const idx = colIdx[key];
      obj[key] = idx !== -1 ? (row[idx] ?? '') : '';
    }
    return obj;
  });

  return dataRows.find((r) => String(r.vendorItemId) === String(vendorItemId)) || null;
}

async function main() {
  if (DRY_RUN) console.log('[set-300g-inventory] DRY-RUN 모드\n');

  const sheets = await getSheetsClient();

  const masterRow = await loadRow(sheets, MASTER_VENDOR_ID);
  const slaveRow  = await loadRow(sheets, SLAVE_VENDOR_ID);

  if (!masterRow) throw new Error(`masterRow not found: vendorItemId=${MASTER_VENDOR_ID}`);
  if (!slaveRow)  throw new Error(`slaveRow not found: vendorItemId=${SLAVE_VENDOR_ID}`);

  const masterResult = await decideItemPriceJpy({
    row: masterRow, vendorItemId: MASTER_VENDOR_ID, mode: 'MIGRATE',
    sheetsClient: sheets, sheetId: SPREADSHEET_ID,
  });
  if (!masterResult.valid) throw new Error(`가격계산 실패 (MASTER): ${masterResult.error}`);
  const masterJpy = Number(masterResult.priceJpy);

  const slaveResult = await decideItemPriceJpy({
    row: slaveRow, vendorItemId: SLAVE_VENDOR_ID, mode: 'MIGRATE',
    sheetsClient: sheets, sheetId: SPREADSHEET_ID,
  });
  if (!slaveResult.valid) throw new Error(`가격계산 실패 (3個): ${slaveResult.error}`);
  const slaveJpy = Number(slaveResult.priceJpy);

  const MAX_DELTA = Math.floor(masterJpy * 0.5);
  const rawDelta  = Math.max(0, slaveJpy - masterJpy);
  const delta     = Math.min(rawDelta, MAX_DELTA);

  console.log(`master(1個)=${masterJpy}jpy  slave(3個)=${slaveJpy}jpy  delta=${delta}${rawDelta > delta ? ` (캡적용: 원래 ${rawDelta})` : ''}`);

  const options = [
    { label: '1個', deltaPriceJpy: 0,    qty: 100, code: '1' },
    { label: '3個', deltaPriceJpy: delta, qty: 100, code: '3' },
  ];

  const inventoryInfo = buildInventoryInfo(options);
  console.log(`InventoryInfo (${inventoryInfo.length}자): ${inventoryInfo}`);

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] editGoodsInventory 호출 생략');
    return;
  }

  await editGoodsInventory({ itemCode: ITEM_CODE, inventoryInfo });
  console.log('완료.');
}

main().catch((err) => {
  console.error('[set-300g-inventory] ERROR:', err.message);
  process.exit(1);
});
