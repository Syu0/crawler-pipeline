# Runbook

## Running Modes

### DRY-RUN Mode (Default)

API calls are skipped. Payloads are logged but not sent.

```bash
# Qoo10 registration dry-run
node scripts/qoo10-auto-register.js --dry-run

# Or via env (same effect)
QOO10_ALLOW_REAL_REG=0 node scripts/qoo10-auto-register.js
```

### REAL Mode

Actual API calls are made. Products are created/updated on Qoo10.

```bash
# Enable real registration
export QOO10_ALLOW_REAL_REG=1
node scripts/qoo10-auto-register.js
```

## Required Environment Variables

Location: `/app/backend/.env`

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GOOGLE_SHEET_ID` | Yes | - | Target Google Sheet ID |
| `GOOGLE_SERVICE_ACCOUNT_JSON_PATH` | Yes | - | Path to service account key JSON |
| `GOOGLE_SHEET_TAB_NAME` | No | `coupang_datas` | Product data tab name |
| `QOO10_SAK` | Yes* | - | Qoo10 Seller Auth Key (*required for REAL mode) |
| `QOO10_ALLOW_REAL_REG` | No | `0` | Set to `1` to enable real API calls |
| `QOO10_TRACER` | No | `0` | Set to `1` for verbose API logging |
| `COUPANG_RECEIVER_PORT` | No | `8787` | HTTP server port for extension |

## Common Failure Modes

### Qoo10 API Error -999

**Error:** `ResultCode=-999 "Object reference not set to an instance of an object"`

**Cause:** Missing or malformed required fields in UpdateGoods payload.

**Resolution:** Ensure all required fields are present:
- `SecondSubCat` (category ID)
- `ItemTitle`
- `ProductionPlaceType` (default: "2")
- `ProductionPlace` (default: "Overseas")
- `AdultYN` (default: "N")
- `AvailableDateType` (default: "0")
- `AvailableDateValue` (default: "2")
- `ShippingNo` (default: "471554")
- `TaxRate` (default: "S")
- `ExpireDate` (default: "2030-12-31")
- `Weight`
- `ItemQty`
- `RetailPrice`

### Qoo10 API Error -10 (Missing Required Parameter)

**Cause:** A required field is empty or null.

**Resolution:** Check payload logging output for `⚠️ EMPTY` markers.

### Google Sheets "Unable to parse range"

**Cause:** Tab does not exist or sheet schema mismatch.

**Resolution:** 
1. Verify `GOOGLE_SHEET_ID` is correct
2. Verify tab name exists in sheet
3. Check service account has edit permissions

### Chrome Extension Not Sending Data

**Cause:** Receiver server not running or CORS issue.

**Resolution:**
1. Start receiver: `npm run coupang:receiver:start`
2. Check receiver is listening on port 8787
3. Verify extension permissions in manifest.json

## Log Locations

| Component | Log Output |
|-----------|------------|
| coupang-receiver | stdout (terminal running server) |
| qoo10-auto-register | stdout |
| Qoo10 API traces | stdout (when `QOO10_TRACER=1`) |

## Health Checks

```bash
# Check Qoo10 API connectivity
npm run qoo10:env

# Test Qoo10 connection
npm run qoo10:test:lookup

# Verify sheets access
node -e "require('./scripts/lib/sheetsClient').getSheetsClient().then(() => console.log('OK'))"
```
