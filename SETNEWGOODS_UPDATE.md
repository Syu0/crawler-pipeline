# Qoo10 SetNewGoods Debug Harness Update

## Changes in commit 2ca73fc

### Problem
Previous baseline (`MINIMAL_PARAMS`) was missing required fields per Qoo10 documentation, causing all tests to return ResultCode -999 with no signal.

### Solution
Updated to use "success-capable" baseline params matching Qoo10 docs/examples.

---

## Key Changes

### 1. Baseline Parameters (`BASE_REQUIRED_PARAMS`)

**Added required fields:**
- `RetailPrice: '0'` - required in official docs
- `StandardImage` - moved from additive to base (required)
- `ItemDescription` - moved from additive to base (required)
- `TaxRate: 'S'` - changed from `'10'` to `'S'` per Qoo10 guidance
- `ExpireDate: '2030-12-31'` - moved to base

**Updated field names:**
- `ItemWeight` → `Weight` (matches Qoo10 docs)

### 2. Dynamic ShippingNo Lookup

**Before:**
```javascript
ShippingNo: '0'  // Hardcoded, likely invalid
```

**After:**
```javascript
// Step 1: Call ItemsLookup.GetSellerDeliveryGroupInfo
// Step 2: Extract first ShippingNo where Oversea === 'N'
// Step 3: Inject into BASE_REQUIRED_PARAMS
```

Now automatically fetches valid `ShippingNo` from seller's delivery groups before testing.

### 3. Early Success Detection

**New behavior:**
- If base params succeed (ResultCode 0), stop immediately
- Print "BASE SUCCESS" message
- Skip additive param tests

**Output on success:**
```
✓✓✓ BASE SUCCESS! ✓✓✓
The success-capable baseline works correctly.

=== Summary ===

ShippingNo used: 12345
Base params: 14 fields
Result: SUCCESS (ResultCode 0)
```

### 4. Updated Additive Tests

**Removed from additive tests** (now in base):
- `StandardImage`
- `ItemDescription`
- `TaxRate`
- `ExpireDate`

**New additive tests:**
- `Weight: '500'`
- `ShippingCharge: '0'`
- `BrandNo: ''`
- `ManuCode: ''`
- `ModelNo: ''`

---

## Complete BASE_REQUIRED_PARAMS

```javascript
{
  returnType: 'application/json',
  SecondSubCat: '320002863',
  ItemTitle: 'Qoo10 Debug Test Item',
  ItemPrice: '4000',
  RetailPrice: '0',
  ItemQty: '99',
  AvailableDateType: '0',
  AvailableDateValue: '2',
  ShippingNo: '<dynamically fetched>',
  SellerCode: 'DBGTEST01',
  AdultYN: 'N',
  TaxRate: 'S',
  ExpireDate: '2030-12-31',
  StandardImage: 'https://dp.image-qoo10.jp/GMKT.IMG/loading_2017/qoo10_loading.v_20170420.png',
  ItemDescription: '<p>Test item for debugging SetNewGoods</p>'
}
```

---

## Expected Behavior

### Scenario 1: Base Params Succeed
```
Step 1: Fetching valid ShippingNo from seller delivery groups...
✓ Using ShippingNo: 12345

Step 2: Testing success-capable baseline params...

[Test 1] Base required params (per Qoo10 docs)
Params: returnType, SecondSubCat, ItemTitle, ...
→ ResultCode: 0, Msg: Success

✓✓✓ BASE SUCCESS! ✓✓✓
The success-capable baseline works correctly.

=== Summary ===

ShippingNo used: 12345
Base params: 14 fields
Result: SUCCESS (ResultCode 0)

=== Debug Complete ===
```

### Scenario 2: Base Params Fail (Account Issue)
```
Step 1: Fetching valid ShippingNo from seller delivery groups...
✓ Using ShippingNo: 12345

Step 2: Testing success-capable baseline params...

[Test 1] Base required params (per Qoo10 docs)
→ ResultCode: -999, Msg: Object reference not set...

Base params failed. Testing with additional params...

[Test 2] Adding: Weight
→ ResultCode: -999, Msg: ...

[Test 3] Adding: ShippingCharge
→ ResultCode: 0, Msg: Success

✓ SUCCESS! Found working param combination.

=== Summary Table ===

ShippingNo used: 12345
Test                 | Code | Message
----------------------------------------------------------------------
Base Required        | -999 | Object reference not set...
+Weight              | -999 | Object reference not set...
+ShippingCharge      | 0    | Success
```

---

## Error Handling

### No Delivery Groups
```
Step 1: Fetching valid ShippingNo from seller delivery groups...
✗ No delivery groups found - please set up shipping template in Qoo10 seller portal
```
→ User must configure shipping in Qoo10 seller settings

### GetSellerDeliveryGroupInfo Fails
```
Step 1: Fetching valid ShippingNo from seller delivery groups...
✗ GetSellerDeliveryGroupInfo failed: Invalid authentication
```
→ Check QOO10_SAK validity

---

## Commit
- Commit ID: `2ca73fc`
- Branch: `emergent`
- Files changed: `scripts/qoo10-debug-setnewgoods.js`

---

**To test locally:**
```bash
cd /app
git checkout emergent
git pull
npm run qoo10:test:lookup       # Verify connection
npm run qoo10:debug:setnewgoods # Run updated harness
```
