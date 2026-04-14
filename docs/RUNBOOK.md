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
| `COUPANG_COOKIE` | Yes | - | Playwright 수집기용 쿠팡 인증 쿠키 (`npm run cookie:refresh`로 갱신) |

## ⚠️ 시트 운영 주의사항

### EXT_ 상품 (비쿠팡 기존 Qoo10 상품)

`coupang_datas` 시트에 `vendorItemId`가 `EXT_`로 시작하는 행이 존재한다.

**배경:** "Qoo10 기존 운영 상품 → coupang_datas 역수입" 작업(`qoo10-import-existing-goods.js`)으로 추가된 행이다.
Qoo10에서 직접 운영 중이던 상품 중 쿠팡과 연결되지 않은 상품은 `EXT_{qoo10ItemId}` 형식의 가상키로 등록된다.

**현재 상태 (2026-04-10 기준):** 역수입 작업 진행 중. 운영 지침 미확정.

**지금 할 일:** **무시해도 된다.** 일반 파이프라인(discover → collect → register)은 EXT_ 행을 건드리지 않는다.
역수입 작업 완료 후 EXT_ 상품 전용 운영 지침이 이 섹션에 추가될 예정이다.

> 참고: EXT_ 상품에 대해 `changeFlags=IMAGE` 또는 `DESC`를 설정해도 `qoo10-auto-register.js`가 자동 skip한다.

---

## 자동 등록 파이프라인 운영

### 전체 파이프라인 실행 순서

Playwright를 사용하는 단계(1·2·6)는 dry-run 생략. 시트/API를 사용하는 단계(3·4·5)는 dry-run 먼저.

| 단계 | 명령어 | dry-run | 이유 |
|------|--------|---------|------|
| 1. 키워드 탐색 | `npm run coupang:discover` | ❌ 생략 | Playwright 실행 = 블록 위험 |
| 2. 상세 수집 | `npm run coupang:collect` | ❌ 생략 | Browser Relay CLI (`openclaw browser --browser-profile chrome`) 사용 — Chrome + 쿠팡 탭 필수, dry-run도 실제 fetch 발생 |
| 3. 등록 대기열 | `npm run coupang:promote` | ✅ 먼저 | 시트 읽기/쓰기만, 대상 수 확인 |
| 4. 일괄 승인 | `npm run coupang:approve` | ✅ 먼저 | 승인 대상 확인 |
| 5. Qoo10 등록 | `npm run qoo10:auto-register` | ✅✅ 필수 | JPY 가격·카테고리 확인 필수 |
| 6. 재고 모니터링 | `npm run stock:check` | ❌ 생략 | Playwright 실행 = 블록 위험 |

### 수동 실행 (현재 방식)

```bash
# 1. COLLECTED → PENDING_APPROVAL
npm run coupang:promote:dry
npm run coupang:promote

# 2. PENDING_APPROVAL → REGISTER_READY (일괄 승인)
npm run coupang:approve:dry
npm run coupang:approve

# 3. REGISTER_READY → Qoo10 등록
npm run qoo10:auto-register:dry
npm run qoo10:auto-register
```

### 기존 등록 상품 업데이트 (needsUpdate + changeFlags)

이미 Qoo10에 등록된 상품(`qoo10ItemId` 있음)을 부분 업데이트할 때 사용한다.

**시트에서 설정:**
1. 대상 행의 `needsUpdate` 컬럼 → `YES`
2. `changeFlags` 컬럼 → 아래 플래그 입력

| 플래그 | 호출 API | 설명 |
|--------|----------|------|
| `REFRESH` (기본값, 빈값과 동일) | SetGoodsPriceQty + EditGoodsImage + UpdateGoods(카테고리) | 가격·대표이미지·카테고리 전체 갱신 |
| `REBUILD` | REFRESH 전체 + 타이틀 재번역 + 상세 HTML 재생성 | 전체 갱신 (유료 OpenRouter 포함) |
| `PRICE` | SetGoodsPriceQty | 가격·재고 수량만 |
| `IMAGE` | EditGoodsImage + EditGoodsMultiImage | 대표이미지 + 슬라이더 이미지 |
| `CATEGORY` | UpdateGoods | 카테고리 재resolve → 적용. category_mapping 시트에 MANUAL 매핑 등록 후 사용 |
| `TITLE` | UpdateGoods | 일본어 타이틀 재번역 → jpTitle write-back + 적용 |
| `DESC` | EditGoodsContents | 일본어 상세페이지 재생성 → 적용 |

복수 플래그는 파이프(`|`) 구분: 예) `PRICE|IMAGE`, `TITLE|DESC`

> `REFRESH` / `REBUILD`는 단독 사용. 다른 플래그와 조합 불가.

**실행:**
```bash
npm run qoo10:auto-register:dry   # 대상 행·플래그 확인
npm run qoo10:auto-register       # 실제 적용
```

성공 후 `needsUpdate`는 자동으로 `NO`로 초기화된다.

**예시: 카테고리 수동 수정 후 재적용**
1. `category_mapping` 시트에서 해당 카테고리를 MANUAL 타입으로 수정
2. 대상 행: `needsUpdate=YES`, `changeFlags=CATEGORY`
3. `npm run qoo10:auto-register:dry` → 카테고리 resolve 결과 확인
4. `npm run qoo10:auto-register` → 적용

---

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
- `ProductionPlace` (default: "KR")
- `AdultYN` (default: "N")
- `AvailableDateType` (default: "0")
- `AvailableDateValue` (default: "3")
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
- 매일 아침 cron이 `npm run cookie:refresh` 자동 실행
- 결과는 텔레그램으로 수신
  - ✅ 성공: "쿠키 갱신 완료" → 파이프라인 자동 시작
  - ❌ 실패: "쿠키 갱신 실패" → 아래 수동 절차 진행

수동 갱신 (자동 갱신 실패 시):
```bash
npm run cookie:refresh
# 또는 강제 갱신:
npm run cookie:refresh:force
```

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
2. `npm run cookie:refresh`
   - 실패 시: `npm run cookie:refresh:force`
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
# 1. 쿠키 수신 서버
npm run backend:start

# 2. 쿠키 갱신 (만료 시에만, 유효하면 자동 skip)
npm run cookie:refresh

# 3. Playwright 브라우저 데몬 — stock:check 사용 시에만 필요
npm run coupang:browser:start
```

### 15:00 자동 파이프라인 — 브라우저 준비 절차

15:00 크론 시작 시 judy(OpenClaw)가 텔레그램 그룹 (`crawler-pipeline`, chatId: `-5221359008`)으로 알림을 보낸다.

**알림 수신 시 아가씨가 할 일:**
1. Chrome에서 쿠팡 탭 열기 (https://www.coupang.com)
2. 쿠팡 로그인 완료 후 채팅방에 "완료" 등 응답

judy는 브라우저 연결을 확인한 뒤 자동으로 수집을 시작한다.

**응답 없을 경우:**
- 최대 30분(5분 간격 × 6회) 재확인
- 30분 후에도 연결 실패 시 수집 없이 종료 (20:00 폴백 크론이 Qoo10 등록만 진행)

**연결 확인 명령:**
```bash
openclaw browser --browser-profile chrome tabs
# 출력에 coupang.com 탭이 있으면 수집 시작
```

> 모든 작업 알림/결과는 텔레그램 crawler-pipeline 그룹 채팅방 (chatId: `-5221359008`)으로 전송된다.

> ⚠️ **`coupang:collect` / `coupang:collect:one` 전 필수 조건:**
> `coupangApiClient.js`는 **Browser Relay CLI** (`openclaw browser --browser-profile chrome`)를 사용한다.
> Chrome에 `--browser-profile chrome`으로 연결 가능한 상태여야 하며,
> 쿠팡 로그인 탭이 열려있어야 한다.
>
> 연결 확인:
> ```bash
> openclaw browser --browser-profile chrome tabs
> # 출력에 쿠팡 탭(coupang.com)이 보여야 함
> ```
>
> **`coupang:browser:start` (Playwright 데몬)는 `coupang:collect`와 무관하다.**
> `coupang-stock-monitor.js`(stock:check)만 Playwright를 사용한다.

---

## 단일 상품 강제 재수집

특정 vendorItemId 행을 status 무관 강제 재수집할 때 사용한다.
Browser Relay attach 상태에서 실행.

```bash
npm run coupang:collect:one -- --vendorItemId=<vendorItemId>
# 예:
npm run coupang:collect:one -- --vendorItemId=86533289539
```

- 시트에서 해당 행을 찾아 `collectProductData` 실행
- 성공 시 status → `COLLECTED`, 수집 필드 전체 업데이트
- HARD_BLOCK 감지 시 `setHardBlocked()` + 이메일 알림 후 종료

---

## Common Failure Modes — Browser Relay

### `No pages available` / `GatewayClientRequestError` 오류

**증상:** `npm run coupang:collect` 또는 `coupang:collect:one` 실행 시 모든 행에서 즉시 실패

**원인:** `openclaw browser --browser-profile chrome`으로 연결 가능한 Chrome 탭이 없음

**해결:**
1. Chrome 실행 확인 (Mac Mini에서 Chrome이 열려있어야 함)
2. Chrome에서 쿠팡 로그인 탭 열기 (https://www.coupang.com)
3. 연결 확인: `openclaw browser --browser-profile chrome tabs`
4. `npm run coupang:collect` 재실행

> **참고:** `coupang:browser:start` (Playwright 데몬)는 이 문제와 무관하다. 이 오류는 Browser Relay CLI 연결 실패다.

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
