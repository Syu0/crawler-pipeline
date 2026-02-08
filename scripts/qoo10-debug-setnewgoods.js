#!/usr/bin/env node
/**
 * Qoo10 SetNewGoods parameter binary search harness with A/B tests
 * Tests controlled param variations (AdultYN vs AudultYN, category A/B)
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

// Generate unique SellerCode per test run (timestamp-based)
const UNIQUE_SELLER_CODE = `DBGTEST${Date.now().toString().slice(-8)}`;

// User category (from original tests)
const USER_CATEGORY = '320002863';

// Known-good category from Qiita example
const QIITA_CATEGORY = '320002604';

// Base required params (success-capable per Qoo10 docs + Qiita sample)
// ShippingNo will be injected after lookup
function buildBaseParams(secondSubCat, adultParamName = 'AdultYN') {
  const params = {
    returnType: 'application/json',
    SecondSubCat: secondSubCat,
    ItemTitle: 'Qoo10 Debug Test Item',
    ItemPrice: '4000',
    RetailPrice: '0',
    ItemQty: '99',
    AvailableDateType: '0',
    AvailableDateValue: '2',
    ShippingNo: '', // Will be populated from GetSellerDeliveryGroupInfo
    SellerCode: UNIQUE_SELLER_CODE,
    TaxRate: 'S',
    ExpireDate: '2030-12-31',
    StandardImage: 'https://dp.image-qoo10.jp/GMKT.IMG/loading_2017/qoo10_loading.v_20170420.png',
    ItemDescription: '<p>Test item for debugging SetNewGoods</p>',
    Weight: '500',
    PromotionName: 'Debug Test',
    ProductionPlaceType: '1',
    ProductionPlace: 'Japan',
    IndustrialCodeType: 'J',
    IndustrialCode: ''
  };
  
  // Add adult param with specified name (AdultYN or AudultYN)
  params[adultParamName] = 'N';
  
  return params;
}

// Optional/suspicious params to test incrementally
const ADDITIVE_PARAMS = [
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
 * Run A/B base case tests
 */
async function runBaseCaseTests(shippingNo) {
  console.log('=== Base Case A/B Tests ===\n');
  console.log('Testing controlled variations (AdultYN vs AudultYN, category A/B)\n');
  
  const baseCases = [
    {
      name: 'Case 1',
      description: 'User category + AdultYN',
      secondSubCat: USER_CATEGORY,
      adultParamName: 'AdultYN'
    },
    {
      name: 'Case 2',
      description: 'User category + AudultYN (typo test)',
      secondSubCat: USER_CATEGORY,
      adultParamName: 'AudultYN'
    },
    {
      name: 'Case 3',
      description: 'Qiita category + AdultYN',
      secondSubCat: QIITA_CATEGORY,
      adultParamName: 'AdultYN'
    },
    {
      name: 'Case 4',
      description: 'Qiita category + AudultYN',
      secondSubCat: QIITA_CATEGORY,
      adultParamName: 'AudultYN'
    }
  ];
  
  const results = [];
  
  for (const testCase of baseCases) {
    console.log(`[${testCase.name}] ${testCase.description}`);
    
    const params = buildBaseParams(testCase.secondSubCat, testCase.adultParamName);
    params.ShippingNo = shippingNo;
    
    console.log(`  SecondSubCat: ${params.SecondSubCat}, ParamName: ${testCase.adultParamName}`);
    
    const response = await callSetNewGoods(params);
    
    results.push({
      case: testCase.name,
      secondSubCat: testCase.secondSubCat,
      adultParamName: testCase.adultParamName,
      resultCode: response.ResultCode,
      resultMsg: response.ResultMsg || ''
    });
    
    console.log(`  → ResultCode: ${response.ResultCode}, Msg: ${response.ResultMsg}\n`);
  }
  
  // Print compact table
  console.log('\n=== Base Case Results Table ===\n');
  console.log('Case'.padEnd(8), '| SecondSubCat'.padEnd(14), '| AdultParam'.padEnd(12), '| Code'.padEnd(6), '| Message');
  console.log('-'.repeat(90));
  
  results.forEach(r => {
    console.log(
      r.case.padEnd(8),
      '|',
      r.secondSubCat.padEnd(14),
      '|',
      r.adultParamName.padEnd(12),
      '|',
      String(r.resultCode).padEnd(6),
      '|',
      r.resultMsg.substring(0, 50)
    );
  });
  
  console.log('\n');
  
  return results;
}

/**
 * Run additive param tests
 */
async function runTests() {
  console.log('\n=== Qoo10 SetNewGoods Debug Harness (A/B Tests) ===\n');
  console.log(`Unique SellerCode for this run: ${UNIQUE_SELLER_CODE}\n`);
  
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
  
  // Step 2: Run base case A/B tests
  console.log('Step 2: Running base case A/B tests...\n');
  const baseCaseResults = await runBaseCaseTests(shippingNo);
  
  // Check if any base case succeeded
  const successCase = baseCaseResults.find(r => r.resultCode === 0);
  
  if (successCase) {
    console.log(`✓✓✓ BASE CASE SUCCESS! ✓✓✓`);
    console.log(`${successCase.case} succeeded: SecondSubCat=${successCase.secondSubCat}, ${successCase.adultParamName}\n`);
    console.log('=== Debug Complete ===\n');
    return;
  }
  
  // All base cases failed - run incremental tests starting from Case 1
  console.log('All base cases returned non-zero ResultCode.');
  console.log('Step 3: Testing with additional params (starting from Case 1 baseline)...\n');
  
  const baseParams = buildBaseParams(USER_CATEGORY, 'AdultYN');
  baseParams.ShippingNo = shippingNo;
  
  const incrementalResults = [];
  let currentParams = { ...baseParams };
  
  // Test incremental additions
  for (let i = 0; i < ADDITIVE_PARAMS.length; i++) {
    const additionalParam = ADDITIVE_PARAMS[i];
    currentParams = { ...currentParams, ...additionalParam };
    
    const testNum = i + 1;
    const paramKey = Object.keys(additionalParam)[0];
    console.log(`[Incremental ${testNum}] Adding: ${paramKey}`);
    
    const response = await callSetNewGoods(currentParams);
    incrementalResults.push({
      test: `+${paramKey}`,
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
  
  // Print incremental summary
  if (incrementalResults.length > 0) {
    console.log('\n=== Incremental Test Results ===\n');
    console.log('Test'.padEnd(20), '| Code | Message');
    console.log('-'.repeat(70));
    incrementalResults.forEach(r => {
      console.log(
        r.test.padEnd(20),
        '|',
        String(r.resultCode).padEnd(4),
        '|',
        r.resultMsg
      );
    });
  }
  
  console.log('\n=== Debug Complete ===\n');
}

runTests().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
