#!/usr/bin/env node
/**
 * qoo10-seller-daily.js — 매일 09:00 KST Qoo10 셀러 통계 + 시장 키워드 수집 (v0)
 *
 * v0 동작 (제한적):
 *   1. ✅ qsm.qoo10.jp 인기 키워드 페이지 — navigate + DOM 추출 (확실히 동작)
 *   2. ⚠️ seller.qoo10.jp 6개 endpoint — main world patch race로 시도. Authorization 캡처 실패 시 graceful skip.
 *
 * 알려진 문제 (v1에서 해결):
 *   - 같은 탭 navigate해도 React가 cached state라 initial XHR 안 일어남
 *   - 새 탭 open해도 patch inject 시점이 React initial XHR보다 늦어서 capture 실패
 *   - responsebody CDP 명령은 background 호출 + navigate timing 까다로움
 *
 * 회피책 (현재):
 *   - 사용자가 매일 1회 셀러 페이지 방문 시 cron이 그 시점 운 좋게 잡으면 데이터 수집
 *   - 그렇지 않으면 qsm만 수집 (시장 트렌드는 매일 변동하므로 가치 큼)
 *
 * 저장 경로: <repoRoot>/metrics/qoo10_seller/YYYY-MM-DD/{name}.json
 *
 * v1 TODO: page React 강제 트리거 (date range select 변경 자동) + responsebody 병렬 시작
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── 설정 ──────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TODAY = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }); // YYYY-MM-DD KST
const OUTPUT_DIR = path.join(REPO_ROOT, 'metrics', 'qoo10_seller', TODAY);

const SELLER_HOME = 'https://seller.qoo10.jp/ko/summary';
const QSM_POPULAR_KW = 'https://qsm.qoo10.jp/GMKT.INC.Gsm.Web/ADPlus/PopADPlusPopularKeyword.aspx?plus_type=KW';

// 매일 수집 endpoint (POST, 동일 body schema 사용)
const ENDPOINTS = [
  { name: 'transaction_table_date',       path: '/api/transaction/table/date' },
  { name: 'transaction_table_date_goods', path: '/api/transaction/table/date-goods' },
  { name: 'pageview_table_date',          path: '/api/pageview/table/date' },
  { name: 'pageview_keyword_rank',        path: '/api/pageview/keyword-rank/chart' },
  { name: 'pageview_channels',            path: '/api/pageview/channels/chart' },
  { name: 'customer_buyer_cnt',           path: '/api/customer/buyer-cnt/chart' }
];

// 기간: 최근 6개월 (today - 6m ~ today)
const endDt = TODAY;
const startDt = (() => {
  const d = new Date(TODAY + 'T00:00:00');
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().slice(0, 10);
})();

// ── Browser Relay helpers ────────────────────────────────────────────────────

function browserTabs() {
  const out = execSync('openclaw browser --browser-profile chrome tabs', { encoding: 'utf8', timeout: 15000 });
  return out;
}

function findTabId(urlSubstring) {
  const out = browserTabs();
  // tabs 출력 형식: "<title>\n   <url>\n   id: <id>\n"
  const lines = out.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(urlSubstring)) {
      // 다음 라인 또는 그 다음 라인에 id
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
  if (targetId) {
    execSync(`openclaw browser --browser-profile chrome navigate --target-id ${targetId} "${escUrl}"`,
             { encoding: 'utf8', timeout: 30000 });
  } else {
    execSync(`openclaw browser --browser-profile chrome navigate "${escUrl}"`,
             { encoding: 'utf8', timeout: 30000 });
  }
}

function browserOpenTab(url) {
  const escUrl = url.replace(/"/g, '\\"');
  const out = execSync(`openclaw browser --browser-profile chrome open "${escUrl}"`,
                       { encoding: 'utf8', timeout: 30000 });
  const m = out.match(/id:\s*([A-F0-9]+)/);
  return m ? m[1] : null;
}

function browserCloseTab(targetId) {
  try {
    execSync(`openclaw browser --browser-profile chrome close ${targetId}`,
             { encoding: 'utf8', timeout: 10000 });
  } catch (_) { /* ignore — close optional */ }
}

function browserEvaluate(targetId, fn) {
  const escFn = fn.replace(/'/g, "'\\''");
  const cmd = targetId
    ? `openclaw browser --browser-profile chrome evaluate --target-id ${targetId} --fn '${escFn}'`
    : `openclaw browser --browser-profile chrome evaluate --fn '${escFn}'`;
  const out = execSync(cmd, { encoding: 'utf8', timeout: 30000, maxBuffer: 50 * 1024 * 1024 });
  return JSON.parse(out);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Main world XHR/fetch patch ───────────────────────────────────────────────

const PATCH_FN = `() => {
  if (window.__mainPatched) return { already: true };
  const code = "(()=>{" +
    "window.__xhrCalls=[];window.__fetchCalls=[];" +
    "const _open=XMLHttpRequest.prototype.open;" +
    "const _send=XMLHttpRequest.prototype.send;" +
    "const _setReq=XMLHttpRequest.prototype.setRequestHeader;" +
    "XMLHttpRequest.prototype.open=function(m,u){this.__u=u;this.__m=m;this.__h={};return _open.apply(this,arguments);};" +
    "XMLHttpRequest.prototype.setRequestHeader=function(k,v){this.__h[k]=v;return _setReq.apply(this,arguments);};" +
    "XMLHttpRequest.prototype.send=function(body){const x=this;const u=this.__u,m=this.__m,h=this.__h;" +
    "x.addEventListener('loadend',function(){window.__xhrCalls.push({url:u,method:m,headers:h,status:x.status,t:Date.now()});});" +
    "return _send.apply(this,arguments);};" +
    "const _fetch=window.fetch.bind(window);" +
    "window.fetch=function(input,init){try{const u=typeof input==='string'?input:(input&&input.url)||'?';const me=(init&&init.method)||(typeof input==='object'&&input.method)||'GET';const he={};if(init&&init.headers){if(init.headers instanceof Headers)init.headers.forEach((v,k)=>he[k]=v);else if(Array.isArray(init.headers))init.headers.forEach(([k,v])=>he[k]=v);else Object.assign(he,init.headers);}window.__fetchCalls.push({url:u,method:me,headers:he,t:Date.now()});}catch(_){}return _fetch(input,init);};" +
    "window.__mainPatched=true;" +
  "})();";
  const s = document.createElement('script');
  s.textContent = code;
  (document.head || document.documentElement).appendChild(s);
  s.remove();
  return { injected: true };
}`;

// API 호출 (페이지 컨텍스트 fetch + 캡처된 Authorization 사용)
const buildCallFn = (endpoint, body) => `async () => {
  const lastApi = (window.__xhrCalls || [])
    .filter(c => /\\/api\\//.test(c.url) && c.headers && c.headers.Authorization)
    .pop();
  if (!lastApi) return { error: 'no_auth_captured' };
  const res = await fetch(${JSON.stringify(endpoint)}, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'Authorization': lastApi.headers.Authorization,
      'X-SELL-CUST-NO': lastApi.headers['X-SELL-CUST-NO']
    },
    body: ${JSON.stringify(JSON.stringify(body))}
  });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) {
    const json = await res.json();
    return { status: res.status, contentType: ct, json };
  }
  const text = await res.text();
  return { status: res.status, contentType: ct, text: text.substring(0, 1000) };
}`;

// qsm 인기 키워드 추출 (DOM table)
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

// ── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[qoo10-seller-daily] ${new Date().toISOString()} — output=${OUTPUT_DIR}`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const meta = {
    runAt: new Date().toISOString(),
    today: TODAY,
    startDt, endDt,
    sellerEndpoints: {},
    qsm: {},
    errors: []
  };

  // ── 1. Seller 페이지 새 탭 open + patch race ─────────────────────────────
  // 기존 탭은 cached React state — navigate해도 initial XHR 안 일어남.
  // 새 탭 open하면 fresh React → 즉시 /api/auth + transaction/* 호출. 그 시점에 patch inject (race).
  console.log('[seller] opening fresh tab for trade page');
  const sellerTabId = browserOpenTab('https://seller.qoo10.jp/ko/trade');
  if (!sellerTabId) throw new Error('failed to open new seller tab');
  console.log(`[seller] new tab=${sellerTabId}`);

  // 매우 빠른 patch race: 페이지 ready 직전에 evaluate 시도. evaluate 자체가 페이지 ready 기다리고
  // 즉시 실행 — React mount + initial XHR과 가장 가까운 시점.
  let probe = { count: 0 };
  for (let attempt = 1; attempt <= 2 && probe.count === 0; attempt++) {
    if (attempt > 1) {
      // 재시도: 같은 탭에 다시 navigate (force reload via URL change)
      browserNavigate(sellerTabId, `https://seller.qoo10.jp/ko/trade?_=${Date.now()}`);
    }
    // 즉시 patch inject — sleep 없이 바로
    try {
      browserEvaluate(sellerTabId, PATCH_FN);
    } catch (e) {
      // 페이지 ready 안 되어 evaluate 실패하면 짧게 기다리고 재시도
      await sleep(500);
      browserEvaluate(sellerTabId, PATCH_FN);
    }
    // initial XHR 대기
    await sleep(8000);
    probe = browserEvaluate(sellerTabId, `() => ({ count: (window.__xhrCalls || []).filter(c => c.headers && c.headers.Authorization).length, total: (window.__xhrCalls || []).length })`);
    console.log(`[seller] attempt ${attempt}: captured Authorization=${probe.count}/${probe.total}`);
  }
  if (probe.count === 0) {
    console.error('[seller] no auth captured — seller endpoint calls will fail');
    meta.errors.push({ ep: 'auth_capture', error: 'no_auth_captured' });
  }

  // ── 2. 6개 endpoint 호출 ──────────────────────────────────────────────────
  const body = {
    dateType: 'M', startDt, endDt,
    gdNos: [], gdlcCds: [],
    from: 0, page: 0, size: 9999,
    sortCd: '', sortType: 'Desc'
  };

  for (const ep of ENDPOINTS) {
    try {
      const result = browserEvaluate(sellerTabId, buildCallFn(ep.path, body));
      if (result.error) {
        console.warn(`[${ep.name}] ERROR: ${result.error}`);
        meta.errors.push({ ep: ep.name, error: result.error });
        continue;
      }
      const file = path.join(OUTPUT_DIR, `${ep.name}.json`);
      fs.writeFileSync(file, JSON.stringify(result.json, null, 2));
      const len = JSON.stringify(result.json).length;
      meta.sellerEndpoints[ep.name] = { status: result.status, len, path: ep.path };
      console.log(`[${ep.name}] status=${result.status} len=${len} → ${path.basename(file)}`);
    } catch (e) {
      console.error(`[${ep.name}] FAIL:`, e.message.split('\n')[0]);
      meta.errors.push({ ep: ep.name, error: e.message.substring(0, 200) });
    }
  }

  // ── 3. qsm 인기 키워드 ───────────────────────────────────────────────────
  let qsmTabId = findTabId('qsm.qoo10.jp');
  try {
    if (!qsmTabId) {
      console.log('[qsm] no existing tab — opening');
      browserNavigate(null, QSM_POPULAR_KW);
      await sleep(3000);
      qsmTabId = findTabId('qsm.qoo10.jp');
    } else {
      console.log(`[qsm] tab=${qsmTabId} — navigating`);
      browserNavigate(qsmTabId, QSM_POPULAR_KW);
    }
    await sleep(5000);

    const qsmResult = browserEvaluate(qsmTabId, QSM_EXTRACT_FN);
    if (qsmResult.error) {
      console.warn('[qsm] ERROR:', qsmResult.error);
      meta.errors.push({ ep: 'qsm_popular_kw', error: qsmResult.error });
    } else {
      const file = path.join(OUTPUT_DIR, 'qsm_popular_keywords.json');
      fs.writeFileSync(file, JSON.stringify(qsmResult, null, 2));
      meta.qsm.popularKeywords = { rowCount: qsmResult.rowCount, url: qsmResult.url };
      console.log(`[qsm_popular_kw] rowCount=${qsmResult.rowCount} → ${path.basename(file)}`);
    }
  } catch (e) {
    console.error('[qsm] FAIL:', e.message.split('\n')[0]);
    meta.errors.push({ ep: 'qsm_popular_kw', error: e.message.substring(0, 200) });
  }

  // ── 4. 새 탭 정리 ────────────────────────────────────────────────────────
  if (sellerTabId) browserCloseTab(sellerTabId);

  // ── 5. _meta.json 저장 ───────────────────────────────────────────────────
  meta.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUTPUT_DIR, '_meta.json'), JSON.stringify(meta, null, 2));

  const okCount = Object.keys(meta.sellerEndpoints).length + (meta.qsm.popularKeywords ? 1 : 0);
  const totalCount = ENDPOINTS.length + 1;
  console.log(`\n[summary] ${okCount}/${totalCount} OK, errors=${meta.errors.length}`);
  console.log(`[output] ${OUTPUT_DIR}`);

  if (meta.errors.length > 0 && okCount === 0) {
    process.exit(1); // 전부 실패
  }
}

main().catch(e => {
  console.error('FATAL:', e.stack || e.message);
  process.exit(1);
});
