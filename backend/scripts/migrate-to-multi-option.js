#!/usr/bin/env node
/**
 * migrate-to-multi-option.js — 기존 단일 상품 → 멀티옵션 마이그레이션
 *
 * 대상:
 *   300g 그룹: vendorItemId 77232047334(1개/MASTER), 86533289327(3개/SLAVE), 86533289904(5개/SLAVE)
 *   250g 그룹: vendorItemId 85321289776(2개/MASTER), 85296814940(3개/SLAVE)
 *
 * Step 1 — SLAVE 거래폐지 (EditGoodsStatus Status=3)
 * Step 2 — MASTER ItemTitle 수량 제거 (UpdateGoods)
 * Step 3 — 가격 계산 (decideItemPriceJpy)
 * Step 4 — EditGoodsInventory 옵션 등록
 * Step 5 — 시트 write-back
 *
 * Usage:
 *   node backend/scripts/migrate-to-multi-option.js --dry-run
 *   node backend/scripts/migrate-to-multi-option.js
 */

'use strict';

require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
});

const { getSheetsClient } = require('../coupang/sheetsClient');
const { COUPANG_DATA_HEADERS } = require('../coupang/sheetSchema');
const { editGoodsStatus } = require('../qoo10/editGoodsStatus');
const { editGoodsInventory, buildInventoryInfo } = require('../qoo10/editGoodsInventory');
const { updateExistingGoods } = require('../qoo10/updateGoods');
const { translateTitle } = require('../qoo10/titleTranslator');
const { decideItemPriceJpy } = require('../pricing/priceDecision');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB = 'coupang_datas';
const DRY_RUN = process.argv.includes('--dry-run');

// ── 마이그레이션 대상 하드코딩 ──────────────────────────────────────────────
const GROUPS = [
  {
    name: '300g',
    master: { vendorItemId: '77232047334', qoo10ItemId: '1197862497', optionLabel: '1個', optionCode: '1' },
    slaves: [
      { vendorItemId: '86533289904', qoo10ItemId: '1197862500', optionLabel: '5個', optionCode: '5' },
    ],
  },
  {
    name: '250g',
    master: { vendorItemId: '85321289776', qoo10ItemId: '1198587484', optionLabel: '2個', optionCode: '2' },
    slaves: [
      { vendorItemId: '85296814940', qoo10ItemId: '1198914911', optionLabel: '3個', optionCode: '3' },
    ],
  },
];

// ── 컬럼 인덱스 → A1 문자 변환 ────────────────────────────────────────────
function colLetter(idx) {
  let letter = '';
  let n = idx;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

// ── 시트 전체 읽기 + 인덱스 맵 구축 ──────────────────────────────────────
async function loadSheet(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!A:ZZ`,
  });

  const rawRows = res.data.values || [];
  if (rawRows.length < 2) throw new Error('시트 데이터가 없습니다.');

  const headers = rawRows[0];
  const colIdx = {};
  for (const key of COUPANG_DATA_HEADERS) {
    colIdx[key] = headers.indexOf(key);
  }

  const rows = rawRows.slice(1).map((row, i) => {
    const obj = { _sheetRowNum: i + 2 };
    for (const key of COUPANG_DATA_HEADERS) {
      const idx = colIdx[key];
      obj[key] = idx !== -1 ? (row[idx] ?? '') : '';
    }
    return obj;
  });

  // vendorItemId → row 인덱스 맵
  const rowByVendorId = new Map();
  for (const row of rows) {
    if (row.vendorItemId) rowByVendorId.set(String(row.vendorItemId), row);
  }

  return { rows, colIdx, rowByVendorId };
}

async function main() {
  if (!SPREADSHEET_ID) {
    console.error('[migrate] ERROR: GOOGLE_SHEET_ID가 설정되지 않았습니다.');
    process.exit(1);
  }

  if (DRY_RUN) console.log('[migrate] DRY-RUN 모드 — Qoo10 API 호출 없음\n');

  const sheets = await getSheetsClient();
  const { colIdx, rowByVendorId } = await loadSheet(sheets);

  // 모든 vendorItemId가 시트에 있는지 확인
  const allIds = GROUPS.flatMap((g) => [g.master.vendorItemId, ...g.slaves.map((s) => s.vendorItemId)]);
  for (const id of allIds) {
    if (!rowByVendorId.has(id)) {
      console.error(`[migrate] ERROR: vendorItemId=${id} 를 시트에서 찾을 수 없습니다.`);
      process.exit(1);
    }
  }

  // ── Step 1 — 거래폐지 ──────────────────────────────────────────────────
  console.log('[migrate] ── Step 1: 거래폐지 (SLAVE 기존 Qoo10 상품)');
  for (const group of GROUPS) {
    for (const slave of group.slaves) {
      console.log(`  ItemCode=${slave.qoo10ItemId} (${group.name} ${slave.optionLabel})`);
      if (!DRY_RUN) {
        try {
          await editGoodsStatus({ itemCode: slave.qoo10ItemId, status: 3 });
          console.log(`  → 거래폐지 완료`);
        } catch (err) {
          console.log(`  → 거래폐지 스킵 (이미 처리됨?: ${err.message})`);
        }
      }
    }
  }
  if (DRY_RUN) console.log('  [DRY-RUN] EditGoodsStatus(Status=3) 호출 생략\n');

  // ── Step 2 — MASTER 타이틀 수량 제거 ──────────────────────────────────
  console.log('[migrate] ── Step 2: MASTER ItemTitle 수량 제거');
  const masterTitles = {}; // vendorItemId → jpTitle

  for (const group of GROUPS) {
    const { vendorItemId, qoo10ItemId } = group.master;
    const row = rowByVendorId.get(vendorItemId);

    // jpTitle 무시하고 ItemTitle 원본으로 항상 재번역
    const baseTitle = row.ItemTitle;
    console.log(`  [${group.name}] ItemTitle 재번역: "${baseTitle}"`);
    let jpTitle;
    if (!DRY_RUN) {
      const translated = await translateTitle(baseTitle, '');
      jpTitle = translated?.jpTitle ?? translated;
      console.log(`  [${group.name}] 번역 결과: "${jpTitle}"`);
    } else {
      jpTitle = `[번역예정] ${baseTitle}`;
    }

    masterTitles[vendorItemId] = jpTitle;

    console.log(`  UpdateGoods(ItemCode=${qoo10ItemId}) ItemTitle="${jpTitle}"`);
    if (!DRY_RUN) {
      const result = await updateExistingGoods({ ItemCode: qoo10ItemId, ItemTitle: jpTitle }, row);
      if (!result.success) {
        throw new Error(`UpdateGoods 실패 (${group.name} MASTER): ${result.resultMsg}`);
      }
      console.log(`  → UpdateGoods 완료`);
    }
  }
  if (DRY_RUN) console.log('  [DRY-RUN] UpdateGoods 호출 생략\n');

  // ── Step 3 — 가격 계산 ────────────────────────────────────────────────
  console.log('[migrate] ── Step 3: 가격 계산');

  const groupPrices = []; // { group, masterJpy, slaveJpys, options }

  for (const group of GROUPS) {
    const masterRow = rowByVendorId.get(group.master.vendorItemId);

    const masterResult = await decideItemPriceJpy({
      row: masterRow,
      vendorItemId: group.master.vendorItemId,
      mode: 'MIGRATE',
      sheetsClient: sheets,
      sheetId: SPREADSHEET_ID,
    });
    if (!masterResult.valid) {
      throw new Error(`가격 계산 실패 (${group.name} MASTER): ${masterResult.error}`);
    }
    const masterJpy = Number(masterResult.priceJpy);

    const slaveJpys = [];
    for (const slave of group.slaves) {
      const slaveRow = rowByVendorId.get(slave.vendorItemId);
      const slaveResult = await decideItemPriceJpy({
        row: slaveRow,
        vendorItemId: slave.vendorItemId,
        mode: 'MIGRATE',
        sheetsClient: sheets,
        sheetId: SPREADSHEET_ID,
      });
      if (!slaveResult.valid) {
        throw new Error(`가격 계산 실패 (${group.name} ${slave.optionLabel}): ${slaveResult.error}`);
      }
      slaveJpys.push(Number(slaveResult.priceJpy));
    }

    // delta 계산: slave가격 - master가격 (음수 방지)
    const MAX_DELTA_JPY = Math.floor(masterJpy * 0.5);
    const options = [
      { label: group.master.optionLabel, deltaPriceJpy: 0, code: group.master.optionCode },
      ...group.slaves.map((slave, i) => ({
        label: slave.optionLabel,
        deltaPriceJpy: Math.min(Math.max(0, slaveJpys[i] - masterJpy), MAX_DELTA_JPY),
        code: slave.optionCode,
      })),
    ];

    const deltaLines = group.slaves
      .map((s, i) => {
        const raw = Math.max(0, slaveJpys[i] - masterJpy);
        const capped = Math.min(raw, MAX_DELTA_JPY);
        return `${s.optionLabel} delta=+${capped}${raw > capped ? ` (캡적용: 원래 ${raw})` : ''}`;
      })
      .join(' | ');
    console.log(`  ${group.name}: master=${masterJpy}jpy | ${deltaLines}`);

    groupPrices.push({ group, masterJpy, slaveJpys, options });
  }

  // ── Step 4 — EditGoodsInventory ───────────────────────────────────────
  console.log('\n[migrate] ── Step 4: EditGoodsInventory 페이로드');

  for (const { group, options } of groupPrices) {
    const inventoryInfo = buildInventoryInfo(options);
    console.log(`  ${group.master.qoo10ItemId} (${group.name}): ${inventoryInfo}`);
    if (!DRY_RUN) {
      await editGoodsInventory({ itemCode: group.master.qoo10ItemId, inventoryInfo });
      console.log(`  → EditGoodsInventory 완료`);
    }
  }
  if (DRY_RUN) console.log('  [DRY-RUN] EditGoodsInventory 호출 생략\n');

  // ── Step 5 — 시트 write-back ──────────────────────────────────────────
  console.log('\n[migrate] ── Step 5: 시트 write-back');

  if (DRY_RUN) {
    console.log('  [DRY-RUN] 시트 write-back 생략');
    console.log('\n[migrate] dry-run 완료.');
    return;
  }

  const valueRanges = [];

  for (const { group } of groupPrices) {
    // MASTER
    const masterRow = rowByVendorId.get(group.master.vendorItemId);
    const masterMsg = `[migration=ok] [role=MASTER] [optionCount=${1 + group.slaves.length}]`;
    const masterJpTitle = masterTitles[group.master.vendorItemId];

    const addCell = (row, field, value) => {
      const ci = colIdx[field];
      if (ci === -1) return;
      valueRanges.push({
        range: `${TAB}!${colLetter(ci)}${row._sheetRowNum}`,
        values: [[value]],
      });
    };

    addCell(masterRow, 'registrationMessage', masterMsg);
    if (masterJpTitle) addCell(masterRow, 'jpTitle', masterJpTitle);

    // SLAVES
    for (const slave of group.slaves) {
      const slaveRow = rowByVendorId.get(slave.vendorItemId);
      const slaveMsg = `[migration=ok] [role=SLAVE] [masterItemCode=${group.master.qoo10ItemId}]`;
      addCell(slaveRow, 'qoo10ItemId', '');
      addCell(slaveRow, 'registrationMessage', slaveMsg);
    }
  }

  if (valueRanges.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'RAW', data: valueRanges },
    });
    console.log(`  batchUpdate 완료: ${valueRanges.length}셀`);
  }

  console.log('\n[migrate] 완료.');
}

main().catch((err) => {
  console.error('[migrate] ERROR:', err.message);
  process.exit(1);
});
