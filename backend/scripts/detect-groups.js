#!/usr/bin/env node
/**
 * detect-groups.js — 멀티옵션 그룹 감지 및 시트 write-back
 *
 * coupang_datas 전체를 스캔해 ItemTitle의 수량 패턴(", X개")으로
 * 그룹을 감지하고 groupId / groupRole / optionLabel / optionIncluded 를
 * 시트에 write-back한다.
 *
 * 시트 read는 1회, write는 batchUpdate 1회로 처리 (quota 절약).
 *
 * Usage:
 *   node backend/scripts/detect-groups.js --dry-run   # 결과 콘솔 출력만
 *   node backend/scripts/detect-groups.js             # 시트 write-back
 *   npm run groups:detect:dry
 *   npm run groups:detect
 */

'use strict';

require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
});

const { getSheetsClient } = require('../coupang/sheetsClient');
const { COUPANG_DATA_HEADERS } = require('../coupang/sheetSchema');
const { assignGroupIds } = require('../qoo10/groupDetector');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB = 'coupang_datas';
const DRY_RUN = process.argv.includes('--dry-run');

// 컬럼 인덱스 → A1 notation 컬럼 문자 변환
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
    console.error('[detect-groups] ERROR: GOOGLE_SHEET_ID가 설정되지 않았습니다.');
    process.exit(1);
  }

  const sheets = await getSheetsClient();

  // ── 1. 시트 전체 읽기 (read 1회) ──────────────────────────────────────────
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!A:ZZ`,
  });

  const rawRows = res.data.values || [];
  if (rawRows.length < 2) {
    console.log('[detect-groups] 데이터가 없습니다. 종료합니다.');
    return;
  }

  const headers = rawRows[0];

  // 컬럼 인덱스 미리 계산
  const colIdx = {};
  for (const key of COUPANG_DATA_HEADERS) {
    colIdx[key] = headers.indexOf(key);
  }

  // 배열 행 → 객체 변환 (sheetRowNum: 1-based 시트 행 번호 포함)
  const rows = rawRows.slice(1).map((row, i) => {
    const obj = { _sheetRowNum: i + 2 }; // 헤더가 row 1이므로 데이터는 row 2부터
    for (const key of COUPANG_DATA_HEADERS) {
      const idx = colIdx[key];
      obj[key] = idx !== -1 ? (row[idx] ?? '') : '';
    }
    return obj;
  });

  console.log(`[detect-groups] 총 ${rows.length}행 로드`);
  if (DRY_RUN) console.log('[detect-groups] DRY-RUN 모드 — 시트 변경 없음');

  // ── 2. 그룹 감지 ─────────────────────────────────────────────────────────
  const updates = await assignGroupIds(rows, DRY_RUN, { sheetsClient: sheets, sheetId: SPREADSHEET_ID });

  if (DRY_RUN) {
    console.log('[detect-groups] 완료 (dry-run).');
    return;
  }

  // ── 3. batch write (write 1회) ────────────────────────────────────────────
  const GROUP_FIELDS = ['groupId', 'groupRole', 'optionLabel', 'optionIncluded'];
  const valueRanges = [];

  for (const u of updates) {
    const rowNum = u.row._sheetRowNum;
    if (!rowNum) continue;

    for (const field of GROUP_FIELDS) {
      const ci = colIdx[field];
      if (ci === -1) continue;
      valueRanges.push({
        range: `${TAB}!${colLetter(ci)}${rowNum}`,
        values: [[u[field] ?? '']],
      });
    }
  }

  if (valueRanges.length === 0) {
    console.log('[detect-groups] 업데이트할 내용이 없습니다.');
    return;
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: valueRanges,
    },
  });

  console.log(`[detect-groups] batchUpdate 완료: ${updates.length}행 / ${valueRanges.length}셀`);
  console.log('[detect-groups] 완료.');
}

main().catch((err) => {
  console.error('[detect-groups] ERROR:', err.message);
  process.exit(1);
});
