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

### 전체 파이프라인 실행 순서

각 단계: dry-run 확인 후 real 실행.

| 단계 | 명령어 | 성공 기준 |
|------|--------|-----------|
| 1. 키워드 탐색 | `npm run coupang:discover` | DISCOVERED 행 생성 |
| 2. 상세 수집 | `npm run coupang:collect` | COLLECTED 전이 |
| 3. 등록 대기열 | `npm run coupang:promote` | PENDING_APPROVAL 전이 |
| 4. 일괄 승인 | `npm run coupang:approve` | REGISTER_READY 전이 |
| 5. Qoo10 등록 | `npm run qoo10:auto-register` | REGISTERED + qoo10ItemId |
| 6. 재고 모니터링 | `npm run stock:check` | LIVE 전이 |

### 수동 실행 (현재 방식)

```bash
# 1. COLLECTED → PENDING_APPROVAL
npm run coupang:promote

# 2. PENDING_APPROVAL → REGISTER_READY (일괄 승인)
npm run coupang:approve

# 3. REGISTER_READY → Qoo10 등록
npm run qoo10:auto-register
```

dry-run 확인:
```bash
npm run coupang:promote:dry
npm run coupang:approve:dry
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

자동 갱신 (정상 운영 시):
- 매일 아침 cron이 OpenClaw Browser Relay를 통해 자동 추출 → POST /cookie
- 결과는 텔레그램으로 수신
  - ✅ 성공: "쿠키 갱신 완료" → 파이프라인 자동 시작
  - ❌ 실패: "쿠키 갱신 실패" → 아래 수동 절차 진행

수동 갱신 (자동 갱신 실패 시):
1. yamyam 크롬 익스텐션으로 쿠키 수동 갱신
2. 만료 D-3/D-0 이메일 알림 확인 (meaningful.jy@gmail.com)

## Log Locations

| Component | Log Output |
|-----------|------------|
| coupang-receiver | stdout (terminal running server) |
| qoo10-auto-register | stdout |
| Qoo10 API traces | stdout (when `QOO10_TRACER=1`) |

---

## 데몬 타임아웃 후 수집 재개 절차

### 자동 감지 시 (EXIT_REASON: DAEMON_EXPIRING)

터미널에 아래 출력이 나타난 경우:
```
EXIT_REASON: DAEMON_EXPIRING
재개 명령: npm run coupang:browser:start && npm run coupang:collect
```

1. **10분 쿨다운 대기** (Akamai 회피 — 연속 Playwright 실행 금지)
2. `npm run coupang:browser:start`
3. `npm run coupang:collect`
   - DISCOVERED 상태인 행이 자동으로 이어서 처리됨
   - 이미 COLLECTED된 행은 건너뜀

### HARD_BLOCK 발생 시

블록 감지 즉시 `backend/.browser-block-state.json`에 쿨다운(1시간)이 기록된다.
쿨다운 중 `npm run coupang:collect` 실행 시 즉시 종료되며 잔여시간이 출력된다.

1. **1시간 대기** (cooldownUntil 시각까지 — 쿨다운 완료 시 자동 CLEAR)
2. 텔레그램에서 쿠키 갱신 결과 확인
   - 자동 갱신 성공 시: 그대로 진행
   - 자동 갱신 실패 시: OpenClaw Browser Relay로 수동 트리거
     `openclaw: 쿠팡 탭 쿠키 재추출 후 POST /cookie`
3. `npm run coupang:browser:stop`
4. `npm run coupang:browser:start`
5. `npm run coupang:collect`

강제 쿨다운 해제:
```bash
# backend/.browser-block-state.json 삭제
rm backend/.browser-block-state.json
```

### daemon 상태 확인

```bash
npm run coupang:browser:status
```

출력 예시:
```
[BrowserStatus] 상태 확인 중...
  상태:        ✓ ALIVE
  collectSafe: ✓ 수집 가능
  PID:         12345
  Uptime:      12분 30초
  잔여시간:    47분 30초
  WS endpoint: http://localhost:9222
```

> `collectSafe: ✗` → HARD_BLOCK 쿨다운 중. 수집 재개 불가.
> `collectSafe: ✓` → 수집 가능.

## Mac Mini 재세팅 시 수동 작업

> Mac Mini를 새로 설치하거나 환경을 재구성할 때 아래 항목을 수동으로 등록해야 한다.

- **Chrome launchd 등록** (부팅 시 CDP Chrome 자동 실행)
- **crontab 등록** (매일 쿠키 자동 갱신)

→ `docs/coupang-cookie-refresh-v2.md` 지침 참고

---

### 매일 시작 절차 (순서 중요)

```bash
# 1. yamyam 쿠키 수신 서버 (먼저 실행)
npm run backend:start

# 2. Playwright 브라우저 데몬 (이후 실행)
npm run coupang:browser:start
```

> **주의:** 2번을 먼저 실행하거나 1번 없이 실행하면 warming 단계에서 즉시 블록됨.

---

## Health Checks

```bash
# Check Qoo10 API connectivity
npm run qoo10:env

# Test Qoo10 connection
npm run qoo10:test:lookup

# Verify sheets access
node -e "require('./scripts/lib/sheetsClient').getSheetsClient().then(() => console.log('OK'))"
```
