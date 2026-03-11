# System Overview

## What This System Does

A pipeline to collect product data from Coupang (Korea) and register/update products on Qoo10 (Japan).

### Functional Blocks

```
A) COLLECT: Coupang product scraping → Google Sheet (coupang_datas)
B) CREATE:  Register new products to Qoo10 via SetNewGoods API
C) UPDATE:  Update existing products on Qoo10 via UpdateGoods API
D) CATEGORY: Resolve Coupang categories to Qoo10 Japan categories
```

## High-Level Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        DATA FLOW                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [Coupang URL]                                                   │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────┐     ┌───────────────────────────┐      │
│  │ yamyam Chrome Ext   │────▶│ Playwright 서버사이드 수집기│      │
│  │ (쿠키 갱신)         │     │ (stealth + 쿠키 주입)      │      │
│  └─────────────────────┘     └────────────┬──────────────┘      │
│                                            │                     │
│                                            ▼                     │
│                    ┌─────────────────────┐                      │
│                    │  Google Sheets      │                      │
│                    │  (coupang_datas)    │                      │
│                    └────────┬────────────┘                      │
│                             │                                    │
│                             ▼                                    │
│                    ┌─────────────────────┐                      │
│                    │ qoo10-auto-register │                      │
│                    │ (CLI executor)      │                      │
│                    └────────┬────────────┘                      │
│                             │                                    │
│              ┌──────────────┼──────────────┐                    │
│              ▼              ▼              ▼                    │
│     ┌────────────┐  ┌────────────┐  ┌────────────┐             │
│     │ Category   │  │ SetNewGoods│  │UpdateGoods │             │
│     │ Resolver   │  │ (CREATE)   │  │ (UPDATE)   │             │
│     └────────────┘  └────────────┘  └────────────┘             │
│                             │                                    │
│                             ▼                                    │
│                    ┌─────────────────────┐                      │
│                    │     Qoo10 API       │                      │
│                    └─────────────────────┘                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Module Structure

```
/app/backend/
├── coupang/
│   ├── sheetsClient.js      # Google Sheets read/write operations
│   └── scraper.js           # HTTP-based Coupang scraper (CLI mode)
├── category/
│   ├── parser.js            # Breadcrumb parsing
│   ├── sheetClient.js       # Category dictionary sheet operations
│   ├── resolver.js          # KR→JP category mapping
│   └── japanCategoriesSync.js  # Qoo10 category list sync
├── qoo10/
│   ├── client.js            # Qoo10 QAPI HTTP client
│   ├── registerNewGoods.js  # SetNewGoods API wrapper
│   ├── updateGoods.js       # UpdateGoods API wrapper
│   └── payloadGenerator.js  # Payload building utilities
└── .env                     # Environment configuration

/app/scripts/
├── coupang-playwright-scrape.js  # Playwright 서버사이드 수집기
├── coupang-scrape-to-sheet.js    # HTTP 기반 스크래퍼 (레거시)
├── qoo10-auto-register.js        # Main executor (CREATE/UPDATE)
├── qoo10-register-cli.js         # Single product registration CLI
└── qoo10-sync-japan-categories.js  # JP category sync CLI

/chrome-extension/yamyam/    # 쿠키 원클릭 갱신 전용 확장
├── manifest.json
├── popup.html
└── popup.js
```

## Google Sheet Tabs

| Tab | Purpose |
|-----|---------|
| `coupang_datas` | Product data (scraped → registered) |
| `coupang_categorys` | Coupang category dictionary |
| `category_mapping` | KR→JP category mappings |
| `japan_categories` | Qoo10 JP category list cache |

## API Methods Used

| API | Method | Purpose |
|-----|--------|---------|
| Qoo10 | `ItemsBasic.SetNewGoods` | Create new product |
| Qoo10 | `ItemsBasic.UpdateGoods` | Update existing product |
| Qoo10 | `ShippingBasic.GetSellerDeliveryGroupInfo` | Get shipping templates |
| Qoo10 | `CommonInfoLookup.GetCatagoryListAll` | Get JP category list |
| Google | Sheets API v4 | Read/write sheet data |
