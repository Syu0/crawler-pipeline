/**
 * Price Decision Module
 * 
 * Centralized pricing logic for Coupang-to-Qoo10 pipeline.
 * Computes JPY selling price from KRW cost price.
 * 
 * Used by both CREATE (SetNewGoods) and UPDATE (UpdateGoods).
 * 
 * STRICT RULES:
 * - CostPriceKrw is REQUIRED
 * - If missing/invalid: registration MUST fail
 * - Computed JPY must be written to sheet regardless of API result
 */

// Fixed exchange rate: 1 JPY = 10 KRW
const FX_JPY_TO_KRW = 10;

/**
 * Sanitize and parse KRW cost price
 * @param {string|number} costPriceKrw - Cost price in KRW
 * @returns {{ valid: boolean, krw: number, sanitized: string }}
 */
function parseCostPriceKrw(costPriceKrw) {
  if (costPriceKrw === undefined || costPriceKrw === null || costPriceKrw === '') {
    return { valid: false, krw: 0, sanitized: '' };
  }
  
  // Sanitize: trim, remove commas
  const sanitized = String(costPriceKrw).trim().replace(/,/g, '');
  
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
 * @param {string|number} costPriceKrw - Cost price in KRW
 * @returns {string} JPY price as string, or "" if invalid
 */
function computeJpyFromKrw(costPriceKrw) {
  const parsed = parseCostPriceKrw(costPriceKrw);
  
  if (!parsed.valid) {
    return '';
  }
  
  // Convert: JPY = floor(KRW / 10)
  const jpy = Math.floor(parsed.krw / FX_JPY_TO_KRW);
  
  return String(jpy);
}

/**
 * Validate and decide final ItemPrice (JPY) for Qoo10 API
 * 
 * STRICT: CostPriceKrw is REQUIRED.
 * If missing/invalid, returns error that MUST fail the registration.
 * 
 * @param {object} params
 * @param {object} params.row - Current row data from sheet
 * @param {string} params.vendorItemId - Vendor item ID for logging
 * @param {string} params.mode - 'CREATE' or 'UPDATE' for logging
 * @returns {{ 
 *   valid: boolean, 
 *   priceJpy: string, 
 *   costPriceKrw: string,
 *   error: string | null 
 * }}
 */
function decideItemPriceJpy({ row, vendorItemId, mode }) {
  const costPriceKrw = row?.CostPriceKrw;
  const parsed = parseCostPriceKrw(costPriceKrw);
  
  if (!parsed.valid) {
    // STRICT: CostPriceKrw is REQUIRED
    const errorMsg = 'CostPriceKrw missing or invalid';
    console.error(`[PriceDecision][ERROR] vendorItemId=${vendorItemId} CostPriceKrw="${costPriceKrw || ''}" - ${errorMsg}`);
    
    return {
      valid: false,
      priceJpy: '',
      costPriceKrw: String(costPriceKrw || ''),
      error: errorMsg
    };
  }
  
  // Compute JPY
  const priceJpy = String(Math.floor(parsed.krw / FX_JPY_TO_KRW));
  
  // Log success
  console.log(`[PriceDecision][${mode}] vendorItemId=${vendorItemId} CostPriceKrw=${parsed.sanitized} ItemPriceJPY=${priceJpy} source=computed_from_cost`);
  
  return {
    valid: true,
    priceJpy,
    costPriceKrw: parsed.sanitized,
    error: null
  };
}

module.exports = {
  FX_JPY_TO_KRW,
  parseCostPriceKrw,
  computeJpyFromKrw,
  decideItemPriceJpy
};
