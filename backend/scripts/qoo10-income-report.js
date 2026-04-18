/**
 * Freedom 거리계 Step 2 — Qoo10 이번 달 정산 예정액 수집
 * ShippingBasic.GetSellingReportDetailList API 사용
 *
 * 사용법:
 *   node backend/scripts/qoo10-income-report.js           # 실제 실행
 *   node backend/scripts/qoo10-income-report.js --dry-run  # API 호출만, 파일 저장 안 함
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const fs = require('fs');
const { qoo10PostMethod } = require('../qoo10/client');

const DRY_RUN = process.argv.includes('--dry-run');
const OUTPUT_PATH = path.join(
  process.env.HOME ?? '/Users/judy',
  '.openclaw/workspace/projects/agents/income_snapshot.json'
);

// ─────────────────────────────────────────────────────────────────────────────
// 날짜 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function toYYYYMMDD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function getPeriod() {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    startDate: toYYYYMMDD(startDate),
    endDate: toYYYYMMDD(now),
    period: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 정산 예정액 파싱
// ─────────────────────────────────────────────────────────────────────────────

function parseMonthlyIncome(result) {
  // API 응답 구조가 확정되지 않음 — 가능한 필드명 탐색
  // ResultObject가 배열이면 각 행의 정산액 합산
  const obj = result?.ResultObject ?? result?.resultObject ?? result;

  if (!obj) return { total: 0, raw: result };

  // 배열인 경우 — 각 행 합산
  if (Array.isArray(obj)) {
    let total = 0;
    for (const row of obj) {
      // 가능한 정산액 필드명들
      const amount =
        row.SettlementAmount ??
        row.settlement_amount ??
        row.SalesAmount ??
        row.sales_amount ??
        row.TotalAmount ??
        row.total_amount ??
        row.Amount ??
        row.amount ??
        0;
      total += Number(amount) || 0;
    }
    return { total, raw: obj };
  }

  // 단일 객체인 경우
  const amount =
    obj.SettlementAmount ??
    obj.settlement_amount ??
    obj.TotalSalesAmount ??
    obj.total_sales_amount ??
    obj.TotalAmount ??
    obj.Amount ??
    0;

  return { total: Number(amount) || 0, raw: obj };
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const { startDate, endDate, period } = getPeriod();

  console.log(`[qoo10-income-report] 기간: ${startDate} ~ ${endDate}${DRY_RUN ? ' (dry-run)' : ''}`);

  let result;
  try {
    result = await qoo10PostMethod('ShippingBasic.GetSellingReportDetailList', {
      startDate,
      endDate,
    });
  } catch (err) {
    console.error(`[qoo10-income-report] API 호출 실패: ${err.message}`);
    process.exit(1);
  }

  console.log('[qoo10-income-report] 응답 원본:');
  console.log(JSON.stringify(result, null, 2));

  const { total, raw } = parseMonthlyIncome(result);
  console.log(`[qoo10-income-report] 파싱된 정산 예정액: ${total.toLocaleString()}원`);

  const noData =
    result?.ResultMsg?.includes('No Result') ||
    (Array.isArray(result) && result.flat(Infinity).length === 0);

  if (!DRY_RUN) {
    const snapshot = {
      updatedAt: new Date().toISOString(),
      qoo10_monthly_krw: Math.round(total),
      period,
      ...(noData ? { note: 'API 응답 정상 (판매 데이터 없음 — 등록 상품 미판매 상태)' } : {}),
    };

    const dir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
    console.log(`[qoo10-income-report] 저장 완료: ${OUTPUT_PATH}`);
    console.log(JSON.stringify(snapshot, null, 2));
  } else {
    console.log('[qoo10-income-report] dry-run — 파일 저장 건너뜀');
  }
}

main().catch((err) => {
  console.error('[qoo10-income-report] 예외 발생:', err);
  process.exit(1);
});
