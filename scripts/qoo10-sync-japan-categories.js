#!/usr/bin/env node
/**
 * Qoo10 Japan Categories Sync CLI
 * 
 * Fetches full Japan category list from Qoo10 API and overwrites
 * the "japan_categories" sheet tab.
 * 
 * Usage:
 *   node scripts/qoo10-sync-japan-categories.js
 *   npm run qoo10:sync:japan-categories
 * 
 * Environment (from backend/.env):
 *   QOO10_SAK - Qoo10 Seller Auth Key (required)
 *   GOOGLE_SHEET_ID - Target Google Sheet ID (required)
 *   GOOGLE_SERVICE_ACCOUNT_JSON_PATH - Path to service account key (required)
 */

const { syncJapanCategoriesToSheet } = require('./lib/japanCategoriesSync');

async function main() {
  console.log('='.repeat(60));
  console.log('  Qoo10 Japan Categories Sync');
  console.log('='.repeat(60));
  
  // Check required env vars
  if (!process.env.QOO10_SAK) {
    console.error('\nERROR: QOO10_SAK not set in backend/.env');
    console.error('Get your Seller Auth Key from Qoo10 QSM portal.');
    process.exit(1);
  }
  
  if (!process.env.GOOGLE_SHEET_ID) {
    console.error('\nERROR: GOOGLE_SHEET_ID not set in backend/.env');
    process.exit(1);
  }
  
  const result = await syncJapanCategoriesToSheet();
  
  if (result.success) {
    console.log('\n✅ Sync completed successfully!');
    console.log(`   Categories: ${result.count}`);
    process.exit(0);
  } else {
    console.error('\n❌ Sync failed:', result.error);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
