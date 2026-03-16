/**
 * sync-categories-from-csv.js
 *
 * Parses Qoo10_CategoryInfo.csv (Korean category names, 3 levels)
 * and overwrites the japan_categories sheet with Korean fullPath.
 *
 * CSV columns: 대카테고리 코드, 대카테고리 명, 중카테고리 코드, 중카테고리 명, 소카테고리 코드, 소카테고리 명
 *
 * Each CSV row (leaf) generates up to 3 sheet rows:
 *   depth=1 (대), depth=2 (중), depth=3 (소, isLeaf=true)
 * Deduplication by jpCategoryId.
 *
 * Usage:
 *   node backend/scripts/sync-categories-from-csv.js [--csv path/to/Qoo10_CategoryInfo.csv] [--dry-run]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { getSheetsClient } = require('../coupang/sheetsClient');

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

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const csvIdx = args.indexOf('--csv');
const csvPath = csvIdx !== -1
  ? path.resolve(args[csvIdx + 1])
  : path.resolve(__dirname, '..', '..', 'Qoo10_CategoryInfo.csv');

// ── CSV parser ───────────────────────────────────────────────────────────────

/**
 * Parse a single CSV line, handling quoted fields.
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parse CSV file → flat array of category rows for the sheet.
 * Deduplicates by jpCategoryId (first occurrence wins).
 *
 * @param {string} filePath
 * @returns {Array<object>}
 */
function parseCsvToRows(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  // Strip BOM if present
  const content = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;

  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error('CSV is empty or has only headers');

  // Validate headers
  const headerFields = parseCsvLine(lines[0]);
  if (headerFields.length < 6) {
    throw new Error(`Expected 6 CSV columns, got ${headerFields.length}: ${headerFields.join(', ')}`);
  }

  const now = new Date().toISOString();
  const seen = new Set(); // dedup by jpCategoryId
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length < 6) continue;

    const [largeCd, largeNm, midCd, midNm, leafCd, leafNm] = fields;
    if (!largeCd || !largeNm) continue;

    // depth=1 대카테고리
    if (!seen.has(largeCd)) {
      seen.add(largeCd);
      rows.push({
        jpCategoryId: largeCd,
        parentJpCategoryId: '',
        depth: 1,
        name: largeNm,
        fullPath: largeNm,
        sortOrder: '',
        isLeaf: false,
        updatedAt: now
      });
    }

    // depth=2 중카테고리
    if (midCd && midNm && !seen.has(midCd)) {
      seen.add(midCd);
      rows.push({
        jpCategoryId: midCd,
        parentJpCategoryId: largeCd,
        depth: 2,
        name: midNm,
        fullPath: `${largeNm} > ${midNm}`,
        sortOrder: '',
        isLeaf: false,
        updatedAt: now
      });
    }

    // depth=3 소카테고리 (leaf)
    if (leafCd && leafNm && !seen.has(leafCd)) {
      seen.add(leafCd);
      rows.push({
        jpCategoryId: leafCd,
        parentJpCategoryId: midCd || largeCd,
        depth: 3,
        name: leafNm,
        fullPath: midNm
          ? `${largeNm} > ${midNm} > ${leafNm}`
          : `${largeNm} > ${leafNm}`,
        sortOrder: '',
        isLeaf: true,
        updatedAt: now
      });
    }
  }

  return rows;
}

// ── Sheets helpers ────────────────────────────────────────────────────────────

async function ensureSheetTab(sheets, sheetId, tabName) {
  try {
    await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${tabName}!A1`,
    });
  } catch (err) {
    if (err.message && err.message.includes('Unable to parse range')) {
      console.log(`[sync-csv] Creating sheet tab: ${tabName}`);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: tabName } } }]
        }
      });
    } else {
      throw err;
    }
  }
}

async function writeToSheet(sheets, sheetId, tabName, rows) {
  // Clear existing content
  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: `${tabName}!A:Z`,
  });

  const allValues = [
    HEADERS,
    ...rows.map(row => HEADERS.map(h => {
      const val = row[h];
      if (val === undefined || val === null) return '';
      if (typeof val === 'boolean') return val.toString();
      return String(val);
    }))
  ];

  console.log(`[sync-csv] Writing ${allValues.length} rows (1 header + ${rows.length} data) to ${tabName}`);

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${tabName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: allValues },
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n[${new Date().toISOString()}] === sync-categories-from-csv ===`);
  console.log(`  CSV : ${csvPath}`);
  console.log(`  Mode: ${dryRun ? 'DRY-RUN' : 'REAL'}`);

  // 1. Parse CSV
  if (!fs.existsSync(csvPath)) {
    console.error(`[sync-csv] ERROR: CSV not found: ${csvPath}`);
    process.exit(1);
  }

  const rows = parseCsvToRows(csvPath);

  // Summary
  const byDepth = { 1: 0, 2: 0, 3: 0 };
  for (const r of rows) byDepth[r.depth] = (byDepth[r.depth] || 0) + 1;

  console.log(`[sync-csv] Parsed ${rows.length} rows:`);
  console.log(`  depth=1 (대카테고리): ${byDepth[1]}`);
  console.log(`  depth=2 (중카테고리): ${byDepth[2]}`);
  console.log(`  depth=3 (소카테고리): ${byDepth[3]}`);

  // Sample
  console.log('[sync-csv] Sample rows:');
  for (const r of rows.slice(0, 3)) {
    console.log(`  [${r.depth}] ${r.jpCategoryId} | ${r.fullPath} | isLeaf=${r.isLeaf}`);
  }

  if (dryRun) {
    console.log('\n[sync-csv] DRY-RUN: sheet not modified.');
    return { success: true, count: rows.length, dryRun: true };
  }

  // 2. Write to sheet
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) {
    console.error('[sync-csv] ERROR: GOOGLE_SHEET_ID not set in backend/.env');
    process.exit(1);
  }

  const sheets = await getSheetsClient();
  await ensureSheetTab(sheets, sheetId, TAB_NAME);
  await writeToSheet(sheets, sheetId, TAB_NAME, rows);

  console.log(`[${new Date().toISOString()}] === Done ===`);
  return { success: true, count: rows.length };
}

main().catch(err => {
  console.error('[sync-csv] FATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
