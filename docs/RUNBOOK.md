# Runbook

Operational procedures for the Qoo10 product registration system.

---

## Quick Reference

| Task | Command |
|------|---------|
| **Step 2 (Extension Mode)** | |
| Start receiver server | `npm run coupang:receiver:start` |
| **Step 2 (CLI Mode)** | |
| Scrape Coupang (dry-run) | `npm run coupang:scrape:dry` |
| Scrape Coupang (real) | `npm run coupang:scrape:run` |
| **Step 3 (Qoo10)** | |
| Register sample (dry-run) | `npm run qoo10:register:sample` |
| Register with options | `npm run qoo10:register:with-options` |
| Check Qoo10 env | `npm run qoo10:env` |

> **Windows Note**: All npm scripts use `cross-env` for cross-platform compatibility.
> Run `npm install` once after cloning to install dependencies.

---

## Step 2: Coupang Scraping (Chrome Extension + Receiver)

The recommended approach uses a **Chrome Extension** to scrape product data from logged-in Coupang sessions, sending it to a **local Node receiver** that writes to Google Sheets.

### Architecture

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│  Chrome Extension   │ ──▶ │  Local Receiver     │ ──▶ │  Google Sheets  │
│  (popup + content)  │     │  (127.0.0.1:8787)   │     │  (coupang_datas)│
└─────────────────────┘     └─────────────────────┘     └─────────────────┘
        │                            │
        │ Extracts from DOM          │ POST /api/coupang/upsert
        └────────────────────────────┘
```

### Step 2.1: Set Up Google Sheets

#### Google Service Account Setup

1. **Create a Service Account**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create or select a project
   - Navigate to "IAM & Admin" → "Service Accounts"
   - Click "Create Service Account"
   - Give it a name (e.g., `coupang-qoo10-pipeline`)
   - Click "Create and Continue"
   - Skip role assignment (not needed for Sheets API)
   - Click "Done"

2. **Create a Key**:
   - Click on the service account you created
   - Go to "Keys" tab
   - Click "Add Key" → "Create new key"
   - Choose JSON format
   - Download the key file

3. **Place the Key File**:
   ```bash
   # Create the keys directory if not exists
   mkdir -p backend/keys
   
   # Move your downloaded key file
   mv ~/Downloads/your-project-xxxxx.json backend/keys/google-service-account.json
   ```
   
   > **Note**: This file is gitignored and must NOT be committed.

4. **Share the Sheet**:
   - Open your Google Sheet
   - Click "Share" button
   - Add the service account email (looks like: `your-name@your-project.iam.gserviceaccount.com`)
   - Give it "Editor" permission
   - Click "Send" (ignore the "can't send email" warning)

5. **Configure Environment**:
   ```bash
   # Edit backend/.env
   GOOGLE_SHEET_ID=1PYJKQ9D2qApWfdw7Km4RiWJXJ5qso63vCurfAk5wEA4
   GOOGLE_SHEET_TAB_NAME=coupang_datas
   GOOGLE_SERVICE_ACCOUNT_JSON_PATH=./backend/keys/google-service-account.json
   COUPANG_RECEIVER_PORT=8787
   ```

### Step 2.2: Install Chrome Extension

1. **Open Chrome Extensions**:
   - Navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right)

2. **Load the Extension**:
   - Click "Load unpacked"
   - Select the `chrome-extension-coupang/` folder from this repo

   > **Note**: The extension runs without custom icons (Chrome will show a default puzzle piece icon). This is intentional to avoid binary asset dependencies.

3. **Pin the Extension** (optional):
   - Click the puzzle piece icon in Chrome toolbar
   - Pin "Coupang to Sheet" for easy access

### Step 2.3: Start the Receiver Server

```bash
npm run coupang:receiver:start
```

Expected output:
```
==================================================
  Coupang Data Receiver
==================================================
  Server:    http://127.0.0.1:8787
  Endpoint:  POST /api/coupang/upsert
  Health:    GET /health

  Sheet ID:  1PYJKQ9D2qApWfdw7Km4RiWJXJ5qso63vCurfAk5wEA4
  Tab:       coupang_datas

  Press Ctrl+C to stop
==================================================
```

### Step 2.4: Scrape a Product

1. **Navigate to a Coupang product page** in Chrome (while logged in)
   - URL should be like: `https://www.coupang.com/vp/products/12345678?...`

2. **Click the extension icon** in the toolbar

3. **Click "Send to Sheet"**
   - Status will show: Collecting → Sending → Done
   - The receiver terminal will log the upsert

4. **Check your Google Sheet**
   - A new row should appear in the `coupang_datas` tab

### Troubleshooting Extension Mode

| Error | Solution |
|-------|----------|
| "Cannot connect to receiver" | Run `npm run coupang:receiver:start` |
| "Not a Coupang product page" | Navigate to a `/vp/products/` URL |
| "GOOGLE_SHEET_ID not configured" | Add to `backend/.env` |
| "Port 8787 is already in use" | Kill existing process or change port |

---

## Step 2 Alternative: CLI Scraper (requires cookie)

The CLI scraper fetches Coupang pages directly but requires authentication.

### Running the CLI Scraper

**Dry-run mode** (no sheet write):
```bash
npm run coupang:scrape:dry
```

**Real mode** (writes to sheet):
```bash
npm run coupang:scrape:run
```

**Custom URL**:
```bash
node scripts/coupang-scrape-to-sheet.js --url "https://www.coupang.com/vp/products/XXXXX?itemId=YYY&vendorItemId=ZZZ"
```

### Getting a Coupang Cookie (for CLI mode)

1. Open Chrome, go to coupang.com, log in
2. Open DevTools (F12) → Network tab
3. Refresh the page
4. Click on any request to coupang.com
5. Copy the `Cookie` header value
6. Paste into `backend/.env`:
   ```bash
   COUPANG_COOKIE=your_long_cookie_string_here
   ```

---

## Step 3: Qoo10 Registration

## Environment Setup

### 1. Create Environment File

```bash
cp backend/.env.example backend/.env
```

### 2. Configure Variables

Edit `backend/.env`:

```bash
# Required
QOO10_SAK=your-seller-auth-key-here

# Optional (defaults shown)
QOO10_TRACER=0
QOO10_ALLOW_REAL_REG=0
```

### 3. Verify Setup

```bash
npm run qoo10:env
```

Expected output:
```
✓ QOO10_SAK is set
```

---

## Daily Operations

### Dry-Run Registration (Default)

Test registration without creating real products:

```bash
npm run qoo10:register:sample
```

Expected output:
```
⚠️  DRY-RUN MODE: Set QOO10_ALLOW_REAL_REG=1 in backend/.env to perform real registration.

=== Registration Result ===
Success: false
ResultCode: -1
ResultMsg: Dry-run mode - registration skipped
```

### Real Registration

1. Enable real registration in `backend/.env`:
   ```bash
   QOO10_ALLOW_REAL_REG=1
   ```

2. Run registration:
   ```bash
   npm run qoo10:register:sample
   ```

3. Expected output (success):
   ```
   === Registration Result ===
   Success: true
   ResultCode: 0
   ResultMsg: SUCCESS
   CreatedItemId (GdNo): 1234567890
   AIContentsNo: 9876543210
   ```

4. **Important**: Disable after testing:
   ```bash
   QOO10_ALLOW_REAL_REG=0
   ```

---

## Debugging

### Enable Tracer Mode

For detailed request/response logging:

```bash
# Option 1: Set in .env
QOO10_TRACER=1

# Option 2: Set inline
QOO10_TRACER=1 npm run qoo10:register:sample
```

Tracer output includes:
- Request URL and headers (key masked)
- Request body (URL-encoded params)
- Raw response
- Generated curl command (masked)

### Common Error Codes

| Code | Message | Cause | Solution |
|------|---------|-------|----------|
| `-999` | Object reference not set | Missing required field | Check all required fields |
| `-10001` | Duplicate seller code | SellerCode already exists | Code auto-generates unique codes |
| `-10004` | Invalid category | Bad SecondSubCat | Verify category ID |
| `0` | SUCCESS | Registration successful | - |

### Debug Harness

Run incremental parameter testing:

```bash
npm run qoo10:debug:setnewgoods
```

---

## Custom Product Registration

### Using Custom JSON

1. Create a JSON file with product data:
   ```json
   {
     "SecondSubCat": "320002604",
     "ItemTitle": "My Product",
     "ItemPrice": "5000",
     "ItemQty": "10",
     "StandardImage": "https://example.com/image.jpg",
     "ItemDescription": "<p>Description</p>"
   }
   ```

2. Run with custom file:
   ```bash
   node scripts/qoo10-register-cli.js path/to/your-product.json
   ```

### Adding Options

```json
{
  "Options": {
    "type": "SIZE",
    "values": [
      {"name": "S", "priceDelta": 0},
      {"name": "M", "priceDelta": 200}
    ]
  }
}
```

### Adding Extra Images

```json
{
  "ExtraImages": [
    "https://example.com/extra1.jpg",
    "https://example.com/extra2.jpg"
  ]
}
```

---

## Incident Response

### Registration Stuck

1. Check environment:
   ```bash
   npm run qoo10:env
   ```

2. Test connection:
   ```bash
   npm run qoo10:test:lookup
   ```

3. Enable tracer and retry:
   ```bash
   QOO10_TRACER=1 npm run qoo10:register:sample
   ```

### API Key Issues

If `QOO10_SAK not set` error:
1. Verify `backend/.env` exists
2. Check key is not empty
3. Restart terminal (if using exports)

### Network Issues

If connection timeout:
1. Check internet connectivity
2. Verify Qoo10 API is accessible
3. Check for IP restrictions

---

## Maintenance

### Update Documentation

After code changes:

```bash
npm run docs:sync
```

### Git Workflow

1. Create feature branch
2. Make changes
3. Update docs if needed
4. Submit PR using template

---

## Contacts

| Role | Contact |
|------|---------|
| Qoo10 API Support | TODO: Add contact |
| Sheet Admin | TODO: Add contact |

---

## Related Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
- [SHEET_SCHEMA.md](./SHEET_SCHEMA.md) - Google Sheet schema
- [LOCAL_SETUP_STEPS.md](../LOCAL_SETUP_STEPS.md) - Detailed setup guide

---

## TODO: Future Work

### SecondSubCat Resolver Module

The `SecondSubCat` field (Qoo10 category ID) is currently left as a placeholder during Coupang scraping. A resolver module is needed:

1. **Download Qoo10 category catalog** via Qoo10 API (`ItemsLookup.GetAllGlobalBrandInfo` or official export)
2. **Store locally** as a versioned JSON file (e.g., `data/qoo10-categories-v1.json`)
3. **Implement search/mapping strategy**:
   - Keyword matching from Coupang title/category
   - Manual mapping table for common categories
   - Fallback to default category if no match
4. **Integration**: Call resolver from `coupang-scrape-to-sheet.js` before writing to sheet
