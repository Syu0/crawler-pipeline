#!/usr/bin/env node
/**
 * Coupang Scrape to Google Sheet
 * 
 * Scrapes a Coupang product URL and upserts the data to Google Sheets.
 * 
 * Usage:
 *   node scripts/coupang-scrape-to-sheet.js --url "<COUPANG_URL>"
 * 
 * Environment:
 *   COUPANG_SCRAPE_DRY_RUN=1  - Print payload without writing to sheet
 *   COUPANG_TRACER=1         - Enable verbose tracing
 *   COUPANG_COOKIE=          - Optional cookie for blocked requests
 */

// Load environment
require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') });

const { scrapeCoupangProduct } = require('./lib/coupangScraper');
const { ensureHeaders, upsertRow } = require('./lib/sheetsClient');

// Sheet configuration
const SHEET_HEADERS = [
  'vendorItemId',
  'itemId',
  'coupang_product_id',
  'coupang_category_id',
  'source_url',
  'ItemTitle',
  'ItemPrice',
  'StandardImage',
  'StandardImageFullUrl',
  'ExtraImagesJson',
  'ItemDescriptionHtml',
  'WeightKg',
  'SecondSubCat',
  'brand',
  'optionRaw',
  'specsJson',
  'reviewSummary',
  'collected_at_iso',
  'updated_at_iso',
];

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { url: null };
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      result.url = args[i + 1];
      i++;
    } else if (args[i].startsWith('--url=')) {
      result.url = args[i].substring(6);
    } else if (!args[i].startsWith('-')) {
      // Bare URL argument
      result.url = args[i];
    }
  }
  
  return result;
}

/**
 * Main function
 */
async function main() {
  const args = parseArgs();
  
  if (!args.url) {
    console.error('Usage: node scripts/coupang-scrape-to-sheet.js --url "<COUPANG_URL>"');
    console.error('');
    console.error('Example:');
    console.error('  node scripts/coupang-scrape-to-sheet.js --url "https://www.coupang.com/vp/products/7107426071?itemId=17757771253&vendorItemId=84922122516"');
    process.exit(1);
  }
  
  const isDryRun = process.env.COUPANG_SCRAPE_DRY_RUN === '1' || process.env.COUPANG_SCRAPE_DRY_RUN === 'true';
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const tabName = process.env.GOOGLE_SHEET_TAB_NAME || 'coupang_datas';
  
  console.log('='.repeat(50));
  console.log('Coupang Scrape to Sheet');
  console.log('='.repeat(50));
  console.log(`Mode: ${isDryRun ? 'DRY-RUN (no sheet write)' : 'REAL'}`);
  console.log(`Sheet ID: ${sheetId || '(not set)'}`);
  console.log(`Tab: ${tabName}`);
  console.log('');
  
  try {
    // Step 1: Scrape product
    const productData = await scrapeCoupangProduct(args.url);
    
    // Step 2: Handle dry-run or write to sheet
    if (isDryRun) {
      console.log('\n=== DRY-RUN: Payload (would be written to sheet) ===\n');
      console.log(JSON.stringify(productData, null, 2));
      console.log('\n=== DRY-RUN COMPLETE ===');
      console.log('Set COUPANG_SCRAPE_DRY_RUN=0 in backend/.env to write to sheet.');
      return;
    }
    
    // Validate sheet config
    if (!sheetId) {
      throw new Error('GOOGLE_SHEET_ID not set in backend/.env');
    }
    
    // Step 3: Ensure headers exist
    console.log('\n=== Writing to Google Sheet ===\n');
    await ensureHeaders(sheetId, tabName, SHEET_HEADERS);
    
    // Step 4: Upsert row
    const result = await upsertRow(
      sheetId,
      tabName,
      SHEET_HEADERS,
      productData,
      'vendorItemId',  // Primary key
      'itemId'         // Fallback key
    );
    
    console.log(`\n✓ Sheet ${result.action} successfully (row ${result.row})`);
    console.log('\n=== COMPLETE ===');
    
  } catch (err) {
    console.error(`\n✗ Error: ${err.message}`);
    if (process.env.COUPANG_TRACER === '1') {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
