'use strict';

/**
 * keywordSearch.js — 쿠팡 키워드 검색 결과 파싱
 *
 * 상세 페이지 진입 없이 검색결과 카드 목록만 파싱.
 * Playwright context는 호출자(coupang-keyword-discover.js)가 생성해서 주입한다.
 *
 * 반환 item 구조:
 * {
 *   vendorItemId:   string | null,
 *   itemId:         string | null,
 *   productId:      string | null,
 *   itemTitle:      string,
 *   itemPrice:      number,        // KRW 정수 (파싱 실패 시 0)
 *   isRocket:       boolean,
 *   categoryName:   string | null,
 *   categoryId:     string | null,
 *   productUrl:     string,
 *   thumbnailImage: string,
 * }
 */

// 쿠팡 검색결과 셀렉터 (2026-03 DOM 확인)
// li[data-id] — 상품 카드. data-id = vendorItemId
// a[href*="/vp/products/"] — 상품 링크 (href에 itemId, vendorItemId 파라미터 포함)
// [class*="productNameV2"] — 상품명 (CSS Modules: ProductUnit_productNameV2__xxx)
// [class*="PriceArea"] — 가격 영역 (CSS Modules: PriceArea_priceArea__xxx)
// img[src*="thumbnail"] — 썸네일 이미지 (CDN URL)
// 로켓배송: 카드 textContent에 "로켓배송" 포함 여부로 판단
const SELECTORS = {
  productCard:  'li[data-id]',
  productLink:  'a[href*="/vp/products/"]',
  title:        '[class*="productNameV2"], [class*="productName"]',
  priceArea:    '[class*="PriceArea"], [class*="priceArea"]',
  thumbnail:    'img[src*="thumbnail"]',
};

const SEARCH_BASE = 'https://www.coupang.com/np/search';
const LIST_SIZE = 60; // 페이지당 상품 수 (쿠팡 최대)

/**
 * 쿠팡 검색 URL 생성
 * @param {string} keyword
 * @param {number} page  - 1-based
 */
function buildSearchUrl(keyword, page) {
  const params = new URLSearchParams({
    q: keyword,
    channel: 'user',
    listSize: String(LIST_SIZE),
    page: String(page),
  });
  return `${SEARCH_BASE}?${params.toString()}`;
}

/**
 * 상품 카드 URL에서 vendorItemId / itemId / productId 추출
 * @param {string} href
 */
function parseProductIds(href) {
  try {
    const url = new URL(href.startsWith('http') ? href : `https://www.coupang.com${href}`);
    const pathMatch = url.pathname.match(/\/vp\/products\/(\d+)/);
    return {
      productId:    pathMatch ? pathMatch[1] : null,
      itemId:       url.searchParams.get('itemId') || null,
      vendorItemId: url.searchParams.get('vendorItemId') || null,
    };
  } catch (_) {
    return { productId: null, itemId: null, vendorItemId: null };
  }
}

/**
 * 검색결과 페이지 1장을 파싱해 item 배열 반환
 * @param {import('playwright').Page} page
 * @returns {Promise<Object[]>}
 */
async function parsePage(page) {
  return page.evaluate((sels) => {
    const cards = Array.from(document.querySelectorAll(sels.productCard));

    return cards.map((card) => {
      // ── 링크 / URL ──────────────────────────────────────────────────────
      const anchor = card.querySelector(sels.productLink);
      const href = anchor ? anchor.getAttribute('href') || '' : '';

      // ── 상품명 ──────────────────────────────────────────────────────────
      const titleEl = card.querySelector(sels.title);
      const itemTitle = titleEl ? titleEl.textContent.trim() : '';

      // ── 가격 ────────────────────────────────────────────────────────────
      // del(취소선=정가)을 제외한 텍스트에서 숫자 추출 → 최솟값이 판매가
      const priceArea = card.querySelector(sels.priceArea);
      let itemPrice = 0;
      if (priceArea) {
        // del 태그 복제본 제거 후 숫자 추출
        const clone = priceArea.cloneNode(true);
        clone.querySelectorAll('del').forEach((el) => el.remove());
        const nums = (clone.textContent || '')
          .match(/[\d,]+/g)
          ?.map((n) => parseInt(n.replace(/,/g, ''), 10))
          .filter((n) => n > 100) || [];
        if (nums.length > 0) itemPrice = Math.min(...nums);
      }

      // ── 썸네일 ──────────────────────────────────────────────────────────
      const imgEl = card.querySelector(sels.thumbnail);
      const thumbnailImage = imgEl ? (imgEl.getAttribute('src') || '') : '';

      // ── 로켓배송 ────────────────────────────────────────────────────────
      // 쿠팡 검색결과 로켓배송 상품은 파란 뱃지(bg-[#CCEDFD]) + "무료반품" 텍스트.
      // "로켓배송" 문자열은 카드에 없고, "무료반품"이 로켓배송의 식별자.
      const cardText = card.textContent || '';
      const isRocket = cardText.includes('무료반품') ||
                       cardText.includes('로켓배송') ||
                       card.outerHTML.includes('CCEDFD');

      return { href, itemTitle, itemPrice, thumbnailImage, isRocket, categoryName: null };
    });
  }, SELECTORS);
}

/**
 * 키워드로 쿠팡 검색 실행 → 전체 페이지 파싱 후 item 배열 반환
 *
 * @param {string} keyword
 * @param {import('playwright').BrowserContext} browserContext
 * @param {Object} [options]
 * @param {number} [options.maxPages=2]
 * @returns {Promise<Object[]>}
 */
async function searchCoupangByKeyword(keyword, browserContext, options = {}) {
  const { maxPages = 2 } = options;
  const allItems = [];

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const url = buildSearchUrl(keyword, pageNum);
    const page = await browserContext.newPage();

    try {
      console.log(`  [검색] "${keyword}" p${pageNum} → ${url}`);

      // Akamai 우회: 새 탭에서 검색 URL로 바로 이동하면 차단됨.
      // 메인 페이지를 먼저 방문해 신뢰도를 확보한 뒤 검색 URL로 navigate.
      if (pageNum === 1) {
        await page.goto('https://www.coupang.com/', {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      }

      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });

      const status = response ? response.status() : null;
      if (status === 403 || status === 429) {
        console.warn(`  [경고] HTTP ${status} — 쿠팡 차단 감지. 검색 중단.`);
        break;
      }

      // Akamai JS 챌린지 해소 대기
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

      // 검색결과 카드 대기 (없으면 0개로 처리)
      await page
        .waitForSelector(SELECTORS.productCard, { timeout: 10000 })
        .catch(() => {});

      const rawCards = await parsePage(page);

      if (rawCards.length === 0) {
        console.log(`  [검색] "${keyword}" p${pageNum} — 결과 없음. 종료.`);
        break;
      }

      // href → productId/itemId/vendorItemId 파싱 (Node.js URL API 사용)
      const items = rawCards.map((card) => {
        const ids = parseProductIds(card.href);
        const fullUrl = card.href.startsWith('http')
          ? card.href
          : `https://www.coupang.com${card.href}`;
        return {
          vendorItemId: ids.vendorItemId,
          itemId: ids.itemId,
          productId: ids.productId,
          itemTitle: card.itemTitle,
          itemPrice: card.itemPrice,
          isRocket: card.isRocket,
          categoryName: card.categoryName,
          categoryId: null, // 검색결과에서 categoryId 파싱 불가 → null
          productUrl: fullUrl,
          thumbnailImage: card.thumbnailImage,
        };
      });

      console.log(`  [검색] "${keyword}" p${pageNum} — ${items.length}개 파싱`);
      allItems.push(...items);

    } finally {
      await page.close();
    }
  }

  return allItems;
}

module.exports = { searchCoupangByKeyword };
