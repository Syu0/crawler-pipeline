#!/usr/bin/env node
/**
 * Qoo10 SetNewGoods parameter binary search harness
 * Tests minimal params first, then adds optional/suspicious params incrementally
 * Records ResultCode/Msg for each attempt
 * 
 * Usage: node scripts/qoo10-debug-setnewgoods.js
 * Requires: QOO10_SAK env var
 */

const { qoo10PostMethod } = require('./lib/qoo10Client');

if (!process.env.QOO10_SAK) {
  console.error('QOO10_SAK not set');
  process.exit(1);
}

// Minimal baseline params (absolutely required per docs)
const MINIMAL_PARAMS = {
  returnType: 'application/json',
  SecondSubCat: '320002863',
  ItemTitle: 'test item minimal',
  ItemPrice: '4000',
  ItemQty: '99',
  AvailableDateType: '0',
  AvailableDateValue: '2',
  ShippingNo: '0',
  SellerCode: 'DBG001',
  AdultYN: 'N'
};

// Suspicious/optional params to test incrementally
const ADDITIVE_PARAMS = [
  { StandardImage: 'https://dp.image-qoo10.jp/GMKT.IMG/loading_2017/qoo10_loading.v_20170420.png' },
  { ItemDescription: '<img src="https://dp.image-qoo10.jp/GMKT.IMG/loading_2017/qoo10_loading.v_20170420.png">' },
  { TaxRate: '10' },
  { ExpireDate: '2030-12-31' },
  { ItemWeight: '500' },
  { ShippingCharge: '0' },
  { BrandNo: '' },
  { ManuCode: '' },
  { ModelNo: '' }
];

/**
 * Make Qoo10 SetNewGoods API call
 */
async function callSetNewGoods(params) {
  return qoo10PostMethod('ItemsBasic.SetNewGoods', params, '1.1');
}

/**
 * Run additive param tests
 */
async function runTests() {
  console.log('\n=== Qoo10 SetNewGoods Parameter Debug ===\n');
  console.log('Testing incrementally from minimal params...\n');
  
  const results = [];
  let currentParams = { ...MINIMAL_PARAMS };
  
  // Test 1: Minimal params only
  console.log('[Test 1] Minimal params only');
  console.log('Params:', Object.keys(currentParams).join(', '));
  let response = await callSetNewGoods(currentParams);
  results.push({
    test: 'Minimal',
    params: Object.keys(currentParams),
    resultCode: response.ResultCode,
    resultMsg: response.ResultMsg
  });
  console.log(`→ ResultCode: ${response.ResultCode}, Msg: ${response.ResultMsg}\n`);
  
  // Test 2-N: Add one param at a time
  for (let i = 0; i < ADDITIVE_PARAMS.length; i++) {
    const additionalParam = ADDITIVE_PARAMS[i];
    currentParams = { ...currentParams, ...additionalParam };
    
    const testNum = i + 2;
    const paramKey = Object.keys(additionalParam)[0];
    console.log(`[Test ${testNum}] Adding: ${paramKey}`);
    console.log('Params:', Object.keys(currentParams).join(', '));
    
    response = await callSetNewGoods(currentParams);
    results.push({
      test: `+${paramKey}`,
      params: Object.keys(currentParams),
      resultCode: response.ResultCode,
      resultMsg: response.ResultMsg
    });
    console.log(`→ ResultCode: ${response.ResultCode}, Msg: ${response.ResultMsg}\n`);
    
    // Stop if we get success
    if (response.ResultCode === 0) {
      console.log('✓ SUCCESS! Found working param combination.');
      break;
    }
  }
  
  // Print summary table
  console.log('\n=== Summary Table ===\n');
  console.log('Test'.padEnd(20), '| Code | Message');
  console.log('-'.repeat(70));
  results.forEach(r => {
    console.log(
      r.test.padEnd(20),
      '|',
      String(r.resultCode).padEnd(4),
      '|',
      r.resultMsg
    );
  });
  
  console.log('\n=== Debug Complete ===\n');
}

runTests().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
