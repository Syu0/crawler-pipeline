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

// Canonical sheet headers (Tier-1 + Tier-2)
const SHEET_HEADERS = [
  'vendorItemId',
  'itemId',
  'coupang_product_id',
  'categoryId',           // Tier-1: From URL only
  'ProductURL',           // Tier-2: Full URL
  'ItemTitle',
  'ItemPrice',            // Tier-1: Number, no symbols
  'StandardImage',
  'ExtraImages',
  'WeightKg',             // Tier-1: Fixed to 1
  'Options',              // Tier-2: JSON { type, values }
  'ItemDescriptionText',  // Tier-2: Plain text, no HTML
  'updatedAt',
];

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
    
    // ===== Prepare row data =====
    const rowData = {
      vendorItemId: data.vendorItemId || '',
      itemId: data.itemId || '',
      coupang_product_id: data.coupang_product_id || '',
      categoryId: data.categoryId || '',                    // From URL only
      ProductURL: data.ProductURL || '',                    // Full URL
      ItemTitle: data.ItemTitle || '',
      ItemPrice: data.ItemPrice || '',                      // Number
      StandardImage: data.StandardImage || '',
      ExtraImages: Array.isArray(data.ExtraImages) ? JSON.stringify(data.ExtraImages) : '[]',
      WeightKg: '1',                                        // FIXED to 1
      Options: data.Options ? JSON.stringify(data.Options) : '',  // JSON
      ItemDescriptionText: data.ItemDescriptionText || '',  // Plain text
      updatedAt: new Date().toISOString(),
    };
    
    // Ensure headers exist
    await ensureHeaders(SHEET_ID, TAB_NAME, SHEET_HEADERS);
    
    // Upsert row
    const result = await upsertRow(
      SHEET_ID,
      TAB_NAME,
      SHEET_HEADERS,
      rowData,
      'vendorItemId',
      'itemId'
    );
    
    const keyUsed = data.vendorItemId ? `vendorItemId:${data.vendorItemId}` : `itemId:${data.itemId}`;
    
    console.log(`[${new Date().toISOString()}] ${result.action === 'updated' ? 'Updated' : 'Inserted'} row ${result.row} (${keyUsed})`);
    
    return sendJson(res, 200, {
      ok: true,
      mode: result.action === 'updated' ? 'update' : 'insert',
      rowIndex: result.row,
      key: keyUsed,
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
    console.log('='.repeat(50));
    console.log('  Coupang Data Receiver');
    console.log('='.repeat(50));
    console.log(`  Server:    http://127.0.0.1:${PORT}`);
    console.log(`  Endpoint:  POST /api/coupang/upsert`);
    console.log(`  Health:    GET /health`);
    console.log('');
    console.log(`  Sheet ID:  ${SHEET_ID || '(not set!)'}`);
    console.log(`  Tab:       ${TAB_NAME}`);
    console.log(`  Tracer:    ${TRACER ? 'ON' : 'OFF'}`);
    console.log('');
    console.log('  Press Ctrl+C to stop');
    console.log('='.repeat(50));
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
