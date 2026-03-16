'use strict';

/**
 * blockDetector.js — Akamai IP 블록 감지 + 이메일 알림
 *
 * 재시도 전략: 호출부(collect 스크립트)에서 row 단위로 처리.
 * withBlockRetry는 블록 감지 즉시 { blocked: true } 반환 (대기 없음).
 *
 * CLI 옵션:
 *   --test-block-wait   (하위 호환 유지, 현재 withBlockRetry 대기 없음)
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
  const BLOCK_KEYWORDS = ['access denied', 'robot', 'captcha', 'security check', 'blocked'];
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

// ── 블록 에러 판별 ────────────────────────────────────────────────────────────

/**
 * 수집 중 catch된 Error가 Akamai IP 블록으로 인한 것인지 판별한다.
 * playwrightScraper.js가 던지는 에러 메시지 패턴 기반.
 *
 * @param {Error} err
 * @returns {boolean}
 */
function isBlockError(err) {
  if (!err || !err.message) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('akamai') ||
    msg.includes('access denied') ||
    msg.includes('coupang returned 403') ||
    msg.includes('coupang returned 429')
  );
}

// ── 이메일 발송 ───────────────────────────────────────────────────────────────

/**
 * 블록 비율 초과 알림 이메일 발송.
 *
 * @param {{ blocked: number, total: number, success: number, error: number } | null} stats
 */
async function sendBlockAlertEmail(stats = null) {
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

  const subject = '[쿠팡수집] IP 블록 비율 초과 — 수동 확인 필요';
  const statsLine = stats
    ? `수집 결과: 전체 ${stats.total}개 / 블록 ${stats.blocked}개 / 성공 ${stats.success}개 / 오류 ${stats.error}개`
    : '';
  const text = [
    'Akamai IP 차단이 전체 수집 대상의 50% 이상에서 감지되었습니다.',
    statsLine,
    '',
    `감지 시각: ${new Date().toISOString()}`,
    '',
    '조치 방법:',
    '1. 1~2시간 후 재실행',
    '2. VPN 또는 다른 네트워크에서 재시도',
    '3. yamyam 익스텐션으로 쿠키 재추출 후 재실행',
  ].filter(Boolean).join('\n');

  await transporter.sendMail({ from: user, to, subject, text });
  console.log(`[blockDetector] 블록 알림 이메일 발송 완료 → ${to}`);
}

// ── 재시도 래퍼 (선택적 사용) ─────────────────────────────────────────────────

/**
 * 블록 감지 시 즉시 반환 래퍼 (재시도 없음).
 * 블록 감지 시 호출부에서 row 단위로 skip/ERROR 처리.
 * fn은 { page, html } 을 반환하는 async 함수.
 *
 * @param {Function} fn - async (context) => { page, html }
 * @param {import('playwright').BrowserContext} context
 * @returns {Promise<{ success: boolean, result?: { page, html }, blocked: boolean }>}
 */
async function withBlockRetry(fn, context) {
  const { page, html } = await fn(context);

  if (!isBlocked(page, html)) {
    return { success: true, result: { page, html }, blocked: false };
  }

  console.log('[블록감지] Akamai IP 차단 감지 — 해당 항목 skip');
  return { success: false, blocked: true };
}

module.exports = {
  BlockedError,
  isBlocked,
  isBlockError,
  wait,
  sendBlockAlertEmail,
  withBlockRetry,
  RETRY_WAIT_MS,
  RETRY_COUNT,
};
