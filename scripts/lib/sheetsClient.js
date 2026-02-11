/**
 * Google Sheets Client
 * Uses Service Account authentication to read/write Google Sheets
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'backend', '.env') });

const { google } = require('googleapis');
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
  
  // Read first row
  const range = `${tabName}!A1:Z1`;
  let existingHeaders = [];
  
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range,
    });
    existingHeaders = response.data.values?.[0] || [];
  } catch (err) {
    // Tab might not exist or be empty
    if (err.message.includes('Unable to parse range')) {
      console.log(`Tab "${tabName}" may not exist. Will create headers.`);
    } else {
      throw err;
    }
  }
  
  // If headers are empty, write all headers
  if (existingHeaders.length === 0) {
    console.log(`Writing headers to ${tabName}...`);
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tabName}!A1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [headers],
      },
    });
    return headers;
  }
  
  // Check for missing headers and append them at the end
  const missingHeaders = headers.filter(h => !existingHeaders.includes(h));
  
  if (missingHeaders.length > 0) {
    const nextColIndex = existingHeaders.length;
    const nextColLetter = String.fromCharCode(65 + nextColIndex); // A=0, B=1, etc.
    
    console.log(`[${new Date().toISOString()}] Extending headers: adding ${missingHeaders.join(', ')} at column ${nextColLetter}`);
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tabName}!${nextColLetter}1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [missingHeaders],
      },
    });
    
    return [...existingHeaders, ...missingHeaders];
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
  
  // Find column index for the key
  const keyColumnIndex = headers.indexOf(keyColumn);
  if (keyColumnIndex === -1) {
    throw new Error(`Key column "${keyColumn}" not found in headers`);
  }
  
  // Find existing row
  const existingRowNum = await findRowByKey(sheetId, tabName, keyColumnIndex, keyValue);
  let existingData = null;
  
  // If row exists, get full existing data for change detection and preservation
  if (existingRowNum && existingRowNum > 1) {
    existingData = await getRowData(sheetId, tabName, existingRowNum, headers);
  }
  
  // Merge data: new data wins, but preserve specified columns from existing if new is empty
  const mergedData = { ...data };
  if (existingData && preserveColumns.length > 0) {
    for (const col of preserveColumns) {
      // Only preserve if existing has a non-empty value and new data is empty/undefined
      if (existingData[col] && (data[col] === undefined || data[col] === '' || data[col] === null)) {
        mergedData[col] = existingData[col];
      }
    }
  }
  
  // Build row values in header order
  const rowValues = headers.map(h => {
    const val = mergedData[h];
    if (val === undefined || val === null) return '';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  });
  
  if (existingRowNum && existingRowNum > 1) {
    // Update existing row
    console.log(`Updating existing row ${existingRowNum} for ${keyColumn}=${keyValue}`);
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tabName}!A${existingRowNum}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [rowValues],
      },
    });
    return { action: 'updated', row: existingRowNum, existingData };
  } else {
    // Append new row
    console.log(`Appending new row for ${keyColumn}=${keyValue}`);
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
