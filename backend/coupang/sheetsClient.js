/**
 * Google Sheets Client
 * Uses Service Account authentication to read/write Google Sheets
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { google } = require('googleapis');
const { COUPANG_DATA_HEADERS } = require('./sheetSchema');
const fs = require('fs');
const path = require('path');

/**
 * Get authenticated Google Sheets client
 */
async function getSheetsClient() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
  
  if (!keyPath) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON_PATH not set in backend/.env');
  }
  
  const absolutePath = path.resolve(process.cwd(), keyPath);
  
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Service account key file not found: ${absolutePath}\n` +
      'Please place your Google service account JSON key at this path.\n' +
      'See docs/RUNBOOK.md for setup instructions.');
  }
  
  const auth = new google.auth.GoogleAuth({
    keyFile: absolutePath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  
  const sheets = google.sheets({ version: 'v4', auth });
  return sheets;
}

/**
 * Ensure header row exists in the sheet
 * If sheet exists with headers, append any missing headers at the end
 * @param {string} sheetId - Google Sheet ID
 * @param {string} tabName - Tab/sheet name
 * @param {string[]} headers - Array of header names
 */
async function ensureHeaders(sheetId, tabName, headers) {
  const sheets = await getSheetsClient();
  
  // Read first row with wide range to capture all existing headers
  const readRange = `${tabName}!A1:ZZ1`;
  let existingHeaders = [];
  
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: readRange,
    });
    existingHeaders = response.data.values?.[0] || [];
  } catch (err) {
    // Tab might not exist or be empty
    if (err.message.includes('Unable to parse range')) {
      console.log(`[Sheets] Tab "${tabName}" may not exist. Will create headers.`);
    } else {
      throw err;
    }
  }
  
  // If headers are empty, write all headers using fixed range
  if (existingHeaders.length === 0) {
    console.log(`[Sheets] Writing ${headers.length} headers to ${tabName}...`);
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tabName}!A1:ZZ1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [headers],
      },
    });
    return headers;
  }
  
  // Check for missing headers
  const missingHeaders = headers.filter(h => !existingHeaders.includes(h));
  
  if (missingHeaders.length > 0) {
    // Build complete header row: existing + missing
    const allHeaders = [...existingHeaders, ...missingHeaders];
    
    console.log(`[Sheets] Extending headers: adding ${missingHeaders.length} columns (${missingHeaders.join(', ')})`);
    console.log(`[Sheets] Total headers: ${existingHeaders.length} existing + ${missingHeaders.length} new = ${allHeaders.length}`);
    console.log(`[Sheets] Updating headers with range ${tabName}!A1:ZZ1`);
    
    // Write entire header row using safe fixed range (avoids column letter calculation issues)
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tabName}!A1:ZZ1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [allHeaders],
      },
    });
    
    return allHeaders;
  }
  
  return existingHeaders;
}

/**
 * Find row index by primary key value
 * @param {string} sheetId - Google Sheet ID
 * @param {string} tabName - Tab/sheet name
 * @param {number} keyColumnIndex - 0-based column index for primary key
 * @param {string} keyValue - Value to search for
 * @returns {number|null} - Row number (1-based) or null if not found
 */
async function findRowByKey(sheetId, tabName, keyColumnIndex, keyValue) {
  const sheets = await getSheetsClient();
  
  // Get all values in the key column
  const columnLetter = String.fromCharCode(65 + keyColumnIndex); // A=0, B=1, etc.
  const range = `${tabName}!${columnLetter}:${columnLetter}`;
  
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range,
    });
    
    const values = response.data.values || [];
    
    for (let i = 0; i < values.length; i++) {
      if (values[i][0] === keyValue) {
        return i + 1; // 1-based row number
      }
    }
  } catch (err) {
    console.error('Error finding row by key:', err.message);
  }
  
  return null;
}

/**
 * Get full row data by row number
 * @param {string} sheetId - Google Sheet ID
 * @param {string} tabName - Tab/sheet name
 * @param {number} rowNumber - 1-based row number
 * @param {string[]} headers - Header names to map values
 * @returns {Promise<object|null>} Row data object or null
 */
async function getRowData(sheetId, tabName, rowNumber, headers) {
  const sheets = await getSheetsClient();
  
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${tabName}!A${rowNumber}:ZZ${rowNumber}`,
    });
    
    const values = response.data.values?.[0] || [];
    const rowData = {};
    
    headers.forEach((header, idx) => {
      rowData[header] = values[idx] || '';
    });
    
    return rowData;
  } catch (err) {
    console.error('Error getting row data:', err.message);
    return null;
  }
}

/**
 * Upsert a row into the sheet
 * @param {string} sheetId - Google Sheet ID
 * @param {string} tabName - Tab/sheet name
 * @param {string[]} headers - Header names (for column order)
 * @param {Object} data - Data object with keys matching headers
 * @param {string} primaryKey - Header name to use as primary key
 * @param {string} [fallbackKey] - Fallback header name if primary key is empty
 * @param {string[]} [preserveColumns] - Columns to preserve from existing row (don't overwrite if new is empty)
 * @returns {Promise<{action: string, row: number, existingData: object|null}>}
 */
async function upsertRow(sheetId, tabName, headers, data, primaryKey, fallbackKey = null, preserveColumns = []) {
  const sheets = await getSheetsClient();

  // Determine key value
  let keyValue = data[primaryKey];
  let keyColumn = primaryKey;

  if (!keyValue && fallbackKey) {
    keyValue = data[fallbackKey];
    keyColumn = fallbackKey;
  }

  if (!keyValue) {
    throw new Error(`Cannot upsert: both ${primaryKey} and ${fallbackKey || 'fallback'} are empty`);
  }

  // Always use actual sheet column order — caller's `headers` may be a subset or
  // in a different order than the live sheet (e.g. after columns were added later).
  // ensureHeaders adds any missing columns from `headers` and returns the full list.
  const actualHeaders = await ensureHeaders(sheetId, tabName, headers);

  // Find column index for the key in actual sheet headers
  const keyColumnIndex = actualHeaders.indexOf(keyColumn);
  if (keyColumnIndex === -1) {
    throw new Error(`Key column "${keyColumn}" not found in headers`);
  }

  // Find existing row
  const existingRowNum = await findRowByKey(sheetId, tabName, keyColumnIndex, keyValue);
  let existingData = null;

  // If row exists, read full row using actual headers so field mapping is correct
  if (existingRowNum && existingRowNum > 1) {
    existingData = await getRowData(sheetId, tabName, existingRowNum, actualHeaders);
  }

  // Merge: existing data as base, new data overrides.
  // Columns not present in `data` are preserved from the existing row automatically.
  const mergedData = existingData ? { ...existingData, ...data } : { ...data };

  // preserveColumns: extra guard — keep existing value when new data is explicitly empty
  if (existingData && preserveColumns.length > 0) {
    for (const col of preserveColumns) {
      if (existingData[col] && (data[col] === undefined || data[col] === '' || data[col] === null)) {
        mergedData[col] = existingData[col];
      }
    }
  }

  // Build row values in actual sheet column order
  const rowValues = actualHeaders.map(h => {
    const val = mergedData[h];
    if (val === undefined || val === null) return '';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  });

  if (existingRowNum && existingRowNum > 1) {
    // Update existing row with fixed-width range to avoid column growth issues
    const updateRange = `${tabName}!A${existingRowNum}:ZZ${existingRowNum}`;
    console.log(`[Sheets] Updating row ${existingRowNum} using range ${updateRange} (headers=${actualHeaders.length})`);

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: updateRange,
      valueInputOption: 'RAW',
      requestBody: {
        values: [rowValues],
      },
    });
    return { action: 'updated', row: existingRowNum, existingData };
  } else {
    // Append new row
    console.log(`[Sheets] Appending new row for ${keyColumn}=${keyValue} (headers=${actualHeaders.length})`);
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${tabName}!A:A`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [rowValues],
      },
    });

    // Extract appended row number from response
    const updatedRange = response.data.updates?.updatedRange || '';
    const match = updatedRange.match(/!A(\d+)/);
    const appendedRow = match ? parseInt(match[1], 10) : null;

    return { action: 'appended', row: appendedRow, existingData: null };
  }
}

module.exports = {
  getSheetsClient,
  ensureHeaders,
  findRowByKey,
  getRowData,
  upsertRow,
};

// ─────────────────────────────────────────────────────────────────────────────
// 키워드 탐색 파이프라인 전용 함수
// ─────────────────────────────────────────────────────────────────────────────

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

/**
 * 시트가 없으면 생성 + 헤더 write. 이미 존재하면 아무것도 하지 않음 (idempotent).
 *
 * @param {object} sheets         - googleapis sheets 클라이언트
 * @param {string} spreadsheetId
 * @param {string} title          - 시트(탭) 이름
 * @param {string[]} headers      - 헤더 컬럼 배열
 * @returns {Promise<'created'|'exists'>}
 */
async function ensureSheet(sheets, spreadsheetId, title, headers) {
  // 현재 시트 목록 조회
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some(
    (s) => s.properties.title === title
  );

  if (exists) return 'exists';

  // 시트 생성
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }],
    },
  });

  // 헤더 write
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${title}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers] },
  });

  return 'created';
}

/**
 * `config` 시트 전체를 key-value 객체로 반환.
 * 컬럼 구조: key | value | memo  (1행 = 헤더)
 *
 * 특수 파싱:
 *   FILTER_PRICE_KRW_MAX          → Number
 *   EXCLUDED_CATEGORY_KEYWORDS    → 콤마 split 후 trim 배열
 *
 * @param {object} sheets
 * @param {string} spreadsheetId
 * @returns {Promise<Object>}
 */
async function getConfig(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'config!A:C',
  });

  const rows = res.data.values || [];
  const config = {};

  // 1행은 헤더 skip
  for (let i = 1; i < rows.length; i++) {
    const [key, value] = rows[i];
    if (!key) continue;

    if (key === 'FILTER_PRICE_KRW_MAX') {
      config[key] = Number(value) || 150000;
    } else if (key === 'EXCLUDED_CATEGORY_KEYWORDS') {
      config[key] = (value || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      config[key] = value || '';
    }
  }

  return config;
}

/**
 * `keywords` 시트에서 status='ACTIVE'인 행만 반환.
 * 컬럼 구조: keyword | status | lastRunAt | memo  (1행 = 헤더)
 *
 * @param {object} sheets
 * @param {string} spreadsheetId
 * @returns {Promise<Array<{row: number, keyword: string, status: string, lastRunAt: string, memo: string}>>}
 */
async function getActiveKeywords(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'keywords!A:D',
  });

  const rows = res.data.values || [];
  const result = [];

  // 1행은 헤더 skip
  for (let i = 1; i < rows.length; i++) {
    const [keyword, status, lastRunAt, memo] = rows[i];
    if (status === 'ACTIVE' && keyword) {
      result.push({
        row: i + 1, // 1-based 시트 행 번호
        keyword,
        status,
        lastRunAt: lastRunAt || '',
        memo: memo || '',
      });
    }
  }

  return result;
}

/**
 * `keywords` 시트 해당 행의 lastRunAt 컬럼(C열)을 현재 시각으로 업데이트.
 *
 * @param {object} sheets
 * @param {string} spreadsheetId
 * @param {number} rowIndex - 1-based 시트 행 번호
 */
async function updateKeywordLastRun(sheets, spreadsheetId, rowIndex) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `keywords!C${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[new Date().toISOString()]] },
  });
}

/**
 * `coupang_datas` 시트에 DISCOVERED 상태로 items를 upsert.
 * vendorItemId가 이미 존재하는 행은 skip (상태 변경 금지).
 *
 * @param {object} sheets
 * @param {string} spreadsheetId
 * @param {Object[]} items - keywordSearch.js 파싱 결과 배열
 * @returns {Promise<{upserted: number, skipped: number}>}
 */
async function upsertDiscoveredProducts(sheets, spreadsheetId, items) {
  const TAB = 'coupang_datas';

  // 헤더 보장 + 실제 시트 헤더 순서 가져오기
  // ensureHeaders 반환값이 실제 열 순서 — 이것을 기준으로 row 배열 빌드
  const actualHeaders = await ensureHeaders(spreadsheetId, TAB, COUPANG_DATA_HEADERS);

  // 현재 vendorItemId 컬럼 전체 로드 → 중복 체크용 Set
  const colRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${TAB}!A:A`,
  });
  const existingIds = new Set(
    (colRes.data.values || []).flat().filter(Boolean)
  );

  let upserted = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  function valueFor(h, item) {
    switch (h) {
      case 'vendorItemId':        return item.vendorItemId || '';
      case 'itemId':              return item.itemId || '';
      case 'coupang_product_id':  return item.productId || '';
      case 'categoryId':          return item.categoryId || '';
      case 'ProductURL':          return item.productUrl || '';
      case 'ItemTitle':           return item.itemTitle || '';
      case 'ItemPrice':           return item.itemPrice != null ? String(item.itemPrice) : '';
      case 'StandardImage':       return item.thumbnailImage || '';
      case 'ExtraImages':         return '';
      case 'WeightKg':            return '';
      case 'Options':             return '';
      case 'ItemDescriptionText': return '';
      case 'updatedAt':           return now;
      case 'status':              return 'DISCOVERED';
      default:                    return '';
    }
  }

  for (const item of items) {
    const key = item.vendorItemId || item.itemId;
    if (!key || existingIds.has(key)) {
      skipped++;
      continue;
    }

    // 실제 시트 헤더 순서대로 row 빌드 → 컬럼 위치 불일치 방지
    const row = actualHeaders.map((h) => valueFor(h, item));

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${TAB}!A:A`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    existingIds.add(key); // 같은 실행 내 중복 방지
    upserted++;
  }

  return { upserted, skipped };
}

/**
 * `coupang_datas` 시트에서 status='DISCOVERED' 인 행만 반환.
 * ProductURL 없는 행은 skip.
 *
 * @param {object} sheets
 * @param {string} spreadsheetId
 * @returns {Promise<Array<{row: number, vendorItemId: string, itemId: string, productUrl: string}>>}
 */
async function getDiscoveredProducts(sheets, spreadsheetId) {
  const TAB = 'coupang_datas';
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${TAB}!A:ZZ`,
  });

  const rows = res.data.values || [];
  if (rows.length < 2) return [];

  const headers = rows[0];
  const statusIdx = headers.indexOf('status');
  const vendorItemIdIdx = headers.indexOf('vendorItemId');
  const itemIdIdx = headers.indexOf('itemId');
  const productUrlIdx = headers.indexOf('ProductURL');

  const result = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const status = row[statusIdx] || '';
    if (status !== 'DISCOVERED') continue;

    const productUrl = row[productUrlIdx] || '';
    if (!productUrl) {
      console.log(`  [skip] 행 ${i + 1}: ProductURL 없음`);
      continue;
    }

    result.push({
      row: i + 1,
      vendorItemId: row[vendorItemIdIdx] || '',
      itemId: row[itemIdIdx] || '',
      productUrl,
    });
  }

  return result;
}

Object.assign(module.exports, {
  ensureSheet,
  getConfig,
  getActiveKeywords,
  updateKeywordLastRun,
  upsertDiscoveredProducts,
  getDiscoveredProducts,
});
