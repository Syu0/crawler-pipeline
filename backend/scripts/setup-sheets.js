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

const { getSheetsClient, ensureSheet } = require('../coupang/sheetsClient');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

async function main() {
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
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${TITLE}!A:A`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [
            [
              'FILTER_PRICE_KRW_MAX',
              '150000',
              '관세 면제 기준 최대가 (KRW). 환율·배송비 기준 변경 시 수정',
            ],
            [
              'EXCLUDED_CATEGORY_KEYWORDS',
              '의약품,건강,건강식품,화장품,뷰티,미용,전자제품,디지털,가전',
              '쉼표 구분. 카테고리명에 포함 시 수집 제외',
            ],
          ],
        },
      });
      console.log(`[${TITLE}] 시트 생성 및 초기값 삽입 완료`);
    } else {
      console.log(`[${TITLE}] 시트 이미 존재 — 건드리지 않음`);
    }
  }

  console.log('\n완료.');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
