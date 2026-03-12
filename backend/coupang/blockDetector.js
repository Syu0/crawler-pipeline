'use strict';

/**
 * blockDetector.js — Akamai IP 블록 감지 + 재시도 + 이메일 알림
 *
 * 재시도 전략: 1시간 대기 × 최대 2회 → 포기 + 이메일 발송
 *
 * CLI 옵션:
 *   --test-block-wait   대기 시간을 5초로 단축 (테스트용)
 */

const nodemailer = require('nodemailer');

const RETRY_WAIT_MS = process.argv.includes('--test-block-wait') ? 5000 : 60 * 60 * 1000;
const RETRY_COUNT = 2;

// ── 커스텀 에러 ───────────────────────────────────────────────────────────────

class BlockedError extends Error {
  constructor(stage) {
    super(`Akamai block detected at stage: ${stage}`);
    this.name = 'BlockedError';
    this.stage = stage;
  }
}

// ── 블록 판단 ─────────────────────────────────────────────────────────────────

/**
 * @param {import('playwright').Page} page
 * @param {string} html
 * @returns {boolean}
 */
function isBlocked(page, html) {
  // 1. HTML이 너무 짧음 (정적 차단 페이지)
  if (html.length < 1000) return true;

  // 2. 차단 키워드 포함
  const BLOCK_KEYWORDS = ['access denied', 'robot', 'captcha', '차단', 'security check', 'blocked'];
  const lower = html.toLowerCase();
  if (BLOCK_KEYWORDS.some((kw) => lower.includes(kw))) return true;

  // 3. 비정상 URL 리다이렉트
  const url = page.url();
  if (url.includes('/login') || url.includes('/captcha') || url.includes('/security')) return true;

  return false;
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── 이메일 발송 ───────────────────────────────────────────────────────────────

async function sendBlockAlertEmail() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.NOTIFY_EMAIL || user;

  if (!user || !pass) {
    console.warn('[blockDetector] GMAIL_USER / GMAIL_APP_PASSWORD 미설정 — 이메일 발송 스킵');
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  const subject = '[쿠팡수집] IP 블록 감지 — 수동 확인 필요';
  const text = [
    'Akamai IP 차단이 감지되어 수집이 중단되었습니다.',
    '',
    `재시도: ${RETRY_COUNT}회 (${RETRY_WAIT_MS / 60000}분 간격)`,
    `최종 실패 시각: ${new Date().toISOString()}`,
    '',
    '조치 방법:',
    '1. 1~2시간 후 재실행',
    '2. VPN 또는 다른 네트워크에서 재시도',
    '3. yamyam 익스텐션으로 쿠키 재추출 후 재실행',
  ].join('\n');

  await transporter.sendMail({ from: user, to, subject, text });
  console.log(`[blockDetector] 블록 알림 이메일 발송 완료 → ${to}`);
}

// ── 재시도 래퍼 (선택적 사용) ─────────────────────────────────────────────────

/**
 * 블록 감지 시 재시도 래퍼.
 * fn은 { page, html } 을 반환하는 async 함수.
 *
 * @param {Function} fn - async (context) => { page, html }
 * @param {import('playwright').BrowserContext} context
 * @returns {Promise<{ success: boolean, result?: { page, html }, blocked: boolean }>}
 */
async function withBlockRetry(fn, context) {
  for (let attempt = 1; attempt <= RETRY_COUNT + 1; attempt++) {
    const { page, html } = await fn(context);

    if (!isBlocked(page, html)) {
      return { success: true, result: { page, html }, blocked: false };
    }

    console.log(`[블록감지] Akamai IP 차단 감지 (시도 ${attempt}/${RETRY_COUNT + 1})`);

    if (attempt <= RETRY_COUNT) {
      console.log(`[블록감지] ${RETRY_WAIT_MS / 60000}분 후 재시도...`);
      await wait(RETRY_WAIT_MS);
    } else {
      console.error('[블록감지] 재시도 소진. 이메일 알림 발송 후 종료.');
      await sendBlockAlertEmail();
      return { success: false, blocked: true };
    }
  }
}

module.exports = {
  BlockedError,
  isBlocked,
  wait,
  sendBlockAlertEmail,
  withBlockRetry,
  RETRY_WAIT_MS,
  RETRY_COUNT,
};
