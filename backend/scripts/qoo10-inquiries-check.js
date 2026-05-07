#!/usr/bin/env node
/**
 * qoo10-inquiries-check.js
 *
 * Qoo10 CSCenter.GetInquiryMessage 호출 → 미답변(S1) 고객 문의 카운트.
 * - proc_status=S1 (미답변) 기본
 * - 기본 윈도우: 최근 7일 (미답변은 며칠씩 누적될 수 있음)
 * - 결과 raw JSON 저장 + stdout 1줄 카운트 출력
 *
 * 사용법:
 *   node backend/scripts/qoo10-inquiries-check.js
 *   node backend/scripts/qoo10-inquiries-check.js --days=14
 *   node backend/scripts/qoo10-inquiries-check.js --status=S2  (처리중)
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { qoo10PostMethod } = require('../qoo10/client');

function ts() { return new Date().toLocaleString('sv'); }

function kstYmd(date) {
  return date.toLocaleDateString('sv', { timeZone: 'Asia/Seoul' }).replace(/-/g, '');
}

function parseArg(name, fallback) {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : fallback;
}

function extractItems(resp) {
  if (!resp || typeof resp !== 'object') return [];
  if (Array.isArray(resp.ResultObject)) return resp.ResultObject;
  if (Array.isArray(resp.Items)) return resp.Items;
  if (Array.isArray(resp.Result)) return resp.Result;
  return [];
}

(async () => {
  const days = parseInt(parseArg('days', '7'), 10);
  const status = parseArg('status', 'S1');

  const today = new Date();
  const start = new Date(today.getTime() - (days - 1) * 86400 * 1000);
  const startYmd = kstYmd(start);
  const endYmd = kstYmd(today);
  const todayIso = `${endYmd.slice(0,4)}-${endYmd.slice(4,6)}-${endYmd.slice(6,8)}`;

  console.log(`[${ts()}] [inquiries-check] window=${startYmd}~${endYmd} (${days}d) status=${status}`);

  const params = {
    search_start_dt: startYmd,
    search_end_dt: endYmd,
    proc_status: status,
  };

  let resp;
  try {
    resp = await qoo10PostMethod('CSCenter.GetInquiryMessage', params, '1.0');
  } catch (err) {
    console.error(`[${ts()}] [inquiries-check] ERROR: ${err.message}`);
    process.exit(1);
  }

  const items = extractItems(resp);
  const count = items.length;
  const resultCode = resp?.ResultCode;
  const resultMsg = resp?.ResultMsg || resp?.ReturnMessage || '';

  const outDir = path.join(__dirname, '..', '..', 'metrics', 'qoo10_inquiries', todayIso);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `inquiries_${status}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    request: params,
    resultCode,
    resultMsg,
    count,
    items,
  }, null, 2));

  const label = status === 'S1' ? '미답변' : status === 'S2' ? '처리중' : status === 'S3' ? '완료' : status;
  console.log(`[${ts()}] [inquiries] ${status}(${label})_last_${days}d=${count} | resultCode=${resultCode}`);
  console.log(`[${ts()}] [inquiries-check] saved → ${outPath}`);

  if (resultCode !== undefined && resultCode !== 0 && resultCode !== '0') {
    console.warn(`[${ts()}] [inquiries-check] WARN non-zero resultCode: ${resultCode} (${resultMsg})`);
  }
})();
