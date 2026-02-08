/**
 * Qoo10 QAPI Client with safe tracer for debugging -999 errors
 * Node-side only (NOT for browser/frontend)
 * NO NETWORK CALLS unless QOO10_SAK env is set
 */

// Auto-load backend/.env
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'backend', '.env') });

const https = require('https');
const { URLSearchParams } = require('url');

const QOO10_BASE_URL = 'https://api.qoo10.jp/GMKT.INC.Front.QAPIService/ebayjapan.qapi';
const ENABLE_TRACER = process.env.QOO10_TRACER === '1' || process.env.QOO10_TRACER === 'true';

/**
 * Mask sensitive key - show first 8 and last 4 chars only
 */
function maskKey(key) {
  if (!key || key.length < 12) return '***masked***';
  return `${key.substring(0, 8)}...${key.substring(key.length - 4)}`;
}

/**
 * Safe tracer: logs method, URL, headers (masked), body, response
 */
function traceRequest(methodName, headers, params) {
  if (!ENABLE_TRACER) return;
  
  console.log('\n=== QOO10 REQUEST TRACE ===');
  console.log('Method:', methodName);
  console.log('URL:', `${QOO10_BASE_URL}/${methodName}`);
  console.log('Headers:', {
    ...headers,
    GiosisCertificationKey: maskKey(headers.GiosisCertificationKey)
  });
  console.log('Body (urlencoded):', new URLSearchParams(params).toString());
}

function traceResponse(methodName, rawText, parsedData) {
  if (!ENABLE_TRACER) return;
  
  console.log('\n=== QOO10 RESPONSE TRACE ===');
  console.log('Method:', methodName);
  console.log('Raw Response:', rawText);
  console.log('Parsed JSON:', parsedData);
  console.log('========================\n');
}

/**
 * Generate masked curl command for debugging (NO secrets)
 */
function generateCurlCommand(methodName, headers, params) {
  const url = `${QOO10_BASE_URL}/${methodName}`;
  const maskedHeaders = {
    ...headers,
    GiosisCertificationKey: maskKey(headers.GiosisCertificationKey)
  };
  
  let curl = `curl -X POST '${url}'`;
  Object.entries(maskedHeaders).forEach(([key, value]) => {
    curl += ` \\
  -H '${key}: ${value}'`;
  });
  curl += ` \\
  --data-urlencode '${new URLSearchParams(params).toString()}'`;
  
  return curl;
}

/**
 * Core POST method for Qoo10 QAPI
 * @param {string} methodName - e.g., 'ItemsBasic.SetNewGoods'
 * @param {object} params - request parameters as object
 * @param {string} apiVersion - default '1.1'
 * @returns {Promise<object>} - parsed JSON response
 */
function qoo10PostMethod(methodName, params, apiVersion = '1.1') {
  return new Promise((resolve, reject) => {
    const sak = process.env.QOO10_SAK;
    
    if (!sak) {
      return reject(new Error('QOO10_SAK not set - network call blocked by env gate'));
    }
    
    // Normalize all params to strings before encoding
    const normalizedParams = {};
    Object.entries(params).forEach(([key, value]) => {
      normalizedParams[key] = String(value);
    });
    
    const body = new URLSearchParams(normalizedParams).toString();
    const url = new URL(`${QOO10_BASE_URL}/${methodName}`);
    
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'QAPIVersion': apiVersion,
      'GiosisCertificationKey': sak,
      'Content-Length': Buffer.byteLength(body)
    };
    
    traceRequest(methodName, headers, normalizedParams);
    
    if (ENABLE_TRACER) {
      console.log('\nGenerated curl (masked):\n', generateCurlCommand(methodName, headers, normalizedParams));
      console.log(`\nRequest body length: ${body.length} bytes`);
      console.log(`Request body (first 200 chars): ${body.substring(0, 200)}${body.length > 200 ? '...' : ''}\n`);
    }
    
    const req = https.request(url, { method: 'POST', headers }, (res) => {
      let rawText = '';
      res.on('data', chunk => rawText += chunk);
      res.on('end', () => {
        if (ENABLE_TRACER) {
          console.log(`\nRaw response (first 500 chars): ${rawText.substring(0, 500)}${rawText.length > 500 ? '...' : ''}`);
          console.log(`Response length: ${rawText.length} bytes\n`);
        }
        
        let parsedData;
        try {
          parsedData = JSON.parse(rawText);
        } catch (err) {
          // Might be XML or malformed
          console.warn('Failed to parse response as JSON. Raw response:', rawText.substring(0, 200));
          parsedData = { rawXML: rawText, parseError: err.message };
        }
        
        traceResponse(methodName, rawText, parsedData);
        resolve(parsedData);
      });
    });
    
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Sanity check method - GetSellerDeliveryGroupInfo
 */
function testQoo10Connection() {
  return qoo10PostMethod('ItemsLookup.GetSellerDeliveryGroupInfo', {
    returnType: 'application/json'
  }, '1.0');
}

/**
 * SetNewGoods method - the failing one
 */
function setNewGoods(params) {
  return qoo10PostMethod('ItemsBasic.SetNewGoods', params, '1.1');
}

module.exports = {
  qoo10PostMethod,
  testQoo10Connection,
  setNewGoods
};
