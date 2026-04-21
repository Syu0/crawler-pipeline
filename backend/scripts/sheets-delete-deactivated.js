#!/usr/bin/env node
/**
 * sheets-delete-deactivated.js
 *
 * coupang_datas 시트에서 status=DEACTIVATED 행 삭제.
 *
 * Usage:
 *   node backend/scripts/sheets-delete-deactivated.js --dry-run
 *   node backend/scripts/sheets-delete-deactivated.js
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
    console.error('[delete-deactivated] ERROR: GOOGLE_SHEET_ID가 설정되지 않았습니다.');
    process.exit(1);
  }

  const sheets = await getSheetsClient();

  // ── 1. 시트 ID 조회 ────────────────────────────────────────────────────────
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheetMeta = meta.data.sheets.find(s => s.properties.title === TAB);
  if (!sheetMeta) {
    console.error(`[delete-deactivated] ERROR: '${TAB}' 시트를 찾을 수 없습니다.`);
    process.exit(1);
  }
  const sheetId = sheetMeta.properties.sheetId;

  // ── 2. 데이터 읽기 ─────────────────────────────────────────────────────────
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!A:ZZ`,
  });

  const rows = res.data.values || [];
  if (rows.length < 2) {
    console.log('[delete-deactivated] 데이터가 없습니다.');
    return;
  }

  const headers = rows[0];
  const statusIdx     = headers.indexOf('status');
  const vendorItemIdx = headers.indexOf('vendorItemId');
  const itemTitleIdx  = headers.indexOf('ItemTitle');

  if (statusIdx === -1) {
    console.error('[delete-deactivated] ERROR: status 컬럼이 없습니다.');
    process.exit(1);
  }

  // ── 3. DEACTIVATED 행 수집 (0-based, 헤더 포함) ───────────────────────────
  const targets = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if ((row[statusIdx] || '').trim() === 'DEACTIVATED') {
      targets.push({
        rowIndex: i, // 0-based (헤더=0, 데이터 첫행=1)
        vendorItemId: vendorItemIdx !== -1 ? (row[vendorItemIdx] || '-') : '-',
        title: itemTitleIdx !== -1 ? (row[itemTitleIdx] || '-') : '-',
      });
    }
  }

  console.log(`[delete-deactivated] DEACTIVATED 행 ${targets.length}개 발견`);

  if (targets.length === 0) {
    console.log('[delete-deactivated] 삭제할 행이 없습니다.');
    return;
  }

  for (const { vendorItemId, title } of targets) {
    console.log(`  → vendorItemId=${vendorItemId} | ${title.slice(0, 40)}`);
  }

  if (DRY_RUN) {
    console.log('[delete-deactivated] DRY-RUN: 실제 삭제 없음');
    return;
  }

  // ── 4. 행 삭제 (인덱스 역순으로 처리해야 밀림 없음) ───────────────────────
  const deleteRequests = targets
    .slice()
    .sort((a, b) => b.rowIndex - a.rowIndex) // 역순
    .map(({ rowIndex }) => ({
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: rowIndex,
          endIndex: rowIndex + 1,
        },
      },
    }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: deleteRequests },
  });

  console.log(`[delete-deactivated] ${targets.length}개 행 삭제 완료`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[delete-deactivated] 치명적 오류:', err.message);
    process.exit(1);
  });
