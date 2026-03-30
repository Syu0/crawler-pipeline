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
const { updateExistingGoods } = require('../backend/qoo10/updateGoods');
const { editGoodsMultiImage } = require('../backend/qoo10/editGoodsMultiImage');
const { calculateSellingPrice } = require('./lib/qoo10PayloadGenerator');
const { resolveJpCategoryId } = require('./lib/categoryResolver');
const { decideItemPriceJpy } = require('../backend/pricing/priceDecision');
const { translateTitle } = require('../backend/qoo10/titleTranslator');

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
    range: `${TAB_NAME}!A:AZ`,  // A:Z → A:AZ: status 컬럼(AI)이 26열 초과
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
    range: `${TAB_NAME}!A1:AZ1`,
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
 * Validate row for registration or update
 * @param {object} row - Row data
 * @param {boolean} isUpdateMode - True if this is an UPDATE operation
 */
function validateRow(row, isUpdateMode = false) {
  // For CREATE mode: skip if already registered
  // For UPDATE mode: qoo10ItemId is required, not a skip condition
  if (!isUpdateMode && row.qoo10ItemId) {
    return { valid: false, reason: 'Already registered (qoo10ItemId exists)' };
  }
  
  // For UPDATE mode: must have qoo10ItemId
  if (isUpdateMode && !row.qoo10ItemId) {
    return { valid: false, reason: 'UPDATE mode requires qoo10ItemId' };
  }
  
  if (!row.vendorItemId && !row.itemId) {
    return { valid: false, reason: 'Missing vendorItemId and itemId' };
  }
  
  // Price validation - required for CREATE, optional for UPDATE
  if (!isUpdateMode && (!row.ItemPrice || row.ItemPrice <= 0)) {
    return { valid: false, reason: 'Missing or invalid ItemPrice' };
  }
  
  // Category validation - required for CREATE, optional for UPDATE
  if (!isUpdateMode && !row.categoryId) {
    return { valid: false, reason: 'Missing categoryId' };
  }
  
  // Title validation - required for CREATE, optional for UPDATE
  if (!isUpdateMode && !row.ItemTitle) {
    return { valid: false, reason: 'Missing ItemTitle' };
  }

  // Image validation - required for CREATE
  if (!isUpdateMode && !row.StandardImage) {
    return { valid: false, reason: 'Missing StandardImage' };
  }

  return { valid: true };
}

/**
 * Normalize image URL
 */
function normalizeImageUrl(url) {
  if (!url || typeof url !== 'string') return '';

  if (url.startsWith('//')) {
    return `https:${url}`;
  }

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
    if (typeof extraImages === 'string') {
      if (extraImages.startsWith('[')) {
        return JSON.parse(extraImages);
      }
      // pipe-separated or single URL
      return extraImages.split('|').map(u => u.trim()).filter(u => u);
    }
    if (Array.isArray(extraImages)) return extraImages;
    return [];
  } catch (e) {
    return [];
  }
}

/**
 * Build Qoo10 registration payload from sheet row
 * NOTE: Price validation is done by caller (registerProduct)
 * 
 * @param {object} row - Sheet row data
 * @param {object} categoryResolution - Resolved JP category from categoryResolver
 * @param {string} computedPriceJpy - Pre-validated JPY price
 * @returns {{ payload, sellerCode, sellingPrice }}
 */
function buildRegistrationPayload(row, categoryResolution, computedPriceJpy) {
  const vendorItemId = row.vendorItemId || row.itemId;
  const sellerCode = `auto_${vendorItemId}`;
  
  // Parse extra images
  const extraImages = parseExtraImages(row.ExtraImages);
  
  // Use resolved JP category ID (never null due to FALLBACK)
  const jpCategoryId = categoryResolution?.jpCategoryId || row.categoryId;
  
  // Build payload matching registerNewGoods.js expected format
  const payload = {
    SecondSubCat: jpCategoryId,
    ItemTitle: row.ItemTitle,
    ItemPrice: String(computedPriceJpy),
    ItemQty: '100',
    ShippingNo: FIXED_SHIPPING_NO,
    StandardImage: normalizeImageUrl(row.StandardImage),
    ItemDescription: row.ItemDescriptionText || row.ItemTitle || '<p>Product description</p>',
    ProductionPlaceType: FIXED_PRODUCTION_PLACE_TYPE,
    ProductionPlace: FIXED_PRODUCTION_PLACE,
    Weight: FIXED_WEIGHT,
    
    // Extra images if available
    ExtraImages: extraImages.map(url => normalizeImageUrl(url)),
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
    sellingPrice: computedPriceJpy
  };
}

/**
 * Register or update a single product on Qoo10
 * Mode: CREATE if qoo10ItemId is empty, UPDATE if qoo10ItemId exists
 * 
 * STRICT: ItemPrice (KRW) and WeightKg are REQUIRED.
 * If invalid, fails with FAILED status.
 * Computed JPY is written back to qoo10SellingPrice pre-API.
 * 
 * @param {object} row - Row data from sheet
 * @param {boolean} dryRun - If true, skip API call
 * @param {object} sheetsClient - Google Sheets API client (for shipping lookup)
 */
async function registerProduct(row, dryRun = false, sheetsClient = null) {
  const vendorItemId = row.vendorItemId || row.itemId;
  const existingQoo10ItemId = row.qoo10ItemId || '';
  const isUpdateMode = existingQoo10ItemId && existingQoo10ItemId.trim() !== '';
  
  // Validate - pass isUpdateMode so UPDATE rows don't get skipped
  const validation = validateRow(row, isUpdateMode);
  if (!validation.valid) {
    return {
      status: 'SKIPPED',
      vendorItemId,
      reason: validation.reason,
      mode: isUpdateMode ? 'UPDATE' : 'CREATE'
    };
  }
  
  // ===== STRICT PRICE VALIDATION =====
  // Validate ItemPrice (KRW) and WeightKg BEFORE category resolution or any other work
  // Uses Txlogis_standard for dynamic Japan shipping fee lookup
  const priceDecision = await decideItemPriceJpy({
    row: row,
    vendorItemId: vendorItemId,
    mode: isUpdateMode ? 'UPDATE' : 'CREATE',
    sheetsClient: sheetsClient,
    sheetId: SHEET_ID
  });
  
  // Return computed price even if validation failed (for sheet write-back)
  const computedPriceJpy = priceDecision.valid ? priceDecision.priceJpy : '';
  
  if (!priceDecision.valid) {
    // STRICT: Required inputs missing - fail immediately
    return {
      status: 'FAILED',
      vendorItemId,
      apiError: priceDecision.error,
      mode: isUpdateMode ? 'UPDATE' : 'CREATE',
      qoo10SellingPrice: computedPriceJpy, // Empty, but include for consistency
      qoo10ItemId: existingQoo10ItemId || null,
      priceValidationFailed: true
    };
  }
  
  // categoryPath3가 없으면 coupang_categorys에서 보완
  if (!row.categoryPath3 && row.categoryId && sheetsClient) {
    try {
      const catRes = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'coupang_categorys!A:I',
      });
      const catRows = catRes.data.values || [];
      const catHeader = catRows[0] || [];
      const idIdx = catHeader.indexOf('coupangCategoryId');
      const path3Idx = catHeader.indexOf('depth3Path');
      const path2Idx = catHeader.indexOf('depth2Path');
      const found = catRows.find((r, i) => i > 0 && r[idIdx] === String(row.categoryId));
      if (found) {
        row.categoryPath3 = found[path3Idx] || '';
        row.categoryPath2 = found[path2Idx] || '';
        console.log(`  Category path (from coupang_categorys): ${row.categoryPath3}`);
      }
    } catch (e) {
      // 무시 — FALLBACK으로 진행
    }
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
  
  // Check if category was manually changed in sheet
  const manualCategoryOverride = row.jpCategoryIdUsed && 
    row.jpCategoryIdUsed !== categoryResolution.jpCategoryId &&
    row.categoryMatchType === 'MANUAL';
  
  if (manualCategoryOverride) {
    // Use the manually set category from sheet
    categoryResolution = {
      jpCategoryId: row.jpCategoryIdUsed,
      matchType: 'MANUAL',
      confidence: 1.0,
      coupangCategoryKey: categoryResolution.coupangCategoryKey
    };
    console.log(`  Category: Using MANUAL override → ${categoryResolution.jpCategoryId}`);
  } else {
    console.log(`  Category: ${row.categoryId} → ${categoryResolution.jpCategoryId} (${categoryResolution.matchType})`);
  }
  
  // Build payload with validated price and resolved category
  const sellerCode = `auto_${vendorItemId}`;
  const sellingPrice = priceDecision.priceJpy;
  const extraImages = parseExtraImages(row.ExtraImages);
  const jpCategoryId = categoryResolution?.jpCategoryId || row.categoryId;

  // ── 타이틀 번역 (한국어 → 일본어 SEO 최적화) ──
  let itemTitle = row.ItemTitle;
  let titleMethod = 'fallback';
  try {
    const categoryPath = row.categoryPath3 || row.categoryPath2 || null;
    const titleResult = await translateTitle(row.ItemTitle, categoryPath);
    itemTitle = titleResult.jpTitle;
    titleMethod = titleResult.method;
    console.log(`  Title [${titleResult.method}]: ${row.ItemTitle.slice(0, 30)}... → ${itemTitle}`);
  } catch (titleErr) {
    console.warn(`  Title translation failed (${titleErr.message}), using original`);
  }

  const payload = {
    SecondSubCat: jpCategoryId,
    ItemTitle: itemTitle,
    ItemPrice: String(sellingPrice),
    ItemQty: '100',
    ShippingNo: FIXED_SHIPPING_NO,
    StandardImage: normalizeImageUrl(row.StandardImage),
    ItemDescription: row.ItemDescriptionText || row.ItemTitle || '<p>Product description</p>',
    ProductionPlaceType: FIXED_PRODUCTION_PLACE_TYPE,
    ProductionPlace: FIXED_PRODUCTION_PLACE,
    Weight: FIXED_WEIGHT,
    ExtraImages: extraImages.map(url => normalizeImageUrl(url)),
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
  
  if (dryRun) {
    return {
      status: 'DRY_RUN',
      vendorItemId,
      sellerCode,
      qoo10SellingPrice: sellingPrice,
      categoryResolution,
      payload,
      mode: isUpdateMode ? 'UPDATE' : 'CREATE',
      qoo10ItemId: existingQoo10ItemId || null,
      titleMethod
    };
  }
  
  // ===== UPDATE MODE =====
  if (isUpdateMode) {
    console.log(`[Registration] Updating existing Qoo10 item: ${existingQoo10ItemId}`);
    
    // Pass ALL fields like SetNewGoods - updateExistingGoods will build full payload
    const updateResult = await updateExistingGoods({
      ItemCode: existingQoo10ItemId,
      // All fields from payload (like SetNewGoods)
      SecondSubCat: payload.SecondSubCat,
      ItemTitle: payload.ItemTitle,
      ItemPrice: payload.ItemPrice,
      ItemQty: payload.ItemQty || '100',
      StandardImage: payload.StandardImage,
      ItemDescription: payload.ItemDescription,
      Weight: payload.Weight,
      ProductionPlaceType: payload.ProductionPlaceType,
      ProductionPlace: payload.ProductionPlace,
      ShippingNo: FIXED_SHIPPING_NO,
      // Additional fields for structural parity with SetNewGoods
      RetailPrice: '0',
      TaxRate: 'S',
      ExpireDate: '2030-12-31',
      AdultYN: 'N',
      AvailableDateType: '0',
      AvailableDateValue: '2',
    }, row);
    
    if (updateResult.dryRun) {
      return {
        status: 'DRY_RUN',
        vendorItemId,
        qoo10ItemId: existingQoo10ItemId,
        qoo10SellingPrice: sellingPrice,
        sellerCode: row.qoo10SellerCode || sellerCode,
        categoryResolution,
        mode: 'UPDATE',
        payload: updateResult.payload,
        itemTitle: payload.ItemTitle,
        titleMethod
      };
    }

    if (updateResult.success) {
      // Upload extra images
      if (payload.ExtraImages && payload.ExtraImages.length > 0) {
        const multiImageResult = await editGoodsMultiImage(existingQoo10ItemId, payload.ExtraImages);
        if (!multiImageResult.success && !multiImageResult.dryRun) {
          console.warn(`[Registration] MultiImage upload failed: ${multiImageResult.resultMsg}`);
        }
      }

      // Determine status based on category match type
      const registrationStatus = categoryResolution.matchType === 'FALLBACK' ? 'WARNING' : 'SUCCESS';

      return {
        status: registrationStatus,
        vendorItemId,
        qoo10ItemId: existingQoo10ItemId,
        qoo10SellingPrice: sellingPrice,
        sellerCode: row.qoo10SellerCode || sellerCode,
        categoryResolution,
        mode: 'UPDATE',
        itemTitle: payload.ItemTitle,
        titleMethod
      };
    } else {
      return {
        status: 'FAILED',
        vendorItemId,
        qoo10ItemId: existingQoo10ItemId,
        qoo10SellingPrice: sellingPrice, // Still include computed price for write-back
        apiError: updateResult.resultMsg,
        categoryResolution,
        mode: 'UPDATE',
        titleMethod
      };
    }
  }
  
  // ===== CREATE MODE =====
  console.log(`[Registration] Creating new Qoo10 item`);
  
  // Call Qoo10 API with retry
  let lastError = null;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await registerNewGoods(payload);
      
      if (result.success && result.createdItemId) {
        // Upload extra images after successful registration
        if (payload.ExtraImages && payload.ExtraImages.length > 0) {
          const multiImageResult = await editGoodsMultiImage(result.createdItemId, payload.ExtraImages);
          if (!multiImageResult.success && !multiImageResult.dryRun) {
            console.warn(`[Registration] MultiImage upload failed: ${multiImageResult.resultMsg}`);
          }
        }

        // Determine registration status based on matchType
        // FALLBACK = WARNING even if API succeeds
        const registrationStatus = categoryResolution.matchType === 'FALLBACK' ? 'WARNING' : 'SUCCESS';

        return {
          status: registrationStatus,
          vendorItemId,
          qoo10ItemId: result.createdItemId,
          qoo10SellingPrice: sellingPrice,
          sellerCode: result.sellerCodeUsed,
          categoryResolution,
          mode: 'CREATE',
          itemTitle: payload.ItemTitle,
          titleMethod
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
          categoryResolution,
          mode: 'CREATE',
          titleMethod
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
    qoo10SellingPrice: sellingPrice, // Include computed price for write-back
    apiError: lastError,
    categoryResolution,
    mode: 'CREATE',
    titleMethod
  };
}

/**
 * Main execution function
 */
async function main() {
  const options = parseArgs();
  
  const isRealMode = !options.dryRun && process.env.QOO10_ALLOW_REAL_REG === '1';
  
  console.log('='.repeat(60));
  console.log('  Qoo10 Auto Registration Executor');
  console.log('='.repeat(60));
  console.log(`  Sheet ID: ${SHEET_ID || '(not set!)'}`);
  console.log(`  Tab: ${TAB_NAME}`);
  console.log(`  Mode: ${options.dryRun ? 'DRY-RUN' : (isRealMode ? 'REAL' : 'DRY-RUN (QOO10_ALLOW_REAL_REG=0)')}`);
  console.log(`  QOO10_ALLOW_REAL_REG: ${process.env.QOO10_ALLOW_REAL_REG || '0'}`);
  console.log('');
  console.log('  Write-back columns:');
  console.log('    - jpCategoryIdUsed, categoryMatchType, categoryMatchConfidence');
  console.log('    - registrationMode, registrationStatus, registrationMessage');
  console.log('    - qoo10ItemId, qoo10SellerCode, qoo10SellingPrice, lastRegisteredAt');
  console.log('='.repeat(60));
  console.log('');
  
  if (!SHEET_ID) {
    console.error('Error: GOOGLE_SHEET_ID not configured');
    process.exit(1);
  }
  
  try {
    // Get sheets client for shipping lookup
    const sheets = await getSheetsClient();
    
    // Read sheet data
    console.log('Reading data from Google Sheets...');
    const { headers, dataRows } = await readSheetRowsWithIndices();
    
    console.log(`Found ${dataRows.length} total rows`);
    
    // Count row categories
    // CREATE: status=REGISTER_READY + qoo10ItemId 없음 (신규 등록)
    // UPDATE: qoo10ItemId 있고 needsUpdate=YES (기존 상품 업데이트, status 무관)
    const unregisteredRows = dataRows.filter(r => r.status === 'REGISTER_READY' && !r.qoo10ItemId);
    const registeredNeedsUpdate = dataRows.filter(r => r.qoo10ItemId && r.needsUpdate === 'YES');
    const registeredNoUpdate = dataRows.filter(r => r.qoo10ItemId && r.needsUpdate !== 'YES');

    console.log(`  REGISTER_READY (CREATE): ${unregisteredRows.length}`);
    console.log(`  Registered + needsUpdate=YES (UPDATE): ${registeredNeedsUpdate.length}`);
    console.log(`  Registered + no update: ${registeredNoUpdate.length} (will skip)`);
    
    // Filter rows based on mode
    let rowsToProcess = [...unregisteredRows, ...registeredNeedsUpdate];
    
    console.log(`\nRows to process: ${rowsToProcess.length}`);
    
    // Apply limit
    if (options.limit && options.limit > 0) {
      rowsToProcess = rowsToProcess.slice(0, options.limit);
      console.log(`Limited to ${options.limit} rows`);
    }
    
    if (rowsToProcess.length === 0) {
      console.log('\nNo rows to process.');
      if (registeredNoUpdate.length > 0) {
        console.log(`Tip: ${registeredNoUpdate.length} registered rows were skipped.`);
        console.log('     To update them, set needsUpdate="YES" in the sheet.');
      }
      return;
    }
    
    console.log(`\nProcessing ${rowsToProcess.length} rows...\n`);
    
    // Results tracking
    const results = {
      success: [],
      skipped: [],
      failed: [],
      dryRun: [],
      noChanges: []
    };
    
    // Process each row
    for (const row of rowsToProcess) {
      const vendorItemId = row.vendorItemId || row.itemId;
      const isUpdate = row.qoo10ItemId && row.qoo10ItemId.trim() !== '';

      // REGISTERING 락 — 이미 등록 시도 중인 row 건너뜀 (중복 실행 방지)
      if (row.status === 'REGISTERING') {
        console.log(`  → SKIP: ${vendorItemId} is locked (status=REGISTERING)`);
        results.skipped.push({ vendorItemId, reason: 'Already REGISTERING (lock)' });
        console.log('');
        continue;
      }

      if (isUpdate) {
        console.log(`Processing: ${vendorItemId} [UPDATE requested via needsUpdate=YES]`);
      } else {
        console.log(`Processing: ${vendorItemId} [CREATE]`);
      }

      // 등록 시작 전 REGISTERING 락 설정 (실제 API 호출 시에만 — DRY-RUN 또는 QOO10_ALLOW_REAL_REG=0 이면 락 안 걺)
      if (isRealMode) {
        try {
          await updateSheetRow(row._rowIndex, { status: 'REGISTERING' });
        } catch (e) {
          console.warn(`  ⚠ Could not set REGISTERING lock: ${e.message}`);
        }
      }

      const result = await registerProduct(row, options.dryRun, sheets);
      
      // Prepare sheet update with category tracking (including coupangCategoryKeyUsed)
      const categoryUpdate = result.categoryResolution ? {
        jpCategoryIdUsed: result.categoryResolution.jpCategoryId || '',
        categoryMatchType: result.categoryResolution.matchType || '',
        categoryMatchConfidence: result.categoryResolution.confidence !== undefined 
          ? String(result.categoryResolution.confidence) 
          : '',
        coupangCategoryKeyUsed: result.categoryResolution.coupangCategoryKey || ''
      } : {};
      
      switch (result.status) {
        case 'SUCCESS':
          console.log(`  ✓ SUCCESS [${result.mode || 'CREATE'}]: qoo10ItemId=${result.qoo10ItemId}, price=${result.qoo10SellingPrice}, jpCat=${result.categoryResolution?.jpCategoryId}`);
          if (result.itemTitle) console.log(`    ItemTitle: ${result.itemTitle}`);
          if (result.fieldsUpdated && result.fieldsUpdated.length > 0) {
            console.log(`    Fields updated: [${result.fieldsUpdated.join(', ')}]`);
          }
          results.success.push(result);
          
          // Update Google Sheet - preserve existing values, don't overwrite with empty
          try {
            const sheetUpdate = {
              ...categoryUpdate,
              status: 'REGISTERED',
              registrationMode: 'REAL',
              registrationStatus: 'SUCCESS',
              registrationMessage: `[titleMethod=${result.titleMethod || 'fallback'}] ${result.mode === 'UPDATE' ? 'Updated successfully' : 'Registered successfully'}`,
              lastRegisteredAt: new Date().toISOString()
            };
            
            // Only set these if we have values (don't overwrite existing with empty)
            if (result.qoo10ItemId) sheetUpdate.qoo10ItemId = result.qoo10ItemId;
            if (result.qoo10SellingPrice) sheetUpdate.qoo10SellingPrice = result.qoo10SellingPrice;
            if (result.sellerCode) sheetUpdate.qoo10SellerCode = result.sellerCode;
            
            // Clear needsUpdate flag after successful update
            if (result.mode === 'UPDATE') {
              sheetUpdate.needsUpdate = 'NO';
              sheetUpdate.changeFlags = '';
            }
            
            await updateSheetRow(row._rowIndex, sheetUpdate);
            console.log(`  ✓ Sheet updated`);
          } catch (sheetErr) {
            console.log(`  ✗ Sheet update failed: ${sheetErr.message}`);
          }
          break;
          
        case 'NO_CHANGES':
          console.log(`  → NO_CHANGES: ${result.message}`);
          results.noChanges.push(result);
          // Don't update sheet - nothing changed
          break;
          
        case 'WARNING':
          console.log(`  ⚠ WARNING [${result.mode || 'CREATE'}]: qoo10ItemId=${result.qoo10ItemId}, price=${result.qoo10SellingPrice} (FALLBACK category used)`);
          results.success.push(result); // Still counts as successful registration
          
          // Update Google Sheet with WARNING status
          try {
            const warningUpdate = {
              ...categoryUpdate,
              status: 'REGISTERED',
              registrationMode: 'REAL',
              registrationStatus: 'WARNING',
              registrationMessage: `[titleMethod=${result.titleMethod || 'fallback'}] FALLBACK category used (review required)`,
              lastRegisteredAt: new Date().toISOString()
            };
            
            if (result.qoo10ItemId) warningUpdate.qoo10ItemId = result.qoo10ItemId;
            if (result.qoo10SellingPrice) warningUpdate.qoo10SellingPrice = result.qoo10SellingPrice;
            if (result.sellerCode) warningUpdate.qoo10SellerCode = result.sellerCode;
            
            if (result.mode === 'UPDATE') {
              warningUpdate.needsUpdate = 'NO';
              warningUpdate.changeFlags = '';
            }
            
            await updateSheetRow(row._rowIndex, warningUpdate);
            console.log(`  ⚠ Sheet updated (WARNING status)`);
          } catch (sheetErr) {
            console.log(`  ✗ Sheet update failed: ${sheetErr.message}`);
          }
          break;
          
        case 'SKIPPED':
          console.log(`  → SKIPPED: ${result.reason}`);
          results.skipped.push(result);
          break;
          
        case 'FAILED':
          console.log(`  ✗ FAILED [${result.mode || 'CREATE'}]: ${result.apiError}`);
          results.failed.push(result);
          
          // Update sheet with FAILED status
          // STRICT: Always write back computed JPY price even on failure
          try {
            const failedUpdate = {
              ...categoryUpdate,
              status: 'ERROR',
              registrationMode: 'REAL',
              registrationStatus: 'FAILED',
              registrationMessage: result.apiError || 'API error',
              lastRegisteredAt: new Date().toISOString()
            };
            
            // Always write back computed price (even if empty on price validation failure)
            if (result.qoo10SellingPrice) {
              failedUpdate.qoo10SellingPrice = result.qoo10SellingPrice;
            }
            
            await updateSheetRow(row._rowIndex, failedUpdate);
          } catch (sheetErr) {
            // Ignore sheet update error on failed registration
          }
          break;
          
        case 'DRY_RUN':
        case 'DRY_RUN_API': {
          // Determine DRY-RUN status based on matchType
          const dryRunStatus = result.categoryResolution?.matchType === 'FALLBACK' ? 'WARNING' : 'DRY_RUN';
          const dryRunMessage = result.categoryResolution?.matchType === 'FALLBACK'
            ? `[titleMethod=${result.titleMethod || 'fallback'}] DRY-RUN with FALLBACK category (review required)`
            : `[titleMethod=${result.titleMethod || 'fallback'}] DRY-RUN completed`;

          console.log(`  → DRY-RUN [${result.mode || 'CREATE'}]: price=${result.qoo10SellingPrice}, jpCat=${result.categoryResolution?.jpCategoryId} (${result.categoryResolution?.matchType})`);
          if (result.itemTitle) console.log(`    ItemTitle: ${result.itemTitle}`);
          results.dryRun.push(result);

          // ALWAYS write back category resolution even in DRY-RUN.
          // Also reset status to COLLECTED — the REGISTERING lock may have been set
          // if --dry-run flag was omitted but QOO10_ALLOW_REAL_REG was not enabled.
          try {
            await updateSheetRow(row._rowIndex, {
              ...categoryUpdate,
              status: 'REGISTER_READY',   // release REGISTERING lock if it was set
              qoo10SellingPrice: result.qoo10SellingPrice,
              qoo10SellerCode: result.sellerCode || '',
              registrationMode: 'DRY_RUN',
              registrationStatus: dryRunStatus,
              registrationMessage: dryRunMessage,
              lastRegisteredAt: new Date().toISOString()
            });
            console.log(`  → Qoo10에 실제 변경 없음 (dry-run). 시트: 카테고리/가격 write-back만 수행`);
          } catch (sheetErr) {
            console.log(`  ✗ Sheet update failed: ${sheetErr.message}`);
          }
          break;
        }
      }
      
      console.log('');
    }
    
    // Summary
    console.log('='.repeat(60));
    console.log('  Summary');
    console.log('='.repeat(60));
    console.log(`  SUCCESS:    ${results.success.length}`);
    console.log(`  NO_CHANGES: ${results.noChanges.length}`);
    console.log(`  SKIPPED:    ${results.skipped.length}`);
    console.log(`  FAILED:     ${results.failed.length}`);
    console.log(`  DRY-RUN:    ${results.dryRun.length}`);
    console.log('');
    
    // Mode breakdown
    const createResults = [...results.success, ...results.dryRun].filter(r => r.mode === 'CREATE' || !r.mode);
    const updateResults = [...results.success, ...results.dryRun, ...results.noChanges].filter(r => r.mode === 'UPDATE');
    console.log('  Mode Breakdown:');
    console.log(`    CREATE: ${createResults.length}`);
    console.log(`    UPDATE: ${updateResults.length}`);
    console.log('');
    
    // Category match type breakdown
    const allProcessed = [...results.success, ...results.dryRun, ...results.failed];
    const matchTypeCounts = { MANUAL: 0, AUTO: 0, FALLBACK: 0 };
    allProcessed.forEach(r => {
      if (r.categoryResolution?.matchType) {
        matchTypeCounts[r.categoryResolution.matchType] = (matchTypeCounts[r.categoryResolution.matchType] || 0) + 1;
      }
    });
    console.log('  Category Match Types:');
    console.log(`    MANUAL:   ${matchTypeCounts.MANUAL}`);
    console.log(`    AUTO:     ${matchTypeCounts.AUTO}`);
    console.log(`    FALLBACK: ${matchTypeCounts.FALLBACK}`);
    console.log('');
    
    // Detailed results
    if (results.success.length > 0) {
      console.log('=== Successful Results ===');
      results.success.forEach(r => {
        const mode = r.mode || 'CREATE';
        console.log(`  [${mode}] ${r.vendorItemId}: qoo10ItemId=${r.qoo10ItemId}, price=${r.qoo10SellingPrice}, match=${r.categoryResolution?.matchType}`);
      });
      console.log('');
    }
    
    if (results.noChanges.length > 0) {
      console.log('=== No Changes (Update Skipped) ===');
      results.noChanges.forEach(r => {
        console.log(`  ${r.vendorItemId}: qoo10ItemId=${r.qoo10ItemId} - no updatable fields changed`);
      });
      console.log('');
    }
    
    if (results.dryRun.length > 0) {
      console.log('=== DRY-RUN Results (sheet updated) ===');
      results.dryRun.forEach(r => {
        const mode = r.mode || 'CREATE';
        console.log(`  [${mode}] ${r.vendorItemId}: jpCat=${r.categoryResolution?.jpCategoryId}, match=${r.categoryResolution?.matchType}, price=${r.qoo10SellingPrice}`);
      });
      console.log('');
    }
    
    if (results.failed.length > 0) {
      console.log('=== Failed Results ===');
      results.failed.forEach(r => {
        const mode = r.mode || 'CREATE';
        console.log(`  [${mode}] ${r.vendorItemId}: ${r.apiError}`);
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

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFatal error:', err.message);
    process.exit(1);
  });
