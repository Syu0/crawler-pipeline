#!/usr/bin/env node
/**
 * qoo10-import-existing-goods.js
 *
 * Qoo10 GetAllGoodsInfo API로 기존 운영 상품 조회 → coupang_datas 시트에 역수입(upsert).
 *
 * PK 결정 규칙:
 *   SellerCode가 숫자로만 구성된 문자열 → vendorItemId = SellerCode
 *   그 외 (빈값 또는 다른 형식)           → vendorItemId = "EXT_" + qoo10ItemId
 *
 * Usage:
 *   node scripts/qoo10-import-existing-goods.js --dry-run   # API 조회 후 write skip
 *   node scripts/qoo10-import-existing-goods.js             # 실제 upsert
 *   npm run qoo10:import:existing:dry
 *   npm run qoo10:import:existing
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') });

const { getSheetsClient } = require('../backend/coupang/sheetsClient');
const { qoo10PostMethod } = require('../backend/qoo10/client');
const { COUPANG_DATA_HEADERS } = require('../backend/coupang/sheetSchema');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB = 'coupang_datas';
const DRY_RUN = process.argv.includes('--dry-run');

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

/**
 * GetAllGoodsInfo S1(판매중) + S2(일시정지) 순회 조회 후 ItemCode 기준 dedup
 */
async function fetchAllGoods() {
  const STATUS_LIST = ['S1', 'S2'];
  const allItems = [];

  for (const itemStatus of STATUS_LIST) {
    let page = 1;
    while (true) {
      console.log(`[import] GetAllGoodsInfo ItemStatus=${itemStatus} page=${page} 조회 중...`);
      const res = await qoo10PostMethod('ItemsLookup.GetAllGoodsInfo', {
        Page: String(page),
        ItemStatus: itemStatus,
        returnType: 'application/json',
      });

      // 응답 구조: { ResultObject: { Items: [...], TotalPages: N, ... } }
      const result = res?.ResultObject;
      const items = result?.Items;
      const totalPages = result?.TotalPages ?? 1;

      if (!items || items.length === 0) {
        console.log(`[import] ItemStatus=${itemStatus} page=${page} 응답 빈 배열 — 종료`);
        break;
      }

      console.log(`[import] ItemStatus=${itemStatus} page=${page}/${totalPages}: ${items.length}개 수신`);
      allItems.push(...items);

      if (page >= totalPages) break;
      page++;
    }
  }

  // ItemCode 기준 dedup (S1/S2 중복 가능성 제거)
  const seen = new Set();
  const deduped = allItems.filter((item) => {
    const key = String(item.ItemCode);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (deduped.length < allItems.length) {
    console.log(`[import] dedup: ${allItems.length}개 → ${deduped.length}개 (중복 ${allItems.length - deduped.length}개 제거)`);
  }

  return deduped;
}

async function main() {
  if (!SPREADSHEET_ID) {
    console.error('[import] ERROR: GOOGLE_SHEET_ID가 설정되지 않았습니다.');
    process.exit(1);
  }

  // ── 1. Qoo10 API 조회 ─────────────────────────────────────────────────────
  const items = await fetchAllGoods();
  console.log(`[import] 총 ${items.length}개 상품 조회 완료`);

  if (items.length === 0) {
    console.log('[import] 역수입할 상품이 없습니다. 종료합니다.');
    return;
  }

  // PK 결정 및 콘솔 출력
  const importRows = items.map((item) => {
    const qoo10ItemId = String(item.ItemCode || '');
    const sellerCode  = String(item.SellerCode || '');
    const vendorItemId = /^\d+$/.test(sellerCode) ? sellerCode : `EXT_${qoo10ItemId}`;
    const pkType = vendorItemId.startsWith('EXT_') ? 'EXT_' : 'vendorItemId';

    return {
      vendorItemId,
      qoo10ItemId,
      ItemTitle: String(item.ItemTitle || ''),
      qoo10SellingPrice: String(item.Price || ''),
      qoo10SellerCode: sellerCode,
      pkType,
    };
  });

  console.log('');
  console.log('[import] PK 결정 결과:');
  for (const r of importRows) {
    console.log(`  [${r.pkType}] vendorItemId=${r.vendorItemId} | qoo10ItemId=${r.qoo10ItemId} | title=${r.ItemTitle.slice(0, 40)}`);
  }
  console.log('');

  if (DRY_RUN) {
    console.log(`[import] DRY-RUN: ${importRows.length}개 upsert 대상 (시트 write skip)`);
    return;
  }

  // ── 2. 시트 현재 상태 읽기 (vendorItemId로 중복 검사용) ──────────────────
  const sheets = await getSheetsClient();

  const sheetRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!A:A`,
  });
  const existingCol = sheetRes.data.values || [];
  // 1-based 행 번호 → vendorItemId 맵
  const existingMap = new Map(); // vendorItemId → sheetRowNum
  for (let i = 1; i < existingCol.length; i++) {
    const val = (existingCol[i] || [])[0] || '';
    if (val) existingMap.set(val, i + 1);
  }

  const nowISO = new Date().toISOString();
  const headers = COUPANG_DATA_HEADERS;

  // 컬럼 인덱스 (헤더 기준)
  const idx = (name) => headers.indexOf(name);

  let upsertCount = 0;
  let appendCount = 0;

  for (const r of importRows) {
    // 역수입 시 채울 필드만 정의 — 나머지는 빈값
    const fieldMap = {
      vendorItemId:        r.vendorItemId,
      qoo10ItemId:         r.qoo10ItemId,
      ItemTitle:           r.ItemTitle,
      qoo10SellingPrice:   r.qoo10SellingPrice,
      qoo10SellerCode:     r.qoo10SellerCode,
      status:              'LIVE',
      registrationMode:    'REAL',
      registrationStatus:  'SUCCESS',
      registrationMessage: '[imported=qoo10_native]',
      updatedAt:           nowISO,
    };

    const existingRowNum = existingMap.get(r.vendorItemId);

    if (existingRowNum) {
      // 기존 행 업데이트
      const updateData = Object.entries(fieldMap).map(([field, value]) => ({
        range: `${TAB}!${colLetter(idx(field))}${existingRowNum}`,
        values: [[value]],
      }));

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { valueInputOption: 'RAW', data: updateData },
      });
      console.log(`[import] UPDATE vendorItemId=${r.vendorItemId} (행 ${existingRowNum})`);
      upsertCount++;
    } else {
      // 새 행 append — 전체 헤더 컬럼 수만큼 빈 배열 생성 후 필드 채우기
      const newRow = new Array(headers.length).fill('');
      for (const [field, value] of Object.entries(fieldMap)) {
        const colIdx = idx(field);
        if (colIdx !== -1) newRow[colIdx] = value;
      }

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${TAB}!A:A`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [newRow] },
      });
      console.log(`[import] APPEND vendorItemId=${r.vendorItemId}`);
      appendCount++;
    }
  }

  console.log('');
  console.log(`[import] 완료: UPDATE ${upsertCount}개, APPEND ${appendCount}개`);
  console.log('');
  console.log('▶ 다음 단계: changeFlags=REFRESH + needsUpdate=YES 설정 후 npm run qoo10:auto-register');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[import] 치명적 오류:', err.message);
    process.exit(1);
  });
