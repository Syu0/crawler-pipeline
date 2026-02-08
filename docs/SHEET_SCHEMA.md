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
| D | `coupang_category_id` | string | URL param | Coupang category ID (categoryId) |
| E | `source_url` | string | Input | Original Coupang URL |
| F | `ItemTitle` | string | HTML | Product title (Qoo10 field name) |
| G | `ItemPrice` | string | HTML | Price in KRW, numeric string |
| H | `StandardImage` | string | HTML | **Normalized** path: `thumbnails/...` |
| I | `StandardImageFullUrl` | string | HTML | Full CDN URL (optional) |
| J | `ExtraImagesJson` | JSON string | HTML | Array of image paths |
| K | `ItemDescriptionHtml` | string | HTML | HTML description with images |
| L | `WeightKg` | string | HTML | Weight in Kg (default: "1") |
| M | `SecondSubCat` | string | - | **PLACEHOLDER**: Qoo10 category ID |
| N | `brand` | string | HTML | Brand/manufacturer (best effort) |
| O | `optionRaw` | string | HTML | Raw option text (best effort) |
| P | `specsJson` | JSON string | HTML | Key-value specs table |
| Q | `reviewSummary` | string | HTML | Review rating (best effort) |
| R | `collected_at_iso` | ISO datetime | System | First collection timestamp |
| S | `updated_at_iso` | ISO datetime | System | Last update timestamp |

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
