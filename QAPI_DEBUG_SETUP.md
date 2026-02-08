# Qoo10 QAPI Debug Setup

## Overview
Node-side debugging harness for Qoo10 Japan QAPI `ItemsBasic.SetNewGoods` returning ResultCode=-999.

**Key points:**
- All Qoo10 calls happen **server-side** (Node scripts), NOT in browser
- Single env var: `QOO10_SAK` (Seller Auth Key)
- NO network calls until env is set
- Parameter binary-search to identify missing/invalid params

---

## Files

### 1. `/app/scripts/lib/qoo10Client.js`
Core Qoo10 QAPI client (Node HTTPS)
- **Env gate**: blocks fetch unless `QOO10_SAK` set
- **Tracer**: set `QOO10_TRACER=1` to log method/URL/headers (SAK masked)/body/response
- **Encoding**: all params normalized to strings, UTF-8 charset
- Functions: `qoo10PostMethod()`, `testQoo10Connection()`, `setNewGoods()`

### 2. `/app/scripts/qoo10-env-check.js`
Validates `QOO10_SAK` before tests run. Exits with error if missing.

### 3. `/app/scripts/qoo10-test-lookup.js`
Sanity check: tests `ItemsLookup.GetSellerDeliveryGroupInfo` to verify SAK works.

### 4. `/app/scripts/qoo10-debug-setnewgoods.js`
**Parameter binary search harness**
- Starts with minimal SetNewGoods params
- Adds optional/suspicious params incrementally (StandardImage, ItemDescription, TaxRate, etc.)
- Prints ResultCode/Msg table

---

## npm Scripts (run from repo root `/app`)

```bash
npm run qoo10:env:lookup              # Check QOO10_SAK is set (lookup mode)
npm run qoo10:env:register            # Check QOO10_SAK is set (register mode)
npm run qoo10:test:lookup             # Sanity check connection
npm run qoo10:debug:setnewgoods       # Run param binary search
```

---

## Usage

### Step 1: Set env var
```bash
export QOO10_SAK="your-seller-auth-key-here"
```

Optional: enable verbose tracer
```bash
export QOO10_TRACER=1
```

### Step 2: Test connection (sanity check)
```bash
cd /app
npm run qoo10:test:lookup
# Expected: ResultCode: 0, ResultMsg: "Success"
```

### Step 3: Run SetNewGoods debug harness
```bash
cd /app
npm run qoo10:debug:setnewgoods
# Prints table showing which params cause -999 vs success
```

### Step 4: Verify env gate (without setting var)
```bash
unset QOO10_SAK
npm run qoo10:env:register
# Expected: "Missing required env vars for MODE=register: QOO10_SAK"
```

---

## Example Output

### Successful connection test
```
Testing Qoo10 connection (GetSellerDeliveryGroupInfo)...

Response: {
  "ResultCode": 0,
  "ResultMsg": "Success",
  "ResultObject": [...]
}

✓ Connection OK
```

### Debug harness (partial)
```
=== Qoo10 SetNewGoods Parameter Debug ===

[Test 1] Minimal params only
Params: returnType, SecondSubCat, ItemTitle, ItemPrice, ItemQty, ...
→ ResultCode: -999, Msg: Object reference not set to an instance of an object.

[Test 2] Adding: StandardImage
Params: returnType, SecondSubCat, ItemTitle, ..., StandardImage
→ ResultCode: -999, Msg: Object reference not set to an instance of an object.

[Test 3] Adding: ItemDescription
→ ResultCode: 0, Msg: Success
✓ SUCCESS! Found working param combination.

=== Summary Table ===

Test                 | Code | Message
----------------------------------------------------------------------
Minimal              | -999 | Object reference not set...
+StandardImage       | -999 | Object reference not set...
+ItemDescription     | 0    | Success
```

---

## Key Features

✅ **Node-side only** - no browser/React env vars  
✅ **Single env var** - `QOO10_SAK` for all scripts  
✅ **Env gate** - NO network calls until SAK is set  
✅ **Safe tracer** - masks SAK in logs, shows curl with masked secrets  
✅ **UTF-8 encoding** - Content-Type includes charset  
✅ **String normalization** - all params converted to strings before urlencoding  
✅ **Binary search** - identifies which param fixes -999  

---

## Troubleshooting

**"QOO10_SAK not set"**  
→ Run `export QOO10_SAK="your-key"` before npm scripts

**"Connection failed" on lookup test**  
→ Verify SAK is valid and not expired

**All tests return -999**  
→ Check Qoo10 seller portal for required account settings (e.g., shipping template, category permissions)

---

**Tutorial:**  
https://emergent.sh/tutorial/moltbot-on-emergent

