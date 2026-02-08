# Context Packet

Quick reference document for LLM handoffs and onboarding.

> **Auto-synced**: Run `npm run docs:sync` to update from ARCHITECTURE.md

---

## Project Identity

| Field | Value |
|-------|-------|
| Name | qoo10-debug-project |
| Version | 1.0.0 |
| Commit | unknown |
| Last Sync | - |

---

## What This Project Does

**One-liner**: Node.js CLI to register products on Qoo10 Japan via QAPI.

**Pipeline Context**:
```
Coupang URL → [Scraper] → Google Sheet → [THIS REPO] → Qoo10 QAPI → Write GdNo back
                                              ▲
                                         You are here
```

---

## Key Entry Points

| File | Purpose |
|------|---------|
| `scripts/qoo10-register-cli.js` | CLI entry point |
| `backend/qoo10/registerNewGoods.js` | Core registration logic |
| `scripts/lib/qoo10Client.js` | HTTP client for QAPI |

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `QOO10_SAK` | Yes | - | Seller Auth Key |
| `QOO10_TRACER` | No | `0` | Enable verbose logging |
| `QOO10_ALLOW_REAL_REG` | No | `0` | Enable real registration |

---

## Hardcoded Defaults

| Parameter | Value | Reason |
|-----------|-------|--------|
| ShippingNo | `471554` | Fixed seller shipping group |
| SellerCode prefix | `auto` | Consistent unique code generation |
| ProductionPlaceType | `2` | Overseas origin |

---

## Current Status

<!-- SYNC_STATUS_START -->
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
<!-- SYNC_STATUS_END -->

---

## Quick Commands

```bash
# Dry-run registration
npm run qoo10:register:sample

# With tracer
QOO10_TRACER=1 npm run qoo10:register:sample

# Real registration (requires QOO10_ALLOW_REAL_REG=1 in .env)
npm run qoo10:register:with-extraimages-options
```

---

## Error Patterns

| Error | Likely Cause |
|-------|--------------|
| `QOO10_SAK not set` | Missing .env or empty key |
| `ResultCode: -999` | Missing required API field |
| `Dry-run mode` | QOO10_ALLOW_REAL_REG not set to 1 |

---

## Logging Approach

- **Console.log**: Used throughout for status messages
- **Tracer mode**: Detailed request/response when `QOO10_TRACER=1`
- **No external logger**: Simple console output only

---

## Related Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Full architecture
- [SHEET_SCHEMA.md](./SHEET_SCHEMA.md) - Sheet column definitions
- [RUNBOOK.md](./RUNBOOK.md) - Operational procedures
