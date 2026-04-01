#!/usr/bin/env node
/**
 * setup-sheets.js — Google Sheets 초기 구조 설정
 *
 * 실행 결과: `keywords` / `config` 시트가 없으면 생성 + 초기값 삽입.
 * 이미 존재하면 건드리지 않음 (idempotent).
 *
 * Usage:
 *   node backend/scripts/setup-sheets.js
 *   npm run sheets:setup
 */

'use strict';

require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
});

const { getSheetsClient, ensureSheet, ensureHeaders } = require('../coupang/sheetsClient');
const { COUPANG_DATA_HEADERS, HEADER_GROUPS } = require('../coupang/sheetSchema');

async function getSheetNumericId(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets.find((s) => s.properties.title === title);
  return sheet ? sheet.properties.sheetId : null;
}

async function applyHeaderGroupColors(sheets, spreadsheetId, tabName, headerGroups) {
  const sheetId = await getSheetNumericId(sheets, spreadsheetId, tabName);
  if (sheetId === null) {
    console.log(`[${tabName}] 시트를 찾을 수 없어 배경색 적용 건너뜀`);
    return;
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: headerGroups.map((group) => ({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: group.start,
            endColumnIndex: group.end + 1,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: group.color,
              textFormat: { bold: true },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat)',
        },
      })),
    },
  });
  console.log(`[${tabName}] 헤더 그룹 배경색 적용 완료`);
}

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

// config 시트에 추가할 기본값 목록 (누락된 키만 append)
const CONFIG_DEFAULTS = [
  {
    key: 'FILTER_PRICE_KRW_MAX',
    value: '150000',
    memo: '관세 면제 기준 최대가 (KRW). 환율·배송비 기준 변경 시 수정',
  },
  {
    key: 'EXCLUDED_CATEGORY_KEYWORDS',
    value: '의약품,건강,건강식품,화장품,뷰티,미용,전자제품,디지털,가전',
    memo: '쉼표 구분. 카테고리명에 포함 시 수집 제외',
  },
  {
    key: 'MAX_DAILY_REGISTER',
    value: '10',
    memo: '1회 promote 실행당 PENDING_APPROVAL로 올릴 최대 상품 수',
  },
  {
    key: 'MAX_DISCOVER_PAGES',
    value: '1',
    memo: '키워드 탐색 시 쿠팡 검색 페이지 수 (기본 1, 최대 5)',
  },
  {
    key: 'MAX_COLLECT_PER_SESSION',
    value: '10',
    memo: '1회 수집 세션당 최대 처리 상품 수. Akamai 점수 누적 방지.',
  },
  {
    key: 'MAX_COLLECT_PER_DAY',
    value: '10',
    memo: '하루 최대 수집 상품 수 (안전장치 — 이 값 초과 불가)',
  },
];

async function main() {
  const forceDefaults = process.argv.includes('--force-defaults');

  if (!SPREADSHEET_ID) {
    console.error('Error: GOOGLE_SHEET_ID not set in backend/.env');
    process.exit(1);
  }

  const sheets = await getSheetsClient();

  console.log('='.repeat(50));
  console.log('Google Sheets 초기 구조 설정');
  console.log('='.repeat(50));
  console.log(`Spreadsheet ID: ${SPREADSHEET_ID}\n`);

  // ── 1. keywords 시트 ──────────────────────────────────────────────────────
  {
    const TITLE = 'keywords';
    const HEADERS = ['keyword', 'status', 'lastRunAt', 'memo'];
    const result = await ensureSheet(sheets, SPREADSHEET_ID, TITLE, HEADERS);

    if (result === 'created') {
      // 샘플 행 삽입
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${TITLE}!A:A`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [['텀블러', 'ACTIVE', '', '테스트용 샘플 키워드']],
        },
      });
      console.log(`[${TITLE}] 시트 생성 및 초기값 삽입 완료`);
    } else {
      console.log(`[${TITLE}] 시트 이미 존재 — 건드리지 않음`);
    }
  }

  // ── 2. config 시트 ────────────────────────────────────────────────────────
  {
    const TITLE = 'config';
    const HEADERS = ['key', 'value', 'memo'];
    const result = await ensureSheet(sheets, SPREADSHEET_ID, TITLE, HEADERS);

    if (result === 'created') {
      // 신규 생성: 기본값 전체 삽입
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${TITLE}!A:A`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: CONFIG_DEFAULTS.map((d) => [d.key, d.value, d.memo]),
        },
      });
      console.log(`[${TITLE}] 시트 생성 및 초기값 삽입 완료`);
    } else if (forceDefaults) {
      // --force-defaults: 기존 키는 덮어쓰고, 없는 키는 append
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${TITLE}!A:C`,
      });
      const rows = res.data.values || [];
      const existingKeys = rows.slice(1).map((r) => r[0]).filter(Boolean);

      for (const def of CONFIG_DEFAULTS) {
        const rowIdx = rows.findIndex((r, i) => i > 0 && r[0] === def.key);
        if (rowIdx !== -1) {
          // 시트 행 번호 = rowIdx + 1 (1-based)
          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${TITLE}!A${rowIdx + 1}:C${rowIdx + 1}`,
            valueInputOption: 'RAW',
            requestBody: { values: [[def.key, def.value, def.memo]] },
          });
          console.log(`[${TITLE}] ${def.key} 덮어씀 (--force-defaults)`);
        } else {
          await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${TITLE}!A:A`,
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: [[def.key, def.value, def.memo]] },
          });
          console.log(`[${TITLE}] ${def.key} 추가`);
        }
      }
      void existingKeys; // suppress lint
    } else {
      // 기본: 누락된 키만 추가, 기존 값 유지
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${TITLE}!A:C`,
      });
      const rows = res.data.values || [];
      const existingKeys = new Set(rows.slice(1).map((r) => r[0]).filter(Boolean));
      const missing = CONFIG_DEFAULTS.filter((d) => !existingKeys.has(d.key));

      if (missing.length > 0) {
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${TITLE}!A:A`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: missing.map((d) => [d.key, d.value, d.memo]) },
        });
        console.log(`[${TITLE}] 누락 키 추가: ${missing.map((d) => d.key).join(', ')}`);
      } else {
        console.log(`[${TITLE}] 시트 이미 존재 — 모든 키 확인 완료`);
      }
    }
  }

  // ── 3. change_flags 시트 ─────────────────────────────────────────────────
  {
    const TITLE = 'change_flags';
    const HEADERS = ['flag', '동작', '사용API', '비용'];
    const result = await ensureSheet(sheets, SPREADSHEET_ID, TITLE, HEADERS);

    if (result === 'created') {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${TITLE}!A:A`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [
            ['', 'SYNC와 동일 (기본값)', 'Qoo10 QAPI', '무료'],
            ['SYNC', 'PRICE + IMAGE + CATEGORY 전체 갱신', 'Qoo10 QAPI', '무료'],
            ['ALL', 'SYNC + TITLE + DESC 전체 갱신', 'Qoo10 QAPI + OpenRouter', '유료 포함'],
            ['PRICE', '가격 재계산 후 업데이트', 'Qoo10 SetGoodsPriceQty', '무료'],
            ['IMAGE', '대표이미지 + 슬라이더 이미지 업데이트', 'Qoo10 EditGoodsImage / EditGoodsMultiImage', '무료'],
            ['CATEGORY', '카테고리 재매핑 후 UpdateGoods 호출', 'Qoo10 UpdateGoods', '무료'],
            ['TITLE', '일본어 타이틀 재번역 + 업데이트', 'OpenRouter + Qoo10 UpdateGoods', '유료'],
            ['DESC', '일본어 상세페이지 재생성 + 반영', 'OpenRouter + Qoo10 EditGoodsContents', '유료'],
          ],
        },
      });
      console.log(`[${TITLE}] 시트 생성 및 초기값 삽입 완료`);

      // 헤더 배경색 적용
      const sheetId = await getSheetNumericId(sheets, SPREADSHEET_ID, TITLE);
      if (sheetId !== null) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            requests: [{
              repeatCell: {
                range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 4 },
                cell: { userEnteredFormat: { backgroundColor: { red: 0.6, green: 0.8, blue: 1.0 }, textFormat: { bold: true } } },
                fields: 'userEnteredFormat(backgroundColor,textFormat)',
              },
            }],
          },
        });
      }
    } else {
      console.log(`[${TITLE}] 시트 이미 존재 — 건드리지 않음`);
    }
  }

  // ── 4. coupang_datas 시트 ─────────────────────────────────────────────────
  {
    const TITLE = 'coupang_datas';
    const result = await ensureSheet(sheets, SPREADSHEET_ID, TITLE, COUPANG_DATA_HEADERS);

    if (result === 'created') {
      console.log(`[${TITLE}] 시트 생성 완료`);
    } else {
      // 이미 존재하면 누락 컬럼만 오른쪽에 append — 기존 순서 절대 변경 금지
      // (헤더 전체 덮어쓰기 시 데이터 행과 컬럼 위치 불일치 발생)
      const actual = await ensureHeaders(SPREADSHEET_ID, TITLE, COUPANG_DATA_HEADERS);
      console.log(`[${TITLE}] 헤더 확인 완료 (총 ${actual.length}컬럼)`);
    }

    await applyHeaderGroupColors(sheets, SPREADSHEET_ID, TITLE, HEADER_GROUPS);
  }

  console.log('\n완료.');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
