# Qoo10 QAPI Integration - Product Requirements Document

## Original Problem Statement
Establish a debugging and development harness for integrating with the Qoo10 QAPI using Node.js. The primary focus is on the `ItemsBasic.SetNewGoods` endpoint to register new products.

## Core Requirements
1. Create a reusable Node.js module for product registration
2. Implement a command-line interface (CLI) to trigger the registration
3. Support a "dry-run" mode to prevent accidental API calls
4. Add support for product variants/options
5. Add support for supplementary product images (DetailImages and ExtraImages)
6. Extract and return `AIContentsNo` from API responses

## User Personas
- **Qoo10 Sellers**: Need programmatic product registration
- **Developers**: Need debugging tools and clear documentation

---

## What's Been Implemented

### Core Features (COMPLETE)
- [x] Reusable Node.js module (`backend/qoo10/registerNewGoods.js`)
- [x] CLI runner (`scripts/qoo10-register-cli.js`)
- [x] Environment configuration via `dotenv` (backend/.env)
- [x] Dry-run mode (default) with `QOO10_ALLOW_REAL_REG` toggle
- [x] Tracer mode for debugging (`QOO10_TRACER`)
- [x] Unique SellerCode generation
- [x] Auto-resolution of ShippingNo

### Product Options/Variants (COMPLETE)
- [x] Support for `Options` field in JSON payload
- [x] `AdditionalOption` parameter construction
- [x] CLI output shows options applied

### Image Support (COMPLETE)
- [x] `DetailImages`: Appended as `<hr/><img src="URL" />` to ItemDescription
- [x] `ExtraImages`: Appended as `<br/><p><img src="URL" /></p>` to ItemDescription
- [x] `AIContentsNo` extraction from API response
- [x] `aiContentsNo` included in result object and CLI output

### Single Option Support (COMPLETE)
- [x] `Options` field with single type (e.g., SIZE or COLOR)
- [x] `AdditionalOption` parameter construction: `Type||*Name||*PriceDelta$$...`
- [x] Validation: type required, values array required, priceDelta ≥ 0, no `$$` or `||*` in names
- [x] CLI output shows `Options applied: YES/NO` and `Option summary`
- [x] Tracer output shows raw `AdditionalOption` string
- [x] Combined sample: `sample-with-extraimages-options.json`

---

## Prioritized Backlog

### P0 - None (All urgent items complete)

### P1 - Future Enhancements
- [ ] Implement `UpdateGoods` endpoint for updating existing products
- [ ] Inventory management endpoints
- [ ] Batch product registration support

### P2 - Nice to Have
- [ ] Web UI for product registration
- [ ] Response caching for delivery group info
- [ ] Automated test suite

---

## Technical Architecture

```
/app
├── backend/
│   ├── .env.example         # Environment template
│   └── qoo10/
│       ├── registerNewGoods.js      # Core module
│       ├── sample-newgoods.json     # Basic sample
│       ├── sample-with-options.json # Options sample
│       └── sample-with-extraimages.json # ExtraImages sample
├── scripts/
│   ├── lib/
│   │   └── qoo10Client.js   # Low-level QAPI client
│   └── qoo10-register-cli.js # CLI runner
└── package.json             # NPM scripts
```

## Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `QOO10_SAK` | - | **Required:** Seller Auth Key |
| `QOO10_ALLOW_REAL_REG` | `0` | Set to `1` to enable real registration |
| `QOO10_TRACER` | `0` | Set to `1` for verbose logging |

## Hardcoded Defaults
| Parameter | Default | Notes |
|-----------|---------|-------|
| ShippingNo | `471554` | Auto-resolve disabled, override via JSON |
| SellerCode prefix | `auto` | Always `auto`, input ignored |
| ProductionPlaceType | `2` | 海外 (Overseas) |
| ProductionPlace | `Overseas` | Override via JSON |

## Available Commands
```bash
npm run qoo10:register:sample            # Basic registration
npm run qoo10:register:with-options      # With product variants
npm run qoo10:register:with-extraimages  # With extra images
npm run qoo10:register:with-extraimages-options  # With extra images + options
```

---

## Last Updated
December 8, 2025 - Added single-option support via AdditionalOption
