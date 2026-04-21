#!/usr/bin/env node
/**
 * qoo10-flag-desc-update.js
 *
 * qoo10ItemId가 있는 상품 전체에 needsUpdate=YES, changeFlags=DESC 세팅.
 * 이후 npm run qoo10:auto-register 실행 시 상세페이지 HTML이 재생성·전송됨.
 *
 * Usage:
 *   node backend/scripts/qoo10-flag-desc-update.js --dry-run
 *   node backend/scripts/qoo10-flag-desc-update.js
 *   node backend/scripts/qoo10-flag-desc-update.js --limit=10
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
    console.error('[flag-desc] ERROR: GOOGLE_SHEET_ID가 설정되지 않았습니다.');
    process.exit(1);
  }

  const sheets = await getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!A:ZZ`,
  });

  const rows = res.data.values || [];
  if (rows.length < 2) {
    console.log('[flag-desc] 데이터가 없습니다.');
    return;
  }

  const headers = rows[0];
  const qoo10ItemIdIdx  = headers.indexOf('qoo10ItemId');
  const needsUpdateIdx  = headers.indexOf('needsUpdate');
  const changeFlagsIdx  = headers.indexOf('changeFlags');
  const statusIdx       = headers.indexOf('status');
  const vendorItemIdx   = headers.indexOf('vendorItemId');

  for (const [name, idx] of [['qoo10ItemId', qoo10ItemIdIdx], ['needsUpdate', needsUpdateIdx], ['changeFlags', changeFlagsIdx], ['status', statusIdx]]) {
    if (idx === -1) {
      console.error(`[flag-desc] ERROR: '${name}' 컬럼이 없습니다.`);
      process.exit(1);
    }
  }

  // qoo10ItemId 있고 아직 needsUpdate=YES가 아닌 행 수집
  const targets = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const qoo10ItemId = (row[qoo10ItemIdIdx] || '').trim();
    const needsUpdate = (row[needsUpdateIdx] || '').trim();
    const status = (row[statusIdx] || '').trim();
    if (!qoo10ItemId) continue;
    if (needsUpdate === 'YES') continue; // 이미 세팅된 행 건너뜀
    targets.push({ sheetRowNum: i + 1, row, qoo10ItemId, status });
  }

  console.log(`[flag-desc] 대상 ${targets.length}개 (qoo10ItemId 있음, needsUpdate!=YES)`);

  if (targets.length === 0) {
    console.log('[flag-desc] 세팅할 상품이 없습니다.');
    return;
  }

  const toProcess = isFinite(LIMIT) ? targets.slice(0, LIMIT) : targets;
  if (isFinite(LIMIT) && targets.length > LIMIT) {
    console.log(`[flag-desc] --limit=${LIMIT} 적용: ${toProcess.length}개만 처리`);
  }

  if (DRY_RUN) {
    console.log('[flag-desc] DRY-RUN: 실제 변경 없음');
    for (const { row, qoo10ItemId, status } of toProcess) {
      const vendorItemId = vendorItemIdx !== -1 ? (row[vendorItemIdx] || '-') : '-';
      console.log(`  → vendorItemId=${vendorItemId} qoo10ItemId=${qoo10ItemId} status=${status}`);
    }
    console.log(`[flag-desc] 완료 (${toProcess.length}개 예정)`);
    return;
  }

  // 단일 batchUpdate로 전체 처리
  const data = [];
  for (const { sheetRowNum } of toProcess) {
    data.push({ range: `${TAB}!${colLetter(needsUpdateIdx)}${sheetRowNum}`, values: [['YES']] });
    data.push({ range: `${TAB}!${colLetter(changeFlagsIdx)}${sheetRowNum}`, values: [['DESC']] });
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data },
  });

  console.log(`[flag-desc] ${toProcess.length}개 → needsUpdate=YES, changeFlags=DESC 세팅 완료`);
  console.log('');
  console.log('▶ 다음 단계: npm run qoo10:auto-register:dry');
  console.log('             npm run qoo10:auto-register');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[flag-desc] 치명적 오류:', err.message);
    process.exit(1);
  });
