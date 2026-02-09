/**
 * Coupang to Sheet - Popup Script
 * Handles UI interactions and communication with content script
 */

const RECEIVER_URL = 'http://127.0.0.1:8787/api/coupang/upsert';
const COUPANG_URL_PATTERN = /^https:\/\/www\.coupang\.com\/vp\/products\/\d+/;

// UI Elements
let statusEl, statusTextEl, productInfoEl, sendBtn, errorMsgEl;
let infoProductIdEl, infoTitleEl, infoPriceEl;

// State
let currentProductData = null;

document.addEventListener('DOMContentLoaded', () => {
  // Get UI elements
  statusEl = document.getElementById('status');
  statusTextEl = statusEl.querySelector('.status-text');
  productInfoEl = document.getElementById('product-info');
  sendBtn = document.getElementById('send-btn');
  errorMsgEl = document.getElementById('error-msg');
  infoProductIdEl = document.getElementById('info-product-id');
  infoTitleEl = document.getElementById('info-title');
  infoPriceEl = document.getElementById('info-price');
  
  // Set up button click handler
  sendBtn.addEventListener('click', handleSendClick);
  
  // Check current tab on popup open
  checkCurrentTab();
});

/**
 * Update status display
 */
function setStatus(state, text) {
  statusEl.className = `status ${state}`;
  statusTextEl.textContent = text;
}

/**
 * Show error message
 */
function showError(msg) {
  errorMsgEl.textContent = msg;
  errorMsgEl.classList.remove('hidden');
}

/**
 * Hide error message
 */
function hideError() {
  errorMsgEl.classList.add('hidden');
}

/**
 * Update product info display
 */
function updateProductInfo(data) {
  if (!data) {
    productInfoEl.classList.add('hidden');
    return;
  }
  
  infoProductIdEl.textContent = data.coupang_product_id || '-';
  infoTitleEl.textContent = data.ItemTitle || '-';
  infoPriceEl.textContent = data.ItemPrice ? `₩${Number(data.ItemPrice).toLocaleString()}` : '-';
  productInfoEl.classList.remove('hidden');
}

/**
 * Check if current tab is a Coupang product page
 */
async function checkCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.url) {
      setStatus('error', 'Cannot access tab');
      sendBtn.disabled = true;
      return;
    }
    
    if (!COUPANG_URL_PATTERN.test(tab.url)) {
      setStatus('error', 'Not a Coupang product page');
      showError('Please navigate to a Coupang product page (coupang.com/vp/products/...)');
      sendBtn.disabled = true;
      return;
    }
    
    setStatus('idle', 'Ready to collect');
    sendBtn.disabled = false;
    
  } catch (err) {
    setStatus('error', 'Error checking tab');
    showError(err.message);
    sendBtn.disabled = true;
  }
}

/**
 * Handle Send button click
 */
async function handleSendClick() {
  hideError();
  sendBtn.disabled = true;
  
  try {
    // Step 1: Collect data from page
    setStatus('collecting', 'Collecting data...');
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.id) {
      throw new Error('Cannot access current tab');
    }
    
    // Inject and execute content script to extract data
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractProductData,
    });
    
    if (!results || !results[0] || !results[0].result) {
      throw new Error('Failed to extract product data');
    }
    
    currentProductData = results[0].result;
    
    // Validate required fields
    if (!currentProductData.vendorItemId && !currentProductData.itemId) {
      throw new Error('Missing required field: vendorItemId or itemId');
    }
    
    updateProductInfo(currentProductData);
    
    // Step 2: Send to receiver
    setStatus('sending', 'Sending to Sheet...');
    
    const response = await sendToReceiver(currentProductData);
    
    if (!response.ok) {
      throw new Error(response.error || 'Failed to save to sheet');
    }
    
    setStatus('done', `Saved! (${response.mode})`);
    
  } catch (err) {
    setStatus('error', 'Failed');
    showError(err.message);
  } finally {
    sendBtn.disabled = false;
  }
}

/**
 * Send data to local receiver with retries
 */
async function sendToReceiver(data, retries = 2) {
  const delays = [250, 750];
  let lastError;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(RECEIVER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }
      
      return result;
      
    } catch (err) {
      lastError = err;
      
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, delays[attempt]));
      }
    }
  }
  
  // Check if receiver is running
  if (lastError.message.includes('fetch') || lastError.message.includes('network')) {
    throw new Error('Cannot connect to receiver. Is it running?\nRun: npm run coupang:receiver:start');
  }
  
  throw lastError;
}

/**
 * Extract product data from the page DOM
 * This function runs in the context of the Coupang page
 * 
 * Tier-1 fields: categoryId (URL only), ItemPrice, WeightKg (fixed to 1)
 * Tier-2 fields: Options (single type), ItemDescriptionText, ProductURL
 * Category fields: breadcrumbSegments (for category dictionary)
 */
function extractProductData() {
  const result = {
    // Tier-1 Required
    coupang_product_id: '',
    itemId: '',
    vendorItemId: '',
    categoryId: '',        // From URL query string ONLY
    ItemTitle: '',
    ItemPrice: null,       // Number (integer KRW) or null if not found
    StandardImage: '',
    WeightKg: '1',         // FIXED: Always 1, no scraping
    
    // Tier-2
    Options: null,         // { type: "SIZE", values: ["S", "M", "L"] }
    ItemDescriptionText: '', // Plain text, no HTML/images
    ProductURL: '',        // Full URL as-is
    
    // Category accumulation
    breadcrumbSegments: [], // Category path segments for dictionary
    
    // Keep for compatibility
    ExtraImages: [],
  };
  
  try {
    // ========== URL Parsing (Tier-1) ==========
    const url = new URL(window.location.href);
    const pathMatch = url.pathname.match(/\/vp\/products\/(\d+)/);
    
    result.coupang_product_id = pathMatch ? pathMatch[1] : '';
    result.itemId = url.searchParams.get('itemId') || '';
    result.vendorItemId = url.searchParams.get('vendorItemId') || '';
    
    // categoryId: ONLY from URL query string
    result.categoryId = url.searchParams.get('categoryId') || '';
    
    // ProductURL: Full URL as-is
    result.ProductURL = window.location.href;
    
    // ========== Title (Tier-1) ==========
    const titleEl = document.querySelector('.prod-buy-header__title') ||
                    document.querySelector('h1.prod-title') ||
                    document.querySelector('[class*="ProductName"]') ||
                    document.querySelector('h2.prod-title');
    
    if (titleEl) {
      result.ItemTitle = titleEl.textContent.trim();
    } else {
      const pageTitle = document.title.split('|')[0].trim();
      result.ItemTitle = pageTitle;
    }
    
    // ========== Price (Tier-1) ==========
    // Target: .final-price-amount
    // Parse "5,800원" → 5800
    result.ItemPrice = null; // Default to null if not found
    
    try {
      const priceEl = document.querySelector('.final-price-amount');
      
      if (priceEl) {
        const priceText = priceEl.textContent || '';
        // Remove commas and "원", extract digits only
        const cleaned = priceText.replace(/,/g, '').replace(/원/g, '').trim();
        const parsed = parseInt(cleaned, 10);
        
        if (!isNaN(parsed) && parsed > 0) {
          result.ItemPrice = parsed;
        }
      }
    } catch (e) {
      // Parsing failed, keep ItemPrice = null
    }
    
    // ========== WeightKg (Tier-1) ==========
    // FIXED: Always 1, no scraping per requirements
    result.WeightKg = '1';
    
    // ========== Main Image ==========
    const mainImgEl = document.querySelector('.prod-image__detail img') ||
                      document.querySelector('.prod-image img') ||
                      document.querySelector('[class*="ProductImage"] img') ||
                      document.querySelector('.prod-image__item img');
    
    if (mainImgEl) {
      let imgSrc = mainImgEl.src || mainImgEl.getAttribute('data-src') || '';
      const thumbnailsIdx = imgSrc.indexOf('thumbnails/');
      if (thumbnailsIdx !== -1) {
        result.StandardImage = imgSrc.substring(thumbnailsIdx);
      } else {
        result.StandardImage = imgSrc;
      }
    }
    
    // Fallback to og:image
    if (!result.StandardImage) {
      const ogImage = document.querySelector('meta[property="og:image"]');
      if (ogImage) {
        let imgSrc = ogImage.content;
        const thumbnailsIdx = imgSrc.indexOf('thumbnails/');
        if (thumbnailsIdx !== -1) {
          result.StandardImage = imgSrc.substring(thumbnailsIdx);
        } else {
          result.StandardImage = imgSrc;
        }
      }
    }
    
    // ========== Options (Tier-2) ==========
    // Single option type only: SIZE OR COLOR OR one arbitrary type
    const optionResult = extractSingleOption();
    if (optionResult) {
      result.Options = optionResult;
    }
    
    // ========== ItemDescriptionText (Tier-2) ==========
    // Extract text-only description, no HTML/images
    result.ItemDescriptionText = extractDescriptionText();
    
    // ========== Breadcrumb Extraction (Category Dictionary) ==========
    result.breadcrumbSegments = extractBreadcrumbSegments();
    
    // Debug: Log extraction results in browser console
    console.log('[Coupang Extension] === Extraction Summary ===');
    console.log('[Coupang Extension] categoryId:', result.categoryId);
    console.log('[Coupang Extension] breadcrumbSegments:', result.breadcrumbSegments);
    console.log('[Coupang Extension] breadcrumbSegments.length:', result.breadcrumbSegments.length);
    
    // ========== Extra Images (keep for compatibility, but not Tier-3) ==========
    // Minimal extraction - exclude thumbnail gallery divs per requirements
    const extraImgEls = document.querySelectorAll('.prod-image__items img, .prod-image__sub img');
    const seenImages = new Set();
    
    if (result.StandardImage) {
      seenImages.add(result.StandardImage);
    }
    
    extraImgEls.forEach(img => {
      // Skip if inside twc-w-[70px] thumbnail gallery (out of scope)
      if (img.closest('[class*="twc-w-[70px]"]')) return;
      
      let imgSrc = img.src || img.getAttribute('data-src') || '';
      if (!imgSrc || imgSrc.includes('loading') || imgSrc.includes('placeholder')) return;
      
      const thumbnailsIdx = imgSrc.indexOf('thumbnails/');
      const normalizedSrc = thumbnailsIdx !== -1 ? imgSrc.substring(thumbnailsIdx) : imgSrc;
      
      if (!seenImages.has(normalizedSrc) && result.ExtraImages.length < 5) {
        seenImages.add(normalizedSrc);
        result.ExtraImages.push(imgSrc);
      }
    });
    
  } catch (err) {
    console.error('Coupang extraction error:', err);
  }
  
  return result;
}

/**
 * Extract single option type from the page
 * Returns { type: "SIZE", values: ["S", "M", "L"] } or null
 */
function extractSingleOption() {
  try {
    // Look for option selectors
    const optionContainers = document.querySelectorAll(
      '.prod-option, ' +
      '.prod-option__item, ' +
      '[class*="OptionSelector"], ' +
      '.prod-buy-option, ' +
      '.option-wrapper'
    );
    
    // Try to find option title/type
    let optionType = null;
    let optionValues = [];
    
    // Check for labeled option sections
    const optionLabels = document.querySelectorAll('.prod-option__title, .option-title, [class*="optionName"]');
    
    for (const label of optionLabels) {
      const labelText = label.textContent.trim().toLowerCase();
      
      // Identify option type
      if (labelText.includes('사이즈') || labelText.includes('size')) {
        optionType = 'SIZE';
      } else if (labelText.includes('색상') || labelText.includes('color') || labelText.includes('컬러')) {
        optionType = 'COLOR';
      } else if (labelText.includes('옵션') || labelText.includes('option')) {
        optionType = 'OPTION';
      }
      
      if (optionType) break;
    }
    
    // Extract option values from buttons/items
    const optionItems = document.querySelectorAll(
      '.prod-option__item button, ' +
      '.prod-option__selected-container button, ' +
      '[class*="optionItem"], ' +
      '.option-value, ' +
      'select.prod-option__selector option'
    );
    
    const seenValues = new Set();
    
    optionItems.forEach(item => {
      let value = '';
      
      if (item.tagName === 'OPTION') {
        value = item.textContent.trim();
      } else {
        // Get text content, excluding price info
        const clone = item.cloneNode(true);
        // Remove price elements
        clone.querySelectorAll('[class*="price"], [class*="won"]').forEach(el => el.remove());
        value = clone.textContent.trim();
      }
      
      // Clean up value
      value = value.replace(/[₩\d,원]/g, '').trim();
      
      if (value && value.length > 0 && value.length < 50 && !seenValues.has(value)) {
        seenValues.add(value);
        optionValues.push(value);
      }
    });
    
    // Also try select dropdowns
    if (optionValues.length === 0) {
      const selects = document.querySelectorAll('select[class*="option"], select[name*="option"]');
      selects.forEach(select => {
        select.querySelectorAll('option').forEach(opt => {
          const value = opt.textContent.trim().replace(/[₩\d,원]/g, '').trim();
          if (value && value !== '선택하세요' && value !== '옵션선택' && !seenValues.has(value)) {
            seenValues.add(value);
            optionValues.push(value);
          }
        });
        
        // Try to determine type from select name/id
        if (!optionType) {
          const selectId = (select.id + select.name + select.className).toLowerCase();
          if (selectId.includes('size') || selectId.includes('사이즈')) {
            optionType = 'SIZE';
          } else if (selectId.includes('color') || selectId.includes('색상')) {
            optionType = 'COLOR';
          }
        }
      });
    }
    
    // Return result if we found options
    if (optionValues.length > 0) {
      return {
        type: optionType || 'OPTION',
        values: optionValues.slice(0, 20) // Limit to 20 values
      };
    }
    
    return null;
    
  } catch (err) {
    console.error('Option extraction error:', err);
    return null;
  }
}

/**
 * Extract text-only product description
 * Removes all images and HTML tags
 */
function extractDescriptionText() {
  try {
    // Find description container
    const descContainers = document.querySelectorAll(
      '.product-detail-content-inside, ' +
      '.prod-description, ' +
      '#productDetail, ' +
      '.product-detail, ' +
      '[class*="ProductDescription"]'
    );
    
    let descText = '';
    
    for (const container of descContainers) {
      // Clone to avoid modifying DOM
      const clone = container.cloneNode(true);
      
      // Remove all images
      clone.querySelectorAll('img, video, iframe, script, style').forEach(el => el.remove());
      
      // Get text content
      const text = clone.textContent || '';
      
      // Clean up whitespace
      const cleaned = text
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n')
        .trim();
      
      if (cleaned.length > descText.length) {
        descText = cleaned;
      }
    }
    
    // Fallback: try to get from product info section
    if (descText.length < 50) {
      const infoSections = document.querySelectorAll('.prod-attr, .prod-essential-info, [class*="productInfo"]');
      infoSections.forEach(section => {
        const text = section.textContent.replace(/\s+/g, ' ').trim();
        if (text.length > descText.length) {
          descText = text;
        }
      });
    }
    
    // Limit length
    if (descText.length > 5000) {
      descText = descText.substring(0, 5000) + '...';
    }
    
    return descText;
    
  } catch (err) {
    console.error('Description extraction error:', err);
    return '';
  }
}

/**
 * Extract breadcrumb segments from the page
 * Returns array of category names (excluding "쿠팡 홈")
 */
function extractBreadcrumbSegments() {
  const anchors = Array.from(
    document.querySelectorAll(
      'ul[class*="breadcrumb"] a, a[href*="/np/categories/"]'
    )
  );

  return anchors
    .map(a => a.textContent.trim())
    .filter(Boolean)
    .filter(text => text !== '쿠팡 홈');
}
