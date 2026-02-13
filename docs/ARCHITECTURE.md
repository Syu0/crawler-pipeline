# Architecture

## Module Boundaries

### A) Coupang Collection (`/app/backend/coupang/`)

Collects product data from Coupang and writes to Google Sheets.

| File | Purpose |
|------|---------|
| `sheetsClient.js` | Google Sheets API wrapper (read/write/upsert) |
| `scraper.js` | HTTP-based Coupang page scraper |

Entry points:
- `scripts/coupang-receiver.js` - HTTP server for Chrome extension
- `scripts/coupang-scrape-to-sheet.js` - CLI scraper

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
| `coupang-receiver.js` | HTTP server for extension (calls A) |

## Key Data Structures

### Product Row (coupang_datas sheet)

```
vendorItemId        # Primary key
coupang_product_id  # Coupang product ID
categoryId          # Coupang category ID
categoryPath3       # Normalized category path (last 3 segments)
ItemTitle           # Product title
ItemPrice           # Coupang price (KRW)
StandardImage       # Main image URL
ItemDescriptionText # Description
qoo10ItemId         # Qoo10 item ID (after CREATE)
qoo10SellingPrice   # Calculated selling price (JPY)
jpCategoryIdUsed    # Resolved Qoo10 category ID
categoryMatchType   # MANUAL | AUTO | FALLBACK
needsUpdate         # YES | NO
changeFlags         # PRICE_UP | PRICE_DOWN | OPTIONS_CHANGED
registrationStatus  # SUCCESS | WARNING | FAILED | DRY_RUN
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
