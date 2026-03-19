#!/usr/bin/env node
/**
 * coupang-promote-to-pending.js
 *
 * COLLECTED 상태 상품을 하루 최대 MAX_DAILY_REGISTER개까지 PENDING_APPROVAL로 전환.
 *
 * Usage:
 *   node backend/scripts/coupang-promote-to-pending.js
 *   node backend/scripts/coupang-promote-to-pending.js --dry-run
 *   npm run coupang:promote
 *   npm run coupang:promote:dry
 */

'use strict';

require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
});

const { getSheetsClient, getConfig } = require('../coupang/sheetsClient');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB = 'coupang_datas';

const DRY_RUN = process.argv.includes('--dry-run');

// 오늘 날짜 KST YYYY-MM-DD
function todayKST() {
  const now = new Date();
  // UTC+9
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

async function main() {
  if (!SPREADSHEET_ID) {
    console.error('[promote] ERROR: GOOGLE_SHEET_ID가 설정되지 않았습니다.');
    process.exit(1);
  }

  const sheets = await getSheetsClient();

  // ── 1. config 읽기 ───────────────────────────────────────────────────────
  const config = await getConfig(sheets, SPREADSHEET_ID);

  if (!Object.prototype.hasOwnProperty.call(config, 'MAX_DAILY_REGISTER')) {
    console.error("[promote] ERROR: config 시트에 'MAX_DAILY_REGISTER' 키가 없습니다.");
    console.error('          → npm run sheets:setup        (누락된 키만 추가, 기존 값 유지)');
    console.error('          → npm run sheets:setup:force  (모든 기본값 덮어쓰기 — 값 초기화 주의)');
    console.error('          권장 value: MAX_DAILY_REGISTER = 10');
    process.exit(1);
  }

  const maxDaily = parseInt(config['MAX_DAILY_REGISTER'], 10);
  if (isNaN(maxDaily) || maxDaily <= 0) {
    console.error(`[promote] ERROR: MAX_DAILY_REGISTER 값이 유효하지 않습니다: ${config['MAX_DAILY_REGISTER']}`);
    process.exit(1);
  }

  // ── 2. 시트 전체 읽기 ─────────────────────────────────────────────────────
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!A:ZZ`,
  });

  const rows = res.data.values || [];
  if (rows.length < 2) {
    console.log('[promote] 데이터가 없습니다. 종료합니다.');
    return;
  }

  const headers = rows[0];
  const statusIdx    = headers.indexOf('status');
  const updatedAtIdx = headers.indexOf('updatedAt');
  const regMsgIdx    = headers.indexOf('registrationMessage');

  if (statusIdx === -1 || updatedAtIdx === -1) {
    console.error('[promote] ERROR: coupang_datas 시트에 status 또는 updatedAt 컬럼이 없습니다.');
    process.exit(1);
  }

  const today = todayKST();

  // ── 3. todayCount 계산 (오늘 날짜 updatedAt + 파이프라인 진입 상태) ──────
  const PIPELINE_STATUSES = new Set(['PENDING_APPROVAL', 'REGISTER_READY', 'REGISTERING', 'REGISTERED']);

  let todayCount = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const st = row[statusIdx] || '';
    const ua = row[updatedAtIdx] || '';
    if (PIPELINE_STATUSES.has(st) && ua.startsWith(today)) {
      todayCount++;
    }
  }

  const remainingSlots = maxDaily - todayCount;

  console.log(`[promote] 오늘 처리 중인 상품: ${todayCount}개 (PENDING_APPROVAL/REGISTER_READY/REGISTERING/REGISTERED)`);

  if (remainingSlots <= 0) {
    console.log(`[promote] 오늘 한도(${maxDaily}개) 이미 초과 상태입니다 (오늘 처리 ${todayCount}개). 종료합니다.`);
    return;
  }

  console.log(`[promote] 남은 슬롯: ${remainingSlots}개`);

  // ── 4. COLLECTED 행 수집 (updatedAt 오름차순 — 오래된 것 먼저) ───────────
  const collectedRows = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if ((row[statusIdx] || '') === 'COLLECTED') {
      collectedRows.push({ sheetRowNum: i + 1, updatedAt: row[updatedAtIdx] || '', row });
    }
  }

  // updatedAt 오름차순 (빈 값은 뒤로)
  collectedRows.sort((a, b) => {
    if (!a.updatedAt && !b.updatedAt) return 0;
    if (!a.updatedAt) return 1;
    if (!b.updatedAt) return -1;
    return a.updatedAt.localeCompare(b.updatedAt);
  });

  console.log(`[promote] COLLECTED 상품: ${collectedRows.length}개 발견`);

  if (collectedRows.length === 0) {
    console.log('[promote] 전환할 COLLECTED 상품이 없습니다.');
    console.log('          → DISCOVERED 상품을 수집하려면: npm run coupang:collect');
    console.log('          → 키워드 탐색부터 필요하다면:  npm run coupang:discover');
    console.log('                                         npm run coupang:collect');
    return;
  }

  const toPromote = collectedRows.slice(0, remainingSlots);
  const overflow  = collectedRows.length - toPromote.length;

  console.log(`[promote] ${toPromote.length}개를 PENDING_APPROVAL로 전환${DRY_RUN ? ' (dry-run, 변경 없음)' : ''}`);
  if (overflow > 0) {
    console.log(`[promote] 초과 ${overflow}개는 COLLECTED 유지 → 다음 실행 시 처리`);
  }

  if (DRY_RUN) {
    toPromote.forEach(({ sheetRowNum, updatedAt }) => {
      const vendorItemId = rows[sheetRowNum - 1][headers.indexOf('vendorItemId')] || sheetRowNum;
      console.log(`  [dry-run] 행 ${sheetRowNum} (${vendorItemId}) updatedAt=${updatedAt} → PENDING_APPROVAL`);
    });
    console.log('[promote] dry-run 완료. 변경 없음.');
    return;
  }

  // ── 5. 실제 write-back ────────────────────────────────────────────────────
  const nowISO = new Date().toISOString();
  const promoteMessage = '승인 대기 중 — Sheets에서 status를 REGISTER_READY로 변경 후 npm run qoo10:auto-register 실행';

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

  for (const { sheetRowNum } of toPromote) {
    const updates = [];

    updates.push({
      range: `${TAB}!${colLetter(statusIdx)}${sheetRowNum}`,
      values: [['PENDING_APPROVAL']],
    });
    updates.push({
      range: `${TAB}!${colLetter(updatedAtIdx)}${sheetRowNum}`,
      values: [[nowISO]],
    });
    if (regMsgIdx !== -1) {
      updates.push({
        range: `${TAB}!${colLetter(regMsgIdx)}${sheetRowNum}`,
        values: [[promoteMessage]],
      });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: updates,
      },
    });
  }

  console.log('[promote] 완료');
  console.log('');
  console.log('▶ 다음 단계: Google Sheets에서 등록할 상품의 status를 REGISTER_READY로 변경 후');
  console.log('             npm run qoo10:auto-register 실행');
}

main().catch((err) => {
  console.error('[promote] 치명적 오류:', err.message);
  process.exit(1);
});
