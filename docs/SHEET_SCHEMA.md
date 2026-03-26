# Google Sheet Schema

This document defines the schema for the Google Sheets used in the Coupang-to-Qoo10 pipeline.

> **Status**: IMPLEMENTED. Step 2 scraper writes to both tabs.

---

## Overview

The Google Sheet serves as the central data store between:
- **Step 2**: Coupang scraper (writes product data + category dictionary)
- **Step 3**: Qoo10 registration (reads product data, writes Qoo10 IDs)

---

## Sheet Tabs

| Tab Name | Purpose |
|----------|---------|
| `coupang_datas` | Product data storage |
| `config` | 런타임 설정값 (코드 수정 없이 시트에서 변경) |
| `keywords` | 탐색 키워드 목록 |
| `coupang_categorys` | Category dictionary for future mapping |
| `japan_categories` | Full JP category list from Qoo10 API |
| `category_mapping` | KR→JP category mapping (manual + auto) |
| `Txlogis_standard` | Japan shipping fee by weight range |

---

## Tab: `config`

런타임 설정값 저장. 코드 수정 없이 시트에서 변경 가능. `setup-sheets.js`로 누락 키 자동 추가.

| Column | Header | Description |
|--------|--------|-------------|
| A | `key` | 설정 키 이름 |
| B | `value` | 설정값 (문자열) |
| C | `memo` | 설명 |

### 현재 키 목록

| Key | 기본값 | 설명 |
|-----|--------|------|
| `FILTER_PRICE_KRW_MAX` | `150000` | 관세 면제 기준 최대가 (KRW). 이 값 초과 상품은 수집 제외 |
| `EXCLUDED_CATEGORY_KEYWORDS` | `의약품,건강,...` | 쉼표 구분. 카테고리명에 포함 시 수집 제외 |
| `MAX_DAILY_REGISTER` | `10` | 1회 promote 실행당 PENDING_APPROVAL로 올릴 최대 상품 수 |
| `MAX_DISCOVER_PAGES` | `1` | 키워드 탐색 시 쿠팡 검색 페이지 수 (최대 5) |
| `MAX_COLLECT_PER_DAY` | `10` | 하루 최대 수집 상품 수 (안전장치 — 이 값 초과 불가) |

**초기화 명령어:**
```bash
npm run sheets:setup           # 누락된 키만 추가, 기존 값 유지
npm run sheets:setup:force     # 모든 기본값 덮어쓰기
```

---

## Tab: `keywords`

탐색 대상 키워드 목록. `ACTIVE` 상태인 키워드만 수집 시 사용됨.

| Column | Header | Description |
|--------|--------|-------------|
| A | `keyword` | 검색 키워드 |
| B | `status` | `ACTIVE` \| `INACTIVE` |
| C | `lastRunAt` | 마지막 탐색 실행 시각 (ISO datetime) |
| D | `memo` | 메모 |

---

## Tab: `Txlogis_standard`

Defines Japan shipping fees (JPY) by weight range. Used for dynamic pricing calculation.

| Column | Header Name | Type | Description |
|--------|-------------|------|-------------|
| A | `startWeightKg` | number | Start of weight range (inclusive) |
| B | `endWeightKg` | number | End of weight range (inclusive) |
| C | `feeJpy` | number | Shipping fee in JPY |

**Header Detection:**
- Column names are detected dynamically by header patterns
- Recognized patterns: `start/min`, `end/max`, `fee/jpy/price/cost`

**Lookup Logic:**
1. Load all rows into cache (once per run)
2. For each product, find range where `start <= WeightKg <= end`
3. Return corresponding `feeJpy`
4. If no match: FAIL the row

**Example Data:**

| startWeightKg | endWeightKg | feeJpy |
|---------------|-------------|--------|
| 0 | 0.5 | 500 |
| 0.5 | 1 | 800 |
| 1 | 2 | 1200 |
| 2 | 5 | 2000 |

---

## Tab: `coupang_categorys`

Category dictionary accumulated from scraped products. Used for future Qoo10 category mapping.

| Column | Header Name | Type | Description |
|--------|-------------|------|-------------|
| A | `coupangCategoryId` | string | **PRIMARY KEY** - Coupang category ID from URL |
| B | `depth2Path` | string | Last 2 breadcrumb segments (e.g., "사과 > 청송사과") |
| C | `depth3Path` | string | Last 3 breadcrumb segments (e.g., "과일 > 사과 > 청송사과") |
| D | `rootName` | string | First segment of depth3Path |
| E | `parentName` | string | Second-to-last segment of depth3Path |
| F | `leafName` | string | Last segment (most specific category) |
| G | `firstSeenAt` | ISO datetime | First time this category was encountered |
| H | `lastSeenAt` | ISO datetime | Most recent encounter |
| I | `usedCount` | number | Count of products using this category |

### Category Upsert Logic

1. Extract `categoryId` from product URL query string
2. Extract breadcrumb segments from page DOM
3. If both exist:
   - **New category**: Insert row with `usedCount: 1`
   - **Existing category**: Update `lastSeenAt`, increment `usedCount`

### Example Row

| coupangCategoryId | depth2Path | depth3Path | rootName | parentName | leafName | firstSeenAt | lastSeenAt | usedCount |
|-------------------|------------|------------|----------|------------|----------|-------------|------------|-----------|
| 317679 | 사과 > 청송사과 | 과일 > 사과 > 청송사과 | 과일 | 사과 | 청송사과 | 2025-02-09T07:00:00Z | 2025-02-09T08:30:00Z | 5 |

---

## Tab: `coupang_datas`

> **SSOT**: `backend/coupang/sheetSchema.js` — 이 문서는 사람이 읽는 참조용.
> 컬럼 순서/추가 시 `sheetSchema.js` 를 먼저 수정하고 `npm run sheets:setup` 으로 시트 재초기화.

총 37컬럼. 그룹별로 헤더 행에 배경색이 적용된다.

### 그룹 1 — [C] Coupang 수집 (하늘색, A–U)

| # | 컬럼명 | 타입 | 설명 |
|---|--------|------|------|
| A | `vendorItemId` | string | **PK** (URL 파라미터) |
| B | `itemId` | string | Fallback key |
| C | `coupang_product_id` | string | 상품 ID (URL path) |
| D | `categoryId` | string | 카테고리 ID (URL에서만 추출) |
| E | `ProductURL` | string | 원본 쿠팡 URL |
| F | `ItemTitle` | string | 상품명 |
| G | `ItemPrice` | number | 쿠팡 판매가 (KRW, 정수) |
| H | `StandardImage` | string | 대표 이미지 (`thumbnails/...` normalized) |
| I | `ExtraImages` | JSON string | 추가 이미지 배열 |
| J | `WeightKg` | string | 무게 (기본값 `"1"`) |
| K | `Options` | JSON string | 옵션 (현재 null) |
| L | `ItemDescriptionText` | string | 상세 설명 (plain text) |
| M | `DetailImages` | JSON string | 상세페이지 이미지 URL 배열 |
| N | `OptionType` | string | NONE \| SIZE \| COLOR \| CUSTOM \| MULTI |
| O | `OptionsRaw` | JSON string | 전체 옵션 데이터 (axes 배열) |
| P | `StockStatus` | string | IN_STOCK \| LOW_STOCK \| OUT_OF_STOCK |
| Q | `StockQty` | number/null | 잔여수량 (표시될 때만) |
| R | `ReviewCount` | number | 리뷰 건수 |
| S | `ReviewAvgRating` | number | 평균 별점 (5점 만점) |
| T | `ProductAttributes` | JSON string | 상품 속성 {key:value} |
| U | `CollectedPhases` | string | 완료된 Phase 목록 (예: "1,2,3") |

### 그룹 2 — [Q] Qoo10 등록 (연보라, V–AH)

| # | 컬럼명 | 타입 | 설명 |
|---|--------|------|------|
| V | `qoo10SellingPrice` | number | 판매가 (JPY, 등록 전 계산 후 write-back) |
| W | `qoo10ItemId` | string | Qoo10 ItemCode |
| X | `qoo10SellerCode` | string | 사용된 SellerCode |
| Y | `jpCategoryIdUsed` | string | Qoo10 카테고리 ID |
| Z | `categoryMatchType` | string | MANUAL \| AUTO \| FALLBACK |
| AA | `categoryMatchConfidence` | number | 매핑 신뢰도 (0–1, AUTO only) |
| AB | `coupangCategoryKeyUsed` | string | 카테고리 매핑 key (normalized) |
| AC | `registrationMode` | string | DRY_RUN \| REAL |
| AD | `registrationStatus` | string | SUCCESS \| WARNING \| FAILED \| DRY_RUN |
| AE | `registrationMessage` | string | 상태 메시지 |
| AF | `lastRegisteredAt` | ISO datetime | 마지막 등록 시각 |
| AG | `needsUpdate` | string | YES \| NO |
| AH | `changeFlags` | string | PRICE_UP 등 |

### 그룹 3 — [SYS] 시스템 (연노랑, AI–AK)

| # | 컬럼명 | 타입 | 설명 |
|---|--------|------|------|
| AI | `status` | string | 파이프라인 상태 ENUM (CLAUDE.md 참고) |
| AJ | `updatedAt` | ISO datetime | 마지막 수집/수정 시각 |
| AK | `errorMessage` | string | 에러 메시지 (ERROR 상태 시) |

---

## Qoo10 Registration Output Fields

These fields are written back during Qoo10 registration:

| Field | Description |
|-------|-------------|
| `qoo10SellingPrice` | Computed JPY (written back pre-API, regardless of API success) |
| `qoo10ItemId` | ItemCode or ItemNo from Qoo10 API response |
| `lastRegisteredAt` | Timestamp of last registration attempt (ISO 8601) |

**Pricing Computation:**
- `ItemPrice` (KRW) is required as cost input
- `WeightKg` is required for Japan shipping fee lookup from `Txlogis_standard`
- Formula: `baseCostJpy = (ItemPrice + DOMESTIC_SHIPPING_KRW) / FX_JPY_TO_KRW + japanShippingJpy`
- Then: `requiredPrice = baseCostJpy / (1 - commission - minMargin)`
- And: `targetPrice = baseCostJpy * (1 + targetMargin)`
- Final: `Math.round(Math.max(requiredPrice, targetPrice))`
- **STRICT:** Both `ItemPrice` and `WeightKg` are REQUIRED. If missing/invalid, registration FAILS.
- Computed JPY is written back to `qoo10SellingPrice` **before** API call.

**Rules:**
- `qoo10SellingPrice` is overwritten with computed JPY on each registration attempt
- `qoo10ItemId` is never overwritten if already exists
- Rows with existing `qoo10ItemId` are skipped for CREATE (but processed for UPDATE)

---

## Field Rules

### Tier-1 Required Fields

| Field | Rule |
|-------|------|
| `categoryId` | Extract ONLY from URL query string. Do NOT parse HTML. |
| `ItemPrice` | Scrape displayed price, convert "5,800원" → 5800 (integer) |
| `WeightKg` | **FIXED to 1**. No scraping. No inference. |

### Tier-2 Fields

| Field | Rule |
|-------|------|
| `Options` | Single option type only (SIZE OR COLOR). Store as JSON. |
| `ItemDescriptionText` | Plain text only. Remove all images and HTML tags. |
| `ProductURL` | Store the full Coupang URL as-is. |

### Out of Scope
- Thumbnail gallery images (`<div class="twc-w-[70px]...">`)
- Any Tier-3 image scraping

---

## StandardImage / ExtraImages URL 규칙

풀 URL을 그대로 저장한다.

- `https://thumbnail.coupangcdn.com/...` → 그대로 저장
- `//thumbnail.coupangcdn.com/...` → `https://thumbnail.coupangcdn.com/...` 으로 변환 후 저장

> 이전 방식(thumbnails/... 상대경로 저장)은 폐기됨.
> Qoo10 payload 빌드 시 URL 변환이 필요하면 payloadGenerator.js에서 처리한다.

---

## Weight Conversion Rules

| Input Pattern | Output (Kg) |
|---------------|-------------|
| `250g` | `0.25` |
| `1.5kg` | `1.5` |
| `1kg 500g` | `1.5` |
| No weight found | `1` (default) |

---

## Upsert Logic

1. **Primary key**: `vendorItemId`
2. **Fallback key**: `itemId` (if vendorItemId is empty)
3. **Behavior**:
   - If key exists: UPDATE the row
   - If key not found: APPEND new row
4. **Timestamps**:
   - `collected_at_iso`: Set only on first insert
   - `updated_at_iso`: Updated on every upsert

---

## Column Mapping to Qoo10 API

| Sheet Column | Qoo10 Parameter | Notes |
|--------------|-----------------|-------|
| `ItemTitle` | `ItemTitle` | Direct mapping |
| `ItemPrice` | `ItemPrice` | Convert KRW → JPY if needed |
| `StandardImage` | `StandardImage` | Prepend CDN prefix |
| `ExtraImagesJson` | `ExtraImages` | Parse JSON array |
| `ItemDescriptionHtml` | `ItemDescription` | Direct mapping |
| `WeightKg` | `Weight` | Qoo10 expects Kg |
| `SecondSubCat` | `SecondSubCat` | Resolved via categoryResolver |

---

## Tab: `japan_categories`

Full JP category list from Qoo10 API (`CommonInfoLookup.GetCatagoryListAll`).

| Column | Type | Description |
|--------|------|-------------|
| `jpCategoryId` | string | **PRIMARY KEY** - Qoo10 JP category ID |
| `parentJpCategoryId` | string | Parent category ID |
| `depth` | number | 1=root, 2=mid, 3=leaf... |
| `name` | string | Category name |
| `fullPath` | string | Full path ("Top > Mid > Leaf") |
| `sortOrder` | string | API-provided sort order |
| `isLeaf` | boolean | true if no children |
| `updatedAt` | ISO datetime | Sync timestamp |

**Sync Command**: `npm run qoo10:sync:japan-categories`

---

## Tab: `category_mapping`

KR(Coupang) → JP(Qoo10) category mapping table. **Keyed by normalized categoryPath3**.

| Column | Type | Description |
|--------|------|-------------|
| `coupangCategoryKey` | string | **PRIMARY KEY** - Normalized categoryPath3 |
| `coupangPath2` | string | Last 2 breadcrumb segments |
| `coupangPath3` | string | Original path3 before normalization |
| `jpCategoryId` | string | Resolved JP category ID |
| `jpFullPath` | string | JP category full path |
| `matchType` | string | MANUAL, AUTO, or FALLBACK |
| `confidence` | number | 0-1 confidence score (AUTO only) |
| `note` | string | Free text notes |
| `updatedAt` | ISO datetime | Last update timestamp |
| `updatedBy` | string | "system" or "user" |

### Key Normalization

The `coupangCategoryKey` is derived from `categoryPath3` by:
1. Split by ">"
2. Trim each segment
3. Join with " > "
4. Remove duplicate spaces

**Example**:
- Input: `"완구/취미>물놀이/계절완구>목욕놀이"`
- Key: `"완구/취미 > 물놀이/계절완구 > 목욕놀이"`

### Key Benefit

Products with different `categoryId` but same `categoryPath3` share one mapping row.

| categoryId | categoryPath3 | coupangCategoryKey (same) |
|------------|---------------|---------------------------|
| 317679 | 완구/취미 > 물놀이/계절완구 > 목욕놀이 | 완구/취미 > 물놀이/계절완구 > 목욕놀이 |
| 332850 | 완구/취미 > 물놀이/계절완구 > 목욕놀이 | 완구/취미 > 물놀이/계절완구 > 목욕놀이 |

### Match Types

| Type | Description |
|------|-------------|
| `MANUAL` | User manually set jpCategoryId (highest priority) |
| `AUTO` | System auto-matched by keyword similarity (for review) |
| `FALLBACK` | No match found, using default category |

### Resolution Order

1. **MANUAL**: Exact match by coupangCategoryKey where matchType=MANUAL
2. **AUTO**: Keyword matching writes suggestions (not auto-applied)
3. **FALLBACK**: Fixed JP category ID `320002604`

### Migration

If old `category_mapping` exists with `coupangCategoryId` as primary key:
- Rows with `categoryPath3` are migrated to new schema
- Rows without path are backed up to `category_mapping_legacy`

---

## status 전이 규칙

`status` 컬럼은 파이프라인 전체 단계를 관리하는 단일 ENUM이다. CLAUDE.md의 전체 ENUM 정의 참고.

| 시점 | write 위치 | 전이 |
|------|-----------|------|
| Playwright 수집 완료 | `coupang-playwright-scrape.js` | → `COLLECTED` (기존이 PROTECTED_STATUSES면 skip) |
| Qoo10 등록 시작 | `qoo10-auto-register.js` | → `REGISTERING` (락) |
| Qoo10 등록 성공 (SUCCESS / WARNING) | `qoo10-auto-register.js` | → `REGISTERED` |
| Qoo10 등록 실패 | `qoo10-auto-register.js` | → `ERROR` |
| DRY_RUN | — | 변경 없음 |

```
PROTECTED_STATUSES = REGISTERING, REGISTERED, VALIDATING, LIVE, OUT_OF_STOCK, DEACTIVATED
```

- `REGISTERING` 상태인 row는 qoo10-auto-register.js가 처리를 건너뜀 (중복 실행 방지)
- `registrationStatus` (SUCCESS/WARNING/FAILED/DRY_RUN)는 Qoo10 API 결과 상세 기록용 — `status`와 별개 공존

---

## coupang_datas Registration Columns

Added after Qoo10 registration (both DRY-RUN and REAL modes):

| Column | Type | Description |
|--------|------|-------------|
| `jpCategoryIdUsed` | string | JP category ID used for registration |
| `categoryMatchType` | string | MANUAL, AUTO, or FALLBACK |
| `categoryMatchConfidence` | number | Confidence score (0-1, AUTO only) |
| `coupangCategoryKeyUsed` | string | Normalized categoryPath3 key used for lookup |
| `registrationMode` | string | DRY_RUN or REAL |
| `registrationStatus` | string | SUCCESS, WARNING, DRY_RUN, or FAILED |
| `registrationMessage` | string | Status message |
| `qoo10ItemId` | string | Qoo10 item ID (REAL mode only) |
| `qoo10SellerCode` | string | Seller code used |
| `qoo10SellingPrice` | number | Calculated selling price (JPY) |
| `lastRegisteredAt` | ISO datetime | Last registration attempt timestamp |

### Registration Status Rules

| Mode | matchType | API Result | registrationStatus |
|------|-----------|------------|-------------------|
| DRY_RUN | MANUAL/AUTO | N/A | DRY_RUN |
| DRY_RUN | FALLBACK | N/A | WARNING |
| REAL | MANUAL/AUTO | Success | SUCCESS |
| REAL | FALLBACK | Success | WARNING |
| REAL | Any | Failed | FAILED |

---

## Example Row

| Column | Value |
|--------|-------|
| coupang_url | `https://www.coupang.com/vp/products/123456` |
| product_title | `Sample Product Title` |
| price | `5000` |
| quantity | `30` |
| category_id | `320002604` |
| main_image_url | `https://example.com/image.jpg` |
| description_html | `<p>Product description</p>` |
| extra_images | `https://ex.com/a.jpg,https://ex.com/b.jpg` |
| option_type | `SIZE` |
| option_values | `[{"name":"S","priceDelta":0},{"name":"M","priceDelta":200}]` |
| shipping_no | _(empty, use default)_ |
| status | `pending` |
| qoo10_gdno | _(populated after registration)_ |

---

## Sheet Client Module (TODO)

Future implementation will include:

```javascript
// TODO: scripts/lib/sheetClient.js

async function readPendingProducts(sheetId) {
  // Read rows where status = 'pending'
  // Return array of product objects
}

async function writeRegistrationResult(sheetId, rowIndex, result) {
  // Write qoo10_gdno, seller_code, registered_at, status
}
```

---

## Required Credentials (TODO)

| Credential | Environment Variable | Description |
|------------|---------------------|-------------|
| Google Service Account | `GOOGLE_SERVICE_ACCOUNT_JSON` | TODO: Service account JSON |
| Sheet ID | `GOOGLE_SHEET_ID` | TODO: Target spreadsheet ID |

---

## Related Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
- [RUNBOOK.md](./RUNBOOK.md) - Operational procedures
