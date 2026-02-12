#!/usr/bin/env node
/**
 * Test script for updateExistingGoods full flow
 * Tests the complete update payload generation including required fields resolution
 */

const { updateExistingGoods } = require('../backend/qoo10/updateGoods');

async function runTests() {
  console.log('='.repeat(60));
  console.log('  Testing updateExistingGoods Full Flow (Dry-Run)');
  console.log('='.repeat(60));
  console.log('');

  // Test Case 1: Price change with all required fields available
  console.log('TEST 1: Price change with required fields in row');
  console.log('-'.repeat(40));
  
  const input1 = {
    ItemCode: 'TEST123456',
    ItemTitle: 'Test Product',
    ItemPrice: '6000',
    SecondSubCat: '320002604',
    StandardImage: 'https://example.com/img.jpg',
    ItemDescription: 'Description',
    Weight: '1',
  };
  
  // Simulated current row data from sheet (source of truth)
  const currentRowData1 = {
    vendorItemId: 'vendor123',
    ItemTitle: 'Test Product',
    ItemPrice: '5900',  // Original Coupang price
    qoo10SellingPrice: '6000',  // Current selling price (higher due to markup)
    prevItemPrice: '5000',  // Previous price before change detection
    jpCategoryIdUsed: '320002604',
    StandardImage: 'https://example.com/img.jpg',
    ItemDescriptionText: 'Description',
    WeightKg: '1',
    needsUpdate: 'YES',
    changeFlags: 'PRICE_UP',
    // Required fields
    ProductionPlaceType: '2',
    AdultYN: 'N',
    AvailableDateType: '0',
    AvailableDateValue: '3',
  };
  
  const result1 = await updateExistingGoods(input1, currentRowData1);
  console.log('');
  console.log('Result:', JSON.stringify(result1, null, 2));
  console.log('PASS (dry-run expected):', result1.dryRun === true ? '✓' : '✗');
  console.log('');

  // Test Case 2: No changes scenario
  console.log('TEST 2: No changes - should skip update');
  console.log('-'.repeat(40));
  
  const input2 = {
    ItemCode: 'TEST789',
    ItemTitle: 'Same Product',
    ItemPrice: '5000',
    SecondSubCat: '320002604',
    StandardImage: 'https://example.com/img.jpg',
    ItemDescription: 'Description',
    Weight: '1',
  };
  
  const currentRowData2 = {
    vendorItemId: 'vendor456',
    ItemTitle: 'Same Product',
    qoo10SellingPrice: '5000',  // Same as input
    prevItemPrice: '5000',  // Same as current - no change
    jpCategoryIdUsed: '320002604',
    StandardImage: 'https://example.com/img.jpg',
    ItemDescriptionText: 'Description',
    WeightKg: '1',
    needsUpdate: 'NO',
    ProductionPlaceType: '2',
    AdultYN: 'N',
    AvailableDateType: '0',
    AvailableDateValue: '3',
  };
  
  const result2 = await updateExistingGoods(input2, currentRowData2);
  console.log('');
  console.log('Result:', JSON.stringify(result2, null, 2));
  console.log('PASS (skipped expected):', result2.skipped === true ? '✓' : '✗');
  console.log('');

  // Test Case 3: Missing ItemCode - should fail
  console.log('TEST 3: Missing ItemCode - should fail');
  console.log('-'.repeat(40));
  
  const input3 = {
    ItemTitle: 'Product Without ItemCode',
  };
  
  const result3 = await updateExistingGoods(input3, {});
  console.log('Result:', JSON.stringify(result3, null, 2));
  console.log('PASS (error expected):', result3.success === false ? '✓' : '✗');
  console.log('');

  console.log('='.repeat(60));
  console.log('  All tests completed');
  console.log('='.repeat(60));
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
