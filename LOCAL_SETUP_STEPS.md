# Qoo10 QAPI Debug - Local Setup Steps

## After Pulling Latest Code

### 1. Switch to emergent branch and pull
```bash
cd /app
git checkout emergent
git pull
```

### 2. Install dependencies (including dotenv)
```bash
npm install
```

Expected output:
```
added 1 package
✓ dotenv@17.2.4
```

### 3. Create backend/.env from template
```bash
cp backend/.env.example backend/.env
```

### 4. Edit backend/.env and add your Qoo10 SAK
```bash
# Edit backend/.env
nano backend/.env
# or
vim backend/.env
```

Add your credentials:
```bash
QOO10_SAK=your-actual-seller-auth-key-here
QOO10_ALLOW_REAL_REG=0
QOO10_TRACER=0
```

**To enable real registration** (instead of dry-run):
```bash
QOO10_SAK=your-key
QOO10_ALLOW_REAL_REG=1
QOO10_TRACER=0
```

---

## Environment Variables (backend/.env)

| Variable | Default | Description |
|----------|---------|-------------|
| `QOO10_SAK` | - | **Required:** Seller Auth Key from Qoo10 |
| `QOO10_ALLOW_REAL_REG` | `0` | Set to `1` to enable real registration (default: dry-run) |
| `QOO10_TRACER` | `0` | Set to `1` for verbose logging (shows request params) |

### Common Gotcha ⚠️

**Setting env vars only in terminal session is temporary and will be lost.**

❌ **Wrong:** `export QOO10_ALLOW_REAL_REG=1 && npm run ...`  
✅ **Right:** Add to `backend/.env` file

**Why?** Terminal exports don't persist. Use `backend/.env` for permanent settings.

---

## Default Values (Hardcoded)

These values are automatically applied if not specified in the input JSON:

### ShippingNo
- **Default:** `471554`
- Auto-resolving via API lookup is **disabled**
- To override: add `"ShippingNo": "your-value"` in your JSON payload

### SellerCode Prefix
- **Default prefix:** `auto` (always)
- `SellerCodeBase` and `SellerCode` in input JSON are **ignored**
- Final format: `auto{YYYYMMDDHHmmss}{rand4}` (e.g., `auto202602081430123456`)
- To change prefix: modify `generateUniqueSellerCode()` in `backend/qoo10/registerNewGoods.js`

### ProductionPlace (Origin)
- **Default:** `ProductionPlaceType=2` (海外/Overseas), `ProductionPlace=Overseas`
- Qoo10 spec values:
  - `1` = 国内 (Japan domestic)
  - `2` = 海外 (Overseas/Foreign)
  - `3` = その他 (Other)
- To override: add `"ProductionPlaceType": "1", "ProductionPlace": "Japan"` in your JSON

---

### 5. Test connection (sanity check)
```bash
npm run qoo10:test:lookup
```

Expected output:
```
Testing Qoo10 connection (GetSellerDeliveryGroupInfo)...

Response: {
  "ResultCode": 0,
  "ResultMsg": "Success",
  ...
}

✓ Connection OK
```

### 6. Run debug harness
```bash
npm run qoo10:debug:setnewgoods
```

Expected output:
```
=== Qoo10 SetNewGoods Parameter Debug ===

Testing incrementally from minimal params...

[Test 1] Minimal params only
Params: returnType, SecondSubCat, ItemTitle, ItemPrice, ItemQty, ...
→ ResultCode: -999, Msg: Object reference not set to an instance of an object.

[Test 2] Adding: StandardImage
→ ResultCode: -999, Msg: Object reference not set to an instance of an object.

[Test 3] Adding: ItemDescription
→ ResultCode: 0, Msg: Success
✓ SUCCESS! Found working param combination.

=== Summary Table ===

Test                 | Code | Message
----------------------------------------------------------------------
Minimal              | -999 | Object reference not set...
+StandardImage       | -999 | Object reference not set...
+ItemDescription     | 0    | Success

=== Debug Complete ===
```

---

## Cross-Platform Support

### Windows (Git Bash/MINGW)
```bash
npm run qoo10:test:lookup
npm run qoo10:debug:setnewgoods
```

### Windows (PowerShell)
```powershell
npm run qoo10:test:lookup
npm run qoo10:debug:setnewgoods
```

### macOS/Linux
```bash
npm run qoo10:test:lookup
npm run qoo10:debug:setnewgoods
```

All platforms use identical commands - no shell-specific syntax.

---

## Key Points

✅ **No manual export needed** - scripts auto-load `backend/.env`  
✅ **Cross-platform** - works on Windows, macOS, Linux without modifications  
✅ **Secrets stay local** - `backend/.env` is gitignored  
✅ **One-time setup** - just `cp .env.example .env` and fill in SAK  
✅ **All commands from repo root** - `cd /app && npm run qoo10:*`  

---

## Troubleshooting

**"QOO10_SAK not set"**  
→ Ensure `backend/.env` exists and contains `QOO10_SAK=your-key`

**Windows error: "잘못된 매개 변수입니다" or "Invalid parameter"**  
→ Fixed in latest version - pull latest and try again (no MODE=... syntax used anymore)

**"npm: command not found" or "yarn: command not found"**  
→ Use `npm install` (yarn is aliased to npm in this environment)

**Changes not showing up after git pull**  
→ Run `npm install` again to update dependencies

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run qoo10:env` | Validate QOO10_SAK is set |
| `npm run qoo10:test:lookup` | Sanity check connection |
| `npm run qoo10:debug:setnewgoods` | Binary search param harness |
| `npm run qoo10:register:sample` | Register with sample payload |
| `npm run qoo10:register:with-options` | Register with product options/variants |
| `npm run qoo10:register:with-extraimages` | Register with extra images |

All scripts include automatic env validation.

---

## Options (Variants)

Qoo10 supports product options/variants (e.g., size, color) that are set during product creation.

### JSON Format

Add an `Options` field to your product JSON:

```json
{
  "ItemTitle": "Product with Size Options",
  "StandardImage": "https://...",
  "Options": {
    "type": "SIZE",
    "values": [
      {"name": "S", "priceDelta": 0, "qty": 10},
      {"name": "M", "priceDelta": 200, "qty": 10},
      {"name": "L", "priceDelta": 500, "qty": 5}
    ]
  }
}
```

**Fields:**
- `type`: Option type name (e.g., "SIZE", "COLOR", "VARIANT")
- `values`: Array of option values
  - `name`: Value name (e.g., "S", "Blue")
  - `priceDelta`: Price adjustment (0 for base price, positive for premium)
  - `qty`: Quantity for this option (not used in AdditionalOption format)

### Command to Test

```bash
npm run qoo10:register:with-options
```

**Sample file:** `backend/qoo10/sample-with-options.json`

### Expected Output

```
=== Registration Result ===

Success: true
ResultCode: 0
ResultMsg: SUCCESS
CreatedItemId (GdNo): 1192348471
SellerCode used: OPTTEST202602080545123456
ShippingNo used: 663125
Options applied: YES
Option summary: SIZE: S(+0), M(+200)

✓ Product registered successfully!
```

**Notes:**
- Options are set during product creation (in SetNewGoods API call)
- If `Options` field is missing, product is created without options
- Format: `OptionType||*ValueName||*PriceDelta$$OptionType||*ValueName||*PriceDelta`
- Delimiter between options: `$$`
- Delimiter within option: `||*`

---

## Extra Images

Qoo10 supports adding supplementary images to the product description. These are injected as HTML `<img>` tags into `ItemDescription`.

### JSON Format

Add an `ExtraImages` field to your product JSON:

```json
{
  "ItemTitle": "Product with Extra Images",
  "StandardImage": "https://...",
  "ItemDescription": "<p>Main description</p>",
  "ExtraImages": [
    "https://example.com/extra1.jpg",
    "https://example.com/extra2.jpg"
  ]
}
```

### How It Works

- Images are appended to `ItemDescription` as: `<br/><p><img src="URL" /></p>` for each URL
- Original `ItemDescription` is preserved; images are only appended
- If `ExtraImages` is missing or empty, nothing is appended

### Command to Test

```bash
npm run qoo10:register:with-extraimages
```

**Sample file:** `backend/qoo10/sample-with-extraimages.json`

### Expected Output

```
=== Registration Result ===

Success: true
ResultCode: 0
ResultMsg: SUCCESS
CreatedItemId (GdNo): 1192348472
AIContentsNo: 12345678
SellerCode used: EXTRA202602080646539039
ShippingNo used: 663125
Options applied: NO

✓ Product registered successfully!
```

**Notes:**
- `AIContentsNo` is extracted from the API response and included in the result
- Both `DetailImages` (legacy) and `ExtraImages` can coexist in the same payload
- `DetailImages` uses `<hr/>` separator; `ExtraImages` uses `<br/>` separator

---

**Full documentation:** `/app/QAPI_DEBUG_SETUP.md`  
**Tutorial:** https://emergent.sh/tutorial/moltbot-on-emergent
