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

// Make SellerCode unique per run (append timestamp)
const originalSellerCode = productData.SellerCode || 'CLI';
productData.SellerCode = `${originalSellerCode}${Date.now().toString().slice(-8)}`;

console.log('\n=== Qoo10 Product Registration CLI ===\n');
console.log(`Loading product data from: ${jsonFilePath}`);
console.log(`Unique SellerCode: ${productData.SellerCode}\n`);

// Register product
async function run() {
  try {
    console.log('Registering product on Qoo10...\n');
    
    const result = await registerNewGoods(productData);
    
    console.log('=== Registration Result ===\n');
    console.log(`Success: ${result.success}`);
    console.log(`ResultCode: ${result.resultCode}`);
    console.log(`ResultMsg: ${result.resultMsg}`);
    
    if (result.itemNo) {
      console.log(`ItemNo: ${result.itemNo}`);
    }
    
    console.log('\nRequest metadata:');
    console.log(`  Category: ${result.request.secondSubCat}`);
    console.log(`  Title: ${result.request.itemTitle}`);
    console.log(`  SellerCode: ${result.request.sellerCode}`);
    console.log(`  ShippingNo: ${result.request.shippingNo}`);
    
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
