#!/usr/bin/env node
/**
 * qoo10-orders-check.js
 *
 * Qoo10 ShippingBasic.GetShippingInfo_v3 호출 → 오늘 결제된 미발송 신규 주문 카운트.
 * - ShippingStatus 공백: 1(배송대기) ~ 3(배송준비) 자동 조회
 * - SearchCondition=2: 결제일 기준
 * - 결과 raw JSON 저장 + stdout 1줄 카운트 출력
 *
 * 사용법:
 *   node backend/scripts/qoo10-orders-check.js
 *   node backend/scripts/qoo10-orders-check.js --date=20260507  (수동 일자 지정)
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { qoo10PostMethod } = require('../qoo10/client');

function ts() { return new Date().toLocaleString('sv'); }

function todayKst() {
  return new Date().toLocaleDateString('sv', { timeZone: 'Asia/Seoul' }).replace(/-/g, '');
}

function parseArgDate() {
  const arg = process.argv.find(a => a.startsWith('--date='));
  if (!arg) return null;
  const v = arg.split('=')[1];
  if (!/^\d{8}$/.test(v)) throw new Error(`--date must be yyyyMMdd, got ${v}`);
  return v;
}

function extractItems(resp) {
  if (!resp || typeof resp !== 'object') return [];
  if (Array.isArray(resp.ResultObject)) return resp.ResultObject;
  if (Array.isArray(resp.Items)) return resp.Items;
  if (Array.isArray(resp.Result)) return resp.Result;
  return [];
}

(async () => {
  const date = parseArgDate() || todayKst();
  const dateIso = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;

  console.log(`[${ts()}] [orders-check] date=${date} (status 1~3, paid)`);

  const params = {
    ShippingStatus: '',
    SearchStartDate: date,
    SearchEndDate: date,
    SearchCondition: '2',
  };

  let resp;
  try {
    resp = await qoo10PostMethod('ShippingBasic.GetShippingInfo_v3', params, '1.0');
  } catch (err) {
    console.error(`[${ts()}] [orders-check] ERROR: ${err.message}`);
    process.exit(1);
  }

  const items = extractItems(resp);
  const count = items.length;
  const resultCode = resp?.ResultCode;
  const resultMsg = resp?.ResultMsg || resp?.ReturnMessage || '';

  const outDir = path.join(__dirname, '..', '..', 'metrics', 'qoo10_orders', dateIso);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'orders.json');
  fs.writeFileSync(outPath, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    request: params,
    resultCode,
    resultMsg,
    count,
    items,
  }, null, 2));

  console.log(`[${ts()}] [orders] paid_today=${count} (status 1~3 = 미발송 신규) | resultCode=${resultCode}`);
  console.log(`[${ts()}] [orders-check] saved → ${outPath}`);

  if (resultCode !== undefined && resultCode !== 0 && resultCode !== '0') {
    console.warn(`[${ts()}] [orders-check] WARN non-zero resultCode: ${resultCode} (${resultMsg})`);
  }
})();
