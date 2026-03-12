'use strict';

/**
 * productFilters.js — 검색결과 카드 필터 함수 모음
 *
 * 필터 함수 시그니처: (item, config) => boolean
 *
 * item 구조 (keywordSearch.js 파싱 결과):
 * {
 *   vendorItemId:  string,
 *   itemId:        string,
 *   productId:     string,
 *   itemTitle:     string,
 *   itemPrice:     number,       // KRW 정수
 *   isRocket:      boolean,
 *   categoryName:  string | null,
 *   categoryId:    string | null,
 *   productUrl:    string,
 *   thumbnailImage: string,
 * }
 *
 * config 구조 (getConfig()로 로드):
 * {
 *   FILTER_PRICE_KRW_MAX:         number,   // 예: 150000
 *   EXCLUDED_CATEGORY_KEYWORDS:   string[], // 예: ['의약품', '화장품', ...]
 * }
 *
 * 새 필터 추가 방법:
 *   1. 이 파일에 함수 추가
 *   2. ALL_FILTERS 배열에 추가
 *   → 다른 파일 수정 불필요
 */

/**
 * 로켓배송 상품만 통과
 */
function isRocketDelivery(item, _config) {
  return item.isRocket === true;
}

/**
 * 제외 카테고리가 아닌 상품만 통과
 * 카테고리 파싱 불가(null) 시 통과시킴 — 상세 수집 단계(COLLECTED)에서 재검사
 */
function isAllowedCategory(item, config) {
  if (!item.categoryName) return true;
  const lower = item.categoryName.toLowerCase();
  return !config.EXCLUDED_CATEGORY_KEYWORDS.some((kw) =>
    lower.includes(kw.toLowerCase())
  );
}

/**
 * 가격 상한 이하 상품만 통과 (관세 면제 기준)
 */
function isUnderPriceLimit(item, config) {
  if (!item.itemPrice || item.itemPrice <= 0) return false;
  return item.itemPrice <= config.FILTER_PRICE_KRW_MAX;
}

/**
 * 기본 필터 체인 (순서 중요: 가장 빠른 필터 먼저)
 */
const ALL_FILTERS = [isRocketDelivery, isAllowedCategory, isUnderPriceLimit];

/**
 * 필터 체인 적용
 * @param {Object[]} items  - 검색결과 카드 파싱 결과 배열
 * @param {Object}   config - getConfig() 반환값
 * @param {Function[]} [filters=ALL_FILTERS] - 사용할 필터 배열
 * @returns {Object[]} 필터 통과한 items
 */
function applyFilters(items, config, filters = ALL_FILTERS) {
  let current = items;
  for (const fn of filters) {
    const before = current.length;
    current = current.filter((item) => fn(item, config));
    const after = current.length;
    console.log(`  [필터] ${fn.name}: ${before}개 → ${after}개 통과 (${before - after}개 탈락)`);
  }
  return current;
}

module.exports = {
  applyFilters,
  ALL_FILTERS,
  isRocketDelivery,
  isAllowedCategory,
  isUnderPriceLimit,
};
