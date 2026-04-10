'use strict';

/**
 * editGoodsStatus.js — ItemsBasic.EditGoodsStatus 래퍼
 *
 * Status 값:
 *   1 = 거래대기 (판매중지, 가역)
 *   2 = 거래가능 (재활성)
 *   3 = 거래폐지 (비가역 — 재활성 불가)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { qoo10PostMethod } = require('./client');

const VALID_STATUSES = new Set([1, 2, 3]);

/**
 * @param {{ itemCode: string, sellerCode?: string, status: number }} opts
 * @returns {Promise<void>} — ResultCode=0이면 반환, 아니면 Error throw
 */
async function editGoodsStatus({ itemCode, sellerCode = '', status }) {
  if (!VALID_STATUSES.has(Number(status))) {
    throw new Error(`editGoodsStatus: status must be 1, 2, or 3 (got: ${status})`);
  }
  if (!itemCode) {
    throw new Error('editGoodsStatus: itemCode is required');
  }

  const params = {
    returnType: 'application/json',
    ItemCode: String(itemCode),
    Status: String(status),
  };
  if (sellerCode) params.SellerCode = String(sellerCode);

  const res = await qoo10PostMethod('ItemsBasic.EditGoodsStatus', params, '1.1');
  const code = Number(res?.ResultCode ?? res?.resultCode ?? -999);
  const msg = res?.ResultMsg || res?.resultMsg || 'Unknown';

  if (code !== 0) {
    throw new Error(`EditGoodsStatus failed: ResultCode=${code} ResultMsg=${msg}`);
  }
}

module.exports = { editGoodsStatus };
