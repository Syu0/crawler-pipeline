/**
 * Price Decision Module
 * 
 * Centralized pricing logic for Coupang-to-Qoo10 pipeline.
 * Reads qoo10SellingPrice (KRW) and computes JPY selling price.
 * 
 * Used by both CREATE (SetNewGoods) and UPDATE (UpdateGoods).
 * 
 * STRICT RULES:
 * - qoo10SellingPrice (KRW) is REQUIRED
 * - If missing/invalid: registration MUST fail
 * - Computed JPY is written back to qoo10SellingPrice column
 */

// Fixed exchange rate: 1 JPY = 10 KRW
const FX_JPY_TO_KRW = 10;

/**
 * Sanitize and parse KRW price from qoo10SellingPrice
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
 * Compute JPY price from KRW
 * @param {string|number} priceKrw - Price in KRW
 * @returns {string} JPY price as string, or "" if invalid
 */
function computeJpyFromKrw(priceKrw) {
  const parsed = parsePriceKrw(priceKrw);
  
  if (!parsed.valid) {
    return '';
  }
  
  // Convert: JPY = floor(KRW / 10)
  const jpy = Math.floor(parsed.krw / FX_JPY_TO_KRW);
  
  return String(jpy);
}

/**
 * Validate and compute final ItemPrice (JPY) for Qoo10 API
 * 
 * STRICT: qoo10SellingPrice (KRW) is REQUIRED.
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
  const rawKrw = row?.qoo10SellingPrice;
  const parsed = parsePriceKrw(rawKrw);
  
  if (!parsed.valid) {
    // STRICT: qoo10SellingPrice is REQUIRED
    const errorMsg = 'qoo10SellingPrice missing or invalid';
    console.error(`[PriceDecision][ERROR] vendorItemId=${vendorItemId} qoo10SellingPrice="${rawKrw || ''}" - ${errorMsg}`);
    
    return {
      valid: false,
      priceJpy: '',
      rawKrw: String(rawKrw || ''),
      error: errorMsg
    };
  }
  
  // Compute JPY
  const priceJpy = String(Math.floor(parsed.krw / FX_JPY_TO_KRW));
  
  // Log success
  console.log(`[PriceDecision][${mode}] vendorItemId=${vendorItemId} rawKRW=${parsed.sanitized} computedJPY=${priceJpy}`);
  
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
