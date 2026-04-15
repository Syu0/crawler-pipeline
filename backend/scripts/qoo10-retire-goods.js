'use strict';

/**
 * qoo10-retire-goods.js
 * Qoo10 상품 거래폐지 (EditGoodsStatus status=3) 일괄 처리.
 *
 * 사용:
 *   node backend/scripts/qoo10-retire-goods.js --dry-run --mode=immediate
 *   node backend/scripts/qoo10-retire-goods.js --mode=immediate
 *   node backend/scripts/qoo10-retire-goods.js --mode=archive
 *   node backend/scripts/qoo10-retire-goods.js --itemCode=XXXXXXXXXX
 */

require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
});

const { qoo10PostMethod } = require('../qoo10/client');
const { getSheetsClient } = require('../coupang/sheetsClient');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB = 'coupang_datas';
const DRY_RUN = process.argv.includes('--dry-run');

const modeArg    = process.argv.find(a => a.startsWith('--mode='));
const MODE       = modeArg ? modeArg.split('=')[1] : null;
const itemCodeArg = process.argv.find(a => a.startsWith('--itemCode='));
const SINGLE_ITEM = itemCodeArg ? itemCodeArg.split('=')[1] : null;

// 유지 대상 (삭제 제외)
const KEEP_IDS = new Set([
  '1055859883', // AIRGILL 마스크
  '1100854958', // 그라놀라 Diget 300g+300g
  '1044467484', // 포로로 스티커
  '1040377203', // 그립톡
  '1056462571', // USB 메모리
  '1116436252', // Among Us 우산
  '1066245208', // 시즈닝 아몬드
  '1081000682', // 모찌 레게 그릇
  '1044345227', // 포로로 스티커 12개 세트
  '1055141580', // 오트밀 미니바이트 1+1 (2025 판매)
  '1122325364', // (재발송건 — 확인 후 판단)
]);

// Phase 1 아카이빙 대상 (삭제 제외 — Phase 3에서 별도 처리)
const ARCHIVE_IDS = new Set([
  '1065693226',
  '1065493732',
  '1083256428',
  '1086158498',
  '1045951709',
  '1048261233',
  '1072078947',
  '1040943931',
  '1037952073',
  '1045928388',
  '1061622381',
  '1045797129',
  '1065424766',
  '1066257031',
  '1042619085',
  '1066261696',
  '1059812958',
  '1041262600',
  '1040962793',
  '1040964829',
  '1050612037',
  '1039429814',
  '1042190609',
]);

// 컬럼 인덱스 → A1 컬럼 문자 변환
function colLetter(idx) {
  let letter = '';
  let n = idx;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * EditGoodsStatus API 호출 (status=3: 거래폐지)
 */
async function editGoodsStatus(itemCode) {
  const res = await qoo10PostMethod('ItemsBasic.EditGoodsStatus', {
    ItemCode: String(itemCode),
    Status:   '3',
  }, '1.1');
  return res;
}

/**
 * 시트에서 거래폐지 대상 목록 동적 조회 (mode=immediate)
 * 조건: status=LIVE AND qoo10ItemId 있음 AND strategyNote 없음 AND KEEP_IDS·ARCHIVE_IDS 제외
 */
async function getImmediateTargets(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!A:ZZ`,
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];

  const headers      = rows[0];
  const statusIdx    = headers.indexOf('status');
  const qoo10IdIdx   = headers.indexOf('qoo10ItemId');
  const noteIdx      = headers.indexOf('strategyNote');
  const vendorIdx    = headers.indexOf('vendorItemId');
  const titleIdx     = headers.indexOf('ItemTitle');

  const targets = [];
  for (let i = 1; i < rows.length; i++) {
    const row        = rows[i];
    const status     = (row[statusIdx]  || '').trim();
    const qoo10Id    = (row[qoo10IdIdx] || '').trim();
    const note       = (row[noteIdx]    || '').trim();
    const vendorId   = (row[vendorIdx]  || '').trim();
    const title      = (row[titleIdx]   || '').trim();

    if (status !== 'LIVE')       continue;
    if (!qoo10Id)                continue;
    if (note)                    continue; // strategyNote 있으면 제외
    if (KEEP_IDS.has(qoo10Id))   continue;
    if (ARCHIVE_IDS.has(qoo10Id)) continue;

    targets.push({ sheetRow: i + 1, qoo10ItemId: qoo10Id, vendorItemId: vendorId, title });
  }
  return targets;
}

/**
 * 시트에서 아카이빙 목록 조회 (mode=archive)
 * 조건: qoo10ItemId가 ARCHIVE_IDS에 포함된 LIVE 행
 */
async function getArchiveTargets(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!A:ZZ`,
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];

  const headers    = rows[0];
  const statusIdx  = headers.indexOf('status');
  const qoo10IdIdx = headers.indexOf('qoo10ItemId');
  const vendorIdx  = headers.indexOf('vendorItemId');
  const titleIdx   = headers.indexOf('ItemTitle');

  const targets = [];
  for (let i = 1; i < rows.length; i++) {
    const row      = rows[i];
    const status   = (row[statusIdx]  || '').trim();
    const qoo10Id  = (row[qoo10IdIdx] || '').trim();
    const vendorId = (row[vendorIdx]  || '').trim();
    const title    = (row[titleIdx]   || '').trim();

    if (status !== 'LIVE')           continue;
    if (!ARCHIVE_IDS.has(qoo10Id))   continue;

    targets.push({ sheetRow: i + 1, qoo10ItemId: qoo10Id, vendorItemId: vendorId, title });
  }
  return targets;
}

/**
 * 성공한 행들의 status → DEACTIVATED, updatedAt 업데이트
 */
async function markDeactivated(sheets, rows, headers, successItems) {
  if (successItems.length === 0) return;

  const statusIdx    = headers.indexOf('status');
  const updatedAtIdx = headers.indexOf('updatedAt');
  const nowISO       = new Date().toISOString();
  const statusCol    = colLetter(statusIdx);
  const updatedCol   = colLetter(updatedAtIdx);

  const data = [];
  for (const { sheetRow } of successItems) {
    data.push({ range: `${TAB}!${statusCol}${sheetRow}`,    values: [['DEACTIVATED']] });
    data.push({ range: `${TAB}!${updatedCol}${sheetRow}`,   values: [[nowISO]] });
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data },
  });

  console.log(`[retire] 시트 업데이트: ${successItems.length}개 행 → DEACTIVATED`);
}

async function main() {
  if (!SPREADSHEET_ID) {
    console.error('[retire] ERROR: GOOGLE_SHEET_ID가 설정되지 않았습니다.');
    process.exit(1);
  }

  console.log(`[retire] ${DRY_RUN ? '--- DRY-RUN ---' : '--- REAL ---'}`);

  const sheets = await getSheetsClient();

  // 대상 목록 결정
  let targets = [];

  if (SINGLE_ITEM) {
    targets = [{ sheetRow: null, qoo10ItemId: SINGLE_ITEM, vendorItemId: '-', title: '-' }];
    console.log(`[retire] 단일 상품 모드: ${SINGLE_ITEM}`);

  } else if (MODE === 'immediate') {
    targets = await getImmediateTargets(sheets);
    console.log(`[retire] immediate 모드: 대상 ${targets.length}개`);

  } else if (MODE === 'archive') {
    targets = await getArchiveTargets(sheets);
    console.log(`[retire] archive 모드: 대상 ${targets.length}개`);

  } else {
    console.error('[retire] --mode=immediate|archive 또는 --itemCode=XXXX 를 지정하세요.');
    process.exit(1);
  }

  if (targets.length === 0) {
    console.log('[retire] 처리할 대상이 없습니다.');
    return;
  }

  // 대상 목록 출력
  for (const t of targets) {
    console.log(`  → ${t.qoo10ItemId} (${t.vendorItemId}) | ${(t.title || '-').slice(0, 40)}`);
  }

  if (DRY_RUN) {
    console.log(`\n[retire] dry-run 완료. API 호출 건너뜀.`);
    return;
  }

  // 시트 헤더 캐시 (status write-back용)
  const sheetRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!1:1`,
  });
  const headers = (sheetRes.data.values || [[]])[0];

  // API 호출
  let successCount = 0;
  let failCount    = 0;
  const successItems = [];

  for (const target of targets) {
    try {
      const res = await editGoodsStatus(target.qoo10ItemId);
      const resultCode = res?.ResultCode ?? res?.resultCode;

      if (String(resultCode) === '0') {
        console.log(`[OK]   ${target.qoo10ItemId} 거래폐지 성공`);
        successCount++;
        if (target.sheetRow) successItems.push(target);
      } else {
        console.warn(`[FAIL] ${target.qoo10ItemId} ResultCode=${resultCode} | ${JSON.stringify(res).slice(0, 100)}`);
        failCount++;
      }
    } catch (err) {
      console.error(`[ERR]  ${target.qoo10ItemId} ${err.message}`);
      failCount++;
    }

    await sleep(1000);
  }

  console.log(`\n[retire] 결과: 성공 ${successCount} / 실패 ${failCount} / 전체 ${targets.length}`);

  // 성공 행 시트 write-back (단일 --itemCode 모드는 sheetRow가 null이므로 skip)
  if (successItems.length > 0) {
    const allRows = (await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TAB}!A:ZZ`,
    })).data.values || [];
    await markDeactivated(sheets, allRows, headers, successItems);
  }
}

main().catch(err => {
  console.error('[retire] 오류:', err.message);
  process.exit(1);
});
