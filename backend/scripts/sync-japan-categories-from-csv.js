/**
 * sync-japan-categories-from-csv.js
 *
 * Qoo10_CategoryInfo.csv (한국어) → japan_categories 시트 동기화
 *
 * 사용법:
 *   node backend/scripts/sync-japan-categories-from-csv.js --dry-run
 *   node backend/scripts/sync-japan-categories-from-csv.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { getSheetsClient } = require('../coupang/sheetsClient');

const CSV_PATH = path.resolve(__dirname, '../../Qoo10_CategoryInfo.csv');
const DRY_RUN = process.argv.includes('--dry-run');
const TAB_NAME = 'japan_categories';

const HEADERS = [
  'jpCategoryId',
  'parentJpCategoryId',
  'depth',
  'name',
  'fullPath',
  'sortOrder',
  'isLeaf',
  'updatedAt'
];

// ── CSV 파싱 ──────────────────────────────────────────────────────────────────

function splitCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

function parseCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  // Strip UTF-8 BOM
  const content = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;

  const lines = content.split('\n').filter(l => l.trim());
  const headers = splitCsvLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());

  return lines.slice(1).map(line => {
    const cols = splitCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cols[i] || '').replace(/^"|"$/g, '').trim(); });
    return obj;
  }).filter(r => r['소카테고리 코드'] || r['중카테고리 코드']);
}

// ── 카테고리 행 빌드 ──────────────────────────────────────────────────────────

function buildCategoryRows(csvRows) {
  const seen = new Set();
  const categories = [];
  const now = new Date().toISOString();

  for (const row of csvRows) {
    const leafCode = row['소카테고리 코드'];
    const midCode  = row['중카테고리 코드'];
    const topCode  = row['대카테고리 코드'];

    // depth=3 소카테고리 (leaf) — 먼저 추가
    if (leafCode && !seen.has(leafCode)) {
      seen.add(leafCode);
      categories.push({
        jpCategoryId: leafCode,
        parentJpCategoryId: midCode || topCode,
        depth: 3,
        name: row['소카테고리 명'],
        fullPath: [row['대카테고리 명'], row['중카테고리 명'], row['소카테고리 명']].filter(Boolean).join(' > '),
        sortOrder: '',
        isLeaf: true,   // resolver.js: obj.isLeaf === 'true' || obj.isLeaf === true
        updatedAt: now
      });
    }

    // depth=2 중카테고리
    if (midCode && !seen.has(midCode)) {
      seen.add(midCode);
      categories.push({
        jpCategoryId: midCode,
        parentJpCategoryId: topCode,
        depth: 2,
        name: row['중카테고리 명'],
        fullPath: [row['대카테고리 명'], row['중카테고리 명']].filter(Boolean).join(' > '),
        sortOrder: '',
        isLeaf: false,
        updatedAt: now
      });
    }

    // depth=1 대카테고리
    if (topCode && !seen.has(topCode)) {
      seen.add(topCode);
      categories.push({
        jpCategoryId: topCode,
        parentJpCategoryId: '',
        depth: 1,
        name: row['대카테고리 명'],
        fullPath: row['대카테고리 명'],
        sortOrder: '',
        isLeaf: false,
        updatedAt: now
      });
    }
  }

  return categories;
}

// ── 시트 Write ────────────────────────────────────────────────────────────────

async function ensureSheetTab(sheets, sheetId, tabName) {
  try {
    await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${tabName}!A1` });
  } catch (err) {
    if (err.message && err.message.includes('Unable to parse range')) {
      console.log(`[sync-csv] Creating sheet tab: ${tabName}`);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] }
      });
    } else {
      throw err;
    }
  }
}

async function writeToSheet(categories) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error('GOOGLE_SHEET_ID not set in backend/.env');

  const sheets = await getSheetsClient();
  await ensureSheetTab(sheets, sheetId, TAB_NAME);

  // Clear existing
  await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: `${TAB_NAME}!A:Z` });

  const allValues = [
    HEADERS,
    ...categories.map(row => HEADERS.map(h => {
      const val = row[h];
      if (val === undefined || val === null) return '';
      if (typeof val === 'boolean') return val.toString(); // true → "true"
      return String(val);
    }))
  ];

  console.log(`[sync-csv] Writing ${categories.length} rows to ${TAB_NAME}...`);

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${TAB_NAME}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: allValues }
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n[${new Date().toISOString()}] === sync-japan-categories-from-csv ===`);
  console.log(`  CSV    : ${CSV_PATH}`);
  console.log(`  Mode   : ${DRY_RUN ? 'DRY-RUN' : 'REAL'}`);

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`[sync-csv] ERROR: CSV not found: ${CSV_PATH}`);
    process.exit(1);
  }

  // 1. Parse CSV
  const csvRows = parseCsv(CSV_PATH);
  console.log(`[sync-csv] CSV rows parsed: ${csvRows.length}`);

  // 2. Build category rows
  const categories = buildCategoryRows(csvRows);
  const byDepth = categories.reduce((acc, r) => { acc[r.depth] = (acc[r.depth] || 0) + 1; return acc; }, {});
  console.log(`[sync-csv] Unique categories built: ${categories.length}`);
  console.log(`  depth=1: ${byDepth[1] || 0}  depth=2: ${byDepth[2] || 0}  depth=3: ${byDepth[3] || 0}`);

  if (DRY_RUN) {
    console.log('[sync-csv] DRY-RUN — 첫 5개 샘플:');
    categories.slice(0, 5).forEach(c => console.log(' ', JSON.stringify(c)));
    console.log('[sync-csv] DRY-RUN 완료. 시트 미변경.');
    return;
  }

  // 3. Write to sheet
  await writeToSheet(categories);
  console.log(`[${new Date().toISOString()}] === Done ===`);
}

main().catch(e => { console.error('[sync-csv] FATAL:', e); process.exit(1); });
