/**
 * Qoo10 updateGoods - Update existing goods on Qoo10
 * Uses ItemsBasic.UpdateGoods API
 * 
 * IMPORTANT: Payload structure is identical to SetNewGoods
 * except SellerCode is replaced with ItemCode.
 * 
 * Usage:
 *   const { updateExistingGoods } = require('./backend/qoo10/updateGoods');
 *   const result = await updateExistingGoods({
 *     ItemCode: '123456789',  // Required: existing Qoo10 item ID
 *     SecondSubCat: '320002604',
 *     ItemTitle: 'Updated Title',
 *     ItemPrice: '6000',
 *     // ... all other fields like SetNewGoods
 *   }, currentRowData);
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { updateGoods } = require('../../scripts/lib/qoo10Client');

// Default ShippingNo (same as registerNewGoods)
const DEFAULT_SHIPPING_NO = '471554';

/**
 * Build UpdateGoods params - IDENTICAL structure to SetNewGoods
 * but with ItemCode instead of SellerCode
 * 
 * @param {Object} input - Input data (from caller)
 * @param {Object} rowData - Current row data from sheet
 * @param {string} shippingNo - Resolved ShippingNo
 * @returns {Object} params for UpdateGoods API call
 */
function buildUpdateGoodsParams(input, rowData, shippingNo) {
  // Resolve values: input first, then rowData, then defaults
  const resolve = (inputKey, rowKey, defaultVal) => {
    if (input[inputKey] !== undefined && input[inputKey] !== null && String(input[inputKey]).trim() !== '') {
      return String(input[inputKey]);
    }
    if (rowData[rowKey] !== undefined && rowData[rowKey] !== null && String(rowData[rowKey]).trim() !== '') {
      return String(rowData[rowKey]);
    }
    return String(defaultVal);
  };
  
  // Build ItemDescription - same logic as registerNewGoods
  let finalDescription = resolve('ItemDescription', 'ItemDescriptionText', '<p>Product description</p>');
  
  // Append ExtraImages if provided (same as registerNewGoods)
  let extraImages = input.ExtraImages || [];
  if (!Array.isArray(extraImages) && rowData.ExtraImages) {
    try {
      extraImages = JSON.parse(rowData.ExtraImages);
    } catch (e) {
      extraImages = [];
    }
  }
  
  if (Array.isArray(extraImages) && extraImages.length > 0) {
    const validUrls = extraImages.filter(url => url && String(url).trim());
    if (validUrls.length > 0) {
      const extraImageHtml = validUrls
        .map(url => `<p><img src="${String(url).trim()}" /></p>`)
        .join('');
      finalDescription += `<br/>${extraImageHtml}`;
    }
  }
  
  // Build params - EXACTLY like buildSetNewGoodsParams
  // but with ItemCode instead of SellerCode
  const params = {
    returnType: 'application/json',
    ItemCode: String(input.ItemCode),  // <-- Instead of SellerCode
    SecondSubCat: resolve('SecondSubCat', 'jpCategoryIdUsed', ''),
    ItemTitle: resolve('ItemTitle', 'ItemTitle', ''),
    ItemPrice: resolve('ItemPrice', 'qoo10SellingPrice', '0'),
    RetailPrice: resolve('RetailPrice', 'RetailPrice', '0'),
    ItemQty: resolve('ItemQty', 'ItemQty', '100'),
    AvailableDateType: resolve('AvailableDateType', 'AvailableDateType', '0'),
    AvailableDateValue: resolve('AvailableDateValue', 'AvailableDateValue', '2'),
    ShippingNo: String(shippingNo),
    AdultYN: resolve('AdultYN', 'AdultYN', 'N'),
    TaxRate: resolve('TaxRate', 'TaxRate', 'S'),
    ExpireDate: resolve('ExpireDate', 'ExpireDate', '2030-12-31'),
    StandardImage: resolve('StandardImage', 'StandardImage', ''),
    ItemDescription: finalDescription,
    Weight: resolve('Weight', 'WeightKg', '500'),
    PromotionName: resolve('PromotionName', 'PromotionName', ''),
    // ProductionPlaceType: "1"=国内(Japan), "2"=海外(Overseas), "3"=その他(Other)
    ProductionPlaceType: resolve('ProductionPlaceType', 'ProductionPlaceType', '2'),
    ProductionPlace: resolve('ProductionPlace', 'ProductionPlace', 'Overseas'),
    IndustrialCodeType: resolve('IndustrialCodeType', 'IndustrialCodeType', ''),
    IndustrialCode: resolve('IndustrialCode', 'IndustrialCode', ''),
  };
  
  // Remove any undefined/null/empty-string fields EXCEPT those that can be empty
  const allowEmpty = ['PromotionName', 'IndustrialCodeType', 'IndustrialCode', 'RetailPrice'];
  for (const [key, val] of Object.entries(params)) {
    if (key === 'returnType') continue;
    if (val === undefined || val === null || val === 'undefined' || val === 'null') {
      if (!allowEmpty.includes(key)) {
        console.warn(`[UpdateGoods] WARNING: ${key} is undefined/null, removing from payload`);
        delete params[key];
      } else {
        params[key] = '';
      }
    }
  }
  
  return params;
}

/**
 * Update existing goods on Qoo10
 * 
 * @param {Object} input - Update parameters (must include ItemCode)
 * @param {Object} currentRowData - Current row data from sheet
 * @returns {Promise<Object>} Result object
 */
async function updateExistingGoods(input, currentRowData = {}) {
  const ALLOW_REAL = process.env.QOO10_ALLOW_REAL_REG === '1';
  const isTracer = process.env.QOO10_TRACER === '1';
  
  // Validate ItemCode (required for update)
  if (!input.ItemCode) {
    return {
      success: false,
      resultCode: -1,
      resultMsg: 'ItemCode is required for update operation'
    };
  }
  
  console.log(`[UpdateGoods] Updating existing Qoo10 item: ${input.ItemCode}`);
  
  // Resolve ShippingNo: use input value if provided, otherwise default
  let shippingNo = input.ShippingNo || currentRowData.ShippingNo;
  if (!shippingNo) {
    shippingNo = DEFAULT_SHIPPING_NO;
    console.log(`[UpdateGoods] ShippingNo defaulted to ${DEFAULT_SHIPPING_NO}`);
  } else {
    console.log(`[UpdateGoods] ShippingNo from input/row: ${shippingNo}`);
  }
  
  // Build params - IDENTICAL to SetNewGoods structure
  const params = buildUpdateGoodsParams(input, currentRowData, shippingNo);
  
  // ===== COMPREHENSIVE LOGGING =====
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[UpdateGoods] FINAL PAYLOAD for ItemCode=${input.ItemCode}`);
  console.log(`${'='.repeat(60)}`);
  
  // Log all payload keys
  const payloadKeys = Object.keys(params).filter(k => k !== 'returnType');
  console.log(`[UpdateGoods] Payload keys (${payloadKeys.length}): [${payloadKeys.join(', ')}]`);
  
  // Log each field
  for (const [key, value] of Object.entries(params)) {
    if (key === 'returnType') continue;
    const valStr = String(value);
    const truncated = valStr.length > 80 ? valStr.substring(0, 80) + '...[truncated]' : valStr;
    const isEmpty = !value || valStr === '';
    const status = isEmpty ? '⚠️ EMPTY' : '✓';
    console.log(`[UpdateGoods]   ${status} ${key}: "${truncated}"`);
  }
  
  // Log critical fields explicitly
  console.log(`\n[UpdateGoods] CRITICAL FIELDS:`);
  console.log(`[UpdateGoods]   ShippingNo: ${params.ShippingNo}`);
  console.log(`[UpdateGoods]   TaxRate: ${params.TaxRate}`);
  console.log(`[UpdateGoods]   ExpireDate: ${params.ExpireDate}`);
  console.log(`[UpdateGoods]   RetailPrice: ${params.RetailPrice}`);
  console.log(`[UpdateGoods]   ItemQty: ${params.ItemQty}`);
  console.log(`[UpdateGoods]   Weight: ${params.Weight}`);
  console.log(`[UpdateGoods]   ProductionPlaceType: ${params.ProductionPlaceType}`);
  console.log(`[UpdateGoods]   ProductionPlace: ${params.ProductionPlace}`);
  console.log(`[UpdateGoods]   AvailableDateType: ${params.AvailableDateType}`);
  console.log(`[UpdateGoods]   AvailableDateValue: ${params.AvailableDateValue}`);
  
  // Log full URL-encoded body
  const urlEncodedParts = [];
  for (const [k, v] of Object.entries(params)) {
    urlEncodedParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  const urlEncodedBody = urlEncodedParts.join('&');
  
  console.log(`\n[UpdateGoods] URL-ENCODED BODY (${urlEncodedBody.length} chars):`);
  console.log(urlEncodedBody.substring(0, 2000));
  if (urlEncodedBody.length > 2000) {
    console.log(`... [truncated, total: ${urlEncodedBody.length} chars]`);
  }
  
  console.log(`${'='.repeat(60)}\n`);
  
  // Log before API call
  const vendorItemId = currentRowData.vendorItemId || currentRowData.itemId || 'unknown';
  console.log(`[UpdateGoods] Calling Qoo10 UpdateGoods API for qoo10ItemId=${input.ItemCode} vendorItemId=${vendorItemId}`);
  
  // Dry-run mode
  if (!ALLOW_REAL) {
    console.log('[UpdateGoods] Dry-run mode - API call skipped');
    console.log('[UpdateGoods] Payload that would be sent:', JSON.stringify(params, null, 2));
    return {
      success: true,
      resultCode: -1,
      resultMsg: 'Dry-run mode: QOO10_ALLOW_REAL_REG not enabled',
      dryRun: true,
      itemCode: input.ItemCode,
      payload: params
    };
  }
  
  // Call Qoo10 UpdateGoods API
  try {
    const response = await updateGoods(params);
    
    const resultCode = Number(response.ResultCode ?? response.resultCode ?? -999);
    const resultMsg = response.ResultMsg || response.resultMsg || 'Unknown';
    
    console.log(`[UpdateGoods] API Response: ResultCode=${resultCode}, ResultMsg=${resultMsg}`);
    
    if (resultCode === 0) {
      console.log(`[UpdateGoods] UPDATE SUCCESS for item: ${input.ItemCode}`);
      return {
        success: true,
        resultCode,
        resultMsg,
        itemCode: input.ItemCode
      };
    } else {
      console.error(`[UpdateGoods] UPDATE FAILED: ${resultMsg} (code: ${resultCode})`);
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
  buildUpdateGoodsParams
};
