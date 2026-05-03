#!/usr/bin/env node
/**
 * Extract gap candidates from qsm_popular_keywords + qoo10_seller_keywords snapshots.
 *
 * Two outputs:
 *  1. market_gap   — qsm 키워드 중 입찰중≤BID_MAX AND 주간평균검색수≥SEARCH_MIN
 *  2. inbound_gap  — 우리 유입 키워드(seller_keywords) 중 우리 등록 상품명/시장 키워드 어디에도 매칭되지 않는 것
 *
 * Usage:
 *   node scripts/analyze-keyword-gaps.js [date]
 *   date 미지정 시 research/data/ 의 최신 스냅샷 사용
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.openclaw',
  'workspace',
  'projects',
  'crawler-pipeline',
  'research',
  'data'
);
const OUT_DIR = DATA_DIR;

const BID_MAX = 3;
const SEARCH_MIN = 100;

function pickDate(arg) {
  if (arg) return arg;
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith('qsm_popular_keywords_'))
    .map((f) => f.replace('qsm_popular_keywords_', '').replace('.json', ''))
    .sort();
  return files[files.length - 1];
}

function num(s) {
  if (s == null) return NaN;
  return Number(String(s).replace(/,/g, '').trim());
}

function parseKeywordHead(raw) {
  // "アヌア (2)アヌア anua" → "アヌア"
  return String(raw || '')
    .split(/\s*\(/)[0]
    .trim();
}

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function extractMarketGap(date) {
  const file = path.join(DATA_DIR, `qsm_popular_keywords_${date}.json`);
  const blob = loadJSON(file);
  const rows = blob.rows.slice(2); // skip header rows
  const out = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 5) continue;
    const rank = String(r[0] || '').split(/\s+/)[0];
    const keyword = parseKeywordHead(r[1]);
    const searchAvg = num(r[2]);
    const searchYesterday = num(r[3]);
    const bidders = num(r[4]);
    if (!keyword) continue;
    if (!Number.isFinite(searchAvg) || !Number.isFinite(bidders)) continue;
    if (bidders > BID_MAX) continue;
    if (searchAvg < SEARCH_MIN) continue;
    out.push({
      rank: Number(rank) || null,
      keyword,
      searchAvg,
      searchYesterday: Number.isFinite(searchYesterday) ? searchYesterday : null,
      bidders,
      bidPriceRaw: r[5] || '',
    });
  }
  out.sort((a, b) => b.searchAvg - a.searchAvg);
  return out;
}

function extractInboundGap(date, marketKeywords) {
  const inboundFile = path.join(DATA_DIR, `qoo10_seller_keywords_${date}.json`);
  const goodsFile = path.join(DATA_DIR, `qoo10_seller_summary_goods_${date}.json`);
  const inboundBlob = loadJSON(inboundFile);
  const goodsBlob = loadJSON(goodsFile);

  const ourGoodsText = (goodsBlob.datas || [])
    .map((g) => String(g.gdNm || ''))
    .join(' ')
    .toLowerCase();

  const marketSet = new Set(marketKeywords.map((m) => m.keyword.toLowerCase()));
  const inboundRows = inboundBlob.datas || [];

  const out = [];
  for (const row of inboundRows) {
    const kw = String(row.keyword || '').trim();
    const pv = Number(row.pv || 0);
    if (!kw) continue;
    const lower = kw.toLowerCase();
    const matchedOurGoods = ourGoodsText.includes(lower);
    const matchedMarket = marketSet.has(lower);
    if (matchedOurGoods) continue; // 이미 우리가 다루는 키워드
    out.push({
      keyword: kw,
      pv,
      alsoInMarketTop: matchedMarket,
    });
  }
  out.sort((a, b) => b.pv - a.pv);
  return out;
}

function main() {
  const date = pickDate(process.argv[2]);
  if (!date) {
    console.error('No qsm_popular_keywords snapshot found.');
    process.exit(1);
  }
  console.log(`# Keyword Gap Analysis (${date})`);
  console.log(`# filter: bidders ≤ ${BID_MAX} AND searchAvg ≥ ${SEARCH_MIN}\n`);

  const marketGap = extractMarketGap(date);
  const inboundGap = extractInboundGap(date, marketGap);

  const outBase = path.join(OUT_DIR, `keyword_gap_${date}`);
  fs.writeFileSync(`${outBase}_market.json`, JSON.stringify(marketGap, null, 2));
  fs.writeFileSync(`${outBase}_inbound.json`, JSON.stringify(inboundGap, null, 2));

  console.log(`market_gap: ${marketGap.length} candidates → ${outBase}_market.json`);
  console.log('top 20:');
  marketGap.slice(0, 20).forEach((m) => {
    console.log(
      `  rank=${String(m.rank).padStart(3)}  bidders=${String(m.bidders).padStart(2)}  ` +
        `search/d=${String(m.searchAvg).padStart(6)}  ${m.keyword}`
    );
  });

  console.log(`\ninbound_gap: ${inboundGap.length} candidates → ${outBase}_inbound.json`);
  console.log('top 20 (pv≥3, ranked by pv):');
  inboundGap
    .filter((r) => r.pv >= 3)
    .slice(0, 20)
    .forEach((r) => {
      const tag = r.alsoInMarketTop ? '★market' : '';
      console.log(`  pv=${String(r.pv).padStart(3)}  ${r.keyword}  ${tag}`);
    });
}

main();
