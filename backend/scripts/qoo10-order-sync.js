/**
 * Qoo10 주문 조회 → Google Sheets qoo10_orders 탭 upsert
 * ShippingBasic.GetShippingInfo_v3 API 사용
 *
 * 사용법:
 *   npm run qoo10:order:sync            # 기본 (-30일)
 *   npm run qoo10:order:sync:dry        # dry-run (시트 write 없음)
 *   npm run qoo10:order:sync -- --days=90
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { qoo10PostMethod } = require('../qoo10/client');
const { getSheetsClient, upsertRow } = require('../coupang/sheetsClient');

// ─────────────────────────────────────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────────────────────────────────────

const ORDER_SHEET_ID = '1RZ5Kol8iAW2myXQOSRsG3MCwYIw1rQk6HY3a90GLyRs';
const COUPANG_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB = 'qoo10_orders';

// 엑셀 다운로드 46컬럼 순서 + 파이프라인 컬럼 2개
const ORDER_HEADERS = [
  '배송상태', '주문번호', '장바구니번호', '택배사', '송장번호',
  '발송일', '주문일', '입금일', '배달희망일', '발송예정일',
  '배송완료일', '배송방식', '상품코드', '상품명', '수량',
  '옵션정보', '판매자옵션코드', '사은품', '수취인명', '수취인명(음성표기)',
  '수취인전화번호', '수취인핸드폰번호', '주소', '우편번호', '국가',
  '배송비결제', '주문국가', '통화', '구매자결제금', '판매가',
  '할인액', '총주문액', '총공급원가', '구매자명', '구매자명(발음표기)',
  '배송요청사항', '구매자전화번호', '구매자핸드폰번호', '판매자상품코드', 'JAN코드',
  '규격번호', '(선물)보내는사람', '패킹번호', '외부광고', '소재',
  '선물하기주문', 'syncedAt', 'linkedVendorItemId',
];

// ─────────────────────────────────────────────────────────────────────────────
// 인수 파싱
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const daysArg = args.find(a => a.startsWith('--days='));
const days = Math.min(daysArg ? parseInt(daysArg.split('=')[1], 10) : 2, 90);

// ─────────────────────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────────────────────

function yyyymmdd(dt) {
  return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}`;
}

function str(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// API 호출
// ─────────────────────────────────────────────────────────────────────────────

async function fetchOrders(startDate, endDate) {
  const result = await qoo10PostMethod('ShippingBasic.GetShippingInfo_v3', {
    returnType: 'application/json',
    ShippingStatus: '',
    SearchCondition: '1',
    SearchStartDate: startDate,
    SearchEndDate: endDate,
  }, '1.1');

  if (result.ResultCode !== 0) {
    throw new Error(`API error ${result.ResultCode}: ${result.ResultMsg}`);
  }

  const raw = result.ResultObject;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

// ─────────────────────────────────────────────────────────────────────────────
// coupang_datas에서 SellerItemCode → vendorItemId 맵 구축
// ─────────────────────────────────────────────────────────────────────────────

async function buildSellerCodeMap(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: COUPANG_SHEET_ID,
    range: 'coupang_datas!A:ZZ',
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return {};

  const headers = rows[0];
  const vendorItemIdIdx = headers.indexOf('vendorItemId');
  const qoo10SellerCodeIdx = headers.indexOf('qoo10SellerCode');

  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const vendorItemId = row[vendorItemIdIdx] || '';
    const sellerCode = row[qoo10SellerCodeIdx] || '';
    if (sellerCode && vendorItemId) {
      map[sellerCode] = vendorItemId;
    }
    // vendorItemId 자체도 키로 등록 (SellerItemCode가 vendorItemId와 같은 경우 fallback)
    if (vendorItemId) {
      map[vendorItemId] = vendorItemId;
    }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// API 응답 → 시트 행 매핑
// ─────────────────────────────────────────────────────────────────────────────

function mapOrderToRow(order, sellerCodeMap, now) {
  const linkedVendorItemId = sellerCodeMap[str(order.SellerItemCode)] || '';

  return {
    '배송상태':             str(order.ShippingStatus),
    '주문번호':             str(order.OrderNo),
    '장바구니번호':         str(order.PackNo),
    '택배사':               str(order.DeliveryCompany),
    '송장번호':             str(order.TrackingNo),
    '발송일':               str(order.ShippingDate),
    '주문일':               str(order.OrderDate),
    '입금일':               str(order.PaymentDate),
    '배달희망일':           str(order.DesiredDeliveryDate),
    '발송예정일':           str(order.EstimatedShippingDate),
    '배송완료일':           str(order.DeliveredDate),
    '배송방식':             str(order.ShippingWay),
    '상품코드':             str(order.ItemNo),
    '상품명':               str(order.ItemTitle),
    '수량':                 str(order.OrderQty),
    '옵션정보':             str(order.Option),
    '판매자옵션코드':       str(order.OptionCode),
    '사은품':               str(order.Gift),
    '수취인명':             str(order.Receiver),
    '수취인명(음성표기)':   str(order.ReceiverKana),
    '수취인전화번호':       str(order.ReceiverTel),
    '수취인핸드폰번호':     str(order.ReceiverMobile),
    '주소':                 str(order.ShippingAddress),
    '우편번호':             str(order.ZipCode),
    '국가':                 '',
    '배송비결제':           str(order.ShippingRate),
    '주문국가':             '',
    '통화':                 str(order.Currency),
    '구매자결제금':         str(order.Total),
    '판매가':               str(order.OrderPrice),
    '할인액':               str(order.Discount),
    '총주문액':             str(order.Total),
    '총공급원가':           str(order.SettlePrice),
    '구매자명':             str(order.Buyer),
    '구매자명(발음표기)':   str(order.BuyerKana),
    '배송요청사항':         str(order.ShippingMessage),
    '구매자전화번호':       str(order.BuyerTel),
    '구매자핸드폰번호':     str(order.BuyerMobile),
    '판매자상품코드':       str(order.SellerItemCode),
    'JAN코드':              '',
    '규격번호':             str(order.SellerDeliveryNo),
    '(선물)보내는사람':     str(order.SenderName),
    '패킹번호':             str(order.PackingNo),
    '외부광고':             str(order.VoucherCode),
    '소재':                 str(order.Material),
    '선물하기주문':         '',
    'syncedAt':             now,
    'linkedVendorItemId':   linkedVendorItemId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  const startDate = yyyymmdd(start);
  const endDate = yyyymmdd(end);

  console.log(`[order-sync] ${isDryRun ? '[DRY-RUN] ' : ''}기간: ${startDate} ~ ${endDate} (${days}일)`);

  const orders = await fetchOrders(startDate, endDate);
  console.log(`[order-sync] 조회: ${orders.length}건`);

  if (isDryRun) {
    console.log('[order-sync] 파싱 샘플 (최대 5건):');
    orders.slice(0, 5).forEach((o, i) => {
      console.log(`  [${i + 1}] PackNo=${o.PackNo} OrderNo=${o.OrderNo} SellerItemCode=${o.SellerItemCode} Status=${o.ShippingStatus} Total=${o.Total} ${o.Currency}`);
    });
    return;
  }

  const sheets = await getSheetsClient();
  const sellerCodeMap = await buildSellerCodeMap(sheets);
  console.log(`[order-sync] coupang_datas 매핑 ${Object.keys(sellerCodeMap).length}건 로드`);

  const now = new Date().toISOString();
  let upserted = 0;
  let failed = 0;

  for (const order of orders) {
    try {
      const rowData = mapOrderToRow(order, sellerCodeMap, now);
      const { action } = await upsertRow(ORDER_SHEET_ID, TAB, ORDER_HEADERS, rowData, '장바구니번호');
      console.log(`  [${action}] PackNo=${order.PackNo} SellerItemCode=${order.SellerItemCode}`);
      upserted++;
    } catch (err) {
      console.error(`  [error] PackNo=${order.PackNo}: ${err.message}`);
      failed++;
    }
  }

  console.log(`[order-sync] 조회 ${orders.length}건 / upsert ${upserted}건 / 실패 ${failed}건`);
}

main().catch(err => {
  console.error('[order-sync] Fatal error:', err.message);
  process.exit(1);
});
