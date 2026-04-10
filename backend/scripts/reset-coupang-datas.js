#!/usr/bin/env node
/**
 * reset-coupang-datas.js
 *
 * coupang_datas 시트 전체 데이터 행 삭제 (헤더 1행 유지).
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

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB = 'coupang_datas';
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  if (!SPREADSHEET_ID) {
    console.error('[reset] ERROR: GOOGLE_SHEET_ID가 설정되지 않았습니다.');
    process.exit(1);
  }

  const sheets = await getSheetsClient();

  // 현재 행 수 확인
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!A:A`,
  });

  const rows = res.data.values || [];
  const dataRowCount = rows.length > 1 ? rows.length - 1 : 0;

  console.log(`[reset] coupang_datas 데이터 행: ${dataRowCount}개`);

  if (dataRowCount === 0) {
    console.log('[reset] 삭제할 데이터가 없습니다. 종료합니다.');
    return;
  }

  if (DRY_RUN) {
    console.log(`[reset] DRY-RUN: ${dataRowCount}개 행 삭제 대상 (실제 삭제 안 함)`);
    return;
  }

  // 헤더 제외, 2행~끝 전체 삭제
  // 빈 배열로 덮어쓰는 방식 대신 시트 numericId로 deleteRange 사용
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = meta.data.sheets.find((s) => s.properties.title === TAB);
  if (!sheet) {
    console.error(`[reset] ERROR: '${TAB}' 시트를 찾을 수 없습니다.`);
    process.exit(1);
  }
  const sheetId = sheet.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: 1,      // 0-based: 1 = 2행 (헤더 다음)
              endIndex: rows.length, // 현재 마지막 행까지
            },
          },
        },
      ],
    },
  });

  console.log(`[reset] ${dataRowCount}개 데이터 행 삭제 완료`);
  console.log('[reset] 완료');
  console.log('');
  console.log('▶ 다음 단계: npm run qoo10:import:existing:dry');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[reset] 치명적 오류:', err.message);
    process.exit(1);
  });
