#!/usr/bin/env node
/**
 * qoo10-translate-titles.js
 *
 * LIVE 상품 중 ItemTitle이 비어있고 jpTitle이 있는 행을 대상으로
 * 일본어 → 한국어 역번역하여 ItemTitle 컬럼에 write-back.
 *
 * 대상: status=LIVE AND ItemTitle='' AND jpTitle != ''
 *
 * Usage:
 *   node scripts/qoo10-translate-titles.js --dry-run   # 대상 행 수 + 샘플 5개 출력
 *   node scripts/qoo10-translate-titles.js             # 실제 번역 + write-back
 *   npm run qoo10:translate:titles:dry
 *   npm run qoo10:translate:titles
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') });

const { getSheetsClient } = require('../backend/coupang/sheetsClient');
const { COUPANG_DATA_HEADERS } = require('../backend/coupang/sheetSchema');
const { translateTitleJpToKr } = require('../backend/qoo10/titleTranslator');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB = 'coupang_datas';
const DRY_RUN = process.argv.includes('--dry-run');

const DELAY_MIN = 1000;
const DELAY_MAX = 3000;

function randomDelay(min, max) {
  return new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));
}

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
    console.error('[translate] ERROR: GOOGLE_SHEET_ID가 설정되지 않았습니다.');
    process.exit(1);
  }

  const sheets = await getSheetsClient();
  const headers = COUPANG_DATA_HEADERS;
  const colCount = headers.length;
  const lastCol = colLetter(colCount - 1);

  // 시트 전체 읽기
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!A1:${lastCol}`,
  });
  const allRows = res.data.values || [];
  if (allRows.length <= 1) {
    console.log('[translate] 데이터 행이 없습니다. 종료합니다.');
    return;
  }

  const headerRow = allRows[0];
  const idxOf = (name) => headerRow.indexOf(name);

  const iStatus    = idxOf('status');
  const iItemTitle = idxOf('ItemTitle');
  const iJpTitle   = idxOf('jpTitle');

  if (iStatus === -1 || iItemTitle === -1 || iJpTitle === -1) {
    console.error('[translate] ERROR: 필수 컬럼(status/ItemTitle/jpTitle)을 시트에서 찾을 수 없습니다.');
    process.exit(1);
  }

  // 대상 행 필터: status=LIVE, ItemTitle 빈값, jpTitle 있음
  const targets = [];
  for (let i = 1; i < allRows.length; i++) {
    const row = allRows[i];
    const status    = (row[iStatus]    || '').trim();
    const itemTitle = (row[iItemTitle] || '').trim();
    const jpTitle   = (row[iJpTitle]   || '').trim();
    if (status === 'LIVE' && itemTitle === '' && jpTitle !== '') {
      targets.push({ sheetRowNum: i + 1, jpTitle }); // sheetRowNum: 1-based
    }
  }

  console.log(`[translate] 대상 행: ${targets.length}개 (status=LIVE, ItemTitle 빈값, jpTitle 있음)`);

  if (targets.length === 0) {
    console.log('[translate] 번역할 대상이 없습니다. 종료합니다.');
    return;
  }

  if (DRY_RUN) {
    console.log('');
    console.log('[translate] DRY-RUN 샘플 (최대 5개):');
    for (const t of targets.slice(0, 5)) {
      console.log(`  행 ${t.sheetRowNum}: ${t.jpTitle}`);
    }
    if (targets.length > 5) {
      console.log(`  ... 외 ${targets.length - 5}개`);
    }
    console.log('');
    console.log(`[translate] DRY-RUN: ${targets.length}개 번역 대상 (시트 write skip)`);
    return;
  }

  // 번역 + write-back
  const itemTitleColLetter = colLetter(iItemTitle);
  let successCount = 0;
  let failCount = 0;

  for (const t of targets) {
    try {
      const krTitle = await translateTitleJpToKr(t.jpTitle);
      if (!krTitle) {
        console.warn(`  [skip] 행 ${t.sheetRowNum}: 번역 결과 빈값`);
        failCount++;
        continue;
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${TAB}!${itemTitleColLetter}${t.sheetRowNum}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[krTitle]] },
      });

      console.log(`  [ok] 행 ${t.sheetRowNum}: ${t.jpTitle.slice(0, 30)} → ${krTitle.slice(0, 40)}`);
      successCount++;

      await randomDelay(DELAY_MIN, DELAY_MAX);
    } catch (err) {
      console.warn(`  [fail] 행 ${t.sheetRowNum}: ${err.message}`);
      failCount++;
    }
  }

  console.log('');
  console.log(`[translate] 완료: 성공 ${successCount}개 / 실패 ${failCount}개`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[translate] 치명적 오류:', err.message);
    process.exit(1);
  });
