/**
 * Price Decision Module
 * 
 * Centralized pricing logic for Coupang-to-Qoo10 pipeline.
 * Computes JPY selling price from KRW cost price.
 * 
 * Used by both CREATE (SetNewGoods) and UPDATE (UpdateGoods).
 */

// Fixed exchange rate: 1 JPY = 10 KRW
const FX_JPY_TO_KRW = 10;

/**
 * Compute JPY price from KRW cost price
 * @param {string|number} costPriceKrw - Cost price in KRW
 * @returns {string} JPY price as string, or "" if invalid
 */
function computeJpyFromKrw(costPriceKrw) {
  if (costPriceKrw === undefined || costPriceKrw === null) {
    return '';
  }
  
  // Sanitize: trim, remove commas
  const sanitized = String(costPriceKrw).trim().replace(/,/g, '');
  
  // Parse number
  const krw = parseFloat(sanitized);
  
  // Validate
  if (isNaN(krw) || krw <= 0) {
    return '';
  }
  
  // Convert: JPY = floor(KRW / 10)
  const jpy = Math.floor(krw / FX_JPY_TO_KRW);
  
  return String(jpy);
}

/**
 * Decide final ItemPrice (JPY) for Qoo10 API
 * 
 * Priority:
 * 1) Computed from row.CostPriceKrw (if valid)
 * 2) Fallback to existingFallbackJpy (current behavior)
 * 
 * @param {object} params
 * @param {object} params.row - Current row data from sheet
 * @param {string} params.existingFallbackJpy - Fallback JPY price (current logic)
 * @returns {{ priceJpy: string, source: string }}
 */
function decideItemPriceJpy({ row, existingFallbackJpy }) {
  // Try computed from CostPriceKrw
  const costPriceKrw = row?.CostPriceKrw;
  const computedJpy = computeJpyFromKrw(costPriceKrw);
  
  if (computedJpy !== '') {
    return {
      priceJpy: computedJpy,
      source: 'computed_from_cost'
    };
  }
  
  // Fallback to existing logic
  const fallback = String(existingFallbackJpy || '0').trim();
  return {
    priceJpy: fallback,
    source: 'fallback_existing'
  };
}

module.exports = {
  FX_JPY_TO_KRW,
  computeJpyFromKrw,
  decideItemPriceJpy
};
