# Changelog

All notable changes to this project.

## 2025-12-XX

### Changed
- **Enhanced Pricing Formula with Commission and Margin Constraints**
  - Added market commission rate (10%), target margin rate (20%), minimum margin rate (25%)
  - New formula calculates both `requiredPrice` and `targetPrice`, uses the maximum
  - `requiredPrice = baseCostJpy / (1 - commission - minMargin)` ensures profitability
  - `targetPrice = baseCostJpy * (1 + targetMargin)` applies desired markup
  - Final price is `Math.round(Math.max(requiredPrice, targetPrice))`
  - Currency conversion uses division: `costKrw / FX_JPY_TO_KRW` (not multiplication)

### Added
- New pricing constants in `/app/backend/pricing/pricingConstants.js`:
  - `JAPAN_SHIPPING_JPY` (100) - moved from local variable
  - `MARKET_COMMISSION_RATE` (0.10)
  - `TARGET_MARGIN_RATE` (0.20)
  - `MIN_MARGIN_RATE` (0.25)

---

## 2025-02-10

### Changed
- **Pricing source changed**: Now uses `ItemPrice` as KRW input
  - `ItemPrice` is read as KRW, validated, converted to JPY
  - Computed JPY written to `qoo10SellingPrice` **before** API call
  - If `ItemPrice` is empty/invalid: row FAILS, no API call
  - Applies to BOTH CREATE and UPDATE operations
- **UpdateGoods payload structure**: Now uses full product structure identical to SetNewGoods
  - Includes all fields: `ShippingNo`, `TaxRate`, `ExpireDate`, `RetailPrice`, `ItemQty`, `Weight`
  - Removed diff-based change detection
  - Payload builds from: input values → sheet row values → defaults
  - Resolves Qoo10 API -999 errors caused by missing required fields

### Added
- `/app/backend/pricing/priceDecision.js` - Centralized pricing module
  - `decideItemPriceJpy()` - Strict validation with error reporting
  - `computeJpyFromKrw()` - KRW to JPY conversion with commission/margin calculation

### Refactored
- Reorganized code into module boundaries:
  - `/app/backend/coupang/` - Collection and sheet operations
  - `/app/backend/qoo10/` - API client and registration
  - `/app/backend/category/` - Category resolution
- Created backward-compatible shims in `/app/scripts/lib/`
- Removed unused test files

## 2025-02-09

### Added
- Category accumulation feature
  - `coupang_categorys` sheet for category dictionary
  - Breadcrumb parsing from Chrome extension
  - Category path normalization (`categoryPath2`, `categoryPath3`)

### Changed
- Category mapping now uses `categoryPath3` as primary key (not `categoryId`)
- Products with same category path share one mapping entry

## 2025-02-08

### Added
- Initial Coupang-to-Qoo10 pipeline
- Chrome extension for product scraping
- Qoo10 SetNewGoods integration
- Google Sheets as data store
- Category resolver with MANUAL/AUTO/FALLBACK modes
