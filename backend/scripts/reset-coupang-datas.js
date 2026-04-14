#!/usr/bin/env node
/**
 * reset-coupang-datas.js
 *
 * coupang_datas 시트에서 qoo10ItemId가 비어있는 행만 삭제 (헤더 1행 유지).
 * qoo10ItemId가 있는 행(Qoo10 등록 완료)은 보존.
 *
 * Usage:
 *   node backend/scripts/reset-coupang-datas.js --dry-run   # 삭제 대상 행 수만 출력
 *   node backend/scripts/reset-coupang-datas.js             # 실제 삭제
 *   npm run sheets:reset:dry
 *   npm run sheets:reset
 */

'use strict';

require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
});

const { getSheetsClient } = require('../coupang/sheetsClient');
const { COUPANG_DATA_HEADERS } = require('../coupang/sheetSchema');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB = 'coupang_datas';
const DRY_RUN = process.argv.includes('--dry-run');

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
    console.error('[reset] ERROR: GOOGLE_SHEET_ID가 설정되지 않았습니다.');
    process.exit(1);
  }

  const sheets = await getSheetsClient();
  const headers = COUPANG_DATA_HEADERS;
  const lastCol = colLetter(headers.length - 1);

  // 시트 전체 읽기 (헤더 포함)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!A1:${lastCol}`,
  });

  const allRows = res.data.values || [];
  if (allRows.length <= 1) {
    console.log('[reset] 데이터 행이 없습니다. 종료합니다.');
    return;
  }

  const headerRow = allRows[0];
  const qoo10ItemIdColIdx = headerRow.indexOf('qoo10ItemId');

  if (qoo10ItemIdColIdx === -1) {
    console.error('[reset] ERROR: 시트 헤더에서 qoo10ItemId 컬럼을 찾을 수 없습니다.');
    process.exit(1);
  }

  // qoo10ItemId가 비어있는 행의 1-based 시트 행 번호 수집
  // allRows[0] = 헤더(1행), allRows[1] = 데이터 첫 행(2행), ...
  const targetRowNums = [];
  for (let i = 1; i < allRows.length; i++) {
    const qoo10ItemId = (allRows[i][qoo10ItemIdColIdx] || '').trim();
    if (!qoo10ItemId) {
      targetRowNums.push(i + 1); // 1-based
    }
  }

  const totalDataRows = allRows.length - 1;
  console.log(`[reset] 전체 데이터 행: ${totalDataRows}개`);
  console.log(`[reset] 삭제 대상 (qoo10ItemId 없음): ${targetRowNums.length}개`);
  console.log(`[reset] 보존 (qoo10ItemId 있음): ${totalDataRows - targetRowNums.length}개`);

  if (targetRowNums.length === 0) {
    console.log('[reset] 삭제 대상 없음. 종료합니다.');
    return;
  }

  if (DRY_RUN) {
    console.log(`[reset] DRY-RUN: ${targetRowNums.length}개 행 삭제 대상 (실제 삭제 안 함)`);
    return;
  }

  // 시트 sheetId 조회
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = meta.data.sheets.find((s) => s.properties.title === TAB);
  if (!sheet) {
    console.error(`[reset] ERROR: '${TAB}' 시트를 찾을 수 없습니다.`);
    process.exit(1);
  }
  const sheetId = sheet.properties.sheetId;

  // 역순 삭제 — 아래 행부터 제거해야 위 행 번호가 밀리지 않음
  const reversed = [...targetRowNums].sort((a, b) => b - a);

  for (const rowNum of reversed) {
    const rowIndex = rowNum - 1; // 0-based
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowIndex,
              endIndex: rowIndex + 1,
            },
          },
        }],
      },
    });
  }

  console.log(`[reset] ${targetRowNums.length}개 행 삭제 완료`);
  console.log('[reset] 완료');
  console.log('');
  console.log('▶ 다음 단계: npm run qoo10:import:existing:dry -- --file=<엑셀파일>.xlsx');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[reset] 치명적 오류:', err.message);
    process.exit(1);
  });
