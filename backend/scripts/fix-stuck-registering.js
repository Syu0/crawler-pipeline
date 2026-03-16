#!/usr/bin/env node
/**
 * fix-stuck-registering.js
 *
 * REGISTERING 상태로 굳은 행을 COLLECTED로 되돌린다.
 * DRY_RUN 실행이 락을 남긴 버그의 일회성 수정용.
 *
 * 사용법:
 *   node backend/scripts/fix-stuck-registering.js --dry-run
 *   node backend/scripts/fix-stuck-registering.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { getSheetsClient } = require('../coupang/sheetsClient');

const SHEET_ID  = process.env.GOOGLE_SHEET_ID;
const TAB_NAME  = process.env.GOOGLE_SHEET_TAB_NAME || 'coupang_datas';
const DRY_RUN   = process.argv.includes('--dry-run');

// 대상 vendorItemId (복수 지정 가능)
const STUCK_VENDOR_ITEM_IDS = [
  '88994115904',
];

const RECOVER_STATUS = 'COLLECTED';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function columnLetter(index) {
  let letter = '';
  while (index >= 0) {
    letter = String.fromCharCode((index % 26) + 65) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

async function updateRow(sheets, rowIndex, updates) {
  const headersRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A1:ZZ1`,
  });
  const headers = headersRes.data.values?.[0] || [];

  const data = [];
  for (const [field, value] of Object.entries(updates)) {
    let colIndex = headers.indexOf(field);
    if (colIndex === -1) {
      // 컬럼이 없으면 헤더 행 끝에 추가
      colIndex = headers.length;
      headers.push(field);
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${TAB_NAME}!${columnLetter(colIndex)}1`,
        valueInputOption: 'RAW',
        requestBody: { values: [[field]] },
      });
    }
    data.push({
      range: `${TAB_NAME}!${columnLetter(colIndex)}${rowIndex}`,
      values: [[value]],
    });
  }

  if (data.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: 'RAW', data },
    });
  }
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!SHEET_ID) {
    console.error('Error: GOOGLE_SHEET_ID not configured in backend/.env');
    process.exit(1);
  }

  console.log('[fix-stuck] DRY_RUN=' + DRY_RUN);
  console.log('[fix-stuck] 대상: ' + STUCK_VENDOR_ITEM_IDS.join(', '));
  console.log('[fix-stuck] 복구 status: ' + RECOVER_STATUS);
  console.log('');

  const sheets = await getSheetsClient();

  // 시트 전체 읽기
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A:ZZ`,
  });
  const rows = res.data.values || [];
  if (rows.length < 2) {
    console.log('[fix-stuck] 데이터 없음. 종료.');
    return;
  }

  const headers       = rows[0];
  const vendorItemIdx = headers.indexOf('vendorItemId');
  const itemIdIdx     = headers.indexOf('itemId');
  const statusIdx     = headers.indexOf('status');

  if (vendorItemIdx === -1 || statusIdx === -1) {
    console.error('[fix-stuck] vendorItemId 또는 status 컬럼을 찾을 수 없습니다.');
    process.exit(1);
  }

  const targetIds = new Set(STUCK_VENDOR_ITEM_IDS.map(String));
  let fixed = 0;
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row     = rows[i];
    const vid     = row[vendorItemIdx] || row[itemIdIdx] || '';
    const status  = row[statusIdx]     || '';
    const rowNum  = i + 1; // 1-based (헤더 포함)

    if (!targetIds.has(String(vid))) continue;

    if (status !== 'REGISTERING') {
      console.log(`[fix-stuck] ${vid} (row ${rowNum}): status=${status} — REGISTERING 아님, 건드리지 않음`);
      skipped++;
      continue;
    }

    console.log(`[fix-stuck] ${vid} (row ${rowNum}): REGISTERING → ${RECOVER_STATUS}`);

    if (!DRY_RUN) {
      await updateRow(sheets, rowNum, {
        status:       RECOVER_STATUS,
        updatedAt:    new Date().toISOString(),
        errorMessage: 'REGISTERING lock released by fix-stuck-registering.js',
      });
      console.log(`[fix-stuck] ${vid}: 시트 업데이트 완료`);
    }

    fixed++;
  }

  console.log('');
  if (DRY_RUN) {
    console.log(`[fix-stuck] DRY_RUN — 시트 변경 없음. 처리 대상: ${fixed}개, 건너뜀: ${skipped}개`);
  } else {
    console.log(`[fix-stuck] 완료. 수정: ${fixed}개, 건너뜀: ${skipped}개`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
