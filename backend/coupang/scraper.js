/**
 * Coupang Product Scraper
 * Extracts product data from Coupang product detail pages (no-login)
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

const ENABLE_TRACER = process.env.COUPANG_TRACER === '1' || process.env.COUPANG_TRACER === 'true';

/**
 * Log tracer message
 */
function trace(...args) {
  if (ENABLE_TRACER) {
    console.log('[TRACER]', ...args);
  }
}

/**
 * Parse weight text to Kg
 * Handles patterns like "250g", "1.5kg", "1kg", "500 g", etc.
 * @param {string} text - Weight text
 * @returns {string} - Weight in Kg as string (e.g., "0.25", "1.5")
 */
function parseWeightToKg(text) {
  if (!text) return '1'; // Default 1 Kg
  
  const normalized = text.toLowerCase().replace(/\s+/g, '').replace(/,/g, '');
  
  // Match kg patterns first (e.g., "1.5kg", "2kg")
  const kgMatch = normalized.match(/([\d.]+)\s*kg/);
  if (kgMatch) {
    const val = parseFloat(kgMatch[1]);
    return isNaN(val) ? '1' : String(val);
  }
  
  // Match g patterns (e.g., "250g", "1500g")
  const gMatch = normalized.match(/([\d.]+)\s*g(?!b)/); // exclude "gb"
  if (gMatch) {
    const grams = parseFloat(gMatch[1]);
    if (!isNaN(grams)) {
      const kg = grams / 1000;
      return String(Math.round(kg * 1000) / 1000); // Round to 3 decimal places
    }
  }
  
  return '1'; // Default
}

/**
 * Normalize Coupang image URL to "thumbnails/..." format
 * @param {string} url - Full Coupang CDN URL
 * @returns {string} - Normalized path starting with "thumbnails/..."
 */
function normalizeImageUrl(url) {
  if (!url) return '';
  
  // Handle protocol-relative URLs
  if (url.startsWith('//')) {
    url = 'https:' + url;
  }
  
  // Extract path starting from "thumbnails/"
  const thumbnailsIndex = url.indexOf('thumbnails/');
  if (thumbnailsIndex !== -1) {
    return url.substring(thumbnailsIndex);
  }
  
  // If not a thumbnail URL, try to extract from image/ path
  const imageIndex = url.indexOf('image/');
  if (imageIndex !== -1) {
    return url.substring(imageIndex);
  }
  
  // Return as-is if no pattern matches
  return url;
}

/**
 * Extract URL parameters
 * @param {string} urlString - Full URL
 * @returns {Object} - Parsed URL info
 */
function parseProductUrl(urlString) {
  const url = new URL(urlString);
  
  // Extract product ID from path: /vp/products/<id>
  const pathMatch = url.pathname.match(/\/vp\/products\/(\d+)/);
  const coupangProductId = pathMatch ? pathMatch[1] : null;
  
  return {
    sourceUrl: urlString,
    coupangProductId,
    itemId: url.searchParams.get('itemId') || null,
    vendorItemId: url.searchParams.get('vendorItemId') || null,
    coupangCategoryId: url.searchParams.get('categoryId') || null,
  };
}

/**
 * Fetch HTML from URL with proper headers
 * @param {string} urlString - URL to fetch
 * @returns {Promise<string>} - HTML content
 */
function fetchHtml(urlString) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const protocol = url.protocol === 'https:' ? https : http;
    
    // Realistic browser headers to avoid bot detection
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'identity',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Referer': 'https://www.coupang.com/',
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
    };
    
    // Add cookie if provided (for authenticated requests)
    const cookie = process.env.COUPANG_COOKIE;
    if (cookie && cookie.trim()) {
      headers['Cookie'] = cookie.trim();
      trace('Using COUPANG_COOKIE from env');
    } else {
      trace('No COUPANG_COOKIE set - attempting no-login fetch');
    }
    
    trace(`Fetching: ${urlString}`);
    trace('Headers:', JSON.stringify(headers, null, 2));
    
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers,
    };
    
    const req = protocol.request(options, (res) => {
      trace(`Response status: ${res.statusCode}`);
      trace(`Response headers:`, JSON.stringify(res.headers, null, 2));
      
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        trace(`Redirecting to: ${res.headers.location}`);
        let redirectUrl = res.headers.location;
        if (redirectUrl.startsWith('/')) {
          redirectUrl = `${url.protocol}//${url.hostname}${redirectUrl}`;
        }
        fetchHtml(redirectUrl).then(resolve).catch(reject);
        return;
      }
      
      // Handle error status codes with actionable guidance
      if (res.statusCode === 403 || res.statusCode === 429) {
        const errorMsg = res.statusCode === 403 
          ? 'Access denied (403 Forbidden)' 
          : 'Rate limited (429 Too Many Requests)';
        
        reject(new Error(
          `${errorMsg}\n\n` +
          `To fix this, set COUPANG_COOKIE in backend/.env:\n` +
          `  1. Login to Coupang in Chrome browser\n` +
          `  2. Open DevTools (F12) -> Network tab\n` +
          `  3. Navigate to a product page\n` +
          `  4. Click on the main document request\n` +
          `  5. Copy the "cookie" request header value\n` +
          `  6. Paste into backend/.env:\n` +
          `     COUPANG_COOKIE=<paste_here>\n` +
          `  7. Rerun: npm run coupang:scrape:dry:trace\n\n` +
          `Note: Cookies expire. Refresh if it stops working.`
        ));
        return;
      }
      
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: Failed to fetch page.`));
        return;
      }
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        trace(`Received ${data.length} bytes`);
        
        // Connectivity check: show first 200 chars on success in tracer mode
        if (ENABLE_TRACER && data.length > 0) {
          trace('HTML preview (first 200 chars):', data.substring(0, 200).replace(/\s+/g, ' '));
        }
        
        resolve(data);
      });
    });
    
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout after 30 seconds'));
    });
    req.end();
  });
}

/**
 * Extract text content between patterns
 */
function extractBetween(html, startPattern, endPattern) {
  const startIndex = html.indexOf(startPattern);
  if (startIndex === -1) return null;
  
  const contentStart = startIndex + startPattern.length;
  const endIndex = html.indexOf(endPattern, contentStart);
  if (endIndex === -1) return null;
  
  return html.substring(contentStart, endIndex);
}

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(text) {
  if (!text) return '';
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
}

/**
 * Extract product data from HTML
 * @param {string} html - Page HTML
 * @param {Object} urlInfo - Parsed URL info
 * @returns {Object} - Extracted product data
 */
function extractProductData(html, urlInfo) {
  trace('Starting HTML extraction...');
  
  const result = {
    // From URL - identifiers
    vendorItemId: urlInfo.vendorItemId,
    itemId: urlInfo.itemId,
    coupang_product_id: urlInfo.coupangProductId,
    categoryId: urlInfo.coupangCategoryId,
    ProductURL: urlInfo.sourceUrl,  // Exact input URL, full query string preserved
    
    // To be extracted
    ItemTitle: '',
    ItemPrice: '',
    StandardImage: '',
    ExtraImages: [],
    WeightKg: '1',  // Fixed to 1
    Options: null,
    ItemDescriptionText: '',
    
    // Timestamp
    updatedAt: new Date().toISOString(),
  };
  
  // ===== Extract Title =====
  // Try og:title first
  const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
                       html.match(/<meta\s+content="([^"]+)"\s+property="og:title"/i);
  if (ogTitleMatch) {
    result.ItemTitle = decodeHtmlEntities(ogTitleMatch[1]).trim();
    trace('Title (og:title):', result.ItemTitle.substring(0, 50) + '...');
  }
  
  // Fallback to <title> tag
  if (!result.ItemTitle) {
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
      result.ItemTitle = decodeHtmlEntities(titleMatch[1]).split('|')[0].trim();
      trace('Title (<title>):', result.ItemTitle.substring(0, 50) + '...');
    }
  }
  
  // Try product name class
  if (!result.ItemTitle) {
    const nameMatch = html.match(/class="prod-buy-header__title"[^>]*>([^<]+)</i) ||
                      html.match(/class="product-title"[^>]*>([^<]+)</i);
    if (nameMatch) {
      result.ItemTitle = decodeHtmlEntities(nameMatch[1]).trim();
    }
  }
  
  // ===== Extract Price =====
  // Look for total-price or sale-price
  const pricePatterns = [
    /class="total-price"[^>]*>[\s\S]*?<strong[^>]*>([\d,]+)<\/strong>/i,
    /class="prod-sale-price"[^>]*>[\s\S]*?<span[^>]*>([\d,]+)<\/span>/i,
    /"salePrice"\s*:\s*(\d+)/i,
    /data-price="(\d+)"/i,
    /class="price-value"[^>]*>([\d,]+)/i,
  ];
  
  for (const pattern of pricePatterns) {
    const match = html.match(pattern);
    if (match) {
      result.ItemPrice = match[1].replace(/,/g, '');
      trace('Price:', result.ItemPrice);
      break;
    }
  }
  
  // ===== Extract Main Image =====
  // Try og:image first
  const ogImageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i) ||
                       html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);
  if (ogImageMatch) {
    result.StandardImage = normalizeImageUrl(ogImageMatch[1]);
    trace('Main image (og:image):', result.StandardImage.substring(0, 80) + '...');
  }
  
  // Try product image patterns
  if (!result.StandardImage) {
    const imgPatterns = [
      /class="prod-image__detail"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i,
      /id="repImageContainer"[\s\S]*?<img[^>]+src="([^"]+)"/i,
      /"mainImage"\s*:\s*"([^"]+)"/i,
    ];
    
    for (const pattern of imgPatterns) {
      const match = html.match(pattern);
      if (match) {
        let imgUrl = match[1];
        if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
        result.StandardImage = normalizeImageUrl(imgUrl);
        break;
      }
    }
  }
  
  // ===== Extract Extra Images =====
  const imgRegex = /thumbnail[^"']*\.(?:jpg|jpeg|png|webp)/gi;
  const allImages = html.match(imgRegex) || [];
  
  const detailImgRegex = /["']([^"']*(?:thumbnail|remote)[^"']*\.(?:jpg|jpeg|png|webp))['"]/gi;
  let detailMatch;
  while ((detailMatch = detailImgRegex.exec(html)) !== null) {
    allImages.push(detailMatch[1]);
  }
  
  const seen = new Set();
  if (result.StandardImage) seen.add(result.StandardImage);
  
  for (const img of allImages) {
    const normalized = normalizeImageUrl(img);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.ExtraImages.push(normalized);
      if (result.ExtraImages.length >= 5) break;
    }
  }
  trace(`Extra images found: ${result.ExtraImages.length}`);
  
  // ===== Extract Description Text (plain text, no HTML) =====
  const descPatterns = [
    /<div[^>]+class="[^"]*product-detail[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div/i,
    /<div[^>]+id="productDetail"[^>]*>([\s\S]*?)<\/div>\s*<div/i,
  ];
  
  for (const pattern of descPatterns) {
    const match = html.match(pattern);
    if (match) {
      // Strip HTML tags for plain text
      result.ItemDescriptionText = match[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 5000);
      break;
    }
  }
  
  if (!result.ItemDescriptionText && result.ItemTitle) {
    result.ItemDescriptionText = result.ItemTitle;
  }
  trace('Description length:', result.ItemDescriptionText.length);
  
  // WeightKg is fixed to 1 - no scraping
  
  return result;
}

/**
 * Main scrape function
 * @param {string} productUrl - Coupang product URL
 * @returns {Promise<Object>} - Extracted product data
 */
async function scrapeCoupangProduct(productUrl) {
  console.log(`\n=== Coupang Scraper ===`);
  console.log(`URL: ${productUrl}\n`);
  
  // Parse URL
  const urlInfo = parseProductUrl(productUrl);
  
  if (!urlInfo.coupangProductId) {
    throw new Error('Invalid Coupang product URL: could not extract product ID');
  }
  
  console.log(`Product ID: ${urlInfo.coupangProductId}`);
  console.log(`Item ID: ${urlInfo.itemId || '(none)'}`);
  console.log(`Vendor Item ID: ${urlInfo.vendorItemId || '(none)'}`);
  console.log(`Category ID: ${urlInfo.coupangCategoryId || '(none)'}`);
  
  // Fetch HTML
  const html = await fetchHtml(productUrl);
  
  // Check for blocking
  if (html.includes('차단') || html.includes('blocked') || html.includes('captcha')) {
    throw new Error('Request appears to be blocked by Coupang.\n' +
      'Try setting COUPANG_COOKIE in backend/.env with a valid session cookie.');
  }
  
  // Extract data
  const productData = extractProductData(html, urlInfo);
  
  // Summary
  console.log(`\n=== Extraction Summary ===`);
  console.log(`ProductURL: ${productData.ProductURL.substring(0, 60)}...`);
  console.log(`Title: ${productData.ItemTitle.substring(0, 60)}${productData.ItemTitle.length > 60 ? '...' : ''}`);
  console.log(`Price: ${productData.ItemPrice || '(not found)'}`);
  console.log(`Main Image: ${productData.StandardImage ? 'OK' : '(not found)'}`);
  console.log(`Extra Images: ${productData.ExtraImages.length}`);
  console.log(`WeightKg: ${productData.WeightKg} (fixed)`);
  
  return productData;
}

module.exports = {
  scrapeCoupangProduct,
  parseWeightToKg,
  normalizeImageUrl,
  parseProductUrl,
};
