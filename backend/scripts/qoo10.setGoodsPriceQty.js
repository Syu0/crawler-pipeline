/**
 * Qoo10 SetGoodsPriceQty — 재고/가격 업데이트
 *
 * 안전장치:
 *   1. QOO10_ALLOW_REAL_REG=1 없으면 dry-run
 *   2. 세션 write call 쿼터 10회 초과 → 중단
 *
 * CLI 사용:
 *   node backend/scripts/qoo10.setGoodsPriceQty.js
 *   QOO10_ALLOW_REAL_REG=1 QOO10_TEST_ITEMCODE=1194045329 TEST_QTY=50 node backend/scripts/qoo10.setGoodsPriceQty.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const path = require('path');
const { qoo10PostMethod } = require('../qoo10/client');

const LOG_FILE   = path.join(__dirname, '..', 'logs',  'setGoodsPriceQty.log');
const STATE_FILE = path.join(__dirname, '..', 'state', 'writeCallCount.json');
const QUOTA_LIMIT = 10;

// ── helpers ──────────────────────────────────────────────────────────────────

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function appendLog(entry) {
  ensureDir(LOG_FILE);
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
}

function getWriteCallCount() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return typeof data.count === 'number' ? data.count : 0;
    }
  } catch (_) {}
  return 0;
}

function incrementWriteCallCount() {
  ensureDir(STATE_FILE);
  const count = getWriteCallCount() + 1;
  fs.writeFileSync(STATE_FILE, JSON.stringify({ count, updatedAt: new Date().toISOString() }), 'utf8');
  return count;
}

// ── API calls ─────────────────────────────────────────────────────────────────

function callSetGoodsPriceQty(itemCode, price, qty) {
  const params = { returnType: 'application/json', ItemCode: String(itemCode) };
  if (price !== null && price !== undefined) params.ItemPrice = String(price);
  if (qty   !== null && qty   !== undefined) params.ItemQty   = String(qty);
  return qoo10PostMethod('ItemsOrder.SetGoodsPriceQty', params, '1.1');
}

function getItemDetail(itemCode) {
  return qoo10PostMethod('ItemsLookup.GetItemDetailInfo', {
    returnType: 'application/json',
    ItemCode: String(itemCode),
  }, '1.1');
}

// ── main ──────────────────────────────────────────────────────────────────────

/**
 * @param {{ itemCode: string, price?: number|null, qty?: number|null }} options
 */
async function setGoodsPriceQty({ itemCode, price = null, qty = null }) {
  const timestamp  = new Date().toISOString();
  const allowReal  = process.env.QOO10_ALLOW_REAL_REG === '1';
  const writeCount = getWriteCallCount();

  const logBase = { timestamp, itemCode, price, qty };

  // ① 쓰기 승인 플래그
  if (!allowReal) {
    const reason = 'QOO10_ALLOW_REAL_REG not set';
    console.log(`[SetGoodsPriceQty] DRY-RUN: ${reason}`);
    appendLog({ ...logBase, dryRun: true, reason, resultCode: null, readBack: null });
    return { success: false, dryRun: true, reason };
  }

  // ② 쿼터 초과
  if (writeCount >= QUOTA_LIMIT) {
    const reason = `Write quota exceeded (${writeCount}/${QUOTA_LIMIT})`;
    console.error(`[SetGoodsPriceQty] ABORT: ${reason}`);
    appendLog({ ...logBase, dryRun: false, reason, resultCode: null, readBack: null });
    return { success: false, dryRun: false, reason };
  }

  // read-back before
  let before = null;
  try {
    before = await getItemDetail(itemCode);
    const obj = before?.ResultObject?.[0];
    console.log(`[SetGoodsPriceQty] Before → price=${obj?.ItemPrice}, qty=${obj?.ItemQty}`);
  } catch (e) {
    console.warn(`[SetGoodsPriceQty] read-back (before) failed: ${e.message}`);
  }

  // write
  let resultCode, resultMsg;
  try {
    const response = await callSetGoodsPriceQty(itemCode, price, qty);
    resultCode = Number(response?.ResultCode ?? response?.resultCode ?? -999);
    resultMsg  = response?.ResultMsg || response?.resultMsg || 'Unknown';
    incrementWriteCallCount();
    console.log(`[SetGoodsPriceQty] API → ResultCode=${resultCode}, ResultMsg=${resultMsg}`);
  } catch (e) {
    console.error(`[SetGoodsPriceQty] API call failed: ${e.message}`);
    appendLog({ ...logBase, dryRun: false, resultCode: -999, resultMsg: e.message, readBack: null });
    return { success: false, resultCode: -999, resultMsg: e.message };
  }

  // read-back after
  let readBack = null;
  try {
    const after = await getItemDetail(itemCode);
    const obj   = after?.ResultObject?.[0];
    readBack = {
      afterPrice: obj?.ItemPrice,
      afterQty:   obj?.ItemQty,
      priceMatch: price !== null ? String(obj?.ItemPrice) === String(price) : null,
      qtyMatch:   qty   !== null ? String(obj?.ItemQty)   === String(qty)   : null,
    };
    console.log(`[SetGoodsPriceQty] Read-back → priceMatch=${readBack.priceMatch}, qtyMatch=${readBack.qtyMatch}`);
  } catch (e) {
    console.warn(`[SetGoodsPriceQty] read-back (after) failed: ${e.message}`);
  }

  appendLog({ ...logBase, dryRun: false, resultCode, resultMsg, readBack });

  return {
    success: resultCode === 0,
    resultCode,
    resultMsg,
    readBack,
    writeCount: getWriteCallCount(),
  };
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

if (require.main === module) {
  const itemCode = process.env.QOO10_TEST_ITEMCODE || '1194045329';
  const price    = process.env.TEST_PRICE ? Number(process.env.TEST_PRICE) : null;
  const qty      = process.env.TEST_QTY   ? Number(process.env.TEST_QTY)   : 50;

  console.log(`[SetGoodsPriceQty] itemCode=${itemCode}  price=${price}  qty=${qty}`);
  console.log(`[SetGoodsPriceQty] allowReal=${process.env.QOO10_ALLOW_REAL_REG === '1'}`);

  setGoodsPriceQty({ itemCode, price, qty })
    .then(result => {
      console.log('\n[SetGoodsPriceQty] Result:', JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch(err => {
      console.error('[SetGoodsPriceQty] Fatal:', err);
      process.exit(1);
    });
}

module.exports = { setGoodsPriceQty };
