/**
 * Shipping Fee Lookup Module
 * 
 * Fetches Japan shipping fees from Txlogis_standard Google Sheet tab.
 * Uses weight ranges to determine the correct shipping fee in JPY.
 * 
 * Caches data once per run for efficiency.
 */

const TAB_NAME = 'Txlogis_standard';

// Module-level cache
let shippingRatesCache = null;
let cacheLoaded = false;

/**
 * Parse weight from string/number
 * @param {string|number} weight - Weight value
 * @returns {{ valid: boolean, kg: number, sanitized: string }}
 */
function parseWeight(weight) {
  if (weight === undefined || weight === null || weight === '') {
    return { valid: false, kg: 0, sanitized: '' };
  }
  
  // Sanitize: trim, remove commas
  const sanitized = String(weight).trim().replace(/,/g, '');
  
  // Parse number
  const kg = parseFloat(sanitized);
  
  // Validate: must be positive number
  if (isNaN(kg) || kg <= 0) {
    return { valid: false, kg: 0, sanitized };
  }
  
  return { valid: true, kg, sanitized };
}

/**
 * Load shipping rates from Google Sheets (with caching)
 * @param {object} sheetsClient - Google Sheets API client
 * @param {string} sheetId - Google Sheet ID
 * @returns {Promise<Array<{start: number, end: number, fee: number}>>}
 */
async function loadShippingRates(sheetsClient, sheetId) {
  // Return cached data if already loaded
  if (cacheLoaded && shippingRatesCache !== null) {
    return shippingRatesCache;
  }
  
  console.log(`[ShippingLookup] Loading shipping rates from ${TAB_NAME}...`);
  
  try {
    // Read all data from the tab
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${TAB_NAME}!A:Z`,
    });
    
    const rows = response.data.values || [];
    
    if (rows.length < 2) {
      console.warn(`[ShippingLookup] No data rows found in ${TAB_NAME}`);
      shippingRatesCache = [];
      cacheLoaded = true;
      return shippingRatesCache;
    }
    
    // Parse headers - detect column names dynamically
    const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
    
    // Debug log normalized headers
    console.log(`[ShippingLookup] Normalized headers: [${headers.map(h => `"${h}"`).join(', ')}]`);
    
    // Find column indices by header name patterns (supports Korean and English)
    const startColIdx = headers.findIndex(h => 
      h.includes('시작') || h.includes('최소') ||  // Korean: start, min
      h.includes('start') || h.includes('min') || h.includes('from') || h === 'startweightkg'
    );
    const endColIdx = headers.findIndex(h => 
      h.includes('종료') || h.includes('끝') || h.includes('최대') ||  // Korean: end, finish, max
      h.includes('end') || h.includes('max') || h.includes('to') || h === 'endweightkg'
    );
    const feeColIdx = headers.findIndex(h => 
      h.includes('fee') || h.includes('jpy') || h.includes('price') || h.includes('cost')
    );
    
    // Log detected columns
    console.log(`[ShippingLookup] Detected columns: start=${startColIdx}(${headers[startColIdx]}), end=${endColIdx}(${headers[endColIdx]}), fee=${feeColIdx}(${headers[feeColIdx]})`);
    
    if (startColIdx === -1 || endColIdx === -1 || feeColIdx === -1) {
      console.error(`[ShippingLookup] Could not detect required columns. Headers: ${headers.join(', ')}`);
      console.error(`[ShippingLookup] Expected headers containing: start/min, end/max, fee/jpy/price/cost`);
      shippingRatesCache = [];
      cacheLoaded = true;
      return shippingRatesCache;
    }
    
    // Parse data rows into normalized format
    const rates = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      
      const startStr = String(row[startColIdx] || '').trim().replace(/,/g, '');
      const endStr = String(row[endColIdx] || '').trim().replace(/,/g, '');
      const feeStr = String(row[feeColIdx] || '').trim().replace(/,/g, '');
      
      const start = parseFloat(startStr);
      const end = parseFloat(endStr);
      const fee = parseFloat(feeStr);
      
      // Skip invalid rows
      if (isNaN(start) || isNaN(end) || isNaN(fee)) {
        console.warn(`[ShippingLookup] Skipping invalid row ${i + 1}: start=${startStr}, end=${endStr}, fee=${feeStr}`);
        continue;
      }
      
      rates.push({ start, end, fee: Math.round(fee) });
    }
    
    console.log(`[ShippingLookup] Loaded ${rates.length} shipping rate ranges`);
    
    // Sort by start weight for efficient lookup
    rates.sort((a, b) => a.start - b.start);
    
    shippingRatesCache = rates;
    cacheLoaded = true;
    return shippingRatesCache;
    
  } catch (err) {
    console.error(`[ShippingLookup] Error loading shipping rates: ${err.message}`);
    shippingRatesCache = [];
    cacheLoaded = true;
    return shippingRatesCache;
  }
}

/**
 * Get Japan shipping fee for a given weight
 * 
 * @param {object} params
 * @param {object} params.sheetsClient - Google Sheets API client
 * @param {string} params.sheetId - Google Sheet ID
 * @param {number} params.weightKg - Product weight in kg
 * @returns {Promise<{valid: boolean, feeJpy: number, matchedRange: string, error: string|null}>}
 */
async function getJapanShippingJpyForWeight({ sheetsClient, sheetId, weightKg }) {
  // Load rates (uses cache if already loaded)
  const rates = await loadShippingRates(sheetsClient, sheetId);
  
  if (rates.length === 0) {
    return {
      valid: false,
      feeJpy: 0,
      matchedRange: '',
      error: 'Txlogis_standard sheet is empty or could not be loaded'
    };
  }
  
  // Find matching range: start <= weightKg <= end
  const matched = rates.find(r => weightKg >= r.start && weightKg <= r.end);
  
  if (!matched) {
    return {
      valid: false,
      feeJpy: 0,
      matchedRange: '',
      error: `Txlogis shipping fee not found for weightKg=${weightKg}`
    };
  }
  
  const matchedRange = `${matched.start}-${matched.end}`;
  
  console.log(`[Shipping] WeightKg=${weightKg} matchedRange=${matchedRange} shippingJpy=${matched.fee}`);
  
  return {
    valid: true,
    feeJpy: matched.fee,
    matchedRange,
    error: null
  };
}

/**
 * Clear the shipping rates cache (useful for testing)
 */
function clearShippingCache() {
  shippingRatesCache = null;
  cacheLoaded = false;
}

module.exports = {
  parseWeight,
  loadShippingRates,
  getJapanShippingJpyForWeight,
  clearShippingCache
};
