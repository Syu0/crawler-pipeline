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

    const detailImages = await page.evaluate(() => {
      // 쿠팡 상세 설명 컨테이너 후보
      const containers = [
        document.querySelector('#productDetail'),
        document.querySelector('#productDescription'),
        document.querySelector('.prod-description-content'),
        document.querySelector('.prod-description'),
        document.querySelector('[class*="productDetail"]'),
        document.querySelector('[id*="detail"]'),
      ].filter(Boolean);

      const urls = new Set();

      containers.forEach((container) => {
        container.querySelectorAll('img').forEach((img) => {
          const src = img.src || img.dataset.src || img.dataset.lazySrc || '';
          if (src && src.startsWith('http') && !src.includes('icon') && !src.includes('logo')) {
            urls.add(src);
          }
        });
      });

      // 컨테이너 없으면 전체 페이지에서 큰 이미지만 (width/height 속성 기준)
      if (!urls.size) {
        document.querySelectorAll('img').forEach((img) => {
          const w = parseInt(img.getAttribute('width') || '0', 10);
          const h = parseInt(img.getAttribute('height') || '0', 10);
          if ((w >= 300 || h >= 300) || (!w && !h)) {
            const src = img.src || img.dataset.src || '';
            if (src && src.startsWith('http')) urls.add(src);
          }
        });
      }

      return Array.from(urls).slice(0, 20);
    });

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
  let stockStatus = 'UNKNOWN';
  let stockQty = null;
  try {
    const stockResult = await page.evaluate(() => {
      // 품절 판단 — 여러 패턴
      const soldOutTexts = ['품절', '일시품절', '재고없음', 'sold out', '판매완료'];
      const bodyText = document.body.innerText.toLowerCase();

      // 구매 버튼이 없거나 비활성이면 OUT_OF_STOCK
      const buyBtn = document.querySelector(
        '.prod-buy-btn, .buy-btn, button[class*="buy"], .btn-order'
      );
      if (buyBtn && (buyBtn.disabled || buyBtn.classList.contains('disabled'))) {
        return { stockStatus: 'OUT_OF_STOCK', stockQty: null };
      }

      // 품절 전용 UI 요소
      const soldOutEl = document.querySelector(
        '.sold-out-text, .prod-soldout, [class*="soldOut"], .out-of-stock'
      );
      if (soldOutEl && soldOutEl.offsetParent !== null) {
        return { stockStatus: 'OUT_OF_STOCK', stockQty: null };
      }

      // 텍스트 기반 판단
      for (const t of soldOutTexts) {
        if (bodyText.includes(t)) {
          return { stockStatus: 'OUT_OF_STOCK', stockQty: null };
        }
      }

      // 재고 적음 표시 ("N개 남음", "잔여 N개")
      const lowStockMatch = document.body.innerText.match(/([0-9]+)\s*개\s*(남음|밖에\s*없|잔여)/);
      if (lowStockMatch) {
        return { stockStatus: 'LOW_STOCK', stockQty: parseInt(lowStockMatch[1], 10) };
      }

      return { stockStatus: 'IN_STOCK', stockQty: null };
    });

    stockStatus = stockResult.stockStatus;
    stockQty = stockResult.stockQty;
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

  try {
    const result = await page.evaluate(() => {
      // 리뷰 건수 — 여러 셀렉터
      let count = null;
      const countSelectors = [
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
          if (raw) { count = parseInt(raw, 10); break; }
        }
      }

      // 별점 — 여러 셀렉터
      let rating = null;
      const ratingSelectors = [
        '.rating-star-num',
        '.rating-score',
        '[class*="ratingScore"]',
        '[class*="rating-num"]',
        '.star-score',
      ];
      for (const sel of ratingSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const raw = el.textContent.trim();
          const parsed = parseFloat(raw);
          if (!isNaN(parsed) && parsed >= 0 && parsed <= 5) {
            rating = parsed;
            break;
          }
        }
      }

      return { count, rating };
    });

    reviewCount = result.count;
    reviewAvgRating = result.rating;
  } catch (e) {
    console.warn(`[detailPageParser] parseReviews failed: ${e.message}`);
  }

  return { reviewCount, reviewAvgRating };
}

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------
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
