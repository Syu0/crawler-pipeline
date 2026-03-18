# Architecture

## Module Boundaries

### A) Coupang Collection (`/app/backend/coupang/`)

Collects product data from Coupang and writes to Google Sheets.

| File | Purpose |
|------|---------|
| `sheetsClient.js` | Google Sheets API wrapper (read/write/upsert) |
| `scraper.js` | HTTP-based Coupang page scraper |

> `scripts/lib/sheetsClient.js`는 이 파일로 위임하는 shim이다 (하위 호환 유지용).
> 실제 구현은 `backend/coupang/sheetsClient.js`에 있다.

수집 방식: Playwright + stealth + Akamai 우회, yamyam 크롬 익스텐션으로 쿠키 갱신

Entry points:
- `scripts/coupang-playwright-scrape.js` - Playwright 서버사이드 수집기
- `scripts/coupang-scrape-to-sheet.js` - HTTP 기반 스크래퍼 (레거시)

### B) Qoo10 Registration (`/app/backend/qoo10/`)

Registers and updates products on Qoo10 via QAPI.

| File | Purpose |
|------|---------|
| `client.js` | Qoo10 QAPI HTTP client |
| `registerNewGoods.js` | SetNewGoods API (CREATE) |
| `updateGoods.js` | UpdateGoods API (UPDATE) |
| `payloadGenerator.js` | Payload building utilities |

Entry points:
- `scripts/qoo10-auto-register.js` - Main executor
- `scripts/qoo10-register-cli.js` - Single product CLI

### C) Category Resolution (`/app/backend/category/`)

Maps Coupang categories to Qoo10 Japan categories.

| File | Purpose |
|------|---------|
| `parser.js` | Breadcrumb text parsing |
| `sheetClient.js` | Category dictionary sheet operations |
| `resolver.js` | KR→JP category mapping logic |
| `japanCategoriesSync.js` | Qoo10 category list sync |

Entry point:
- `scripts/qoo10-sync-japan-categories.js` - Sync JP categories

### D) CLI Executor (`/app/scripts/`)

Orchestrates the pipeline.

| File | Purpose |
|------|---------|
| `qoo10-auto-register.js` | Main executor (reads sheet, calls B/C) |

## Key Data Structures

### Product Row (coupang_datas sheet)

```
# ── Playwright 수집기 write 필드 ─────────────────────────────────────
vendorItemId        # Primary key (URL 파라미터)
itemId              # Fallback key (URL 파라미터)
coupang_product_id  # Coupang 상품 ID (URL path)
categoryId          # Coupang 카테고리 ID (URL 파라미터)
ProductURL          # 원본 쿠팡 상품 URL
ItemTitle           # 상품명
ItemPrice           # 쿠팡 판매가 (KRW, 숫자 문자열)
StandardImage       # 대표 이미지 (thumbnails/... 정규화 경로)
ExtraImages         # 추가 이미지 배열 (JSON 문자열)
WeightKg            # 무게 (하드코딩 '1')
Options             # 옵션 (현재 null)
ItemDescriptionText # 상세 설명 (없으면 ItemTitle로 fallback)
updatedAt           # 수집 시각 (ISO 8601)
status              # 파이프라인 상태 ENUM (수집 후 COLLECTED로 설정)

# ── Qoo10 등록 write-back 필드 ────────────────────────────────────────
qoo10SellingPrice       # 계산된 판매가 (JPY)
qoo10ItemId             # Qoo10 ItemCode (등록 성공 시)
qoo10SellerCode         # 사용된 SellerCode
jpCategoryIdUsed        # 사용된 Qoo10 카테고리 ID
categoryMatchType       # MANUAL | AUTO | FALLBACK
categoryMatchConfidence # 매핑 신뢰도 (AUTO only)
coupangCategoryKeyUsed  # 카테고리 매핑에 사용된 key
registrationMode        # DRY_RUN | REAL
registrationStatus      # SUCCESS | WARNING | DRY_RUN | FAILED (API 결과 상세)
registrationMessage     # 상태 메시지
lastRegisteredAt        # 마지막 등록 시도 시각 (ISO 8601)
needsUpdate             # YES | NO (UPDATE 트리거)
changeFlags             # 파이프 구분 복수 허용. 유효값: PRICE_UP | PRICE_DOWN | TITLE_CHANGED | DESC_CHANGED | CATEGORY_CHANGED
                        # UPDATE 완료 후 빈 문자열로 초기화. 전체 목록: config 시트 VALID_CHANGE_FLAGS
```

### Category Mapping Row (category_mapping sheet)

```
coupangCategoryKey  # Normalized categoryPath3 (primary key)
jpCategoryId        # Mapped Qoo10 category ID
matchType           # MANUAL | AUTO | FALLBACK
confidence          # Match confidence (0-1)
```

## API Methods

### Qoo10 QAPI

| Method | Version | Purpose |
|--------|---------|---------|
| `ItemsBasic.SetNewGoods` | 1.1 | Create new product |
| `ItemsBasic.UpdateGoods` | 1.0 | Update existing product |
| `ShippingBasic.GetSellerDeliveryGroupInfo` | 1.0 | Get shipping templates |
| `CommonInfoLookup.GetCatagoryListAll` | 1.0 | Get JP category list |

### SetNewGoods / UpdateGoods Payload

Both use identical structure:

```
returnType          # application/json
ItemCode            # (UpdateGoods only) Existing item ID
SellerCode          # (SetNewGoods only) Generated seller code
SecondSubCat        # Qoo10 category ID
ItemTitle           # Product title
ItemPrice           # Selling price (JPY)
RetailPrice         # Retail price (default: 0)
ItemQty             # Quantity (default: 100)
AvailableDateType   # Availability type (default: 0)
AvailableDateValue  # Availability value (default: 2)
ShippingNo          # Shipping template ID (default: 471554)
AdultYN             # Adult content flag (default: N)
TaxRate             # Tax rate code (default: S)
ExpireDate          # Expiration date (default: 2030-12-31)
StandardImage       # Main image URL
ItemDescription     # HTML description
Weight              # Weight in grams (default: 500)
ProductionPlaceType # 1=Japan, 2=Overseas, 3=Other (default: 2)
ProductionPlace     # Country name (default: Overseas)
```

## Sheet Tabs

| Tab | Primary Key | Purpose |
|-----|-------------|---------|
| `coupang_datas` | `vendorItemId` | Product data |
| `coupang_categorys` | `coupangCategoryId` | Category dictionary |
| `category_mapping` | `coupangCategoryKey` | KR→JP mappings |
| `japan_categories` | `jpCategoryId` | JP category cache |
| `keywords` | `keyword` | 수집 대상 키워드 관리 (ACTIVE/PAUSED/PENDING) |
| `config` | `key` | 필터 조건값 등 운영 설정 (코드 외부 관리) |
