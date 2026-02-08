# Qoo10 QAPI Debug Setup - PR Diffs

## Summary
Normalized Qoo10 client to **Node-side only** (removed all REACT_APP_* references). Moved client from frontend to `/app/scripts/lib/`. Updated all scripts and npm commands to use single env var `QOO10_SAK`.

---

## Created Files

### `/app/scripts/lib/qoo10Client.js` (NEW)
```diff
+ Node HTTPS-based Qoo10 QAPI client
+ Uses process.env.QOO10_SAK (NOT REACT_APP_*)
+ Tracer toggle: QOO10_TRACER=1 or true
+ Content-Type includes charset UTF-8
+ All params normalized to strings
+ Exports: qoo10PostMethod, testQoo10Connection, setNewGoods
```

### `/app/package.json` (NEW)
```diff
+ {
+   "name": "qoo10-debug-project",
+   "version": "1.0.0",
+   "private": true,
+   "scripts": {
+     "qoo10:env:lookup": "MODE=lookup node scripts/qoo10-env-check.js",
+     "qoo10:env:register": "MODE=register node scripts/qoo10-env-check.js",
+     "qoo10:test:lookup": "node scripts/qoo10-test-lookup.js",
+     "qoo10:debug:setnewgoods": "npm run qoo10:env:register && node scripts/qoo10-debug-setnewgoods.js"
+   }
+ }
```

---

## Modified Files

### `/app/scripts/qoo10-env-check.js`
```diff
  #!/usr/bin/env node
  /**
   * Qoo10 env gate: verify required env vars before network calls
   * Exits with error if required vars are missing
   */
  
  const MODE = process.env.MODE || 'lookup';
  
  const REQUIRED_VARS = {
    lookup: ['QOO10_SAK'],
    register: ['QOO10_SAK']
  };
  
- // (No changes needed - already using QOO10_SAK)
```

### `/app/scripts/qoo10-test-lookup.js`
```diff
  #!/usr/bin/env node
  /**
   * Sanity check: test Qoo10 connection with GetSellerDeliveryGroupInfo
   * Usage: node scripts/qoo10-test-lookup.js
   */
  
- const https = require('https');
- const { URLSearchParams } = require('url');
- 
- const QOO10_BASE_URL = 'https://api.qoo10.jp/GMKT.INC.Front.QAPIService/ebayjapan.qapi';
- const SAK = process.env.QOO10_SAK;
- 
- if (!SAK) {
-   console.error('QOO10_SAK not set');
-   process.exit(1);
- }
- 
- function callLookup() {
-   return new Promise((resolve, reject) => {
-     // ... 40 lines of HTTPS boilerplate ...
-   });
- }
+ const { testQoo10Connection } = require('./lib/qoo10Client');
  
  async function test() {
    console.log('Testing Qoo10 connection (GetSellerDeliveryGroupInfo)...\n');
-   const response = await callLookup();
-   console.log('HTTP Status:', response.status);
-   console.log('Response:', JSON.stringify(response.data, null, 2));
+   
+   try {
+     const response = await testQoo10Connection();
+     console.log('Response:', JSON.stringify(response, null, 2));
    
-     if (response.data.ResultCode === 0) {
+     if (response.ResultCode === 0) {
        console.log('\n✓ Connection OK');
      } else {
        console.log('\n✗ Connection failed');
        process.exit(1);
      }
+   } catch (err) {
+     console.error('Error:', err.message);
+     process.exit(1);
+   }
  }
  
- test().catch(err => {
-   console.error('Error:', err);
-   process.exit(1);
- });
+ test();
```

### `/app/scripts/qoo10-debug-setnewgoods.js`
```diff
  #!/usr/bin/env node
  /**
   * Qoo10 SetNewGoods parameter binary search harness
   * Tests minimal params first, then adds optional/suspicious params incrementally
   * Records ResultCode/Msg for each attempt
   * 
   * Usage: node scripts/qoo10-debug-setnewgoods.js
   * Requires: QOO10_SAK env var
   */
  
- const https = require('https');
- const { URLSearchParams } = require('url');
- 
- const QOO10_BASE_URL = 'https://api.qoo10.jp/GMKT.INC.Front.QAPIService/ebayjapan.qapi';
- const SAK = process.env.QOO10_SAK;
+ const { qoo10PostMethod } = require('./lib/qoo10Client');
  
- if (!SAK) {
+ if (!process.env.QOO10_SAK) {
    console.error('QOO10_SAK not set');
    process.exit(1);
  }
  
  // ... MINIMAL_PARAMS and ADDITIVE_PARAMS unchanged ...
  
  /**
   * Make Qoo10 SetNewGoods API call
   */
- function callSetNewGoods(params) {
-   return new Promise((resolve, reject) => {
-     // ... 30 lines of HTTPS boilerplate ...
-   });
+ async function callSetNewGoods(params) {
+   return qoo10PostMethod('ItemsBasic.SetNewGoods', params, '1.1');
  }
  
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
-     status: response.status,
-     resultCode: response.data.ResultCode,
-     resultMsg: response.data.ResultMsg
+     resultCode: response.ResultCode,
+     resultMsg: response.ResultMsg
    });
-   console.log(`→ HTTP ${response.status}, ResultCode: ${response.data.ResultCode}, Msg: ${response.data.ResultMsg}\n`);
+   console.log(`→ ResultCode: ${response.ResultCode}, Msg: ${response.ResultMsg}\n`);
    
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
-       status: response.status,
-       resultCode: response.data.ResultCode,
-       resultMsg: response.data.ResultMsg
+       resultCode: response.ResultCode,
+       resultMsg: response.ResultMsg
      });
-     console.log(`→ HTTP ${response.status}, ResultCode: ${response.data.ResultCode}, Msg: ${response.data.ResultMsg}\n`);
+     console.log(`→ ResultCode: ${response.ResultCode}, Msg: ${response.ResultMsg}\n`);
      
      // Stop if we get success
-     if (response.data.ResultCode === 0) {
+     if (response.ResultCode === 0) {
        console.log('✓ SUCCESS! Found working param combination.');
        break;
      }
    }
    
    // Print summary table
    console.log('\n=== Summary Table ===\n');
-   console.log('Test'.padEnd(20), '| Status | Code | Message');
+   console.log('Test'.padEnd(20), '| Code | Message');
    console.log('-'.repeat(70));
    results.forEach(r => {
      console.log(
        r.test.padEnd(20),
        '|',
-       String(r.status).padEnd(6),
-       '|',
        String(r.resultCode).padEnd(4),
        '|',
        r.resultMsg
      );
    });
    
    console.log('\n=== Debug Complete ===\n');
  }
  
  runTests().catch(err => {
-   console.error('Error:', err);
+   console.error('Error:', err.message);
    process.exit(1);
  });
```

### `/app/frontend/package.json`
```diff
  {
    "name": "frontend",
    "version": "0.1.0",
    "private": true,
    "dependencies": { ... },
    "scripts": {
      "start": "craco start",
      "build": "craco build",
-     "test": "craco test",
-     "qoo10:env:lookup": "MODE=lookup node ../scripts/qoo10-env-check.js",
-     "qoo10:env:register": "MODE=register node ../scripts/qoo10-env-check.js",
-     "qoo10:test:lookup": "node ../scripts/qoo10-test-lookup.js",
-     "qoo10:debug:setnewgoods": "npm run qoo10:env:register && node ../scripts/qoo10-debug-setnewgoods.js"
+     "test": "craco test"
    },
    ...
  }
```

### `/app/QAPI_DEBUG_SETUP.md`
```diff
- # Qoo10 QAPI Debug Setup - Complete
+ # Qoo10 QAPI Debug Setup

+ ## Overview
+ Node-side debugging harness for Qoo10 Japan QAPI `ItemsBasic.SetNewGoods` returning ResultCode=-999.
+ 
+ **Key points:**
+ - All Qoo10 calls happen **server-side** (Node scripts), NOT in browser
+ - Single env var: `QOO10_SAK` (Seller Auth Key)
+ - NO network calls until env is set
+ - Parameter binary-search to identify missing/invalid params

  ## Files Created

- ### 1. `/app/frontend/src/lib/qoo10Client.js`
+ ### 1. `/app/scripts/lib/qoo10Client.js`
- - **Env gate**: NO network calls unless `REACT_APP_QOO10_SAK` is set
+ - **Env gate**: blocks fetch unless `QOO10_SAK` set
- - **Tracer**: Enable with `REACT_APP_QOO10_TRACER=true` to log:
+ - **Tracer**: set `QOO10_TRACER=1` to log method/URL/headers (SAK masked)/body/response
+ - **Encoding**: all params normalized to strings, UTF-8 charset

- ## npm Scripts Added to `/app/frontend/package.json`
+ ## npm Scripts (run from repo root `/app`)

- ## To Run Later (After Setting Env)
+ ## Usage

  ### Step 1: Set env vars
  ```bash
- # In /app/frontend/.env or shell export
  export QOO10_SAK="your-seller-auth-key-here"
- export REACT_APP_QOO10_SAK="your-seller-auth-key-here"
- export REACT_APP_QOO10_TRACER="true"  # optional, for verbose logs
+ export QOO10_TRACER=1  # optional, for verbose logs
  ```

  ### Step 2: Test connection (sanity check)
  ```bash
- cd /app/frontend
+ cd /app
  npm run qoo10:test:lookup
  # Should return ResultCode: 0 if SAK is valid
  ```
```

---

## Removed Files

### `/app/frontend/src/lib/qoo10Client.js` (DELETED)
```diff
- (Frontend version with REACT_APP_* env vars - no longer needed)
```

---

## Commands to Run (from `/app`)

```bash
# Set env
export QOO10_SAK="your-key"

# Test connection
npm run qoo10:test:lookup

# Run debug harness
npm run qoo10:debug:setnewgoods
```

---

**Tutorial:** https://emergent.sh/tutorial/moltbot-on-emergent
