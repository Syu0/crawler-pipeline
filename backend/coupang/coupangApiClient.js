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
 * CDN size 세그먼트는 그대로 유지.
 */
function normalizeImageUrl(url) {
  if (!url) return null;
  return url.startsWith('//') ? `https:${url}` : url;
}

/**
 * 슬라이더(ExtraImages)용 URL 포맷을 800x800ex로 통일.
 * 쿠팡 상세 페이지는 섬네일용 492x492ex 세그먼트로 이미지를 주므로, Qoo10 슬라이더
 * EnlargedImage 품질을 위해 수집 시점에 upsize한다. 2026-04-24 해상도 실측으로
 * 원본이 최소 1948px~4009px임을 확인 — 800x800ex는 Qoo10 측에서 즉시 제공 가능한 해상도.
 *
 * DetailImages(`/q89/`)는 이미 원본 해상도로 수집되므로 대상 아님.
 */
function upsizeSliderUrl(url) {
  if (!url) return url;
  return url.replace(/\/\d+x\d+(?:ex|cr)\//, '/800x800ex/');
}

// ── evaluate 함수 빌더 ────────────────────────────────────────────────────────

function buildImageExtractFn() {
  return `() => {
    // 메인 이미지: twc-w-full + twc-max-h 클래스 조합 (현행 쿠팡 구조, 492x492ex 대표 이미지)
    // vendor_inventory 경로도 메인 이미지면 유효 — 셀렉터가 이미 메인 영역에 특화되어 있음
    const hasSrc = (el) => !!el?.src;
    const mainEl =
      [...document.querySelectorAll('img.twc-w-full[class*="twc-max-h"]')].find(hasSrc) ||
      [...document.querySelectorAll('.main-image img')].find(hasSrc) ||
      [...document.querySelectorAll('[class*="prod-image"] img')].find(hasSrc) ||
      [...document.querySelectorAll('[class*="cdp-img"] img')].find(hasSrc) ||
      [...document.querySelectorAll('img[class*="main-image"]')].find(hasSrc);
    const main = mainEl?.src || null;

    // 슬라이더 썸네일: twc-w-[70px] 클래스를 가진 img (DOM 분석 결과 — 케이스 1: 3개, 케이스 2: 1개 확인)
    const allImgs = Array.from(document.querySelectorAll('img'));
    const sliderEls = allImgs.filter(el =>
      el.className && el.className.includes('twc-w-[70px]') &&
      el.src && el.src.includes('thumbnail.coupangcdn')
    );

    // 상세페이지 이미지: .subType-IMAGE (슬라이더와 독립적으로 수집)
    const detailEls = [
      '.subType-IMAGE img',
      '[class*="detail-image"] img',
    ].flatMap((sel) => Array.from(document.querySelectorAll(sel)));

    const normalizeSrc = (el) => el?.src || el?.dataset?.src || el?.getAttribute('data-src') || '';
    const toUrl = (el) => {
      const src = normalizeSrc(el);
      return src && src.startsWith('//') ? 'https:' + src : src;
    };

    const unique = (arr) => [...new Set(arr.filter(Boolean))];

    // 슬라이더 URL 해상도 업그레이드: 48x48ex → 492x492ex (메인 이미지와 동일 해상도)
    const slider = unique(
      sliderEls.map(toUrl).map(src => src.replace('/48x48ex/', '/492x492ex/'))
    );
    const detail = unique(detailEls.map(toUrl));

    // 브레드크럼에서 categoryId + breadcrumbTexts 추출
    const breadcrumbLinks = Array.from(
      document.querySelectorAll('ul.breadcrumb li a[href*="/np/categories/"]')
    );
    let categoryId = null;
    const breadcrumbTexts = [];
    for (const a of breadcrumbLinks) {
      const match = a.href.match(/\\/np\\/categories\\/(\\d+)/);
      if (match) {
        categoryId = match[1];
        breadcrumbTexts.push(a.textContent.trim());
      }
    }

    return {
      main,
      extra: slider,    // ExtraImages: 슬라이더만
      detail: detail,   // DetailImages: 상세페이지만
      categoryId,
      breadcrumbTexts,
    };
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
async function collectProductData(productId, vendorItemId, _itemId) {
  const successfulSteps = [];

  let StandardImage = null;
  let ExtraImages = [];
  let DetailImages = [];
  let ItemTitle = null;
  let ItemPrice = null;
  let StockStatus = null;
  let StockQty = null;
  let ReviewCount = null;
  let ReviewAvgRating = null;
  let categoryId = null;
  let breadcrumbTexts = [];

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

    const rawExtra = Array.isArray(result.extra) ? result.extra : [];
    const rawDetail = Array.isArray(result.detail) ? result.detail : [];

    // ExtraImages: 슬라이더 이미지 (EditGoodsMultiImage 상단 갤러리용).
    // 쿠팡 DOM은 섬네일용 492x492ex로 src를 주므로 800x800ex로 upsize (Qoo10 슬라이더 품질).
    ExtraImages = [...new Set(rawExtra.map(normalizeImageUrl).map(upsizeSliderUrl).filter(Boolean))];
    // DetailImages: 상세페이지 이미지 (DESC vision 입력용). /q89/ 원본 해상도 유지.
    DetailImages = [...new Set(rawDetail.map(normalizeImageUrl).filter(Boolean))];

    categoryId = result.categoryId || null;
    breadcrumbTexts = Array.isArray(result.breadcrumbTexts) ? result.breadcrumbTexts : [];
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

      // ItemPrice: 쿠폰할인형 상품은 i18nSalePrice=null이므로 fallback 순서로 파싱
      // i18nCouponPrice.amount → i18nSalePrice.amount → i18nOriginPrice.amount
      const p = data?.[0]?.price;
      const rawPrice =
        p?.i18nCouponPrice?.amount ??
        p?.i18nSalePrice?.amount ??
        p?.i18nOriginPrice?.amount ??
        null;
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

  // B-01: ItemTitle 빈값이면 수집 실패 처리
  if (!ItemTitle || !ItemTitle.trim()) {
    throw new Error('ItemTitle 수집 실패 — quantity-info API 응답에 ItemTitle 없음');
  }

  return {
    ItemTitle,
    ItemPrice,
    StandardImage,
    ExtraImages,
    DetailImages,
    StockStatus,
    StockQty,
    ReviewCount,
    ReviewAvgRating,
    categoryId,
    breadcrumbTexts,
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
      const p = data?.[0]?.price;
      const rawPrice =
        p?.i18nCouponPrice?.amount ??
        p?.i18nSalePrice?.amount ??
        p?.i18nOriginPrice?.amount ??
        null;
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

  // B-01: ItemTitle 빈값이면 수집 실패 처리
  if (!ItemTitle || !ItemTitle.trim()) {
    throw new Error('ItemTitle 수집 실패 — quantity-info API 응답에 ItemTitle 없음');
  }

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
