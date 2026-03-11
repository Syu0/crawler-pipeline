#!/usr/bin/env node
/**
 * P1 Test: ItemsOrder.SetGoodsPriceQty
 * Usage: node scripts/qoo10-test-setpricequantity.js
 *
 * Required env:
 *   QOO10_SAK              - Seller Auth Key
 *   QOO10_ALLOW_REAL_REG=1 - Enable real API calls (default: dry-run)
 *   QOO10_TEST_ITEMCODE    - Override test item (default: 1194045329)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') });

const { qoo10PostMethod } = require('./lib/qoo10Client');

// ===== 3중 안전장치 =====
if (!process.env.QOO10_SAK) throw new Error('QOO10_SAK not set');
if (process.env.QOO10_ALLOW_REAL_REG !== '1') {
  console.log('[dry-run] QOO10_ALLOW_REAL_REG not set - skipping API calls');
  process.exit(0);
}
const ITEM_CODE = process.env.QOO10_TEST_ITEMCODE || '1194045329';

async function runCase(label, params) {
  console.log(`\n--- ${label} ---`);
  console.log('Params:', JSON.stringify(params));
  const res = await qoo10PostMethod('ItemsOrder.SetGoodsPriceQty', params, '1.1');
  const rc = res.ResultCode ?? res.resultCode ?? -999;
  const msg = res.ResultMsg || res.resultMsg || 'N/A';
  console.log(`ResultCode: ${rc}, ResultMsg: ${msg}`);
  return { label, rc, msg };
}

async function main() {
  const results = [];

  // Case 1: 정상 가격/재고 업데이트
  results.push(await runCase('Case 1: normal update', {
    returnType: 'application/json',
    ItemCode: ITEM_CODE,
    Price: '5000',
    Qty: '10',
    ExpireDate: '2030-12-31',
  }));

  // Case 2: 재고 0 (품절 시나리오)
  results.push(await runCase('Case 2: stockout (qty=0)', {
    returnType: 'application/json',
    ItemCode: ITEM_CODE,
    Price: '5000',
    Qty: '0',
    ExpireDate: '2030-12-31',
  }));

  // Case 3: 잘못된 ItemCode (에러 케이스)
  results.push(await runCase('Case 3: invalid ItemCode', {
    returnType: 'application/json',
    ItemCode: '0000000000',
    Price: '5000',
    Qty: '10',
    ExpireDate: '2030-12-31',
  }));

  // ===== 결과 요약 =====
  console.log('\n===== RESULT SUMMARY =====');
  results.forEach(r => {
    const ok = r.rc === 0 ? '✓' : '✗';
    console.log(`${ok} ${r.label}: code=${r.rc} msg=${r.msg}`);
  });
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
