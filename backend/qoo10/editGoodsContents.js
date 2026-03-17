/**
 * Qoo10 EditGoodsContents — 상품 상세페이지 HTML 업데이트
 * 실제 콘텐츠 생성 전략(contentStrategy.js)은 별도 작업 — 이 모듈은 래퍼만 제공.
 *
 * Usage:
 *   const { editGoodsContents } = require('./backend/qoo10/editGoodsContents');
 *   const result = await editGoodsContents('1194045329', '<p>상세 설명 HTML</p>');
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { qoo10PostMethod } = require('./client');

/**
 * Qoo10 상품 상세페이지 HTML 업데이트
 * @param {string} itemCode - Qoo10 ItemCode (qoo10ItemId)
 * @param {string} descriptionHtml - 업데이트할 HTML 콘텐츠
 * @returns {Promise<{success: boolean, resultCode: string, message: string, dryRun?: boolean}>}
 */
async function editGoodsContents(itemCode, descriptionHtml) {
  const ALLOW_REAL = process.env.QOO10_ALLOW_REAL_REG === '1';

  if (!ALLOW_REAL) {
    console.log(`[EditGoodsContents] DRY-RUN: would update description for itemCode=${itemCode}`);
    return { success: true, resultCode: '-1', message: 'DRY-RUN: QOO10_ALLOW_REAL_REG not enabled', dryRun: true };
  }

  if (!itemCode) {
    return { success: false, resultCode: '-1', message: 'itemCode is required' };
  }

  try {
    const response = await qoo10PostMethod('ItemsContents.EditGoodsContents', {
      returnType: 'application/json',
      ItemCode: String(itemCode),
      ItemDescription: String(descriptionHtml || ''),
    }, '1.1');

    const resultCode = Number(response?.ResultCode ?? response?.resultCode ?? -999);
    const message = response?.ResultMsg || response?.resultMsg || 'Unknown';
    console.log(`[EditGoodsContents] ResultCode=${resultCode}, ResultMsg=${message}`);
    return { success: resultCode === 0, resultCode: String(resultCode), message };
  } catch (err) {
    return { success: false, resultCode: '-999', message: err.message };
  }
}

module.exports = { editGoodsContents };
