# Context Packet

Quick reference document for LLM handoffs and onboarding.

> **Auto-synced**: Run `npm run docs:sync` to update from ARCHITECTURE.md

---

## Project Identity

| Field | Value |
|-------|-------|
| Name | qoo10-debug-project |
| Version | 1.0.0 |
| Commit | b5d5ec7 |
| Last Sync | 2026-02-08 |

---

## What This Project Does

**One-liner**: Coupang product scraper → Google Sheets → Qoo10 registration pipeline.

**Pipeline**:
```
Coupang URL → [Step 2: Scraper] → Google Sheet → [Step 3: Qoo10 CLI] → QAPI → Write GdNo back
                    ▲                                    ▲
               IMPLEMENTED                          IMPLEMENTED
```

---

## Key Entry Points

| Step | File | Purpose |
|------|------|---------|
| Step 2 | `scripts/coupang-scrape-to-sheet.js` | Scrape Coupang → write to Sheet |
| Step 2 | `scripts/lib/coupangScraper.js` | HTML parsing, field extraction |
| Step 2 | `scripts/lib/sheetsClient.js` | Google Sheets API client |
| Step 3 | `scripts/qoo10-register-cli.js` | Register product to Qoo10 |
| Step 3 | `backend/qoo10/registerNewGoods.js` | Core registration logic |

---

## Environment Variables

### Step 2 (Coupang Scraping)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GOOGLE_SHEET_ID` | Yes | - | Target Google Sheet ID |
| `GOOGLE_SHEET_TAB_NAME` | No | `coupang_datas` | Tab name |
| `GOOGLE_SERVICE_ACCOUNT_JSON_PATH` | Yes | - | Path to service account key |
| `COUPANG_SCRAPE_DRY_RUN` | No | `0` | Skip sheet write |
| `COUPANG_TRACER` | No | `0` | Verbose logging |
| `COUPANG_COOKIE` | No | - | For blocked requests |

### Step 3 (Qoo10 Registration)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `QOO10_SAK` | Yes | - | Seller Auth Key |
| `QOO10_ALLOW_REAL_REG` | No | `0` | Enable real registration |
| `QOO10_TRACER` | No | `0` | Verbose logging |

---

## Hardcoded Defaults (Step 3)

| Parameter | Value | Reason |
|-----------|-------|--------|
| ShippingNo | `471554` | Fixed seller shipping group |
| SellerCode prefix | `auto` | Consistent unique code generation |
| ProductionPlaceType | `2` | Overseas origin |
| Weight | Kg from scraper or `1` | Default 1 Kg |

---

## Current Status

<!-- SYNC_STATUS_START -->
- **Phase**: Step 2 + Step 3 implemented
- **Last updated**: 2026-02-08
- **Features complete**:
  - Step 2: Coupang HTML scraping (no-login)
  - Step 2: Google Sheets upsert (Service Account auth)
  - Step 2: StandardImage normalization, WeightKg conversion
  - Step 3: Qoo10 registration via SetNewGoods
  - Step 3: Single option group, ExtraImages support
  - Dry-run and tracer modes for both steps
- **Features pending**:
  - TODO: SecondSubCat resolver module (Qoo10 category mapping)
  - TODO: Write GdNo back to Google Sheet after registration
  - TODO: Multi-option support (SIZE + COLOR)
  - TODO: UpdateGoods endpoint
<!-- SYNC_STATUS_END -->

---

## Quick Commands

All npm scripts are **cross-platform** (Windows/macOS/Linux) via `cross-env`.

```bash
# Step 2: Scrape Coupang (dry-run)
npm run coupang:scrape:dry

# Step 2: Scrape Coupang (dry-run + tracer)
npm run coupang:scrape:dry:trace

# Step 2: Scrape Coupang (real)
npm run coupang:scrape:run

# Step 3: Qoo10 registration (dry-run)
npm run qoo10:register:sample

# Step 3: Qoo10 registration (real, needs QOO10_ALLOW_REAL_REG=1)
npm run qoo10:register:with-extraimages-options
```

---

## Next Step: SecondSubCat Resolver

The `SecondSubCat` field is a placeholder. Implement a resolver module:
1. Download Qoo10 category catalog via API
2. Store as versioned JSON
3. Map Coupang categories to Qoo10 categories

---

## Related Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Full architecture
- [SHEET_SCHEMA.md](./SHEET_SCHEMA.md) - Sheet column definitions
- [RUNBOOK.md](./RUNBOOK.md) - Operational procedures (incl. Service Account setup)
