'use strict';

/**
 * coupang-cookie-check.js
 *
 * 쿠팡 쿠키 만료 임박 텔레그램 알림.
 * D-3 이내일 때만 발송. 갱신은 사용자가 yamyam 확장 "🔑 쿠키 복사" 버튼.
 *
 * 사용법:
 *   node backend/scripts/coupang-cookie-check.js
 *   node backend/scripts/coupang-cookie-check.js --threshold 3   # 기본 3일
 *   node backend/scripts/coupang-cookie-check.js --force         # 임계 무시 발송 (테스트)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { daysUntilExpiry, isExpired, loadCookieData } = require('../services/cookieStore');
const { sendTelegram } = require('../services/telegramNotifier');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const tIdx = args.indexOf('--threshold');
const THRESHOLD = tIdx >= 0 ? parseInt(args[tIdx + 1], 10) : 3;

async function main() {
  const data = loadCookieData();
  if (!data) {
    const msg = [
      '🔑 <b>[RoughDiamond] 쿠팡 쿠키 없음</b>',
      '',
      '캐시가 없습니다. yamyam 확장 → 🔑 쿠키 복사 클릭하세요.',
    ].join('\n');
    console.warn('[cookie-check] 캐시 없음 — 알림 발송');
    await sendTelegram(msg);
    process.exit(0);
  }

  const days = daysUntilExpiry();
  const expired = isExpired();
  console.log(`[cookie-check] daysUntilExpiry=${days}, isExpired=${expired}, threshold=${THRESHOLD}`);

  if (!FORCE && !expired && days > THRESHOLD) {
    console.log('[cookie-check] 만료 여유 — 알림 skip');
    process.exit(0);
  }

  const dLabel = expired ? '만료됨' : `D-${days}`;
  const msg = [
    `🔑 <b>[RoughDiamond] 쿠팡 쿠키 ${dLabel}</b>`,
    '',
    `만료 예정: ${new Date(data.expiresAt).toLocaleDateString('ko-KR')}`,
    '',
    'yamyam 확장 → 🔑 쿠키 복사 클릭하세요.',
    '(Mac mini Chrome → coupang.com 로그인 상태 → yamyam 아이콘)',
  ].join('\n');

  await sendTelegram(msg);
  console.log(`[cookie-check] 알림 발송 (${dLabel})`);
}

main().catch(err => {
  console.error('[cookie-check] 오류:', err);
  process.exit(1);
});
