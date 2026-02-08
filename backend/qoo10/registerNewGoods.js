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
function buildSetNewGoodsParams(input, shippingNo) {
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
    SellerCode: String(input.SellerCode),
    AdultYN: String(input.AdultYN || 'N'),
    TaxRate: String(input.TaxRate || 'S'),
    ExpireDate: String(input.ExpireDate || '2030-12-31'),
    StandardImage: String(input.StandardImage),
    ItemDescription: String(input.ItemDescription),
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
 * @param {string} input.SellerCode - Unique seller code (required)
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
 *   - itemNo: string (if success)
 *   - request: object (masked request metadata)
 */
async function registerNewGoods(input) {
  // Validate required fields
  const requiredFields = [
    'SecondSubCat',
    'ItemTitle',
    'ItemPrice',
    'ItemQty',
    'SellerCode',
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
  
  // Resolve ShippingNo if not provided
  let shippingNo = input.ShippingNo;
  if (!shippingNo) {
    console.log('ShippingNo not provided, auto-resolving...');
    shippingNo = await resolveShippingNo();
    console.log(`Resolved ShippingNo: ${shippingNo}`);
  }
  
  // Build final params
  const params = buildSetNewGoodsParams(input, shippingNo);
  
  // Call Qoo10 API
  const response = await qoo10PostMethod('ItemsBasic.SetNewGoods', params, '1.1');
  
  // Return normalized result
  const result = {
    success: response.ResultCode === 0,
    resultCode: response.ResultCode,
    resultMsg: response.ResultMsg || '',
    itemNo: response.ResultObject ? String(response.ResultObject) : null,
    request: {
      secondSubCat: params.SecondSubCat,
      itemTitle: params.ItemTitle,
      sellerCode: params.SellerCode,
      shippingNo: params.ShippingNo
    }
  };
  
  return result;
}

module.exports = {
  registerNewGoods
};
