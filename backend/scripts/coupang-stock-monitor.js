#!/usr/bin/env node
/**
 * coupang-stock-monitor.js — 재고 모니터링 + Qoo10 qty 동기화 (STEP 3)
 *
 * coupang_datas 시트에서 REGISTERED / LIVE / OUT_OF_STOCK 상품을 읽어
 * 쿠팡 상품 페이지 DOM 파싱으로 품절 여부 확인 후 상태 전이 + Qoo10 qty 동기화.
 *
 * 상태 전이:
 *   LIVE / REGISTERED → OUT_OF_STOCK  : 품절/판매불가 감지 → Qoo10 qty=0
 *   OUT_OF_STOCK      → LIVE          : 재판매 감지       → Qoo10 qty=100
 *   ANY               → ERROR         : 복구 가능한 실패 (재시도 대상)
 *   DEACTIVATED       → (변경 불가)   : 절대 자동 해제 금지
 *
 * CLI 옵션:
 *   --dry-run           시트/Qoo10 업데이트 없이 결과만 콘솔 출력
 *   --limit=N           최대 N개 상품만 처리 (기본: 전체)
 *   --status=X          특정 status 상품만 대상 (예: --status=LIVE)
 *   --test-block-wait   블록 감지 대기시간 5초로 단축 (테스트용)
 */

'use strict';

require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
});

const {
  getSheetsClient,
  getMonitoringProducts,
  upsertRow,
  ensureHeaders,
} = require('../coupang/sheetsClient');
const { COUPANG_DATA_HEADERS } = require('../coupang/sheetSchema');
const { checkStock }            = require('../coupang/stockChecker');
const browserManager            = require('../coupang/browserManager');
const {
  wait,
  sendBlockAlertEmail,
  RETRY_WAIT_MS,
  RETRY_COUNT,
} = require('../coupang/blockDetector');
const { setGoodsPriceQty } = require('./qoo10.setGoodsPriceQty');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB            = 'coupang_datas';
const HEADERS        = COUPANG_DATA_HEADERS;

const MONITOR_DELAY_MIN_MS   = 3000;
const MONITOR_DELAY_MAX_MS   = 8000;
const CONTEXT_REFRESH_INTERVAL = 10;

// ── CLI 파싱 ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args   = process.argv.slice(2);
  const result = { dryRun: false, limit: null, statusFilter: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      result.dryRun = true;
    } else if (args[i].startsWith('--limit=')) {
      result.limit = parseInt(args[i].substring(8), 10);
    } else if (args[i] === '--limit' && args[i + 1]) {
      result.limit = parseInt(args[++i], 10);
    } else if (args[i].startsWith('--status=')) {
      result.statusFilter = args[i].substring(9);
    } else if (args[i] === '--status' && args[i + 1]) {
      result.statusFilter = args[++i];
    }
    // --test-block-wait 는 blockDetector.js 가 process.argv 에서 직접 읽음
  }

  return result;
}

// ── Qoo10 qty 업데이트 ────────────────────────────────────────────────────────

async function updateQoo10Qty(qoo10ItemId, qty) {
  if (!qoo10ItemId) {
    return { success: false, errorMsg: 'qoo10ItemId 없음 - Qoo10 연결 불가' };
  }
  const result = await setGoodsPriceQty({ itemCode: qoo10ItemId, qty });
  if (result.success) {
    console.log(`    [Qoo10] qty=${qty} 업데이트 성공`);
    return { success: true };
  }
  const errorMsg = `Qoo10 qty=${qty} 실패: ${result.resultMsg || result.reason}`;
  console.warn(`    [Qoo10] qty 업데이트 실패: ${result.resultMsg || result.reason}`);
  return { success: false, errorMsg };
}

// ── 시트 상태 업데이트 ────────────────────────────────────────────────────────

async function updateSheetStatus(product, newStatus, errorMessage = '') {
  await upsertRow(
    SPREADSHEET_ID, TAB, HEADERS,
    {
      vendorItemId: product.vendorItemId,
      itemId:       product.itemId,
      status:       newStatus,
      updatedAt:    new Date().toISOString(),
      errorMessage,
    },
    'vendorItemId', 'itemId'
  );
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  const { dryRun, limit, statusFilter } = parseArgs();

  console.log('='.repeat(50));
  console.log('Coupang Stock Monitor');
  console.log('='.repeat(50));
  console.log(`Mode:   ${dryRun ? 'DRY-RUN (no sheet/Qoo10 write)' : 'REAL'}`);
  if (statusFilter) console.log(`Filter: status=${statusFilter}`);
  if (limit)        console.log(`Limit:  ${limit}개`);
  console.log('');

  if (!SPREADSHEET_ID) {
    console.error('Error: GOOGLE_SHEET_ID not set in backend/.env');
    process.exit(1);
  }

  // 1. 모니터링 대상 로드
  console.log('[1/2] 모니터링 대상 조회...');
  const sheets   = await getSheetsClient();
  let   products = await getMonitoringProducts(sheets, SPREADSHEET_ID, statusFilter);

  if (products.length === 0) {
    console.log('모니터링 대상 없음.');
    return;
  }

  if (limit && limit > 0) products = products.slice(0, limit);
  console.log(`  대상: ${products.length}개\n`);

  // 2. 브라우저 초기화
  console.log('[2/2] 브라우저 초기화...');
  const browser = await browserManager.launch();
  let context   = await browserManager.getContext(browser);
  let contextUseCount = 0;

  if (!dryRun) {
    await ensureHeaders(SPREADSHEET_ID, TAB, HEADERS);
  }

  // 3. 상품별 처리 루프
  let successCount = 0;
  let changedCount = 0;
  let errorCount   = 0;
  let blockRetries = 0;

  try {
    for (let i = 0; i < products.length; i++) {
      const product = products[i];

      // Context 재생성 (메모리 관리)
      if (contextUseCount > 0 && contextUseCount % CONTEXT_REFRESH_INTERVAL === 0) {
        console.log(`  [Context] ${CONTEXT_REFRESH_INTERVAL}개 처리 완료 — Context 재생성...`);
        await context.close();
        context = await browserManager.getContext(browser);
      }

      console.log(`\n${'─'.repeat(40)}`);
      console.log(`[${i + 1}/${products.length}] ${product.vendorItemId || product.itemId} (${product.status})`);
      console.log(`  URL: ${product.productUrl}`);

      try {
        const { available, reason } = await checkStock(product.productUrl, context);
        contextUseCount++;

        console.log(`  재고: ${available ? '판매중' : `품절 (${reason})`}`);

        // 상태 전이 결정
        let newStatus = null;
        let qoo10Qty  = null;

        if (!available && (product.status === 'LIVE' || product.status === 'REGISTERED')) {
          newStatus = 'OUT_OF_STOCK';
          qoo10Qty  = 0;
        } else if (available && product.status === 'OUT_OF_STOCK') {
          newStatus = 'LIVE';
          qoo10Qty  = 100;
        }

        if (newStatus) {
          const stockLabel = available ? 'IN_STOCK' : 'OUT_OF_STOCK';
          console.log(`  상태 전이: ${product.status} → ${newStatus}`);

          if (dryRun) {
            if (!product.qoo10ItemId) {
              console.log(`  [DRY-RUN] vendorItemId=${product.vendorItemId} | 쿠팡: ${stockLabel} | Qoo10: qoo10ItemId 없음 — 상태 전이 불가`);
            } else {
              console.log(`  [DRY-RUN] vendorItemId=${product.vendorItemId} | 쿠팡: ${stockLabel} | Qoo10: qty=${qoo10Qty} 호출 예정 (ItemCode: ${product.qoo10ItemId})`);
              console.log(`  [DRY-RUN] 시트: status ${product.status}→${newStatus} 예정`);
            }
            changedCount++;
          } else {
            const qoo10Result = await updateQoo10Qty(product.qoo10ItemId, qoo10Qty);
            if (qoo10Result.success) {
              await updateSheetStatus(product, newStatus);
              changedCount++;
            } else {
              console.warn(`  상태 전이 취소: ${qoo10Result.errorMsg}`);
              await updateSheetStatus(product, product.status, qoo10Result.errorMsg);
            }
          }
        } else {
          console.log(`  상태 유지: ${product.status}`);
        }

        successCount++;
        blockRetries = 0; // 성공 시 블록 재시도 카운터 리셋

      } catch (err) {
        contextUseCount++;

        if (err.message === 'BLOCK_DETECTED') {
          if (blockRetries < RETRY_COUNT) {
            blockRetries++;
            console.log(`  [블록감지] ${RETRY_WAIT_MS / 60000}분 대기 후 재시도 (${blockRetries}/${RETRY_COUNT})...`);
            await wait(RETRY_WAIT_MS);
            // Context 재생성 후 동일 상품 재시도
            await context.close();
            context = await browserManager.getContext(browser);
            i--; // 같은 상품 재시도
            continue;
          } else {
            console.error('  [블록감지] 재시도 소진. 이메일 알림 후 종료.');
            await sendBlockAlertEmail();
            break;
          }
        }

        // 기타 오류 → ERROR 상태
        console.error(`  ✗ 오류: ${err.message}`);
        errorCount++;

        if (!dryRun) {
          try {
            await updateSheetStatus(product, 'ERROR', err.message.substring(0, 500));
          } catch (writeErr) {
            console.error(`  ✗ 시트 ERROR 기록 실패: ${writeErr.message}`);
          }
        }
      }

      // 마지막 항목이 아니면 딜레이
      if (i < products.length - 1) {
        const delay = Math.floor(
          Math.random() * (MONITOR_DELAY_MAX_MS - MONITOR_DELAY_MIN_MS) + MONITOR_DELAY_MIN_MS
        );
        console.log(`  [딜레이] ${delay}ms 대기...`);
        await wait(delay);
      }
    }
  } finally {
    await context.close();
    await browserManager.close(browser);
  }

  // 4. 완료 요약
  console.log(`\n${'='.repeat(50)}`);
  console.log('완료 요약');
  console.log('='.repeat(50));
  console.log(`  대상:     ${products.length}개`);
  console.log(`  처리 완료: ${successCount}개`);
  console.log(`  상태변경:  ${changedCount}개`);
  console.log(`  오류:      ${errorCount}개`);
  if (dryRun) console.log('  (DRY-RUN — 시트/Qoo10 write 없음)');
}

main().catch((err) => {
  console.error('\n✗ Error:', err.message);
  process.exit(1);
});
