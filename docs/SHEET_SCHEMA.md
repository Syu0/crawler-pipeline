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
| `coupang_categorys` | Category dictionary for future mapping |
| `japan_categories` | Full JP category list from Qoo10 API |
| `category_mapping` | KR→JP category mapping (manual + auto) |

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

| Column | Header Name | Type | Source | Description |
|--------|-------------|------|--------|-------------|
| A | `vendorItemId` | string | URL param | **PRIMARY KEY** for upsert |
| B | `itemId` | string | URL param | Fallback key if vendorItemId missing |
| C | `coupang_product_id` | string | URL path | Product ID from /vp/products/{id} |
| D | `categoryId` | string | URL param | Coupang category ID (from URL ONLY) |
| E | `ProductURL` | string | System | Full Coupang product URL as-is |
| F | `ItemTitle` | string | DOM | Product title |
| G | `ItemPrice` | number | DOM | Coupang price (integer, no commas/symbols) - legacy |
| H | `StandardImage` | string | DOM | **Normalized** path: `thumbnails/...` |
| I | `ExtraImages` | JSON string | DOM | Array of image URLs |
| J | `WeightKg` | string | Fixed | **ALWAYS "1"** (no scraping) |
| K | `Options` | JSON string | DOM | Single option: `{"type":"SIZE","values":["S","M"]}` |
| L | `ItemDescriptionText` | string | DOM | Plain text description (no HTML/images) |
| M | `updatedAt` | ISO datetime | System | Last update timestamp |
| N | `qoo10SellingPrice` | number | System | **REQUIRED** KRW input → computed JPY written back |
| O | `qoo10ItemId` | string | Step 5-2 | **OUTPUT**: Qoo10 ItemCode/ItemNo |

---

## Qoo10 Registration Output Fields

These fields are written back after successful Qoo10 registration:

| Field | Description |
|-------|-------------|
| `qoo10SellingPrice` | ItemPrice in JPY (computed from CostPriceKrw using fixed FX rate) |
| `qoo10ItemId` | ItemCode or ItemNo from Qoo10 API response |
| `updatedAt` | Timestamp of last update (ISO 8601) |

**Pricing Computation:**
- `ItemPrice (JPY) = floor(CostPriceKrw / 10)` using fixed FX rate: 1 JPY = 10 KRW
- **STRICT:** `CostPriceKrw` is REQUIRED. If missing/invalid, registration FAILS.
- Computed JPY is always written to `qoo10SellingPrice` even if API fails.

**Rules:**
- Only written after successful API call
- `qoo10ItemId` is never overwritten if already exists
- Rows with existing `qoo10ItemId` are skipped

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

## StandardImage Normalization Rule

Coupang CDN URLs are normalized to a relative path:

**Before** (full URL):
```
https://thumbnail.coupangcdn.com/thumbnails/remote/492x492ex/image/retail/images/92227177321273-59c263de-60eb-4a36-b7fa-e490c36d45d0.jpg
```

**After** (stored value):
```
thumbnails/remote/492x492ex/image/retail/images/92227177321273-59c263de-60eb-4a36-b7fa-e490c36d45d0.jpg
```

This allows flexible reconstruction with different CDN prefixes for Qoo10.

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
