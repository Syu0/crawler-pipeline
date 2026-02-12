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

const { updateGoods } = require('../../scripts/lib/qoo10Client');

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
  
  // TASK 1: Ensure SecondSubCat is ALWAYS included (required by Qoo10 UpdateGoods API)
  let secondSubCat = fieldsToUpdate.SecondSubCat || input.SecondSubCat;
  
  // Priority: 1) From fieldsToUpdate, 2) From input, 3) From existing row
  if (!nonEmpty(secondSubCat)) {
    secondSubCat = existingRowData.jpCategoryIdUsed || existingRowData.SecondSubCat;
  }
  
  if (!nonEmpty(secondSubCat)) {
    console.error(`[UpdateGoods] SecondSubCat is required but not found`);
    return {
      success: false,
      resultCode: -1,
      resultMsg: 'SecondSubCat is required for UpdateGoods but could not be determined',
      itemCode: input.ItemCode
    };
  }
  
  // Build update payload with SecondSubCat always included
  const updatePayload = {
    ItemCode: input.ItemCode,
    SecondSubCat: secondSubCat,
    ...fieldsToUpdate,
    returnType: 'application/json'
  };
  
  console.log(`[UpdateGoods] SecondSubCat=${secondSubCat} (required field)`);
  
  // Verify final payload
  console.log(`[UpdateGoods] Final payload:`, JSON.stringify({
    ItemCode: updatePayload.ItemCode,
    SecondSubCat: updatePayload.SecondSubCat,
    ItemTitle: updatePayload.ItemTitle || '(not changed)',
    ItemPrice: updatePayload.ItemPrice || '(not changed)',
    ItemDescription: updatePayload.ItemDescription ? '(included)' : '(not changed)',
    StandardImage: updatePayload.StandardImage ? '(included)' : '(not changed)',
  }));
  
  // Log before API call
  const vendorItemId = existingRowData.vendorItemId || existingRowData.itemId || 'unknown';
  console.log(`[UPDATE] Calling Qoo10 update API for qoo10ItemId=${input.ItemCode} vendorItemId=${vendorItemId} fields=[${Object.keys(fieldsToUpdate).join(', ')}]`);
  
  // Dry-run mode
  if (!ALLOW_REAL) {
    console.log('[UpdateGoods] Dry-run mode - API call skipped');
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
