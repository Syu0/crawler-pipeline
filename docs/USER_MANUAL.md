# User Manual

## Step-by-Step Operator Instructions

### 1. Collect Product Data from Coupang

#### Option A: Using Chrome Extension (Recommended)

1. Start the receiver server:
   ```bash
   npm run coupang:receiver:start
   ```

2. Open a Coupang product page in Chrome

3. Click the extension icon and press "Send to Sheet"

4. Data is written to the `coupang_datas` sheet

#### Option B: Using CLI Scraper

```bash
npm run coupang:scrape:run
```

Requires `COUPANG_COOKIE` env var for authenticated requests.

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

### Pricing: qoo10SellingPrice (KRW) → ItemPrice (JPY)

The system reads `qoo10SellingPrice` as KRW input and computes the Qoo10 selling price (JPY):

```
ItemPrice (JPY) = floor(qoo10SellingPrice / 10)
```

**Fixed FX Rate:** 1 JPY = 10 KRW

| qoo10SellingPrice (KRW) | ItemPrice (JPY) |
|-------------------------|-----------------|
| 5800 | 580 |
| 12500 | 1250 |
| 999 | 99 |

**STRICT REQUIREMENT:** `qoo10SellingPrice` is **REQUIRED**.
- If `qoo10SellingPrice` is empty, null, invalid, or <= 0:
  - The row **FAILS** immediately
  - No Qoo10 API call is made
  - `registrationStatus` = `FAILED`
  - `registrationMessage` = `qoo10SellingPrice missing or invalid`

**Price Write-back:** The computed JPY is written back to `qoo10SellingPrice` column **before** the API call, regardless of API success.

This pricing applies to **both** CREATE (SetNewGoods) and UPDATE (UpdateGoods) operations.

### 3. Trigger CREATE vs UPDATE

#### CREATE Mode (New Products)

Products are created when:
- `qoo10ItemId` column is **empty**
- Row passes validation (has required fields)

Run:
```bash
node scripts/qoo10-auto-register.js --limit 5
```

After successful CREATE:
- `qoo10ItemId` is populated with the new Qoo10 item ID
- `registrationStatus` shows `SUCCESS` or `WARNING`

#### UPDATE Mode (Existing Products)

Products are updated when:
- `qoo10ItemId` column has a value
- `needsUpdate` column is set to `YES`

To trigger an update:
1. Set `needsUpdate` to `YES` in the sheet
2. Run:
   ```bash
   node scripts/qoo10-auto-register.js
   ```

After successful UPDATE:
- `needsUpdate` is reset to `NO`
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
# Start Coupang receiver
npm run coupang:receiver:start

# Dry-run registration (preview only)
npm run qoo10:auto-register:dry

# Real registration
QOO10_ALLOW_REAL_REG=1 npm run qoo10:auto-register

# Sync Japan categories
npm run qoo10:sync:japan-categories

# Check environment
npm run qoo10:env
```
