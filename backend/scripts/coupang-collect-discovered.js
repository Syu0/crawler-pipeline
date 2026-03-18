#!/usr/bin/env node
/**
 * coupang-collect-discovered.js — DISCOVERED → COLLECTED 상세 수집
 *
 * coupang_datas 시트에서 status=DISCOVERED 인 행을 읽어
 * Playwright 상세 수집기로 상세 정보를 수집한 후 status=COLLECTED 로 업데이트.
 *
 * 흐름:
 *   1. getDiscoveredProducts() → DISCOVERED 행 목록
 *   2. 없으면 종료
 *   3. browserManager.launch() → 기존 브라우저 재사용 or 신규 기동
 *   4. browserManager.getContext() → 쿠키 주입된 컨텍스트 생성
 *   5. 행별 루프:
 *      a. Phase 1: scrapeCoupangProductPlaywright(productUrl, context)
 *      b. Phase 2-5: detailPageParser.collectAllPhases(page, extraPhases)
 *      c. 성공: status=COLLECTED + 수집 필드 write
 *      d. 실패: status=ERROR + errorMessage write, 다음 행 계속
 *      e. CONTEXT_REFRESH_INTERVAL개마다 Context 재생성
 *      f. 행 간 딜레이 COLLECT_DELAY_MIN_MS~COLLECT_DELAY_MAX_MS
 *   6. 완료 요약
 *
 * CLI 옵션:
 *   --dry-run         시트 write 없이 수집 결과만 콘솔 출력
 *   --limit N         최대 N개만 처리 (기본값: 전체)
 *   --shutdown        완료 후 브라우저 종료 (기본: 브라우저 유지)
 *   --phases "1,2,3"  실행할 Phase 목록 (기본값: "1,2,3,4,5")
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
  upsertCoupangCategory,
} = require('../coupang/sheetsClient');
const { COUPANG_DATA_HEADERS } = require('../coupang/sheetSchema');
const { scrapeCoupangProductPlaywright } = require('../coupang/playwrightScraper');
const { assertBrowserRunning } = require('./browserGuard');
const { collectAllPhases } = require('../coupang/detailPageParser');
const browserManager = require('../coupang/browserManager');
const { wait, classifyError, withSoftBlockRetry, sendBlockAlertEmail } = require('../coupang/blockDetector');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB = 'coupang_datas';
const HEADERS = COUPANG_DATA_HEADERS;
const PRESERVE_ON_ERROR = [
  'coupang_product_id', 'categoryId', 'ProductURL', 'ItemTitle',
  'ItemPrice', 'StandardImage', 'ExtraImages', 'WeightKg',
  'Options', 'ItemDescriptionText',
];

// 상품 간 딜레이 (ms)
// TODO: config 시트의 COLLECT_DELAY_MIN_MS / COLLECT_DELAY_MAX_MS 키로 런타임 로드
const COLLECT_DELAY_MIN_MS = 3000;
const COLLECT_DELAY_MAX_MS = 8000;

// N개 상품마다 BrowserContext 재생성 (메모리 관리)
// TODO: config 시트의 CONTEXT_REFRESH_INTERVAL 키로 런타임 로드
const CONTEXT_REFRESH_INTERVAL = 10;

// ── CLI 파싱 ─────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    dryRun: false,
    limit: null,
    shutdown: false,
    phases: ['1', '2', '3', '4', '5'],
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      result.dryRun = true;
    } else if (args[i] === '--shutdown') {
      result.shutdown = true;
    } else if (args[i] === '--limit' && args[i + 1]) {
      result.limit = parseInt(args[++i], 10);
    } else if (args[i].startsWith('--limit=')) {
      result.limit = parseInt(args[i].substring(8), 10);
    } else if (args[i] === '--phases' && args[i + 1]) {
      result.phases = args[++i].split(',').map((p) => p.trim()).filter(Boolean);
    } else if (args[i].startsWith('--phases=')) {
      result.phases = args[i].substring(9).split(',').map((p) => p.trim()).filter(Boolean);
    }
  }
  return result;
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  await assertBrowserRunning();
  const { dryRun, limit, shutdown, phases } = parseArgs();

  // Phase 1은 playwrightScraper가 담당; Phase 2-5는 detailPageParser가 담당
  const extraPhases = phases.filter((p) => p !== '1');

  console.log('='.repeat(50));
  console.log('Coupang Collect Discovered');
  console.log('='.repeat(50));
  console.log(`Mode:    ${dryRun ? 'DRY-RUN (no sheet write)' : 'REAL'}`);
  console.log(`Phases:  ${phases.join(',')}${extraPhases.length ? ` (Phase 1: playwrightScraper, Phase ${extraPhases.join(',')}: detailPageParser)` : ''}`);
  if (limit) console.log(`Limit:   ${limit}개`);
  if (shutdown) console.log('Shutdown: 완료 후 브라우저 종료');
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

  if (limit && limit > 0) {
    products = products.slice(0, limit);
  }
  console.log(`  대상: ${products.length}개\n`);

  // 2. 브라우저 획득 (기존 재사용 or 신규 기동)
  console.log('[2/2] 브라우저 초기화...');
  const browser = await browserManager.launch();
  let context = await browserManager.getContext(browser);
  let contextUseCount = 0;

  // 헤더 보장
  if (!dryRun) {
    await ensureHeaders(SPREADSHEET_ID, TAB, HEADERS);
  }

  // 3. 행별 수집 루프
  const stats = { success: 0, rowError: 0, softBlock: 0, hardBlock: 0, total: products.length };
  let lastUrl = null;

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
      console.log(`[${i + 1}/${products.length}] ${product.vendorItemId || product.itemId}`);
      console.log(`  URL: ${product.productUrl}`);
      lastUrl = product.productUrl;

      try {
        // ── withSoftBlockRetry로 Phase 1 + 2-5 스크래핑 감쌈 ────────────────
        const res = await withSoftBlockRetry(async () => {
          const scraped = await scrapeCoupangProductPlaywright(product.productUrl, context);

          let phaseData = {};
          if (extraPhases.length > 0) {
            const page = await context.newPage();
            try {
              await page.goto(product.productUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 45000,
              });
              phaseData = await collectAllPhases(page, extraPhases);
            } finally {
              await page.close();
            }
          }

          return { scraped, phaseData };
        }, { maxRetries: 3, waitMs: 30_000 });

        contextUseCount++;

        if (res.escalated) {
          // SOFT_BLOCK 재시도 소진 → 세션 전체 중단
          console.error('  ✗ SOFT_BLOCK_ESCALATED: 429 재시도 3회 소진 — 루프 중단');
          stats.hardBlock++;
          if (!dryRun) {
            try {
              await upsertRow(
                SPREADSHEET_ID, TAB, HEADERS,
                {
                  vendorItemId: product.vendorItemId,
                  itemId:       product.itemId,
                  updatedAt:    new Date().toISOString(),
                  status:       'ERROR',
                  errorMessage: 'SOFT_BLOCK_ESCALATED: 429 재시도 3회 소진',
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

        const { scraped, phaseData } = res.result;

        if (dryRun) {
          console.log('  [DRY-RUN] 수집 결과:');
          console.log(`    ItemTitle:      ${scraped.ItemTitle?.substring(0, 50)}`);
          console.log(`    ItemPrice:      ${scraped.ItemPrice}`);
          console.log(`    StandardImage:  ${scraped.StandardImage ? 'OK' : '없음'}`);
          console.log(`    categoryId:     ${scraped.categoryId || '❌ 없음'}`);
          console.log(`    breadcrumbPath: ${(scraped.breadcrumbTexts || []).join(' > ') || '없음'}`);
          console.log(`    CollectedPhases: ${phases.join(',')}`);
          stats.success++;
          continue;
        }

        const data = {
          vendorItemId:        product.vendorItemId,
          itemId:              product.itemId,
          coupang_product_id:  scraped.coupang_product_id || '',
          categoryId:          scraped.categoryId || '',
          ProductURL:          scraped.ProductURL || product.productUrl,
          ItemTitle:           scraped.ItemTitle || '',
          ItemPrice:           scraped.ItemPrice != null ? String(scraped.ItemPrice) : '',
          StandardImage:       scraped.StandardImage || '',
          ExtraImages:         Array.isArray(scraped.ExtraImages)
                                 ? scraped.ExtraImages.join('|')
                                 : (scraped.ExtraImages || ''),
          WeightKg:            scraped.WeightKg || '',
          Options:             scraped.Options || '',
          ItemDescriptionText: scraped.ItemDescriptionText || '',
          // Phase 2-5 필드 (스텁 상태: 빈 값 또는 기본값)
          DetailImages:        JSON.stringify(phaseData.detailImages || []),
          OptionType:          phaseData.optionType || '',
          OptionsRaw:          phaseData.optionsRaw != null
                                 ? JSON.stringify(phaseData.optionsRaw)
                                 : '',
          StockStatus:         phaseData.stockStatus || '',
          StockQty:            phaseData.stockQty != null ? String(phaseData.stockQty) : '',
          ReviewCount:         phaseData.reviewCount != null ? String(phaseData.reviewCount) : '',
          ReviewAvgRating:     phaseData.reviewAvgRating != null
                                 ? String(phaseData.reviewAvgRating)
                                 : '',
          ProductAttributes:   phaseData.productAttributes
                                 ? JSON.stringify(phaseData.productAttributes)
                                 : '',
          CollectedPhases:     phases.join(','),
          updatedAt:           new Date().toISOString(),
          status:              'COLLECTED',
          errorMessage:        '',
        };

        await upsertRow(SPREADSHEET_ID, TAB, HEADERS, data, 'vendorItemId', 'itemId');
        console.log(`  ✓ COLLECTED (phases: ${phases.join(',')})`);

        if (scraped.categoryId && scraped.breadcrumbTexts?.length) {
          try {
            await upsertCoupangCategory(sheets, SPREADSHEET_ID, {
              categoryId: scraped.categoryId,
              breadcrumbTexts: scraped.breadcrumbTexts,
            });
            console.log(`  ✓ coupang_categorys upserted (categoryId=${scraped.categoryId})`);
          } catch (catErr) {
            console.warn(`  [warn] coupang_categorys upsert 실패: ${catErr.message}`);
          }
        }

        stats.success++;

      } catch (err) {
        contextUseCount++;
        const tier = classifyError(err);

        if (tier === 'HARD_BLOCK') {
          console.warn(`  ⚠ HARD_BLOCK: ${err.message.split('\n')[0]}`);
          stats.hardBlock++;
          if (!dryRun) {
            try {
              await upsertRow(
                SPREADSHEET_ID, TAB, HEADERS,
                {
                  vendorItemId: product.vendorItemId,
                  itemId:       product.itemId,
                  updatedAt:    new Date().toISOString(),
                  status:       'ERROR',
                  errorMessage: ('HARD_BLOCK: ' + err.message).substring(0, 500),
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

        // ROW_ERROR — 해당 row만 skip, 루프 계속
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

      // 마지막 항목이 아니면 딜레이
      if (i < products.length - 1) {
        const delay = Math.floor(
          Math.random() * (COLLECT_DELAY_MAX_MS - COLLECT_DELAY_MIN_MS) + COLLECT_DELAY_MIN_MS
        );
        console.log(`  [딜레이] ${delay}ms 대기...`);
        await wait(delay);
      }
    }
  } finally {
    await context.close();
    if (shutdown) {
      console.log('[Browser] --shutdown: 브라우저 종료');
      await browserManager.close(browser);
    }
  }

  // 4. 완료 요약
  console.log(`\n${'='.repeat(50)}`);
  console.log(
    `[collect] Done — success:${stats.success} rowError:${stats.rowError} ` +
    `softBlock:${stats.softBlock} hardBlock:${stats.hardBlock} total:${stats.total}`
  );
  console.log('='.repeat(50));
  console.log(`  대상:       ${stats.total}개`);
  console.log(`  성공:       ${stats.success}개`);
  console.log(`  ROW_ERROR:  ${stats.rowError}개`);
  console.log(`  HARD_BLOCK: ${stats.hardBlock}개`);
  if (dryRun) console.log('  (DRY-RUN — 시트 write 없음)');
  if (!shutdown) console.log('  브라우저: 유지 중 (npm run coupang:browser:stop 으로 종료)');

  // 이메일 알림 조건: HARD_BLOCK 발생 또는 ROW_ERROR 50% 초과
  const shouldAlert =
    stats.hardBlock > 0 ||
    (stats.total > 0 && stats.rowError / stats.total > 0.5);

  if (shouldAlert) {
    const triggerReason = stats.hardBlock > 0 ? 'HARD_BLOCK' : 'ROW_ERROR_RATE';
    console.warn(`[collect] 알림 조건 충족 (${triggerReason}) — 이메일 발송`);
    await sendBlockAlertEmail({ ...stats, lastUrl, triggerReason });
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\n✗ Error:', err.message);
  process.exit(1);
});
