# Coupang-to-Qoo10 Pipeline - Product Requirements Document

## Original Problem Statement
Build a pipeline to scrape Coupang product URLs, store data in Google Sheets, and register products on Qoo10 Japan via QAPI.

## Core Requirements
1. **Step 2**: Scrape Coupang product pages and write to Google Sheets
2. **Step 3**: Register products on Qoo10 via `ItemsBasic.SetNewGoods`
3. Support dry-run modes for both steps
4. Extract and normalize product data (images, weight, options)

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
  - Upserts to Google Sheets
- [x] `scripts/lib/sheetsClient.js` - Google Sheets API (Service Account)
- [x] StandardImage normalization (strip CDN to `thumbnails/...`)
- [x] WeightKg conversion (g→Kg, default 1)
- [x] Upsert by vendorItemId (fallback: itemId)
- [x] CLI alternative: `scripts/coupang-scrape-to-sheet.js` (requires cookie)

### Step 3: Qoo10 Registration (COMPLETE)
- [x] `backend/qoo10/registerNewGoods.js` - Core module
- [x] `scripts/qoo10-register-cli.js` - CLI runner
- [x] Single option group support (SIZE or COLOR)
- [x] ExtraImages injection into ItemDescription
- [x] Dry-run mode (`QOO10_ALLOW_REAL_REG=0`)
- [x] Fixed defaults: ShippingNo=471554, SellerCode prefix=auto

### Documentation System (COMPLETE)
- [x] `docs/ARCHITECTURE.md` - System architecture
- [x] `docs/SHEET_SCHEMA.md` - Google Sheet columns
- [x] `docs/RUNBOOK.md` - Operational procedures
- [x] `docs/CONTEXT_PACKET.md` - LLM handoff reference
- [x] `docs/adr/0001-foundation-decisions.md` - ADR
- [x] `npm run docs:sync` - Sync helper

---

## Prioritized Backlog

### P0 - Next Up
- [ ] SecondSubCat resolver module (Qoo10 category mapping)
- [ ] Write GdNo back to Google Sheet after registration

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
│       └── registerNewGoods.js   # Step 3 core module
├── scripts/
│   ├── lib/
│   │   ├── coupangScraper.js     # Step 2 scraper
│   │   ├── sheetsClient.js       # Step 2 sheets client
│   │   └── qoo10Client.js        # Step 3 QAPI client
│   ├── coupang-scrape-to-sheet.js # Step 2 CLI
│   └── qoo10-register-cli.js     # Step 3 CLI
├── docs/                         # Documentation
└── package.json
```

## Environment Variables

### Step 2 (Coupang Scraping)
| Variable | Default | Description |
|----------|---------|-------------|
| `GOOGLE_SHEET_ID` | - | Target Google Sheet ID |
| `GOOGLE_SHEET_TAB_NAME` | `coupang_datas` | Tab name |
| `GOOGLE_SERVICE_ACCOUNT_JSON_PATH` | - | Path to service account key |
| `COUPANG_SCRAPE_DRY_RUN` | `0` | Skip sheet write |
| `COUPANG_TRACER` | `0` | Verbose logging |
| `COUPANG_COOKIE` | - | For blocked requests |

### Step 3 (Qoo10 Registration)
| Variable | Default | Description |
|----------|---------|-------------|
| `QOO10_SAK` | - | Seller Auth Key |
| `QOO10_ALLOW_REAL_REG` | `0` | Enable real registration |
| `QOO10_TRACER` | `0` | Verbose logging |

## Available Commands
```bash
# Step 2
npm run coupang:scrape:dry    # Dry-run (no sheet write)
npm run coupang:scrape:run    # Real (writes to sheet)

# Step 3
npm run qoo10:register:sample                    # Dry-run registration
npm run qoo10:register:with-extraimages-options  # With images + options

# Docs
npm run docs:sync             # Sync documentation
```

---

## Last Updated
February 8, 2026 - Step 2 implemented (Coupang scraping → Google Sheets)
