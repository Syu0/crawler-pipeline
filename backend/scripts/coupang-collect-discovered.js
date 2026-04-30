#!/usr/bin/env node
/**
 * coupang-collect-discovered.js — DISCOVERED → COLLECTED 상세 수집 (HTTP API 기반)
 *
 * coupang_datas 시트에서 status=DISCOVERED 인 행을 읽어
 * Coupang 내부 HTTP API 4개로 상세 정보를 수집한 후 status=COLLECTED 로 업데이트.
 *
 * Playwright / browserManager / browserGuard 불사용.
 *
 * 흐름:
 *   1. getDiscoveredProducts() → DISCOVERED 행 목록
 *   2. 없으면 종료
 *   3. 행별 루프:
 *      a. coupangApiClient.collectProductData() 병렬 호출
 *      b. blocked: true → HARD_BLOCK 처리 + 이메일 알림 + 즉시 종료
 *      c. 성공: status=COLLECTED + 수집 필드 write
 *      d. 실패: status=ERROR + errorMessage write, 다음 행 계속
 *   4. 완료 요약
 *
 * CLI 옵션:
 *   --dry-run    시트 write 없이 수집 결과만 콘솔 출력 (딜레이 500ms)
 *   --limit N    최대 N개만 처리 (기본값: 전체)
 */

'use strict';

require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
});

const {
  getSheetsClient,
  getDiscoveredProducts,
  ensureHeaders,
  upsertRow,
  getConfig,
  upsertCoupangCategory,
} = require('../coupang/sheetsClient');
const { COUPANG_DATA_HEADERS } = require('../coupang/sheetSchema');
const { collectProductData, collectPriceStockReview } = require('../coupang/coupangApiClient');
const { randomDelay } = require('./delay');
const { sendBlockAlertEmail } = require('../coupang/blockDetector');
const { setHardBlocked } = require('../coupang/blockStateManager');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

// ProductURL에서 productId 추출: /vp/products/{productId}
function extractProductId(productUrl) {
  if (!productUrl) return null;
  const m = productUrl.match(/\/vp\/products\/(\d+)/);
  return m ? m[1] : null;
}

// ProductURL에서 vendorItemId, itemId 추출 (시트 컬럼 값이 없을 경우 fallback)
function extractParamsFromUrl(productUrl) {
  if (!productUrl) return {};
  const u = new URL(productUrl);
  return {
    vendorItemId: u.searchParams.get('vendorItemId') || null,
    itemId: u.searchParams.get('itemId') || null,
  };
}
const TAB = 'coupang_datas';
const HEADERS = COUPANG_DATA_HEADERS;
const PRESERVE_ON_ERROR = [
  'coupang_product_id', 'categoryId', 'ProductURL', 'ItemTitle',
  'ItemPrice', 'StandardImage', 'ExtraImages', 'WeightKg',
  'Options', 'ItemDescriptionText',
];

// 상품 간 딜레이 (HTTP fetch → 사람처럼 느리게)
const COLLECT_DELAY_MIN_MS = 30_000;
const COLLECT_DELAY_MAX_MS = 120_000;

// ── 일일 한도 헬퍼 ───────────────────────────────────────────────────────────

/** 현재 KST 날짜를 "YYYY-MM-DD" 형식으로 반환 */
function getTodayKST() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/**
 * 오늘(KST) 수집된 COLLECTED 행 수를 반환한다.
 * updatedAt 컬럼이 오늘 날짜("YYYY-MM-DD")로 시작하는 COLLECTED 행만 카운트.
 */
async function countTodayCollected(sheets) {
  const today = getTodayKST();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!A:ZZ`,
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return 0;

  const hdrs       = rows[0];
  const statusIdx  = hdrs.indexOf('status');
  const updatedIdx = hdrs.indexOf('updatedAt');

  let count = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const status    = row[statusIdx]  || '';
    const updatedAt = row[updatedIdx] || '';
    if (status === 'COLLECTED' && updatedAt.startsWith(today)) count++;
  }
  return count;
}

// ── CLI 파싱 ─────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { dryRun: false, limit: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      result.dryRun = true;
    } else if (args[i] === '--limit' && args[i + 1]) {
      result.limit = parseInt(args[++i], 10);
    } else if (args[i].startsWith('--limit=')) {
      result.limit = parseInt(args[i].substring(8), 10);
    }
  }
  return result;
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  const { dryRun, limit } = parseArgs();

  console.log('='.repeat(50));
  console.log('Coupang Collect Discovered (HTTP API)');
  console.log('='.repeat(50));
  console.log(`Mode: ${dryRun ? 'DRY-RUN (no sheet write)' : 'REAL'}`);
  if (limit) console.log(`Limit: ${limit}개`);
  console.log('');

  if (!SPREADSHEET_ID) {
    console.error('Error: GOOGLE_SHEET_ID not set in backend/.env');
    process.exit(1);
  }

  // 1. DISCOVERED 행 목록 조회
  console.log('[1/2] DISCOVERED 행 조회...');
  const sheets = await getSheetsClient();
  let products = await getDiscoveredProducts(sheets, SPREADSHEET_ID);

  if (products.length === 0) {
    console.log('수집 대상 없음 (DISCOVERED 행이 없습니다).');
    return;
  }

  const config = await getConfig(sheets, SPREADSHEET_ID);
  const maxPerSession = parseInt(config.MAX_COLLECT_PER_SESSION ?? '30', 10) || 30;
  const maxPerDay     = parseInt(config.MAX_COLLECT_PER_DAY    ?? '10', 10) || 10;

  // ── 일일 한도 체크 ──────────────────────────────────────────────────────────
  const todayCollected = await countTodayCollected(sheets);
  console.log(`  오늘 수집 현황: ${todayCollected}/${maxPerDay} (MAX_COLLECT_PER_DAY)`);

  if (todayCollected >= maxPerDay) {
    console.log(
      `[collect] 오늘 일일 한도 도달 (${todayCollected}/${maxPerDay}). 내일 다시 실행하세요.`
    );
    return;
  }

  const remainingToday = maxPerDay - todayCollected;

  // --limit 과 오늘 잔여량 중 작은 값으로 최종 한도 결정
  let effectiveLimit = remainingToday;
  if (limit && limit > 0) {
    if (limit > maxPerDay) {
      console.log(
        `[collect] --limit이 일일 한도(${maxPerDay})를 초과하여 ${maxPerDay}로 제한됩니다.`
      );
    }
    effectiveLimit = Math.min(limit, remainingToday);
  }

  products = products.slice(0, effectiveLimit);
  console.log(`  대상: ${products.length}개 (오늘 잔여: ${remainingToday}개)\n`);

  // 헤더 보장
  if (!dryRun) {
    await ensureHeaders(SPREADSHEET_ID, TAB, HEADERS);
  }

  // 2. 행별 수집 루프
  const stats = { success: 0, rowError: 0, hardBlock: 0, total: products.length };
  let lastUrl = null;
  let sessionCount = 0;

  // 세션 내 수집 완료된 product_id 추적 (dedup용) — data 객체도 함께 보관
  const collectedProductIds = new Set();
  // 세션 내 수집 완료된 data 추적 (dedup 분기 필드 복사용)
  const collectedDataByProductId = new Map();

  for (let i = 0; i < products.length; i++) {
    const product = products[i];

    const pid = extractProductId(product.productUrl);
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`[${i + 1}/${products.length}] vendorItemId=${product.vendorItemId} itemId=${product.itemId}`);
    console.log(`  productId: ${pid || '(URL에서 추출 실패)'}`);
    lastUrl = product.productUrl;

    // ── product_id 기준 dedup ───────────────────────────────────────────────
    if (pid && collectedProductIds.has(pid)) {
      console.log(`  ⏭ DEDUP — 동일 product_id (${pid}), vendorItemId=${product.vendorItemId}`);
      console.log('     → 이미지만 복사, 가격/재고/리뷰는 개별 API 호출');

      // ExtraImages/DetailImages만 첫 번째 상품에서 복사.
      // StandardImage는 변형마다 다를 수 있으므로 복사하지 않음 (B-02 수정)
      const sourceData = collectedDataByProductId.get(pid) || {};
      const imageCopyFields = ['ExtraImages', 'DetailImages', 'ProductAttributes'];
      const copied = {};
      for (const f of imageCopyFields) {
        if (sourceData[f] != null && sourceData[f] !== '') copied[f] = sourceData[f];
      }

      try {
        let { vendorItemId, itemId } = product;
        if (!vendorItemId || !itemId) {
          const fromUrl = extractParamsFromUrl(product.productUrl);
          vendorItemId = vendorItemId || fromUrl.vendorItemId;
          itemId = itemId || fromUrl.itemId;
        }

        const fetched = await collectPriceStockReview(pid, vendorItemId);

        if (fetched.blocked) {
          console.warn(`  ⚠ HARD_BLOCK (dedup): HTTP ${fetched.httpStatus} — 수집 루프 중단`);
          stats.hardBlock++;
          if (!dryRun) {
            setHardBlocked();
            try {
              await upsertRow(
                SPREADSHEET_ID, TAB, HEADERS,
                {
                  vendorItemId: product.vendorItemId,
                  itemId:       product.itemId,
                  updatedAt:    new Date().toISOString(),
                  status:       'ERROR',
                  errorMessage: `HARD_BLOCK: HTTP ${fetched.httpStatus}`,
                },
                'vendorItemId', 'itemId',
                PRESERVE_ON_ERROR
              );
            } catch (writeErr) {
              console.error(`  ✗ 시트 ERROR 기록 실패: ${writeErr.message}`);
            }
          }
          break;
        }

        // Browser Relay timeout / NAVIGATE_ERROR 등 인프라 오류 분류
        // (collectPriceStockReview는 navigate 실패 시 { error, message }로 즉시 return — B-01 ItemTitle 가드 도달 못함)
        if (fetched.error) {
          throw new Error(`BROWSER_RELAY_${fetched.error}: ${fetched.message || ''}`);
        }
        if (!fetched.ItemTitle || !fetched.ItemTitle.trim()) {
          throw new Error(`COLLECT_INCOMPLETE: ItemTitle 없음 (Phases='${fetched.CollectedPhases || ''}')`);
        }

        console.log(`  CollectedPhases: [${fetched.CollectedPhases || '없음'}]`);
        console.log(`  ItemTitle:      ${fetched.ItemTitle?.substring(0, 50) ?? '(없음)'}`);
        console.log(`  ItemPrice:      ${fetched.ItemPrice ?? '(없음)'}`);
        console.log(`  StockStatus:    ${fetched.StockStatus ?? '(없음)'}`);

        if (!dryRun) {
          await upsertRow(
            SPREADSHEET_ID, TAB, HEADERS,
            {
              vendorItemId:        product.vendorItemId,
              itemId:              product.itemId,
              updatedAt:           new Date().toISOString(),
              status:              'COLLECTED',
              CollectedPhases:     fetched.CollectedPhases,
              registrationMessage: `[dedup: same product_id=${pid}]`,
              errorMessage:        '',
              ItemTitle:           fetched.ItemTitle           ?? '',
              ItemPrice:           fetched.ItemPrice    != null ? String(fetched.ItemPrice)    : '',
              StockStatus:         fetched.StockStatus          ?? '',
              StockQty:            fetched.StockQty     != null ? String(fetched.StockQty)     : '',
              ReviewCount:         fetched.ReviewCount  != null ? String(fetched.ReviewCount)  : '',
              ReviewAvgRating:     fetched.ReviewAvgRating != null
                                     ? String(fetched.ReviewAvgRating)
                                     : '',
              ...copied,
            },
            'vendorItemId', 'itemId',
            PRESERVE_ON_ERROR
          );
          console.log(`  ✓ COLLECTED [dedup] (APIs: ${fetched.CollectedPhases})`);
        } else {
          console.log('  [DRY-RUN] 시트 write 생략');
        }

        stats.success++;
      } catch (err) {
        console.error(`  ✗ DEDUP_ROW_ERROR: ${err.message.split('\n')[0]}`);
        stats.rowError++;
        if (!dryRun) {
          try {
            await upsertRow(
              SPREADSHEET_ID, TAB, HEADERS,
              {
                vendorItemId: product.vendorItemId,
                itemId:       product.itemId,
                updatedAt:    new Date().toISOString(),
                status:       'ERROR',
                errorMessage: ('DEDUP_ROW_ERROR: ' + err.message).substring(0, 500),
              },
              'vendorItemId', 'itemId',
              PRESERVE_ON_ERROR
            );
          } catch (writeErr) {
            console.error(`  ✗ 시트 ERROR 기록 실패: ${writeErr.message}`);
          }
        }
      }

      // dedup 행도 API 호출 후 딜레이 적용
      if (i < products.length - 1) {
        const minMs = dryRun ? 500 : COLLECT_DELAY_MIN_MS;
        const maxMs = dryRun ? 500 : COLLECT_DELAY_MAX_MS;
        await randomDelay(minMs, maxMs);
      }
      continue;
    }

    try {
      // productId는 ProductURL에서 추출
      const productId = extractProductId(product.productUrl);

      // vendorItemId / itemId: 시트 컬럼 우선, 없으면 URL 파라미터 fallback
      let { vendorItemId, itemId } = product;
      if (!vendorItemId || !itemId) {
        const fromUrl = extractParamsFromUrl(product.productUrl);
        vendorItemId = vendorItemId || fromUrl.vendorItemId;
        itemId = itemId || fromUrl.itemId;
      }

      if (!productId || !vendorItemId || !itemId) {
        throw new Error(`필수 ID 누락 — productId=${productId} vendorItemId=${vendorItemId} itemId=${itemId}`);
      }

      const collected = await collectProductData(productId, vendorItemId, itemId);

      // ── HARD_BLOCK 감지 ───────────────────────────────────────────────────
      if (collected.blocked) {
        console.warn(`  ⚠ HARD_BLOCK: HTTP ${collected.httpStatus} — 수집 루프 중단`);
        stats.hardBlock++;
        if (!dryRun) setHardBlocked(); // dry-run은 블록 상태 기록 안 함

        if (!dryRun) {
          try {
            await upsertRow(
              SPREADSHEET_ID, TAB, HEADERS,
              {
                vendorItemId: product.vendorItemId,
                itemId:       product.itemId,
                updatedAt:    new Date().toISOString(),
                status:       'ERROR',
                errorMessage: `HARD_BLOCK: HTTP ${collected.httpStatus}`,
              },
              'vendorItemId', 'itemId',
              PRESERVE_ON_ERROR
            );
          } catch (writeErr) {
            console.error(`  ✗ 시트 ERROR 기록 실패: ${writeErr.message}`);
          }
        }
        break; // 세션 전체 중단
      }

      // Browser Relay timeout / NAVIGATE_ERROR 등 인프라 오류 분류
      // (collectProductData는 navigate 실패 시 { error, message }로 즉시 return — B-01 ItemTitle 가드 도달 못함)
      if (collected.error) {
        throw new Error(`BROWSER_RELAY_${collected.error}: ${collected.message || ''}`);
      }
      if (!collected.ItemTitle || !collected.ItemTitle.trim()) {
        throw new Error(`COLLECT_INCOMPLETE: ItemTitle 없음 (Phases='${collected.CollectedPhases || ''}')`);
      }

      const successApis = collected.CollectedPhases || '';
      console.log(`  CollectedPhases: [${successApis || '없음'}]`);
      console.log(`  ItemTitle:      ${collected.ItemTitle?.substring(0, 50) ?? '(없음)'}`);
      console.log(`  ItemPrice:      ${collected.ItemPrice ?? '(없음)'}`);
      console.log(`  StandardImage:  ${collected.StandardImage ? 'OK' : '없음'}`);
      console.log(`  StockStatus:    ${collected.StockStatus ?? '(없음)'}`);
      console.log(`  ReviewCount:    ${collected.ReviewCount ?? '(없음)'}`);
      console.log(`  DetailImages:   ${(() => { try { return JSON.parse(collected.DetailImages || '[]').length; } catch (e) { return 0; } })()}개`);

      if (dryRun) {
        console.log('  [DRY-RUN] 시트 write 생략');
        stats.success++;
        if (i < products.length - 1) {
          await randomDelay(500, 500);
        }
        continue;
      }

      const ExtraImages = Array.isArray(collected.ExtraImages)
        ? JSON.stringify(collected.ExtraImages)
        : (collected.ExtraImages || '');

      const data = {
        vendorItemId:        product.vendorItemId,
        itemId:              product.itemId,
        coupang_product_id:  productId,
        categoryId:          collected.categoryId           ?? '',
        ProductURL:          product.productUrl || '',
        ItemTitle:           collected.ItemTitle           ?? '',
        ItemPrice:           collected.ItemPrice    != null ? String(collected.ItemPrice)    : '',
        StandardImage:       collected.StandardImage        ?? '',
        ExtraImages,
        WeightKg:            '1',
        OptionType:          collected.OptionType           ?? '',
        Options:             collected.Options              ?? '',
        StockStatus:         collected.StockStatus          ?? '',
        StockQty:            collected.StockQty     != null ? String(collected.StockQty)     : '',
        ReviewCount:         collected.ReviewCount  != null ? String(collected.ReviewCount)  : '',
        ReviewAvgRating:     collected.ReviewAvgRating != null
                               ? String(collected.ReviewAvgRating)
                               : '',
        WeightKg:            collected.WeightKg              || '1',
        DetailImages:        collected.DetailImages         ?? JSON.stringify([]),
        ProductAttributes:   collected.ProductAttributes    ?? JSON.stringify({}),
        CollectedPhases:     successApis,
        updatedAt:           new Date().toISOString(),
        status:              'COLLECTED',
        errorMessage:        '',
      };

      if (collected.breadcrumbTexts && collected.breadcrumbTexts.length > 0) {
        try {
          await upsertCoupangCategory(sheets, SPREADSHEET_ID, {
            categoryId: collected.categoryId,
            breadcrumbTexts: collected.breadcrumbTexts,
          });
        } catch (e) {
          console.warn(`[categorys] upsert 실패 (categoryId=${collected.categoryId}):`, e.message);
        }
      }

      await upsertRow(SPREADSHEET_ID, TAB, HEADERS, data, 'vendorItemId', 'itemId');
      console.log(`  ✓ COLLECTED (APIs: ${successApis})`);

      if (productId) {
        collectedProductIds.add(productId);
        collectedDataByProductId.set(productId, data);
      }

      stats.success++;

    } catch (err) {
      console.error(`  ✗ ROW_ERROR: ${err.message.split('\n')[0]}`);
      stats.rowError++;
      if (!dryRun) {
        try {
          await upsertRow(
            SPREADSHEET_ID, TAB, HEADERS,
            {
              vendorItemId: product.vendorItemId,
              itemId:       product.itemId,
              updatedAt:    new Date().toISOString(),
              status:       'ERROR',
              errorMessage: ('ROW_ERROR: ' + err.message).substring(0, 500),
            },
            'vendorItemId', 'itemId',
            PRESERVE_ON_ERROR
          );
        } catch (writeErr) {
          console.error(`  ✗ 시트 ERROR 기록 실패: ${writeErr.message}`);
        }
      }
    }

    sessionCount++;
    if (sessionCount >= maxPerSession) {
      console.log(`[collect] 세션 배치 한도 도달 (${maxPerSession}개). 종료.`);
      console.log('재개 명령: npm run coupang:collect');
      break;
    }

    // 마지막 항목이 아니면 딜레이
    if (i < products.length - 1) {
      const minMs = dryRun ? 500 : COLLECT_DELAY_MIN_MS;
      const maxMs = dryRun ? 500 : COLLECT_DELAY_MAX_MS;
      await randomDelay(minMs, maxMs);
    }
  }

  // 3. 완료 요약
  console.log(`\n${'='.repeat(50)}`);
  console.log(
    `[collect] Done — success:${stats.success} rowError:${stats.rowError} ` +
    `hardBlock:${stats.hardBlock} total:${stats.total}`
  );
  console.log('='.repeat(50));
  console.log(`  대상:       ${stats.total}개`);
  console.log(`  성공:       ${stats.success}개`);
  console.log(`  ROW_ERROR:  ${stats.rowError}개`);
  console.log(`  HARD_BLOCK: ${stats.hardBlock}개`);
  if (dryRun) console.log('  (DRY-RUN — 시트 write 없음)');

  // 이메일 알림: HARD_BLOCK 발생 또는 ROW_ERROR 50% 초과
  const shouldAlert =
    stats.hardBlock > 0 ||
    (stats.total > 0 && stats.rowError / stats.total > 0.5);

  if (shouldAlert) {
    const triggerReason = stats.hardBlock > 0 ? 'HARD_BLOCK' : 'ROW_ERROR_RATE';
    console.warn(`[collect] 알림 조건 충족 (${triggerReason}) — 이메일 발송`);
    await sendBlockAlertEmail({ ...stats, softBlock: 0, lastUrl, triggerReason });
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\n✗ Error:', err.message);
  process.exit(1);
});
