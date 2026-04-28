/**
 * batch-replace-phase2.js — Phase 2: title + description + DetailImages 일괄 갱신.
 *
 * 흐름 (per item):
 *   1. 시트에서 row 읽음
 *   2. DetailImages 다운로드 → processImage → hosted/products/<itemCode>/detail_NN.jpg
 *   3. ExtraImages tunnel URLs 수집 (Phase 1에서 이미 hosted됨)
 *   4. descGen 재호출 (DetailImages·ExtraImages를 tunnel URL로 override) → 새 일본어 HTML
 *   5. UpdateGoods API 호출 (ItemTitle=fixedJpTitle, ItemDescription=새 HTML, ExtraImages=tunnel)
 *   6. log
 *
 * 안전장치:
 *   - logs/batch-phase2.jsonl idempotent (성공한 itemCode skip)
 *   - 순차 실행 (병렬 X)
 *   - 첫 1건은 콘솔에서 즉시 확인 가능 (--limit=1)
 *   - dry-run mode 지원
 *
 * 실행:
 *   cd /Users/judy/dev/crawler-pipeline
 *   IMAGE_TUNNEL_BASE='https://xxx.trycloudflare.com' \
 *     node backend/image-processing/batch-replace-phase2.js --limit=1                # dry-run 1건
 *   IMAGE_TUNNEL_BASE='https://xxx.trycloudflare.com' QOO10_ALLOW_REAL_REG=1 \
 *     node backend/image-processing/batch-replace-phase2.js --limit=1 --apply        # apply 1건
 *   IMAGE_TUNNEL_BASE='https://xxx.trycloudflare.com' QOO10_ALLOW_REAL_REG=1 \
 *     node backend/image-processing/batch-replace-phase2.js --apply                  # apply 전체
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const { processImage } = require('./processImage');
// const { generateJapaneseDescription } = require('../qoo10/descriptionGenerator');
// ↑ 보류: description 텍스트 본문은 README.md "Phase 2 보류 작업" 섹션 참조. 복구 시 require 복원.
const { updateExistingGoods } = require('../qoo10/updateGoods');
const { getSheetsClient } = require('../coupang/sheetsClient');

const HOSTED_DIR = path.join(__dirname, 'hosted', 'products');
const LOG_FILE = path.join(__dirname, 'logs', 'batch-phase2.jsonl');
const INPUT_FILE = path.join(__dirname, 'title-rework-output.json');
const TUNNEL_BASE = (process.env.IMAGE_TUNNEL_BASE || '').replace(/\/$/, '');

function parseUrls(cell) {
  if (!cell || typeof cell !== 'string') return [];
  const s = cell.trim();
  if (!s) return [];
  try {
    if (s.startsWith('[')) return JSON.parse(s).filter(Boolean);
  } catch (_) {}
  return s.split('|').map(u => u.trim()).filter(u => u && u.startsWith('http'));
}

function loadDoneSet() {
  if (!fs.existsSync(LOG_FILE)) return new Set();
  const lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n').filter(Boolean);
  const done = new Set();
  for (const l of lines) {
    try {
      const e = JSON.parse(l);
      if (e.success && !e.dryRun) done.add(String(e.itemCode));
    } catch (_) {}
  }
  return done;
}

function appendLog(entry) {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

async function processDetailImages(itemCode, urls) {
  const dir = path.join(HOSTED_DIR, String(itemCode));
  await fsp.mkdir(dir, { recursive: true });
  const tunnelUrls = [];
  for (let i = 0; i < urls.length; i++) {
    const n = String(i + 1).padStart(2, '0');
    const localPath = path.join(dir, `detail_${n}.jpg`);
    if (!fs.existsSync(localPath)) {
      await processImage(urls[i], localPath);
    }
    tunnelUrls.push(`${TUNNEL_BASE}/images/products/${itemCode}/detail_${n}.jpg`);
  }
  return tunnelUrls;
}

function existingExtraTunnelUrls(itemCode) {
  const dir = path.join(HOSTED_DIR, String(itemCode));
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => /^extra_\d+\.jpg$/.test(f)).sort();
  return files.map(f => `${TUNNEL_BASE}/images/products/${itemCode}/${f}`);
}

async function readSheetRows(sheets) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const tab = process.env.GOOGLE_SHEET_TAB_NAME || 'coupang_datas';
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tab}!A1:ZZ`,
  });
  const [headers, ...rows] = res.data.values || [];
  return rows.map(r => {
    const o = {};
    headers.forEach((h, i) => { o[h] = r[i] || ''; });
    return o;
  });
}

async function runOne(item, rowData, apply) {
  const itemCode = String(item.itemCode);
  const fixedJpTitle = item.fixedJpTitle;
  if (!fixedJpTitle) throw new Error('fixedJpTitle missing');

  // 1. DetailImages 처리
  const detailKrUrls = parseUrls(rowData.DetailImages);
  const tunnelDetails = detailKrUrls.length > 0 ? await processDetailImages(itemCode, detailKrUrls) : [];

  // 2. ExtraImages tunnel URLs (Phase 1)
  const tunnelExtras = existingExtraTunnelUrls(itemCode);

  // 3. description 생성 — **텍스트 본문 보류** (README.md "Phase 2 보류 작업" 섹션 참조).
  //    현재는 수집 tunnel 이미지만 임베드. 텍스트 본문은 향후 descGen prompt 보강 후 복구.
  //    DetailImages 우선, 없으면 ExtraImages fallback.
  const embedUrls = tunnelDetails.length > 0 ? tunnelDetails : tunnelExtras;
  const newHtml = embedUrls.length > 0
    ? embedUrls.map(u => `<p><img src="${u}" /></p>`).join('')
    : '<p>商品説明準備中</p>';
  const descMethod = embedUrls.length > 0 ? `images-only(${embedUrls.length})` : 'placeholder';

  if (!apply) {
    return {
      itemCode, fixedJpTitle, detailCount: tunnelDetails.length, extraCount: tunnelExtras.length,
      descMethod, descSize: newHtml.length,
      apiSuccess: null, dryRun: true,
    };
  }

  // 4. UpdateGoods 호출.
  //    StandardImage도 명시해야 함 — 미지정 시 시트의 쿠팡 원본 URL이 들어가 Phase 1 교체 무효화됨.
  const standardTunnelUrl = `${TUNNEL_BASE}/images/products/${itemCode}/main.jpg`;
  if (!fs.existsSync(path.join(HOSTED_DIR, itemCode, 'main.jpg'))) {
    throw new Error(`hosted main.jpg 없음 (${itemCode}) — Phase 1 미완 상품. 먼저 Phase 1 처리 필요.`);
  }
  const input = {
    ItemCode: itemCode,
    ItemTitle: fixedJpTitle,
    ItemPrice: rowData.qoo10SellingPrice,
    ItemDescription: newHtml,
    StandardImage: standardTunnelUrl,
    ExtraImages: tunnelExtras,
  };
  const apiResult = await updateExistingGoods(input, rowData);
  return {
    itemCode, fixedJpTitle, detailCount: tunnelDetails.length, extraCount: tunnelExtras.length,
    descMethod, descSize: newHtml.length,
    apiSuccess: !!apiResult.success, apiResultCode: apiResult.resultCode, apiResultMsg: apiResult.resultMsg,
  };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const limitArg = process.argv.find(a => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

  if (!TUNNEL_BASE) throw new Error('IMAGE_TUNNEL_BASE env required');
  if (apply && process.env.QOO10_ALLOW_REAL_REG !== '1') {
    throw new Error('--apply requires QOO10_ALLOW_REAL_REG=1');
  }

  const items = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
  const sheets = await getSheetsClient();
  const rows = await readSheetRows(sheets);
  const done = loadDoneSet();

  console.log(`[phase2] mode=${apply ? 'APPLY' : 'DRY-RUN'} limit=${limit === Infinity ? 'none' : limit} done(log)=${done.size}`);
  console.log(`[phase2] tunnel=${TUNNEL_BASE}`);
  console.log('');

  let count = 0, ok = 0, skipped = 0, failed = 0;
  for (const item of items) {
    if (count >= limit) break;
    if (done.has(String(item.itemCode))) {
      console.log(`[skip] ${item.itemCode} (already done)`);
      skipped++;
      continue;
    }
    const rowData = rows.find(r => r.qoo10ItemId === String(item.itemCode));
    if (!rowData) {
      console.log(`[skip] ${item.itemCode} (no sheet row)`);
      skipped++;
      continue;
    }

    const t0 = Date.now();
    try {
      const r = await runOne(item, rowData, apply);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      ok++;
      console.log(
        `[ok] ${item.itemCode} dt=${dt}s details=${r.detailCount} extras=${r.extraCount} ` +
        `desc=${r.descMethod}/${r.descSize}B api=${r.apiSuccess === null ? '(dry)' : r.apiSuccess}` +
        (r.apiResultMsg ? ` msg=${r.apiResultMsg}` : '')
      );
      appendLog({ itemCode: item.itemCode, success: r.apiSuccess !== false, ...r });
    } catch (e) {
      failed++;
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.error(`[fail] ${item.itemCode} dt=${dt}s ${e.message}`);
      appendLog({ itemCode: item.itemCode, success: false, error: e.message });
    }
    count++;
    if (apply) await new Promise(r => setTimeout(r, 800));
  }

  console.log('');
  console.log(`[phase2] processed=${count} ok=${ok} skipped=${skipped} failed=${failed}`);
}

main().catch(e => { console.error(e); process.exit(1); });
