#!/usr/bin/env node
/**
 * Coupang Data Receiver Server
 * 
 * Local HTTP server that receives product data from the Chrome extension
 * and upserts it to Google Sheets.
 * Also accumulates category information into "coupang_categorys" sheet.
 * 
 * Usage:
 *   node scripts/coupang-receiver.js
 *   npm run coupang:receiver:start
 * 
 * Environment (from backend/.env):
 *   GOOGLE_SHEET_ID - Target Google Sheet ID
 *   GOOGLE_SHEET_TAB_NAME - Tab name (default: coupang_datas)
 *   GOOGLE_SERVICE_ACCOUNT_JSON_PATH - Path to service account key
 *   COUPANG_RECEIVER_PORT - Server port (default: 8787)
 *   COUPANG_TRACER - Enable verbose logging (1=on)
 */

// Load environment
require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') });

const http = require('http');
const { ensureHeaders, upsertRow } = require('./lib/sheetsClient');
const { parseBreadcrumbSegments } = require('./lib/categoryParser');
const { upsertCategory } = require('./lib/categorySheetClient');

// Configuration
const PORT = parseInt(process.env.COUPANG_RECEIVER_PORT || '8787', 10);
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB_NAME = process.env.GOOGLE_SHEET_TAB_NAME || 'coupang_datas';
const TRACER = process.env.COUPANG_TRACER === '1' || process.env.COUPANG_TRACER === 'true';

/**
 * Log tracer message
 */
function trace(...args) {
  if (TRACER) {
    console.log('[TRACER]', ...args);
  }
}

// Canonical sheet headers (Tier-1 + Tier-2 + Change Tracking)
const SHEET_HEADERS = [
  'vendorItemId',
  'itemId',
  'coupang_product_id',
  'categoryId',           // Tier-1: From URL only
  'ProductURL',           // Tier-2: Full URL
  'ItemTitle',
  'ItemPrice',            // Tier-1: Number, no symbols (legacy)
  'StandardImage',
  'ExtraImages',
  'WeightKg',             // Tier-1: Fixed to 1
  'Options',              // Tier-2: JSON { type, values }
  'ItemDescriptionText',  // Tier-2: Plain text, no HTML
  'updatedAt',
  'categoryPath2',        // Last 2 breadcrumb segments joined by " > "
  'categoryPath3',        // Last 3 breadcrumb segments joined by " > "
  // Change tracking columns
  'optionsHash',          // Hash of normalized Options
  'prevItemPrice',        // Previous price when change detected
  'prevOptionsHash',      // Previous optionsHash when change detected
  'changeFlags',          // Pipe-separated flags (PRICE_UP|PRICE_DOWN|OPTIONS_CHANGED)
  'needsUpdate',          // YES if changeFlags non-empty, else NO
  'lastRescrapedAt',      // Set on re-scrape (row existed)
  // Qoo10/JP registration columns (preserved on re-scrape)
  'qoo10ItemId',
  'qoo10SellerCode',
  'qoo10SellingPrice',    // KRW input → computed JPY written back here
  'jpCategoryIdUsed',
  'categoryMatchType',
  'categoryMatchConfidence',
  'coupangCategoryKeyUsed',
  'registrationMode',
  'registrationStatus',
  'registrationMessage',
  'lastRegisteredAt',
];

// Columns to preserve on re-scrape (JP/Qoo10 registration data)
const PRESERVE_COLUMNS = [
  'qoo10ItemId',
  'qoo10SellerCode',
  'qoo10SellingPrice',
  'jpCategoryIdUsed',
  'categoryMatchType',
  'categoryMatchConfidence',
  'coupangCategoryKeyUsed',
  'registrationMode',
  'registrationStatus',
  'registrationMessage',
  'lastRegisteredAt',
];

/**
 * Compute categoryPath2 and categoryPath3 from breadcrumbSegments
 * @param {string[]} segments - Array of breadcrumb segments
 * @returns {{ categoryPath2: string, categoryPath3: string }}
 */
function computeCategoryPaths(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { categoryPath2: '', categoryPath3: '' };
  }
  
  const last2 = segments.slice(-2);
  const last3 = segments.slice(-3);
  
  return {
    categoryPath2: last2.join(' > '),
    categoryPath3: last3.join(' > ')
  };
}

/**
 * Normalize Options to a stable, sortable format
 * @param {any} options - Options data (string or object)
 * @returns {string} Normalized JSON string
 */
function normalizeOptions(options) {
  if (!options || options === '' || options === '[]' || options === '{}') {
    return '[]';
  }
  
  let parsed;
  if (typeof options === 'string') {
    try {
      parsed = JSON.parse(options);
    } catch (e) {
      return '[]';
    }
  } else {
    parsed = options;
  }
  
  // Handle single option format { type, values }
  if (parsed && parsed.type && Array.isArray(parsed.values)) {
    // Sort values for stable comparison
    const sortedValues = [...parsed.values].sort();
    return JSON.stringify({ type: parsed.type, values: sortedValues });
  }
  
  // Handle array format
  if (Array.isArray(parsed)) {
    // Sort array items by name/type
    const sorted = [...parsed].sort((a, b) => {
      const aKey = (a.optionName || a.name || a.type || '').toLowerCase();
      const bKey = (b.optionName || b.name || b.type || '').toLowerCase();
      return aKey.localeCompare(bKey);
    });
    return JSON.stringify(sorted);
  }
  
  return JSON.stringify(parsed);
}

/**
 * Compute a stable hash for Options data
 * @param {any} options - Options data
 * @returns {string} Hash string (8 chars)
 */
function computeOptionsHash(options) {
  const crypto = require('crypto');
  const normalized = normalizeOptions(options);
  return crypto.createHash('sha1').update(normalized).digest('hex').substring(0, 8);
}

/**
 * Detect changes between old and new data
 * @param {object} existingData - Existing row data
 * @param {object} newData - New scraped data
 * @returns {{ flags: string[], prevItemPrice: string, prevOptionsHash: string, newOptionsHash: string }}
 */
function detectChanges(existingData, newData) {
  const flags = [];
  let prevItemPrice = '';
  let prevOptionsHash = '';
  
  // Compute new options hash
  const newOptionsHash = computeOptionsHash(newData.Options);
  
  // 1) Price change detection
  const oldPrice = parseInt(existingData.ItemPrice, 10) || 0;
  const newPrice = parseInt(newData.ItemPrice, 10) || 0;
  
  if (oldPrice > 0 && newPrice > 0 && oldPrice !== newPrice) {
    if (newPrice > oldPrice) {
      flags.push('PRICE_UP');
    } else {
      flags.push('PRICE_DOWN');
    }
    prevItemPrice = String(oldPrice);
  }
  
  // 2) Options change detection
  // Get old hash from existing column, or compute from existing Options
  let oldOptionsHash = existingData.optionsHash;
  if (!oldOptionsHash && existingData.Options) {
    oldOptionsHash = computeOptionsHash(existingData.Options);
  }
  
  if (oldOptionsHash && newOptionsHash && oldOptionsHash !== newOptionsHash) {
    flags.push('OPTIONS_CHANGED');
    prevOptionsHash = oldOptionsHash;
  }
  
  return { flags, prevItemPrice, prevOptionsHash, newOptionsHash };
}

/**
 * Parse JSON body from request
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

/**
 * Handle CORS preflight
 */
function handleCors(req, res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  });
  res.end();
}

/**
 * Handle POST /api/coupang/upsert
 */
async function handleUpsert(req, res) {
  try {
    // Validate config
    if (!SHEET_ID) {
      return sendJson(res, 500, {
        ok: false,
        error: 'GOOGLE_SHEET_ID not configured in backend/.env',
      });
    }
    
    // Parse request body
    const data = await parseBody(req);
    
    // Validate required fields
    if (!data.vendorItemId && !data.itemId) {
      return sendJson(res, 400, {
        ok: false,
        error: 'Missing required field: vendorItemId or itemId',
      });
    }
    
    console.log(`[${new Date().toISOString()}] Received data for product: ${data.coupang_product_id || 'unknown'}`);
    
    // ===== CRITICAL: Log breadcrumb data for debugging =====
    console.log(`[${new Date().toISOString()}] BREADCRUMB SEGMENTS:`, data.breadcrumbSegments || '(NOT PROVIDED)');
    console.log(`[${new Date().toISOString()}] categoryId:`, data.categoryId || '(NOT PROVIDED)');
    
    // ===== Tracer Logging =====
    trace('categoryId source: URL query string');
    trace('categoryId value:', data.categoryId || '(empty)');
    
    if (data.ItemPrice !== undefined) {
      trace('ItemPrice raw:', data.ItemPrice);
      trace('ItemPrice parsed:', typeof data.ItemPrice === 'number' ? data.ItemPrice : parseInt(data.ItemPrice, 10) || '');
    }
    
    trace('WeightKg: fixed default = 1 (no scraping per requirements)');
    
    if (data.Options) {
      trace('Options:', JSON.stringify(data.Options));
    }
    
    // ===== Compute category paths from breadcrumbSegments =====
    const { categoryPath2, categoryPath3 } = computeCategoryPaths(data.breadcrumbSegments);
    console.log(`[${new Date().toISOString()}] categoryPath2: "${categoryPath2}", categoryPath3: "${categoryPath3}"`);
    
    // ===== Compute options hash =====
    const newOptionsHash = computeOptionsHash(data.Options);
    
    // ===== Prepare base row data (scraped fields only) =====
    const rowData = {
      vendorItemId: data.vendorItemId || '',
      itemId: data.itemId || '',
      coupang_product_id: data.coupang_product_id || '',
      categoryId: data.categoryId || '',                    // From URL only
      ProductURL: data.ProductURL || '',                    // Full URL
      ItemTitle: data.ItemTitle || '',
      ItemPrice: data.ItemPrice || '',                      // Number (legacy)
      StandardImage: data.StandardImage || '',
      ExtraImages: Array.isArray(data.ExtraImages) ? JSON.stringify(data.ExtraImages) : '[]',
      WeightKg: '1',                                        // FIXED to 1
      Options: data.Options ? JSON.stringify(data.Options) : '',  // JSON
      ItemDescriptionText: data.ItemDescriptionText || '',  // Plain text
      updatedAt: new Date().toISOString(),
      categoryPath2,                                        // Last 2 breadcrumb segments
      categoryPath3,                                        // Last 3 breadcrumb segments
      optionsHash: newOptionsHash,                          // Options hash for change detection
    };
    
    // Ensure headers exist (may extend if new columns added)
    const actualHeaders = await ensureHeaders(SHEET_ID, TAB_NAME, SHEET_HEADERS);
    
    // Upsert row with preserve columns for JP/Qoo10 data
    const result = await upsertRow(
      SHEET_ID,
      TAB_NAME,
      actualHeaders,
      rowData,
      'vendorItemId',
      'itemId',
      PRESERVE_COLUMNS  // Preserve JP/Qoo10 registration data on re-scrape
    );
    
    const keyUsed = data.vendorItemId ? `vendorItemId:${data.vendorItemId}` : `itemId:${data.itemId}`;
    const isUpdate = result.action === 'updated';
    
    // ===== Change Detection (only for existing rows) =====
    let changeFlags = [];
    let prevItemPrice = '';
    let prevOptionsHash = '';
    
    if (isUpdate && result.existingData) {
      const changes = detectChanges(result.existingData, {
        ItemPrice: data.ItemPrice,
        Options: data.Options
      });
      
      changeFlags = changes.flags;
      prevItemPrice = changes.prevItemPrice;
      prevOptionsHash = changes.prevOptionsHash;
      
      // Log changes
      if (changeFlags.length > 0) {
        console.log(`[Upsert] vendorItemId=${data.vendorItemId || data.itemId} flags=${changeFlags.join('|')}`);
      } else {
        console.log(`[Upsert] vendorItemId=${data.vendorItemId || data.itemId} no changes`);
      }
      
      // Update change tracking fields in the sheet
      const changeTrackingData = {
        changeFlags: changeFlags.join('|'),
        needsUpdate: changeFlags.length > 0 ? 'YES' : 'NO',
        lastRescrapedAt: new Date().toISOString(),
      };
      
      // Only set prev values if there was a change
      if (prevItemPrice) {
        changeTrackingData.prevItemPrice = prevItemPrice;
      }
      if (prevOptionsHash) {
        changeTrackingData.prevOptionsHash = prevOptionsHash;
      }
      
      // Merge change tracking into row data and re-upsert
      Object.assign(rowData, changeTrackingData);
      
      // Re-upsert with change tracking data
      await upsertRow(
        SHEET_ID,
        TAB_NAME,
        actualHeaders,
        rowData,
        'vendorItemId',
        'itemId',
        PRESERVE_COLUMNS
      );
    } else {
      // New row - set initial change tracking values
      rowData.changeFlags = '';
      rowData.needsUpdate = 'NO';
      rowData.prevItemPrice = '';
      rowData.prevOptionsHash = '';
      // lastRescrapedAt stays empty for new inserts
      
      console.log(`[${new Date().toISOString()}] Inserted new row ${result.row} (${keyUsed})`);
    }
    
    if (isUpdate) {
      console.log(`[${new Date().toISOString()}] Updated row ${result.row} (${keyUsed})`);
    };
    
    // ===== Category Dictionary Accumulation =====
    let categoryResult = null;
    const hasCategoryId = data.categoryId && data.categoryId.trim() !== '';
    const hasBreadcrumbs = Array.isArray(data.breadcrumbSegments) && data.breadcrumbSegments.length > 0;
    
    if (hasCategoryId && hasBreadcrumbs) {
      try {
        const categoryInfo = parseBreadcrumbSegments(data.breadcrumbSegments);
        
        if (categoryInfo) {
          categoryResult = await upsertCategory(SHEET_ID, data.categoryId, categoryInfo);
          
          if (categoryResult.action === 'CREATED') {
            console.log(`[${new Date().toISOString()}] ✅ Category CREATED: ${data.categoryId} → ${categoryInfo.depth3Path}`);
          } else {
            console.log(`[${new Date().toISOString()}] ✅ Category UPDATED: ${data.categoryId} (usedCount: ${categoryResult.usedCount})`);
          }
        } else {
          console.warn(`[${new Date().toISOString()}] ⚠️ Category parse failed for product ${data.coupang_product_id}: parseBreadcrumbSegments returned null`);
        }
      } catch (catErr) {
        // Category error should NOT block product upsert
        console.error(`[${new Date().toISOString()}] ⚠️ Category upsert error (product still saved):`, catErr.message);
      }
    } else {
      // Log warning with specific reason
      const reasons = [];
      if (!hasCategoryId) reasons.push('categoryId missing or empty');
      if (!hasBreadcrumbs) reasons.push('breadcrumbSegments missing or empty');
      
      console.warn(`[${new Date().toISOString()}] ⚠️ Category accumulation SKIPPED for product ${data.coupang_product_id || 'unknown'}: ${reasons.join(', ')}`);
    }
    
    return sendJson(res, 200, {
      ok: true,
      mode: result.action === 'updated' ? 'update' : 'insert',
      rowIndex: result.row,
      key: keyUsed,
      category: categoryResult,
      categorySkipped: !categoryResult ? true : undefined
    });
    
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error:`, err.message);
    return sendJson(res, 500, {
      ok: false,
      error: err.message,
    });
  }
}

/**
 * Request handler
 */
async function handleRequest(req, res) {
  const { method, url } = req;
  
  console.log(`[${new Date().toISOString()}] ${method} ${url}`);
  
  // CORS preflight
  if (method === 'OPTIONS') {
    return handleCors(req, res);
  }
  
  // Health check
  if (method === 'GET' && url === '/health') {
    return sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
  }
  
  // Main endpoint
  if (method === 'POST' && url === '/api/coupang/upsert') {
    return handleUpsert(req, res);
  }
  
  // 404
  return sendJson(res, 404, { ok: false, error: 'Not found' });
}

/**
 * Start server
 */
function startServer() {
  const server = http.createServer(handleRequest);
  
  server.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log('='.repeat(60));
    console.log('  Coupang Data Receiver');
    console.log('='.repeat(60));
    console.log(`  Server:    http://127.0.0.1:${PORT}`);
    console.log(`  Endpoint:  POST /api/coupang/upsert`);
    console.log(`  Health:    GET /health`);
    console.log('');
    console.log(`  Sheet ID:  ${SHEET_ID || '⚠️  NOT SET! Add GOOGLE_SHEET_ID to backend/.env'}`);
    console.log(`  Tab:       ${TAB_NAME}`);
    console.log(`  Tracer:    ${TRACER ? 'ON' : 'OFF'}`);
    console.log('');
    console.log('  📦 Features:');
    console.log('    - Product data → coupang_datas');
    console.log('    - Category accumulation → coupang_categorys');
    console.log('');
    console.log('  🔍 Category Accumulation:');
    console.log('    Requires both categoryId AND breadcrumbSegments from extension');
    console.log('');
    console.log('  Press Ctrl+C to stop');
    console.log('='.repeat(60));
    console.log('');
  });
  
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Error: Port ${PORT} is already in use.`);
      console.error(`Try: COUPANG_RECEIVER_PORT=8788 npm run coupang:receiver:start`);
    } else {
      console.error('Server error:', err.message);
    }
    process.exit(1);
  });
}

// Run
startServer();
