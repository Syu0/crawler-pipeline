# Context Packet

Quick reference document for LLM handoffs and onboarding.

> **Auto-synced**: Run `npm run docs:sync` to update from ARCHITECTURE.md

---

## Project Identity

| Field | Value |
|-------|-------|
| Name | qoo10-debug-project |
| Version | 1.0.0 |
| Commit | (run docs:sync) |
| Last Sync | 2026-02-08 |

---

## What This Project Does

**One-liner**: Coupang product scraper → Google Sheets → Qoo10 registration pipeline.

**Pipeline**:
```
┌──────────────────────┐     ┌─────────────────────────────┐     ┌──────────────────┐
│  yamyam Chrome Ext   │ ──▶ │ Playwright 서버사이드 수집기  │ ──▶ │  Google Sheets   │
│  (쿠키 갱신)         │     │ (stealth + 쿠키 주입)        │     │  (coupang_datas) │
└──────────────────────┘     └─────────────────────────────┘     └──────────────────┘
                                                                          │
                                                                          ▼
                                                                  ┌──────────────────┐
                                                                  │  Qoo10 CLI       │
                                                                  │  (Step 3)        │
                                                                  └──────────────────┘
```

---

## Key Entry Points

| Step | File | Purpose |
|------|------|---------|
| Step 1 | `chrome-extension/yamyam/` | 쿠키 원클릭 갱신 확장 |
| Step 1 | `scripts/coupang-playwright-scrape.js` | Playwright 서버사이드 수집기 |
| Step 2 | `scripts/lib/sheetsClient.js` | Google Sheets API client |
| Step 3 | `scripts/qoo10-register-cli.js` | Register product to Qoo10 |
| Step 3 | `backend/qoo10/registerNewGoods.js` | Core registration logic |

---

## Environment Variables

### Step 2 (Coupang → Sheet)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GOOGLE_SHEET_ID` | Yes | - | Target Google Sheet ID |
| `GOOGLE_SHEET_TAB_NAME` | No | `coupang_datas` | Tab name |
| `GOOGLE_SERVICE_ACCOUNT_JSON_PATH` | Yes | - | Path to service account key |
| `COUPANG_COOKIE` | Yes | - | Playwright 수집기에서 사용하는 쿠팡 인증 쿠키 (yamyam으로 갱신) |

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
- **Phase**: Step 1 + Step 3 implemented
- **Last updated**: 2026-03-11
- **Features complete**:
  - Step 1: yamyam Chrome Extension (쿠키 갱신)
  - Step 1: Playwright + stealth 서버사이드 수집 (Akamai 우회)
  - Step 1: 쿠키 만료 이메일 알림 (D-3/D-0, meaningful.jy@gmail.com)
  - Step 2: Google Sheets upsert (Service Account auth)
  - Step 2: StandardImage normalization (`thumbnails/...`)
  - Step 3: Qoo10 registration via SetNewGoods
  - Step 3: Single option group, ExtraImages support
  - Step 3: SetGoodsPriceQty (재고/가격 업데이트) API 검증 완료
  - Cross-platform npm scripts (Windows compatible)
- **Features pending**:
  - TODO: 재고 모니터링 + Qoo10 qty=0 업데이트
  - TODO: 룰 기반 자동 검수 시스템
  - TODO: Write GdNo back to Google Sheet after registration
  - TODO: Multi-option support (SIZE + COLOR)
<!-- SYNC_STATUS_END -->

---

## Quick Commands

All npm scripts are **cross-platform** (Windows/macOS/Linux) via `cross-env`.

```bash
# Step 1: Playwright 수집 (dry-run)
npm run coupang:pw:dry:trace

# Step 1: Playwright 수집 (실제 수집 + Sheets 저장)
npm run coupang:pw:run

# Step 3: Qoo10 registration (dry-run)
npm run qoo10:register:sample

# Step 3: Qoo10 registration (real, needs QOO10_ALLOW_REAL_REG=1)
npm run qoo10:register:with-extraimages-options
```

---

## Related Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Full architecture
- [SHEET_SCHEMA.md](./SHEET_SCHEMA.md) - Sheet column definitions
- [RUNBOOK.md](./RUNBOOK.md) - Operational procedures (incl. Service Account setup)
