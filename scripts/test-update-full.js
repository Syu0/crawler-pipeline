#!/usr/bin/env node
/**
 * Full integration test for UpdateGoods
 * Shows final payload structure that will be sent to Qoo10
 */

const { updateExistingGoods } = require('../backend/qoo10/updateGoods');

async function runTest() {
  console.log('='.repeat(70));
  console.log('  UpdateGoods Full Integration Test');
  console.log('  Payload structure should match SetNewGoods exactly');
  console.log('='.repeat(70));
  console.log('');

  // Input like qoo10-auto-register.js would pass
  const input = {
    ItemCode: 'QOO10_REAL_ITEM_789',
    SecondSubCat: '320002604',
    ItemTitle: 'Korean Beauty Product - Updated Title',
    ItemPrice: '7500',
    ItemQty: '100',
    StandardImage: 'https://thumbnail.coupangcdn.com/thumbnails/remote/492x492ex/image/vendor_inventory/1234/abcd.jpg',
    ItemDescription: '<p>This is a Korean beauty product description.</p>',
    Weight: '1',
    ProductionPlaceType: '2',
    ProductionPlace: 'Overseas',
    ShippingNo: '471554',
    RetailPrice: '0',
    TaxRate: 'S',
    ExpireDate: '2030-12-31',
    AdultYN: 'N',
    AvailableDateType: '0',
    AvailableDateValue: '2',
  };

  // Simulated row data from sheet
  const currentRowData = {
    vendorItemId: '7890123456',
    coupang_product_id: 'CP123456',
    ItemTitle: 'Korean Beauty Product - Old Title',
    ItemPrice: '5900',
    qoo10SellingPrice: '7000',
    jpCategoryIdUsed: '320002604',
    StandardImage: 'https://thumbnail.coupangcdn.com/thumbnails/remote/492x492ex/image/vendor_inventory/1234/abcd.jpg',
    ItemDescriptionText: '<p>This is a Korean beauty product description.</p>',
    WeightKg: '1',
    ExtraImages: '[]',
    needsUpdate: 'YES',
    changeFlags: 'PRICE_UP',
    qoo10ItemId: 'QOO10_REAL_ITEM_789',
  };

  console.log('INPUT (from qoo10-auto-register.js):');
  console.log(JSON.stringify(input, null, 2));
  console.log('');

  console.log('Calling updateExistingGoods...\n');
  
  const result = await updateExistingGoods(input, currentRowData);
  
  console.log('\nRESULT:');
  console.log(JSON.stringify(result, null, 2));
  
  console.log('\n' + '='.repeat(70));
  console.log('TEST COMPLETE');
  console.log('='.repeat(70));
}

runTest().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
