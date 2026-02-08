#!/usr/bin/env node
/**
 * Qoo10 Product Registration CLI
 * Reads product data from JSON file and registers on Qoo10
 * 
 * Usage:
 *   node scripts/qoo10-register-cli.js <json-file-path>
 *   node scripts/qoo10-register-cli.js backend/qoo10/sample-newgoods.json
 */

const fs = require('fs');
const path = require('path');
const { registerNewGoods } = require('../backend/qoo10/registerNewGoods');

// Parse command line args
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: node scripts/qoo10-register-cli.js <json-file-path>');
  console.error('Example: node scripts/qoo10-register-cli.js backend/qoo10/sample-newgoods.json');
  process.exit(1);
}

const jsonFilePath = path.resolve(process.cwd(), args[0]);

// Check if file exists
if (!fs.existsSync(jsonFilePath)) {
  console.error(`Error: File not found: ${jsonFilePath}`);
  process.exit(1);
}

// Read and parse JSON
let productData;
try {
  const fileContent = fs.readFileSync(jsonFilePath, 'utf8');
  productData = JSON.parse(fileContent);
} catch (err) {
  console.error(`Error reading JSON file: ${err.message}`);
  process.exit(1);
}

console.log('\n=== Qoo10 Product Registration CLI ===\n');
console.log(`Loading product data from: ${jsonFilePath}\n`);

// Register product
async function run() {
  try {
    console.log('Registering product on Qoo10...\n');
    
    const result = await registerNewGoods(productData);
    
    console.log('=== Registration Result ===\n');
    console.log(`Success: ${result.success}`);
    console.log(`ResultCode: ${result.resultCode}`);
    console.log(`ResultMsg: ${result.resultMsg}`);
    console.log(`CreatedItemId (GdNo): ${result.createdItemId || 'null'}`);
    console.log(`AIContentsNo: ${result.aiContentsNo || 'null'}`);
    console.log(`SellerCode used: ${result.sellerCodeUsed}`);
    console.log(`ShippingNo used: ${result.shippingNoUsed}`);
    console.log(`Options applied: ${result.optionsApplied ? 'YES' : 'NO'}`);
    
    if (result.optionSummary) {
      console.log(`Option summary: ${result.optionSummary}`);
    }
    
    // Show raw ResultObject when tracer enabled
    if (process.env.QOO10_TRACER === '1' || process.env.QOO10_TRACER === 'true') {
      console.log('\n--- Raw ResultObject (debug) ---');
      console.log(JSON.stringify(result.rawResultObject, null, 2));
      console.log('--------------------------------');
    }
    
    if (result.success) {
      console.log('\n✓ Product registered successfully!\n');
    } else {
      console.log('\n✗ Registration failed\n');
      process.exit(1);
    }
  } catch (err) {
    console.error(`\n✗ Error: ${err.message}\n`);
    process.exit(1);
  }
}

run();
