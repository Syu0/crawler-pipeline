/**
 * batch-edit-contents.js — Phase 2 보강: ItemsContents.EditGoodsContents 51건 일괄 호출.
 *
 * Phase 2 UpdateGoods가 ItemDescription만 갱신했으나, Qoo10 상세페이지 본문(商品情報) 영역은
 * 별도 영역으로 EditGoodsContents API에서 관리. SetNewGoods 시점에 들어간 한국어 본문이 그대로
 * 잔존했음 (확인 2026-04-28). 본 스크립트는 본문도 image-only HTML로 덮어쓴다.
 *
 * 입력: title-rework-output.json (itemCode·hosted images만 사용)
 * 출력 로그: logs/batch-edit-contents.jsonl (idempotent)
 *
 * 실행:
 *   cd /Users/judy/dev/crawler-pipeline
 *   IMAGE_TUNNEL_BASE='https://xxx.trycloudflare.com' \
 *     node backend/image-processing/batch-edit-contents.js                         # dry-run
 *   IMAGE_TUNNEL_BASE='https://xxx.trycloudflare.com' QOO10_ALLOW_REAL_REG=1 \
 *     node backend/image-processing/batch-edit-contents.js --apply                 # apply
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { editGoodsContents } = require('../qoo10/editGoodsContents');

const HOSTED_DIR = path.join(__dirname, 'hosted', 'products');
const LOG_FILE = path.join(__dirname, 'logs', 'batch-edit-contents.jsonl');
const INPUT_FILE = path.join(__dirname, 'title-rework-output.json');
const TUNNEL_BASE = (process.env.IMAGE_TUNNEL_BASE || '').replace(/\/$/, '');

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

function listHostedImages(itemCode) {
  const dir = path.join(HOSTED_DIR, String(itemCode));
  if (!fs.existsSync(dir)) return { details: [], extras: [] };
  const files = fs.readdirSync(dir);
  const details = files.filter(f => /^detail_\d+\.jpg$/.test(f)).sort();
  const extras = files.filter(f => /^extra_\d+\.jpg$/.test(f)).sort();
  return {
    details: details.map(f => `${TUNNEL_BASE}/images/products/${itemCode}/${f}`),
    extras: extras.map(f => `${TUNNEL_BASE}/images/products/${itemCode}/${f}`),
  };
}

function buildHtml(details, extras) {
  // detail 우선, 없으면 extras. Phase 2와 동일 정책.
  const urls = details.length > 0 ? details : extras;
  if (urls.length === 0) return '<p>商品説明準備中</p>';
  return urls.map(u => `<p><img src="${u}" /></p>`).join('');
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (!TUNNEL_BASE) throw new Error('IMAGE_TUNNEL_BASE env required');
  if (apply && process.env.QOO10_ALLOW_REAL_REG !== '1') {
    throw new Error('--apply requires QOO10_ALLOW_REAL_REG=1');
  }

  const items = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
  const done = loadDoneSet();
  console.log(`[edit-contents] mode=${apply ? 'APPLY' : 'DRY-RUN'} done(log)=${done.size}`);
  console.log(`[edit-contents] tunnel=${TUNNEL_BASE}`);
  console.log('');

  let ok = 0, skipped = 0, failed = 0;
  for (const item of items) {
    const itemCode = String(item.itemCode);
    if (done.has(itemCode)) {
      console.log(`[skip] ${itemCode} (already done)`);
      skipped++;
      continue;
    }
    const { details, extras } = listHostedImages(itemCode);
    const html = buildHtml(details, extras);
    const t0 = Date.now();
    try {
      const r = await editGoodsContents({ itemCode, htmlContent: html });
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      const success = !!r.success && !r.skipped;
      if (success) ok++;
      else failed++;
      console.log(`[${success ? 'ok' : 'fail'}] ${itemCode} dt=${dt}s details=${details.length} extras=${extras.length} html=${html.length}B msg=${r.message}`);
      appendLog({ itemCode, success, dryRun: !apply, htmlSize: html.length, message: r.message });
    } catch (e) {
      failed++;
      console.error(`[exc] ${itemCode} ${e.message}`);
      appendLog({ itemCode, success: false, error: e.message });
    }
    if (apply) await new Promise(r => setTimeout(r, 800));
  }

  console.log('');
  console.log(`[edit-contents] ok=${ok} skipped=${skipped} failed=${failed}`);
}

main().catch(e => { console.error(e); process.exit(1); });
