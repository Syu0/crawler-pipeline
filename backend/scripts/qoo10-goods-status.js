#!/usr/bin/env node
/**
 * qoo10-goods-status.js — Qoo10 상품 상태 변경 CLI
 *
 * Usage:
 *   node backend/scripts/qoo10-goods-status.js --status=1 --itemCode=1234567890
 *   npm run qoo10:goods:suspend     -- --itemCode=1234567890
 *   npm run qoo10:goods:resume      -- --itemCode=1234567890
 *   npm run qoo10:goods:discontinue -- --itemCode=1234567890
 *
 * Status:
 *   1 = 거래대기 (판매중지, 가역)
 *   2 = 거래가능 (재활성)
 *   3 = 거래폐지 (비가역 — 재활성 불가)
 */

'use strict';

require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
});

const { editGoodsStatus } = require('../qoo10/editGoodsStatus');

function parseArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

async function main() {
  const itemCode = parseArg('itemCode');
  const statusStr = parseArg('status');

  if (!itemCode) {
    console.error('[qoo10-goods-status] --itemCode=<값> 필수');
    process.exit(1);
  }
  if (!statusStr || !['1', '2', '3'].includes(statusStr)) {
    console.error('[qoo10-goods-status] --status=<1|2|3> 필수');
    console.error('  1 = 거래대기 (판매중지, 가역)');
    console.error('  2 = 거래가능 (재활성)');
    console.error('  3 = 거래폐지 (비가역 — 재활성 불가)');
    process.exit(1);
  }

  const status = Number(statusStr);

  if (status === 3) {
    console.warn('⚠️  거래폐지(Status=3)는 비가역입니다. 재활성 불가.');
  }

  console.log(`[qoo10-goods-status] ItemCode=${itemCode} Status=${status} 호출 중...`);

  await editGoodsStatus({ itemCode, status });

  const labels = { 1: '거래대기', 2: '거래가능', 3: '거래폐지' };
  console.log(`[qoo10-goods-status] 완료 — ${labels[status]} (Status=${status})`);
}

main().catch((err) => {
  console.error('[qoo10-goods-status] ERROR:', err.message);
  process.exit(1);
});
