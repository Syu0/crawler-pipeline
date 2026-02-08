#!/usr/bin/env node
/**
 * Qoo10 SetNewGoods parameter binary search harness
 * Tests success-capable baseline params first, then adds optional params incrementally
 * Records ResultCode/Msg for each attempt
 * 
 * Usage: node scripts/qoo10-debug-setnewgoods.js
 * Requires: QOO10_SAK env var
 */

const { qoo10PostMethod, testQoo10Connection } = require('./lib/qoo10Client');

if (!process.env.QOO10_SAK) {
  console.error('QOO10_SAK not set');
  process.exit(1);
}

// Base required params (success-capable per Qoo10 docs/examples)
// ShippingNo will be injected after lookup
const BASE_REQUIRED_PARAMS = {
  returnType: 'application/json',
  SecondSubCat: '320002863',
  ItemTitle: 'Qoo10 Debug Test Item',
  ItemPrice: '4000',
  RetailPrice: '0',
  ItemQty: '99',
  AvailableDateType: '0',
  AvailableDateValue: '2',
  ShippingNo: '', // Will be populated from GetSellerDeliveryGroupInfo
  SellerCode: 'DBGTEST01',
  AdultYN: 'N',
  TaxRate: 'S',
  ExpireDate: '2030-12-31',
  StandardImage: 'https://dp.image-qoo10.jp/GMKT.IMG/loading_2017/qoo10_loading.v_20170420.png',
  ItemDescription: '<p>Test item for debugging SetNewGoods</p>'
};

// Optional/suspicious params to test incrementally
const ADDITIVE_PARAMS = [
  { Weight: '500' },
  { ShippingCharge: '0' },
  { BrandNo: '' },
  { ManuCode: '' },
  { ModelNo: '' }
];

/**
 * Get valid ShippingNo from GetSellerDeliveryGroupInfo
 */
async function getValidShippingNo() {
  try {
    const response = await testQoo10Connection();
    
    if (response.ResultCode !== 0) {
      throw new Error(`GetSellerDeliveryGroupInfo failed: ${response.ResultMsg}`);
    }
    
    const deliveryGroups = response.ResultObject || [];
    
    if (deliveryGroups.length === 0) {
      throw new Error('No delivery groups found - please set up shipping template in Qoo10 seller portal');
    }
    
    // Find first domestic (non-overseas) shipping group
    const domesticGroup = deliveryGroups.find(g => g.Oversea === 'N');
    const selectedGroup = domesticGroup || deliveryGroups[0];
    
    return String(selectedGroup.ShippingNo);
  } catch (err) {
    throw new Error(`Failed to get ShippingNo: ${err.message}`);
  }
}

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
  
  // Step 1: Get valid ShippingNo
  console.log('Step 1: Fetching valid ShippingNo from seller delivery groups...');
  let shippingNo;
  try {
    shippingNo = await getValidShippingNo();
    console.log(`✓ Using ShippingNo: ${shippingNo}\n`);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
  
  // Inject ShippingNo into base params
  BASE_REQUIRED_PARAMS.ShippingNo = shippingNo;
  
  console.log('Step 2: Testing success-capable baseline params...\n');
  
  const results = [];
  let currentParams = { ...BASE_REQUIRED_PARAMS };
  
  // Test 1: Base required params (success-capable)
  console.log('[Test 1] Base required params (per Qoo10 docs)');
  console.log('Params:', Object.keys(currentParams).join(', '));
  let response = await callSetNewGoods(currentParams);
  results.push({
    test: 'Base Required',
    params: Object.keys(currentParams),
    resultCode: response.ResultCode,
    resultMsg: response.ResultMsg
  });
  console.log(`→ ResultCode: ${response.ResultCode}, Msg: ${response.ResultMsg}\n`);
  
  // If base succeeds, stop here
  if (response.ResultCode === 0) {
    console.log('✓✓✓ BASE SUCCESS! ✓✓✓');
    console.log('The success-capable baseline works correctly.\n');
    
    // Print summary
    console.log('=== Summary ===\n');
    console.log(`ShippingNo used: ${shippingNo}`);
    console.log(`Base params: ${Object.keys(currentParams).length} fields`);
    console.log('Result: SUCCESS (ResultCode 0)\n');
    console.log('=== Debug Complete ===\n');
    return;
  }
  
  // If base fails, try additive params
  console.log('Base params failed. Testing with additional params...\n');
  
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
  console.log(`ShippingNo used: ${shippingNo}`);
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
