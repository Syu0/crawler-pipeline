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

// 그룹별 컬럼 범위 (배경색 적용용)
const HEADER_GROUPS = [
  { label: '[C] Coupang', start: 0,  end: 11, color: { red: 0.68, green: 0.85, blue: 0.90 } }, // 하늘색
  { label: '[Q] Qoo10',   start: 12, end: 24, color: { red: 0.85, green: 0.74, blue: 0.90 } }, // 연보라
  { label: '[SYS]',       start: 25, end: 27, color: { red: 0.98, green: 0.90, blue: 0.68 } }, // 연노랑
];

module.exports = { COUPANG_DATA_HEADERS, HEADER_GROUPS };
