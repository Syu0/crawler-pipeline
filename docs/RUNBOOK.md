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
| `COUPANG_COOKIE` | Yes | - | Playwright 수집기용 쿠팡 인증 쿠키 (yamyam으로 갱신) |

## 자동 등록 파이프라인 운영

### 수동 실행 (현재 방식)

```bash
# 1. COLLECTED 상품을 PENDING_APPROVAL로 올림 (하루 MAX_DAILY_REGISTER개 한도)
npm run coupang:promote

# 2. Google Sheets에서 등록할 상품의 status를 REGISTER_READY로 변경 (수동 승인)

# 3. REGISTER_READY 상품 Qoo10 등록
npm run qoo10:auto-register
```

dry-run으로 먼저 확인:
```bash
npm run coupang:promote:dry   # 변경 없이 슬롯 계산 및 대상 목록 확인
npm run qoo10:auto-register:dry
```

### cron 자동화 (옵션)

Mac Mini에서 매일 오전 9시에 promote를 자동 실행하려면:

```bash
crontab -e
# 아래 줄 추가 (프로젝트 경로는 실제 경로로 변경)
0 9 * * * cd /path/to/crawler-pipeline && npm run coupang:promote >> logs/promote.log 2>&1
```

promote 후 수동 승인 없이 자동 등록까지 원한다면:

```bash
0 9 * * * cd /path/to/crawler-pipeline && npm run coupang:promote && npm run qoo10:auto-register >> logs/auto-register.log 2>&1
```

> **주의:** 자동 등록 시 config 시트의 `MAX_DAILY_REGISTER` 설정 확인 필수.

### config 키 초기화

```bash
npm run sheets:setup          # 누락된 키만 추가, 기존 값 유지
npm run sheets:setup:force    # 모든 기본값 덮어쓰기 — 값 초기화 주의
```

---

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

### 쿠키 만료로 Playwright 수집 실패

**Cause:** 쿠팡 인증 쿠키 만료 (Akamai 차단)

**Resolution:**
1. yamyam 크롬 익스텐션으로 쿠키 갱신
2. `.env`의 `COUPANG_COOKIE` 업데이트
3. 만료 D-3/D-0 이메일 알림 확인 (meaningful.jy@gmail.com)

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
