/**
 * Pricing Constants
 * 
 * Centralized constants for Coupang-to-Qoo10 pricing calculations.
 * 
 * Note: JAPAN_SHIPPING_JPY is now dynamically looked up from 
 * Txlogis_standard sheet based on product weight.
 */

// Fixed exchange rate: 1 JPY = 10 KRW
const FX_JPY_TO_KRW = 10;

// Korean domestic shipping cost (fixed)
const DOMESTIC_SHIPPING_KRW = 3800;

// Market commission rate (13%, based on Qoo10 selling price)
const MARKET_COMMISSION_RATE = 0.13;

// Target margin rate (40%)
const TARGET_MARGIN_RATE = 0.40;

// Minimum margin rate (25%)
const MIN_MARGIN_RATE = 0.25;

module.exports = {
  FX_JPY_TO_KRW,
  DOMESTIC_SHIPPING_KRW,
  MARKET_COMMISSION_RATE,
  TARGET_MARGIN_RATE,
  MIN_MARGIN_RATE
};
