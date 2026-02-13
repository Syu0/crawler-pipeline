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

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'backend', '.env') });

const { getSheetsClient } = require('./sheetsClient');

// Sheet configuration
const MAPPING_TAB = 'category_mapping';
const MAPPING_LEGACY_TAB = 'category_mapping_legacy';
const JP_CATEGORIES_TAB = 'japan_categories';

// FALLBACK JP Category: "320002604" (Toothpaste Set sample category)
const FALLBACK_JP_CATEGORY_ID = '320002604';
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
 * Tokenize a path string for keyword matching
 * @param {string} path - Category path like "가전 > 냉장고 > 양문형"
 * @returns {string[]} Array of lowercase tokens
 */
function tokenizePath(path) {
  if (!path) return [];
  
  return path
    .split(/[\s>\/,]+/)
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length > 0);
}

/**
 * Calculate match score between Coupang path and JP category
 * @returns {number} Score 0-1
 */
function calculateMatchScore(coupangTokens, jpFullPath, jpIsLeaf, jpDepth) {
  if (!jpFullPath || coupangTokens.length === 0) return 0;
  
  const jpTokens = tokenizePath(jpFullPath);
  if (jpTokens.length === 0) return 0;
  
  // Count matching tokens
  let matchCount = 0;
  for (const cToken of coupangTokens) {
    for (const jToken of jpTokens) {
      if (jToken.includes(cToken) || cToken.includes(jToken)) {
        matchCount++;
        break;
      }
    }
  }
  
  // Base score from token matches
  let score = matchCount / Math.max(coupangTokens.length, 1);
  
  // Prefer leaf categories
  if (jpIsLeaf) {
    score += 0.1;
  }
  
  // Prefer deeper categories (more specific)
  if (jpDepth >= 3) {
    score += 0.05;
  }
  
  return Math.min(score, 1.0);
}

/**
 * Find Top N AUTO match candidates from JP categories
 * @param {string} coupangPath2 
 * @param {string} coupangPath3 
 * @param {Array<object>} jpCategories 
 * @param {number} topN - Number of top candidates to return (default 3)
 * @returns {Array<object>} Array of match candidates sorted by score desc
 */
function findTopAutoMatches(coupangPath2, coupangPath3, jpCategories, topN = 3) {
  if (!jpCategories || jpCategories.length === 0) {
    return [];
  }
  
  // Tokenize Coupang paths (path3 has higher priority)
  const tokens3 = tokenizePath(coupangPath3);
  const tokens2 = tokenizePath(coupangPath2);
  
  // Combine tokens, giving slight priority to path3 tokens
  const allTokens = [...new Set([...tokens3, ...tokens2])];
  
  if (allTokens.length === 0) {
    return [];
  }
  
  // Score all JP categories
  const scoredCandidates = [];
  
  for (const jpCat of jpCategories) {
    const score = calculateMatchScore(
      allTokens, 
      jpCat.fullPath, 
      jpCat.isLeaf, 
      jpCat.depth
    );
    
    // Minimum threshold to be considered
    if (score >= 0.25) {
      scoredCandidates.push({
        jpCategoryId: jpCat.jpCategoryId,
        jpFullPath: jpCat.fullPath,
        isLeaf: jpCat.isLeaf,
        depth: jpCat.depth,
        confidence: Math.round(score * 100) / 100
      });
    }
  }
  
  // Sort by score desc, then by depth desc (prefer more specific), then by isLeaf
  scoredCandidates.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (b.depth !== a.depth) return b.depth - a.depth;
    if (a.isLeaf !== b.isLeaf) return a.isLeaf ? -1 : 1;
    return 0;
  });
  
  // Return top N
  return scoredCandidates.slice(0, topN);
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
  
  // 2) Generate Top 3 AUTO suggestions (for human review)
  const jpCategories = await getJpCategories(sheets, sheetId);
  let topCandidates = [];
  
  if (jpCategories.length > 0 && coupangCategoryKey) {
    topCandidates = findTopAutoMatches(categoryPath2, categoryPath3, jpCategories, 3);
    
    if (topCandidates.length > 0) {
      console.log(`[CategoryResolver] AUTO suggestions: ${topCandidates.length} candidates`);
      console.log(`[CategoryResolver]   jpCategoryIds: ${topCandidates.map(c => c.jpCategoryId).join(', ')}`);
      
      // Write AUTO suggestions (only if no existing mapping for this key)
      if (!existingMapping) {
        try {
          const now = new Date().toISOString();
          
          for (let i = 0; i < topCandidates.length; i++) {
            const candidate = topCandidates[i];
            await writeMappingRow(sheets, sheetId, {
              coupangCategoryKey,
              coupangPath2: categoryPath2,
              coupangPath3: categoryPath3,
              jpCategoryId: candidate.jpCategoryId,
              jpFullPath: candidate.jpFullPath,
              matchType: 'AUTO',
              confidence: candidate.confidence,
              note: `AUTO suggestion #${i + 1} of ${topCandidates.length} (review required)`,
              updatedAt: now,
              updatedBy: 'system'
            });
          }
          
          console.log(`[CategoryResolver] AUTO mapping created: ${topCandidates.length} rows`);
        } catch (writeErr) {
          console.warn(`[CategoryResolver] Failed to write AUTO suggestions: ${writeErr.message}`);
        }
      }
    }
  }
  
  // 3) Return FALLBACK - AUTO suggestions are for review only, not auto-applied
  console.log(`[CategoryResolver] FALLBACK used (review required): jpCategoryId=${FALLBACK_JP_CATEGORY_ID}`);
  
  // Write FALLBACK row if no mappings exist and no AUTO candidates
  if (!existingMapping && topCandidates.length === 0) {
    try {
      await writeMappingRow(sheets, sheetId, {
        coupangCategoryKey,
        coupangPath2: categoryPath2,
        coupangPath3: categoryPath3,
        jpCategoryId: FALLBACK_JP_CATEGORY_ID,
        jpFullPath: FALLBACK_JP_FULL_PATH,
        matchType: 'FALLBACK',
        confidence: '0',
        note: 'No AUTO match found - requires manual review',
        updatedAt: new Date().toISOString(),
        updatedBy: 'system'
      });
    } catch (writeErr) {
      console.warn(`[CategoryResolver] Failed to write FALLBACK mapping: ${writeErr.message}`);
    }
  }
  
  return {
    jpCategoryId: FALLBACK_JP_CATEGORY_ID,
    matchType: 'FALLBACK',
    confidence: 0,
    jpFullPath: FALLBACK_JP_FULL_PATH,
    coupangCategoryKey,
    candidates: topCandidates
  };
}

module.exports = {
  resolveJpCategoryId,
  normalizeCategoryPath,
  ensureMappingSheet,
  getMappings,
  getJpCategories,
  findTopAutoMatches,
  migrateToPathKeyedSchema,
  MAPPING_HEADERS,
  MAPPING_TAB,
  FALLBACK_JP_CATEGORY_ID,
  FALLBACK_JP_FULL_PATH
};
