/**
 * Coupang to Sheet - Content Script
 * 
 * This script runs in the context of Coupang product pages.
 * It provides utility functions for data extraction that can be called
 * from the popup via chrome.scripting.executeScript.
 * 
 * Note: The main extraction logic is in popup.js (extractProductData function)
 * which is injected directly. This content script serves as a marker that
 * the extension is active on the page.
 */

// Mark that extension content script is loaded
window.__COUPANG_TO_SHEET_LOADED__ = true;

// Log for debugging
console.log('[Coupang to Sheet] Content script loaded on:', window.location.href);
