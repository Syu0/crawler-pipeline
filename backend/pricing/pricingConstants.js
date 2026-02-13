/**
 * Pricing Constants
 * 
 * Centralized constants for Coupang-to-Qoo10 pricing calculations.
 */

// Fixed exchange rate: 1 JPY = 10 KRW
const FX_JPY_TO_KRW = 10;

// Korean domestic shipping cost (fixed)
const DOMESTIC_SHIPPING_KRW = 3000;

// Japan shipping cost (fixed, in JPY)
const JAPAN_SHIPPING_JPY = 100;

// Market commission rate (10%)
const MARKET_COMMISSION_RATE = 0.10;

// Target margin rate (20%)
const TARGET_MARGIN_RATE = 0.20;

// Minimum margin rate (25%)
const MIN_MARGIN_RATE = 0.25;

module.exports = {
  FX_JPY_TO_KRW,
  DOMESTIC_SHIPPING_KRW,
  JAPAN_SHIPPING_JPY,
  MARKET_COMMISSION_RATE,
  TARGET_MARGIN_RATE,
  MIN_MARGIN_RATE
};
