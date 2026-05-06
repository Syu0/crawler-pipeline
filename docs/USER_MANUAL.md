# User Manual

## Step-by-Step Operator Instructions

### 0. 매일 시작 절차

별도의 쿠키 수신 서버는 더 이상 필요 없다. yamyam 확장이 `~/Downloads/coupang_cookie.txt`에 직접 저장하고, `cookieStore.loadCookies()`가 mtime 비교로 자동 흡수한다.

Chrome은 Profile 1으로 쿠팡 로그인 상태를 유지해둔다 — `coupang:collect`/`coupang:discover`가 Browser Relay CLI로 attach.

> **참고**: `coupang:browser:start`(Playwright 데몬)는 `coupang:collect`/`coupang:discover`에 불필요. `stock:check` 등 Playwright를 직접 사용하는 스크립트를 돌릴 때에만 따로 실행.
> (이전 버전 문서는 "browser:start 2번째 실행"을 필수처럼 기술했으나, 2026-04-23 실측으로 파이프라인에 불필요함이 재확인되었다.)

운영 환경: **Mac Mini** (Tailscale Funnel로 대시보드와 연결됨)

---

### 1. 쿠팡 데이터 수집

#### Step 1-a: 쿠키 갱신 (필요 시)

1. Chrome에서 쿠팡 로그인
2. yamyam 확장 아이콘 클릭 → **🔑 쿠키 복사** 버튼
3. `~/Downloads/coupang_cookie.txt` 파일이 자동 생성됨 (덮어쓰기)
4. 다음 collect/discover 실행 시 `cookieStore.loadCookies()`가 mtime 비교로 자동 흡수
5. 만료 D-3 이내 텔레그램 알림 (`cron 08:00 cookie:check`) 수신 시 즉시 갱신

#### Step 1-b: 키워드 탐색 실행

```bash
# dry-run (Sheets 미저장)
npm run coupang:discover:dry

# 실제 탐색 + Sheets DISCOVERED 저장
npm run coupang:discover
```

#### Step 1-c: DISCOVERED → COLLECTED 수집

```bash
# dry-run
npm run coupang:collect:dry

# 실제 수집
npm run coupang:collect
```

### 2. Check coupang_datas Sheet Fields

After scraping, verify these columns are populated:

| Column | Description | Required for Qoo10 |
|--------|-------------|-------------------|
| `vendorItemId` | Coupang vendor item ID | Yes |
| `ItemTitle` | Product title | Yes |
| `ItemPrice` | Coupang price (KRW) | Yes |
| `StandardImage` | Main product image URL | Yes |
| `ItemDescriptionText` | Product description | Yes |
| `categoryId` | Coupang category ID | Yes |
| `categoryPath3` | Last 3 breadcrumb segments | For category mapping |
| `qoo10SellingPrice` | KRW input for JPY computation | **REQUIRED** |

### Pricing: ItemPrice (KRW) → qoo10SellingPrice (JPY)

시트의 `ItemPrice`(KRW)를 읽어 Qoo10 판매가(JPY)를 자동 계산한다.
계산 로직은 `backend/pricing/priceDecision.js`에 있으며 상수는 `backend/pricing/pricingConstants.js`에 정의된다.

**가격 계산 공식:**

```
baseCostJpy   = (ItemPrice_KRW + DOMESTIC_SHIPPING_KRW) / FX_JPY_TO_KRW + japanShippingJpy
requiredPrice = baseCostJpy / (1 - MARKET_COMMISSION_RATE - MIN_MARGIN_RATE)
targetPrice   = baseCostJpy * (1 + TARGET_MARGIN_RATE)
finalPrice    = Math.round(Math.max(requiredPrice, targetPrice))
```

**현재 상수값 (`pricingConstants.js`):**

| 상수 | 값 | 설명 |
|------|-----|------|
| `FX_JPY_TO_KRW` | `10` | 환율 (1 JPY = 10 KRW, 고정) |
| `DOMESTIC_SHIPPING_KRW` | `3000` | 국내 배송비 (KRW, 고정) |
| `MARKET_COMMISSION_RATE` | `0.10` | Qoo10 수수료율 (10%) |
| `TARGET_MARGIN_RATE` | `0.20` | 목표 마진율 (20%) |
| `MIN_MARGIN_RATE` | `0.25` | 최소 마진율 (25%) |

**`japanShippingJpy`:** `WeightKg` 컬럼 기준으로 `Txlogis_standard` 시트에서 동적 조회.

**STRICT REQUIREMENT:** `ItemPrice`(KRW)와 `WeightKg` 둘 다 필수.
- 둘 중 하나라도 없거나 `<= 0`이면 해당 행은 즉시 FAIL — API 호출 없음.
- 계산된 JPY는 `qoo10SellingPrice` 컬럼에 write-back됨 (API 성공 여부 무관).
- CREATE(SetNewGoods)와 UPDATE(UpdateGoods) 양쪽 모두 이 공식 적용.

> ⚠️ **상수 하드코딩 주의:** 환율/마진/수수료 변경 시 `pricingConstants.js`를 직접 수정해야 한다.
> 추후 `config` 시트 이관 예정 (CLAUDE.md §9-B 참조).

### 3. Trigger CREATE vs UPDATE

#### COLLECTED → PENDING_APPROVAL → REGISTER_READY

```bash
# COLLECTED 행을 일일 한도(MAX_DAILY_REGISTER) 내에서 PENDING_APPROVAL로 전환
npm run coupang:promote

# 시트에서 PENDING_APPROVAL → REGISTER_READY 수동 변경 후 등록 실행
```

#### CREATE Mode (New Products)

Products are created when:
- `status` = `REGISTER_READY`
- `qoo10ItemId` column is **empty**

Run:
```bash
# dry-run
npm run qoo10:register:dry

# 실제 등록 (QOO10_ALLOW_REAL_REG=1 필요)
npm run qoo10:register
```

After successful CREATE:
- `qoo10ItemId` is populated with the new Qoo10 item ID
- `status` → `REGISTERED`
- `registrationStatus` shows `SUCCESS` or `WARNING`

#### UPDATE Mode (Existing Products)

Products are updated when:
- `qoo10ItemId` column has a value
- `needsUpdate` column is set to `YES`

To trigger an update:
1. Set `needsUpdate` to `YES` in the sheet
2. Run:
   ```bash
   npm run qoo10:register
   ```

After successful UPDATE:
- `needsUpdate` is reset to `NO`
- `changeFlags` is cleared to `''`
- `registrationStatus` shows result

### 4. Interpret Result Columns

| Column | Values | Meaning |
|--------|--------|---------|
| `registrationStatus` | `SUCCESS` | Product created/updated successfully |
| | `WARNING` | Success but using FALLBACK category |
| | `FAILED` | API error occurred |
| | `DRY_RUN` | Dry-run mode, no API call made |
| `registrationMode` | `REAL` | Actual API call was made |
| | `DRY_RUN` | Simulated only |
| `registrationMessage` | (text) | Success message or error details |
| `qoo10ItemId` | (ID) | Qoo10 item ID after successful CREATE |
| `qoo10SellingPrice` | (number) | Calculated selling price in JPY |
| `jpCategoryIdUsed` | (ID) | Qoo10 category ID used |
| `categoryMatchType` | `MANUAL` | Used manually mapped category |
| | `AUTO` | Used auto-matched category |
| | `FALLBACK` | Used default fallback category |
| `needsUpdate` | `YES` | Row is queued for UPDATE |
| | `NO` | No update pending |
| `changeFlags` | `PRICE_UP` | Price increased since last scrape |
| | `PRICE_DOWN` | Price decreased |
| | `OPTIONS_CHANGED` | Product options changed |

### 5. Category Mapping

Category resolution priority:
1. **MANUAL**: User-defined mapping in `category_mapping` sheet
2. **AUTO**: Keyword-based matching against `japan_categories`
3. **FALLBACK**: Default category ID `320002604`

To add a manual mapping:
1. Open `category_mapping` sheet
2. Find the row with matching `coupangCategoryKey`
3. Set `jpCategoryId` to desired Qoo10 category
4. Set `matchType` to `MANUAL`

### 6. Common Commands

```bash
# 브라우저 상태 확인
npm run coupang:browser:status

# 키워드 탐색 (dry-run)
npm run coupang:discover:dry

# 수집 (dry-run)
npm run coupang:collect:dry

# promote: COLLECTED → PENDING_APPROVAL (dry-run)
npm run coupang:promote:dry

# 재고 모니터링 (dry-run, 3건 제한)
npm run stock:check:test

# 등록 (dry-run)
npm run qoo10:register:dry

# 환경변수 확인
npm run qoo10:env

# Google Sheets 스키마 초기화
npm run sheets:setup
```
