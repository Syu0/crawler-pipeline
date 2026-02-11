/**
 * KR(Coupang) → JP(Qoo10) Category Mapping Resolver
 * 
 * Resolves JP category IDs for Coupang products using:
 * 1. MANUAL mappings from category_mapping sheet
 * 2. AUTO matching by keyword search in japan_categories
 * 3. FALLBACK to a fixed JP category ID (never returns null)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'backend', '.env') });

const { getSheetsClient } = require('./sheetsClient');

// Sheet configuration
const MAPPING_TAB = 'category_mapping';
const JP_CATEGORIES_TAB = 'japan_categories';

// FALLBACK JP Category: "320002604" (Toothpaste Set sample category)
// This ensures registration NEVER fails due to missing category
const FALLBACK_JP_CATEGORY_ID = '320002604';
const FALLBACK_JP_FULL_PATH = 'Fallback Category (Review Required)';

// Headers for category_mapping sheet
const MAPPING_HEADERS = [
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
 * Ensure category_mapping sheet exists with headers
 */
async function ensureMappingSheet(sheets, sheetId) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${MAPPING_TAB}!A1:J1`,
    });
    
    const existingHeaders = response.data.values?.[0] || [];
    
    if (existingHeaders.length === 0) {
      // Write headers
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${MAPPING_TAB}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [MAPPING_HEADERS] }
      });
      console.log(`[CategoryResolver] Created category_mapping sheet with headers`);
    }
    
    return existingHeaders.length > 0 ? existingHeaders : MAPPING_HEADERS;
    
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
 * @returns {Map<string, object>} Map of coupangCategoryId → mapping object
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
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const obj = { _rowIndex: i + 1 };
      
      headers.forEach((h, idx) => {
        obj[h] = row[idx] || '';
      });
      
      if (obj.coupangCategoryId) {
        mappings.set(obj.coupangCategoryId, obj);
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
 * Write a new mapping to category_mapping sheet
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
 * Find best AUTO match from JP categories (legacy - uses findTopAutoMatches internally)
 * @param {string} coupangPath2 
 * @param {string} coupangPath3 
 * @param {Array<object>} jpCategories 
 * @returns {object|null} Best match or null
 */
function findBestAutoMatch(coupangPath2, coupangPath3, jpCategories) {
  const topMatches = findTopAutoMatches(coupangPath2, coupangPath3, jpCategories, 1);
  return topMatches.length > 0 ? topMatches[0] : null;
}

/**
 * Main resolver function: Resolve JP category ID for a product
 * 
 * @param {object} product - Product object with categoryId, categoryPath2, categoryPath3
 * @returns {Promise<{jpCategoryId: string, matchType: string, confidence?: number, jpFullPath?: string, candidates?: Array}>}
 */
async function resolveJpCategoryId(product) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  
  if (!sheetId) {
    console.warn('[CategoryResolver] GOOGLE_SHEET_ID not set, using FALLBACK');
    return {
      jpCategoryId: FALLBACK_JP_CATEGORY_ID,
      matchType: 'FALLBACK',
      jpFullPath: FALLBACK_JP_FULL_PATH
    };
  }
  
  const sheets = await getSheetsClient();
  const coupangCategoryId = String(product.categoryId || '');
  const coupangPath2 = product.categoryPath2 || '';
  const coupangPath3 = product.categoryPath3 || '';
  
  console.log(`[CategoryResolver] Resolving: coupangCategoryId=${coupangCategoryId}`);
  
  // 1) Check for MANUAL mapping (highest priority - always use if exists)
  const mappings = await getMappings(sheets, sheetId);
  const existingMapping = mappings.get(coupangCategoryId);
  
  if (existingMapping && existingMapping.jpCategoryId && existingMapping.matchType === 'MANUAL') {
    console.log(`[CategoryResolver] MANUAL match found: jpCategoryId=${existingMapping.jpCategoryId}`);
    return {
      jpCategoryId: existingMapping.jpCategoryId,
      matchType: 'MANUAL',
      confidence: existingMapping.confidence ? parseFloat(existingMapping.confidence) : 1.0,
      jpFullPath: existingMapping.jpFullPath || undefined
    };
  }
  
  // 2) Generate Top 3 AUTO suggestions (for human review)
  const jpCategories = await getJpCategories(sheets, sheetId);
  let topCandidates = [];
  
  if (jpCategories.length > 0 && (coupangPath2 || coupangPath3)) {
    topCandidates = findTopAutoMatches(coupangPath2, coupangPath3, jpCategories, 3);
    
    if (topCandidates.length > 0) {
      console.log(`[CategoryResolver] AUTO suggestions: ${topCandidates.length} candidates for coupangCategoryId=${coupangCategoryId}`);
      console.log(`[CategoryResolver]   jpCategoryIds: ${topCandidates.map(c => c.jpCategoryId).join(', ')}`);
      
      // Write Top 3 candidates to category_mapping (only if no existing rows for this coupangCategoryId)
      if (!existingMapping) {
        try {
          const now = new Date().toISOString();
          
          for (let i = 0; i < topCandidates.length; i++) {
            const candidate = topCandidates[i];
            await writeMappingRow(sheets, sheetId, {
              coupangCategoryId,
              coupangPath2,
              coupangPath3,
              jpCategoryId: candidate.jpCategoryId,
              jpFullPath: candidate.jpFullPath,
              matchType: 'AUTO',
              confidence: candidate.confidence,
              note: `AUTO suggestion #${i + 1} of ${topCandidates.length} (review required)`,
              updatedAt: now,
              updatedBy: 'system'
            });
          }
          
          console.log(`[CategoryResolver] AUTO suggestions written: ${topCandidates.length} rows for coupangCategoryId=${coupangCategoryId}`);
        } catch (writeErr) {
          console.warn(`[CategoryResolver] Failed to write AUTO suggestions: ${writeErr.message}`);
        }
      }
    }
  }
  
  // 3) Return result - use FALLBACK for actual registration
  // AUTO suggestions are for human review only, NOT auto-applied
  console.log(`[CategoryResolver] FALLBACK category used for registration (review AUTO suggestions): jpCategoryId=${FALLBACK_JP_CATEGORY_ID}`);
  
  // Write FALLBACK row if no mappings exist
  if (!existingMapping && topCandidates.length === 0) {
    try {
      await writeMappingRow(sheets, sheetId, {
        coupangCategoryId,
        coupangPath2,
        coupangPath3,
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
    candidates: topCandidates // Include candidates for reference
  };
        jpCategoryId: FALLBACK_JP_CATEGORY_ID,
        jpFullPath: FALLBACK_JP_FULL_PATH,
        matchType: 'FALLBACK',
        confidence: '0',
        note: 'No match found - requires manual review',
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
    jpFullPath: FALLBACK_JP_FULL_PATH
  };
}

module.exports = {
  resolveJpCategoryId,
  ensureMappingSheet,
  getMappings,
  getJpCategories,
  MAPPING_HEADERS,
  MAPPING_TAB,
  FALLBACK_JP_CATEGORY_ID,
  FALLBACK_JP_FULL_PATH
};
