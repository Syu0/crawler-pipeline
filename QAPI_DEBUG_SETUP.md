# Qoo10 QAPI Debug Setup

## Overview
Node-side debugging harness for Qoo10 Japan QAPI `ItemsBasic.SetNewGoods` returning ResultCode=-999.

**Key points:**
- All Qoo10 calls happen **server-side** (Node scripts), NOT in browser
- Secrets stored in `backend/.env` (auto-loaded by scripts)
- Single env var: `QOO10_SAK` (Seller Auth Key)
- **Cross-platform** - works on Windows, macOS, Linux
- NO network calls until env is set
- Parameter binary-search to identify missing/invalid params

---

## Quick Start

### 1. Pull latest code
```bash
git checkout emergent && git pull
```

### 2. Install dependencies
```bash
cd /app
npm install
```

### 3. Create backend/.env
```bash
cp backend/.env.example backend/.env
# Edit backend/.env and add your QOO10_SAK
```

Example `backend/.env`:
```bash
QOO10_SAK=your-seller-auth-key-here
QOO10_TRACER=0
```

### 4. Run sanity check
```bash
npm run qoo10:test:lookup
# Expected: ResultCode: 0, ResultMsg: "Success"
```

### 5. Run debug harness
```bash
npm run qoo10:debug:setnewgoods
# Prints table showing which params cause -999 vs success
```

---

## Files

### 1. `/app/scripts/lib/qoo10Client.js`
Core Qoo10 QAPI client (Node HTTPS)
- **Auto-loads** `backend/.env` at startup
- **Env gate**: blocks fetch unless `QOO10_SAK` set
- **Tracer**: set `QOO10_TRACER=1` in `backend/.env` to log method/URL/headers (SAK masked)/body/response
- **Encoding**: all params normalized to strings, UTF-8 charset
- Functions: `qoo10PostMethod()`, `testQoo10Connection()`, `setNewGoods()`

### 2. `/app/scripts/qoo10-env-check.js`
- **Auto-loads** `backend/.env` at startup
- Validates `QOO10_SAK` before tests run
- Exits with error if missing
- **Cross-platform** - no shell-specific syntax

### 3. `/app/scripts/qoo10-test-lookup.js`
Sanity check: tests `ItemsLookup.GetSellerDeliveryGroupInfo` to verify SAK works.

### 4. `/app/scripts/qoo10-debug-setnewgoods.js`
**Parameter binary search harness**
- Starts with minimal SetNewGoods params
- Adds optional/suspicious params incrementally (StandardImage, ItemDescription, TaxRate, etc.)
- Prints ResultCode/Msg table

### 5. `/app/backend/.env.example`
Template for secrets (copy to `backend/.env` and fill in)

---

## npm Scripts (run from repo root `/app`)

**Cross-platform compatible** - works on Windows (Git Bash/MINGW/PowerShell), macOS, Linux

```bash
npm run qoo10:env                 # Check QOO10_SAK is set
npm run qoo10:test:lookup         # Sanity check connection
npm run qoo10:debug:setnewgoods   # Run param binary search
```

All scripts include automatic env validation before running.

---

## Environment Variables

All env vars are read from `backend/.env` (auto-loaded by scripts).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `QOO10_SAK` | Yes | - | Seller Auth Key from Qoo10 seller portal |
| `QOO10_TRACER` | No | `0` | Set to `1` for verbose request/response logging |

**No manual export needed** - scripts auto-load `backend/.env`.

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
✅ **Auto-load secrets** - reads `backend/.env` automatically  
✅ **Cross-platform** - works on Windows/macOS/Linux without shell-specific syntax  
✅ **Single env var** - `QOO10_SAK` for all scripts  
✅ **Env gate** - NO network calls until SAK is set  
✅ **Safe tracer** - masks SAK in logs, shows curl with masked secrets  
✅ **UTF-8 encoding** - Content-Type includes charset  
✅ **String normalization** - all params converted to strings before urlencoding  
✅ **Binary search** - identifies which param fixes -999  

---

## Platform Compatibility

### Windows (Git Bash/MINGW)
```bash
npm run qoo10:test:lookup
npm run qoo10:debug:setnewgoods
```

### Windows (PowerShell)
```powershell
npm run qoo10:test:lookup
npm run qoo10:debug:setnewgoods
```

### macOS/Linux
```bash
npm run qoo10:test:lookup
npm run qoo10:debug:setnewgoods
```

All platforms use the same commands - no `MODE=...` env assignment needed.

---

## Troubleshooting

**"QOO10_SAK not set"**  
→ Ensure `backend/.env` exists and contains `QOO10_SAK=your-key`

**"Connection failed" on lookup test**  
→ Verify SAK is valid and not expired

**All tests return -999**  
→ Check Qoo10 seller portal for required account settings (e.g., shipping template, category permissions)

**Windows error: "잘못된 매개 변수입니다"**  
→ Fixed in latest version - pull latest code and use `npm run qoo10:debug:setnewgoods` (no MODE=... needed)

---

## Git Safety

`backend/.env` is excluded from git via `.gitignore` (pattern: `*.env`).  
Use `backend/.env.example` as template for other developers.

---

**Tutorial:**  
https://emergent.sh/tutorial/moltbot-on-emergent

