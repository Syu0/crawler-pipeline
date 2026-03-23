'use strict';

/**
 * coupang-cookie-refresh.js
 *
 * 기존 Playwright 브라우저 데몬에 CDP로 attach하여
 * coupang.com 쿠키를 추출하고 cookieStore에 저장한다.
 * yamyam 크롬 익스텐션 대체.
 *
 * 사전 조건:
 *   1. npm run coupang:browser:start (데몬 실행 중)
 *   2. Chrome에 coupang.com 탭이 열려 있어야 함
 *
 * 사용법:
 *   node backend/scripts/coupang-cookie-refresh.js           # 만료 시에만 실행
 *   node backend/scripts/coupang-cookie-refresh.js --force   # 강제 갱신
 *   node backend/scripts/coupang-cookie-refresh.js --dry-run # 추출만, 저장 안 함
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { chromium } = require('playwright');
const { saveCookies } = require('../services/cookieStore');
const { isCookieExpiredOrSoon } = require('../services/cookieExpiry');
const { clearHardBlock } = require('../coupang/blockStateManager');

const FORCE   = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');
const CDP_URL = process.env.COUPANG_CHROME_CDP_URL || 'http://localhost:9223';
const COUPANG_DOMAIN = 'https://www.coupang.com';

async function main() {
  console.log('[cookie-refresh] 시작');

  // 1. 만료 여부 확인
  let needsRefresh = FORCE;
  if (!needsRefresh) {
    try {
      needsRefresh = isCookieExpiredOrSoon();
    } catch (err) {
      console.warn('[cookie-refresh] 만료 체크 실패 — 갱신 강행:', err.message);
      needsRefresh = true;
    }
  }

  if (!needsRefresh) {
    console.log('[cookie-refresh] 쿠키 유효. 갱신 불필요. 종료.');
    process.exit(0);
  }

  console.log(FORCE
    ? '[cookie-refresh] --force 플래그 — 강제 갱신'
    : '[cookie-refresh] 쿠키 만료(임박) 감지 — 갱신 시작');

  // 2. 기존 Chrome 데몬에 CDP로 attach (새 인스턴스 생성 금지)
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (err) {
    console.error('[cookie-refresh] Chrome 데몬 연결 실패:', err.message);
    console.error('  → npm run coupang:browser:start 를 먼저 실행하세요.');
    process.exit(1);
  }

  // 3. 쿠키 추출
  let cookieString;
  try {
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      throw new Error('브라우저 컨텍스트 없음 — Chrome에 탭이 열려있어야 합니다.');
    }
    const context = contexts[0];
    const cookies = await context.cookies(COUPANG_DOMAIN);

    if (cookies.length === 0) {
      throw new Error('coupang.com 쿠키 없음 — Chrome에서 coupang.com에 로그인된 탭을 열어주세요.');
    }

    console.log(`[cookie-refresh] 쿠키 ${cookies.length}개 추출 완료`);

    if (DRY_RUN) {
      console.log('[cookie-refresh] --dry-run 모드 — 저장 생략. 종료.');
      console.log('추출된 쿠키 이름:', cookies.map(c => c.name).join(', '));
      process.exit(0);
    }

    // Playwright cookie 배열 → "name=value; name=value; ..." 문자열 변환
    cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  } finally {
    // attach한 브라우저는 disconnect만 (close해도 CDP attach이므로 Chrome 프로세스는 유지됨)
    await browser.close();
  }

  // 4. cookieStore에 저장
  try {
    saveCookies(cookieString);
    console.log('[cookie-refresh] 쿠키 저장 완료');
  } catch (err) {
    console.error('[cookie-refresh] 쿠키 저장 실패:', err.message);
    process.exit(1);
  }

  // 5. HARD_BLOCK 쿨다운 해제
  clearHardBlock();

  console.log('[cookie-refresh] 완료. 수집 재개 가능.');
}

main().catch(err => {
  console.error('[cookie-refresh] 예상치 못한 오류:', err);
  process.exit(1);
});
