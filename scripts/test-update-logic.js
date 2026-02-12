#!/usr/bin/env node
/**
 * Test script for updateGoods change detection logic
 * Validates that the refactored logic correctly compares sheet data
 */

const { detectChangedFields } = require('../backend/qoo10/updateGoods');

console.log('='.repeat(60));
console.log('  Testing updateGoods Change Detection Logic');
console.log('='.repeat(60));
console.log('');

// Test Case 1: Price changed
console.log('TEST 1: Price change detection');
console.log('-'.repeat(40));
const prevState1 = {
  ItemTitle: 'Test Product',
  qoo10SellingPrice: '5000',
  jpCategoryIdUsed: '320002604',
  StandardImage: 'https://example.com/img.jpg',
  ItemDescriptionText: 'Description',
  WeightKg: '1',
};

const currState1 = {
  ItemTitle: 'Test Product',
  qoo10SellingPrice: '6000',  // Changed!
  jpCategoryIdUsed: '320002604',
  StandardImage: 'https://example.com/img.jpg',
  ItemDescriptionText: 'Description',
  WeightKg: '1',
};

const result1 = detectChangedFields(prevState1, currState1);
console.log('Changed fields:', result1);
console.log('Expected: { ItemPrice: "6000" }');
console.log('PASS:', JSON.stringify(result1) === JSON.stringify({ ItemPrice: '6000' }) ? '✓' : '✗');
console.log('');

// Test Case 2: No changes
console.log('TEST 2: No changes detection');
console.log('-'.repeat(40));
const prevState2 = {
  ItemTitle: 'Test Product',
  qoo10SellingPrice: '5000',
  jpCategoryIdUsed: '320002604',
  StandardImage: 'https://example.com/img.jpg',
  ItemDescriptionText: 'Description',
  WeightKg: '1',
};

const currState2 = { ...prevState2 };  // Same data

const result2 = detectChangedFields(prevState2, currState2);
console.log('Changed fields:', result2);
console.log('Expected: {} (empty)');
console.log('PASS:', Object.keys(result2).length === 0 ? '✓' : '✗');
console.log('');

// Test Case 3: Multiple changes
console.log('TEST 3: Multiple changes detection');
console.log('-'.repeat(40));
const prevState3 = {
  ItemTitle: 'Test Product',
  qoo10SellingPrice: '5000',
  jpCategoryIdUsed: '320002604',
  StandardImage: 'https://example.com/old.jpg',
  ItemDescriptionText: 'Old description',
  WeightKg: '1',
};

const currState3 = {
  ItemTitle: 'Updated Product Name',  // Changed!
  qoo10SellingPrice: '7000',  // Changed!
  jpCategoryIdUsed: '320002604',
  StandardImage: 'https://example.com/new.jpg',  // Changed!
  ItemDescriptionText: 'Old description',
  WeightKg: '1',
};

const result3 = detectChangedFields(prevState3, currState3);
console.log('Changed fields:', result3);
console.log('Expected: ItemTitle, ItemPrice, StandardImage');
const expectedKeys3 = ['ItemTitle', 'ItemPrice', 'StandardImage'].sort();
const actualKeys3 = Object.keys(result3).sort();
console.log('PASS:', JSON.stringify(expectedKeys3) === JSON.stringify(actualKeys3) ? '✓' : '✗');
console.log('');

// Test Case 4: Category change
console.log('TEST 4: Category change detection');
console.log('-'.repeat(40));
const prevState4 = {
  ItemTitle: 'Test Product',
  qoo10SellingPrice: '5000',
  jpCategoryIdUsed: '320002604',
  StandardImage: 'https://example.com/img.jpg',
  ItemDescriptionText: 'Description',
  WeightKg: '1',
};

const currState4 = {
  ItemTitle: 'Test Product',
  qoo10SellingPrice: '5000',
  jpCategoryIdUsed: '999999999',  // Changed!
  StandardImage: 'https://example.com/img.jpg',
  ItemDescriptionText: 'Description',
  WeightKg: '1',
};

const result4 = detectChangedFields(prevState4, currState4);
console.log('Changed fields:', result4);
console.log('Expected: { SecondSubCat: "999999999" }');
console.log('PASS:', result4.SecondSubCat === '999999999' ? '✓' : '✗');
console.log('');

console.log('='.repeat(60));
console.log('  All tests completed');
console.log('='.repeat(60));
