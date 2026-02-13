/**
 * Coupang Category Sheet Client
 * 
 * Manages the "coupang_categorys" sheet for category dictionary accumulation.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'backend', '.env') });

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// Configuration
const CATEGORY_TAB_NAME = 'coupang_categorys';

// Sheet headers
const CATEGORY_HEADERS = [
  'coupangCategoryId',
  'depth2Path',
  'depth3Path',
  'rootName',
  'parentName',
  'leafName',
  'firstSeenAt',
  'lastSeenAt',
  'usedCount'
];

/**
 * Get authenticated Google Sheets client
 */
async function getSheetsClient() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
  
  if (!keyPath) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON_PATH not set');
  }
  
  const absolutePath = path.resolve(process.cwd(), keyPath);
  
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Service account key not found: ${absolutePath}`);
  }
  
  const auth = new google.auth.GoogleAuth({
    keyFile: absolutePath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  
  return google.sheets({ version: 'v4', auth });
}

/**
 * Ensure category sheet and headers exist
 */
async function ensureCategorySheet(sheetId) {
  const sheets = await getSheetsClient();
  
  // Check if tab exists
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${CATEGORY_TAB_NAME}!A1:I1`,
    });
    
    const existingHeaders = response.data.values?.[0] || [];
    
    if (existingHeaders.length === 0) {
      // Write headers
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${CATEGORY_TAB_NAME}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [CATEGORY_HEADERS] }
      });
    }
    
  } catch (err) {
    if (err.message.includes('Unable to parse range')) {
      // Tab doesn't exist, create it
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: sheetId,
          requestBody: {
            requests: [{
              addSheet: {
                properties: { title: CATEGORY_TAB_NAME }
              }
            }]
          }
        });
        
        // Write headers
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `${CATEGORY_TAB_NAME}!A1`,
          valueInputOption: 'RAW',
          requestBody: { values: [CATEGORY_HEADERS] }
        });
        
      } catch (createErr) {
        if (!createErr.message.includes('already exists')) {
          throw createErr;
        }
      }
    } else {
      throw err;
    }
  }
}

/**
 * Find category row by coupangCategoryId
 * @returns {object|null} - { rowIndex, data } or null
 */
async function findCategoryById(sheetId, categoryId) {
  const sheets = await getSheetsClient();
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${CATEGORY_TAB_NAME}!A:I`,
  });
  
  const rows = response.data.values || [];
  
  if (rows.length < 2) return null;
  
  const headers = rows[0];
  const idIndex = headers.indexOf('coupangCategoryId');
  
  if (idIndex === -1) return null;
  
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idIndex] === String(categoryId)) {
      const data = {};
      headers.forEach((h, idx) => {
        data[h] = rows[i][idx] || '';
      });
      return { rowIndex: i + 1, data }; // 1-based row index
    }
  }
  
  return null;
}

/**
 * Upsert category to the dictionary sheet
 * @param {string} sheetId - Google Sheet ID
 * @param {string|number} categoryId - Coupang category ID
 * @param {object} categoryInfo - Parsed category info from breadcrumb
 * @returns {object} - { action: 'CREATED'|'UPDATED', categoryId, usedCount }
 */
async function upsertCategory(sheetId, categoryId, categoryInfo) {
  const sheets = await getSheetsClient();
  
  // Ensure sheet exists
  await ensureCategorySheet(sheetId);
  
  const now = new Date().toISOString();
  const existing = await findCategoryById(sheetId, categoryId);
  
  if (existing) {
    // UPDATE: increment usedCount, update lastSeenAt
    const newUsedCount = parseInt(existing.data.usedCount || '0', 10) + 1;
    
    // Update specific cells
    const usedCountCol = 'I'; // usedCount column
    const lastSeenCol = 'H';  // lastSeenAt column
    
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          {
            range: `${CATEGORY_TAB_NAME}!${lastSeenCol}${existing.rowIndex}`,
            values: [[now]]
          },
          {
            range: `${CATEGORY_TAB_NAME}!${usedCountCol}${existing.rowIndex}`,
            values: [[newUsedCount]]
          }
        ]
      }
    });
    
    return {
      action: 'UPDATED',
      coupangCategoryId: categoryId,
      usedCount: newUsedCount
    };
    
  } else {
    // CREATE: insert new row
    const newRow = [
      String(categoryId),
      categoryInfo.depth2Path || '',
      categoryInfo.depth3Path || '',
      categoryInfo.rootName || '',
      categoryInfo.parentName || '',
      categoryInfo.leafName || '',
      now,  // firstSeenAt
      now,  // lastSeenAt
      1     // usedCount
    ];
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${CATEGORY_TAB_NAME}!A:I`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [newRow] }
    });
    
    return {
      action: 'CREATED',
      coupangCategoryId: categoryId,
      depth3Path: categoryInfo.depth3Path
    };
  }
}

/**
 * Get all categories from dictionary
 */
async function getAllCategories(sheetId) {
  const sheets = await getSheetsClient();
  
  await ensureCategorySheet(sheetId);
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${CATEGORY_TAB_NAME}!A:I`,
  });
  
  const rows = response.data.values || [];
  
  if (rows.length < 2) return [];
  
  const headers = rows[0];
  
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx] || '';
    });
    return obj;
  });
}

module.exports = {
  ensureCategorySheet,
  findCategoryById,
  upsertCategory,
  getAllCategories,
  CATEGORY_HEADERS,
  CATEGORY_TAB_NAME
};
