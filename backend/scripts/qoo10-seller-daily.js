#!/usr/bin/env node
/**
 * qoo10-seller-daily.js — 매일 Qoo10 셀러 통계 + 시장 키워드 수집
 *
 * v1 동작:
 *   1. sellerCookieStore에서 JWT 로드 → seller API 6개 endpoint 직접 호출 (CDP 불필요)
 *   2. qsm.qoo10.jp 인기 키워드 — openclaw browser DOM 추출 (기존 방식 유지)
 *
 * 사전 설정 (최초 1회):
 *   node backend/scripts/seller-cookie-refresh.js
 *   (seller.qoo10.jp 탭 열린 상태에서 실행, 약 30일 유효)
 *
 * 저장 경로: <repoRoot>/metrics/qoo10_seller/YYYY-MM-DD/{name}.json
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { loadAuth, hoursUntilExpiry } = require('../services/sellerCookieStore');

// ── 설정 ──────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TODAY = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const OUTPUT_DIR = path.join(REPO_ROOT, 'metrics', 'qoo10_seller', TODAY);

const SELLER_BASE = 'https://seller.qoo10.jp';
const QSM_POPULAR_KW = 'https://qsm.qoo10.jp/GMKT.INC.Gsm.Web/ADPlus/PopADPlusPopularKeyword.aspx?plus_type=KW';

const ENDPOINTS = [
  { name: 'transaction_table_date',       path: '/api/transaction/table/date' },
  { name: 'transaction_table_date_goods', path: '/api/transaction/table/date-goods' },
  { name: 'pageview_table_date',          path: '/api/pageview/table/date' },
  { name: 'pageview_keyword_rank',        path: '/api/pageview/keyword-rank/chart' },
  { name: 'pageview_channels',            path: '/api/pageview/channels/chart' },
  { name: 'customer_buyer_cnt',           path: '/api/customer/buyer-cnt/chart' },
];

const endDt = TODAY;
const startDt = (() => {
  const d = new Date(TODAY + 'T00:00:00');
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().slice(0, 10);
})();

function ts() { return new Date().toLocaleString('sv'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── openclaw browser helpers (qsm 전용) ─────────────────────────────────────

function findTabId(urlSubstring) {
  const out = execSync('openclaw browser --browser-profile chrome tabs', { encoding: 'utf8', timeout: 15000 });
  const lines = out.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(urlSubstring)) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const m = lines[j].match(/id:\s*([A-F0-9]+)/);
        if (m) return m[1];
      }
    }
  }
  return null;
}

function browserNavigate(targetId, url) {
  const escUrl = url.replace(/"/g, '\\"');
  const cmd = targetId
    ? `openclaw browser --browser-profile chrome navigate --target-id ${targetId} "${escUrl}"`
    : `openclaw browser --browser-profile chrome navigate "${escUrl}"`;
  execSync(cmd, { encoding: 'utf8', timeout: 30000 });
}

function browserEvaluate(targetId, fn) {
  const escFn = fn.replace(/'/g, "'\\''");
  const cmd = targetId
    ? `openclaw browser --browser-profile chrome evaluate --target-id ${targetId} --fn '${escFn}'`
    : `openclaw browser --browser-profile chrome evaluate --fn '${escFn}'`;
  const out = execSync(cmd, { encoding: 'utf8', timeout: 30000, maxBuffer: 50 * 1024 * 1024 });
  return JSON.parse(out);
}

const QSM_EXTRACT_FN = `() => {
  const tables = [...document.querySelectorAll('table')];
  const mainTable = tables.reduce((max, t) => (t.rows.length > (max?.rows?.length || 0) ? t : max), null);
  if (!mainTable) return { error: 'no_main_table' };
  const rows = [];
  for (let i = 0; i < mainTable.rows.length; i++) {
    rows.push([...mainTable.rows[i].cells].map(c => c.textContent.trim().replace(/\\s+/g, ' ')));
  }
  return { url: location.href, rowCount: rows.length, rows };
}`;

// ── Seller API 직접 호출 ─────────────────────────────────────────────────────

async function callSellerEndpoint(endpointPath, auth, body) {
  const url = SELLER_BASE + endpointPath;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'Authorization': `Bearer ${auth.jwt}`,
      'X-SELL-CUST-NO': auth.custNo,
      'Cookie': auth.cookieHeader,
      'Origin': 'https://seller.qoo10.jp',
      'Referer': 'https://seller.qoo10.jp/ko/trade',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) {
    const text = await res.text();
    throw new Error(`non-JSON response (${ct}): ${text.substring(0, 200)}`);
  }

  return res.json();
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[${ts()}] qoo10-seller-daily v1 — output=${OUTPUT_DIR}`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const meta = {
    runAt: new Date().toISOString(),
    today: TODAY,
    startDt, endDt,
    sellerEndpoints: {},
    qsm: {},
    errors: [],
  };

  // ── 1. Seller API 직접 호출 ────────────────────────────────────────────────
  const auth = loadAuth();

  if (!auth) {
    const hours = hoursUntilExpiry();
    const reason = hours === -1 ? 'seller-cookie-refresh.js 미실행' : `JWT 만료 (${Math.abs(hours)}시간 전)`;
    console.warn(`[${ts()}] ⚠ seller auth 없음 — ${reason}`);
    console.warn(`[${ts()}]   → node backend/scripts/seller-cookie-refresh.js 실행 필요`);
    meta.errors.push({ ep: 'auth', error: `no_auth: ${reason}` });
  } else {
    const hours = hoursUntilExpiry();
    console.log(`[${ts()}] seller auth 로드 — custNo=${auth.custNo}, 만료까지 ${hours}h`);

    const body = {
      dateType: 'M', startDt, endDt,
      gdNos: [], gdlcCds: [],
      from: 0, page: 0, size: 9999,
      sortCd: '', sortType: 'Desc',
    };

    for (const ep of ENDPOINTS) {
      try {
        const json = await callSellerEndpoint(ep.path, auth, body);
        const file = path.join(OUTPUT_DIR, `${ep.name}.json`);
        fs.writeFileSync(file, JSON.stringify(json, null, 2));
        const len = JSON.stringify(json).length;
        meta.sellerEndpoints[ep.name] = { status: 200, len, path: ep.path };
        console.log(`[${ts()}] [${ep.name}] ✅ len=${len}`);
      } catch (e) {
        const msg = e.message.split('\n')[0];
        console.error(`[${ts()}] [${ep.name}] ❌ ${msg}`);
        meta.errors.push({ ep: ep.name, error: msg });

        // 401/403 → auth 만료. 이후 endpoint 모두 skip
        if (msg.includes('HTTP 401') || msg.includes('HTTP 403')) {
          console.error(`[${ts()}] ❌ auth 만료 — seller-cookie-refresh.js 재실행 필요`);
          meta.errors.push({ ep: 'auth_expired', error: 'JWT expired or invalid' });
          break;
        }
      }
    }
  }

  // ── 2. qsm 인기 키워드 ───────────────────────────────────────────────────
  let qsmTabId = findTabId('qsm.qoo10.jp');
  try {
    if (!qsmTabId) {
      console.log(`[${ts()}] [qsm] 탭 없음 — navigate`);
      browserNavigate(null, QSM_POPULAR_KW);
      await sleep(3000);
      qsmTabId = findTabId('qsm.qoo10.jp');
    } else {
      console.log(`[${ts()}] [qsm] tab=${qsmTabId} — navigate`);
      browserNavigate(qsmTabId, QSM_POPULAR_KW);
    }
    await sleep(5000);

    const qsmResult = browserEvaluate(qsmTabId, QSM_EXTRACT_FN);
    if (qsmResult.error) {
      console.warn(`[${ts()}] [qsm] ERROR:`, qsmResult.error);
      meta.errors.push({ ep: 'qsm_popular_kw', error: qsmResult.error });
    } else {
      const file = path.join(OUTPUT_DIR, 'qsm_popular_keywords.json');
      fs.writeFileSync(file, JSON.stringify(qsmResult, null, 2));
      meta.qsm.popularKeywords = { rowCount: qsmResult.rowCount, url: qsmResult.url };
      console.log(`[${ts()}] [qsm] ✅ rowCount=${qsmResult.rowCount}`);
    }
  } catch (e) {
    console.error(`[${ts()}] [qsm] FAIL:`, e.message.split('\n')[0]);
    meta.errors.push({ ep: 'qsm_popular_kw', error: e.message.substring(0, 200) });
  }

  // ── 3. _meta.json 저장 ───────────────────────────────────────────────────
  meta.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUTPUT_DIR, '_meta.json'), JSON.stringify(meta, null, 2));

  const sellerOk = Object.keys(meta.sellerEndpoints).length;
  const qsmOk = meta.qsm.popularKeywords ? 1 : 0;
  const totalOk = sellerOk + qsmOk;
  const totalPossible = ENDPOINTS.length + 1;
  console.log(`\n[${ts()}] summary: ${totalOk}/${totalPossible} OK`);
  console.log(`  seller: ${sellerOk}/${ENDPOINTS.length}`);
  console.log(`  qsm   : ${qsmOk}/1`);
  if (meta.errors.length > 0) {
    console.log(`  errors: ${meta.errors.map(e => e.ep).join(', ')}`);
  }
  console.log(`[output] ${OUTPUT_DIR}`);

  // qsm도 실패한 경우만 exit 1
  if (qsmOk === 0 && sellerOk === 0) process.exit(1);
}

main().catch(e => {
  console.error(`[${ts()}] FATAL:`, e.stack || e.message);
  process.exit(1);
});
