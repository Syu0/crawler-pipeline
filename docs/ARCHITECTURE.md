# Architecture Overview

## System Context

This project implements **Step 3** of a larger Coupang-to-Qoo10 product pipeline:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Full Pipeline (Context)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Step 1: Coupang Scraper       Step 2: Google Sheets        Step 3: Qoo10  │
│  ┌─────────────────────┐      ┌──────────────────────┐     ┌─────────────┐ │
│  │ Coupang Rocket URL  │ ──▶  │ Product Data Sheet   │ ──▶ │ THIS REPO   │ │
│  │ (External scraper)  │      │ (Manual/automated)   │     │ Node.js CLI │ │
│  └─────────────────────┘      └──────────────────────┘     └─────────────┘ │
│                                                                    │        │
│                                                                    ▼        │
│                                                            ┌─────────────┐  │
│                                                            │  Qoo10 JP   │  │
│                                                            │  QAPI       │  │
│                                                            └─────────────┘  │
│                                                                    │        │
│                                                                    ▼        │
│                                                            Write GdNo back  │
│                                                            to Google Sheet  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## This Repository (Step 3)

### Purpose
Register products on Qoo10 Japan marketplace via QAPI (`ItemsBasic.SetNewGoods`).

### High-Level Flow

```
┌────────────────────┐     ┌─────────────────────┐     ┌──────────────────────┐
│  JSON Input File   │ ──▶ │  registerNewGoods() │ ──▶ │  Qoo10 QAPI Response │
│  (product data)    │     │  (core module)      │     │  (GdNo, AIContentsNo)│
└────────────────────┘     └─────────────────────┘     └──────────────────────┘
```

### Module Structure

```
/app
├── backend/
│   ├── .env                         # Environment variables (gitignored)
│   ├── .env.example                 # Template for env vars
│   └── qoo10/
│       ├── registerNewGoods.js      # ★ Core registration module
│       ├── sample-newgoods.json     # Sample: basic product
│       ├── sample-with-options.json # Sample: with variants
│       ├── sample-with-extraimages.json
│       └── sample-with-extraimages-options.json
│
├── scripts/
│   ├── lib/
│   │   └── qoo10Client.js           # ★ Low-level QAPI HTTP client
│   ├── qoo10-register-cli.js        # ★ CLI entry point
│   ├── qoo10-env-check.js           # Env validation helper
│   ├── qoo10-test-lookup.js         # Connection test script
│   └── qoo10-debug-setnewgoods.js   # Debug harness
│
├── docs/                            # Documentation (this folder)
└── package.json                     # NPM scripts
```

### Entry Points

| Entry Point | Path | Description |
|-------------|------|-------------|
| CLI Runner | `scripts/qoo10-register-cli.js` | Main CLI for product registration |
| Core Module | `backend/qoo10/registerNewGoods.js` | `registerNewGoods()` function |
| QAPI Client | `scripts/lib/qoo10Client.js` | HTTP wrapper for Qoo10 API |

### Data Flow

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
