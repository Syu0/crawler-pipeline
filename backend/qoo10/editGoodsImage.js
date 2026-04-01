/**
 * editGoodsImage.js
 * Qoo10 ItemsContents.EditGoodsImage API 래퍼
 *
 * 상품 대표 이미지(StandardImage) 업데이트.
 *
 * 사용:
 *   const { editGoodsImage } = require('./editGoodsImage');
 *   const result = await editGoodsImage('1234567890', 'https://...');
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { qoo10PostMethod } = require('./client');

/**
 * 상품 대표 이미지 업데이트
 *
 * @param {string} itemCode - Qoo10 상품 코드 (GdNo)
 * @param {string} standardImageUrl - 대표 이미지 URL (Max 200)
 * @returns {Promise<{ success: boolean, message: string, dryRun?: boolean, skipped?: boolean }>}
 */
async function editGoodsImage(itemCode, standardImageUrl) {
  const ALLOW_REAL = process.env.QOO10_ALLOW_REAL_REG === '1';

  if (!itemCode) {
    return { success: false, message: 'itemCode is required' };
  }

  if (!standardImageUrl || !standardImageUrl.trim()) {
    console.log('[EditImage] Empty standardImageUrl — skipping');
    return { success: true, message: 'No image URL to update', skipped: true };
  }

  console.log(`[EditImage] ItemCode=${itemCode}, url=${standardImageUrl.substring(0, 80)}...`);

  const params = {
    returnType: 'application/json',
    ItemCode: String(itemCode),
    StandardImage: standardImageUrl,
  };

  if (!ALLOW_REAL) {
    console.log('[EditImage] Dry-run mode — API call skipped');
    return { success: true, message: 'Dry-run mode', dryRun: true };
  }

  try {
    const response = await qoo10PostMethod('ItemsContents.EditGoodsImage', params, '1.1');

    const resultCode = Number(response.ResultCode ?? response.resultCode ?? -999);
    const resultMsg = response.ResultMsg || response.resultMsg || 'Unknown';

    console.log(`[EditImage] API Response: ResultCode=${resultCode}, ResultMsg=${resultMsg}`);

    return { success: resultCode === 0, message: resultMsg };
  } catch (err) {
    console.error(`[EditImage] Exception: ${err.message}`);
    return { success: false, message: err.message };
  }
}

module.exports = { editGoodsImage };
