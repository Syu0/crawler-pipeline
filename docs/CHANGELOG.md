# Changelog

All notable changes to this project.

## 2025-02-10

### Changed
- **STRICT Pricing Enforcement**: `CostPriceKrw` is now REQUIRED
  - If `CostPriceKrw` is empty, null, invalid, or <= 0: row FAILS immediately
  - No Qoo10 API call is made for invalid pricing
  - `registrationStatus` = `FAILED`, `registrationMessage` = `CostPriceKrw missing or invalid`
  - Applies to BOTH CREATE and UPDATE operations
- **Price Write-back**: Computed `ItemPrice (JPY)` is always written to `qoo10SellingPrice` column, even if API call fails
- **UpdateGoods payload structure**: Now uses full product structure identical to SetNewGoods
  - Includes all fields: `ShippingNo`, `TaxRate`, `ExpireDate`, `RetailPrice`, `ItemQty`, `Weight`
  - Removed diff-based change detection
  - Payload builds from: input values → sheet row values → defaults
  - Resolves Qoo10 API -999 errors caused by missing required fields

### Added
- `/app/backend/pricing/priceDecision.js` - Centralized pricing module
  - `decideItemPriceJpy()` - Strict validation with error reporting
  - `computeJpyFromKrw()` - KRW to JPY conversion (FX rate: 1 JPY = 10 KRW)

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
