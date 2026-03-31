/**
 * Qoo10 editGoodsMultiImage - Upload extra images for existing goods
 * Uses ItemsContents.EditGoodsMultiImage API
 *
 * Called after SetNewGoods succeeds to attach ExtraImages.
 *
 * Usage:
 *   const { editGoodsMultiImage } = require('./backend/qoo10/editGoodsMultiImage');
 *   const result = await editGoodsMultiImage('1234567890', ['https://...', 'https://...']);
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { qoo10PostMethod } = require('./client');

/**
 * Upload multi images for an existing Qoo10 item
 *
 * @param {string} itemCode - Qoo10 item ID (GdNo)
 * @param {string[]} imageUrls - Array of image URLs (max ~10)
 * @returns {Promise<Object>} { success, resultCode, resultMsg, dryRun? }
 */
async function editGoodsMultiImage(itemCode, imageUrls) {
  const ALLOW_REAL = process.env.QOO10_ALLOW_REAL_REG === '1';

  if (!itemCode) {
    return { success: false, resultCode: -1, resultMsg: 'itemCode is required' };
  }

  const validUrls = (imageUrls || [])
    .filter(u => u && typeof u === 'string' && u.trim() && u.trim().length <= 200)
    .slice(0, 50);

  if (validUrls.length === 0) {
    console.log('[MultiImage] No valid URLs — skipping');
    return { success: true, resultCode: 0, resultMsg: 'No images to upload', skipped: true };
  }

  console.log(`[MultiImage] ItemCode=${itemCode}, ${validUrls.length} images`);

  // EnlargedImage1~50: Qoo10 상단 갤러리 슬라이더 파라미터
  const params = { returnType: 'application/json', ItemCode: String(itemCode) };
  validUrls.forEach((url, i) => {
    params[`EnlargedImage${i + 1}`] = url.trim();
  });

  if (!ALLOW_REAL) {
    console.log('[MultiImage] Dry-run mode — API call skipped');
    console.log(`[MultiImage] Would send EnlargedImage1: ${validUrls[0]}`);
    return { success: true, resultCode: -1, resultMsg: 'Dry-run mode', dryRun: true };
  }

  try {
    const response = await qoo10PostMethod('ItemsContents.EditGoodsMultiImage', params, '1.1');

    const resultCode = Number(response.ResultCode ?? response.resultCode ?? -999);
    const resultMsg = response.ResultMsg || response.resultMsg || 'Unknown';

    console.log(`[MultiImage] API Response: ResultCode=${resultCode}, ResultMsg=${resultMsg}`);

    return { success: resultCode === 0, resultCode, resultMsg };
  } catch (err) {
    console.error(`[MultiImage] Exception: ${err.message}`);
    return { success: false, resultCode: -999, resultMsg: err.message };
  }
}

module.exports = { editGoodsMultiImage };
