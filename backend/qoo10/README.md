# Qoo10 registerNewGoods Module - README

## Overview
Production-ready Node module for registering products on Qoo10 via ItemsBasic.SetNewGoods API.

---

## Module Location

```
/app/backend/qoo10/registerNewGoods.js
```

---

## Usage

### Programmatic Usage

```javascript
const { registerNewGoods } = require('./backend/qoo10/registerNewGoods');

const result = await registerNewGoods({
  SecondSubCat: '320002604',
  ItemTitle: 'My Product',
  ItemPrice: '5000',
  ItemQty: '10',
  SellerCode: 'PROD001',
  StandardImage: 'https://example.com/image.jpg',
  ItemDescription: '<p>Product description</p>'
});

console.log(result);
// {
//   success: true,
//   resultCode: 0,
//   resultMsg: 'Success',
//   itemNo: '123456789',
//   request: { secondSubCat, itemTitle, sellerCode, shippingNo }
// }
```

---

## Input Schema

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `SecondSubCat` | string | Category ID (e.g., '320002604') |
| `ItemTitle` | string | Product title |
| `ItemPrice` | string/number | Price (positive number) |
| `ItemQty` | string/number | Quantity (positive number) |
| `SellerCode` | string | Unique seller code |
| `StandardImage` | string | Product image URL (https) |
| `ItemDescription` | string | HTML description (min 5 chars) |
| `DetailImages` | array | Optional: Array of detail image URLs |

### Optional Fields (with defaults)

| Field | Default | Description |
|-------|---------|-------------|
| `ShippingNo` | auto-resolved | Shipping group ID |
| `AdultYN` | 'N' | Adult content flag |
| `AvailableDateType` | '0' | Availability type |
| `AvailableDateValue` | '2' | Availability value |
| `TaxRate` | 'S' | Tax rate code |
| `RetailPrice` | '0' | Retail price |
| `ExpireDate` | '2030-12-31' | Expiration date |
| `Weight` | '500' | Weight in grams |
| `PromotionName` | '' | Promotion name |
| `ProductionPlaceType` | '1' | Production place type |
| `ProductionPlace` | 'Japan' | Production place |
| `IndustrialCodeType` | 'J' | Industrial code type |
| `IndustrialCode` | '' | Industrial code |

### DetailImages Support

The `DetailImages` field allows multiple product images. When provided, images are automatically appended to `ItemDescription` as HTML `<img>` tags.

**Example:**
```json
{
  "StandardImage": "https://example.com/main.jpg",
  "DetailImages": [
    "https://example.com/detail1.jpg",
    "https://example.com/detail2.jpg"
  ],
  "ItemDescription": "<p>Product description</p>"
}
```

**Generated ItemDescription:**
```html
<p>Product description</p><hr/><img src="https://example.com/detail1.jpg" /><img src="https://example.com/detail2.jpg" />
```

---

## Validation

The module performs validation before making API calls:

1. **Required fields check** - All required fields must be present and non-empty
2. **Type validation** - ItemPrice and ItemQty must be positive numbers
3. **URL validation** - StandardImage must be valid HTTP(S) URL
4. **Content validation** - ItemDescription must be at least 5 characters

**Errors thrown:**
- `Required field missing: <field>`
- `<field> must be a positive number`
- `<field> must be a valid HTTP(S) URL`
- `ItemDescription must be at least 5 characters`

---

## Auto-Resolution

### ShippingNo Auto-Resolution

If `ShippingNo` is not provided in input, the module automatically:
1. Calls `ItemsLookup.GetSellerDeliveryGroupInfo`
2. Selects first domestic (non-overseas) shipping group
3. Uses that ShippingNo for registration

**Logs:**
```
ShippingNo not provided, auto-resolving...
Resolved ShippingNo: 663125
```

---

## CLI Usage

### Command
```bash
node scripts/qoo10-register-cli.js <json-file-path>
```

### Example
```bash
npm run qoo10:register:sample
# or
node scripts/qoo10-register-cli.js backend/qoo10/sample-newgoods.json
```

### CLI Features
- Reads product data from JSON file
- Automatically appends timestamp to SellerCode (avoids duplicates)
- Prints registration result with metadata
- Exits with code 1 on failure

### Sample Output
```
=== Qoo10 Product Registration CLI ===

Loading product data from: backend/qoo10/sample-newgoods.json
Unique SellerCode: SAMPLE00147382910

Registering product on Qoo10...

ShippingNo not provided, auto-resolving...
Resolved ShippingNo: 663125

=== Registration Result ===

Success: true
ResultCode: 0
ResultMsg: Success
ItemNo: 123456789

Request metadata:
  Category: 320002604
  Title: Sample Debug Product
  SellerCode: SAMPLE00147382910
  ShippingNo: 663125

✓ Product registered successfully!
```

---

## Sample JSON

Location: `/app/backend/qoo10/sample-newgoods.json`

```json
{
  "SecondSubCat": "320002604",
  "ItemTitle": "Sample Debug Product",
  "ItemPrice": "5000",
  "ItemQty": "10",
  "SellerCode": "SAMPLE001",
  "StandardImage": "https://dp.image-qoo10.jp/GMKT.IMG/loading_2017/qoo10_loading.v_20170420.png",
  "ItemDescription": "<p>This is a sample product for testing Qoo10 registration</p>",
  "AdultYN": "N",
  "TaxRate": "S",
  "RetailPrice": "0",
  "ExpireDate": "2030-12-31"
}
```

---

## Environment

Requires `backend/.env` with:
```bash
QOO10_SAK=your-seller-auth-key
QOO10_ALLOW_REAL_REG=0
QOO10_TRACER=0
```

| Variable | Default | Description |
|----------|---------|-------------|
| `QOO10_SAK` | - | **Required:** Seller Auth Key |
| `QOO10_ALLOW_REAL_REG` | `0` | Set to `1` for real registration (default: dry-run) |
| `QOO10_TRACER` | `0` | Set to `1` for verbose logging |

Module auto-loads `backend/.env` using dotenv.

### Dry-Run Mode (Default)

By default, `QOO10_ALLOW_REAL_REG=0` (or not set) means **dry-run mode**.

**Dry-run behavior:**
- Resolves ShippingNo (allowed, no risk)
- Skips SetNewGoods API call
- Returns mock response: `resultCode: -1, resultMsg: 'Dry-run mode'`

**To enable real registration:**
```bash
# In backend/.env
QOO10_ALLOW_REAL_REG=1
```

---

## Tracer

Set `QOO10_TRACER=1` for verbose request/response logging:
```bash
QOO10_TRACER=1 npm run qoo10:register:sample
```

---

## npm Scripts

| Script | Description |
|--------|-------------|
| `npm run qoo10:register:sample` | Register sample product from JSON |
| `npm run qoo10:test:lookup` | Test connection (sanity check) |
| `npm run qoo10:debug:setnewgoods` | Debug harness (for troubleshooting) |

---

## Error Handling

### Validation Errors
```javascript
try {
  const result = await registerNewGoods({ /* invalid input */ });
} catch (err) {
  console.error(err.message);
  // "Required field missing: ItemTitle"
}
```

### API Errors
```javascript
const result = await registerNewGoods({ /* valid input */ });
if (!result.success) {
  console.error(`ResultCode: ${result.resultCode}, Msg: ${result.resultMsg}`);
}
```

---

## Return Value

```typescript
{
  success: boolean,          // true if ResultCode === 0
  resultCode: number,        // Qoo10 API result code
  resultMsg: string,         // Qoo10 API message
  itemNo: string | null,     // Created item ID (if success)
  request: {
    secondSubCat: string,    // Category used
    itemTitle: string,       // Title used
    sellerCode: string,      // SellerCode used
    shippingNo: string       // ShippingNo used
  }
}
```

---

## Local Setup

```bash
# 1. Ensure backend/.env exists
cat backend/.env  # Should have QOO10_SAK=...

# 2. Install dependencies
npm install

# 3. Run sample registration
npm run qoo10:register:sample
```

---

## Integration Example

### Express.js Route

```javascript
const { registerNewGoods } = require('./backend/qoo10/registerNewGoods');

app.post('/api/products/register', async (req, res) => {
  try {
    const result = await registerNewGoods(req.body);
    
    if (result.success) {
      res.json({ message: 'Product registered', itemNo: result.itemNo });
    } else {
      res.status(400).json({ error: result.resultMsg });
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
```

---

## Files Created

```
/app/backend/qoo10/registerNewGoods.js      # Core module
/app/backend/qoo10/sample-newgoods.json     # Sample input
/app/scripts/qoo10-register-cli.js          # CLI runner
```

---

## Dependencies

- `dotenv` - For loading backend/.env
- `scripts/lib/qoo10Client.js` - Shared QAPI client

---

**Tutorial:** https://emergent.sh/tutorial/moltbot-on-emergent
