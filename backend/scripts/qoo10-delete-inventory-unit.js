#!/usr/bin/env node
/**
 * qoo10-delete-inventory-unit.js — 옵션 단위 삭제 CLI
 *
 * Usage:
 *   node backend/scripts/qoo10-delete-inventory-unit.js \
 *     --itemCode=1197862497 --optionName=数量 --optionValue=5個 --optionCode=5
 *   npm run qoo10:inventory:delete-unit -- --itemCode=... --optionName=... --optionValue=... --optionCode=...
 */

'use strict';

require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
});

const { deleteInventoryDataUnit } = require('../qoo10/deleteInventoryDataUnit');

function parseArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

async function main() {
  const itemCode = parseArg('itemCode');
  const optionName = parseArg('optionName');
  const optionValue = parseArg('optionValue');
  const optionCode = parseArg('optionCode');
  const sellerCode = parseArg('sellerCode') || '';

  if (!itemCode || !optionName || !optionValue || !optionCode) {
    console.error('[qoo10-delete-inventory-unit] 필수 인수 누락');
    console.error('  --itemCode=<값>');
    console.error('  --optionName=<값>');
    console.error('  --optionValue=<값>');
    console.error('  --optionCode=<값>');
    process.exit(1);
  }

  console.log(`[qoo10-delete-inventory-unit] ItemCode=${itemCode} OptionName=${optionName} OptionValue=${optionValue} OptionCode=${optionCode}`);

  await deleteInventoryDataUnit({ itemCode, optionName, optionValue, optionCode, sellerCode });

  console.log(`[qoo10-delete-inventory-unit] 완료 — 옵션 삭제됨`);
}

main().catch((err) => {
  console.error('[qoo10-delete-inventory-unit] ERROR:', err.message);
  process.exit(1);
});
