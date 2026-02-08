#!/usr/bin/env node
/**
 * Sanity check: test Qoo10 connection with GetSellerDeliveryGroupInfo
 * Usage: node scripts/qoo10-test-lookup.js
 */

const { testQoo10Connection } = require('./lib/qoo10Client');

async function test() {
  console.log('Testing Qoo10 connection (GetSellerDeliveryGroupInfo)...\n');
  
  try {
    const response = await testQoo10Connection();
    console.log('Response:', JSON.stringify(response, null, 2));
    
    if (response.ResultCode === 0) {
      console.log('\n✓ Connection OK');
    } else {
      console.log('\n✗ Connection failed');
      process.exit(1);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

test();
