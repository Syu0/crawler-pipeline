#!/usr/bin/env node
/**
 * migrate-coupang-datas-schema.js
 *
 * coupang_datas 시트의 데이터 행을 이전 35컬럼 스키마에서
 * 새 28컬럼 스키마(COUPANG_DATA_HEADERS)로 재배치.
 *
 * 배경:
 *   setup-sheets.js가 헤더 행(A1:AB1)을 새 28컬럼 순서로 덮어씀.
 *   그러나 Google Sheets API values.update는 제공한 값 범위만 쓰고
 *   그 너머(AC~AI) 셀은 건드리지 않으므로 헤더가 중복 존재하게 됨.
 *   데이터 행도 여전히 이전 컬럼 순서를 따르고 있어 헤더-데이터 불일치 발생.
 *
 * 이 스크립트:
 *   1. 현재 헤더 1행 출력 + 중복 컬럼 확인
 *   2. 마이그레이션 필요 여부 자동 감지
 *   3. 데이터 행을 새 컬럼 순서로 재배치 (손실 없음)
 *   4. 헤더 행을 COUPANG_DATA_HEADERS로 확정, AC~AI 구헤더 제거
 *
 * Usage:
 *   node backend/scripts/migrate-coupang-datas-schema.js [--dry-run]
 *   npm run sheets:migrate
 */

'use strict';

require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
});

const { getSheetsClient } = require('../coupang/sheetsClient');
const { COUPANG_DATA_HEADERS } = require('../coupang/sheetSchema');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB = 'coupang_datas';

// ── 이전 스키마 (35컬럼) ────────────────────────────────────────────────────
// setup-sheets.js 실행 전까지 실제 시트 데이터 행이 따르던 컬럼 순서.
const OLD_HEADERS = [
  'vendorItemId',            // 0  A
  'coupang_product_id',      // 1  B
  'categoryId',              // 2  C
  'ProductURL',              // 3  D
  'ItemTitle',               // 4  E
  'ItemPrice',               // 5  F
  'StandardImage',           // 6  G
  'ExtraImages',             // 7  H
  'WeightKg',                // 8  I
  'Options',                 // 9  J
  'ItemDescriptionText',     // 10 K
  'updatedAt',               // 11 L
  '',                        // 12 M
  '',                        // 13 N
  'categoryPath2',           // 14 O
  'categoryPath3',           // 15 P
  'optionsHash',             // 16 Q
  'prevItemPrice',           // 17 R
  'prevOptionsHash',         // 18 S
  'changeFlags',             // 19 T
  'needsUpdate',             // 20 U
  'lastRescrapedAt',         // 21 V
  'qoo10ItemId',             // 22 W
  'qoo10SellerCode',         // 23 X
  'qoo10SellingPrice',       // 24 Y
  'jpCategoryIdUsed',        // 25 Z
  'categoryMatchType',       // 26 AA
  'categoryMatchConfidence', // 27 AB
  'coupangCategoryKeyUsed',  // 28 AC
  'registrationMode',        // 29 AD
  'registrationStatus',      // 30 AE
  'registrationMessage',     // 31 AF
  'lastRegisteredAt',        // 32 AG
  'itemId',                  // 33 AH
  'status',                  // 34 AI
];

// ── 헬퍼 ────────────────────────────────────────────────────────────────────
function colLetter(i) {
  if (i < 26) return String.fromCharCode(65 + i);
  return String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
}

// old 인덱스 → new 인덱스 매핑
const OLD_TO_NEW = (() => {
  const map = {};
  for (let newIdx = 0; newIdx < COUPANG_DATA_HEADERS.length; newIdx++) {
    const colName = COUPANG_DATA_HEADERS[newIdx];
    const oldIdx = OLD_HEADERS.indexOf(colName);
    if (oldIdx !== -1) {
      map[oldIdx] = newIdx;
    }
  }
  return map;
})();

function migrateRow(oldRow) {
  // 35슬롯 배열: 새 위치 0~27 + AC~AI(28~34) 빈 값으로 기존 잉여 헤더 영역 초기화
  const newRow = new Array(OLD_HEADERS.length).fill('');
  for (const [oldIdxStr, newIdx] of Object.entries(OLD_TO_NEW)) {
    const val = oldRow[parseInt(oldIdxStr, 10)];
    if (val !== undefined) newRow[newIdx] = val;
  }
  return newRow;
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!SPREADSHEET_ID) {
    console.error('Error: GOOGLE_SHEET_ID not set in backend/.env');
    process.exit(1);
  }

  const sheets = await getSheetsClient();

  console.log('='.repeat(60));
  console.log('coupang_datas 스키마 마이그레이션');
  console.log('='.repeat(60));
  if (dryRun) console.log('** DRY-RUN 모드 — 시트 write 없음 **');
  console.log('');

  // ── 1. 현재 헤더 읽기 ─────────────────────────────────────────────────────
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!A:ZZ`,
  });

  const allRows = res.data.values || [];
  if (allRows.length === 0) {
    console.log('시트가 비어있습니다. 종료.');
    return;
  }

  const currentHeaders = allRows[0];
  const dataRows = allRows.slice(1);

  console.log(`[현재 헤더] 총 ${currentHeaders.length}개:`);
  currentHeaders.forEach((h, i) => {
    if (h) console.log(`  [${String(i).padStart(2, ' ')}] ${colLetter(i).padEnd(3, ' ')} ${h}`);
  });

  // 중복 컬럼 감지
  const seen = {};
  const duplicates = [];
  currentHeaders.forEach((h, i) => {
    if (!h) return;
    if (seen[h] !== undefined) {
      duplicates.push({ name: h, first: seen[h], second: i });
    } else {
      seen[h] = i;
    }
  });

  if (duplicates.length > 0) {
    console.log(`\n[중복 컬럼] ${duplicates.length}개:`);
    duplicates.forEach(d =>
      console.log(`  '${d.name}' — [${d.first}] ${colLetter(d.first)} (빈 데이터) + [${d.second}] ${colLetter(d.second)} (실제 데이터)`)
    );
  } else {
    console.log('\n[중복 컬럼] 없음');
  }

  // ── 2. 마이그레이션 필요 여부 판단 ────────────────────────────────────────
  // 헤더[1] 로 판단: old schema = 'coupang_product_id', new schema = 'itemId'
  const isNewHeaderFormat = currentHeaders[1] === 'itemId';
  const isOldHeaderFormat = currentHeaders[1] === 'coupang_product_id';

  console.log(`\n[헤더 포맷] ${
    isNewHeaderFormat
      ? '새 스키마 (A-AB 덮어쓰기 됨 — 마이그레이션 필요)'
      : isOldHeaderFormat
      ? '이전 스키마 (마이그레이션 불필요, 이미 정상)'
      : `알 수 없음 (headers[1]='${currentHeaders[1]}')`
  }`);

  if (!isNewHeaderFormat) {
    console.log('\n데이터가 이미 올바른 포맷이거나 알 수 없는 상태. 종료.');
    return;
  }

  // ── 3. 마이그레이션 실행 ──────────────────────────────────────────────────
  console.log(`\n[마이그레이션] ${dataRows.length}개 데이터 행 재배치 시작...`);

  const migratedRows = dataRows.map(migrateRow);

  // 미리보기 (최대 3행)
  console.log('\n[미리보기] 마이그레이션 후 처음 3행:');
  migratedRows.slice(0, 3).forEach((row, i) => {
    console.log(`  행 ${i + 2}:`);
    console.log(`    vendorItemId : ${row[0]}`);
    console.log(`    ProductURL   : ${(row[4] || '').substring(0, 60)}`);
    console.log(`    ItemTitle    : ${(row[5] || '').substring(0, 40)}`);
    console.log(`    status       : ${row[25]}`);
    console.log(`    updatedAt    : ${row[26]}`);
  });

  if (dryRun) {
    console.log('\n[DRY-RUN] 실제 write 생략. 종료.');
    return;
  }

  // ── 4. 시트 write ─────────────────────────────────────────────────────────
  // 헤더 행: COUPANG_DATA_HEADERS(28) + 빈값 7개 → AC~AI 잉여 헤더 제거
  const newHeaderRow = [
    ...COUPANG_DATA_HEADERS,
    ...new Array(OLD_HEADERS.length - COUPANG_DATA_HEADERS.length).fill(''),
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!A1:ZZ1`,
    valueInputOption: 'RAW',
    requestBody: { values: [newHeaderRow] },
  });
  console.log('\n  ✓ 헤더 행 업데이트 완료');

  // 데이터 행 배치 write
  if (migratedRows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TAB}!A2:ZZ${migratedRows.length + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: migratedRows },
    });
    console.log(`  ✓ 데이터 행 ${migratedRows.length}개 마이그레이션 완료`);
  }

  console.log('\n마이그레이션 완료!');
  console.log('다음 단계: npm run coupang:collect:dry -- --limit 1');
}

main().catch((err) => {
  console.error('\n✗ Error:', err.message);
  process.exit(1);
});
