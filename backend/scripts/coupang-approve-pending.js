#!/usr/bin/env node
/**
 * coupang-approve-pending.js
 *
 * PENDING_APPROVAL 상태 상품을 REGISTER_READY로 일괄 전이.
 *
 * Usage:
 *   node backend/scripts/coupang-approve-pending.js
 *   node backend/scripts/coupang-approve-pending.js --dry-run
 *   node backend/scripts/coupang-approve-pending.js --limit=5
 *   npm run coupang:approve
 *   npm run coupang:approve:dry
 */

'use strict';

require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
});

const { getSheetsClient } = require('../coupang/sheetsClient');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB = 'coupang_datas';

const DRY_RUN = process.argv.includes('--dry-run');

const limitArg = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

// 컬럼 인덱스 → 컬럼 문자 변환
function colLetter(idx) {
  let letter = '';
  let n = idx;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

async function main() {
  if (!SPREADSHEET_ID) {
    console.error('[approve] ERROR: GOOGLE_SHEET_ID가 설정되지 않았습니다.');
    process.exit(1);
  }

  const sheets = await getSheetsClient();

  // ── 1. 시트 전체 읽기 ─────────────────────────────────────────────────────
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!A:ZZ`,
  });

  const rows = res.data.values || [];
  if (rows.length < 2) {
    console.log('[approve] 데이터가 없습니다. 종료합니다.');
    return;
  }

  const headers = rows[0];
  const statusIdx      = headers.indexOf('status');
  const updatedAtIdx   = headers.indexOf('updatedAt');
  const vendorItemIdx  = headers.indexOf('vendorItemId');
  const itemTitleIdx   = headers.indexOf('ItemTitle');
  const itemPriceIdx   = headers.indexOf('ItemPrice');

  if (statusIdx === -1 || updatedAtIdx === -1) {
    console.error('[approve] ERROR: coupang_datas 시트에 status 또는 updatedAt 컬럼이 없습니다.');
    process.exit(1);
  }

  // ── 2. PENDING_APPROVAL 행 수집 ───────────────────────────────────────────
  const pendingRows = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if ((row[statusIdx] || '') === 'PENDING_APPROVAL') {
      pendingRows.push({ sheetRowNum: i + 1, row });
    }
  }

  console.log(`[approve] PENDING_APPROVAL 행 ${pendingRows.length}개 발견`);

  if (pendingRows.length === 0) {
    console.log('[approve] 승인할 상품이 없습니다. 종료합니다.');
    return;
  }

  const toApprove = isFinite(LIMIT) ? pendingRows.slice(0, LIMIT) : pendingRows;

  if (isFinite(LIMIT) && pendingRows.length > LIMIT) {
    console.log(`[approve] --limit=${LIMIT} 적용: ${toApprove.length}개만 처리`);
  }

  // ── 3. dry-run ────────────────────────────────────────────────────────────
  if (DRY_RUN) {
    console.log('[approve] DRY-RUN: 실제 변경 없음');
    for (const { row } of toApprove) {
      const vendorItemId = vendorItemIdx !== -1 ? (row[vendorItemIdx] || '-') : '-';
      const title        = itemTitleIdx  !== -1 ? (row[itemTitleIdx]  || '-') : '-';
      const price        = itemPriceIdx  !== -1 ? (row[itemPriceIdx]  || '-') : '-';
      console.log(`[approve]   → vendorItemId=${vendorItemId} | ItemTitle=${title} | price=${price}`);
    }
    console.log('[approve] 완료');
    return;
  }

  // ── 4. 실제 write-back ────────────────────────────────────────────────────
  const nowISO = new Date().toISOString();
  let successCount = 0;
  let failCount = 0;

  for (const { sheetRowNum } of toApprove) {
    try {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: 'RAW',
          data: [
            {
              range: `${TAB}!${colLetter(statusIdx)}${sheetRowNum}`,
              values: [['REGISTER_READY']],
            },
            {
              range: `${TAB}!${colLetter(updatedAtIdx)}${sheetRowNum}`,
              values: [[nowISO]],
            },
          ],
        },
      });
      successCount++;
    } catch (err) {
      console.error(`[approve] 행 ${sheetRowNum} 업데이트 실패:`, err.message);
      failCount++;
    }
  }

  console.log(`[approve] REGISTER_READY 전이: ${successCount}개 성공, ${failCount}개 실패`);
  console.log('[approve] 완료');
  if (successCount > 0) {
    console.log('');
    console.log('▶ 다음 단계: npm run qoo10:auto-register:dry');
    console.log('             npm run qoo10:auto-register');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[approve] 치명적 오류:', err.message);
    process.exit(1);
  });
