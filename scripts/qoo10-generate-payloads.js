#!/usr/bin/env node
/**
 * Qoo10 Payload Generator CLI
 * 
 * Reads Coupang product data from Google Sheets and generates
 * Qoo10 SetNewGoods-ready payloads.
 * 
 * Does NOT call Qoo10 API or modify Google Sheets.
 * 
 * Usage:
 *   node scripts/qoo10-generate-payloads.js [--output <file>] [--limit <n>]
 * 
 * Options:
 *   --output <file>  Write payloads to JSON file (default: stdout)
 *   --limit <n>      Process only first N rows
 *   --dry-run        Only validate, don't generate full payloads
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') });

const fs = require('fs');
const { getSheetsClient } = require('./lib/sheetsClient');
const { generatePayloadsFromRows, calculateSellingPrice } = require('./lib/qoo10PayloadGenerator');

// Configuration
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB_NAME = process.env.GOOGLE_SHEET_TAB_NAME || 'coupang_datas';

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    output: null,
    limit: null,
    dryRun: false
  };
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (args[i] === '--limit' && args[i + 1]) {
      options.limit = parseInt(args[++i], 10);
    } else if (args[i] === '--dry-run') {
      options.dryRun = true;
    }
  }
  
  return options;
}

/**
 * Read all rows from Google Sheets
 */
async function readSheetRows() {
  const sheets = await getSheetsClient();
  
  // Get all data including headers
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A:Z`,
  });
  
  const rows = response.data.values || [];
  
  if (rows.length < 2) {
    return []; // No data rows
  }
  
  const headers = rows[0];
  const dataRows = rows.slice(1);
  
  // Convert to objects
  return dataRows.map(row => {
    const obj = {};
    headers.forEach((header, idx) => {
      obj[header] = row[idx] || '';
    });
    
    // Parse numeric fields
    if (obj.ItemPrice) {
      const parsed = parseInt(obj.ItemPrice, 10);
      if (!isNaN(parsed)) {
        obj.ItemPrice = parsed;
      }
    }
    
    return obj;
  });
}

/**
 * Main function
 */
async function main() {
  const options = parseArgs();
  
  console.log('='.repeat(50));
  console.log('  Qoo10 Payload Generator');
  console.log('='.repeat(50));
  console.log(`  Sheet ID: ${SHEET_ID || '(not set!)'}`);
  console.log(`  Tab: ${TAB_NAME}`);
  console.log(`  Mode: ${options.dryRun ? 'DRY-RUN (validation only)' : 'GENERATE'}`);
  console.log('='.repeat(50));
  console.log('');
  
  if (!SHEET_ID) {
    console.error('Error: GOOGLE_SHEET_ID not configured in backend/.env');
    process.exit(1);
  }
  
  try {
    // Read rows from sheet
    console.log('Reading data from Google Sheets...');
    let rows = await readSheetRows();
    
    console.log(`Found ${rows.length} data rows`);
    
    // Apply limit if specified
    if (options.limit && options.limit > 0) {
      rows = rows.slice(0, options.limit);
      console.log(`Limited to first ${options.limit} rows`);
    }
    
    if (rows.length === 0) {
      console.log('No data to process');
      return;
    }
    
    // Generate payloads
    console.log('\nGenerating Qoo10 payloads...\n');
    
    const result = generatePayloadsFromRows(rows);
    
    // Print summary
    console.log('=== Summary ===');
    console.log(`Total rows:     ${result.summary.total}`);
    console.log(`Generated:      ${result.summary.generated}`);
    console.log(`Skipped:        ${result.summary.skipped}`);
    
    // Log skipped rows
    if (result.skipped.length > 0) {
      console.log('\n=== Skipped Rows ===');
      result.skipped.forEach(skip => {
        console.log(`  - ${skip.vendorItemId}: ${skip.reason}`);
      });
    }
    
    // Output payloads
    if (!options.dryRun && result.payloads.length > 0) {
      console.log('\n=== Generated Payloads ===\n');
      
      if (options.output) {
        // Write to file
        fs.writeFileSync(options.output, JSON.stringify(result.payloads, null, 2));
        console.log(`Payloads written to: ${options.output}`);
      } else {
        // Print each payload
        result.payloads.forEach((payload, idx) => {
          console.log(`--- Payload ${idx + 1} ---`);
          console.log(`SellerCode: ${payload.SellerCode}`);
          console.log(`ItemTitle: ${payload.ItemTitle.substring(0, 50)}...`);
          console.log(`SecondSubCat: ${payload.SecondSubCat}`);
          console.log(`ItemPrice: ${payload._meta.originalPrice} → ${payload.ItemPrice} (${payload._meta.priceMarkup})`);
          console.log(`Options: ${payload.Options.optionType} ${payload.Options.optionValues ? `(${payload.Options.optionValues.length} values)` : ''}`);
          console.log(`ImageUrl: ${payload.ImageUrl ? 'OK' : '(none)'}`);
          console.log('');
        });
      }
    }
    
    // Show price calculation examples
    if (result.payloads.length > 0) {
      console.log('\n=== Price Calculation Examples ===');
      result.payloads.slice(0, 3).forEach(p => {
        console.log(`  ${p._meta.originalPrice} KRW → ${p.ItemPrice} KRW (CEILING(${p._meta.originalPrice} * 1.12 * 1.03, 10))`);
      });
    }
    
    console.log('\n✓ Done');
    
  } catch (err) {
    console.error('\nError:', err.message);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
