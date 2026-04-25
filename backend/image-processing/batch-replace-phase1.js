/**
 * batch-replace-phase1.js — Phase 1: Standard + Extra 이미지 일괄 저작권 완화 교체.
 *
 * 대상: 시트의 registrationStatus='SUCCESS' + qoo10ItemId 있는 모든 상품.
 *
 * 각 상품:
 *   1) StandardImage (쿠팡 URL) → processImage → hosted/products/<itemCode>/main.jpg
 *      → EditGoodsImage(itemCode, tunnel_main_url)
 *   2) ExtraImages (배열) → processImage each → hosted/products/<itemCode>/extra_NN.jpg
 *      → EditGoodsMultiImage(itemCode, [tunnel_extra_urls...])
 *
 * Phase 2 (DetailImages / description HTML)는 보류 — `README.md` 참조.
 *
 * idempotent:
 *   - 로그(logs/batch-phase1.jsonl)에 상품별 step=success 있으면 skip
 *   - 재실행 시 실패한 상품만 재시도
 *
 * 실행:
 *   cd /Users/judy/dev/crawler-pipeline
 *   IMAGE_TUNNEL_BASE='https://xxx.trycloudflare.com' \
 *     node backend/image-processing/batch-replace-phase1.js          # dry-run
 *   IMAGE_TUNNEL_BASE='https://xxx.trycloudflare.com' QOO10_ALLOW_REAL_REG=1 \
 *     node backend/image-processing/batch-replace-phase1.js --apply
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const { getSheetsClient } = require('../coupang/sheetsClient');
const { processImage } = require('./processImage');
const { editGoodsImage } = require('../qoo10/editGoodsImage');
const { editGoodsMultiImage } = require('../qoo10/editGoodsMultiImage');

const HOSTED_DIR = path.join(__dirname, 'hosted', 'products');
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'batch-phase1.jsonl');

function parseUrls(cell) {
  if (!cell || typeof cell !== 'string') return [];
  const s = cell.trim();
  if (!s) return [];
  try {
    if (s.startsWith('[')) return JSON.parse(s).filter(Boolean);
  } catch (_) {}
  return s.split('|').map(u => u.trim()).filter(u => u && u.startsWith('http'));
}

function loadLog() {
  if (!fs.existsSync(LOG_FILE)) return { standard: new Set(), extras: new Set() };
  const lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n').filter(Boolean);
  const done = { standard: new Set(), extras: new Set() };
  for (const l of lines) {
    try {
      const e = JSON.parse(l);
      if (e.dryRun) continue; // dry-run 기록은 done으로 간주하지 않음
      if (e.success && e.step === 'standard') done.standard.add(e.itemCode);
      if (e.success && e.step === 'extras') done.extras.add(e.itemCode);
    } catch (_) {}
  }
  return done;
}

function appendLog(entry) {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function processStandard(itemCode, url, tunnelBase, apply) {
  const dir = path.join(HOSTED_DIR, String(itemCode));
  await fsp.mkdir(dir, { recursive: true });
  const localPath = path.join(dir, 'main.jpg');
  const tunnelUrl = `${tunnelBase}/images/products/${itemCode}/main.jpg`;

  const r = await processImage(url, localPath);

  if (!apply) {
    return { ok: true, tunnelUrl, dryRun: true, size: r.processedSize };
  }

  const api = await editGoodsImage(itemCode, tunnelUrl);
  return { ok: api.success, tunnelUrl, resultMsg: api.message, size: r.processedSize };
}

async function processExtras(itemCode, urls, tunnelBase, apply) {
  const dir = path.join(HOSTED_DIR, String(itemCode));
  await fsp.mkdir(dir, { recursive: true });

  const tunnelUrls = [];
  let totalSize = 0;
  for (let i = 0; i < urls.length; i++) {
    const n = String(i + 1).padStart(2, '0');
    const localPath = path.join(dir, `extra_${n}.jpg`);
    const r = await processImage(urls[i], localPath);
    totalSize += r.processedSize;
    tunnelUrls.push(`${tunnelBase}/images/products/${itemCode}/extra_${n}.jpg`);
  }

  if (!apply) {
    return { ok: true, count: tunnelUrls.length, tunnelUrls, dryRun: true, totalSize };
  }

  const api = await editGoodsMultiImage(itemCode, tunnelUrls);
  return { ok: api.success, count: tunnelUrls.length, resultMsg: api.resultMsg, totalSize };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const tunnelBase = (process.env.IMAGE_TUNNEL_BASE || '').replace(/\/$/, '');
  if (!tunnelBase) throw new Error('IMAGE_TUNNEL_BASE env required (e.g., https://xxx.trycloudflare.com)');
  if (apply && process.env.QOO10_ALLOW_REAL_REG !== '1') {
    throw new Error('--apply requires QOO10_ALLOW_REAL_REG=1');
  }

  console.log(`[batch] mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`[batch] tunnel base: ${tunnelBase}`);
  console.log(`[batch] log file: ${LOG_FILE}`);
  console.log('');

  const sheets = await getSheetsClient();
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const tab = process.env.GOOGLE_SHEET_TAB_NAME || 'coupang_datas';
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tab}!A1:ZZ`,
  });
  const [headers, ...rows] = res.data.values || [];

  const col = {
    status: headers.indexOf('registrationStatus'),
    itemCode: headers.indexOf('qoo10ItemId'),
    stdImg: headers.indexOf('StandardImage'),
    extras: headers.indexOf('ExtraImages'),
    title: headers.indexOf('ItemTitle'),
    vendor: headers.indexOf('vendorItemId'),
  };

  const targets = rows
    .filter(r => r[col.status] === 'SUCCESS' && r[col.itemCode] && r[col.stdImg])
    .map(r => ({
      itemCode: r[col.itemCode],
      vendorItemId: r[col.vendor],
      title: (r[col.title] || '').substring(0, 40),
      standardUrl: r[col.stdImg],
      extraUrls: parseUrls(r[col.extras]),
    }));

  const done = loadLog();
  console.log(`[batch] total SUCCESS targets: ${targets.length}`);
  console.log(`[batch] already done (from log): standard=${done.standard.size}, extras=${done.extras.size}`);
  console.log('');

  let okStd = 0, failStd = 0, skipStd = 0;
  let okExt = 0, failExt = 0, skipExt = 0;
  const failures = [];

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const idx = `${String(i + 1).padStart(2, '0')}/${targets.length}`;
    console.log(`[${idx}] itemCode=${t.itemCode} title="${t.title}" extras=${t.extraUrls.length}`);

    // STANDARD
    if (done.standard.has(String(t.itemCode))) {
      console.log(`       standard: SKIP (already done)`);
      skipStd++;
    } else {
      try {
        const r = await processStandard(t.itemCode, t.standardUrl, tunnelBase, apply);
        if (r.ok) {
          okStd++;
          console.log(`       standard: OK${r.dryRun ? ' (dry-run)' : ''}  ${(r.size / 1024).toFixed(0)}KB  ${r.resultMsg || ''}`);
          appendLog({ itemCode: t.itemCode, step: 'standard', success: true, tunnelUrl: r.tunnelUrl, dryRun: !apply });
        } else {
          failStd++;
          console.error(`       standard: FAIL ${r.resultMsg}`);
          appendLog({ itemCode: t.itemCode, step: 'standard', success: false, error: r.resultMsg });
          failures.push({ itemCode: t.itemCode, step: 'standard', error: r.resultMsg });
        }
      } catch (e) {
        failStd++;
        console.error(`       standard: EXCEPTION ${e.message}`);
        appendLog({ itemCode: t.itemCode, step: 'standard', success: false, error: e.message });
        failures.push({ itemCode: t.itemCode, step: 'standard', error: e.message });
      }
    }

    // EXTRAS
    if (t.extraUrls.length === 0) {
      // no extras to process
    } else if (done.extras.has(String(t.itemCode))) {
      console.log(`       extras:   SKIP (already done)`);
      skipExt++;
    } else {
      try {
        const r = await processExtras(t.itemCode, t.extraUrls, tunnelBase, apply);
        if (r.ok) {
          okExt++;
          console.log(`       extras:   OK${r.dryRun ? ' (dry-run)' : ''}  ${r.count}장  ${(r.totalSize / 1024).toFixed(0)}KB  ${r.resultMsg || ''}`);
          appendLog({ itemCode: t.itemCode, step: 'extras', success: true, count: r.count, dryRun: !apply });
        } else {
          failExt++;
          console.error(`       extras:   FAIL ${r.resultMsg}`);
          appendLog({ itemCode: t.itemCode, step: 'extras', success: false, error: r.resultMsg });
          failures.push({ itemCode: t.itemCode, step: 'extras', error: r.resultMsg });
        }
      } catch (e) {
        failExt++;
        console.error(`       extras:   EXCEPTION ${e.message}`);
        appendLog({ itemCode: t.itemCode, step: 'extras', success: false, error: e.message });
        failures.push({ itemCode: t.itemCode, step: 'extras', error: e.message });
      }
    }

    // 소폭 sleep — Qoo10 API rate
    if (apply) await sleep(800);
  }

  console.log('');
  console.log('=== 요약 ===');
  console.log(`  standard: OK=${okStd}  FAIL=${failStd}  SKIP=${skipStd}`);
  console.log(`  extras:   OK=${okExt}  FAIL=${failExt}  SKIP=${skipExt}`);
  console.log(`  total failures: ${failures.length}`);
  if (failures.length > 0) {
    console.log('');
    console.log('=== 실패 목록 ===');
    failures.forEach(f => console.log(`  ${f.itemCode} ${f.step}: ${f.error}`));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
