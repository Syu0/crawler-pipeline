# Qoo10 SetNewGoods A/B Tests - Update Summary

## Changes in commits 8928d4b, 34d389f

### Problem
Previous harness tested only one baseline configuration. When ResultCode -999 occurred, no diagnostic signal existed to identify whether the issue was param-name sensitivity (AdultYN vs AudultYN) or category restrictions.

### Solution
Added controlled A/B tests for param-name and category before incremental param additions.

---

## Key Changes

### 1. A/B Base Case Tests (4 Controlled Tests)

**Test Matrix:**
```
Case 1: User category (320002863) + AdultYN (correct param name)
Case 2: User category (320002863) + AudultYN (typo test - common mistake)
Case 3: Qiita category (320002604) + AdultYN (known-good category)
Case 4: Qiita category (320002604) + AudultYN (typo + known-good)
```

**Output Format:**
```
=== Base Case Results Table ===

Case     | SecondSubCat  | AdultParam   | Code   | Message
----------------------------------------------------------------------------------
Case 1   | 320002863     | AdultYN      | -999   | Object reference not set...
Case 2   | 320002863     | AudultYN     | -999   | Object reference not set...
Case 3   | 320002604     | AdultYN      | 0      | Success
Case 4   | 320002604     | AudultYN     | -999   | Object reference not set...
```

This clearly shows:
- Category matters (320002604 works, 320002863 fails)
- Param name matters (AdultYN works, AudultYN fails)

---

### 2. Unique SellerCode Per Run

**Before:**
```javascript
SellerCode: 'DBGTEST01'  // Static, could cause "duplicate seller code" errors
```

**After:**
```javascript
const UNIQUE_SELLER_CODE = `DBGTEST${Date.now().toString().slice(-8)}`;
// Example: DBGTEST73847291
```

Now each test run uses a unique SellerCode (timestamp-based), avoiding duplicate code masking issues.

---

### 3. Enhanced Params (Qiita Sample Match)

**Added fields:**
- `PromotionName: 'Debug Test'`
- `ProductionPlaceType: '1'`
- `ProductionPlace: 'Japan'`
- `IndustrialCodeType: 'J'`
- `IndustrialCode: ''`
- `Weight: '500'` (moved from additive to base)

**Total base params:** 19 fields (was 14)

---

### 4. Enhanced Tracer Output (QOO10_TRACER=1)

**New debug output when tracer enabled:**
```javascript
// In qoo10Client.js
console.log(`Request body length: ${body.length} bytes`);
console.log(`Request body (first 200 chars): ${body.substring(0, 200)}...`);
console.log(`Raw response (first 500 chars): ${rawText.substring(0, 500)}...`);
console.log(`Response length: ${rawText.length} bytes`);
```

**Benefits:**
- See actual encoded body sent to API
- Detect non-JSON responses (HTML error pages, XML, etc.)
- Identify truncation or encoding issues

---

### 5. Test Flow

**New execution order:**
1. Fetch ShippingNo from GetSellerDeliveryGroupInfo
2. **Run 4 base case A/B tests** (NEW)
3. Print compact results table
4. If any base case succeeds → stop, report success
5. If all fail → run incremental tests starting from Case 1 baseline

**Early exit on success:**
```
✓✓✓ BASE CASE SUCCESS! ✓✓✓
Case 3 succeeded: SecondSubCat=320002604, AdultYN
```

---

## Example Output

### Scenario 1: Category Issue Detected

```
=== Qoo10 SetNewGoods Debug Harness (A/B Tests) ===

Unique SellerCode for this run: DBGTEST47382910

Step 1: Fetching valid ShippingNo from seller delivery groups...
✓ Using ShippingNo: 663125

Step 2: Running base case A/B tests...

=== Base Case A/B Tests ===

Testing controlled variations (AdultYN vs AudultYN, category A/B)

[Case 1] User category + AdultYN
  SecondSubCat: 320002863, ParamName: AdultYN
  → ResultCode: -999, Msg: Object reference not set...

[Case 2] User category + AudultYN (typo test)
  SecondSubCat: 320002863, ParamName: AudultYN
  → ResultCode: -999, Msg: Object reference not set...

[Case 3] Qiita category + AdultYN
  SecondSubCat: 320002604, ParamName: AdultYN
  → ResultCode: 0, Msg: Success

✓✓✓ BASE CASE SUCCESS! ✓✓✓
Case 3 succeeded: SecondSubCat=320002604, AdultYN

=== Debug Complete ===
```

**Diagnosis:** User category (320002863) not permitted for this seller account. Switch to 320002604 or get category permission.

---

### Scenario 2: Param Name Issue Detected

```
=== Base Case Results Table ===

Case     | SecondSubCat  | AdultParam   | Code   | Message
----------------------------------------------------------------------------------
Case 1   | 320002863     | AdultYN      | 0      | Success
Case 2   | 320002863     | AudultYN     | -999   | Object reference not set...
Case 3   | 320002604     | AdultYN      | 0      | Success
Case 4   | 320002604     | AudultYN     | -999   | Object reference not set...
```

**Diagnosis:** Param name typo (`AudultYN` instead of `AdultYN`) causes failure. Correct spelling required.

---

## Commits

- `8928d4b` - Added A/B test harness with 4 base cases, unique SellerCode, Qiita params
- `34d389f` - Enhanced tracer output in qoo10Client.js

---

## To Run Locally

```bash
cd /app
git checkout emergent
git pull

# Run debug harness
npm run qoo10:debug:setnewgoods

# With verbose tracer (optional)
QOO10_TRACER=1 npm run qoo10:debug:setnewgoods
```

**Please paste the "Base Case Results Table" output to help diagnose the -999 root cause.**
