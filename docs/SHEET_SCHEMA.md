# Google Sheet Schema

This document defines the expected schema for the Google Sheet used in the Coupang-to-Qoo10 pipeline.

> **Note**: Sheet integration is TODO. This schema is a specification for future implementation.

---

## Overview

The Google Sheet serves as the central data store between:
- **Step 1**: Coupang scraper (writes product data)
- **Step 3**: Qoo10 registration (reads product data, writes Qoo10 IDs)

---

## Sheet Structure

### Main Sheet: `Products`

| Column | Header Name | Type | Required | Description |
|--------|-------------|------|----------|-------------|
| A | `coupang_url` | string | Y | Source Coupang Rocket Delivery product URL |
| B | `product_title` | string | Y | Product title (maps to `ItemTitle`) |
| C | `price` | number | Y | Price in JPY (maps to `ItemPrice`) |
| D | `quantity` | number | Y | Stock quantity (maps to `ItemQty`) |
| E | `category_id` | string | Y | Qoo10 category ID (maps to `SecondSubCat`) |
| F | `main_image_url` | string | Y | Primary image URL (maps to `StandardImage`) |
| G | `description_html` | string | Y | HTML description (maps to `ItemDescription`) |
| H | `extra_images` | string | N | Comma-separated image URLs (maps to `ExtraImages[]`) |
| I | `option_type` | string | N | Option group name, e.g., "SIZE" (maps to `Options.type`) |
| J | `option_values` | string | N | JSON array, e.g., `[{"name":"S","priceDelta":0}]` |
| K | `shipping_no` | string | N | Override ShippingNo (default: 471554) |
| L | `status` | string | N | Processing status: `pending`, `registered`, `error` |
| M | `qoo10_gdno` | string | N | **OUTPUT**: Created Qoo10 item ID (GdNo) |
| N | `qoo10_ai_contents_no` | string | N | **OUTPUT**: AIContentsNo from response |
| O | `seller_code` | string | N | **OUTPUT**: Generated SellerCode used |
| P | `registered_at` | datetime | N | **OUTPUT**: Registration timestamp |
| Q | `error_message` | string | N | **OUTPUT**: Error message if failed |

---

## Column Mapping to API

| Sheet Column | API Parameter | Notes |
|--------------|---------------|-------|
| `product_title` | `ItemTitle` | Direct mapping |
| `price` | `ItemPrice` | Converted to string |
| `quantity` | `ItemQty` | Converted to string |
| `category_id` | `SecondSubCat` | Direct mapping |
| `main_image_url` | `StandardImage` | Must be HTTPS URL |
| `description_html` | `ItemDescription` | ExtraImages appended |
| `extra_images` | `ExtraImages[]` | Parse comma-separated |
| `option_type` + `option_values` | `Options` object | Combined into Options |
| `shipping_no` | `ShippingNo` | Default: 471554 |

---

## Status Values

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
