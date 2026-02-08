# Architecture Overview

## System Context

This project implements **Step 2 and Step 3** of a Coupang-to-Qoo10 product pipeline:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Full Pipeline                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  Step 1: URL Input      Step 2: Scrape + Sheet      Step 3: Qoo10 Registration │
│  ┌───────────────┐     ┌─────────────────────┐     ┌─────────────────────────┐ │
│  │ Coupang URL   │ ──▶ │ THIS REPO           │ ──▶ │ THIS REPO               │ │
│  │ (User input)  │     │ coupang-scrape-to-  │     │ qoo10-register-cli.js   │ │
│  └───────────────┘     │ sheet.js            │     │ ★ IMPLEMENTED           │ │
│                        │ ★ IMPLEMENTED       │     └─────────────────────────┘ │
│                        └─────────────────────┘                 │               │
│                                    │                           ▼               │
│                                    ▼                    ┌─────────────┐        │
│                        ┌─────────────────────┐         │  Qoo10 JP   │        │
│                        │ Google Sheets       │         │  QAPI       │        │
│                        │ (coupang_datas tab) │         └─────────────┘        │
│                        └─────────────────────┘                 │               │
│                                                                ▼               │
│                                                     Write GdNo back (TODO)     │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 2: Coupang Scraper → Google Sheets

### Purpose
Scrape product data from Coupang URLs and store in Google Sheets for later registration.

### High-Level Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────────────┐
│  Coupang URL    │ ──▶ │  HTML Parsing    │ ──▶ │  Google Sheets     │
│  (CLI input)    │     │  (coupangScraper)│     │  (sheetsClient)    │
└─────────────────┘     └──────────────────┘     └────────────────────┘
```

### Key Fields Extracted

| Field | Source | Normalization |
|-------|--------|---------------|
| `ItemTitle` | og:title, title tag | HTML decode |
| `ItemPrice` | sale-price, data-price | Remove commas |
| `StandardImage` | og:image | Strip to `thumbnails/...` path |
| `ExtraImages` | Image URLs in page | Array, deduplicated |
| `WeightKg` | Weight text patterns | Convert g→Kg, default 1 |
| `SecondSubCat` | - | Placeholder (resolver TODO) |

---

## Step 3: Qoo10 Registration

### Purpose
Register products on Qoo10 Japan marketplace via QAPI (`ItemsBasic.SetNewGoods`).

### High-Level Flow

```
┌────────────────────┐     ┌─────────────────────┐     ┌──────────────────────┐
│  JSON Input File   │ ──▶ │  registerNewGoods() │ ──▶ │  Qoo10 QAPI Response │
│  (product data)    │     │  (core module)      │     │  (GdNo, AIContentsNo)│
└────────────────────┘     └─────────────────────┘     └──────────────────────┘
```

---

## Module Structure

```
/app
├── backend/
│   ├── .env                              # Environment variables (gitignored)
│   ├── .env.example                      # Template for env vars
│   ├── keys/                             # Service account keys (gitignored)
│   │   └── google-service-account.json   # Google API key (NOT committed)
│   └── qoo10/
│       ├── registerNewGoods.js           # ★ Step 3: Core registration module
│       ├── sample-newgoods.json          # Sample: basic product
│       └── sample-with-*.json            # Various test samples
│
├── scripts/
│   ├── lib/
│   │   ├── qoo10Client.js                # ★ Step 3: QAPI HTTP client
│   │   ├── coupangScraper.js             # ★ Step 2: HTML scraping logic
│   │   └── sheetsClient.js               # ★ Step 2: Google Sheets API
│   ├── coupang-scrape-to-sheet.js        # ★ Step 2: CLI entry point
│   ├── qoo10-register-cli.js             # ★ Step 3: CLI entry point
│   └── update-context-packet.js          # Docs sync helper
│
├── docs/                                 # Documentation
└── package.json                          # NPM scripts
```

### Entry Points

| Step | Entry Point | Path | Description |
|------|-------------|------|-------------|
| 2 | Coupang Scraper | `scripts/coupang-scrape-to-sheet.js` | Scrape URL → Sheet |
| 2 | Scraper Lib | `scripts/lib/coupangScraper.js` | HTML parsing logic |
| 2 | Sheets Client | `scripts/lib/sheetsClient.js` | Google Sheets API |
| 3 | Qoo10 CLI | `scripts/qoo10-register-cli.js` | Register to Qoo10 |
| 3 | Core Module | `backend/qoo10/registerNewGoods.js` | Registration logic |
| 3 | QAPI Client | `scripts/lib/qoo10Client.js` | HTTP wrapper |

### Data Flow (Step 2)

```
1. CLI reads JSON file
   └── scripts/qoo10-register-cli.js

2. Passes to core module
   └── backend/qoo10/registerNewGoods.js
       ├── Validates input fields
       ├── Generates unique SellerCode (auto + timestamp)
       ├── Applies default ShippingNo (471554)
       ├── Builds AdditionalOption string (if Options provided)
       ├── Appends ExtraImages to ItemDescription HTML
       └── Calls qoo10Client

3. QAPI Client makes HTTP request
   └── scripts/lib/qoo10Client.js
       └── POST to https://api.qoo10.jp/GMKT.INC.Front.QAPIService/ebayjapan.qapi/ItemsBasic.SetNewGoods

4. Response parsed and returned
   └── { success, createdItemId (GdNo), aiContentsNo, ... }
```

---

## Current Status

<!-- STATUS_START -->
- **Phase**: Step 3 implemented (Qoo10 registration)
- **Last updated**: 2025-02-08
- **Features complete**:
  - Basic product registration via SetNewGoods
  - Single option group support (SIZE, COLOR, etc.)
  - ExtraImages injection into ItemDescription
  - Dry-run mode (default)
  - Tracer mode for debugging
- **Features pending**:
  - TODO: Google Sheets integration (read product data)
  - TODO: Write GdNo back to Google Sheet
  - TODO: Multi-option support (SIZE + COLOR)
  - TODO: UpdateGoods endpoint
<!-- STATUS_END -->

---

## Key Technical Decisions

1. **Dry-run by default**: `QOO10_ALLOW_REAL_REG=1` required for real API calls
2. **Fixed SellerCode prefix**: Always `auto` + timestamp + random (ignores input)
3. **Fixed ShippingNo default**: `471554` (no auto-resolve API call)
4. **ProductionPlace default**: `2` (Overseas), `Overseas`
5. **Single option group**: Only one option type per product (SIZE **or** COLOR)

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| dotenv | ^17.2.4 | Load environment variables from .env |

---

## Related Documents

- [SHEET_SCHEMA.md](./SHEET_SCHEMA.md) - Google Sheet column definitions
- [RUNBOOK.md](./RUNBOOK.md) - Operational procedures
- [CONTEXT_PACKET.md](./CONTEXT_PACKET.md) - Quick reference for LLM/handoff
- [ADR-0001](./adr/0001-foundation-decisions.md) - Foundation architecture decisions
