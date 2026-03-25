'use strict';

/**
 * coupangApiClient.js — Browser Relay evaluate 기반 수집기
 *
 * openclaw Browser Relay CLI를 통해 Chrome 컨텍스트에서
 * fetch() / DOM 파싱을 실행한다.
 *
 * 전제 조건:
 *   - Chrome에서 쿠팡 로그인 탭 열고 Browser Relay attach 완료
 *   - `openclaw` CLI PATH에 등재
 *
 * 수집 흐름 (순차):
 *   Step 1: 상품 페이지 navigate
 *   Step 2: DOM에서 이미지 추출 (evaluate)
 *   Step 3: next-api/quantity-info fetch (evaluate) → 타이틀·가격·재고
 *   Step 4: next-api/review fetch (evaluate) → 리뷰
 */

const { execSync } = require('child_process');

const BASE_URL = 'https://www.coupang.com';

// ── CLI 래퍼 ──────────────────────────────────────────────────────────────────

/**
 * Browser Relay navigate: 상품 페이지로 이동 후 완료 대기.
 * @throws {Error} navigate 실패 시
 */
function browserNavigate(url) {
  const escaped = url.replace(/"/g, '\\"');
  execSync(`openclaw browser navigate "${escaped}" --profile chrome`, {
    encoding: 'utf8',
    timeout: 30_000,
  });
}

/**
 * Browser Relay evaluate: Chrome 컨텍스트에서 JS 함수를 실행하고 결과를 반환.
 * @param {string} fn  실행할 JS 함수 문자열 (function() {...} 또는 async () => {...})
 * @returns {*} JSON.parse(CLI stdout)
 * @throws {Error} CLI 실패 또는 JSON 파싱 실패 시
 */
function browserEvaluate(fn) {
  const escaped = fn.replace(/'/g, "'\\''");
  const stdout = execSync(
    `openclaw browser evaluate --fn '${escaped}' --profile chrome`,
    { encoding: 'utf8', timeout: 15_000 }
  );
  return JSON.parse(stdout);
}

// ── URL 정규화 ────────────────────────────────────────────────────────────────

/**
 * 이미지 URL을 thumbnails/remote/origin/... 상대 경로로 정규화.
 * e.g. "https://thumbnail.coupangcdn.com/thumbnails/remote/492x492/..." → "thumbnails/remote/origin/..."
 */
function normalizeImageUrl(url) {
  if (!url) return null;
  const m = url.match(/thumbnails\/remote\/[^/]+\/(.*)/);
  if (m) return `thumbnails/remote/origin/${m[1]}`;
  return url;
}

// ── evaluate 함수 빌더 ────────────────────────────────────────────────────────

function buildImageExtractFn() {
  return `() => {
    // 메인 이미지: 여러 셀렉터 폴백
    const mainEl =
      document.querySelector('.main-image img') ||
      document.querySelector('[class*="prod-image"] img') ||
      document.querySelector('[class*="cdp-img"] img') ||
      document.querySelector('img[class*="main-image"]');
    const main = mainEl?.src || null;

    // 추가 이미지: subType-IMAGE 또는 상품 상세 이미지 섹션
    const extra = [
      ...document.querySelectorAll('.subType-IMAGE img'),
      ...document.querySelectorAll('[class*="detail-image"] img'),
    ].map(el => el.src || el.dataset?.src).filter(Boolean);

    return { main, extra: [...new Set(extra)] };
  }`;
}

function buildQuantityInfoFn(productId, vendorItemId) {
  return `async () => {
    const r = await fetch(
      'https://www.coupang.com/next-api/products/quantity-info?productId=${productId}&vendorItemId=${vendorItemId}',
      { credentials: 'include' }
    );
    return { status: r.status, body: r.ok ? await r.json() : null };
  }`;
}

function buildReviewFn(productId) {
  return `async () => {
    const r = await fetch(
      'https://www.coupang.com/next-api/review?productId=${productId}&page=1&size=1',
      { credentials: 'include' }
    );
    return { status: r.status, body: r.ok ? await r.json() : null };
  }`;
}

// ── 통합 수집 함수 ────────────────────────────────────────────────────────────

/**
 * 상품 1개의 전체 데이터를 4단계로 수집한다.
 *
 * 개별 Step 실패 → 해당 필드 null (전체 중단 없음).
 * Step 3/4에서 403/429 감지 → { blocked: true } 즉시 반환.
 * Step 1 (navigate) 실패 → { error: 'NAVIGATE_ERROR' } 반환.
 *
 * @returns {Promise<{
 *   blocked?: boolean, error?: string,
 *   ItemTitle?: string, ItemPrice?: number,
 *   StandardImage?: string, ExtraImages: string[],
 *   StockStatus?: string, StockQty?: number,
 *   ReviewCount?: number, ReviewAvgRating?: number,
 *   CollectedPhases: string
 * }>}
 */
async function collectProductData(productId, vendorItemId, itemId) {
  const successfulSteps = [];

  let StandardImage = null;
  let ExtraImages = [];
  let ItemTitle = null;
  let ItemPrice = null;
  let StockStatus = null;
  let StockQty = null;
  let ReviewCount = null;
  let ReviewAvgRating = null;

  // ── Step 1: navigate ────────────────────────────────────────────────────────
  try {
    const url = `${BASE_URL}/vp/products/${productId}?vendorItemId=${vendorItemId}`;
    browserNavigate(url);
    // 페이지 로드 완료 대기 (CSR 렌더링 포함)
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    successfulSteps.push(1);
  } catch (e) {
    return { error: 'NAVIGATE_ERROR', message: e.message };
  }

  // ── Step 2: DOM 이미지 추출 ─────────────────────────────────────────────────
  try {
    const result = browserEvaluate(buildImageExtractFn());
    StandardImage = normalizeImageUrl(result.main);
    ExtraImages = (result.extra || []).map(normalizeImageUrl).filter(Boolean);
    successfulSteps.push(2);
  } catch (e) {
    console.warn(`  [step2/images] ${e.message.split('\n')[0]}`);
  }

  // ── Step 3: quantity-info ───────────────────────────────────────────────────
  try {
    const result = browserEvaluate(buildQuantityInfoFn(productId, vendorItemId));
    if (result.status === 403 || result.status === 429) {
      return { blocked: true, httpStatus: result.status };
    }
    const data = result.body;
    if (data) {
      // ItemTitle: [0].moduleData 중 viewType=PRODUCT_DETAIL_PRODUCT_INFO 의 title
      const moduleData = data?.[0]?.moduleData;
      if (Array.isArray(moduleData)) {
        const infoModule = moduleData.find(
          (m) => m.viewType === 'PRODUCT_DETAIL_PRODUCT_INFO'
        );
        ItemTitle = infoModule?.title || null;
      }

      // ItemPrice: [0].price.i18nSalePrice.amount
      const rawPrice = data?.[0]?.price?.i18nSalePrice?.amount;
      if (rawPrice != null) {
        ItemPrice = parseInt(String(rawPrice).replace(/[^0-9]/g, ''), 10) || null;
      }

      // StockStatus / StockQty: [0].quantity
      const qty = data?.[0]?.quantity;
      if (qty != null) {
        StockQty = qty;
        StockStatus = qty > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK';
      } else {
        StockStatus = 'IN_STOCK'; // 필드 없음 → 기본값 IN_STOCK
      }

      successfulSteps.push(3);
    }
  } catch (e) {
    console.warn(`  [step3/quantity-info] ${e.message.split('\n')[0]}`);
  }

  // ── Step 4: review ──────────────────────────────────────────────────────────
  try {
    const result = browserEvaluate(buildReviewFn(productId));
    if (result.status === 403 || result.status === 429) {
      return { blocked: true, httpStatus: result.status };
    }
    const rData = result.body?.rData;
    if (rData) {
      ReviewCount =
        rData.reviewTotalCount != null
          ? parseInt(rData.reviewTotalCount, 10)
          : null;
      ReviewAvgRating =
        rData.ratingSummaryTotal?.ratingAverage != null
          ? parseFloat(rData.ratingSummaryTotal.ratingAverage)
          : null;
      successfulSteps.push(4);
    }
  } catch (e) {
    console.warn(`  [step4/review] ${e.message.split('\n')[0]}`);
  }

  return {
    ItemTitle,
    ItemPrice,
    StandardImage,
    ExtraImages,
    StockStatus,
    StockQty,
    ReviewCount,
    ReviewAvgRating,
    CollectedPhases: successfulSteps.join(','),
  };
}

module.exports = { collectProductData };
