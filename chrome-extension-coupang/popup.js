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
 */
function extractProductData() {
  const result = {
    coupang_product_id: '',
    itemId: '',
    vendorItemId: '',
    categoryId: '',
    ItemTitle: '',
    ItemPrice: '',
    StandardImage: '',
    ExtraImages: [],
    WeightKg: '1',
  };
  
  try {
    // Parse URL for IDs
    const url = new URL(window.location.href);
    const pathMatch = url.pathname.match(/\/vp\/products\/(\d+)/);
    
    result.coupang_product_id = pathMatch ? pathMatch[1] : '';
    result.itemId = url.searchParams.get('itemId') || '';
    result.vendorItemId = url.searchParams.get('vendorItemId') || '';
    result.categoryId = url.searchParams.get('categoryId') || '';
    
    // Extract title
    const titleEl = document.querySelector('.prod-buy-header__title') ||
                    document.querySelector('h1.prod-title') ||
                    document.querySelector('[class*="ProductName"]') ||
                    document.querySelector('h2.prod-title');
    
    if (titleEl) {
      result.ItemTitle = titleEl.textContent.trim();
    } else {
      // Fallback to page title
      const pageTitle = document.title.split('|')[0].trim();
      result.ItemTitle = pageTitle;
    }
    
    // Extract price
    const priceEl = document.querySelector('.total-price strong') ||
                    document.querySelector('.prod-sale-price .total-price') ||
                    document.querySelector('[class*="ProductPrice"]') ||
                    document.querySelector('.prod-price .total-price');
    
    if (priceEl) {
      const priceText = priceEl.textContent.replace(/[^\d]/g, '');
      result.ItemPrice = priceText;
    }
    
    // Extract main image
    const mainImgEl = document.querySelector('.prod-image__detail img') ||
                      document.querySelector('.prod-image img') ||
                      document.querySelector('[class*="ProductImage"] img') ||
                      document.querySelector('.prod-image__item img');
    
    if (mainImgEl) {
      let imgSrc = mainImgEl.src || mainImgEl.getAttribute('data-src') || '';
      
      // Normalize to thumbnails/... path
      const thumbnailsIdx = imgSrc.indexOf('thumbnails/');
      if (thumbnailsIdx !== -1) {
        result.StandardImage = imgSrc.substring(thumbnailsIdx);
      } else {
        result.StandardImage = imgSrc;
      }
    }
    
    // Also check og:image as fallback
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
    
    // Extract extra images
    const extraImgEls = document.querySelectorAll('.prod-image__items img, .prod-image__sub img, [class*="thumbnail"] img');
    const seenImages = new Set();
    
    if (result.StandardImage) {
      seenImages.add(result.StandardImage);
    }
    
    extraImgEls.forEach(img => {
      let imgSrc = img.src || img.getAttribute('data-src') || '';
      if (!imgSrc || imgSrc.includes('loading') || imgSrc.includes('placeholder')) return;
      
      // Normalize
      const thumbnailsIdx = imgSrc.indexOf('thumbnails/');
      const normalizedSrc = thumbnailsIdx !== -1 ? imgSrc.substring(thumbnailsIdx) : imgSrc;
      
      if (!seenImages.has(normalizedSrc) && result.ExtraImages.length < 10) {
        seenImages.add(normalizedSrc);
        result.ExtraImages.push(imgSrc); // Store full URL for extra images
      }
    });
    
    // Extract weight (best effort)
    const bodyText = document.body.innerText;
    
    // Try various weight patterns
    const weightPatterns = [
      /총\s*중량\s*[:：]?\s*([\d,.]+)\s*(g|kg|그램|킬로그램)/i,
      /중량\s*[:：]?\s*([\d,.]+)\s*(g|kg|그램|킬로그램)/i,
      /무게\s*[:：]?\s*([\d,.]+)\s*(g|kg|그램|킬로그램)/i,
      /내용량\s*[:：]?\s*([\d,.]+)\s*(g|kg|그램|킬로그램)/i,
      /([\d,.]+)\s*(g|kg)\b/i,
    ];
    
    for (const pattern of weightPatterns) {
      const match = bodyText.match(pattern);
      if (match) {
        const value = parseFloat(match[1].replace(/,/g, ''));
        const unit = match[2].toLowerCase();
        
        if (!isNaN(value)) {
          if (unit === 'g' || unit === '그램') {
            result.WeightKg = String(Math.round((value / 1000) * 1000) / 1000);
          } else if (unit === 'kg' || unit === '킬로그램') {
            result.WeightKg = String(value);
          }
          break;
        }
      }
    }
    
    // Try to find additional data in page scripts
    const scripts = document.querySelectorAll('script');
    scripts.forEach(script => {
      const text = script.textContent;
      
      // Look for structured data
      if (text.includes('__NEXT_DATA__') || text.includes('initialState')) {
        try {
          // Try to extract product data from JSON
          const jsonMatch = text.match(/\{[^{}]*"productId"[^{}]*\}/);
          if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]);
            if (data.productId && !result.coupang_product_id) {
              result.coupang_product_id = String(data.productId);
            }
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
    });
    
  } catch (err) {
    console.error('Coupang extraction error:', err);
  }
  
  return result;
}
