/**
 * inspect-sheet.js — 이미지 컬럼 3개(StandardImage, ExtraImages, DetailImages)의
 * 실제 값·개수·해상도 분포를 시트 전수에서 파악한다.
 *
 * 실행: cd /Users/judy/dev/crawler-pipeline && node backend/image-processing/inspect-sheet.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { getSheetsClient } = require('../coupang/sheetsClient');

function parseUrls(cell) {
  if (!cell || typeof cell !== 'string') return [];
  const s = cell.trim();
  if (!s) return [];
  try {
    if (s.startsWith('[')) return JSON.parse(s).filter(Boolean);
  } catch (_) {}
  return s.split('|').map(u => u.trim()).filter(u => u && u.startsWith('http'));
}

function extractSize(url) {
  const m = url.match(/\/(\d+)x(\d+)(?:ex|cr)?\//);
  return m ? `${m[1]}x${m[2]}` : '—';
}

async function main() {
  const sheets = await getSheetsClient();
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const tab = process.env.GOOGLE_SHEET_TAB_NAME || 'coupang_datas';

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tab}!A1:ZZ`,
  });
  const values = res.data.values || [];
  const [headers, ...rows] = values;

  const col = {
    standard: headers.indexOf('StandardImage'),
    extra: headers.indexOf('ExtraImages'),
    detail: headers.indexOf('DetailImages'),
  };

  console.log(`[inspect] total rows: ${rows.length}`);
  console.log(`[inspect] column indexes: StandardImage=${col.standard}, ExtraImages=${col.extra}, DetailImages=${col.detail}`);
  console.log('');

  // 집계
  const stats = {
    standardFilled: 0,
    extraUrlCounts: [],
    detailUrlCounts: [],
    sampleStandard: [],
    sampleExtra: [],
    sampleDetail: [],
    standardSizes: new Set(),
    extraSizes: new Set(),
    detailSizes: new Set(),
  };

  for (const r of rows) {
    const std = r[col.standard];
    const extra = parseUrls(r[col.extra]);
    const detail = parseUrls(r[col.detail]);

    if (std && std.startsWith('http')) {
      stats.standardFilled++;
      stats.standardSizes.add(extractSize(std));
      if (stats.sampleStandard.length < 3) stats.sampleStandard.push(std);
    }
    stats.extraUrlCounts.push(extra.length);
    stats.detailUrlCounts.push(detail.length);
    for (const u of extra) stats.extraSizes.add(extractSize(u));
    for (const u of detail) stats.detailSizes.add(extractSize(u));
    if (stats.sampleExtra.length < 3 && extra.length > 0) stats.sampleExtra.push(extra[0]);
    if (stats.sampleDetail.length < 3 && detail.length > 0) stats.sampleDetail.push(detail[0]);
  }

  const sum = arr => arr.reduce((a, b) => a + b, 0);
  const avg = arr => (arr.length ? sum(arr) / arr.length : 0);
  const nonZero = arr => arr.filter(n => n > 0);
  const max = arr => (arr.length ? Math.max(...arr) : 0);

  console.log('=== StandardImage (대표 이미지) ===');
  console.log(`  filled rows: ${stats.standardFilled} / ${rows.length}`);
  console.log(`  URL sizes observed: ${[...stats.standardSizes].join(', ')}`);
  console.log(`  samples:`);
  stats.sampleStandard.forEach(u => console.log(`    ${u}`));
  console.log('');

  console.log('=== ExtraImages (Qoo10 슬라이더 EnlargedImage1~50) ===');
  console.log(`  rows with ≥1 URL: ${nonZero(stats.extraUrlCounts).length} / ${rows.length}`);
  console.log(`  avg urls/row (non-zero): ${avg(nonZero(stats.extraUrlCounts)).toFixed(1)}`);
  console.log(`  max urls/row: ${max(stats.extraUrlCounts)}`);
  console.log(`  total urls: ${sum(stats.extraUrlCounts)}`);
  console.log(`  URL sizes observed: ${[...stats.extraSizes].join(', ')}`);
  console.log(`  samples:`);
  stats.sampleExtra.forEach(u => console.log(`    ${u}`));
  console.log('');

  console.log('=== DetailImages (상세페이지 본문 embed) ===');
  console.log(`  rows with ≥1 URL: ${nonZero(stats.detailUrlCounts).length} / ${rows.length}`);
  console.log(`  avg urls/row (non-zero): ${avg(nonZero(stats.detailUrlCounts)).toFixed(1)}`);
  console.log(`  max urls/row: ${max(stats.detailUrlCounts)}`);
  console.log(`  total urls: ${sum(stats.detailUrlCounts)}`);
  console.log(`  URL sizes observed: ${[...stats.detailSizes].join(', ')}`);
  console.log(`  samples:`);
  stats.sampleDetail.forEach(u => console.log(`    ${u}`));
  console.log('');

  const totalProcess = stats.standardFilled + sum(stats.extraUrlCounts) + sum(stats.detailUrlCounts);
  console.log(`=== 요약 ===`);
  console.log(`  총 처리 대상 이미지: ${totalProcess}건 (시트 전수 기준)`);
  console.log(`  평균 상품당 이미지: ${(totalProcess / rows.length).toFixed(1)}장`);
}

main().catch(e => { console.error(e); process.exit(1); });
