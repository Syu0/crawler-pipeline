'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') });

const fs = require('fs');
const path = require('path');
const os = require('os');

function ts() { return new Date().toLocaleString('sv'); }

const REPORTS_DIR = path.join(os.homedir(), '.openclaw', 'workspace', 'projects', 'crawler-pipeline', 'reports');
const OUTPUT_DIR = path.join(__dirname, '..', 'metrics', 'tactical');
const SELLER_METRICS_DIR = path.join(__dirname, '..', 'metrics', 'qoo10_seller');

function getDateStr(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toLocaleDateString('sv');
}

function parseReport(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');

  let totalSuccess = 0;
  let totalFailed = 0;
  let lastAutoPercent = null;
  let cumulativeSuccess = null;
  const failedReasons = {};

  // | register | ✅ | SUCCESS 15 / SKIPPED 2 / FAILED 0 |
  const registerRe = /\|\s*register\s*\|[^|]*\|\s*SUCCESS\s+(\d+)[^|]*FAILED\s+(\d+)/gi;
  let m;
  while ((m = registerRe.exec(content)) !== null) {
    totalSuccess += parseInt(m[1]);
    totalFailed += parseInt(m[2]);
  }

  // AUTO 10 / FALLBACK 4 / MANUAL 1 = **AUTO 66.7%**
  const autoMatches = [...content.matchAll(/AUTO\s+(\d+)\s*\/\s*FALLBACK\s+(\d+)\s*\/\s*MANUAL\s+(\d+)/gi)];
  if (autoMatches.length > 0) {
    const last = autoMatches[autoMatches.length - 1];
    const auto = parseInt(last[1]);
    const total = auto + parseInt(last[2]) + parseInt(last[3]);
    if (total > 0) lastAutoPercent = Math.round((auto / total) * 1000) / 10;
  }

  // 누적 SUCCESS**: 157 → **172** (+15)  ← 화살표 뒤 bold 숫자
  const cumMatches = [...content.matchAll(/누적[^\n]*→[^\n]*\*\*(\d+)\*\*/gi)];
  if (cumMatches.length > 0) {
    cumulativeSuccess = parseInt(cumMatches[cumMatches.length - 1][1]);
  }

  // FAILED 사유: [-102] 4건, MultiImage 1건
  for (const r of content.matchAll(/\[(-\d+)\][^(]*?(\d+)건/gi)) {
    const code = r[1];
    failedReasons[code] = (failedReasons[code] || 0) + parseInt(r[2]);
  }
  for (const r of content.matchAll(/MultiImage\s+(\d+)건/gi)) {
    failedReasons['MultiImage'] = (failedReasons['MultiImage'] || 0) + parseInt(r[1]);
  }

  return { totalSuccess, totalFailed, lastAutoPercent, cumulativeSuccess, failedReasons };
}

async function getSheetsData() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    console.warn(`[${ts()}] ⚠ GOOGLE_SHEET_ID 미설정 — Sheets 조회 skip`);
    return { discoveredRemaining: null, maxDailyRegister: null };
  }
  try {
    const { getSheetsClient, getDiscoveredProducts, getConfig } = require('../backend/coupang/sheetsClient');
    const sheets = await getSheetsClient();
    const [discovered, config] = await Promise.all([
      getDiscoveredProducts(sheets, spreadsheetId),
      getConfig(sheets, spreadsheetId),
    ]);
    return {
      discoveredRemaining: discovered.length,
      maxDailyRegister: parseInt(config['MAX_DAILY_REGISTER']) || null,
    };
  } catch (e) {
    console.warn(`[${ts()}] ⚠ Sheets 조회 실패: ${e.message}`);
    return { discoveredRemaining: null, maxDailyRegister: null };
  }
}

/**
 * qoo10_seller 메트릭에서 전략 지표 추출.
 * 가장 최근 날짜 데이터를 기준으로 "직전 완전 월" 데이터를 반환.
 */
function loadSellerMetrics(dateStr) {
  const dir = path.join(SELLER_METRICS_DIR, dateStr);
  if (!fs.existsSync(dir)) return null;

  function readJson(name) {
    const f = path.join(dir, `${name}.json`);
    if (!fs.existsSync(f)) return null;
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; }
  }

  // 직전 완전 월 데이터 (오늘 월 제외, 가장 최근 baseMonth)
  function lastCompleteMonth(datas) {
    if (!Array.isArray(datas) || datas.length === 0) return null;
    const today = new Date();
    const thisMonth = today.getMonth() + 1;
    const thisYear = today.getFullYear();
    // 이번 달 제외하고 가장 최근 행
    const past = datas.filter(r => !(r.baseYear === thisYear && r.baseMonth === thisMonth));
    return past.length > 0 ? past[past.length - 1] : datas[datas.length - 1];
  }

  const result = {};

  // 전환율
  const conv = readJson('pageview_conversion_rate');
  if (conv?.datas) {
    const row = lastCompleteMonth(conv.datas);
    if (row) {
      result.conv_total_pv = row.totalPv ?? null;
      result.conv_user_cnt = row.userCnt ?? null;
      result.conv_purchase_cnt = row.purchaseCnt ?? null;
      result.conv_purchase_rate = row.purchaseRate ?? null; // %
      result.conv_add_cart_cnt = row.addCnt ?? null;
      result.conv_period = row.baseStartDt ? `${row.baseStartDt}~${row.baseEndDt}` : null;
    }
  }

  // 고객 테이블 (신규/재구매)
  const ctbl = readJson('customer_table_date');
  if (ctbl?.datas) {
    const row = lastCompleteMonth(ctbl.datas);
    if (row) {
      result.cust_buyer_cnt = row.buyerCnt ?? null;
      result.cust_new_buyer_cnt = row.newbuyerCnt ?? null;
      result.cust_new_buyer_rate = row.newbuyerRate ?? null;  // %
      result.cust_existing_buyer_cnt = row.existingbuyerCnt ?? null;
      result.cust_shop_follower_total = row.shopFollowerCnt ?? null;
      result.cust_shop_pv = row.shopPageView ?? null;
    }
  }

  // 팔로워 총계 (info에 있는 현재 값)
  const shopStatus = readJson('customer_shop_status');
  if (shopStatus?.info?.shopFollowerCnt != null) {
    result.shop_follower_total_now = shopStatus.info.shopFollowerCnt;
  }

  // 거래 (transaction_table_date: 매출 합계)
  const txn = readJson('transaction_table_date');
  if (txn?.datas) {
    const row = lastCompleteMonth(txn.datas);
    if (row) {
      // fieldSpecs로 컬럼명 매핑
      const specs = txn.info?.fieldSpecs || [];
      const nameMap = {};
      specs.forEach(s => { if (s.fieldNm) nameMap[s.fieldCd || s.fieldNm] = s.fieldNm; });
      result.txn_row_last_month = row;
    }
  }

  // 수집 상태
  const meta = readJson('_meta');
  result.seller_endpoints_ok = meta ? Object.keys(meta.sellerEndpoints || {}).length : null;
  result.seller_errors = meta?.errors?.length ?? null;

  return Object.keys(result).length > 0 ? result : null;
}

async function main() {
  console.log(`[${ts()}] collect-tactical-data 시작`);

  const today = getDateStr(0);

  // 최근 5일 리포트 파싱
  const days = [];
  for (let i = 0; i < 5; i++) {
    const dateStr = getDateStr(i);
    const parsed = parseReport(path.join(REPORTS_DIR, `${dateStr}_daily-qoo10.md`));
    days.push({ date: dateStr, parsed });
  }

  const recent3 = days.slice(0, 3).filter(d => d.parsed);
  const success3dayAvg = recent3.length > 0
    ? Math.round((recent3.reduce((s, d) => s + d.parsed.totalSuccess, 0) / recent3.length) * 10) / 10
    : null;

  const autoPct5day = days.map(d => d.parsed?.lastAutoPercent ?? null);
  const todayParsed = days[0].parsed;
  const latestCumulative = days.find(d => d.parsed?.cumulativeSuccess != null)?.parsed.cumulativeSuccess ?? null;

  const { discoveredRemaining, maxDailyRegister } = await getSheetsData();

  // seller 시장 데이터 (오늘 수집 데이터 우선, 없으면 최근 7일 이내 탐색)
  let sellerData = null;
  for (let i = 0; i < 7; i++) {
    const d = getDateStr(i);
    sellerData = loadSellerMetrics(d);
    if (sellerData) {
      if (i > 0) console.log(`[${ts()}] seller 데이터: 오늘 없음 → ${d} 데이터 사용`);
      break;
    }
  }
  if (!sellerData) console.warn(`[${ts()}] ⚠ seller 시장 데이터 없음 (최근 7일)`);

  const output = {
    date: today,
    // ── 파이프라인 지표 ──────────────────────────────
    discovered_remaining: discoveredRemaining,
    success_today: todayParsed?.totalSuccess ?? null,
    success_3day_avg: success3dayAvg,
    auto_pct_5day: autoPct5day,
    failed_today: todayParsed?.totalFailed ?? null,
    failed_reasons: todayParsed?.failedReasons ?? {},
    registered_cumulative: latestCumulative,
    max_daily_register_current: maxDailyRegister,
    // ── Qoo10 시장 지표 (seller dashboard) ──────────
    market: sellerData ?? null,
  };

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const outputPath = path.join(OUTPUT_DIR, `${today}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`[${ts()}] ✅ 저장: ${outputPath}`);
  console.log(`[${ts()}] SUCCESS 오늘=${output.success_today} / 3일평균=${output.success_3day_avg} / AUTO%=${output.auto_pct_5day[0]} / DISCOVERED=${output.discovered_remaining}`);
  if (sellerData) {
    console.log(`[${ts()}] MARKET 전환율=${sellerData.conv_purchase_rate}% / 구매자=${sellerData.cust_buyer_cnt} / 팔로워=${sellerData.shop_follower_total_now ?? sellerData.cust_shop_follower_total}`);
  }
}

main().catch(e => {
  console.error(`[${ts()}] ❌ 오류: ${e.message}`);
  process.exit(1);
});
