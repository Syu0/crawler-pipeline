/**
 * Qoo10 GetItemDetailInfo — 등록 상품 상세 조회
 * UpdateGoods 호출 전 SecondSubCat 조회용 (read-only, 쿼터 소비 없음)
 *
 * Usage:
 *   const { getItemDetailInfo } = require('./backend/qoo10/getItemDetailInfo');
 *   const detail = await getItemDetailInfo('1194045329');
 *   console.log(detail.SecondSubCat);
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { qoo10PostMethod } = require('./client');

/**
 * Qoo10 등록 상품 상세 조회
 * @param {string} itemCode - Qoo10 ItemCode (qoo10ItemId)
 * @returns {Promise<object>} ResultObject 첫 번째 항목 (SecondSubCat, ItemTitle 등 포함)
 * @throws {Error} API 실패 또는 ResultCode !== 0 시
 */
async function getItemDetailInfo(itemCode) {
  if (!itemCode) {
    throw new Error('getItemDetailInfo: itemCode is required');
  }

  const response = await qoo10PostMethod('ItemsLookup.GetItemDetailInfo', {
    returnType: 'application/json',
    ItemCode: String(itemCode),
  }, '1.1');

  const resultCode = Number(response?.ResultCode ?? response?.resultCode ?? -999);

  if (resultCode !== 0) {
    throw new Error(
      `GetItemDetailInfo failed: ResultCode=${resultCode}, ResultMsg=${response?.ResultMsg || response?.resultMsg || 'Unknown'}`
    );
  }

  console.log('[GetItemDetailInfo] raw response:', JSON.stringify(response, null, 2));

  // ResultObject는 배열 또는 단일 객체
  const obj = Array.isArray(response.ResultObject)
    ? response.ResultObject[0]
    : response.ResultObject;

  return obj || {};
}

module.exports = { getItemDetailInfo };
