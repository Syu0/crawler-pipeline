/**
 * Japan Categories Sync
 * 
 * Fetches Qoo10 Japan category list from API and overwrites Google Sheet.
 * Uses CommonInfoLookup.GetCatagoryListAll (note: API has typo "Catagory")
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'backend', '.env') });

const { qoo10PostMethod } = require('./qoo10Client');
const { getSheetsClient } = require('./sheetsClient');

const TAB_NAME = 'japan_categories';

// Sheet headers
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

/**
 * Fetch Japan category list from Qoo10 API
 * @returns {Promise<object>} - API response
 */
async function fetchJapanCategories() {
  console.log(`[${new Date().toISOString()}] Calling Qoo10 API: CommonInfoLookup.GetCatagoryListAll`);
  
  const response = await qoo10PostMethod('CommonInfoLookup.GetCatagoryListAll', {
    returnType: 'application/json'
  }, '1.0');
  
  return response;
}

/**
 * Flatten nested category tree into rows
 * @param {Array} categories - Raw category list from API
 * @returns {Array<object>} - Flattened rows
 */
function flattenCategories(categories) {
  const rows = [];
  const now = new Date().toISOString();
  
  // Build a map for quick parent lookup
  const categoryMap = new Map();
  
  // First pass: index all categories
  function indexCategory(cat, depth = 1) {
    const catId = cat.CATE_S_CD || cat.cate_s_cd || cat.CateSCd || cat.cateSCd || '';
    if (catId) {
      categoryMap.set(catId, {
        id: catId,
        name: cat.CATE_S_NM || cat.cate_s_nm || cat.CateSNm || cat.cateSNm || cat.name || '',
        parentId: cat.CATE_L_CD || cat.cate_l_cd || cat.CateLCd || cat.cateLCd || cat.parentCd || '',
        sortOrder: cat.SORT_ORDER || cat.sort_order || cat.SortOrder || cat.sortOrder || '',
        depth: depth,
        children: cat.Children || cat.children || cat.SubCategories || cat.subCategories || []
      });
    }
    
    const children = cat.Children || cat.children || cat.SubCategories || cat.subCategories || [];
    if (Array.isArray(children)) {
      children.forEach(child => indexCategory(child, depth + 1));
    }
  }
  
  // Handle different API response structures
  let categoryList = categories;
  if (!Array.isArray(categories)) {
    // Try common response wrapper keys
    categoryList = categories.ResultObject || 
                   categories.resultObject || 
                   categories.Categories ||
                   categories.categories ||
                   categories.Data ||
                   categories.data ||
                   [];
  }
  
  if (!Array.isArray(categoryList)) {
    console.warn('Category list is not an array, attempting to extract...');
    categoryList = [];
  }
  
  // Index all categories
  categoryList.forEach(cat => indexCategory(cat, 1));
  
  /**
   * Build full path for a category
   */
  function buildFullPath(catId, visited = new Set()) {
    if (visited.has(catId)) return ''; // Prevent infinite loops
    visited.add(catId);
    
    const cat = categoryMap.get(catId);
    if (!cat) return '';
    
    if (!cat.parentId || cat.parentId === '0' || cat.parentId === '') {
      return cat.name;
    }
    
    const parentPath = buildFullPath(cat.parentId, visited);
    return parentPath ? `${parentPath} > ${cat.name}` : cat.name;
  }
  
  /**
   * Check if category is a leaf (no children)
   */
  function isLeafCategory(catId) {
    const cat = categoryMap.get(catId);
    if (!cat) return true;
    return !cat.children || cat.children.length === 0;
  }
  
  /**
   * Process categories recursively and flatten
   */
  function processCategory(cat, depth = 1, parentPath = '') {
    const catId = cat.CATE_S_CD || cat.cate_s_cd || cat.CateSCd || cat.cateSCd || cat.CateCD || cat.cateCd || '';
    const catName = cat.CATE_S_NM || cat.cate_s_nm || cat.CateSNm || cat.cateSNm || cat.CateNM || cat.cateNm || cat.name || '';
    const parentId = cat.CATE_L_CD || cat.cate_l_cd || cat.CateLCd || cat.cateLCd || cat.ParentCD || cat.parentCd || '';
    const sortOrder = cat.SORT_ORDER || cat.sort_order || cat.SortOrder || cat.sortOrder || '';
    
    if (!catId) return;
    
    const fullPath = parentPath ? `${parentPath} > ${catName}` : catName;
    const children = cat.Children || cat.children || cat.SubCategories || cat.subCategories || [];
    const isLeaf = !children || children.length === 0;
    
    rows.push({
      jpCategoryId: catId,
      parentJpCategoryId: parentId || '',
      depth: depth,
      name: catName,
      fullPath: fullPath,
      sortOrder: sortOrder,
      isLeaf: isLeaf,
      updatedAt: now
    });
    
    // Process children
    if (Array.isArray(children)) {
      children.forEach(child => processCategory(child, depth + 1, fullPath));
    }
  }
  
  // Process all root categories
  categoryList.forEach(cat => processCategory(cat, 1, ''));
  
  return rows;
}

/**
 * Ensure sheet tab exists, creating if needed
 */
async function ensureSheetTab(sheets, sheetId, tabName) {
  try {
    // Try to read the tab
    await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${tabName}!A1`,
    });
  } catch (err) {
    if (err.message.includes('Unable to parse range')) {
      // Tab doesn't exist, create it
      console.log(`[${new Date().toISOString()}] Creating sheet tab: ${tabName}`);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: { title: tabName }
            }
          }]
        }
      });
    } else {
      throw err;
    }
  }
}

/**
 * Clear all content from a sheet tab
 */
async function clearSheet(sheets, sheetId, tabName) {
  console.log(`[${new Date().toISOString()}] Clearing sheet: ${tabName}`);
  
  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: `${tabName}!A:Z`,
  });
}

/**
 * Write rows to sheet in batches
 * @param {object} sheets - Google Sheets client
 * @param {string} sheetId - Sheet ID
 * @param {string} tabName - Tab name
 * @param {string[]} headers - Header row
 * @param {Array<object>} rows - Data rows
 */
async function writeRowsBatch(sheets, sheetId, tabName, headers, rows) {
  // Prepare all values: headers + data rows
  const allValues = [
    headers,
    ...rows.map(row => headers.map(h => {
      const val = row[h];
      if (val === undefined || val === null) return '';
      if (typeof val === 'boolean') return val.toString();
      return String(val);
    }))
  ];
  
  console.log(`[${new Date().toISOString()}] Writing ${allValues.length} rows (1 header + ${rows.length} data)`);
  
  // Write all at once (Google Sheets API supports up to 10MB per request)
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${tabName}!A1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: allValues,
    },
  });
}

/**
 * Main sync function: Fetch Japan categories and overwrite sheet
 * @returns {Promise<{success: boolean, count?: number, error?: string}>}
 */
async function syncJapanCategoriesToSheet() {
  const startTime = new Date();
  console.log(`\n[${startTime.toISOString()}] === Starting Japan Categories Sync ===`);
  
  const sheetId = process.env.GOOGLE_SHEET_ID;
  
  if (!sheetId) {
    const error = 'GOOGLE_SHEET_ID not set in backend/.env';
    console.error(`[${new Date().toISOString()}] ERROR: ${error}`);
    return { success: false, error };
  }
  
  try {
    // 1. Fetch from Qoo10 API
    const apiResponse = await fetchJapanCategories();
    
    // Check for API error
    if (apiResponse.ResultCode && apiResponse.ResultCode !== 0 && apiResponse.ResultCode !== '0') {
      const error = `Qoo10 API error: ${apiResponse.ResultMsg || apiResponse.resultMsg || 'Unknown error'} (code: ${apiResponse.ResultCode})`;
      console.error(`[${new Date().toISOString()}] ${error}`);
      return { success: false, error };
    }
    
    console.log(`[${new Date().toISOString()}] API call successful`);
    
    // 2. Flatten categories
    const rows = flattenCategories(apiResponse);
    
    if (rows.length === 0) {
      console.warn(`[${new Date().toISOString()}] WARNING: No categories returned from API`);
      console.log('API Response structure:', JSON.stringify(apiResponse, null, 2).substring(0, 1000));
    }
    
    console.log(`[${new Date().toISOString()}] Total categories flattened: ${rows.length}`);
    
    // 3. Get sheets client
    const sheets = await getSheetsClient();
    
    // 4. Ensure tab exists
    await ensureSheetTab(sheets, sheetId, TAB_NAME);
    
    // 5. Clear existing content
    await clearSheet(sheets, sheetId, TAB_NAME);
    
    // 6. Write headers and data
    await writeRowsBatch(sheets, sheetId, TAB_NAME, HEADERS, rows);
    
    const endTime = new Date();
    const duration = (endTime - startTime) / 1000;
    
    console.log(`[${endTime.toISOString()}] === Sync Complete ===`);
    console.log(`  Rows written: ${rows.length}`);
    console.log(`  Duration: ${duration.toFixed(2)}s`);
    
    return { success: true, count: rows.length };
    
  } catch (err) {
    console.error(`[${new Date().toISOString()}] SYNC ERROR:`, err.message);
    console.error(err.stack);
    return { success: false, error: err.message };
  }
}

module.exports = {
  syncJapanCategoriesToSheet,
  fetchJapanCategories,
  flattenCategories,
  HEADERS,
  TAB_NAME
};
