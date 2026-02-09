# Google Sheet Schema

This document defines the schema for the `coupang_datas` tab used in the Coupang-to-Qoo10 pipeline.

> **Status**: IMPLEMENTED. Step 2 scraper writes to this schema.

---

## Overview

The Google Sheet serves as the central data store between:
- **Step 2**: Coupang scraper (writes product data)
- **Step 3**: Qoo10 registration (reads product data, writes Qoo10 IDs)

---

## Sheet Structure

### Tab: `coupang_datas`

| Column | Header Name | Type | Source | Description |
|--------|-------------|------|--------|-------------|
| A | `vendorItemId` | string | URL param | **PRIMARY KEY** for upsert |
| B | `itemId` | string | URL param | Fallback key if vendorItemId missing |
| C | `coupang_product_id` | string | URL path | Product ID from /vp/products/{id} |
| D | `categoryId` | string | URL param | Coupang category ID (from URL ONLY) |
| E | `ProductURL` | string | System | Full Coupang product URL as-is |
| F | `ItemTitle` | string | DOM | Product title |
| G | `ItemPrice` | number | DOM | Coupang price (integer, no commas/symbols) |
| H | `StandardImage` | string | DOM | **Normalized** path: `thumbnails/...` |
| I | `ExtraImages` | JSON string | DOM | Array of image URLs |
| J | `WeightKg` | string | Fixed | **ALWAYS "1"** (no scraping) |
| K | `Options` | JSON string | DOM | Single option: `{"type":"SIZE","values":["S","M"]}` |
| L | `ItemDescriptionText` | string | DOM | Plain text description (no HTML/images) |
| M | `updatedAt` | ISO datetime | System | Last update timestamp |
| N | `qoo10SellingPrice` | number | Step 5-2 | **OUTPUT**: Calculated Qoo10 price |
| O | `qoo10ItemId` | string | Step 5-2 | **OUTPUT**: Qoo10 ItemCode/ItemNo |

---

## Qoo10 Registration Output Fields

These fields are written back after successful Qoo10 registration:

| Field | Description |
|-------|-------------|
| `qoo10SellingPrice` | CEILING(ItemPrice × 1.12 × 1.03, 10) |
| `qoo10ItemId` | ItemCode or ItemNo from Qoo10 API response |
| `updatedAt` | Timestamp of last update (ISO 8601) |

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
| `SecondSubCat` | `SecondSubCat` | **TODO: Resolver needed** |

---

## Status Values (TODO: Add column)

| Status | Description |
|--------|-------------|

| Status | Description |
|--------|-------------|
| `pending` | Ready for registration |
| `processing` | Currently being registered |
| `registered` | Successfully registered, GdNo populated |
| `error` | Registration failed, see `error_message` |
| `skipped` | Manually marked to skip |

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
