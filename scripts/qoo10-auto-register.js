#!/usr/bin/env node
/**
 * Qoo10 Auto Registration Executor
 * 
 * Reads Coupang products from Google Sheets, resolves JP categories,
 * registers to Qoo10, and writes back results.
 * 
 * Usage:
 *   node scripts/qoo10-auto-register.js [--limit <n>] [--dry-run]
 * 
 * Options:
 *   --limit <n>   Process only first N unregistered rows
 *   --dry-run     Generate payloads without calling API or updating sheet
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') });

const { getSheetsClient } = require('./lib/sheetsClient');
const { registerNewGoods } = require('../backend/qoo10/registerNewGoods');
const { calculateSellingPrice } = require('./lib/qoo10PayloadGenerator');
const { resolveJpCategoryId } = require('./lib/categoryResolver');

// Configuration
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB_NAME = process.env.GOOGLE_SHEET_TAB_NAME || 'coupang_datas';
const MAX_RETRIES = 1;

// Fixed rules (STRICT)
const FIXED_SHIPPING_NO = '471554';
const FIXED_PRODUCTION_PLACE_TYPE = '2';
const FIXED_PRODUCTION_PLACE = 'Overseas';
const FIXED_WEIGHT = '1';

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    limit: null,
    dryRun: false
  };
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      options.limit = parseInt(args[++i], 10);
    } else if (args[i] === '--dry-run') {
      options.dryRun = true;
    }
  }
  
  return options;
}

/**
 * Read all rows from Google Sheets with row indices
 */
async function readSheetRowsWithIndices() {
  const sheets = await getSheetsClient();
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A:Z`,
  });
  
  const rows = response.data.values || [];
  
  if (rows.length < 2) {
    return { headers: [], dataRows: [] };
  }
  
  const headers = rows[0];
  const dataRows = rows.slice(1).map((row, idx) => {
    const obj = { _rowIndex: idx + 2 }; // 1-based, +1 for header
    headers.forEach((header, colIdx) => {
      obj[header] = row[colIdx] || '';
    });
    
    // Parse numeric ItemPrice
    if (obj.ItemPrice) {
      const parsed = parseInt(obj.ItemPrice, 10);
      if (!isNaN(parsed)) {
        obj.ItemPrice = parsed;
      }
    }
    
    return obj;
  });
  
  return { headers, dataRows };
}

/**
 * Update a specific row in Google Sheets
 */
async function updateSheetRow(rowIndex, updates) {
  const sheets = await getSheetsClient();
  
  // Get headers to find column indices
  const headersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!1:1`,
  });
  
  const headers = headersResponse.data.values?.[0] || [];
  
  // Build batch update requests
  const updateRequests = [];
  
  for (const [field, value] of Object.entries(updates)) {
    let colIndex = headers.indexOf(field);
    
    // If column doesn't exist, add it
    if (colIndex === -1) {
      colIndex = headers.length;
      headers.push(field);
      
      // Update header row
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${TAB_NAME}!${columnLetter(colIndex)}1`,
        valueInputOption: 'RAW',
        requestBody: { values: [[field]] }
      });
    }
    
    updateRequests.push({
      range: `${TAB_NAME}!${columnLetter(colIndex)}${rowIndex}`,
      values: [[value]]
    });
  }
  
  // Batch update
  if (updateRequests.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: updateRequests
      }
    });
  }
}

/**
 * Convert column index to letter (0=A, 1=B, etc.)
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
 * Validate row for registration
 */
function validateRow(row) {
  // Skip if already registered
  if (row.qoo10ItemId) {
    return { valid: false, reason: 'Already registered (qoo10ItemId exists)' };
  }
  
  if (!row.vendorItemId && !row.itemId) {
    return { valid: false, reason: 'Missing vendorItemId and itemId' };
  }
  
  if (!row.ItemPrice || row.ItemPrice <= 0) {
    return { valid: false, reason: 'Missing or invalid ItemPrice' };
  }
  
  if (!row.categoryId) {
    return { valid: false, reason: 'Missing categoryId' };
  }
  
  if (!row.ItemTitle) {
    return { valid: false, reason: 'Missing ItemTitle' };
  }
  
  return { valid: true };
}

/**
 * Normalize image URL
 */
function normalizeImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  
  if (url.startsWith('thumbnails/')) {
    return `https://thumbnail.coupangcdn.com/${url}`;
  }
  
  return url;
}

/**
 * Parse ExtraImages to array
 */
function parseExtraImages(extraImages) {
  if (!extraImages) return [];
  
  try {
    if (typeof extraImages === 'string' && extraImages.startsWith('[')) {
      return JSON.parse(extraImages);
    }
    return [];
  } catch (e) {
    return [];
  }
}

/**
 * Build Qoo10 registration payload from sheet row
 * @param {object} row - Sheet row data
 * @param {object} categoryResolution - Resolved JP category from categoryResolver
 */
function buildRegistrationPayload(row, categoryResolution) {
  const sellingPrice = calculateSellingPrice(row.ItemPrice);
  const sellerCode = `auto_${row.vendorItemId || row.itemId}`;
  
  // Parse extra images
  const extraImages = parseExtraImages(row.ExtraImages);
  
  // Use resolved JP category ID (never null due to FALLBACK)
  const jpCategoryId = categoryResolution?.jpCategoryId || row.categoryId;
  
  // Build payload matching registerNewGoods.js expected format
  const payload = {
    SecondSubCat: jpCategoryId,
    ItemTitle: row.ItemTitle,
    ItemPrice: String(sellingPrice),
    ItemQty: '100',
    ShippingNo: FIXED_SHIPPING_NO,
    StandardImage: normalizeImageUrl(row.StandardImage),
    ItemDescription: row.ItemDescriptionText || row.ItemTitle || '<p>Product description</p>',
    ProductionPlaceType: FIXED_PRODUCTION_PLACE_TYPE,
    ProductionPlace: FIXED_PRODUCTION_PLACE,
    Weight: FIXED_WEIGHT,
    
    // Extra images if available
    ExtraImages: extraImages.map(url => normalizeImageUrl(url)),
    
    // Options handling - simplified for single option
    // registerNewGoods.js handles Options internally
  };
  
  // Parse and add options if present
  if (row.Options) {
    try {
      const options = typeof row.Options === 'string' ? JSON.parse(row.Options) : row.Options;
      if (options && options.type && Array.isArray(options.values) && options.values.length > 0) {
        payload.Options = options;
      }
    } catch (e) {
      // No options
    }
  }
  
  return {
    payload,
    sellerCode,
    sellingPrice
  };
}

/**
 * Register a single product to Qoo10
 */
async function registerProduct(row, dryRun = false) {
  const vendorItemId = row.vendorItemId || row.itemId;
  
  // Validate
  const validation = validateRow(row);
  if (!validation.valid) {
    return {
      status: 'SKIPPED',
      vendorItemId,
      reason: validation.reason
    };
  }
  
  // Resolve JP category (never fails - has FALLBACK)
  let categoryResolution;
  try {
    categoryResolution = await resolveJpCategoryId({
      categoryId: row.categoryId,
      categoryPath2: row.categoryPath2 || '',
      categoryPath3: row.categoryPath3 || ''
    });
  } catch (catErr) {
    console.warn(`[Registration] Category resolution error: ${catErr.message}, using FALLBACK`);
    categoryResolution = {
      jpCategoryId: '320002604', // Hardcoded fallback
      matchType: 'FALLBACK',
      confidence: 0
    };
  }
  
  console.log(`  Category: ${row.categoryId} → ${categoryResolution.jpCategoryId} (${categoryResolution.matchType})`);
  
  // Build payload with resolved category
  const { payload, sellerCode, sellingPrice } = buildRegistrationPayload(row, categoryResolution);
  
  if (dryRun) {
    return {
      status: 'DRY_RUN',
      vendorItemId,
      sellerCode,
      qoo10SellingPrice: sellingPrice,
      categoryResolution,
      payload
    };
  }
  
  // Call Qoo10 API with retry
  let lastError = null;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await registerNewGoods(payload);
      
      if (result.success && result.createdItemId) {
        // Determine registration status based on matchType
        // FALLBACK = WARNING even if API succeeds
        const registrationStatus = categoryResolution.matchType === 'FALLBACK' ? 'WARNING' : 'SUCCESS';
        
        return {
          status: registrationStatus,
          vendorItemId,
          qoo10ItemId: result.createdItemId,
          qoo10SellingPrice: sellingPrice,
          sellerCode: result.sellerCodeUsed,
          categoryResolution
        };
      }
      
      // API returned but not successful
      lastError = result.resultMsg || 'Unknown API error';
      
      if (result.resultCode === -1 && result.resultMsg.includes('Dry-run')) {
        // Dry-run mode from registerNewGoods
        return {
          status: 'DRY_RUN_API',
          vendorItemId,
          qoo10SellingPrice: sellingPrice,
          reason: 'QOO10_ALLOW_REAL_REG not enabled',
          categoryResolution
        };
      }
      
    } catch (err) {
      lastError = err.message;
    }
    
    // Wait before retry
    if (attempt < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return {
    status: 'FAILED',
    vendorItemId,
    apiError: lastError,
    categoryResolution
  };
}

/**
 * Main execution function
 */
async function main() {
  const options = parseArgs();
  
  console.log('='.repeat(60));
  console.log('  Qoo10 Auto Registration Executor');
  console.log('='.repeat(60));
  console.log(`  Sheet ID: ${SHEET_ID || '(not set!)'}`);
  console.log(`  Tab: ${TAB_NAME}`);
  console.log(`  Mode: ${options.dryRun ? 'DRY-RUN' : 'LIVE'}`);
  console.log(`  QOO10_ALLOW_REAL_REG: ${process.env.QOO10_ALLOW_REAL_REG || '0'}`);
  console.log('='.repeat(60));
  console.log('');
  
  if (!SHEET_ID) {
    console.error('Error: GOOGLE_SHEET_ID not configured');
    process.exit(1);
  }
  
  try {
    // Read sheet data
    console.log('Reading data from Google Sheets...');
    const { headers, dataRows } = await readSheetRowsWithIndices();
    
    console.log(`Found ${dataRows.length} total rows`);
    
    // Filter unregistered rows
    let rowsToProcess = dataRows.filter(row => !row.qoo10ItemId);
    console.log(`Unregistered rows: ${rowsToProcess.length}`);
    
    // Apply limit
    if (options.limit && options.limit > 0) {
      rowsToProcess = rowsToProcess.slice(0, options.limit);
      console.log(`Limited to ${options.limit} rows`);
    }
    
    if (rowsToProcess.length === 0) {
      console.log('\nNo rows to process');
      return;
    }
    
    console.log(`\nProcessing ${rowsToProcess.length} rows...\n`);
    
    // Results tracking
    const results = {
      success: [],
      skipped: [],
      failed: [],
      dryRun: []
    };
    
    // Process each row
    for (const row of rowsToProcess) {
      const vendorItemId = row.vendorItemId || row.itemId;
      console.log(`Processing: ${vendorItemId}...`);
      
      const result = await registerProduct(row, options.dryRun);
      
      switch (result.status) {
        case 'SUCCESS':
          console.log(`  ✓ SUCCESS: qoo10ItemId=${result.qoo10ItemId}, price=${result.qoo10SellingPrice}`);
          results.success.push(result);
          
          // Update Google Sheet
          try {
            await updateSheetRow(row._rowIndex, {
              qoo10ItemId: result.qoo10ItemId,
              qoo10SellingPrice: result.qoo10SellingPrice,
              updatedAt: new Date().toISOString()
            });
            console.log(`  ✓ Sheet updated`);
          } catch (sheetErr) {
            console.log(`  ✗ Sheet update failed: ${sheetErr.message}`);
          }
          break;
          
        case 'SKIPPED':
          console.log(`  → SKIPPED: ${result.reason}`);
          results.skipped.push(result);
          break;
          
        case 'FAILED':
          console.log(`  ✗ FAILED: ${result.apiError}`);
          results.failed.push(result);
          break;
          
        case 'DRY_RUN':
        case 'DRY_RUN_API':
          console.log(`  → DRY-RUN: price=${result.qoo10SellingPrice}`);
          results.dryRun.push(result);
          break;
      }
      
      console.log('');
    }
    
    // Summary
    console.log('='.repeat(60));
    console.log('  Summary');
    console.log('='.repeat(60));
    console.log(`  SUCCESS:  ${results.success.length}`);
    console.log(`  SKIPPED:  ${results.skipped.length}`);
    console.log(`  FAILED:   ${results.failed.length}`);
    console.log(`  DRY-RUN:  ${results.dryRun.length}`);
    console.log('');
    
    // Detailed results
    if (results.success.length > 0) {
      console.log('=== Successful Registrations ===');
      results.success.forEach(r => {
        console.log(`  ${r.vendorItemId}: qoo10ItemId=${r.qoo10ItemId}, price=${r.qoo10SellingPrice}`);
      });
      console.log('');
    }
    
    if (results.failed.length > 0) {
      console.log('=== Failed Registrations ===');
      results.failed.forEach(r => {
        console.log(`  ${r.vendorItemId}: ${r.apiError}`);
      });
      console.log('');
    }
    
    if (results.skipped.length > 0) {
      console.log('=== Skipped Rows ===');
      results.skipped.forEach(r => {
        console.log(`  ${r.vendorItemId}: ${r.reason}`);
      });
      console.log('');
    }
    
    console.log('Done.');
    
  } catch (err) {
    console.error('\nFatal error:', err.message);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
