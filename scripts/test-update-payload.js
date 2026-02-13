#!/usr/bin/env node
/**
 * Test script for updateGoods - comparing payload structure to SetNewGoods
 */

const { buildUpdateGoodsParams } = require('../backend/qoo10/updateGoods');

console.log('='.repeat(60));
console.log('  Testing UpdateGoods Payload Structure');
console.log('  (Should be identical to SetNewGoods except ItemCode)');
console.log('='.repeat(60));
console.log('');

// Simulated input (like what qoo10-auto-register.js passes)
const input = {
  ItemCode: 'QOO10_ITEM_123456',
  SecondSubCat: '320002604',
  ItemTitle: 'Test Product Title',
  ItemPrice: '6000',
  StandardImage: 'https://example.com/img.jpg',
  ItemDescription: '<p>Product description</p>',
  Weight: '1',
};

// Simulated current row data from sheet
const currentRowData = {
  vendorItemId: 'vendor123',
  ItemTitle: 'Test Product Title',
  ItemPrice: '5900',
  qoo10SellingPrice: '6000',
  jpCategoryIdUsed: '320002604',
  StandardImage: 'https://example.com/img.jpg',
  ItemDescriptionText: '<p>Product description</p>',
  WeightKg: '1',
  ExtraImages: '[]',
};

const shippingNo = '471554';

console.log('Building UpdateGoods params...\n');
const params = buildUpdateGoodsParams(input, currentRowData, shippingNo);

console.log('FINAL PAYLOAD:');
console.log(JSON.stringify(params, null, 2));

console.log('\n' + '='.repeat(60));
console.log('KEY COMPARISON WITH SetNewGoods:');
console.log('='.repeat(60));

const expectedKeys = [
  'returnType',
  'ItemCode',       // <-- Instead of SellerCode
  'SecondSubCat',
  'ItemTitle',
  'ItemPrice',
  'RetailPrice',
  'ItemQty',
  'AvailableDateType',
  'AvailableDateValue',
  'ShippingNo',
  'AdultYN',
  'TaxRate',
  'ExpireDate',
  'StandardImage',
  'ItemDescription',
  'Weight',
  'PromotionName',
  'ProductionPlaceType',
  'ProductionPlace',
  'IndustrialCodeType',
  'IndustrialCode',
];

const actualKeys = Object.keys(params);

console.log('\nExpected keys:', expectedKeys.length);
console.log('Actual keys:', actualKeys.length);

// Check for missing keys
const missingKeys = expectedKeys.filter(k => !actualKeys.includes(k));
const extraKeys = actualKeys.filter(k => !expectedKeys.includes(k));

if (missingKeys.length > 0) {
  console.log('\n❌ MISSING KEYS:', missingKeys);
} else {
  console.log('\n✓ All expected keys present');
}

if (extraKeys.length > 0) {
  console.log('⚠️ EXTRA KEYS:', extraKeys);
}

// Verify critical fields
console.log('\n' + '='.repeat(60));
console.log('CRITICAL FIELD VALUES:');
console.log('='.repeat(60));
console.log(`  ItemCode: ${params.ItemCode} (should be the Qoo10 item ID)`);
console.log(`  ShippingNo: ${params.ShippingNo} (should be 471554)`);
console.log(`  TaxRate: ${params.TaxRate} (should be S)`);
console.log(`  ExpireDate: ${params.ExpireDate} (should be 2030-12-31)`);
console.log(`  RetailPrice: ${params.RetailPrice} (should be 0)`);
console.log(`  ItemQty: ${params.ItemQty} (should be 100)`);
console.log(`  Weight: ${params.Weight} (should be 1)`);
console.log(`  ProductionPlaceType: ${params.ProductionPlaceType} (should be 2)`);
console.log(`  ProductionPlace: ${params.ProductionPlace} (should be Overseas)`);
console.log(`  AvailableDateType: ${params.AvailableDateType} (should be 0)`);
console.log(`  AvailableDateValue: ${params.AvailableDateValue} (should be 2)`);
console.log(`  AdultYN: ${params.AdultYN} (should be N)`);

// Generate URL-encoded body preview
console.log('\n' + '='.repeat(60));
console.log('URL-ENCODED BODY PREVIEW:');
console.log('='.repeat(60));
const urlEncodedBody = Object.entries(params)
  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  .join('&');
console.log(urlEncodedBody.substring(0, 1500));
console.log(`\n... (total ${urlEncodedBody.length} chars)`);

console.log('\n✓ Test complete');
