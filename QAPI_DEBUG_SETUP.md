# Qoo10 QAPI Debug Setup - Complete

## Files Created

### 1. `/app/frontend/src/lib/qoo10Client.js`
- Core Qoo10 QAPI client with safe tracer
- **Env gate**: NO network calls unless `REACT_APP_QOO10_SAK` is set
- **Tracer**: Enable with `REACT_APP_QOO10_TRACER=true` to log:
  - Method name, URL, headers (SAK masked), urlencoded body
  - Raw response text + parsed JSON/XML
  - Masked curl command for manual testing
- Functions: `qoo10PostMethod()`, `testQoo10Connection()`, `setNewGoods()`

### 2. `/app/scripts/qoo10-env-check.js`
- Validates required env vars before tests run
- Modes: `lookup` (requires QOO10_SAK), `register` (requires QOO10_SAK)
- Exits with error if vars missing

### 3. `/app/scripts/qoo10-debug-setnewgoods.js`
- **Parameter binary search harness** (NOT RUN YET)
- Starts with minimal SetNewGoods params, adds suspicious params incrementally
- Tracks ResultCode/Msg for each attempt
- Prints clean summary table
- Additive params tested: StandardImage, ItemDescription, TaxRate, ExpireDate, etc.

### 4. `/app/scripts/qoo10-test-lookup.js`
- Sanity check: tests `ItemsLookup.GetSellerDeliveryGroupInfo`
- Confirms SAK works with a known-good method

---

## npm Scripts Added to `/app/frontend/package.json`

```json
"qoo10:env:lookup": "MODE=lookup node ../scripts/qoo10-env-check.js",
"qoo10:env:register": "MODE=register node ../scripts/qoo10-env-check.js",
"qoo10:test:lookup": "node ../scripts/qoo10-test-lookup.js",
"qoo10:debug:setnewgoods": "npm run qoo10:env:register && node ../scripts/qoo10-debug-setnewgoods.js"
```

---

## To Run Later (After Setting Env)

### Step 1: Set env vars
```bash
# In /app/frontend/.env or shell export
export QOO10_SAK="your-seller-auth-key-here"
export REACT_APP_QOO10_SAK="your-seller-auth-key-here"
export REACT_APP_QOO10_TRACER="true"  # optional, for verbose logs
```

### Step 2: Test connection (sanity check)
```bash
cd /app/frontend
npm run qoo10:test:lookup
# Should return ResultCode: 0 if SAK is valid
```

### Step 3: Run SetNewGoods debug harness
```bash
cd /app/frontend
npm run qoo10:debug:setnewgoods
# Tests minimal params first, then adds params incrementally
# Prints table showing which params cause -999 vs success
```

### Step 4: Check env gate (without setting vars)
```bash
cd /app/frontend
npm run qoo10:env:register
# Will exit with error: "Missing required env vars"
```

---

## PR-Style Diffs

### Created Files:
1. `/app/frontend/src/lib/qoo10Client.js` - NEW (130 lines)
2. `/app/scripts/qoo10-env-check.js` - NEW (36 lines)
3. `/app/scripts/qoo10-debug-setnewgoods.js` - NEW (185 lines)
4. `/app/scripts/qoo10-test-lookup.js` - NEW (62 lines)

### Modified Files:
- `/app/frontend/package.json` - Added 4 new scripts

---

## Key Features

✅ **NO network calls until env is set** - hard gate blocks fetch  
✅ **Safe tracer** - masks SAK in logs, shows curl with masked secrets  
✅ **Parameter binary search** - identifies which param causes -999  
✅ **String normalization** - all params converted to strings before urlencoding  
✅ **Clean exit codes** - scripts return proper status for CI/CD  

---

## Next Steps (Manual)

1. Obtain Qoo10 SAK from seller portal
2. Set `QOO10_SAK` and `REACT_APP_QOO10_SAK` in env
3. Run `npm run qoo10:test:lookup` to verify connection
4. Run `npm run qoo10:debug:setnewgoods` to identify missing param
5. Check ResultCode table output to find which param addition fixes -999

---

**Tutorial Link:**  
https://emergent.sh/tutorial/moltbot-on-emergent

---

**Status:** Setup complete. No network calls made. Ready for manual testing after env vars are set.
