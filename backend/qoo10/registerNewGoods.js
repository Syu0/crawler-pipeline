/**
 * Qoo10 registerNewGoods - Production-ready module
 * Registers new goods on Qoo10 via ItemsBasic.SetNewGoods API
 * 
 * Usage:
 *   const { registerNewGoods } = require('./backend/qoo10/registerNewGoods');
 *   const result = await registerNewGoods({
 *     SecondSubCat: '320002604',
 *     ItemTitle: 'My Product',
 *     ItemPrice: '5000',
 *     ItemQty: '10',
 *     SellerCode: 'PROD001',
 *     StandardImage: 'https://example.com/image.jpg',
 *     ItemDescription: '<p>Product description</p>'
 *   });
 */

// Auto-load backend/.env
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { qoo10PostMethod, testQoo10Connection } = require('../../scripts/lib/qoo10Client');

/**
 * Validation helpers
 */
function validateRequired(input, field) {
  if (!input[field] || String(input[field]).trim() === '') {
    throw new Error(`Required field missing: ${field}`);
  }
}

function validatePositiveNumber(input, field) {
  const value = Number(input[field]);
  if (isNaN(value) || value <= 0) {
    throw new Error(`${field} must be a positive number, got: ${input[field]}`);
  }
}

function validateUrl(url, field) {
  if (!url || !url.match(/^https?:\/\/.+/i)) {
    throw new Error(`${field} must be a valid HTTP(S) URL, got: ${url}`);
  }
}

/**
 * Generate unique SellerCode with timestamp and random suffix
 * Format: auto{YYYYMMDDHHmmss}{rand4}
 * NOTE: Prefix is always "auto" (hardcoded) - SellerCodeBase from input is ignored
 */
function generateUniqueSellerCode() {
  // Prefix is always "auto" - ignore any input base
  const truncatedBase = 'auto';
  
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('');
  
  const rand4 = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  
  return `${truncatedBase}${timestamp}${rand4}`;
}

/**
 * Extract created item ID from ResultObject
 * Priority: GdNo > GoodsNo > ItemNo > itemNo
 */
function extractCreatedItemId(resultObject) {
  if (!resultObject || typeof resultObject !== 'object') {
    return null;
  }
  
  // Try all possible keys in priority order
  const keys = ['GdNo', 'GoodsNo', 'ItemNo', 'itemNo'];
  
  for (const key of keys) {
    if (resultObject[key] !== undefined && resultObject[key] !== null) {
      return String(resultObject[key]);
    }
  }
  
  return null;
}

/**
 * Extract AIContentsNo from ResultObject
 */
function extractAIContentsNo(resultObject) {
  if (!resultObject || typeof resultObject !== 'object') {
    return null;
  }
  
  if (resultObject.AIContentsNo !== undefined && resultObject.AIContentsNo !== null) {
    return String(resultObject.AIContentsNo);
  }
  
  return null;
}

/**
 * Get valid ShippingNo from GetSellerDeliveryGroupInfo
 */
async function resolveShippingNo() {
  try {
    const response = await testQoo10Connection();
    
    if (response.ResultCode !== 0) {
      throw new Error(`GetSellerDeliveryGroupInfo failed: ${response.ResultMsg}`);
    }
    
    const deliveryGroups = response.ResultObject || [];
    
    if (deliveryGroups.length === 0) {
      throw new Error('No delivery groups found - please set up shipping template in Qoo10 seller portal');
    }
    
    // Find first domestic (non-overseas) shipping group
    const domesticGroup = deliveryGroups.find(g => g.Oversea === 'N');
    const selectedGroup = domesticGroup || deliveryGroups[0];
    
    return String(selectedGroup.ShippingNo);
  } catch (err) {
    throw new Error(`Failed to resolve ShippingNo: ${err.message}`);
  }
}

/**
 * Build AdditionalOption string from Options input
 * Format: OptionName||*Value||*PriceDelta$$OptionName||*Value||*PriceDelta
 */
function buildAdditionalOptions(optionsInput) {
  if (!optionsInput || !optionsInput.type || !Array.isArray(optionsInput.values) || optionsInput.values.length === 0) {
    return null;
  }
  
  const optionName = String(optionsInput.type || 'OPTION');
  const optionParts = optionsInput.values
    .filter(v => v && v.name)
    .map(v => {
      const name = String(v.name).trim();
      const priceDelta = String(v.priceDelta || 0);
      return `${optionName}||*${name}||*${priceDelta}`;
    });
  
  if (optionParts.length === 0) {
    return null;
  }
  
  return optionParts.join('$$');
}

/**
 * Build final SetNewGoods params with defaults
 */
function buildSetNewGoodsParams(input, shippingNo, uniqueSellerCode) {
  // Build base ItemDescription
  let finalDescription = String(input.ItemDescription || '<p>Product description</p>');
  
  // Append DetailImages if provided
  if (input.DetailImages && Array.isArray(input.DetailImages) && input.DetailImages.length > 0) {
    const imageHtml = input.DetailImages
      .filter(url => url && String(url).trim())
      .map(url => `<img src="${String(url).trim()}" />`)
      .join('');
    
    if (imageHtml) {
      finalDescription += `<hr/>${imageHtml}`;
    }
  }
  
  // Append ExtraImages if provided (format: <br/> then <p><img src="URL" /></p> for each)
  if (input.ExtraImages && Array.isArray(input.ExtraImages) && input.ExtraImages.length > 0) {
    const validUrls = input.ExtraImages.filter(url => url && String(url).trim());
    if (validUrls.length > 0) {
      const extraImageHtml = validUrls
        .map(url => `<p><img src="${String(url).trim()}" /></p>`)
        .join('');
      finalDescription += `<br/>${extraImageHtml}`;
    }
  }
  
  const params = {
    returnType: 'application/json',
    SecondSubCat: String(input.SecondSubCat),
    ItemTitle: String(input.ItemTitle),
    ItemPrice: String(input.ItemPrice),
    RetailPrice: String(input.RetailPrice || '0'),
    ItemQty: String(input.ItemQty),
    AvailableDateType: String(input.AvailableDateType || '0'),
    AvailableDateValue: String(input.AvailableDateValue || '2'),
    ShippingNo: String(shippingNo),
    SellerCode: uniqueSellerCode,
    AdultYN: String(input.AdultYN || 'N'),
    TaxRate: String(input.TaxRate || 'S'),
    ExpireDate: String(input.ExpireDate || '2030-12-31'),
    StandardImage: String(input.StandardImage),
    ItemDescription: finalDescription,
    Weight: String(input.Weight || '500'),
    PromotionName: String(input.PromotionName || ''),
    // ProductionPlaceType: "1"=国内(Japan), "2"=海外(Overseas), "3"=その他(Other)
    // Default to "2" (Overseas) for foreign products
    ProductionPlaceType: String(input.ProductionPlaceType || '2'),
    ProductionPlace: String(input.ProductionPlace || 'Overseas'),
    IndustrialCodeType: String(input.IndustrialCodeType || ''),
    IndustrialCode: String(input.IndustrialCode || '')
  };
  
  // Add AdditionalOption if Options provided
  const additionalOption = buildAdditionalOptions(input.Options);
  if (additionalOption) {
    params.AdditionalOption = additionalOption;
  }
  
  return params;
}

/**
 * Register new goods on Qoo10
 * 
 * @param {Object} input - Product registration data
 * @param {string} input.SecondSubCat - Category ID (required)
 * @param {string} input.ItemTitle - Product title (required)
 * @param {string|number} input.ItemPrice - Price (required, positive)
 * @param {string|number} input.ItemQty - Quantity (required, positive)
 * @param {string} [input.SellerCode] - Base for unique code generation (optional, default: 'AUTO')
 * @param {string} [input.SellerCodeBase] - Alternative to SellerCode (optional)
 * @param {string} input.StandardImage - Product image URL (required, https)
 * @param {string} input.ItemDescription - Product description HTML (required, non-empty)
 * @param {string} [input.ShippingNo] - Shipping group ID (auto-resolved if omitted)
 * @param {string} [input.AdultYN='N'] - Adult content flag
 * @param {string} [input.AvailableDateType='0'] - Availability type
 * @param {string} [input.AvailableDateValue='2'] - Availability value
 * @param {string} [input.TaxRate='S'] - Tax rate code
 * @param {string} [input.RetailPrice='0'] - Retail price
 * @param {string} [input.ExpireDate='2030-12-31'] - Expiration date
 * @param {string} [input.Weight='500'] - Weight in grams
 * @param {string} [input.PromotionName=''] - Promotion name
 * @param {string} [input.ProductionPlaceType='1'] - Production place type
 * @param {string} [input.ProductionPlace='Japan'] - Production place
 * @param {string} [input.IndustrialCodeType='J'] - Industrial code type
 * @param {string} [input.IndustrialCode=''] - Industrial code
 * @param {Object} [input.Options] - Product variants/options
 * @param {string[]} [input.DetailImages] - Detail image URLs (appended as <img> tags after <hr/>)
 * @param {string[]} [input.ExtraImages] - Extra image URLs (appended as <br/><p><img/></p> tags)
 * 
 * @returns {Promise<Object>} Result object with:
 *   - success: boolean
 *   - resultCode: number
 *   - resultMsg: string
 *   - createdItemId: string | null (GdNo from ResultObject)
 *   - aiContentsNo: string | null (AIContentsNo from ResultObject)
 *   - sellerCodeUsed: string
 *   - shippingNoUsed: string
 *   - optionsApplied: boolean
 *   - optionSummary: string | null
 *   - rawResultObject: object | null
 */
async function registerNewGoods(input) {
  // Check dry-run mode
  const allowRealRegistration = process.env.QOO10_ALLOW_REAL_REG === '1' || process.env.QOO10_ALLOW_REAL_REG === 'true';
  
  // Validate required fields
  const requiredFields = [
    'SecondSubCat',
    'ItemTitle',
    'ItemPrice',
    'ItemQty',
    'StandardImage',
    'ItemDescription'
  ];
  
  for (const field of requiredFields) {
    validateRequired(input, field);
  }
  
  // Validate field types and constraints
  validatePositiveNumber(input, 'ItemPrice');
  validatePositiveNumber(input, 'ItemQty');
  validateUrl(input.StandardImage, 'StandardImage');
  
  if (String(input.ItemDescription).trim().length < 5) {
    throw new Error('ItemDescription must be at least 5 characters');
  }
  
  // Generate unique SellerCode (prefix always "auto", input SellerCodeBase ignored)
  const uniqueSellerCode = generateUniqueSellerCode();
  console.log(`Generated unique SellerCode: ${uniqueSellerCode}`);
  
  // Resolve ShippingNo: use input value if provided, otherwise default to 471554
  const DEFAULT_SHIPPING_NO = '471554';
  let shippingNo = input.ShippingNo;
  if (!shippingNo) {
    shippingNo = DEFAULT_SHIPPING_NO;
    console.log(`ShippingNo defaulted to ${DEFAULT_SHIPPING_NO}`);
  } else {
    console.log(`ShippingNo from input: ${shippingNo}`);
  }
  
  // Build final params
  const params = buildSetNewGoodsParams(input, shippingNo, uniqueSellerCode);
  
  // Dry-run mode check
  if (!allowRealRegistration) {
    console.log('\n⚠️  DRY-RUN MODE: Set QOO10_ALLOW_REAL_REG=1 in backend/.env to perform real registration.\n');
    return {
      success: false,
      resultCode: -1,
      resultMsg: 'Dry-run mode - registration skipped',
      createdItemId: null,
      sellerCodeUsed: uniqueSellerCode,
      shippingNoUsed: shippingNo,
      rawResultObject: null
    };
  }
  
  // Call Qoo10 API
  const response = await qoo10PostMethod('ItemsBasic.SetNewGoods', params, '1.1');
  
  // Extract created item ID
  const createdItemId = extractCreatedItemId(response.ResultObject);
  
  // Extract AIContentsNo
  const aiContentsNo = extractAIContentsNo(response.ResultObject);
  
  // Check if options were applied
  let optionsApplied = false;
  let optionSummary = null;
  if (input.Options && input.Options.values && input.Options.values.length > 0) {
    optionsApplied = true;
    const optType = input.Options.type || 'OPTION';
    const optValues = input.Options.values
      .map(v => `${v.name}(${v.priceDelta > 0 ? '+' : ''}${v.priceDelta})`)
      .join(', ');
    optionSummary = `${optType}: ${optValues}`;
  }
  
  // Return normalized result
  const result = {
    success: response.ResultCode === 0,
    resultCode: response.ResultCode,
    resultMsg: response.ResultMsg || '',
    createdItemId: createdItemId,
    aiContentsNo: aiContentsNo,
    sellerCodeUsed: uniqueSellerCode,
    shippingNoUsed: shippingNo,
    optionsApplied: optionsApplied,
    optionSummary: optionSummary,
    rawResultObject: response.ResultObject || null
  };
  
  return result;
}

module.exports = {
  registerNewGoods
};
