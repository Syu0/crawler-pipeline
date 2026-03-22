'use strict';

/**
 * openclaw-cookie-refresh.js
 *
 * 쿠키 만료 여부를 확인하고, 만료(또는 --force 플래그)이면
 * OpenClaw Browser Relay에 쿠키 추출을 지시한다.
 *
 * 사용법:
 *   node backend/scripts/openclaw-cookie-refresh.js          # 만료 시에만 실행
 *   node backend/scripts/openclaw-cookie-refresh.js --force  # 강제 갱신
 *   node backend/scripts/openclaw-cookie-refresh.js --dry-run # 지시 없이 상태만 출력
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { isCookieExpiredOrSoon } = require('../services/cookieExpiry');
const { isSessionActive, requestCookieRefresh } = require('../services/openclawClient');

const FORCE   = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log('[cookie-refresh] 시작');

  // 1. 쿠키 만료 여부 확인
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

  if (DRY_RUN) {
    console.log('[cookie-refresh] --dry-run 모드 — OpenClaw 지시 생략. 종료.');
    process.exit(0);
  }

  // 2. OpenClaw 세션 확인
  const active = await isSessionActive();
  if (!active) {
    console.error('[cookie-refresh] OpenClaw 세션 비활성. Browser Relay 불가.');
    console.error('  → OpenClaw 앱을 실행하고 Browser Relay를 연결한 뒤 재시도하세요.');
    process.exit(1);
  }

  // 3. OpenClaw에 쿠키 추출 지시
  console.log('[cookie-refresh] OpenClaw에 쿠키 추출 지시 전송 중...');
  try {
    await requestCookieRefresh();
    console.log('[cookie-refresh] 지시 전송 완료. OpenClaw가 쿠키를 POST /api/cookie/coupang으로 전송합니다.');
    console.log('  → 30초 후 수집이 재개 가능한지 확인하세요.');
  } catch (err) {
    console.error('[cookie-refresh] 지시 전송 실패:', err.message);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[cookie-refresh] 예상치 못한 오류:', err);
  process.exit(1);
});
