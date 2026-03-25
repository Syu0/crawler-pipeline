'use strict';

/**
 * coupangApiClient.js — Coupang 내부 API 수집기 (Chrome 데몬 fetch 기반)
 *
 * Playwright page.goto() 없이 Chrome 데몬의 page.evaluate(fetch()) 만 사용해
 * Coupang 내부 API 4개를 병렬 호출한다.
 *
 * 핵심:
 *   - page.goto() 없음 → 페이지 이동 CDP 핑거프린트 없음
 *   - Chrome 네트워크 스택 사용 → Chrome TLS/HTTP2 핑거프린트 유지
 *   - 쿠키는 browserManager.getContext()가 주입한 것을 Chrome이 자동으로 사용
 *
 * 전제 조건: npm run coupang:browser:start (Chrome 데몬 실행 중)
 *
 * API 4개:
 *   1. other-seller-info  → ItemTitle, ItemPrice, StandardImage, ExtraImages
 *   2. quantity-info      → OptionType, Options, StockStatus, StockQty
 *   3. review             → ReviewCount, ReviewAvgRating
 *   4. btf                → DetailImages, ProductAttributes
 */

const fs   = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// WS endpoint 파일 (browserManager.js 와 동일)
const ROOT    = path.join(__dirname, '..', '..');
const WS_FILE = path.join(ROOT, '.browser-ws-endpoint');

const BASE_URL = 'https://www.coupang.com';

// ── 모듈 레벨 캐시 ────────────────────────────────────────────────────────────
let _browser = null;
let _page    = null;

/**
 * Chrome 데몬의 coupang.com 페이지를 반환한다.
 * 연결이 끊기면 재연결, 페이지가 죽으면 재생성.
 */
async function getPage() {
  // 브라우저 연결 or 재연결
  if (!_browser) {
    if (!fs.existsSync(WS_FILE)) {
      throw new Error(
        '[coupangApiClient] Chrome 데몬이 실행되지 않았습니다.\n' +
        '  → npm run coupang:browser:start'
      );
    }
    const wsEndpoint = fs.readFileSync(WS_FILE, 'utf8').trim();
    if (!wsEndpoint) {
      throw new Error('[coupangApiClient] WS 엔드포인트 없음. 데몬을 재시작하세요.');
    }
    try {
      _browser = await chromium.connectOverCDP(wsEndpoint);
    } catch (e) {
      _browser = null;
      throw new Error(`[coupangApiClient] Chrome 데몬 연결 실패: ${e.message}`);
    }
  }

  // 페이지 생존 확인
  if (_page) {
    try {
      await _page.evaluate(() => true);
    } catch (_) {
      _page = null;
    }
  }

  if (!_page) {
    const contexts = _browser.contexts();
    if (contexts.length === 0) {
      throw new Error('[coupangApiClient] Chrome 컨텍스트 없음. 데몬 재시작 필요.');
    }
    const context = contexts[0];
    const pages = context.pages();

    // 기존 coupang.com 페이지 재사용 (있으면)
    _page = pages.find((p) => p.url().includes('coupang.com')) ?? null;

    if (!_page) {
      // 없으면 새 페이지를 만들고 coupang.com 홈으로 이동 (1회만)
      _page = await context.newPage();
      await _page.goto(`${BASE_URL}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
    }
  }

  return _page;
}

// ── 공통 Chrome fetch 래퍼 ────────────────────────────────────────────────────

/**
 * Chrome 페이지 내부에서 fetch()를 실행해 JSON 데이터를 반환한다.
 *
 * @param {string} url
 * @returns {Promise<{ ok: boolean, data?: any, blocked?: boolean, error?: string, status: number }>}
 */
async function coupangFetch(url) {
  const page = await getPage();

  const result = await page.evaluate(async (fetchUrl) => {
    try {
      const res = await fetch(fetchUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'ko-KR,ko;q=0.9',
          'sec-fetch-site': 'same-origin',
          'sec-fetch-mode': 'cors',
          'sec-fetch-dest': 'empty',
        },
        credentials: 'include',
      });

      if (!res.ok) {
        return { ok: false, status: res.status, body: null };
      }

      const body = await res.text();
      return { ok: true, status: res.status, body };
    } catch (e) {
      return { ok: false, status: 0, error: e.message, body: null };
    }
  }, url);

  if (!result.ok) {
    if (result.status === 403 || result.status === 429) {
      return { ok: false, blocked: true, status: result.status };
    }
    if (result.error) {
      return { ok: false, error: 'NETWORK_ERROR', message: result.error, status: 0 };
    }
    return { ok: false, error: 'HTTP_ERROR', status: result.status };
  }

  try {
    const data = JSON.parse(result.body);
    return { ok: true, data, status: result.status };
  } catch (_) {
    return { ok: false, error: 'PARSE_ERROR', status: result.status };
  }
}

// ── API 1: other-seller-info ──────────────────────────────────────────────────

async function fetchOtherSellerInfo(productId, vendorItemId, itemId) {
  const url =
    `${BASE_URL}/vp/products/${productId}/other-seller-info` +
    `?vendorItemId=${vendorItemId}&itemId=${itemId}`;

  const res = await coupangFetch(url);
  if (!res.ok) return { blocked: res.blocked, error: res.error, status: res.status };

  const d = res.data;

  // 타이틀 (다양한 응답 경로 시도)
  const ItemTitle =
    d?.data?.item?.productName ||
    d?.data?.productName ||
    d?.productName ||
    null;

  // 가격 (정수)
  const rawPrice =
    d?.data?.item?.salePrice ??
    d?.data?.salePrice ??
    d?.salePrice ??
    d?.data?.item?.basePrice ??
    null;
  const ItemPrice =
    rawPrice != null
      ? parseInt(String(rawPrice).replace(/[^0-9]/g, ''), 10) || null
      : null;

  // 대표 이미지 — thumbnails/... 정규화
  const rawThumb =
    d?.data?.item?.thumbnailImage ||
    d?.data?.thumbnailImage ||
    d?.thumbnailImage ||
    null;
  const StandardImage = rawThumb
    ? rawThumb
        .replace(/^https?:\/\/thumbnail\.coupangcdn\.com\//, 'thumbnails/')
        .replace(/^\/\/thumbnail\.coupangcdn\.com\//, 'thumbnails/')
    : null;

  // 추가 이미지
  const rawExtra =
    d?.data?.item?.additionalImages ||
    d?.data?.additionalImages ||
    d?.additionalImages ||
    [];
  const ExtraImages = Array.isArray(rawExtra)
    ? rawExtra
        .map((img) =>
          typeof img === 'string'
            ? img
            : (img?.url || img?.imageUrl || null)
        )
        .filter(Boolean)
    : [];

  return { ItemTitle, ItemPrice, StandardImage, ExtraImages };
}

// ── API 2: quantity-info ──────────────────────────────────────────────────────

async function fetchQuantityInfo(productId, vendorItemId) {
  const url =
    `${BASE_URL}/vp/products/${productId}/quantity-info` +
    `?vendorItemId=${vendorItemId}`;

  const res = await coupangFetch(url);
  if (!res.ok) return { blocked: res.blocked, error: res.error, status: res.status };

  const d = res.data;

  const OptionType = d?.data?.optionType || d?.optionType || null;

  const rawOptions = d?.data?.options || d?.options || null;
  const Options = rawOptions ? JSON.stringify(rawOptions) : null;

  const available = d?.data?.available ?? d?.available ?? null;
  const qty       = d?.data?.quantity ?? d?.data?.qty ?? d?.quantity ?? null;

  let StockStatus = null;
  if (available != null) {
    if (!available || available === false || available === 0) {
      StockStatus = 'OUT_OF_STOCK';
    } else if (qty != null && parseInt(qty, 10) <= 5) {
      StockStatus = 'LOW_STOCK';
    } else {
      StockStatus = 'IN_STOCK';
    }
  }
  const StockQty = qty != null ? parseInt(qty, 10) : null;

  return { OptionType, Options, StockStatus, StockQty };
}

// ── API 3: review ─────────────────────────────────────────────────────────────

async function fetchReview(productId) {
  const url =
    `${BASE_URL}/vp/products/${productId}/review` +
    `?productId=${productId}&page=1&size=10&sortBy=ORDER_SCORE_ASC`;

  const res = await coupangFetch(url);
  if (!res.ok) return { blocked: res.blocked, error: res.error, status: res.status };

  const d = res.data;

  const rawCount =
    d?.data?.reviewCount ??
    d?.data?.totalCount ??
    d?.reviewCount ??
    null;
  const rawRating =
    d?.data?.avgRating ??
    d?.data?.averageRating ??
    d?.avgRating ??
    null;

  return {
    ReviewCount:     rawCount  != null ? parseInt(rawCount, 10)    : null,
    ReviewAvgRating: rawRating != null ? parseFloat(rawRating)     : null,
  };
}

// ── API 4: btf ────────────────────────────────────────────────────────────────

async function fetchBtf(productId, vendorItemId, itemId) {
  const url =
    `${BASE_URL}/vp/products/${productId}/btf` +
    `?productId=${productId}&vendorItemId=${vendorItemId}&itemId=${itemId}`;

  const res = await coupangFetch(url);
  if (!res.ok) return { blocked: res.blocked, error: res.error, status: res.status };

  const d = res.data;

  // DetailImages: detailType=IMAGE 또는 imageType=true 인 항목의 content URL
  const details = d?.data?.details || d?.details || [];
  const DetailImages = Array.isArray(details)
    ? details
        .filter((item) => item?.detailType === 'IMAGE' || item?.imageType === true)
        .map((item) => {
          const imgUrl = item?.content || item?.imageUrl || item?.url;
          if (!imgUrl) return null;
          return imgUrl.startsWith('http') ? imgUrl : `https:${imgUrl}`;
        })
        .filter(Boolean)
    : [];

  // ProductAttributes: essentials → { title: description } 객체
  const essentials = d?.data?.essentials || d?.essentials || [];
  const ProductAttributes = {};
  if (Array.isArray(essentials)) {
    for (const item of essentials) {
      const key = item?.title || item?.name;
      const val = item?.description || item?.value;
      if (key && val) ProductAttributes[key] = val;
    }
  }

  return {
    DetailImages:       JSON.stringify(DetailImages),
    ProductAttributes:  JSON.stringify(ProductAttributes),
  };
}

// ── 통합 수집 함수 ────────────────────────────────────────────────────────────

/**
 * 4개 API를 병렬 호출해 시트 컬럼명으로 정규화된 객체를 반환한다.
 *
 * 개별 API 실패 → 해당 필드 null (전체 중단 없음).
 * 403/429 감지 → { blocked: true } 반환.
 *
 * @returns {Promise<{
 *   blocked?: boolean,
 *   ItemTitle?, ItemPrice?, StandardImage?, ExtraImages?,
 *   OptionType?, Options?, StockStatus?, StockQty?,
 *   ReviewCount?, ReviewAvgRating?,
 *   DetailImages?, ProductAttributes?,
 *   CollectedPhases: string
 * }>}
 */
async function collectProductData(productId, vendorItemId, itemId) {
  const [r1, r2, r3, r4] = await Promise.allSettled([
    fetchOtherSellerInfo(productId, vendorItemId, itemId),
    fetchQuantityInfo(productId, vendorItemId),
    fetchReview(productId),
    fetchBtf(productId, vendorItemId, itemId),
  ]);

  // 403/429 블록 감지
  for (const r of [r1, r2, r3, r4]) {
    if (r.status === 'fulfilled' && r.value?.blocked) {
      return { blocked: true, httpStatus: r.value.status };
    }
  }

  const v1 = r1.status === 'fulfilled' && !r1.value?.error ? r1.value : {};
  const v2 = r2.status === 'fulfilled' && !r2.value?.error ? r2.value : {};
  const v3 = r3.status === 'fulfilled' && !r3.value?.error ? r3.value : {};
  const v4 = r4.status === 'fulfilled' && !r4.value?.error ? r4.value : {};

  // 성공한 API 번호 (CollectedPhases 컬럼용)
  const successfulApis = [];
  if (r1.status === 'fulfilled' && !r1.value?.error && !r1.value?.blocked) successfulApis.push(1);
  if (r2.status === 'fulfilled' && !r2.value?.error && !r2.value?.blocked) successfulApis.push(2);
  if (r3.status === 'fulfilled' && !r3.value?.error && !r3.value?.blocked) successfulApis.push(3);
  if (r4.status === 'fulfilled' && !r4.value?.error && !r4.value?.blocked) successfulApis.push(4);

  return {
    // API 1
    ItemTitle:         v1.ItemTitle          ?? null,
    ItemPrice:         v1.ItemPrice          ?? null,
    StandardImage:     v1.StandardImage      ?? null,
    ExtraImages:       v1.ExtraImages        ?? [],
    // API 2
    OptionType:        v2.OptionType         ?? null,
    Options:           v2.Options            ?? null,
    StockStatus:       v2.StockStatus        ?? null,
    StockQty:          v2.StockQty           ?? null,
    // API 3
    ReviewCount:       v3.ReviewCount        ?? null,
    ReviewAvgRating:   v3.ReviewAvgRating    ?? null,
    // API 4
    DetailImages:      v4.DetailImages       ?? JSON.stringify([]),
    ProductAttributes: v4.ProductAttributes  ?? JSON.stringify({}),
    // 메타
    CollectedPhases: successfulApis.join(','),
  };
}

module.exports = {
  collectProductData,
  // 테스트용
  coupangFetch,
  fetchOtherSellerInfo,
  fetchQuantityInfo,
  fetchReview,
  fetchBtf,
};
