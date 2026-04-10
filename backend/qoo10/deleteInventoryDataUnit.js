'use strict';

/**
 * deleteInventoryDataUnit.js — ItemsOptions.DeleteInventoryDataUnit 래퍼
 *
 * 옵션 단위 삭제: 특정 옵션값(optionValue) 하나를 제거한다.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { qoo10PostMethod } = require('./client');

/**
 * @param {{ itemCode: string, optionName: string, optionValue: string, optionCode: string, sellerCode?: string }} opts
 * @returns {Promise<void>} — ResultCode=0이면 반환, 아니면 Error throw
 */
async function deleteInventoryDataUnit({ itemCode, optionName, optionValue, optionCode, sellerCode = '' }) {
  if (!itemCode) throw new Error('deleteInventoryDataUnit: itemCode is required');
  if (!optionName) throw new Error('deleteInventoryDataUnit: optionName is required');
  if (!optionValue) throw new Error('deleteInventoryDataUnit: optionValue is required');
  if (!optionCode) throw new Error('deleteInventoryDataUnit: optionCode is required');

  const params = {
    returnType: 'application/json',
    ItemCode: String(itemCode),
    OptionName: String(optionName),
    OptionValue: String(optionValue),
    OptionCode: String(optionCode),
  };
  if (sellerCode) params.SellerCode = String(sellerCode);

  const res = await qoo10PostMethod('ItemsOptions.DeleteInventoryDataUnit', params, '1.1');
  console.log(`[DeleteInventoryDataUnit] raw response:`, JSON.stringify(res));
  const code = Number(res?.ResultCode ?? res?.resultCode ?? -999);
  const msg = res?.ResultMsg || res?.resultMsg || 'Unknown';

  if (code !== 0) {
    throw new Error(`DeleteInventoryDataUnit failed: ResultCode=${code} ResultMsg=${msg}`);
  }
}

module.exports = { deleteInventoryDataUnit };
