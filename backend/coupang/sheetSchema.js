/**
 * coupang_datas 시트 컬럼 정의 (SSOT)
 * 순서 변경 시 이 파일만 수정. 시트도 setup-sheets.js로 재초기화.
 *
 * prefix 규칙:
 *   [C]   — Coupang 수집 데이터
 *   [Q]   — Qoo10 등록 데이터
 *   [SYS] — 파이프라인 시스템 상태
 */

'use strict';

const COUPANG_DATA_HEADERS = [
  // ── [C] Coupang 수집 ──────────────────────────────
  'vendorItemId',        // PK
  'itemId',
  'coupang_product_id',
  'categoryId',
  'ProductURL',
  'ItemTitle',
  'ItemPrice',
  'StandardImage',
  'ExtraImages',
  'WeightKg',
  'Options',
  'ItemDescriptionText',
  'DetailImages',
  'OptionType',
  'OptionsRaw',
  'StockStatus',
  'StockQty',
  'ReviewCount',
  'ReviewAvgRating',
  'ReviewSummary',
  'ProductAttributes',
  'CollectedPhases',

  // ── [Q] Qoo10 등록 ──────────────────────────────
  'qoo10SellingPrice',
  'qoo10ItemId',
  'qoo10SellerCode',
  'jpCategoryIdUsed',
  'categoryMatchType',
  'categoryMatchConfidence',
  'coupangCategoryKeyUsed',
  'registrationMode',
  'registrationStatus',
  'registrationMessage',
  'lastRegisteredAt',
  'needsUpdate',
  // changeFlags 허용값:
  //   PRICE_UP         - 가격 인상 감지
  //   PRICE_DOWN       - 가격 인하 감지
  //   TITLE_CHANGED    - 타이틀 변경 (UpdateGoods 트리거)
  //   DESC_CHANGED     - 상세페이지 변경 (EditGoodsContents 트리거)
  //   CATEGORY_CHANGED - 카테고리 변경 (UpdateGoods 필요, 현재 수동 처리)
  // 복수 플래그: 파이프 구분 (예: "PRICE_UP|TITLE_CHANGED")
  // 처리 완료 후 빈 문자열로 초기화
  'changeFlags',

  // ── [SYS] 시스템 ──────────────────────────────
  'status',
  'updatedAt',
  'errorMessage',
];

// 그룹별 컬럼 범위 (배경색 적용용)
const HEADER_GROUPS = [
  { label: '[C] Coupang', start: 0,  end: 21, color: { red: 0.68, green: 0.85, blue: 0.90 } }, // 하늘색
  { label: '[Q] Qoo10',   start: 22, end: 34, color: { red: 0.85, green: 0.74, blue: 0.90 } }, // 연보라
  { label: '[SYS]',       start: 35, end: 37, color: { red: 0.98, green: 0.90, blue: 0.68 } }, // 연노랑
];

const QOO10_INVENTORY_SCHEMA = {
  sheetName: 'qoo10_inventory',
  primaryKey: 'qoo10ItemId',
  columns: [
    // ── [Q] Qoo10 원본 데이터 ─────────────────────────────────
    { key: 'qoo10ItemId',         header: '[Q] ItemCode',         group: 'Q',   width: 14 },
    { key: 'sellerCode',          header: '[Q] SellerCode',       group: 'Q',   width: 22 },
    { key: 'itemName',            header: '[Q] 상품명',            group: 'Q',   width: 55 },
    { key: 'categoryNumber',      header: '[Q] 카테고리코드',      group: 'Q',   width: 14 },
    { key: 'priceJpy',            header: '[Q] 가격(¥)',           group: 'Q',   width: 10 },
    { key: 'quantity',            header: '[Q] 재고수량',          group: 'Q',   width: 10 },
    { key: 'itemStatus',          header: '[Q] 판매상태Y/N/D',     group: 'Q',   width: 12 },
    { key: 'startDate',           header: '[Q] 판매시작일',        group: 'Q',   width: 14 },
    { key: 'endDate',             header: '[Q] 판매종료일',        group: 'Q',   width: 12 },
    // ── [C] 쿠팡 연결 정보 ────────────────────────────────────
    { key: 'coupangVendorItemId', header: '[C] VendorItemId',     group: 'C',   width: 20 },
    { key: 'coupangProductUrl',   header: '[C] 쿠팡URL',           group: 'C',   width: 35 },
    { key: 'coupangStatus',       header: '[C] 쿠팡재고상태',      group: 'C',   width: 14 },
    // ── [SYS] 관리 필드 ──────────────────────────────────────
    { key: 'registrationSource',  header: '[SYS] 등록방식',        group: 'SYS', width: 12 },
    { key: 'inventoryFlag',       header: '[SYS] 재고이상플래그',  group: 'SYS', width: 18 },
    { key: 'actionRequired',      header: '[SYS] 처리필요',        group: 'SYS', width: 16 },
    { key: 'lastSyncedAt',        header: '[SYS] 마지막동기화',    group: 'SYS', width: 20 },
    { key: 'memo',                header: '[SYS] 메모',            group: 'SYS', width: 25 },
  ],
  groupColors: {
    Q:   'E6E0F8',  // 연보라
    C:   'D6EAF8',  // 하늘색
    SYS: 'FEF9E7',  // 연노랑
  }
};

module.exports = { COUPANG_DATA_HEADERS, HEADER_GROUPS, QOO10_INVENTORY_SCHEMA };
