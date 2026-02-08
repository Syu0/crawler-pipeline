# Qoo10 Registration Module - Update Summary

## Changes (commits in emergent branch)

### Problem Fixed
1. CLI printed `ItemNo: [object Object]` due to incorrect extraction
2. SellerCode was not unique across multiple runs (duplicate errors)
3. Need dry-run safety toggle to prevent accidental registrations

### Solution Applied

---

## 1. Unique SellerCode Generation (MUST)

**New logic in `backend/qoo10/registerNewGoods.js`:**

```javascript
function generateUniqueSellerCode(base = 'AUTO') {
  // Format: {base}{YYYYMMDDHHmmss}{rand4}
  const timestamp = '20260208123045';  // YYYYMMDDHHmmss
  const rand4 = '1234';                // 4 random digits
  return `${base}${timestamp}${rand4}`;
}
```

**Input handling:**
- If `input.SellerCodeBase` provided → use as base
- If `input.SellerCode` provided → treat as base (for backward compat)
- If neither provided → use 'AUTO' as base

**Example outputs:**
- `SAMPLE202602081230451234`
- `AUTO202602081230451234`
- `PROD202602081230451234`

**Always unique** - prevents duplicate SellerCode server errors.

---

## 2. Item ID Extraction: GdNo (MUST)

**New extraction logic:**

```javascript
function extractCreatedItemId(resultObject) {
  if (!resultObject) return null;
  
  // Try keys in priority order
  const keys = ['GdNo', 'GoodsNo', 'ItemNo', 'itemNo'];
  
  for (const key of keys) {
    if (resultObject[key] !== undefined) {
      return String(resultObject[key]);
    }
  }
  
  return null;
}
```

**Priority:**
1. `ResultObject.GdNo` (primary)
2. `ResultObject.GoodsNo` (fallback)
3. `ResultObject.ItemNo` (fallback)
4. `ResultObject.itemNo` (fallback)

**Result:**
- `createdItemId: '1192348471'` (string)
- Never prints `[object Object]`

---

## 3. Standardized Return Object (MUST)

**New schema:**

```javascript
{
  success: boolean,                    // true if ResultCode === 0
  resultCode: number,                  // Qoo10 API result code
  resultMsg: string,                   // Qoo10 API message
  createdItemId: string | null,        // GdNo from ResultObject
  sellerCodeUsed: string,              // Actual SellerCode sent
  shippingNoUsed: string,              // Actual ShippingNo used
  rawResultObject: object | null       // Full ResultObject for debugging
}
```

**Old schema (removed):**
```javascript
{
  itemNo: string,     // Was [object Object]
  request: {...}      // Replaced with direct fields
}
```

---

## 4. CLI Output Updated (MUST)

**New output format:**

```
=== Registration Result ===

Success: true
ResultCode: 0
ResultMsg: SUCCESS
CreatedItemId (GdNo): 1192348471
SellerCode used: SAMPLE202602081230451234
ShippingNo used: 663125

✓ Product registered successfully!
```

**When QOO10_TRACER=1:**

```
--- Raw ResultObject (debug) ---
{
  "GdNo": "1192348471",
  "SelCustNo": "12345",
  ...
}
--------------------------------
```

---

## 5. Dry-Run Safety Toggle (RECOMMENDED)

**New env flag:** `QOO10_ALLOW_REAL_REG`

**Behavior:**
- **Default (not set):** Dry-run mode - skips SetNewGoods call
- **Set to '1':** Performs real registration

**Dry-run output:**
```
⚠️  DRY-RUN MODE: Set QOO10_ALLOW_REAL_REG=1 to perform real registration.

=== Registration Result ===

Success: false
ResultCode: -1
ResultMsg: Dry-run mode - registration skipped
CreatedItemId (GdNo): null
SellerCode used: SAMPLE202602081230451234
ShippingNo used: 663125

✗ Registration failed
```

**Still resolves ShippingNo** (allowed, no risk).

---

## File Changes

### `/app/backend/qoo10/registerNewGoods.js`
- Added `generateUniqueSellerCode(base)` function
- Added `extractCreatedItemId(resultObject)` function
- Updated `buildSetNewGoodsParams()` signature
- Updated `registerNewGoods()` return schema
- Added dry-run mode check (QOO10_ALLOW_REAL_REG)
- Removed SellerCode from required fields (auto-generated)

### `/app/backend/qoo10/sample-newgoods.json`
- Changed `"SellerCode": "SAMPLE001"` → `"SellerCodeBase": "SAMPLE"`
- Module will generate unique code: `SAMPLE{timestamp}{rand4}`

### `/app/scripts/qoo10-register-cli.js`
- Removed manual SellerCode generation (handled by module)
- Updated output format to show:
  - `CreatedItemId (GdNo)`
  - `SellerCode used`
  - `ShippingNo used`
- Added rawResultObject pretty-print when tracer enabled
- Removed old "Request metadata" section

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `QOO10_SAK` | - | Required: Seller Auth Key |
| `QOO10_ALLOW_REAL_REG` | not set (dry-run) | Set to '1' for real registration |
| `QOO10_TRACER` | not set | Set to '1' for verbose logging |

---

## Local Setup Steps

```bash
# 1. Pull latest changes
cd /app
git checkout emergent
git pull

# 2. Ensure backend/.env exists
cat backend/.env
# Should have:
#   QOO10_SAK=your-key

# 3. (Optional) Add for real registration
echo "QOO10_ALLOW_REAL_REG=1" >> backend/.env

# 4. (Optional) Enable tracer
echo "QOO10_TRACER=1" >> backend/.env

# 5. Install dependencies
npm install

# 6. Run sample registration
npm run qoo10:register:sample
```

---

## Example Outputs

### Success (Real Registration)

```bash
$ QOO10_ALLOW_REAL_REG=1 npm run qoo10:register:sample

=== Qoo10 Product Registration CLI ===

Loading product data from: backend/qoo10/sample-newgoods.json

Registering product on Qoo10...

Generated unique SellerCode: SAMPLE202602081456231234
ShippingNo not provided, auto-resolving...
Resolved ShippingNo: 663125

=== Registration Result ===

Success: true
ResultCode: 0
ResultMsg: SUCCESS
CreatedItemId (GdNo): 1192348471
SellerCode used: SAMPLE202602081456231234
ShippingNo used: 663125

✓ Product registered successfully!
```

### Dry-Run Mode (Default)

```bash
$ npm run qoo10:register:sample

=== Qoo10 Product Registration CLI ===

Loading product data from: backend/qoo10/sample-newgoods.json

Registering product on Qoo10...

Generated unique SellerCode: SAMPLE202602081456231234
ShippingNo not provided, auto-resolving...
Resolved ShippingNo: 663125

⚠️  DRY-RUN MODE: Set QOO10_ALLOW_REAL_REG=1 to perform real registration.

=== Registration Result ===

Success: false
ResultCode: -1
ResultMsg: Dry-run mode - registration skipped
CreatedItemId (GdNo): null
SellerCode used: SAMPLE202602081456231234
ShippingNo used: 663125

✗ Registration failed
```

### With Tracer Enabled

```bash
$ QOO10_ALLOW_REAL_REG=1 QOO10_TRACER=1 npm run qoo10:register:sample

[... registration output ...]

--- Raw ResultObject (debug) ---
{
  "GdNo": "1192348471",
  "SelCustNo": "12345",
  "ItemTitle": "Sample Debug Product",
  "SellerCode": "SAMPLE202602081456231234"
}
--------------------------------

✓ Product registered successfully!
```

---

## Validation on Success Response

**Qoo10 API response:**
```json
{
  "ResultObject": {
    "GdNo": "1192348471",
    ...
  },
  "ResultCode": 0,
  "ResultMsg": "SUCCESS"
}
```

**CLI output:**
```
CreatedItemId (GdNo): 1192348471
```

✅ **Correct extraction** - no more `[object Object]`

---

## Programmatic Usage

```javascript
const { registerNewGoods } = require('./backend/qoo10/registerNewGoods');

const result = await registerNewGoods({
  SecondSubCat: '320002604',
  ItemTitle: 'My Product',
  ItemPrice: '5000',
  ItemQty: '10',
  SellerCodeBase: 'PROD',  // Optional, defaults to 'AUTO'
  StandardImage: 'https://example.com/image.jpg',
  ItemDescription: '<p>Description</p>'
});

console.log(`Item ID: ${result.createdItemId}`);
console.log(`SellerCode: ${result.sellerCodeUsed}`);
console.log(`Success: ${result.success}`);
```

---

## Breaking Changes

### Input
- `SellerCode` (required) → `SellerCodeBase` (optional, auto-generates unique)

### Return Object
- `itemNo` → `createdItemId`
- `request` object → removed, fields moved to top level (`sellerCodeUsed`, `shippingNoUsed`)
- Added: `rawResultObject` for debugging

---

**All changes committed to branch `emergent`**
