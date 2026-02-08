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
 * Format: {base}{YYYYMMDDHHmmss}{rand4}
 */
function generateUniqueSellerCode(base = 'AUTO') {
  // Truncate base if too long (max 20 chars to keep total length reasonable)
  const truncatedBase = String(base).substring(0, 20);
  
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
  
  return {
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
    ProductionPlaceType: String(input.ProductionPlaceType || '1'),
    ProductionPlace: String(input.ProductionPlace || 'Japan'),
    IndustrialCodeType: String(input.IndustrialCodeType || 'J'),
    IndustrialCode: String(input.IndustrialCode || '')
  };
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
 * 
 * @returns {Promise<Object>} Result object with:
 *   - success: boolean
 *   - resultCode: number
 *   - resultMsg: string
 *   - createdItemId: string | null (GdNo from ResultObject)
 *   - sellerCodeUsed: string
 *   - shippingNoUsed: string
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
  
  // Generate unique SellerCode
  const sellerCodeBase = input.SellerCodeBase || input.SellerCode || 'AUTO';
  const uniqueSellerCode = generateUniqueSellerCode(sellerCodeBase);
  console.log(`Generated unique SellerCode: ${uniqueSellerCode}`);
  
  // Resolve ShippingNo if not provided
  let shippingNo = input.ShippingNo;
  if (!shippingNo) {
    console.log('ShippingNo not provided, auto-resolving...');
    shippingNo = await resolveShippingNo();
    console.log(`Resolved ShippingNo: ${shippingNo}`);
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
  
  // Return normalized result
  const result = {
    success: response.ResultCode === 0,
    resultCode: response.ResultCode,
    resultMsg: response.ResultMsg || '',
    createdItemId: createdItemId,
    sellerCodeUsed: uniqueSellerCode,
    shippingNoUsed: shippingNo,
    rawResultObject: response.ResultObject || null
  };
  
  return result;
}

module.exports = {
  registerNewGoods
};
