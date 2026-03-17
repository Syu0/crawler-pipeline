/**
 * detailPageParser.js — 상품 상세 페이지 Phase별 데이터 추출
 *
 * 각 Phase 함수는 이미 로드된 Playwright Page 객체를 받아 데이터를 추출한다.
 * Phase 1은 playwrightScraper.js 담당. 이 파일은 Phase 2-5를 담당한다.
 *
 * Phase 정의:
 *   1 — 기본 정보 (title, price, standardImage, description)  ← playwrightScraper.js 담당
 *   2 — 옵션 정보 (optionType, optionsRaw)
 *   3 — 상세 이미지 (detailImages)  ← 스크롤 + lazy-load 대기
 *   4 — 추가 정보 (weightKg, stockStatus, stockQty, productAttributes)
 *   5 — 리뷰 정보 (reviewCount, reviewAvgRating)
 *
 * 개별 필드 수집 실패 시 → warn 로그 + fallback 값 반환, row 전체 실패 금지.
 */

'use strict';

// ---------------------------------------------------------------------------
// Phase 1 — 기본 정보 (playwrightScraper.js 담당 — 스텁 유지)
// ---------------------------------------------------------------------------
async function parseBasicInfo(page) {
  return {};
}

// ---------------------------------------------------------------------------
// Phase 2 — 옵션 정보
// ---------------------------------------------------------------------------
/**
 * Phase 2: 옵션 정보
 * optionType: 'NONE' | 'SIZE' | 'COLOR' | 'CUSTOM' | 'MULTI'
 * optionsRaw: { axes: [{ axisType, values: [{ name, isAvailable, priceDelta }] }] } | null
 */
async function parseOptions(page) {
  try {
    const result = await page.evaluate(() => {
      // 쿠팡 옵션 구조: .prod-option 아래 여러 .unit-product 그룹
      // 각 그룹은 옵션 축 하나 (사이즈 / 색상 / 기타)
      const groupEls = document.querySelectorAll(
        '.prod-option .unit-product, .prod-option__selected-container'
      );

      if (!groupEls.length) {
        // 옵션 영역 자체가 없으면 NONE
        return { optionType: 'NONE', optionsRaw: null };
      }

      const axes = [];

      groupEls.forEach((group) => {
        // 축 이름
        const labelEl = group.querySelector(
          '.unit-title, .prod-option__type, .option-title, legend'
        );
        const axisLabel = labelEl ? labelEl.textContent.trim() : '';

        // 옵션 값 버튼/아이템 목록
        const itemEls = group.querySelectorAll(
          '.unit-item, .prod-option__item, .option-list-item'
        );
        if (!itemEls.length) return;

        const values = [];
        itemEls.forEach((item) => {
          const nameEl =
            item.querySelector('.unit-name, .prod-option__name, .option-text') || item;
          const name = nameEl.textContent.trim();
          if (!name) return;

          // 품절/비활성 판단
          const isUnavailable =
            item.classList.contains('disabled') ||
            item.classList.contains('sold-out') ||
            item.hasAttribute('disabled') ||
            !!item.querySelector('.sold-out-img, .option-sold-out');

          // 가격 delta ("+500원" 형태)
          const priceEl = item.querySelector('.unit-price, .option-price, .price-delta');
          let priceDelta = 0;
          if (priceEl) {
            const raw = priceEl.textContent.replace(/[^0-9-]/g, '');
            priceDelta = parseInt(raw, 10) || 0;
          }

          values.push({ name, isAvailable: !isUnavailable, priceDelta });
        });

        if (!values.length) return;

        // axisType 판단
        const upper = axisLabel.toUpperCase();
        let axisType = 'CUSTOM';
        if (upper.includes('사이즈') || upper.includes('SIZE') || upper.includes('용량') || upper.includes('개수') || upper.includes('수량')) {
          axisType = 'SIZE';
        } else if (upper.includes('색') || upper.includes('COLOR') || upper.includes('컬러')) {
          axisType = 'COLOR';
        }

        axes.push({ axisType, values });
      });

      if (!axes.length) {
        return { optionType: 'NONE', optionsRaw: null };
      }

      let optionType = 'CUSTOM';
      if (axes.length >= 2) {
        optionType = 'MULTI';
      } else if (axes[0].axisType === 'SIZE') {
        optionType = 'SIZE';
      } else if (axes[0].axisType === 'COLOR') {
        optionType = 'COLOR';
      }

      return { optionType, optionsRaw: { axes } };
    });

    return result;
  } catch (e) {
    console.warn(`[detailPageParser] parseOptions failed: ${e.message}`);
    return { optionType: 'NONE', optionsRaw: null };
  }
}

// ---------------------------------------------------------------------------
// Phase 3 — 상세 이미지
// ---------------------------------------------------------------------------
/**
 * Phase 3: 상세 설명 영역 이미지 수집 (max 20개)
 * 스크롤 후 lazy-load 이미지까지 포함한다.
 */
async function parseDetailImages(page) {
  try {
    // 상세 설명 영역까지 스크롤 + lazy-load 대기
    await scrollToBottom(page);
    await page.waitForTimeout(2000);

    // 두 셀렉터 병렬 수집 — 결과가 많은 쪽 사용
    const [imgs1, imgs2] = await Promise.all([
      page.$$eval('div.type-IMAGE_NO_SPACE img', (imgs) =>
        imgs.map((img) => img.src || img.dataset.src || '').filter(Boolean)
      ).catch(() => []),
      page.$$eval('div.subType-IMAGE img', (imgs) =>
        imgs.map((img) => img.src || img.dataset.src || '').filter(Boolean)
      ).catch(() => []),
    ]);
    const rawImages = imgs1.length >= imgs2.length ? imgs1 : imgs2;

    const detailImages = [...new Set(rawImages.map(normalizeDetailImageUrl))]
      .filter(isProductDetailImage)
      .slice(0, 20);

    return { detailImages };
  } catch (e) {
    console.warn(`[detailPageParser] parseDetailImages failed: ${e.message}`);
    return { detailImages: [] };
  }
}

// ---------------------------------------------------------------------------
// Phase 4 — 추가 정보 (재고, 무게, 상품 속성)
// ---------------------------------------------------------------------------
/**
 * Phase 4: 재고 상태, 수량, 무게, 상품 속성
 * stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN'
 */
async function parseProductInfo(page) {
  // ── 재고 상태 ──────────────────────────────────────────────────────────────
  // 판단 우선순위:
  //   1순위: 명시적 품절 UI (CSS 셀렉터) → OUT_OF_STOCK
  //   2순위: 가격 요소 존재 → IN_STOCK
  //   3순위: 가격도 없고 품절 표시도 없음 → UNKNOWN
  let stockStatus = 'UNKNOWN';
  let stockQty = null;
  try {
    // 가격 요소가 있으면 IN_STOCK 기본값
    const priceEl = await page.$('.final-price-amount, .prod-price .total-price, .price-wrap .total-price');
    stockStatus = priceEl ? 'IN_STOCK' : 'UNKNOWN';

    // 명시적 품절 UI 요소 → OUT_OF_STOCK 오버라이드 (텍스트 기반 오탐 방지)
    const outOfStockEl = await page.$(
      '.oos-price, .soldout, [class*="sold-out"], [class*="outOfStock"], .sold-out-text, .prod-soldout, .out-of-stock'
    );
    if (outOfStockEl) {
      stockStatus = 'OUT_OF_STOCK';
    } else {
      // 구매 버튼 비활성화 → OUT_OF_STOCK
      const buyBtnDisabled = await page.evaluate(() => {
        const btn = document.querySelector('.prod-buy-btn, .buy-btn, button[class*="buy"], .btn-order');
        return btn && (btn.disabled || btn.classList.contains('disabled'));
      });
      if (buyBtnDisabled) stockStatus = 'OUT_OF_STOCK';
    }

    // 재고 적음 ("N개 남음") — 구매 영역 한정, IN_STOCK일 때만 체크
    if (stockStatus === 'IN_STOCK') {
      const lowStockQty = await page.evaluate(() => {
        const prodArea = document.querySelector('#prod-right-area, .prod-buy-area, .prod-right-area');
        const text = prodArea ? prodArea.innerText : '';
        const match = text.match(/([0-9]+)\s*개\s*(남음|밖에\s*없|잔여)/);
        return match ? parseInt(match[1], 10) : null;
      });
      if (lowStockQty !== null) {
        stockStatus = 'LOW_STOCK';
        stockQty = lowStockQty;
      }
    }
  } catch (e) {
    console.warn(`[detailPageParser] stockStatus failed: ${e.message}`);
    stockStatus = 'UNKNOWN';
  }

  // ── 무게 ───────────────────────────────────────────────────────────────────
  let weightKg = 1;
  try {
    const rawWeight = await page.evaluate(() => {
      // 상품 속성 테이블에서 무게/중량 키워드 탐색
      const rows = document.querySelectorAll(
        '.prod-attr-table tr, .spec-list li, .attribute-list li, table.product-info tr'
      );
      for (const row of rows) {
        const text = row.textContent;
        if (text.match(/무게|중량|weight/i)) {
          const match = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(kg|g|그램|킬로)/i);
          if (match) return { value: parseFloat(match[1]), unit: match[2].toLowerCase() };
        }
      }
      return null;
    });

    if (rawWeight) {
      const unit = rawWeight.unit;
      weightKg =
        unit === 'g' || unit === '그램'
          ? rawWeight.value / 1000
          : rawWeight.value;
      weightKg = Math.round(weightKg * 100) / 100;
    }
  } catch (e) {
    console.warn(`[detailPageParser] weightKg failed: ${e.message}`);
  }

  // ── 상품 속성 ──────────────────────────────────────────────────────────────
  let productAttributes = null;
  try {
    productAttributes = await page.evaluate(() => {
      const attrs = {};
      // 속성 테이블 (th/td 쌍 또는 dt/dd 쌍)
      document.querySelectorAll(
        '.prod-attr-table tr, .spec-list li, dl.product-attr dt, dl.product-attr dd'
      ).forEach((row) => {
        const key = row.querySelector('th, dt, .attr-key');
        const val = row.querySelector('td, dd, .attr-val');
        if (key && val) {
          attrs[key.textContent.trim()] = val.textContent.trim();
        }
      });
      return Object.keys(attrs).length ? attrs : null;
    });
  } catch (e) {
    console.warn(`[detailPageParser] productAttributes failed: ${e.message}`);
  }

  return { weightKg, stockStatus, stockQty, productAttributes };
}

// ---------------------------------------------------------------------------
// Phase 5 — 리뷰 정보
// ---------------------------------------------------------------------------
/**
 * Phase 5: 리뷰 건수 + 평균 별점
 */
async function parseReviews(page) {
  let reviewCount = null;
  let reviewAvgRating = null;

  // 리뷰 건수 — 셀렉터 순회
  try {
    reviewCount = await page.evaluate(() => {
      const countSelectors = [
        '.count-review',
        '.prod-rating__count',
        '.rating-total-count',
        '[data-ratingcount]',
        '[class*="review-count"]',
        '.review-count',
        '.rating-review-count',
        '[class*="reviewCount"]',
        '[class*="review-total"]',
        'a[href*="#review"] span',
      ];
      for (const sel of countSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const raw = el.textContent.replace(/[^0-9]/g, '');
          if (raw) return parseInt(raw, 10);
        }
      }
      return null;
    });
  } catch (e) {
    console.warn(`[detailPageParser] reviewCount failed: ${e.message}`);
  }

  // 별점 + 리뷰 요약 — article 단위 수집 (상위 5개)
  let reviewSummary = null;
  try {
    const reviews = await page.$$eval('article', (articles) =>
      articles.slice(0, 5).map((article) => {
        const fullStars = article.querySelectorAll('i[class*="twc-bg-full-star"]').length;
        const titleEl = article.querySelector('[class*="twc-mb-"][class*="twc-font-bold"]');
        const contentEl = article.querySelector('span[translate="no"]');
        const dateEls = article.querySelectorAll('[class*="twc-text-bluegray-700"]');
        const dateEl = Array.from(dateEls).find((el) => /\d{4}\.\d{2}\.\d{2}/.test(el.textContent));
        return {
          rating: fullStars,
          title: titleEl ? titleEl.textContent.trim() : null,
          content: contentEl ? contentEl.textContent.trim().slice(0, 500) : null,
          date: dateEl ? dateEl.textContent.trim() : null,
        };
      }).filter((r) => r.rating > 0)
    );

    if (reviews.length > 0) {
      const total = reviews.reduce((a, r) => a + r.rating, 0);
      reviewAvgRating = Math.round(total / reviews.length * 10) / 10;
      reviewSummary = JSON.stringify(reviews);
    }
  } catch (e) {
    console.warn(`[detailPageParser] reviewSummary failed: ${e.message}`);
  }

  return { reviewCount, reviewAvgRating, reviewSummary };
}

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------
/**
 * 상세 이미지 URL 해상도 파라미터를 492x492ex로 교체하고 프로토콜을 보장한다.
 */
function normalizeDetailImageUrl(src) {
  if (!src) return '';
  let url = src.startsWith('//') ? 'https:' + src : src;
  url = url.replace(/\/remote\/[^/]+\//, '/remote/492x492ex/');
  return url;
}

/**
 * 쿠팡 상품 상세 이미지 URL 판별 — 로고/아이콘/썸네일 제외
 */
function isProductDetailImage(url) {
  if (!url || typeof url !== 'string') return false;
  return (
    url.includes('vendor_inventory') ||
    url.includes('/image/product/') ||
    url.includes('/image/retail/images/') ||
    (url.startsWith('https://thumbnail.coupangcdn.com/thumbnails/remote/') &&
      !url.includes('48x48'))
  );
}

/**
 * 페이지 하단까지 점진적 스크롤 (lazy-load 이미지 트리거용)
 */
async function scrollToBottom(page) {
  await page.evaluate(async () => {
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 10; i++) {
      window.scrollBy(0, window.innerHeight);
      await delay(300);
    }
  });
}

// ---------------------------------------------------------------------------
// 전체 Phase 실행기
// ---------------------------------------------------------------------------
/**
 * 전체 Phase 실행기
 * @param {import('playwright').Page} page - 상품 URL이 이미 로드된 Page
 * @param {string[]} phases - 실행할 Phase 목록 (기본: ['2','3','4','5'])
 * @returns {Promise<object>} 모든 Phase 결과 합친 객체 + collectedPhases
 */
async function collectAllPhases(page, phases = ['2', '3', '4', '5']) {
  const result = {};

  if (phases.includes('1')) {
    Object.assign(result, await parseBasicInfo(page));
  }
  if (phases.includes('2')) {
    Object.assign(result, await parseOptions(page));
  }
  if (phases.includes('3')) {
    // parseDetailImages 내부에서 스크롤 처리
    Object.assign(result, await parseDetailImages(page));
  }
  if (phases.includes('4')) {
    Object.assign(result, await parseProductInfo(page));
  }
  if (phases.includes('5')) {
    Object.assign(result, await parseReviews(page));
  }

  result.collectedPhases = phases.join(',');
  return result;
}

module.exports = {
  parseBasicInfo,
  parseOptions,
  parseDetailImages,
  parseProductInfo,
  parseReviews,
  collectAllPhases,
};
