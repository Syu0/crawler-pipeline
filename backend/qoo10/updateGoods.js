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
 * Detect which fields have changed between old and new data
 * @param {object} oldData - Previous row data from sheet
 * @param {object} newData - New payload data
 * @returns {object} Object with only changed fields
 */
function detectChangedFields(oldData, newData) {
  const changedFields = {};
  
  // Map sheet columns to Qoo10 API fields
  const fieldMappings = {
    'ItemTitle': 'ItemTitle',
    'qoo10SellingPrice': 'ItemPrice',
    'jpCategoryIdUsed': 'SecondSubCat',
    'StandardImage': 'StandardImage',
    'ItemDescriptionText': 'ItemDescription',
    'WeightKg': 'Weight',
  };
  
  for (const [sheetCol, apiField] of Object.entries(fieldMappings)) {
    const oldVal = oldData[sheetCol] || '';
    const newVal = newData[apiField] || newData[sheetCol] || '';
    
    // Only include if new value is non-empty and different from old
    if (newVal && String(newVal).trim() !== '' && String(oldVal).trim() !== String(newVal).trim()) {
      changedFields[apiField] = newVal;
      console.log(`[UpdateGoods]   ${apiField}: "${String(oldVal).substring(0, 30)}" → "${String(newVal).substring(0, 30)}"`);
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
  
  // Build update payload
  const updatePayload = {
    ItemCode: input.ItemCode,
    ...fieldsToUpdate,
    returnType: 'application/json'
  };
  
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
