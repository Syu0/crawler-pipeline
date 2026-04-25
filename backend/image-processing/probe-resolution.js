/**
 * probe-resolution.js — 쿠팡 이미지 URL 포맷별 실제 해상도 확인.
 *
 * 같은 이미지를 여러 포맷(/492x492ex/, /q89/, /1200x1200ex/)으로 요청해서
 * sharp로 실제 픽셀 크기를 읽어 비교한다.
 *
 * 실행: cd /Users/judy/dev/crawler-pipeline && node backend/image-processing/probe-resolution.js
 */

const sharp = require('sharp');

const SAMPLES = [
  'https://thumbnail.coupangcdn.com/thumbnails/remote/492x492ex/image/retail/images/523857666269745-27f995f5-d3cc-43eb-b9a2-8ff9060ea9d7.jpg',
  'https://thumbnail.coupangcdn.com/thumbnails/remote/492x492ex/image/vendor_inventory/cb4b/5f24f766d54c29ca612db18144cf2552df06d1fe07fbc7fbb947bc7f1e32.jpg',
];

const FORMATS = [
  '492x492ex',
  '800x800ex',
  '1200x1200ex',
  'q89',   // quality-only, 원본 크기 유지
  'q100',  // 최고 품질, 원본 크기
];

function swap(url, fmt) {
  return url.replace(/\/(?:\d+x\d+(?:ex|cr)|q\d+)\//, `/${fmt}/`);
}

async function probe(url) {
  const res = await fetch(url);
  if (!res.ok) return { status: res.status, size: 0, width: null, height: null, err: `HTTP ${res.status}` };
  const buf = Buffer.from(await res.arrayBuffer());
  try {
    const meta = await sharp(buf).metadata();
    return { status: 200, size: buf.length, width: meta.width, height: meta.height };
  } catch (e) {
    return { status: 200, size: buf.length, width: null, height: null, err: e.message };
  }
}

async function main() {
  for (let i = 0; i < SAMPLES.length; i++) {
    console.log(`\n=== sample ${i + 1} ===`);
    const base = SAMPLES[i];
    console.log(`  base: ${base.substring(0, 100)}...`);
    console.log('');
    console.log(`  ${'format'.padEnd(14)} ${'px'.padEnd(12)} ${'size'.padEnd(10)} ${'note'}`);
    console.log(`  ${'-'.repeat(60)}`);
    for (const fmt of FORMATS) {
      const url = swap(base, fmt);
      const r = await probe(url);
      const px = r.width ? `${r.width}x${r.height}` : '(fail)';
      const kb = r.size ? `${(r.size / 1024).toFixed(0)}KB` : '—';
      const note = r.err || '';
      console.log(`  ${fmt.padEnd(14)} ${px.padEnd(12)} ${kb.padEnd(10)} ${note}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
