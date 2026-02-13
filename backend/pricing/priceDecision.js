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
 * - WeightKg is REQUIRED (for Txlogis shipping fee lookup)
 * - If missing/invalid: registration MUST fail
 * - Computed JPY is written back to qoo10SellingPrice column
 * 
 * PRICING FORMULA:
 * - baseCostJpy = (costKrw + DOMESTIC_SHIPPING_KRW) / FX_JPY_TO_KRW + japanShippingJpy
 * - requiredPrice = baseCostJpy / (1 - MARKET_COMMISSION_RATE - MIN_MARGIN_RATE)
 * - targetPrice = baseCostJpy * (1 + TARGET_MARGIN_RATE)
 * - finalPrice = Math.round(Math.max(requiredPrice, targetPrice))
 * 
 * Note: japanShippingJpy is now dynamically looked up from Txlogis_standard sheet by weight.
 */

const { 
  FX_JPY_TO_KRW, 
  DOMESTIC_SHIPPING_KRW, 
  MARKET_COMMISSION_RATE,
  TARGET_MARGIN_RATE,
  MIN_MARGIN_RATE
} = require('./pricingConstants');

const { parseWeight, getJapanShippingJpyForWeight } = require('./shippingLookup');

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
 * Formula with commission and margin:
 * 1. totalKrw = costKrw + DOMESTIC_SHIPPING_KRW
 * 2. baseCostJpy = totalKrw / FX_JPY_TO_KRW + japanShippingJpy
 * 3. requiredPrice = baseCostJpy / (1 - MARKET_COMMISSION_RATE - MIN_MARGIN_RATE)
 * 4. targetPrice = baseCostJpy * (1 + TARGET_MARGIN_RATE)
 * 5. finalJpy = round(max(requiredPrice, targetPrice))
 * 
 * @param {string|number} costKrw - Cost price in KRW
 * @param {number} japanShippingJpy - Japan shipping fee in JPY (from Txlogis_standard)
 * @returns {string} JPY price as string, or "" if invalid
 */
function computeJpyFromKrw(costKrw, japanShippingJpy) {
  const parsed = parsePriceKrw(costKrw);
  
  if (!parsed.valid) {
    return '';
  }
  
  // Validate japanShippingJpy
  if (typeof japanShippingJpy !== 'number' || isNaN(japanShippingJpy) || japanShippingJpy < 0) {
    console.error(`[PriceCalc] Invalid japanShippingJpy: ${japanShippingJpy}`);
    return '';
  }
  
  // Step 1: Add domestic shipping (KRW)
  const totalKrw = parsed.krw + DOMESTIC_SHIPPING_KRW;
  
  // Step 2: Convert to JPY and add Japan shipping
  const convertedJpy = totalKrw / FX_JPY_TO_KRW;
  const baseCostJpy = convertedJpy + japanShippingJpy;
  
  // Step 3: Calculate requiredPrice (ensures min margin after commission)
  // requiredPrice = baseCostJpy / (1 - commission - minMargin)
  const requiredPrice = baseCostJpy / (1 - MARKET_COMMISSION_RATE - MIN_MARGIN_RATE);
  
  // Step 4: Calculate targetPrice (applies target margin)
  // targetPrice = baseCostJpy * (1 + targetMargin)
  const targetPrice = baseCostJpy * (1 + TARGET_MARGIN_RATE);
  
  // Step 5: Final price is max of required and target, rounded to nearest integer
  const finalJpy = Math.round(Math.max(requiredPrice, targetPrice));
  
  // Structured debug log with all calculation variables
  console.log(`[PriceCalc] costKrw=${parsed.krw} DOMESTIC_SHIPPING_KRW=${DOMESTIC_SHIPPING_KRW} totalKrw=${totalKrw} FX_JPY_TO_KRW=${FX_JPY_TO_KRW} convertedJpy=${convertedJpy.toFixed(2)} japanShippingJpy=${japanShippingJpy} baseCostJpy=${baseCostJpy.toFixed(2)} MARKET_COMMISSION_RATE=${MARKET_COMMISSION_RATE} TARGET_MARGIN_RATE=${TARGET_MARGIN_RATE} MIN_MARGIN_RATE=${MIN_MARGIN_RATE} requiredPrice=${requiredPrice.toFixed(2)} targetPrice=${targetPrice.toFixed(2)} finalJpy=${finalJpy}`);
  
  return String(finalJpy);
}

/**
 * Validate and compute final ItemPrice (JPY) for Qoo10 API
 * 
 * STRICT: ItemPrice (KRW) and WeightKg are REQUIRED.
 * If missing/invalid, returns error that MUST fail the registration.
 * 
 * @param {object} params
 * @param {object} params.row - Current row data from sheet
 * @param {string} params.vendorItemId - Vendor item ID for logging
 * @param {string} params.mode - 'CREATE' or 'UPDATE' for logging
 * @param {object} params.sheetsClient - Google Sheets API client (for shipping lookup)
 * @param {string} params.sheetId - Google Sheet ID (for shipping lookup)
 * @returns {Promise<{ 
 *   valid: boolean, 
 *   priceJpy: string, 
 *   rawKrw: string,
 *   weightKg: number,
 *   japanShippingJpy: number,
 *   error: string | null 
 * }>}
 */
async function decideItemPriceJpy({ row, vendorItemId, mode, sheetsClient, sheetId }) {
  const rawKrw = row?.ItemPrice;
  const parsed = parsePriceKrw(rawKrw);
  
  // STRICT: ItemPrice is REQUIRED
  if (!parsed.valid) {
    const errorMsg = 'ItemPrice missing or invalid';
    console.error(`[PriceDecision][ERROR] vendorItemId=${vendorItemId} ItemPrice="${rawKrw || ''}" - ${errorMsg}`);
    
    return {
      valid: false,
      priceJpy: '',
      rawKrw: String(rawKrw || ''),
      weightKg: 0,
      japanShippingJpy: 0,
      error: errorMsg
    };
  }
  
  // STRICT: WeightKg is REQUIRED for Txlogis shipping lookup
  const rawWeight = row?.WeightKg;
  const weightParsed = parseWeight(rawWeight);
  
  if (!weightParsed.valid) {
    const errorMsg = 'WeightKg missing or invalid (required for Txlogis shipping)';
    console.error(`[PriceDecision][ERROR] vendorItemId=${vendorItemId} WeightKg="${rawWeight || ''}" - ${errorMsg}`);
    
    return {
      valid: false,
      priceJpy: '',
      rawKrw: parsed.sanitized,
      weightKg: 0,
      japanShippingJpy: 0,
      error: errorMsg
    };
  }
  
  // Lookup Japan shipping fee from Txlogis_standard
  const shippingResult = await getJapanShippingJpyForWeight({
    sheetsClient,
    sheetId,
    weightKg: weightParsed.kg
  });
  
  if (!shippingResult.valid) {
    console.error(`[PriceDecision][ERROR] vendorItemId=${vendorItemId} - ${shippingResult.error}`);
    
    return {
      valid: false,
      priceJpy: '',
      rawKrw: parsed.sanitized,
      weightKg: weightParsed.kg,
      japanShippingJpy: 0,
      error: shippingResult.error
    };
  }
  
  // Compute JPY using full formula with dynamic shipping fee
  const priceJpy = computeJpyFromKrw(parsed.krw, shippingResult.feeJpy);
  
  if (!priceJpy) {
    const errorMsg = 'Price calculation failed';
    console.error(`[PriceDecision][ERROR] vendorItemId=${vendorItemId} - ${errorMsg}`);
    
    return {
      valid: false,
      priceJpy: '',
      rawKrw: parsed.sanitized,
      weightKg: weightParsed.kg,
      japanShippingJpy: shippingResult.feeJpy,
      error: errorMsg
    };
  }
  
  // Log success
  console.log(`[PriceDecision][${mode}] vendorItemId=${vendorItemId} ItemPrice(KRW)=${parsed.sanitized} WeightKg=${weightParsed.kg} japanShippingJpy=${shippingResult.feeJpy} computedJPY=${priceJpy}`);
  
  return {
    valid: true,
    priceJpy,
    rawKrw: parsed.sanitized,
    weightKg: weightParsed.kg,
    japanShippingJpy: shippingResult.feeJpy,
    error: null
  };
}

module.exports = {
  FX_JPY_TO_KRW,
  parsePriceKrw,
  parseWeight,
  computeJpyFromKrw,
  decideItemPriceJpy,
  getJapanShippingJpyForWeight
};
