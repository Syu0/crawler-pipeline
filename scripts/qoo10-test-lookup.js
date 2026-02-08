#!/usr/bin/env node
/**
 * Sanity check: test Qoo10 connection with GetSellerDeliveryGroupInfo
 * Usage: node scripts/qoo10-test-lookup.js
 */

const https = require('https');
const { URLSearchParams } = require('url');

const QOO10_BASE_URL = 'https://api.qoo10.jp/GMKT.INC.Front.QAPIService/ebayjapan.qapi';
const SAK = process.env.QOO10_SAK;

if (!SAK) {
  console.error('QOO10_SAK not set');
  process.exit(1);
}

function callLookup() {
  return new Promise((resolve, reject) => {
    const params = { returnType: 'application/json' };
    const body = new URLSearchParams(params).toString();
    const url = new URL(`${QOO10_BASE_URL}/ItemsLookup.GetSellerDeliveryGroupInfo`);
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'QAPIVersion': '1.0',
        'GiosisCertificationKey': SAK,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (err) {
          resolve({ status: res.statusCode, data: { rawText: data } });
        }
      });
    });
    
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

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
