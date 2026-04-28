/**
 * prepareForRegister.js — Phase 3 단일 진입점
 *
 * 신규 등록(또는 update) 직전에 호출하여 이미지를 재가공·로컬 저장하고
 * Qoo10 페이로드용 tunnel URL을 반환한다. 시트는 건드리지 않는다.
 *
 * 호출 측에서 받은 row의 StandardImage / ExtraImages / DetailImages 는 쿠팡 원본 URL.
 * 본 모듈은 그 URL들을 다운로드 → EXIF strip + 워터마크 → hosted/products/<itemCode>/ 저장 →
 * 현재 활성 tunnel base URL을 prefix로 붙여 돌려준다.
 *
 * Idempotent: hosted 파일이 이미 있으면 재다운로드/재가공하지 않고 tunnel URL만 새로 만든다.
 *
 * 사용:
 *   const { prepareForRegister } = require('../image-processing/prepareForRegister');
 *   const { tunnelStandard, tunnelExtras, tunnelDetails } = await prepareForRegister(itemCode, row);
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { processImage } = require('./processImage');

const HOSTED_DIR = path.join(__dirname, 'hosted', 'products');
const TUNNEL_BASE_FILE = path.join(__dirname, '..', '..', '.tunnel-base');

/**
 * `.tunnel-base` 파일에서 현재 활성 tunnel URL을 읽는다.
 * tunnel-daemon이 cloudflared 가동 시 기록한다.
 */
function readTunnelBase() {
  const explicit = process.env.IMAGE_TUNNEL_BASE;
  if (explicit) return explicit.replace(/\/$/, '');

  if (!fs.existsSync(TUNNEL_BASE_FILE)) {
    throw new Error(
      `.tunnel-base 파일이 없습니다 (${TUNNEL_BASE_FILE}). ` +
      `tunnel-daemon이 가동 중인지 확인하세요. ` +
      `또는 IMAGE_TUNNEL_BASE 환경변수로 직접 지정.`
    );
  }
  const content = fs.readFileSync(TUNNEL_BASE_FILE, 'utf-8').trim();
  if (!content || !/^https?:\/\//.test(content)) {
    throw new Error(`.tunnel-base 내용 무효: "${content}"`);
  }
  return content.replace(/\/$/, '');
}

function parseUrls(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}

async function ensureProcessed(srcUrl, localPath) {
  if (fs.existsSync(localPath)) return { reused: true };
  await fsp.mkdir(path.dirname(localPath), { recursive: true });
  await processImage(srcUrl, localPath);
  return { reused: false };
}

/**
 * @param {string|number} itemCode
 * @param {object} row 시트의 한 행 객체. 최소 StandardImage·ExtraImages·DetailImages 필요.
 * @param {object} [opts]
 * @param {boolean} [opts.skipDetails=false] DetailImages 처리 건너뛰기 (위기 모드 텍스트 본문 보류 시 등).
 * @returns {Promise<{tunnelStandard:string|null, tunnelExtras:string[], tunnelDetails:string[], stats:object}>}
 */
async function prepareForRegister(itemCode, row, opts = {}) {
  const skipDetails = !!opts.skipDetails;
  const code = String(itemCode);
  if (!code) throw new Error('itemCode required');

  const tunnelBase = readTunnelBase();
  const itemDir = path.join(HOSTED_DIR, code);
  const stats = { reused: 0, processed: 0 };

  // 1. StandardImage
  let tunnelStandard = null;
  if (row.StandardImage) {
    const localPath = path.join(itemDir, 'main.jpg');
    const { reused } = await ensureProcessed(row.StandardImage, localPath);
    if (reused) stats.reused++; else stats.processed++;
    tunnelStandard = `${tunnelBase}/images/products/${code}/main.jpg`;
  }

  // 2. ExtraImages
  const extraSrcUrls = parseUrls(row.ExtraImages);
  const tunnelExtras = [];
  for (let i = 0; i < extraSrcUrls.length; i++) {
    const n = String(i + 1).padStart(2, '0');
    const fname = `extra_${n}.jpg`;
    const localPath = path.join(itemDir, fname);
    const { reused } = await ensureProcessed(extraSrcUrls[i], localPath);
    if (reused) stats.reused++; else stats.processed++;
    tunnelExtras.push(`${tunnelBase}/images/products/${code}/${fname}`);
  }

  // 3. DetailImages (옵션)
  const tunnelDetails = [];
  if (!skipDetails) {
    const detailSrcUrls = parseUrls(row.DetailImages);
    for (let i = 0; i < detailSrcUrls.length; i++) {
      const n = String(i + 1).padStart(2, '0');
      const fname = `detail_${n}.jpg`;
      const localPath = path.join(itemDir, fname);
      const { reused } = await ensureProcessed(detailSrcUrls[i], localPath);
      if (reused) stats.reused++; else stats.processed++;
      tunnelDetails.push(`${tunnelBase}/images/products/${code}/${fname}`);
    }
  }

  return { tunnelStandard, tunnelExtras, tunnelDetails, stats, tunnelBase };
}

module.exports = { prepareForRegister, readTunnelBase };
