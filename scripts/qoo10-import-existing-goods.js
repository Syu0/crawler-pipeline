#!/usr/bin/env node
/**
 * qoo10-import-existing-goods.js
 *
 * Qoo10 엑셀 export 파일을 파싱하여 coupang_datas 시트에 역수입(upsert).
 * (GetAllGoodsInfo API는 ItemTitle을 반환하지 않아 엑셀 방식으로 전환)
 *
 * PK 결정 규칙:
 *   seller_unique_item_id가 숫자로만 구성된 문자열 → vendorItemId = seller_unique_item_id
 *   그 외 (빈값 또는 다른 형식)                    → vendorItemId = "EXT_" + item_number
 *
 * Usage:
 *   node scripts/qoo10-import-existing-goods.js --file=Qoo10_ItemInfo_20260408114140.xlsx
 *   node scripts/qoo10-import-existing-goods.js --file=Qoo10_ItemInfo_20260408114140.xlsx --dry-run
 *   npm run qoo10:import:existing -- --file=Qoo10_ItemInfo_20260408114140.xlsx
 *   npm run qoo10:import:existing:dry -- --file=Qoo10_ItemInfo_20260408114140.xlsx
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') });

const path = require('path');
const XLSX = require('xlsx');
const { getSheetsClient } = require('../backend/coupang/sheetsClient');


const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB = 'coupang_datas';
const DRY_RUN = process.argv.includes('--dry-run');

// --file=path.xlsx 파싱
const fileArg = process.argv.find(a => a.startsWith('--file='));
const FILE_PATH = fileArg ? fileArg.replace('--file=', '') : null;

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
 * 엑셀 파일 파싱 → 상품 행 배열 반환
 * 엑셀 구조:
 *   1행(index 0): 영문 컬럼명 (item_number, seller_unique_item_id, ...)
 *   2~4행(index 1~3): 한국어 설명 / 필수여부 안내 / 상세 안내
 *   5행(index 4)~: 실제 데이터
 */
function parseExcel(filePath) {
  const resolvedPath = path.resolve(filePath);
  console.log(`[import] 엑셀 파일 파싱: ${resolvedPath}`);

  const wb = XLSX.readFile(resolvedPath);
  const ws = wb.Sheets[wb.SheetNames[0]];

  // header: 1 → 모든 행을 배열로 읽음 (헤더 행 포함)
  const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // 0행 = 영문 헤더키, 4행(index 4)부터 실제 데이터
  const headerKeys = rawRows[0];
  const dataArrays = rawRows.slice(4);

  // 배열 → 객체 변환
  const rows = dataArrays.map(arr => {
    const obj = {};
    headerKeys.forEach((key, i) => { obj[key] = arr[i] ?? ''; });
    return obj;
  });

  // item_number가 숫자인 행만 (빈행 제외)
  const data = rows.filter(r =>
    r['item_number'] && /^\d+$/.test(String(r['item_number']).trim())
  );

  console.log(`[import] 엑셀 파싱 완료: ${data.length}개 상품`);
  return data;
}

const CELL_MAX = 49000; // Google Sheets 셀 최대 50000자, 안전 마진 포함

function truncate(val) {
  const s = String(val ?? '');
  return s.length > CELL_MAX ? s.slice(0, CELL_MAX) : s;
}

/**
 * 엑셀 행 → 시트 필드 매핑 + PK 결정
 */
function mapRow(row) {
  const qoo10ItemId = String(row['item_number']).trim();
  const sellerCode  = String(row['seller_unique_item_id'] || '').trim();
  const vendorItemId = /^\d+$/.test(sellerCode) ? sellerCode : `EXT_${qoo10ItemId}`;

  // ExtraImages: $$ 구분 → JSON 배열 문자열
  const extraImages = row['image_other_url']
    ? JSON.stringify(
        String(row['image_other_url']).split('$$').map(u => u.trim()).filter(Boolean)
      )
    : '';

  return {
    vendorItemId,
    qoo10ItemId,
    qoo10SellerCode:     sellerCode,
    jpCategoryIdUsed:    String(row['category_number'] || ''),
    jpTitle:             truncate(row['item_name'] || ''),
    qoo10SellingPrice:   row['price_yen'] ? Number(row['price_yen']) : '',
    OptionsRaw:          truncate(row['option_info'] || ''),
    StandardImage:       truncate(row['image_main_url'] || ''),
    ExtraImages:         truncate(extraImages),
    SearchKeyword:       truncate(row['search_keyword'] || ''),
    WeightKg:            row['item_weight'] ? Number(row['item_weight']) : '',
    // 파생 고정값
    ItemTitle:           '',
    categoryMatchType:   'MANUAL',
    registrationMode:    'REAL',
    registrationStatus:  'SUCCESS',
    registrationMessage: '[imported=qoo10_native]',
    status:              'LIVE',
    updatedAt:           new Date().toISOString(),
    _pkType:             vendorItemId.startsWith('EXT_') ? 'EXT_' : 'coupang',
  };
}

async function main() {
  if (!FILE_PATH) {
    console.error('[import] ERROR: --file 옵션이 필요합니다.');
    console.error('  예: node scripts/qoo10-import-existing-goods.js --file=Qoo10_ItemInfo_20260408114140.xlsx');
    process.exit(1);
  }
  if (!SPREADSHEET_ID) {
    console.error('[import] ERROR: GOOGLE_SHEET_ID가 설정되지 않았습니다.');
    process.exit(1);
  }

  // ── 1. 엑셀 파싱 ────────────────────────────────────────────────────────────
  const rawRows = parseExcel(FILE_PATH);
  if (rawRows.length === 0) {
    console.log('[import] 역수입할 상품이 없습니다. 종료합니다.');
    return;
  }

  const importRows = rawRows.map(mapRow);

  const extCount    = importRows.filter(r => r._pkType === 'EXT_').length;
  const coupangCount = importRows.filter(r => r._pkType === 'coupang').length;
  console.log(`[import] PK 결정 — EXT_ 가상키: ${extCount}개 / 쿠팡 연결: ${coupangCount}개`);

  // dry-run: 목록 출력 후 종료
  if (DRY_RUN) {
    console.log('');
    console.log('[import] DRY-RUN 미리보기 (샘플 최대 10개):');
    for (const r of importRows.slice(0, 10)) {
      console.log(`  [${r._pkType}] vendorItemId=${r.vendorItemId} | qoo10ItemId=${r.qoo10ItemId} | jpTitle=${r.jpTitle.slice(0, 40)}`);
    }
    if (importRows.length > 10) {
      console.log(`  ... 외 ${importRows.length - 10}개`);
    }
    console.log('');
    console.log(`[import] DRY-RUN: ${importRows.length}개 upsert 대상 (시트 write skip)`);
    return;
  }

  // ── 2. 시트 현재 상태 읽기 (헤더 행 + vendorItemId 중복 검사) ─────────────────
  const sheets = await getSheetsClient();

  // 헤더 행 읽기 — 실제 시트 컬럼 순서를 기준으로 사용 (sheetSchema.js와 불일치 방지)
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!1:1`,
  });
  const headers = (headerRes.data.values || [[]])[0];
  if (headers.length === 0) {
    console.error('[import] ERROR: 시트 헤더 행을 읽을 수 없습니다. setup-sheets.js를 먼저 실행하세요.');
    process.exit(1);
  }
  console.log(`[import] 시트 헤더 확인: ${headers.length}개 컬럼`);
  const idx = (name) => headers.indexOf(name);

  const sheetRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!A:A`,
  });
  const existingCol = sheetRes.data.values || [];
  // vendorItemId → 1-based 행 번호
  const existingMap = new Map();
  for (let i = 1; i < existingCol.length; i++) {
    const val = (existingCol[i] || [])[0] || '';
    if (val) existingMap.set(val, i + 1);
  }

  // UPDATE / APPEND 분리
  const updateRows = [];
  const appendNewRows = [];

  for (const r of importRows) {
    const { _pkType, ...fieldMap } = r;
    const existingRowNum = existingMap.get(r.vendorItemId);
    if (existingRowNum) {
      updateRows.push({ fieldMap, existingRowNum, vendorItemId: r.vendorItemId });
    } else {
      const newRow = new Array(headers.length).fill('');
      for (const [field, value] of Object.entries(fieldMap)) {
        const colIdx = idx(field);
        if (colIdx !== -1) newRow[colIdx] = value;
      }
      appendNewRows.push({ newRow, vendorItemId: r.vendorItemId, jpTitle: r.jpTitle });
    }
  }

  console.log(`[import] UPDATE 대상: ${updateRows.length}개, APPEND 대상: ${appendNewRows.length}개`);

  // ── UPDATE: 행별로 batchUpdate (한 번에 한 행, 셀 단위는 묶음) ───────────────
  // Google Sheets 쓰기 쿼터: 60 req/min. 1초 간격으로 처리.
  for (const { fieldMap, existingRowNum, vendorItemId } of updateRows) {
    const updateData = Object.entries(fieldMap)
      .filter(([field]) => idx(field) !== -1)
      .map(([field, value]) => ({
        range: `${TAB}!${colLetter(idx(field))}${existingRowNum}`,
        values: [[value]],
      }));

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'RAW', data: updateData },
    });
    console.log(`[import] UPDATE vendorItemId=${vendorItemId} (행 ${existingRowNum})`);
    await new Promise(r => setTimeout(r, 1100)); // 쿼터 방지
  }

  // ── APPEND: 전체를 한 번의 API 호출로 처리 ──────────────────────────────────
  if (appendNewRows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TAB}!A:A`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: appendNewRows.map(r => r.newRow) },
    });
    for (const r of appendNewRows) {
      console.log(`[import] APPEND vendorItemId=${r.vendorItemId} | ${r.jpTitle.slice(0, 40)}`);
    }
  }

  console.log('');
  console.log(`[import] 시트 upsert 완료: ${importRows.length}개`);
  console.log(`         UPDATE ${updateRows.length}개, APPEND ${appendNewRows.length}개`);
  console.log('');
  console.log('▶ 다음 단계: npm run qoo10:translate:titles:dry');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[import] 치명적 오류:', err.message);
    process.exit(1);
  });
