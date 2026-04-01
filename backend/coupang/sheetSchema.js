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
  'changeFlags',

  // ── [SYS] 시스템 ──────────────────────────────
  'status',
  'updatedAt',
  'errorMessage',
];

// 그룹별 컬럼 범위 (배경색 + 글자색 적용용)
const HEADER_GROUPS = [
  { label: '[D] Discover', start: 0,  end: 4,  bg: { red: 0.890, green: 0.949, blue: 0.992 }, fg: { red: 0, green: 0, blue: 0 } }, // #E3F2FD 아주 연한 하늘
  { label: '[C] Collect',  start: 5,  end: 20, bg: { red: 0.565, green: 0.792, blue: 0.976 }, fg: { red: 0, green: 0, blue: 0 } }, // #90CAF9 중간 하늘
  { label: '[Q] Qoo10',    start: 21, end: 31, bg: { red: 0.290, green: 0.565, blue: 0.851 }, fg: { red: 1, green: 1, blue: 1 } }, // #4A90D9 진한 파랑 (글자 흰색)
  { label: '[USER]',       start: 32, end: 33, bg: { red: 1,     green: 1,     blue: 1     }, fg: { red: 0, green: 0, blue: 0 } }, // #FFFFFF 흰색
  { label: '[SYS]',        start: 34, end: 36, bg: { red: 0.929, green: 0.906, blue: 0.965 }, fg: { red: 0, green: 0, blue: 0 } }, // #EDE7F6 연보라
];

// 허용된 status ENUM 값 (파이프라인 전체 기준)
const VALID_STATUSES = [
  'DISCOVERED',
  'COLLECTED',
  'PENDING_APPROVAL',
  'REGISTER_READY',
  'REGISTERING',
  'REGISTERED',
  'VALIDATING',
  'LIVE',
  'OUT_OF_STOCK',
  'DEACTIVATED',
  'ERROR',
];

// 코드가 자동으로 덮어쓰지 않는 상태 (락 또는 수동 전용)
const PROTECTED_STATUSES = ['REGISTERING', 'VALIDATING', 'DEACTIVATED'];

module.exports = { COUPANG_DATA_HEADERS, HEADER_GROUPS, VALID_STATUSES, PROTECTED_STATUSES };
