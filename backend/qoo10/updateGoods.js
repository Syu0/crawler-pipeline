/**
 * Qoo10 updateGoods - Update existing goods on Qoo10
 * Uses ItemsBasic.UpdateGoods API
 * 
 * Usage:
 *   const { updateExistingGoods } = require('./backend/qoo10/updateGoods');
 *   const result = await updateExistingGoods({
 *     ItemCode: '123456789',  // Required: existing Qoo10 item ID
 *     ItemTitle: 'Updated Title',
 *     ItemPrice: '6000',
 *     // ... other fields to update
 *   });
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { updateGoods, qoo10PostMethod } = require('../../scripts/lib/qoo10Client');

// Fields that MUST be included in UpdateGoods request (API requirement)
const REQUIRED_FIELDS = [
  'SecondSubCat',
  'ItemTitle',
  'ProductionPlaceType',
  'AdultYN',
  'AvailableDateType',
  'AvailableDateValue'
];

// Default values for required fields (business rules)
const REQUIRED_DEFAULTS = {
  'ProductionPlaceType': '2',
  'AdultYN': 'N',
  'AvailableDateType': '0',
  'AvailableDateValue': '5'
};

// Mapping: Qoo10 API field -> sheet column name
const FIELD_TO_SHEET_MAP = {
  'SecondSubCat': 'jpCategoryIdUsed',
  'ItemTitle': 'ItemTitle',
  'ItemPrice': 'qoo10SellingPrice',
  'ItemDescription': 'ItemDescriptionText',
  'StandardImage': 'StandardImage',
  'Weight': 'WeightKg',
  'ProductionPlaceType': 'ProductionPlaceType',
  'AdultYN': 'AdultYN',
  'AvailableDateType': 'AvailableDateType',
  'AvailableDateValue': 'AvailableDateValue',
};

// Fields that can be updated via UpdateGoods API
const UPDATABLE_FIELDS = [
  'ItemTitle',
  'ItemPrice',
  'ItemQty',
  'ItemDescription',
  'SecondSubCat',
  'StandardImage',
  'ExpireDate',
  'AvailableDateValue',
  'DesiredShippingDate',
  'ShippingNo',
  'Weight',
  'AdultYN',
  'ProductionPlaceType',
  'ProductionPlace',
  'IndustrialCodeType',
  'IndustrialCode',
  'ContactInfo',
  'TaxRate',
];

/**
 * Fetch current item data from Qoo10 by ItemCode
 * @param {string} itemCode - Qoo10 item code
 * @returns {Promise<object|null>} Item data or null
 */
async function fetchQoo10ItemData(itemCode) {
  try {
    console.log(`[UpdateGoods] Fetching item data from Qoo10 for ItemCode=${itemCode}`);
    const response = await qoo10PostMethod('ItemsBasic.GetGoodsInfo', {
      ItemCode: itemCode,
      returnType: 'application/json'
    }, '1.0');
    
    if (response.ResultCode === 0 && response.ResultObject) {
      return response.ResultObject;
    }
    console.warn(`[UpdateGoods] GetGoodsInfo failed: ${response.ResultMsg || 'Unknown'}`);
    return null;
  } catch (err) {
    console.warn(`[UpdateGoods] GetGoodsInfo error: ${err.message}`);
    return null;
  }
}

/**
 * Resolve a required field value with fallback chain
 * Priority: 1) input, 2) row (sheet), 3) existingRowData, 4) REQUIRED_DEFAULTS, 5) fetch from Qoo10
 * @param {string} apiField - Qoo10 API field name
 * @param {object} input - Current input data
 * @param {object} row - Current sheet row data
 * @param {object} existingRowData - Previously stored row data
 * @param {object|null} qoo10Data - Data fetched from Qoo10 (optional)
 * @returns {{value: string, source: string}} Resolved value and source
 */
function resolveFieldValue(apiField, input, row, existingRowData, qoo10Data) {
  const sheetCol = FIELD_TO_SHEET_MAP[apiField] || apiField;
  
  // Priority 1: input (explicit new value)
  if (nonEmpty(input[apiField])) {
    return { value: normalize(input[apiField]), source: 'input' };
  }
  
  // Priority 2: current sheet row
  if (nonEmpty(row[sheetCol])) {
    return { value: normalize(row[sheetCol]), source: 'row' };
  }
  if (nonEmpty(row[apiField])) {
    return { value: normalize(row[apiField]), source: 'row' };
  }
  
  // Priority 3: existingRowData
  if (nonEmpty(existingRowData[sheetCol])) {
    return { value: normalize(existingRowData[sheetCol]), source: 'existingRowData' };
  }
  if (nonEmpty(existingRowData[apiField])) {
    return { value: normalize(existingRowData[apiField]), source: 'existingRowData' };
  }
  
  // Priority 4: REQUIRED_DEFAULTS
  if (REQUIRED_DEFAULTS[apiField] !== undefined) {
    return { value: REQUIRED_DEFAULTS[apiField], source: 'default' };
  }
  
  // Priority 5: Qoo10 fetched data
  if (qoo10Data) {
    const variations = [apiField, apiField.toLowerCase(), sheetCol];
    for (const key of variations) {
      if (nonEmpty(qoo10Data[key])) {
        return { value: normalize(qoo10Data[key]), source: 'qoo10Fetch' };
      }
    }
  }
  
  return { value: '', source: 'missing' };
}

/**
 * Normalize value for comparison
 */
function normalize(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

/**
 * Check if value is non-empty
 */
function nonEmpty(v) {
  return normalize(v).length > 0;
}

/**
 * Detect which fields have changed between old and new data
 * @param {object} oldData - Previous row data from sheet
 * @param {object} newData - New payload data
 * @returns {object} Object with only changed fields
 */
function detectChangedFields(oldData, newData) {
  const changedFields = {};
  
  // Map sheet columns to Qoo10 API fields
  // Format: { qoo10ApiField: sheetColumnName }
  const UPDATE_FIELD_MAP = {
    'ItemTitle': 'ItemTitle',
    'ItemPrice': 'qoo10SellingPrice',
    'SecondSubCat': 'jpCategoryIdUsed',
    'StandardImage': 'StandardImage',
    'ItemDescription': 'ItemDescriptionText',
    'Weight': 'WeightKg',
  };
  
  for (const [apiField, sheetCol] of Object.entries(UPDATE_FIELD_MAP)) {
    // Get old value from sheet column
    const oldVal = normalize(oldData[sheetCol]);
    
    // Get new value: check apiField first (from input), then sheetCol
    const newVal = normalize(newData[apiField] || newData[sheetCol]);
    
    // Only include if new value is non-empty AND different from old
    if (nonEmpty(newVal) && oldVal !== newVal) {
      changedFields[apiField] = newData[apiField] || newData[sheetCol];
      console.log(`[UpdateGoods]   ${apiField}: "${oldVal.substring(0, 30)}" → "${newVal.substring(0, 30)}"`);
    }
  }
  
  return changedFields;
}

/**
 * Check if category was manually changed
 * @param {object} oldData - Previous row data
 * @param {string} newCategoryId - New JP category ID
 * @returns {boolean}
 */
function isCategoryManuallyChanged(oldData, newCategoryId) {
  const oldCategoryId = oldData.jpCategoryIdUsed || '';
  return newCategoryId && oldCategoryId && oldCategoryId !== newCategoryId;
}

/**
 * Update existing goods on Qoo10
 * @param {object} input - Update parameters (must include ItemCode)
 * @param {object} existingRowData - Existing row data from sheet for comparison
 * @returns {Promise<object>} Result object
 */
async function updateExistingGoods(input, existingRowData = {}) {
  const ALLOW_REAL = process.env.QOO10_ALLOW_REAL_REG === '1';
  
  // Validate ItemCode (required for update)
  if (!input.ItemCode) {
    return {
      success: false,
      resultCode: -1,
      resultMsg: 'ItemCode is required for update operation'
    };
  }
  
  console.log(`[UpdateGoods] Updating existing Qoo10 item: ${input.ItemCode}`);
  
  // Detect changed fields
  const changedFields = detectChangedFields(existingRowData, input);
  
  // Check for manual category change
  let categoryManuallyChanged = false;
  if (input.SecondSubCat && isCategoryManuallyChanged(existingRowData, input.SecondSubCat)) {
    changedFields.SecondSubCat = input.SecondSubCat;
    categoryManuallyChanged = true;
    console.log(`[UpdateGoods] Category manually changed to: ${input.SecondSubCat}`);
  }
  
  // Filter to only UPDATABLE_FIELDS
  const fieldsToUpdate = {};
  for (const [field, value] of Object.entries(changedFields)) {
    if (UPDATABLE_FIELDS.includes(field) && value !== undefined && value !== null && value !== '') {
      fieldsToUpdate[field] = value;
    }
  }
  
  // If no fields to update, skip API call
  if (Object.keys(fieldsToUpdate).length === 0) {
    console.log(`[UpdateGoods] No changes detected. Update skipped.`);
    return {
      success: true,
      resultCode: 0,
      resultMsg: 'No changes detected',
      skipped: true,
      itemCode: input.ItemCode
    };
  }
  
  console.log(`[UpdateGoods] Fields to update: [${Object.keys(fieldsToUpdate).join(', ')}]`);
  
  // ===== RESOLVE REQUIRED FIELDS =====
  // Fetch Qoo10 data if any required field might be missing
  let qoo10Data = null;
  const resolvedRequired = {};
  const resolutionLog = {};
  
  for (const reqField of REQUIRED_FIELDS) {
    // First try to resolve without fetching
    let resolution = resolveFieldValue(reqField, input, existingRowData, existingRowData, null);
    
    // If missing and we haven't fetched yet, fetch from Qoo10
    if (resolution.source === 'missing' && !qoo10Data) {
      qoo10Data = await fetchQoo10ItemData(input.ItemCode);
      resolution = resolveFieldValue(reqField, input, existingRowData, existingRowData, qoo10Data);
    }
    
    if (!nonEmpty(resolution.value)) {
      console.error(`[UpdateGoods] REQUIRED field ${reqField} is missing and could not be resolved for ItemCode=${input.ItemCode}`);
      return {
        success: false,
        resultCode: -1,
        resultMsg: `Required field ${reqField} could not be resolved`,
        itemCode: input.ItemCode
      };
    }
    
    resolvedRequired[reqField] = resolution.value;
    resolutionLog[reqField] = resolution.source;
  }
  
  console.log(`[UpdateGoods] REQUIRED_FIELDS resolved:`, JSON.stringify(resolutionLog));
  
  // Build update payload: REQUIRED_FIELDS + fieldsToUpdate
  const updatePayload = {
    ItemCode: input.ItemCode,
    ...resolvedRequired,  // Required fields first
    ...fieldsToUpdate,    // Changed fields (may override required if explicitly changed)
    returnType: 'application/json'
  };
  
  // Log final payload verification
  const payloadKeys = Object.keys(updatePayload).filter(k => k !== 'returnType');
  console.log(`[UpdateGoods] Final payload keys: [${payloadKeys.join(', ')}]`);
  
  // Confirm all required fields present
  const reqCheck = REQUIRED_FIELDS.map(f => `${f}=${updatePayload[f] ? 'OK' : 'MISSING'}`).join(', ');
  console.log(`[UpdateGoods] Required params: ${reqCheck}`);
  
  // Log urlencoded body preview
  const bodyPreview = Object.entries(updatePayload)
    .filter(([k]) => k !== 'returnType')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v).substring(0, 50))}`)
    .join('&');
  console.log(`[UpdateGoods] URLEncoded body preview: ${bodyPreview.substring(0, 500)}...`);
  
  // Log before API call
  const vendorItemId = existingRowData.vendorItemId || existingRowData.itemId || 'unknown';
  console.log(`[UPDATE] Calling Qoo10 update API for qoo10ItemId=${input.ItemCode} vendorItemId=${vendorItemId} fields=[${Object.keys(fieldsToUpdate).join(', ')}]`);
  
  // Dry-run mode
  if (!ALLOW_REAL) {
    console.log('[UpdateGoods] Dry-run mode - API call skipped');
    console.log('[UpdateGoods] Payload that would be sent:', JSON.stringify(updatePayload, null, 2));
    return {
      success: true,
      resultCode: -1,
      resultMsg: 'Dry-run mode: QOO10_ALLOW_REAL_REG not enabled',
      dryRun: true,
      itemCode: input.ItemCode,
      fieldsToUpdate: Object.keys(fieldsToUpdate),
      categoryManuallyChanged
    };
  }
  
  // Call Qoo10 UpdateGoods API
  try {
    const response = await updateGoods(updatePayload);
    
    const resultCode = Number(response.ResultCode ?? response.resultCode ?? -999);
    const resultMsg = response.ResultMsg || response.resultMsg || 'Unknown';
    
    if (resultCode === 0) {
      console.log(`[UpdateGoods] UPDATE success for item: ${input.ItemCode}`);
      return {
        success: true,
        resultCode,
        resultMsg,
        itemCode: input.ItemCode,
        fieldsUpdated: Object.keys(fieldsToUpdate),
        categoryManuallyChanged
      };
    } else {
      console.error(`[UpdateGoods] UPDATE failed: ${resultMsg} (code: ${resultCode})`);
      return {
        success: false,
        resultCode,
        resultMsg,
        itemCode: input.ItemCode
      };
    }
  } catch (err) {
    console.error(`[UpdateGoods] Exception: ${err.message}`);
    return {
      success: false,
      resultCode: -999,
      resultMsg: err.message,
      itemCode: input.ItemCode
    };
  }
}

module.exports = {
  updateExistingGoods,
  detectChangedFields,
  isCategoryManuallyChanged,
  UPDATABLE_FIELDS
};
