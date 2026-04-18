#!/usr/bin/env node
/**
 * coupang-keyword-discover.js — 키워드 기반 쿠팡 상품 탐색 (Browser Relay 방식)
 *
 * 흐름:
 *   1. config 시트 로드 (가격 상한, 제외 카테고리)
 *   2. keywords 시트에서 ACTIVE 키워드 목록 로드
 *   3. 키워드별:
 *      a. 검색결과 페이지 navigate (Browser Relay)
 *      b. 상품 카드 파싱 (evaluate)
 *      c. 필터 적용 (productFilters.js)
 *      d. DISCOVERED upsert (sheetsClient.js)
 *      e. keywords 시트 lastRunAt 업데이트
 *   4. 완료 요약 출력
 *
 * 전제 조건:
 *   - Chrome에서 쿠팡 로그인 탭 열고 Browser Relay attach 완료
 *   - `openclaw` CLI PATH에 등재
 *
 * CLI 옵션:
 *   --dry-run          시트 write 없이 콘솔 출력만
 *   --keyword "..."    keywords 시트 무시, 단일 키워드로 실행 (테스트용)
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

const { execSync } = require('child_process');
const {
  getSheetsClient,
  getConfig,
  getActiveKeywords,
  updateKeywordLastRun,
  upsertDiscoveredProducts,
} = require('../coupang/sheetsClient');
const { applyFilters } = require('../coupang/productFilters');
const { setHardBlocked } = require('../coupang/blockStateManager');
const { sendBlockAlertEmail } = require('../coupang/blockDetector');
const { randomDelay } = require('./delay');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TRACE = process.env.COUPANG_TRACER === '1';

function trace(...args) {
  if (TRACE) console.log('[TRACER]', ...args);
}

// ── 로그인 대기 흐름 ──────────────────────────────────────────────────────────

const PIPELINE_CHAT_ID = '-5221359008';

function isBrowserAvailable() {
  try {
    const out = execSync('openclaw browser --browser-profile chrome tabs', {
      encoding: 'utf8',
      timeout: 10_000,
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

async function sendTelegramMessage(chatId, text) {
  const https = require('https');
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.warn('[LOGIN] TELEGRAM_BOT_TOKEN 없음 — 알림 스킵');
    return;
  }
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: chatId, text });
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${botToken}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => { res.resume(); resolve(); }
    );
    req.on('error', () => resolve());
    req.write(body);
    req.end();
  });
}

async function checkAndWaitForLogin(dryRun) {
  if (dryRun) return;

  // Step 1: Chrome 연결 확인
  if (!isBrowserAvailable()) {
    console.log('[LOGIN] Chrome 없음 — Profile 1(judy)으로 Chrome 열기 시도...');
    try {
      execSync(
        'open -a "Google Chrome" --args --profile-directory="Profile 1" "https://member.coupang.com/login/login.pang"',
        { encoding: 'utf8', timeout: 10_000 }
      );
      console.log('[LOGIN] Chrome 실행 요청 완료');
    } catch (err) {
      console.warn('[LOGIN] Chrome 열기 실패:', err.message.split('\n')[0]);
    }

    // Chrome 연결 대기 (최대 60초)
    console.log('[LOGIN] Chrome 연결 대기 중...');
    const connectDeadline = Date.now() + 60_000;
    while (Date.now() < connectDeadline) {
      await new Promise((r) => setTimeout(r, 5_000));
      if (isBrowserAvailable()) break;
    }

    if (!isBrowserAvailable()) {
      await sendTelegramMessage(
        PIPELINE_CHAT_ID,
        '⚠️ [coupang:discover] Chrome 연결 실패\nChrome(Profile 1)을 열고 쿠팡에 접속한 뒤 OpenClaw 브라우저 프로파일을 연결해 주세요.'
      );
      console.error('[LOGIN] Chrome 연결 실패 — 종료 (에이전트가 2순위 전환 처리)');
      process.exit(1);
    }
  }

  // Step 2: 현재 페이지가 로그인 상태인지 확인
  let currentUrl = '';
  try {
    const raw = execSync(
      `openclaw browser --browser-profile chrome evaluate --fn '() => window.location.href'`,
      { encoding: 'utf8', timeout: 10_000 }
    ).trim();
    currentUrl = JSON.parse(raw);
  } catch { /* URL 확인 실패 시 로그인 페이지로 이동 진행 */ }

  const needsLogin =
    !currentUrl ||
    currentUrl.includes('login') ||
    !currentUrl.includes('coupang.com');

  if (!needsLogin) return;

  // Step 3: 로그인 페이지 navigate
  try {
    browserNavigate('https://member.coupang.com/login/login.pang');
    console.log('[LOGIN] 쿠팡 로그인 페이지 접속됨');
  } catch (err) {
    console.error('[LOGIN] 로그인 페이지 접속 실패:', err.message.split('\n')[0]);
  }

  // Step 4: 텔레그램 알림
  await sendTelegramMessage(
    PIPELINE_CHAT_ID,
    '🔐 [coupang:discover] 쿠팡 로그인 필요\n브라우저에 쿠팡 페이지 열어뒀어요. 로그인 후 알려주세요.'
  );
  console.log('[LOGIN] 텔레그램 알림 전송 완료. 로그인 대기 중... (최대 10분)');

  // Step 5: 로그인 완료 polling (30초 간격, 최대 10분)
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 30_000));
    try {
      const raw = execSync(
        `openclaw browser --browser-profile chrome evaluate --fn '() => window.location.href'`,
        { encoding: 'utf8', timeout: 10_000 }
      ).trim();
      const url = JSON.parse(raw);
      if (typeof url === 'string' && url.includes('coupang.com') && !url.includes('login')) {
        console.log('[LOGIN] 로그인 완료 감지 — 작업 계속');
        return;
      }
    } catch { /* keep polling */ }
  }

  console.error('[LOGIN] 로그인 대기 타임아웃 (10분) — 종료 (에이전트가 2순위 전환 처리)');
  process.exit(1);
}

// ── Browser Relay CLI 래퍼 ────────────────────────────────────────────────────

function browserNavigate(url) {
  const escaped = url.replace(/"/g, '\\"');
  execSync(`openclaw browser --browser-profile chrome navigate "${escaped}"`, {
    encoding: 'utf8',
    timeout: 30_000,
  });
}

function browserEvaluate(fn) {
  const escaped = fn.replace(/'/g, "'\\''");
  const stdout = execSync(
    `openclaw browser --browser-profile chrome evaluate --fn '${escaped}'`,
    { encoding: 'utf8', timeout: 15_000 }
  );
  return JSON.parse(stdout);
}

// ── 검색결과 파싱 evaluate 함수 ───────────────────────────────────────────────

function buildSearchParseFn() {
  // String.raw 사용 — 백슬래시가 그대로 유지되어 eval'd JS에서 정상 동작
  return String.raw`() => {
    const cards = [...document.querySelectorAll('li[data-id]')];
    return cards.map(card => {
      const anchor = card.querySelector('a');
      const href = anchor?.href || '';
      const vendorItemId = card.dataset.id ||
        href.match(/vendorItemId=(\d+)/)?.[1] || null;
      const productId = href.match(/\/products\/(\d+)/)?.[1] || null;
      const itemId = href.match(/itemId=(\d+)/)?.[1] || null;
      const categoryId = href.match(/categoryId=(\d+)/)?.[1] || null;
      const cardText = card.textContent;
      const isRocket = cardText.includes('무료반품') ||
                       cardText.includes('로켓배송') ||
                       card.outerHTML.includes('CCEDFD');
      const priceText = card.querySelector('[class*=price]')?.textContent || '';
      const price = parseInt((priceText.match(/[\d,]+/) || ['0'])[0].replace(/,/g, '')) || 0;
      const title = card.querySelector('[class*=name], [class*=title]')?.textContent?.trim() || '';
      const img = card.querySelector('img')?.src || '';
      return { vendorItemId, productId, itemId, categoryId, isRocket, price, title, href, img };
    });
  }`;
}

// ── 카드 파싱 결과 → productFilters item 구조로 정규화 ─────────────────────────

function normalizeCard(card) {
  return {
    vendorItemId:   card.vendorItemId || null,
    itemId:         card.itemId || null,
    productId:      card.productId || null,
    itemTitle:      card.title || '',
    itemPrice:      card.price || 0,
    isRocket:       card.isRocket === true,
    categoryName:   null,
    categoryId:     card.categoryId || null,
    productUrl:     card.href || '',
    thumbnailImage: card.img || '',
  };
}

// ── CLI 파싱 ─────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { dryRun: false, keyword: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      result.dryRun = true;
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
  const { dryRun, keyword: cliKeyword } = parseArgs();

  console.log('='.repeat(50));
  console.log('Coupang Keyword Discovery (Browser Relay)');
  console.log('='.repeat(50));
  console.log(`Mode:     ${dryRun ? 'DRY-RUN (no sheet write)' : 'REAL'}`);
  if (cliKeyword) console.log(`Keyword:  "${cliKeyword}" (CLI override)`);
  console.log('');

  if (!SPREADSHEET_ID) {
    console.error('Error: GOOGLE_SHEET_ID not set in backend/.env');
    process.exit(1);
  }

  await checkAndWaitForLogin(dryRun);

  const sheets = await getSheetsClient();

  // 1. config 로드
  console.log('[1/2] config 시트 로드...');
  const config = await getConfig(sheets, SPREADSHEET_ID);
  const maxPages = parseInt(config['MAX_DISCOVER_PAGES'] || '1', 10) || 1;
  console.log(`  FILTER_PRICE_KRW_MAX:       ${config.FILTER_PRICE_KRW_MAX?.toLocaleString()} KRW`);
  console.log(`  EXCLUDED_CATEGORY_KEYWORDS: ${(config.EXCLUDED_CATEGORY_KEYWORDS || []).join(', ')}`);
  console.log(`  MAX_DISCOVER_PAGES:         ${maxPages}\n`);

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

  // 3. 키워드별 루프
  let totalFound = 0;
  let totalFiltered = 0;
  let totalUpserted = 0;
  let totalSkipped = 0;

  for (const kw of keywords) {
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`키워드: "${kw.keyword}"`);

    let keywordItems = [];

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const searchUrl =
        `https://www.coupang.com/np/search?q=${encodeURIComponent(kw.keyword)}&channel=user&page=${pageNum}`;
      console.log(`  [페이지 ${pageNum}/${maxPages}]`);
      trace(searchUrl);

      try {
        // Step 1: navigate
        browserNavigate(searchUrl);
        // CSR 렌더링 대기
        await new Promise((resolve) => setTimeout(resolve, dryRun ? 500 : 2_000));

        // Step 2: 상품 카드 파싱
        const cards = browserEvaluate(buildSearchParseFn());
        trace(`raw cards: ${cards.length}개`);

        if (cards.length === 0) {
          console.warn('  ⚠ 빈 결과 — 블록 가능성. 종료');
          if (!dryRun) {
            setHardBlocked();
            await sendBlockAlertEmail();
          }
          return;
        }

        const items = cards
          .map(normalizeCard)
          .filter((item) => item.vendorItemId && item.productId);

        keywordItems.push(...items);
        console.log(`  카드: ${cards.length}개 파싱 → vendorItemId 유효: ${items.length}개`);

      } catch (err) {
        console.error(`  ✗ 페이지 ${pageNum} 실패: ${err.message.split('\n')[0]} — skip`);
      }

      // 페이지 간 딜레이 (마지막 페이지 제외)
      if (pageNum < maxPages) {
        await randomDelay(dryRun ? 500 : 10_000, dryRun ? 500 : 30_000);
      }
    }

    totalFound += keywordItems.length;
    console.log(`  발견: ${keywordItems.length}개`);

    // 필터 적용
    const filtered = applyFilters(keywordItems, config);
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

    // DISCOVERED upsert
    const { upserted, skipped } = await upsertDiscoveredProducts(
      sheets,
      SPREADSHEET_ID,
      filtered
    );
    totalUpserted += upserted;
    totalSkipped += skipped;
    console.log(`  upsert: ${upserted}개 / skip: ${skipped}개`);

    // lastRunAt 업데이트 (keywords 시트 행이 있을 때만)
    if (kw.row) {
      await updateKeywordLastRun(sheets, SPREADSHEET_ID, kw.row);
    }

    // 키워드 간 딜레이 (마지막 키워드 제외)
    if (keywords.indexOf(kw) < keywords.length - 1) {
      await randomDelay(dryRun ? 500 : 30_000, dryRun ? 500 : 60_000);
    }
  }

  // 4. 완료 요약
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
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n✗ Error:', err.message);
    if (TRACE) console.error(err.stack);
    process.exit(1);
  });
