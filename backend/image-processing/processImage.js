/**
 * processImage.js — 이미지 저작권 리스크 완화용 전처리
 *
 * 목적: 쿠팡 원본 이미지의 EXIF/메타데이터를 제거하고 투명도 5% 고유 워터마크를 삽입.
 * 2026-04-24 Qoo10 공지 "타 사이트 상품정보·이미지 무단 도용 금지" 대응 (TASK M-5 방안 A).
 *
 * 한계: "부분 완화"다. 원본 이미지를 그대로 사용하므로 저작권 침해 소지는 여전히 남는다.
 * 자동 크롤러의 해시 기반 적발은 회피하나 인간 신고 대응은 불가. 완전 면책 아님.
 */

const sharp = require('sharp');
const fs = require('fs').promises;

/**
 * URL로부터 이미지 버퍼 다운로드.
 */
async function downloadImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * 우하단 정렬 텍스트 워터마크 SVG 생성 (투명도 5%).
 */
function watermarkSvg(width, height, text) {
  const fontSize = Math.max(14, Math.min(width, height) * 0.035);
  const padding = fontSize * 0.6;
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<text x="${width - padding}" y="${height - padding}" ` +
      `font-family="sans-serif" font-size="${fontSize}" ` +
      `fill="white" fill-opacity="0.05" text-anchor="end">${escaped}</text>` +
    `</svg>`
  );
}

/**
 * 이미지 처리 메인.
 *
 * @param {string} inputUrl 원본 이미지 URL
 * @param {string} outputPath 저장 경로
 * @param {object} options
 * @param {string} [options.watermarkText='© judy'] 워터마크 문구
 * @returns {Promise<{outputPath,width,height,originalSize,processedSize,format}>}
 */
async function processImage(inputUrl, outputPath, options = {}) {
  const watermarkText = options.watermarkText || process.env.IMAGE_WATERMARK_TEXT || '© judy';
  const buf = await downloadImage(inputUrl);

  // rotate() 적용 후 dimensions 확보 — EXIF orientation 회전으로 width/height가 swap될 수 있어
  // raw metadata 기준 SVG를 만들면 composite 시 mismatch 에러가 난다.
  const rotated = await sharp(buf).rotate().toBuffer();
  const meta = await sharp(rotated).metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`Cannot read image dimensions: ${inputUrl}`);
  }
  const overlay = watermarkSvg(meta.width, meta.height, watermarkText);
  await sharp(rotated)
    .composite([{ input: overlay }])
    .toFile(outputPath);
  const stat = await fs.stat(outputPath);
  return {
    outputPath,
    width: meta.width,
    height: meta.height,
    originalSize: buf.length,
    processedSize: stat.size,
    format: meta.format,
  };
}

module.exports = { processImage, watermarkSvg, downloadImage };
