# Coupang-to-Qoo10 Pipeline - Product Requirements Document

## Original Problem Statement
Build a pipeline to scrape Coupang product URLs, store data in Google Sheets, and register products on Qoo10 Japan via QAPI.

## Core Requirements
1. **Step 2**: Scrape Coupang product pages and write to Google Sheets
2. **Category Accumulation**: Build category dictionary for future Qoo10 mapping
3. **Step 5**: Register products on Qoo10 via `ItemsBasic.SetNewGoods`
4. Support dry-run modes for all steps
5. Extract and normalize product data (images, weight, options)

## User Personas
- **Qoo10 Sellers**: Need automated product registration from Coupang
- **Developers**: Need debugging tools and clear documentation

---

## What's Been Implemented

### Step 2: Coupang Scraping (COMPLETE)
- [x] **Chrome Extension** (`chrome-extension-coupang/`)
  - Manifest V3, popup UI with "Send to Sheet" button
  - Content script extracts data from DOM (no cookies exfiltrated)
  - Sends to local receiver via POST
- [x] **Local Receiver** (`scripts/coupang-receiver.js`)
  - HTTP server on port 8787
  - POST /api/coupang/upsert endpoint
  - Upserts to Google Sheets (`coupang_datas` tab)
- [x] `scripts/lib/sheetsClient.js` - Google Sheets API (Service Account)
- [x] StandardImage normalization (strip CDN to `thumbnails/...`)
- [x] WeightKg conversion (g→Kg, default 1)
- [x] Upsert by vendorItemId (fallback: itemId)
- [x] CLI alternative: `scripts/coupang-scrape-to-sheet.js` (requires cookie)

### Category Accumulation (COMPLETE - Feb 9, 2025)
- [x] **Breadcrumb Extraction** in `popup.js` (`extractBreadcrumbSegments()`)
- [x] **Category Parser** (`scripts/lib/categoryParser.js`)
  - Parses breadcrumb segments into structured data (depth2Path, depth3Path, etc.)
- [x] **Category Sheet Client** (`scripts/lib/categorySheetClient.js`)
  - Creates `coupang_categorys` tab if not exists
  - Upsert by `coupangCategoryId`
  - Tracks `usedCount` and timestamps
- [x] **Integration** in `coupang-receiver.js`
  - Automatically saves categories when scraping products

### Step 5: Qoo10 Registration (COMPLETE)
- [x] `backend/qoo10/registerNewGoods.js` - Core module
- [x] `scripts/qoo10-register-cli.js` - CLI runner
- [x] Single option group support (SIZE or COLOR)
- [x] ExtraImages injection into ItemDescription
- [x] Dry-run mode (`QOO10_ALLOW_REAL_REG=0`)
- [x] Fixed defaults: ShippingNo=471554, SellerCode prefix=auto
- [x] Write `qoo10ItemId` back to sheet after registration

### Documentation System (COMPLETE)
- [x] `docs/ARCHITECTURE.md` - System architecture
- [x] `docs/SHEET_SCHEMA.md` - Google Sheet columns (both tabs)
- [x] `docs/RUNBOOK.md` - Operational procedures
- [x] `docs/CONTEXT_PACKET.md` - LLM handoff reference
- [x] `docs/adr/0001-foundation-decisions.md` - ADR
- [x] `npm run docs:sync` - Sync helper

---

## Prioritized Backlog

### P0 - Next Up
- [ ] **SecondSubCat Resolver Module** (Qoo10 category mapping)
  - Download full Qoo10 category catalog
  - Store as versioned JSON file
  - Implement mapping strategy using `coupang_categorys` data

### P1 - Future Enhancements
- [ ] Multi-option support (SIZE + COLOR)
- [ ] UpdateGoods endpoint
- [ ] Batch registration from sheet

### P2 - Nice to Have
- [ ] Web UI
- [ ] Automated test suite

---

## Technical Architecture

```
/app
├── backend/
│   ├── .env.example              # Environment template
│   ├── keys/                     # Service account keys (gitignored)
│   └── qoo10/
│       └── registerNewGoods.js   # Step 5 core module
├── chrome-extension-coupang/     # Step 2 Chrome extension
│   ├── manifest.json
│   ├── popup.html/js/css
│   └── contentScript.js
├── scripts/
│   ├── lib/
│   │   ├── coupangScraper.js     # Step 2 scraper (CLI mode)
│   │   ├── sheetsClient.js       # Product sheet client
│   │   ├── categoryParser.js     # Category breadcrumb parser
│   │   ├── categorySheetClient.js # Category dictionary client
│   │   └── qoo10Client.js        # Step 5 QAPI client
│   ├── coupang-receiver.js       # Step 2 local receiver server
│   ├── coupang-scrape-to-sheet.js # Step 2 CLI (alt)
│   └── qoo10-register-cli.js     # Step 5 CLI
├── docs/                         # Documentation
└── package.json
```

## Google Sheet Tabs

| Tab | Purpose |
|-----|---------|
| `coupang_datas` | Product data (Step 2 → Step 5) |
| `coupang_categorys` | Category dictionary for mapping |

## Environment Variables

### Step 2 (Coupang Scraping)
| Variable | Default | Description |
|----------|---------|-------------|
| `GOOGLE_SHEET_ID` | - | Target Google Sheet ID |
| `GOOGLE_SHEET_TAB_NAME` | `coupang_datas` | Tab name |
| `GOOGLE_SERVICE_ACCOUNT_JSON_PATH` | - | Path to service account key |
| `COUPANG_RECEIVER_PORT` | `8787` | Local receiver port |
| `COUPANG_SCRAPE_DRY_RUN` | `0` | Skip sheet write |
| `COUPANG_TRACER` | `0` | Verbose logging |
| `COUPANG_COOKIE` | - | For CLI blocked requests |

### Step 5 (Qoo10 Registration)
| Variable | Default | Description |
|----------|---------|-------------|
| `QOO10_SAK` | - | Seller Auth Key |
| `QOO10_ALLOW_REAL_REG` | `0` | Enable real registration |
| `QOO10_TRACER` | `0` | Verbose logging |

## Available Commands
```bash
# Step 2 (Receiver mode - recommended)
npm run coupang:receiver:start   # Start local receiver

# Step 2 (CLI mode - requires cookie)
npm run coupang:scrape:dry       # Dry-run (no sheet write)
npm run coupang:scrape:run       # Real (writes to sheet)

# Step 5
npm run qoo10:register:sample                    # Dry-run registration
npm run qoo10:register:with-extraimages-options  # With images + options

# Docs
npm run docs:sync                # Sync documentation
```

---

## Last Updated
February 9, 2025 - Category Accumulation feature implemented
