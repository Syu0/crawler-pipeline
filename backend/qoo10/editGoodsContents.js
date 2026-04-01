/**
 * editGoodsContents.js
 * Qoo10 ItemsContents.EditGoodsContents API 래퍼
 *
 * 상품 상세페이지 HTML 설명 업데이트.
 *
 * 사용:
 *   const { editGoodsContents } = require('./editGoodsContents');
 *   const result = await editGoodsContents({ itemCode: '1234567890', htmlContent: '<p>...</p>' });
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { qoo10PostMethod } = require('./client');

/**
 * 상품 상세페이지 HTML 설명 업데이트
 *
 * @param {object} options
 * @param {string} options.itemCode - Qoo10 상품 코드 (GdNo)
 * @param {string} options.htmlContent - 업데이트할 HTML 내용
 * @returns {Promise<{ success: boolean, message: string, dryRun?: boolean }>}
 */
async function editGoodsContents({ itemCode, htmlContent }) {
  const ALLOW_REAL = process.env.QOO10_ALLOW_REAL_REG === '1';

  if (!itemCode) {
    return { success: false, message: 'itemCode is required' };
  }

  if (!htmlContent || !htmlContent.trim()) {
    console.log('[EditContents] Empty htmlContent — skipping');
    return { success: true, message: 'No content to update', skipped: true };
  }

  console.log(`[EditContents] ItemCode=${itemCode}, content length=${htmlContent.length}`);

  const params = {
    returnType: 'application/json',
    ItemCode: String(itemCode),
    Contents: htmlContent,
  };

  if (!ALLOW_REAL) {
    console.log('[EditContents] Dry-run mode — API call skipped');
    console.log(`[EditContents] Would send content (first 200): ${htmlContent.substring(0, 200)}${htmlContent.length > 200 ? '...' : ''}`);
    return { success: true, message: 'Dry-run mode', dryRun: true };
  }

  try {
    const response = await qoo10PostMethod('ItemsContents.EditGoodsContents', params, '1.1');

    const resultCode = Number(response.ResultCode ?? response.resultCode ?? -999);
    const resultMsg = response.ResultMsg || response.resultMsg || 'Unknown';

    console.log(`[EditContents] API Response: ResultCode=${resultCode}, ResultMsg=${resultMsg}`);

    return { success: resultCode === 0, message: resultMsg };
  } catch (err) {
    console.error(`[EditContents] Exception: ${err.message}`);
    return { success: false, message: err.message };
  }
}

module.exports = { editGoodsContents };
