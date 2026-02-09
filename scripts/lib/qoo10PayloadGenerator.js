/**
 * Qoo10 Payload Generator
 * 
 * Generates Qoo10 SetNewGoods-ready payloads from Google Sheets Tier-2 data.
 * Does NOT call Qoo10 API or modify Google Sheets.
 * 
 * Usage:
 *   const { generatePayload, generatePayloadsFromSheet } = require('./qoo10PayloadGenerator');
 */

/**
 * Calculate Qoo10 selling price from Coupang base price
 * Formula: CEILING(BasePrice * 1.12 * 1.03, 10)
 * 
 * @param {number} basePrice - Coupang ItemPrice in KRW
 * @returns {number} - Qoo10 selling price (integer, rounded up to nearest 10)
 */
function calculateSellingPrice(basePrice) {
  if (typeof basePrice !== 'number' || isNaN(basePrice) || basePrice <= 0) {
    return null;
  }
  
  const calculated = basePrice * 1.12 * 1.03;
  // Round up to nearest 10
  const rounded = Math.ceil(calculated / 10) * 10;
  
  return rounded;
}

/**
 * Normalize image URL to thumbnails/... format if applicable
 * @param {string} url - Image URL
 * @returns {string} - Normalized URL
 */
function normalizeImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  
  // If already normalized (starts with thumbnails/), prepend CDN
  if (url.startsWith('thumbnails/')) {
    return `https://thumbnail.coupangcdn.com/${url}`;
  }
  
  return url;
}

/**
 * Parse Options field from sheet
 * @param {string|object} optionsField - Options from sheet (may be JSON string)
 * @returns {object|null} - Parsed options object or null
 */
function parseOptions(optionsField) {
  if (!optionsField) return null;
  
  try {
    const parsed = typeof optionsField === 'string' 
      ? JSON.parse(optionsField) 
      : optionsField;
    
    // Validate structure: { type: "SIZE", values: ["S", "M"] }
    if (parsed && parsed.type && Array.isArray(parsed.values) && parsed.values.length > 0) {
      return parsed;
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Generate fallback option for products without options
 * @returns {object} - Default single option
 */
function getFallbackOption() {
  return {
    optionType: 'NONE',
    optionName: '단일상품',
    optionValue: 'FREE',
    optionPrice: 0
  };
}

/**
 * Format options for Qoo10 payload
 * @param {object|null} parsedOptions - Parsed options from sheet
 * @returns {object} - Formatted options for Qoo10
 */
function formatOptionsForQoo10(parsedOptions) {
  if (!parsedOptions) {
    return getFallbackOption();
  }
  
  // Convert sheet format to Qoo10 format
  // Sheet: { type: "SIZE", values: ["S", "M", "L"] }
  // Qoo10: { optionType: "SIZE", optionName: "사이즈", optionValues: [...] }
  return {
    optionType: parsedOptions.type,
    optionName: parsedOptions.type === 'SIZE' ? '사이즈' : 
                parsedOptions.type === 'COLOR' ? '색상' : '옵션',
    optionValues: parsedOptions.values.map(v => ({
      optionValue: v,
      optionPrice: 0
    }))
  };
}

/**
 * Parse ExtraImages field
 * @param {string|array} extraImagesField - ExtraImages from sheet
 * @returns {string} - Pipe-separated URLs
 */
function parseExtraImages(extraImagesField) {
  if (!extraImagesField) return '';
  
  try {
    let images = extraImagesField;
    
    // Parse JSON string if needed
    if (typeof extraImagesField === 'string') {
      if (extraImagesField.startsWith('[')) {
        images = JSON.parse(extraImagesField);
      } else {
        // Already a single URL or pipe-separated
        return extraImagesField;
      }
    }
    
    if (!Array.isArray(images)) return '';
    
    // Normalize and join with pipe
    return images
      .map(url => normalizeImageUrl(url))
      .filter(url => url)
      .join('|');
      
  } catch (e) {
    return '';
  }
}

/**
 * Validate required fields for payload generation
 * @param {object} row - Sheet row data
 * @returns {object} - { valid: boolean, reason: string|null }
 */
function validateRow(row) {
  if (!row.ItemPrice && row.ItemPrice !== 0) {
    return { valid: false, reason: 'Missing ItemPrice' };
  }
  
  if (!row.categoryId) {
    return { valid: false, reason: 'Missing categoryId' };
  }
  
  if (!row.ItemTitle) {
    return { valid: false, reason: 'Missing ItemTitle' };
  }
  
  if (!row.vendorItemId && !row.itemId) {
    return { valid: false, reason: 'Missing vendorItemId and itemId' };
  }
  
  return { valid: true, reason: null };
}

/**
 * Generate Qoo10 SetNewGoods payload from a single sheet row
 * 
 * @param {object} row - Sheet row data (Tier-2 schema)
 * @returns {object} - { success: boolean, payload?: object, error?: string, skipped?: boolean }
 */
function generatePayload(row) {
  // Validate required fields
  const validation = validateRow(row);
  if (!validation.valid) {
    return {
      success: false,
      skipped: true,
      error: validation.reason,
      vendorItemId: row.vendorItemId || row.itemId || 'unknown'
    };
  }
  
  // Parse ItemPrice
  const basePrice = typeof row.ItemPrice === 'number' 
    ? row.ItemPrice 
    : parseInt(row.ItemPrice, 10);
  
  if (isNaN(basePrice) || basePrice <= 0) {
    return {
      success: false,
      skipped: true,
      error: `Invalid ItemPrice: ${row.ItemPrice}`,
      vendorItemId: row.vendorItemId || row.itemId
    };
  }
  
  // Calculate selling price
  const sellingPrice = calculateSellingPrice(basePrice);
  
  // Generate unique SellerCode
  const sellerCode = `auto_${row.vendorItemId || row.itemId}`;
  
  // Parse and format options
  const parsedOptions = parseOptions(row.Options);
  const formattedOptions = formatOptionsForQoo10(parsedOptions);
  
  // Normalize images
  const imageUrl = normalizeImageUrl(row.StandardImage);
  const extraImageUrl = parseExtraImages(row.ExtraImages);
  
  // Build description
  const itemDescription = row.ItemDescriptionText || row.ItemTitle || '';
  
  // Build payload
  const payload = {
    SellerCode: sellerCode,
    ItemTitle: row.ItemTitle,
    SecondSubCat: row.categoryId,
    ItemPrice: sellingPrice,
    ShippingNo: '471554',
    Weight: 1,
    ProductionPlaceType: 2,
    ProductionPlace: 'Overseas',
    ImageUrl: imageUrl,
    ExtraImageUrl: extraImageUrl,
    Options: formattedOptions,
    ItemDescription: itemDescription,
    
    // Metadata (not sent to Qoo10, for reference)
    _meta: {
      sourceVendorItemId: row.vendorItemId,
      sourceItemId: row.itemId,
      sourceCoupangProductId: row.coupang_product_id,
      sourceProductURL: row.ProductURL,
      originalPrice: basePrice,
      calculatedPrice: sellingPrice,
      priceMarkup: `${basePrice} * 1.12 * 1.03 = ${sellingPrice}`,
      hasOptions: !!parsedOptions,
      generatedAt: new Date().toISOString()
    }
  };
  
  return {
    success: true,
    payload
  };
}

/**
 * Generate payloads for multiple sheet rows
 * 
 * @param {array} rows - Array of sheet row objects
 * @returns {object} - { payloads: array, skipped: array, summary: object }
 */
function generatePayloadsFromRows(rows) {
  const payloads = [];
  const skipped = [];
  
  for (const row of rows) {
    const result = generatePayload(row);
    
    if (result.success) {
      payloads.push(result.payload);
    } else {
      skipped.push({
        vendorItemId: result.vendorItemId,
        reason: result.error
      });
    }
  }
  
  return {
    payloads,
    skipped,
    summary: {
      total: rows.length,
      generated: payloads.length,
      skipped: skipped.length
    }
  };
}

module.exports = {
  calculateSellingPrice,
  generatePayload,
  generatePayloadsFromRows,
  normalizeImageUrl,
  parseOptions,
  formatOptionsForQoo10,
  getFallbackOption,
  validateRow
};
