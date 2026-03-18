#!/usr/bin/env node
/**
 * coupang-keyword-discover.js — 키워드 기반 쿠팡 상품 탐색 진입점
 *
 * 흐름:
 *   1. config 시트 로드 (가격 상한, 제외 카테고리)
 *   2. keywords 시트에서 ACTIVE 키워드 목록 로드
 *   3. browserManager.launch() → 기존 브라우저 재사용 or 신규 기동
 *   4. 키워드별:
 *      a. 검색결과 파싱 (keywordSearch.js)
 *      b. 필터 적용 (productFilters.js)
 *      c. DISCOVERED upsert (sheetsClient.js)
 *      d. keywords 시트 lastRunAt 업데이트
 *   5. 완료 요약 출력
 *
 * CLI 옵션:
 *   --dry-run          시트 write 없이 콘솔 출력만
 *   --keyword "..."    keywords 시트 무시, 단일 키워드로 실행 (테스트용)
 *   --shutdown         완료 후 브라우저 종료 (기본: 브라우저 유지)
 *
 * Usage:
 *   node backend/scripts/coupang-keyword-discover.js
 *   node backend/scripts/coupang-keyword-discover.js --dry-run
 *   node backend/scripts/coupang-keyword-discover.js --dry-run --keyword "텀블러"
 *   npm run coupang:discover:dry -- --keyword "텀블러"
 */

'use strict';

require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
});

const {
  getSheetsClient,
  getConfig,
  getActiveKeywords,
  updateKeywordLastRun,
  upsertDiscoveredProducts,
} = require('../coupang/sheetsClient');
const { searchCoupangByKeyword } = require('../coupang/keywordSearch');
const { applyFilters } = require('../coupang/productFilters');
const browserManager = require('../coupang/browserManager');
const {
  wait,
  sendBlockAlertEmail,
  RETRY_WAIT_MS,
  RETRY_COUNT,
} = require('../coupang/blockDetector');
const { assertBrowserRunning } = require('./browserGuard');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TRACE = process.env.COUPANG_TRACER === '1';

function trace(...args) {
  if (TRACE) console.log('[TRACER]', ...args);
}

// ── CLI 파싱 ─────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { dryRun: false, keyword: null, shutdown: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      result.dryRun = true;
    } else if (args[i] === '--shutdown') {
      result.shutdown = true;
    } else if (args[i] === '--keyword' && args[i + 1]) {
      result.keyword = args[++i];
    } else if (args[i].startsWith('--keyword=')) {
      result.keyword = args[i].substring(10);
    }
  }
  return result;
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  await assertBrowserRunning();
  const { dryRun, keyword: cliKeyword, shutdown } = parseArgs();

  console.log('='.repeat(50));
  console.log('Coupang Keyword Discovery');
  console.log('='.repeat(50));
  console.log(`Mode:     ${dryRun ? 'DRY-RUN (no sheet write)' : 'REAL'}`);
  if (cliKeyword) console.log(`Keyword:  "${cliKeyword}" (CLI override)`);
  if (shutdown) console.log('Shutdown: 완료 후 브라우저 종료');
  console.log('');

  if (!SPREADSHEET_ID) {
    console.error('Error: GOOGLE_SHEET_ID not set in backend/.env');
    process.exit(1);
  }

  // Sheets 클라이언트 초기화
  const sheets = await getSheetsClient();

  // 1. config 로드
  console.log('[1/2] config 시트 로드...');
  const config = await getConfig(sheets, SPREADSHEET_ID);
  console.log(`  FILTER_PRICE_KRW_MAX:       ${config.FILTER_PRICE_KRW_MAX?.toLocaleString()} KRW`);
  console.log(`  EXCLUDED_CATEGORY_KEYWORDS: ${(config.EXCLUDED_CATEGORY_KEYWORDS || []).join(', ')}\n`);

  // 2. 키워드 목록
  let keywords;
  if (cliKeyword) {
    keywords = [{ row: null, keyword: cliKeyword, status: 'ACTIVE', lastRunAt: '', memo: 'CLI' }];
  } else {
    console.log('[2/2] keywords 시트 로드...');
    keywords = await getActiveKeywords(sheets, SPREADSHEET_ID);
    console.log(`  ACTIVE 키워드 ${keywords.length}개\n`);
  }

  if (keywords.length === 0) {
    console.log('ACTIVE 키워드가 없습니다. keywords 시트를 확인하세요.');
    return;
  }

  // 3. 브라우저 획득 (기존 재사용 or 신규 기동)
  console.log('[Playwright] 브라우저 초기화...');
  const browser = await browserManager.launch();
  let context = await browserManager.getContext(browser);

  // 4. 키워드별 루프
  let totalFound = 0;
  let totalFiltered = 0;
  let totalUpserted = 0;
  let totalSkipped = 0;

  try {
    for (const kw of keywords) {
      console.log(`\n${'─'.repeat(40)}`);
      console.log(`키워드: "${kw.keyword}"`);

      // a. 검색 + 파싱 (블록 감지 시 Context 재생성 후 재시도)
      let items;
      try {
        items = await searchCoupangByKeyword(kw.keyword, context, {
          maxPages: 2,
          delayMin: config.COLLECT_DELAY_MIN_MS,
          delayMax: config.COLLECT_DELAY_MAX_MS,
        });
      } catch (err) {
        if (err.name !== 'BlockedError') throw err;

        console.log(`[블록감지] Akamai IP 차단 감지 — "${kw.keyword}"`);
        let recovered = false;

        for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
          console.log(
            `[블록감지] ${RETRY_WAIT_MS / 60000}분 대기 후 재시도 (${attempt}/${RETRY_COUNT})...`
          );
          await wait(RETRY_WAIT_MS);

          // 블록 감지 시: 현재 Context 닫고 새 Context로 재시도
          await context.close().catch(() => {});
          context = await browserManager.getContext(browser);

          try {
            items = await searchCoupangByKeyword(kw.keyword, context, {
              maxPages: 2,
              delayMin: config.COLLECT_DELAY_MIN_MS,
              delayMax: config.COLLECT_DELAY_MAX_MS,
            });
            recovered = true;
            break;
          } catch (retryErr) {
            if (retryErr.name !== 'BlockedError') throw retryErr;
            if (attempt === RETRY_COUNT) {
              await sendBlockAlertEmail();
              process.exit(1);
            }
          }
        }

        if (!recovered) continue;
      }

      totalFound += items.length;
      console.log(`  발견: ${items.length}개`);

      // b. 필터 적용
      const filtered = applyFilters(items, config);
      totalFiltered += filtered.length;
      console.log(`  필터 통과: ${filtered.length}개`);

      if (dryRun) {
        console.log('\n  [DRY-RUN] 필터 통과 상품:');
        filtered.slice(0, 10).forEach((item, i) => {
          console.log(
            `  ${i + 1}. ${item.itemTitle?.substring(0, 40)} | ${item.itemPrice?.toLocaleString()}원 | rocket=${item.isRocket}`
          );
        });
        if (filtered.length > 10) console.log(`  ... 외 ${filtered.length - 10}개`);
        continue;
      }

      // c. DISCOVERED upsert
      const { upserted, skipped } = await upsertDiscoveredProducts(
        sheets,
        SPREADSHEET_ID,
        filtered
      );
      totalUpserted += upserted;
      totalSkipped += skipped;
      console.log(`  upsert: ${upserted}개 / skip: ${skipped}개`);

      // d. lastRunAt 업데이트 (keywords 시트 행이 있을 때만)
      if (kw.row) {
        await updateKeywordLastRun(sheets, SPREADSHEET_ID, kw.row);
      }
    }
  } finally {
    await context.close().catch(() => {});
    // --shutdown 플래그가 있을 때만 브라우저 종료 (기본: persistent)
    if (shutdown) {
      console.log('[Browser] --shutdown: 브라우저 종료');
      await browserManager.close(browser);
    }
  }

  // 5. 완료 요약
  console.log(`\n${'='.repeat(50)}`);
  console.log('완료 요약');
  console.log('='.repeat(50));
  console.log(`  키워드 수:     ${keywords.length}개`);
  console.log(`  총 발견:       ${totalFound}개`);
  console.log(`  필터 통과:     ${totalFiltered}개`);
  if (!dryRun) {
    console.log(`  upsert 완료:   ${totalUpserted}개`);
    console.log(`  skip (중복):   ${totalSkipped}개`);
  } else {
    console.log(`  (DRY-RUN — 시트 write 없음)`);
  }
  if (!shutdown) console.log('  브라우저: 유지 중 (npm run coupang:browser:stop 으로 종료)');
}

main().catch((err) => {
  console.error('\n✗ Error:', err.message);
  if (TRACE) console.error(err.stack);
  process.exit(1);
});
