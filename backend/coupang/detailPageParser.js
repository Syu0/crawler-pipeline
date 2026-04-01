/**
 * detailPageParser.js — 상품 상세 페이지 Phase별 데이터 추출
 *
 * 각 Phase 함수는 이미 로드된 Playwright Page 객체를 받아 데이터를 추출한다.
 * 현재는 Phase 1만 기존 playwrightScraper.js로 처리하므로 모든 함수가 스텁.
 * 셀렉터는 브라우저 테스트 후 확정하여 채운다.
 *
 * Phase 정의:
 *   1 — 기본 정보 (title, price, standardImage, description)  ← playwrightScraper.js 담당
 *   2 — 옵션 정보 (optionType, optionsRaw)
 *   3 — 상세 이미지 (detailImages)  ← 스크롤 + lazy-load 대기 필요
 *   4 — 추가 정보 (weightKg, stockStatus, stockQty, productAttributes)
 *   5 — 리뷰 정보 (reviewCount, reviewAvgRating)
 */

'use strict';

// ---------------------------------------------------------------------------
// Phase 1 — 기본 정보
// ---------------------------------------------------------------------------
/**
 * Phase 1: 기본 정보 (이미 구현된 것들 — 이 함수는 기존 로직을 래핑)
 * @param {import('playwright').Page} page - 이미 상품 URL 로드된 상태
 * @returns {Promise<{title: string, price: string, standardImage: string, itemDescriptionText: string}>}
 */
async function parseBasicInfo(page) {
  // TODO: playwrightScraper.js의 scrapePage() 로직을 여기로 추출
  // 현재는 collect 스크립트가 scrapeCoupangProductPlaywright()를 직접 호출하므로 스텁 유지
  return {};
}

// ---------------------------------------------------------------------------
// Phase 2 — 옵션 정보
// ---------------------------------------------------------------------------
/**
 * Phase 2: 옵션 정보
 * @param {import('playwright').Page} page
 * @returns {Promise<{optionType: string, optionsRaw: object|null}>}
 *
 * optionType: 'NONE' | 'SIZE' | 'COLOR' | 'CUSTOM' | 'MULTI'
 * optionsRaw: {
 *   axes: [{
 *     type: string,
 *     values: [{ name: string, priceDelta: number, available: boolean }]
 *   }]
 * } | null
 *
 * 쿠팡 옵션 DOM 구조:
 * - 단일 옵션: .prod-option__item 내 버튼/라벨
 * - 멀티 옵션: 여러 .prod-option__selected 그룹
 * - 옵션 없음: .prod-option 영역 자체가 없음
 *
 * TODO: 실제 셀렉터는 브라우저 테스트 후 확정
 */
async function parseOptions(page) {
  // 스텁: 브라우저 테스트 시 구현
  return { optionType: 'NONE', optionsRaw: null };
}

// ---------------------------------------------------------------------------
// Phase 3 — 상세 이미지
// ---------------------------------------------------------------------------
/**
 * Phase 3: 상세 이미지 (상품설명 영역)
 * @param {import('playwright').Page} page
 * @returns {Promise<{detailImages: string[]}>}
 *
 * 수집 방법:
 * 1) 페이지 하단(상세설명 영역)까지 스크롤
 * 2) lazy-load 이미지 로드 대기
 * 3) 상세 영역 내 모든 img src 수집
 *
 * 주의: 쿠팡 상세 이미지는 lazy-load + data-src 패턴이 흔함
 *
 * TODO: 실제 셀렉터, 스크롤 로직은 브라우저 테스트 후 확정
 */
async function parseDetailImages(page) {
  // 상세 이미지 영역(Lazy load) 스크롤 후 수집
  await scrollToBottom(page);
  await page.waitForTimeout(1000);

  const detailImages = await page.evaluate(() => {
    const selectorList = [
      '.detail-image img',
      '#productDetail img',
      '.product-description img',
      '.productDetail img',
      '.detailContents img',
      '.detail-wrap img',
    ];

    const urls = new Set();
    selectorList.forEach((sel) => {
      document.querySelectorAll(sel).forEach((img) => {
        const candidate = img.src || img.dataset?.src || img.getAttribute('data-src') || '';
        if (candidate && candidate.includes('http')) {
          urls.add(candidate.startsWith('//') ? `https:${candidate}` : candidate);
        }
      });
    });

    return Array.from(urls);
  }).catch(() => []);

  return { detailImages };
}

// ---------------------------------------------------------------------------
// Phase 4 — 추가 정보 (무게, 재고, 상품 속성)
// ---------------------------------------------------------------------------
/**
 * Phase 4: 추가 정보
 * @param {import('playwright').Page} page
 * @returns {Promise<{weightKg: number, stockStatus: string, stockQty: number|null, productAttributes: object}>}
 *
 * weightKg: number (기본값 1)
 * stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'
 * stockQty: number | null
 * productAttributes: { [key: string]: string }
 *
 * 재고 판단:
 * - "품절" 텍스트 → OUT_OF_STOCK
 * - "n개 남음" → LOW_STOCK, qty = n
 * - 그 외 → IN_STOCK, qty = null
 *
 * 무게:
 * - 상품 속성 테이블에서 "무게", "중량" 키워드 검색
 * - 있으면 parseWeightToKg() 변환 (scraper.js의 함수 재사용 예정)
 * - 없으면 기본값 1
 *
 * TODO: 셀렉터 확정 후 구현
 */
async function parseProductInfo(page) {
  // 스텁
  return {
    weightKg: 1,
    stockStatus: 'IN_STOCK',
    stockQty: null,
    productAttributes: {},
  };
}

// ---------------------------------------------------------------------------
// Phase 5 — 리뷰 정보
// ---------------------------------------------------------------------------
/**
 * Phase 5: 리뷰 정보
 * @param {import('playwright').Page} page
 * @returns {Promise<{reviewCount: number, reviewAvgRating: number}>}
 *
 * 수집 방법:
 * - 상품 페이지 상단의 별점/리뷰 건수 영역 파싱
 * - 또는 리뷰 탭 클릭 후 요약 정보 수집
 * - 리뷰가 0건이면 reviewCount=0, reviewAvgRating=0
 *
 * TODO: 셀렉터 확정 후 구현
 */
async function parseReviews(page) {
  // 스텁
  return { reviewCount: 0, reviewAvgRating: 0 };
}

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------
/**
 * 페이지 하단까지 점진적 스크롤 (lazy-load 이미지 트리거용)
 * @param {import('playwright').Page} page
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
 * @param {string[]} phases - 실행할 Phase 목록 (기본: ['1','2','3','4','5'])
 * @returns {Promise<object>} 모든 Phase 결과 합친 객체 + collectedPhases
 */
async function collectAllPhases(page, phases = ['1', '2', '3', '4', '5']) {
  const result = {};

  if (phases.includes('1')) {
    Object.assign(result, await parseBasicInfo(page));
  }
  if (phases.includes('2')) {
    Object.assign(result, await parseOptions(page));
  }
  if (phases.includes('3')) {
    // 스크롤 다운 후 lazy-load 대기
    await scrollToBottom(page);
    await page.waitForTimeout(2000);
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
