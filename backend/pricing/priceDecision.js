/**
 * Price Decision Module
 * 
 * Centralized pricing logic for Coupang-to-Qoo10 pipeline.
 * Reads ItemPrice (KRW) and computes JPY selling price.
 * 
 * Used by both CREATE (SetNewGoods) and UPDATE (UpdateGoods).
 * 
 * STRICT RULES:
 * - ItemPrice (KRW) is REQUIRED
 * - If missing/invalid: registration MUST fail
 * - Computed JPY is written back to qoo10SellingPrice column
 */

const { FX_JPY_TO_KRW, DOMESTIC_SHIPPING_KRW } = require('./pricingConstants');

/**
 * Sanitize and parse KRW price from ItemPrice
 * @param {string|number} priceKrw - Price in KRW
 * @returns {{ valid: boolean, krw: number, sanitized: string }}
 */
function parsePriceKrw(priceKrw) {
  if (priceKrw === undefined || priceKrw === null || priceKrw === '') {
    return { valid: false, krw: 0, sanitized: '' };
  }
  
  // Sanitize: trim, remove commas
  const sanitized = String(priceKrw).trim().replace(/,/g, '');
  
  // Parse number
  const krw = parseFloat(sanitized);
  
  // Validate: must be positive number
  if (isNaN(krw) || krw <= 0) {
    return { valid: false, krw: 0, sanitized };
  }
  
  return { valid: true, krw, sanitized };
}

/**
 * Compute JPY price from KRW cost price
 * 
 * Formula:
 * 1. totalKrw = costKrw + DOMESTIC_SHIPPING_KRW
 * 2. convertedJpy = totalKrw / FX_JPY_TO_KRW
 * 3. finalJpy = ceil(convertedJpy + JAPAN_SHIPPING_JPY)
 * 
 * @param {string|number} costKrw - Cost price in KRW
 * @returns {string} JPY price as string, or "" if invalid
 */
function computeJpyFromKrw(costKrw) {
  const parsed = parsePriceKrw(costKrw);
  
  if (!parsed.valid) {
    return '';
  }
  
  // Japan shipping cost (local constant, not in pricingConstants.js)
  const JAPAN_SHIPPING_JPY = 100;
  
  // Step 1: Add domestic shipping
  const totalKrw = parsed.krw + DOMESTIC_SHIPPING_KRW;
  
  // Step 2: Convert to JPY
  const convertedJpy = totalKrw / FX_JPY_TO_KRW;
  
  // Step 3: Add Japan shipping and ceil
  const finalJpy = Math.ceil(convertedJpy + JAPAN_SHIPPING_JPY);
  
  // Debug log
  console.log(`[PriceCalc] costKrw=${parsed.krw} DOMESTIC_SHIPPING_KRW=${DOMESTIC_SHIPPING_KRW} totalKrw=${totalKrw} FX_JPY_TO_KRW=${FX_JPY_TO_KRW} convertedJpy=${convertedJpy} JAPAN_SHIPPING_JPY=${JAPAN_SHIPPING_JPY} finalJpy=${finalJpy}`);
  
  return String(finalJpy);
}

/**
 * Validate and compute final ItemPrice (JPY) for Qoo10 API
 * 
 * STRICT: ItemPrice (KRW) is REQUIRED.
 * If missing/invalid, returns error that MUST fail the registration.
 * 
 * @param {object} params
 * @param {object} params.row - Current row data from sheet
 * @param {string} params.vendorItemId - Vendor item ID for logging
 * @param {string} params.mode - 'CREATE' or 'UPDATE' for logging
 * @returns {{ 
 *   valid: boolean, 
 *   priceJpy: string, 
 *   rawKrw: string,
 *   error: string | null 
 * }}
 */
function decideItemPriceJpy({ row, vendorItemId, mode }) {
  const rawKrw = row?.ItemPrice;
  const parsed = parsePriceKrw(rawKrw);
  
  if (!parsed.valid) {
    // STRICT: ItemPrice is REQUIRED
    const errorMsg = 'ItemPrice missing or invalid';
    console.error(`[PriceDecision][ERROR] vendorItemId=${vendorItemId} ItemPrice="${rawKrw || ''}" - ${errorMsg}`);
    
    return {
      valid: false,
      priceJpy: '',
      rawKrw: String(rawKrw || ''),
      error: errorMsg
    };
  }
  
  // Compute JPY using full formula
  const priceJpy = computeJpyFromKrw(parsed.krw);
  
  // Log success
  console.log(`[PriceDecision][${mode}] vendorItemId=${vendorItemId} ItemPrice(KRW)=${parsed.sanitized} computedJPY=${priceJpy}`);
  
  return {
    valid: true,
    priceJpy,
    rawKrw: parsed.sanitized,
    error: null
  };
}

module.exports = {
  FX_JPY_TO_KRW,
  parsePriceKrw,
  computeJpyFromKrw,
  decideItemPriceJpy
};
