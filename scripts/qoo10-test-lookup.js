#!/usr/bin/env node
/**
 * Sanity check: test Qoo10 connection with GetSellerDeliveryGroupInfo
 * Usage: node scripts/qoo10-test-lookup.js
 */

const { testQoo10Connection } = require('./lib/qoo10Client');

async function test() {
  console.log('Testing Qoo10 connection (GetSellerDeliveryGroupInfo)...\n');
  const response = await callLookup();
  console.log('HTTP Status:', response.status);
  console.log('Response:', JSON.stringify(response.data, null, 2));
  
  if (response.data.ResultCode === 0) {
    console.log('\n✓ Connection OK');
  } else {
    console.log('\n✗ Connection failed');
    process.exit(1);
  }
}

test().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
