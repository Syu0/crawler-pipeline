'use strict';

/**
 * editGoodsInventory.js — ItemsOptions.EditGoodsInventory 래퍼
 *
 * InventoryInfo 형식:
 *   옵션명||*옵션값||*delta가격||*수량||*코드
 *   여러 옵션은 $$ 로 구분
 *   예: "数量||*1個||*0||*100||*opt_1$$数量||*3個||*500||*100||*opt_3"
 *
 * 옵션명은 "数量" (일본어) 으로 고정.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { qoo10PostMethod } = require('./client');

/**
 * @param {{ itemCode: string, sellerCode?: string, inventoryInfo: string }} opts
 * @returns {Promise<void>} — ResultCode=0이면 반환, 아니면 Error throw
 */
async function editGoodsInventory({ itemCode, sellerCode = '', inventoryInfo }) {
  if (!itemCode) throw new Error('editGoodsInventory: itemCode is required');
  if (!inventoryInfo) throw new Error('editGoodsInventory: inventoryInfo is required');

  const params = {
    returnType: 'application/json',
    ItemCode: String(itemCode),
    InventoryInfo: inventoryInfo,
  };
  if (sellerCode) params.SellerCode = String(sellerCode);

  const INVENTORY_INFO_MAX_LEN = 50;
  if (inventoryInfo.length > INVENTORY_INFO_MAX_LEN) {
    console.warn(`[EditGoodsInventory] ⚠️  InventoryInfo 길이 ${inventoryInfo.length}자 — 50자 초과 (Qoo10 제한). 옵션이 적용되지 않을 수 있습니다.`);
  }

  const res = await qoo10PostMethod('ItemsOptions.EditGoodsInventory', params, '1.1');
  console.log(`[EditGoodsInventory] raw response:`, JSON.stringify(res));
  const code = Number(res?.ResultCode ?? res?.resultCode ?? -999);
  const msg = res?.ResultMsg || res?.resultMsg || 'Unknown';

  if (code !== 0) {
    throw new Error(`EditGoodsInventory failed: ResultCode=${code} ResultMsg=${msg}`);
  }
}

/**
 * 옵션 배열 → InventoryInfo 문자열 빌드
 * @param {Array<{ label: string, deltaPriceJpy: number, qty?: number, code: string }>} options
 * @returns {string}
 */
function buildInventoryInfo(options) {
  return options
    .map(({ label, deltaPriceJpy, qty = 100, code }) =>
      `数量||*${label}||*${Math.round(deltaPriceJpy)}||*${qty}||*${code}`
    )
    .join('$$');
}

/**
 * delta 검증: 모든 옵션의 delta가 masterJpy × ±50% 이내인지 확인
 * @param {number} masterJpy
 * @param {Array<{ label: string, deltaPriceJpy: number }>} options - MASTER 포함 전체
 * @throws {Error} 초과 시 Error throw
 */
function validateDeltas(masterJpy, options) {
  const limit = Math.floor(masterJpy * 0.5);
  for (const opt of options) {
    if (Math.abs(opt.deltaPriceJpy) > limit) {
      throw new Error(
        `[EditGoodsInventory] delta 초과: ${opt.label} delta=${opt.deltaPriceJpy}, 허용=±${limit}`
      );
    }
  }
}

module.exports = { editGoodsInventory, buildInventoryInfo, validateDeltas };
