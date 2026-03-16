/**
 * KR(Coupang) → JP(Qoo10) Category Mapping Resolver
 * 
 * Resolves JP category IDs for Coupang products using:
 * 1. MANUAL mappings from category_mapping sheet (keyed by normalized categoryPath3)
 * 2. AUTO matching by keyword search in japan_categories
 * 3. FALLBACK to a fixed JP category ID (never returns null)
 * 
 * KEY CHANGE: Primary key is now normalized categoryPath3, not categoryId.
 * This ensures products with different categoryIds but same path share one mapping.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { getSheetsClient } = require('../coupang/sheetsClient');

// Sheet configuration
const MAPPING_TAB = 'category_mapping';
const MAPPING_LEGACY_TAB = 'category_mapping_legacy';
const JP_CATEGORIES_TAB = 'japan_categories';

// FALLBACK JP Category: "320002604" (Toothpaste Set sample category)
const FALLBACK_JP_CATEGORY_ID = '320002604';

// AUTO match threshold — candidates below this score are ignored
const AUTO_THRESHOLD = 0.15;

// Module-level cache for japan_categories (loaded once per process)
let _jpCategoriesCache = null;
const FALLBACK_JP_FULL_PATH = 'Fallback Category (Review Required)';

// New headers for path-keyed category_mapping sheet
const MAPPING_HEADERS = [
  'coupangCategoryKey',    // PRIMARY KEY: normalized categoryPath3
  'coupangPath2',
  'coupangPath3',          // Original path3 before normalization
  'jpCategoryId',
  'jpFullPath',
  'matchType',             // MANUAL | AUTO | FALLBACK
  'confidence',            // 0-1
  'note',
  'updatedAt',
  'updatedBy'
];

// Old headers (for migration detection)
const OLD_MAPPING_HEADERS = [
  'coupangCategoryId',
  'coupangPath2',
  'coupangPath3',
  'jpCategoryId',
  'jpFullPath',
  'matchType',
  'confidence',
  'note',
  'updatedAt',
  'updatedBy'
];

/**
 * Normalize a category path string into canonical key format
 * - Split by ">"
 * - Trim each segment
 * - Join with " > "
 * - Remove duplicate spaces
 * @param {string} path - Raw category path (e.g., "완구/취미>물놀이/계절완구> 목욕놀이")
 * @returns {string} Normalized path (e.g., "완구/취미 > 물놀이/계절완구 > 목욕놀이")
 */
function normalizeCategoryPath(path) {
  if (!path || typeof path !== 'string') return '';
  
  return path
    .split('>')
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0)
    .join(' > ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if sheet has old schema (coupangCategoryId as first column)
 */
function isOldSchema(headers) {
  return headers && headers[0] === 'coupangCategoryId';
}

/**
 * Migrate old category_mapping to new path-keyed schema
 */
async function migrateToPathKeyedSchema(sheets, sheetId) {
  console.log('[CategoryResolver] Checking for schema migration...');
  
  try {
    // Read existing data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${MAPPING_TAB}!A:J`,
    });
    
    const rows = response.data.values || [];
    if (rows.length < 1) return false;
    
    const headers = rows[0];
    
    // Check if migration needed
    if (!isOldSchema(headers)) {
      console.log('[CategoryResolver] Schema already up-to-date (path-keyed)');
      return false;
    }
    
    console.log('[CategoryResolver] Old schema detected, migrating...');
    
    // Collect old data
    const oldRows = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = row[idx] || '';
      });
      oldRows.push(obj);
    }
    
    // Migrate to legacy sheet first (backup)
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [{
            addSheet: { properties: { title: MAPPING_LEGACY_TAB } }
          }]
        }
      });
    } catch (e) {
      // Tab might already exist
    }
    
    // Write old data to legacy sheet
    if (oldRows.length > 0) {
      const legacyValues = [
        OLD_MAPPING_HEADERS,
        ...oldRows.map(r => OLD_MAPPING_HEADERS.map(h => r[h] || ''))
      ];
      
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${MAPPING_LEGACY_TAB}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: legacyValues }
      });
      
      console.log(`[CategoryResolver] Backed up ${oldRows.length} rows to ${MAPPING_LEGACY_TAB}`);
    }
    
    // Clear main sheet and write new headers
    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: `${MAPPING_TAB}!A:Z`,
    });
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${MAPPING_TAB}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [MAPPING_HEADERS] }
    });
    
    // Migrate rows that have categoryPath3
    const migratedRows = [];
    const unmigratableRows = [];
    
    for (const oldRow of oldRows) {
      if (oldRow.coupangPath3) {
        const key = normalizeCategoryPath(oldRow.coupangPath3);
        if (key) {
          migratedRows.push({
            coupangCategoryKey: key,
            coupangPath2: oldRow.coupangPath2 || '',
            coupangPath3: oldRow.coupangPath3,
            jpCategoryId: oldRow.jpCategoryId || '',
            jpFullPath: oldRow.jpFullPath || '',
            matchType: oldRow.matchType || 'AUTO',
            confidence: oldRow.confidence || '',
            note: `Migrated from categoryId: ${oldRow.coupangCategoryId}`,
            updatedAt: new Date().toISOString(),
            updatedBy: 'migration'
          });
        } else {
          unmigratableRows.push(oldRow);
        }
      } else {
        unmigratableRows.push(oldRow);
      }
    }
    
    // Dedupe migrated rows by key (keep first occurrence with jpCategoryId, or first overall)
    const deduped = new Map();
    for (const row of migratedRows) {
      const existing = deduped.get(row.coupangCategoryKey);
      if (!existing || (!existing.jpCategoryId && row.jpCategoryId)) {
        deduped.set(row.coupangCategoryKey, row);
      }
    }
    
    // Write migrated rows
    if (deduped.size > 0) {
      const newValues = Array.from(deduped.values()).map(r => 
        MAPPING_HEADERS.map(h => r[h] || '')
      );
      
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${MAPPING_TAB}!A:J`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: newValues }
      });
      
      console.log(`[CategoryResolver] Migrated ${deduped.size} rows to new schema`);
    }
    
    if (unmigratableRows.length > 0) {
      console.log(`[CategoryResolver] ${unmigratableRows.length} rows could not be migrated (no path3), kept in ${MAPPING_LEGACY_TAB}`);
    }
    
    return true;
    
  } catch (err) {
    console.error('[CategoryResolver] Migration error:', err.message);
    return false;
  }
}

/**
 * Ensure category_mapping sheet exists with new headers
 */
async function ensureMappingSheet(sheets, sheetId) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${MAPPING_TAB}!A1:J1`,
    });
    
    const existingHeaders = response.data.values?.[0] || [];
    
    if (existingHeaders.length === 0) {
      // Write new headers
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${MAPPING_TAB}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [MAPPING_HEADERS] }
      });
      console.log(`[CategoryResolver] Created category_mapping sheet with path-keyed schema`);
      return MAPPING_HEADERS;
    }
    
    // Check if old schema and migrate
    if (isOldSchema(existingHeaders)) {
      await migrateToPathKeyedSchema(sheets, sheetId);
      return MAPPING_HEADERS;
    }
    
    return existingHeaders;
    
  } catch (err) {
    if (err.message.includes('Unable to parse range')) {
      // Tab doesn't exist, create it
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [{
            addSheet: { properties: { title: MAPPING_TAB } }
          }]
        }
      });
      
      // Write headers
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${MAPPING_TAB}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [MAPPING_HEADERS] }
      });
      
      console.log(`[CategoryResolver] Created category_mapping sheet`);
      return MAPPING_HEADERS;
    }
    throw err;
  }
}

/**
 * Get all mappings from category_mapping sheet
 * @returns {Map<string, object>} Map of coupangCategoryKey → mapping object
 */
async function getMappings(sheets, sheetId) {
  await ensureMappingSheet(sheets, sheetId);
  
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${MAPPING_TAB}!A:J`,
    });
    
    const rows = response.data.values || [];
    if (rows.length < 2) return new Map();
    
    const headers = rows[0];
    const mappings = new Map();
    
    // Find the key column index
    const keyColIndex = headers.indexOf('coupangCategoryKey');
    if (keyColIndex === -1) {
      console.warn('[CategoryResolver] coupangCategoryKey column not found in headers');
      return new Map();
    }
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const obj = { _rowIndex: i + 1 };
      
      headers.forEach((h, idx) => {
        obj[h] = row[idx] || '';
      });
      
      const key = obj.coupangCategoryKey;
      if (key) {
        // For duplicate keys, prefer MANUAL over AUTO, then first occurrence
        const existing = mappings.get(key);
        if (!existing || 
            (existing.matchType !== 'MANUAL' && obj.matchType === 'MANUAL') ||
            (!existing.jpCategoryId && obj.jpCategoryId)) {
          mappings.set(key, obj);
        }
      }
    }
    
    return mappings;
    
  } catch (err) {
    console.error('[CategoryResolver] Error reading mappings:', err.message);
    return new Map();
  }
}

/**
 * Get all JP categories from japan_categories sheet
 * @returns {Array<object>} Array of JP category objects
 */
async function getJpCategories(sheets, sheetId) {
  if (_jpCategoriesCache) return _jpCategoriesCache;

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${JP_CATEGORIES_TAB}!A:H`,
    });

    const rows = response.data.values || [];
    if (rows.length < 2) return [];

    const headers = rows[0];
    const categories = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const obj = {};

      headers.forEach((h, idx) => {
        obj[h] = row[idx] || '';
      });

      // Parse boolean isLeaf
      obj.isLeaf = obj.isLeaf === 'true' || obj.isLeaf === true;
      // Parse numeric depth
      obj.depth = parseInt(obj.depth, 10) || 0;

      categories.push(obj);
    }

    _jpCategoriesCache = categories;
    console.log(`[CategoryResolver] Loaded ${categories.length} JP categories (cached)`);
    return categories;

  } catch (err) {
    console.error('[CategoryResolver] Error reading JP categories:', err.message);
    return [];
  }
}

/**
 * Write a new mapping row to category_mapping sheet
 */
async function writeMappingRow(sheets, sheetId, mapping) {
  await ensureMappingSheet(sheets, sheetId);
  
  const rowValues = MAPPING_HEADERS.map(h => {
    const val = mapping[h];
    if (val === undefined || val === null) return '';
    return String(val);
  });
  
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${MAPPING_TAB}!A:J`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [rowValues] }
  });
}

/**
 * Upsert a mapping row: update in-place if coupangCategoryKey already exists, else append.
 * Always overwrites all fields with the provided mapping.
 *
 * @param {object} mapping - Must include coupangCategoryKey
 */
async function upsertMappingRow(mapping) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error('GOOGLE_SHEET_ID not set');

  const sheets = await getSheetsClient();
  await ensureMappingSheet(sheets, sheetId);

  const key = normalizeCategoryPath(mapping.coupangCategoryKey || mapping.coupangPath3 || '');
  if (!key) throw new Error('upsertMappingRow: coupangCategoryKey is required');

  const mappings = await getMappings(sheets, sheetId);
  const existing = mappings.get(key);

  const rowValues = MAPPING_HEADERS.map(h => {
    const val = mapping[h];
    if (val === undefined || val === null) return '';
    return String(val);
  });

  if (existing) {
    // Update row in place
    const rowNum = existing._rowIndex;
    const data = MAPPING_HEADERS.map((h, colIdx) => ({
      range: `${MAPPING_TAB}!${columnLetter(colIdx)}${rowNum}`,
      values: [[rowValues[colIdx]]],
    }));
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: 'RAW', data },
    });
    console.log(`[CategoryResolver] upsert UPDATE row ${rowNum}: "${key}"`);
  } else {
    // Append new row
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${MAPPING_TAB}!A:J`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [rowValues] },
    });
    console.log(`[CategoryResolver] upsert INSERT: "${key}"`);
  }
}

/**
 * Column index → letter (A, B, ..., Z, AA, ...)
 */
function columnLetter(index) {
  let letter = '';
  while (index >= 0) {
    letter = String.fromCharCode((index % 26) + 65) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

/**
 * Tokenize a category path string into meaningful tokens (length >= 2).
 * Splits on >, whitespace, slash.
 * @param {string} str
 * @returns {string[]}
 */
function tokenize(str) {
  if (!str) return [];
  return str
    .split(/[>\s\/]+/)
    .map(s => s.trim())
    .filter(s => s.length >= 2);
}

/**
 * Jaccard similarity between coupangKey and jpFullPath token sets.
 * @returns {number} Score 0-1
 */
function computeMatchScore(coupangKey, jpFullPath) {
  const cTokens = tokenize(coupangKey);
  const jTokens = tokenize(jpFullPath);
  if (cTokens.length === 0 || jTokens.length === 0) return 0;

  const jSet = new Set(jTokens);
  const intersection = cTokens.filter(t => jSet.has(t)).length;
  const union = new Set([...cTokens, ...jTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Find the single best AUTO match from JP categories.
 *
 * Stage 1 — leaf filter:
 *   Extract tokens from the last " > " segment of coupangKey (slash-split too).
 *   Keep only JP categories whose fullPath contains at least one leaf token.
 *
 * Stage 2 — Jaccard on filtered candidates:
 *   Pick the highest-scoring candidate using computeMatchScore.
 *   Tiebreak: higher depth > isLeaf.
 *
 * Stage 3 — full-corpus fallback:
 *   If Stage 1 produces 0 candidates, run Jaccard over all JP categories (old behavior).
 *
 * Returns null if no candidate meets AUTO_THRESHOLD.
 *
 * @param {string} coupangKey - Normalized coupang category key
 * @param {Array<object>} jpCategories
 * @returns {object|null}
 */
function findBestAutoMatch(coupangKey, jpCategories) {
  if (!jpCategories || jpCategories.length === 0 || !coupangKey) return null;

  // Stage 1: leaf token extraction from last segment
  const segments = coupangKey.split(' > ');
  const lastSegment = segments[segments.length - 1] || '';
  const leafTokens = lastSegment
    .split(/[/\s]+/)
    .map(s => s.trim())
    .filter(s => s.length >= 2);

  const leafCandidates = leafTokens.length > 0
    ? jpCategories.filter(cat => leafTokens.some(token => cat.fullPath.includes(token)))
    : [];

  // Stage 3 fallback: no leaf candidates → search entire corpus
  const pool = leafCandidates.length > 0 ? leafCandidates : jpCategories;

  // Stage 2: Jaccard on pool
  let best = null;

  for (const jpCat of pool) {
    const score = computeMatchScore(coupangKey, jpCat.fullPath);
    if (score < AUTO_THRESHOLD) continue;

    if (
      !best ||
      score > best.confidence ||
      (score === best.confidence && jpCat.depth > best.depth) ||
      (score === best.confidence && jpCat.depth === best.depth && jpCat.isLeaf && !best.isLeaf)
    ) {
      best = {
        jpCategoryId: jpCat.jpCategoryId,
        jpFullPath: jpCat.fullPath,
        isLeaf: jpCat.isLeaf,
        depth: jpCat.depth,
        confidence: Math.round(score * 100) / 100
      };
    }
  }

  return best;
}

/**
 * Main resolver function: Resolve JP category ID for a product
 * 
 * Resolution order:
 * 1. MANUAL: category_mapping row where coupangCategoryKey == normalize(product.categoryPath3)
 * 2. AUTO: keyword match in japan_categories, write suggestions to sheet
 * 3. FALLBACK: fixed JP category ID
 * 
 * @param {object} product - Product object with categoryPath3, categoryPath2, categoryId
 * @returns {Promise<{jpCategoryId: string, matchType: string, confidence?: number, jpFullPath?: string, coupangCategoryKey?: string, candidates?: Array}>}
 */
async function resolveJpCategoryId(product) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  
  if (!sheetId) {
    console.warn('[CategoryResolver] GOOGLE_SHEET_ID not set, using FALLBACK');
    return {
      jpCategoryId: FALLBACK_JP_CATEGORY_ID,
      matchType: 'FALLBACK',
      jpFullPath: FALLBACK_JP_FULL_PATH,
      coupangCategoryKey: ''
    };
  }
  
  const sheets = await getSheetsClient();
  
  // Extract inputs
  const categoryPath3 = product.categoryPath3 || '';
  const categoryPath2 = product.categoryPath2 || '';
  const categoryId = String(product.categoryId || ''); // Secondary/debug only
  
  // Compute the canonical key from path3
  const coupangCategoryKey = normalizeCategoryPath(categoryPath3);
  
  console.log(`[CategoryResolver] key="${coupangCategoryKey}" (from path3), categoryId=${categoryId}`);
  
  // 1) Check for MANUAL mapping by key
  const mappings = await getMappings(sheets, sheetId);
  const existingMapping = mappings.get(coupangCategoryKey);
  
  if (existingMapping && existingMapping.jpCategoryId && existingMapping.matchType === 'MANUAL') {
    console.log(`[CategoryResolver] MANUAL match: jpCategoryId=${existingMapping.jpCategoryId}`);
    return {
      jpCategoryId: existingMapping.jpCategoryId,
      matchType: 'MANUAL',
      confidence: existingMapping.confidence ? parseFloat(existingMapping.confidence) : 1.0,
      jpFullPath: existingMapping.jpFullPath || undefined,
      coupangCategoryKey
    };
  }
  
  // 2) AUTO match using Jaccard similarity on Korean fullPath
  const jpCategories = await getJpCategories(sheets, sheetId);
  const autoMatch = coupangCategoryKey
    ? findBestAutoMatch(coupangCategoryKey, jpCategories)
    : null;

  if (autoMatch) {
    console.log(`[CategoryResolver] AUTO match: jpCategoryId=${autoMatch.jpCategoryId} confidence=${autoMatch.confidence} path="${autoMatch.jpFullPath}"`);

    // Write to category_mapping for human review (only if no existing row)
    if (!existingMapping) {
      try {
        await writeMappingRow(sheets, sheetId, {
          coupangCategoryKey,
          coupangPath2: categoryPath2,
          coupangPath3: categoryPath3,
          jpCategoryId: autoMatch.jpCategoryId,
          jpFullPath: autoMatch.jpFullPath,
          matchType: 'AUTO',
          confidence: autoMatch.confidence,
          note: 'AUTO — Jaccard match (review to promote to MANUAL)',
          updatedAt: new Date().toISOString(),
          updatedBy: 'system'
        });
      } catch (writeErr) {
        console.warn(`[CategoryResolver] Failed to write AUTO row: ${writeErr.message}`);
      }
    }

    return {
      jpCategoryId: autoMatch.jpCategoryId,
      matchType: 'AUTO',
      confidence: autoMatch.confidence,
      jpFullPath: autoMatch.jpFullPath,
      coupangCategoryKey
    };
  }

  // 3) FALLBACK
  console.log(`[CategoryResolver] FALLBACK used: jpCategoryId=${FALLBACK_JP_CATEGORY_ID}`);

  if (!existingMapping) {
    try {
      await writeMappingRow(sheets, sheetId, {
        coupangCategoryKey,
        coupangPath2: categoryPath2,
        coupangPath3: categoryPath3,
        jpCategoryId: FALLBACK_JP_CATEGORY_ID,
        jpFullPath: FALLBACK_JP_FULL_PATH,
        matchType: 'FALLBACK',
        confidence: '0',
        note: 'No AUTO match found — requires manual review',
        updatedAt: new Date().toISOString(),
        updatedBy: 'system'
      });
    } catch (writeErr) {
      console.warn(`[CategoryResolver] Failed to write FALLBACK row: ${writeErr.message}`);
    }
  }

  return {
    jpCategoryId: FALLBACK_JP_CATEGORY_ID,
    matchType: 'FALLBACK',
    confidence: 0,
    jpFullPath: FALLBACK_JP_FULL_PATH,
    coupangCategoryKey
  };
}

/**
 * Convenience wrapper: accepts a raw categoryPath3 string instead of a product object.
 * @param {string} categoryPath3
 * @returns {Promise<{jpCategoryId, matchType, confidence, jpFullPath, coupangCategoryKey}>}
 */
async function resolveCategory(categoryPath3) {
  return resolveJpCategoryId({ categoryPath3, categoryPath2: '', categoryId: '' });
}

module.exports = {
  resolveCategory,
  resolveJpCategoryId,
  upsertMappingRow,
  normalizeCategoryPath,
  ensureMappingSheet,
  getMappings,
  getJpCategories,
  findBestAutoMatch,
  computeMatchScore,
  tokenize,
  migrateToPathKeyedSchema,
  MAPPING_HEADERS,
  MAPPING_TAB,
  FALLBACK_JP_CATEGORY_ID,
  FALLBACK_JP_FULL_PATH,
  AUTO_THRESHOLD
};
