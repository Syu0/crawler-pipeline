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
  execSync(`openclaw browser --browser-profile chrome navigate "${escaped}"`, {
    encoding: 'utf8',
    timeout: 30_000,
  });
}

/**
 * 수집 완료 후 Chrome 탭을 about:blank로 이동하여 pending request 정리.
 * 실패해도 수집 결과에 영향 없음.
 */
function browserCleanupTab() {
  try {
    execSync(`openclaw browser --browser-profile chrome navigate "about:blank"`, {
      encoding: 'utf8',
      timeout: 5_000,
    });
  } catch (_) { /* ignore */ }
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
    `openclaw browser --browser-profile chrome evaluate --fn '${escaped}'`,
    { encoding: 'utf8', timeout: 15_000 }
  );
  return JSON.parse(stdout);
}

// ── URL 정규화 ────────────────────────────────────────────────────────────────

/**
 * 이미지 URL을 풀 HTTPS URL로 정규화.
 * protocol-relative("//...") → "https://..." 변환만 수행.
 * CDN size 세그먼트는 그대로 유지 ("origin"은 CDN 미지원 → 404 확인됨).
 */
function normalizeImageUrl(url) {
  if (!url) return null;
  return url.startsWith('//') ? `https:${url}` : url;
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

    // 슬라이더 썸네일: ul.twc-static li img
    const sliderImgs = Array.from(document.querySelectorAll('ul.twc-static li img'))
      .map(el => el.src || el.getAttribute('src'))
      .filter(Boolean);

    // 추가 이미지: subType-IMAGE 또는 상품 상세 이미지 섹션
    const extra = [
      ...document.querySelectorAll('.subType-IMAGE img'),
      ...document.querySelectorAll('[class*="detail-image"] img'),
    ].map(el => el.src || el.dataset?.src).filter(Boolean);

    // 브레드크럼에서 categoryId 추출
    const breadcrumbLinks = Array.from(
      document.querySelectorAll('ul.breadcrumb li a[href*="/np/categories/"]')
    );
    let categoryId = null;
    if (breadcrumbLinks.length > 0) {
      const lastHref = breadcrumbLinks[breadcrumbLinks.length - 1].href;
      const match = lastHref.match(/\\/np\\/categories\\/(\\d+)/);
      categoryId = match ? match[1] : null;
    }

    return { main, sliderImages: sliderImgs, detailImages: [...new Set(extra)], categoryId };
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
 *   StandardImage?: string, DetailImages: string[],
 *   StockStatus?: string, StockQty?: number,
 *   ReviewCount?: number, ReviewAvgRating?: number,
 *   CollectedPhases: string
 * }>}
 */
async function collectProductData(productId, vendorItemId, _itemId) {
  const successfulSteps = [];

  let StandardImage = null;
  let SliderImages = null;
  let DetailImages = [];
  let ItemTitle = null;
  let ItemPrice = null;
  let StockStatus = null;
  let StockQty = null;
  let ReviewCount = null;
  let ReviewAvgRating = null;
  let categoryId = null;

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

  // ── Step 2: DOM 이미지 + categoryId 추출 ──────────────────────────────────
  try {
    const result = browserEvaluate(buildImageExtractFn());
    StandardImage = normalizeImageUrl(result.main);

    // 슬라이더 썸네일: URL 정규화 후 StandardImage와 중복 제거
    // 썸네일 크기 세그먼트가 달라도 같은 이미지일 수 있으므로 경로 부분으로 비교
    const stdPath = StandardImage
      ? StandardImage.replace(/^https?:\/\/[^/]+/, '').replace(/\/\d+x\d+\w*\//, '/')
      : null;
    const rawSlider = (result.sliderImages || []).map(normalizeImageUrl).filter(Boolean);
    const deduped = rawSlider.filter((url) => {
      const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/\/\d+x\d+\w*\//, '/');
      return path !== stdPath;
    });
    SliderImages = deduped.length > 0 ? deduped : null;

    DetailImages = (result.detailImages || []).map(normalizeImageUrl).filter(Boolean);
    categoryId = result.categoryId || null;
    successfulSteps.push(2);
  } catch (e) {
    console.warn(`  [step2/images] ${e.message.split('\n')[0]}`);
  }

  // ── Step 3: quantity-info ───────────────────────────────────────────────────
  try {
    const result = browserEvaluate(buildQuantityInfoFn(productId, vendorItemId));
    if (result.status === 403 || result.status === 429) {
      browserCleanupTab();
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
      browserCleanupTab();
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

  browserCleanupTab();

  return {
    ItemTitle,
    ItemPrice,
    StandardImage,
    SliderImages,
    DetailImages,
    StockStatus,
    StockQty,
    ReviewCount,
    ReviewAvgRating,
    categoryId,
    CollectedPhases: successfulSteps.join(','),
  };
}

/**
 * dedup 행 전용: navigate + quantity-info + review 만 수집 (이미지 제외).
 * 동일 product_id의 다른 옵션(vendorItemId)에 대해 가격·재고·리뷰만 가져온다.
 *
 * @returns {Promise<{
 *   blocked?: boolean, error?: string,
 *   ItemTitle?: string, ItemPrice?: number,
 *   StockStatus?: string, StockQty?: number,
 *   ReviewCount?: number, ReviewAvgRating?: number,
 *   CollectedPhases: string
 * }>}
 */
async function collectPriceStockReview(productId, vendorItemId) {
  const successfulSteps = [];

  let ItemTitle = null;
  let ItemPrice = null;
  let StockStatus = null;
  let StockQty = null;
  let ReviewCount = null;
  let ReviewAvgRating = null;

  // Step 1: navigate
  try {
    const url = `${BASE_URL}/vp/products/${productId}?vendorItemId=${vendorItemId}`;
    browserNavigate(url);
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    successfulSteps.push(1);
  } catch (e) {
    return { error: 'NAVIGATE_ERROR', message: e.message };
  }

  // Step 3: quantity-info
  try {
    const result = browserEvaluate(buildQuantityInfoFn(productId, vendorItemId));
    if (result.status === 403 || result.status === 429) {
      browserCleanupTab();
      return { blocked: true, httpStatus: result.status };
    }
    const data = result.body;
    if (data) {
      const moduleData = data?.[0]?.moduleData;
      if (Array.isArray(moduleData)) {
        const infoModule = moduleData.find(
          (m) => m.viewType === 'PRODUCT_DETAIL_PRODUCT_INFO'
        );
        ItemTitle = infoModule?.title || null;
      }
      const rawPrice = data?.[0]?.price?.i18nSalePrice?.amount;
      if (rawPrice != null) {
        ItemPrice = parseInt(String(rawPrice).replace(/[^0-9]/g, ''), 10) || null;
      }
      const qty = data?.[0]?.quantity;
      if (qty != null) {
        StockQty = qty;
        StockStatus = qty > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK';
      } else {
        StockStatus = 'IN_STOCK';
      }
      successfulSteps.push(3);
    }
  } catch (e) {
    console.warn(`  [step3/quantity-info] ${e.message.split('\n')[0]}`);
  }

  // Step 4: review
  try {
    const result = browserEvaluate(buildReviewFn(productId));
    if (result.status === 403 || result.status === 429) {
      browserCleanupTab();
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

  browserCleanupTab();

  return {
    ItemTitle,
    ItemPrice,
    StockStatus,
    StockQty,
    ReviewCount,
    ReviewAvgRating,
    CollectedPhases: successfulSteps.join(','),
  };
}

module.exports = { collectProductData, collectPriceStockReview };
