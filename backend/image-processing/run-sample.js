/**
 * run-sample.js — processImage 프로토타입 로컬 테스트.
 *
 * 시트(coupang_datas)의 StandardImage 컬럼에서 앞쪽 유효 URL N개를 읽어
 * 원본/처리본을 backend/image-processing/output/에 저장한다.
 *
 * 실행:
 *   cd /Users/judy/dev/crawler-pipeline
 *   node backend/image-processing/run-sample.js [count] [formatOverride]
 *     count           처리할 샘플 수 (default 5)
 *     formatOverride  URL 포맷 치환 (예: 800x800ex, q89). 생략 시 시트 URL 원본 그대로.
 *
 * 예:
 *   node backend/image-processing/run-sample.js 5 800x800ex
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { processImage } = require('./processImage');
const { getSheetsClient } = require('../coupang/sheetsClient');
const fs = require('fs').promises;
const path = require('path');

async function fetchSampleUrls(count) {
  const sheets = await getSheetsClient();
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const tab = process.env.GOOGLE_SHEET_TAB_NAME || 'coupang_datas';
  if (!sheetId) throw new Error('GOOGLE_SHEET_ID not set');

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tab}!A1:ZZ200`,
  });
  const values = res.data.values || [];
  if (values.length === 0) throw new Error('Sheet is empty');
  const [headers, ...rows] = values;
  const idx = headers.indexOf('StandardImage');
  if (idx < 0) throw new Error('StandardImage column not found in headers');

  const urls = [];
  for (const r of rows) {
    const u = r[idx];
    if (u && typeof u === 'string' && u.startsWith('http')) {
      urls.push(u);
      if (urls.length >= count) break;
    }
  }
  return urls;
}

function swapFormat(url, fmt) {
  if (!fmt) return url;
  return url.replace(/\/(?:\d+x\d+(?:ex|cr)|q\d+)\//, `/${fmt}/`);
}

async function main() {
  const count = Number(process.argv[2] || 5);
  const formatOverride = process.argv[3] || null;
  const suffix = formatOverride ? `_${formatOverride}` : '';
  const outputDir = path.join(__dirname, 'output');
  await fs.mkdir(outputDir, { recursive: true });

  console.log(`[run-sample] Fetching ${count} sample URLs from sheet...`);
  const rawUrls = await fetchSampleUrls(count);
  const urls = rawUrls.map(u => swapFormat(u, formatOverride));
  if (formatOverride) {
    console.log(`[run-sample] URL format override: /${formatOverride}/`);
  }
  console.log(`[run-sample] Got ${urls.length} URL(s). Processing → ${outputDir}`);
  console.log('');

  for (let i = 0; i < urls.length; i++) {
    const n = String(i + 1).padStart(2, '0');
    const url = urls[i];
    let ext = path.extname(new URL(url).pathname).toLowerCase() || '.jpg';
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) ext = '.jpg';

    const origPath = path.join(outputDir, `sample_${n}${suffix}_original${ext}`);
    const procPath = path.join(outputDir, `sample_${n}${suffix}_processed${ext}`);

    try {
      // save original for side-by-side inspection
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(origPath, buf);

      const r = await processImage(url, procPath);
      const delta = (((r.processedSize - r.originalSize) / r.originalSize) * 100).toFixed(1);
      const sign = delta >= 0 ? '+' : '';
      console.log(
        `  [${n}] ${r.format.padEnd(4)} ${r.width}x${r.height}  ` +
          `orig=${(r.originalSize / 1024).toFixed(0).padStart(4)}KB  ` +
          `proc=${(r.processedSize / 1024).toFixed(0).padStart(4)}KB  ` +
          `(${sign}${delta}%)`
      );
    } catch (e) {
      console.error(`  [${n}] FAILED: ${e.message}`);
    }
  }
  console.log('');
  console.log(`[run-sample] Done.`);
  console.log(`  원본:   ${outputDir}/sample_*_original.*`);
  console.log(`  처리본: ${outputDir}/sample_*_processed.*`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
