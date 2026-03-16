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

// ── 에러 3-tier 분류 ─────────────────────────────────────────────────────────

/**
 * @param {Error} err
 * @returns {'HARD_BLOCK' | 'SOFT_BLOCK' | 'ROW_ERROR'}
 */
function classifyError(err) {
  const msg = (err.message || '').toLowerCase();
  const status = err.status || err.statusCode || 0;

  const hardPatterns = [/akamai/i, /bot.detect/i, /access.denied/i, /403/, /blocked/i];
  if (status === 403 || hardPatterns.some((p) => p.test(msg))) return 'HARD_BLOCK';

  if (status === 429 || /429|rate.limit|too.many.request/i.test(msg)) return 'SOFT_BLOCK';

  return 'ROW_ERROR';
}

// ── SOFT_BLOCK 재시도 래퍼 ────────────────────────────────────────────────────

/**
 * SOFT_BLOCK(429) 발생 시 재시도 래퍼.
 * HARD_BLOCK은 즉시 상위로 전파. ROW_ERROR도 즉시 상위로 전파.
 *
 * @param {Function} fn  실행할 비동기 함수 () => Promise<any>
 * @param {{ maxRetries?: number, waitMs?: number }} opts
 * @returns {Promise<{ success: boolean, result?: any, escalated: boolean }>}
 *   escalated: true = SOFT_BLOCK 재시도 소진 → HARD_BLOCK으로 처리 필요
 */
async function withSoftBlockRetry(fn, opts = {}) {
  const { maxRetries = 3, waitMs = 30_000 } = opts;
  const actualWait = process.argv.includes('--test-block-wait') ? 5_000 : waitMs;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return { success: true, result, escalated: false };
    } catch (err) {
      const tier = classifyError(err);

      if (tier === 'HARD_BLOCK') throw err; // 즉시 상위 전파

      if (tier === 'SOFT_BLOCK') {
        if (attempt < maxRetries) {
          console.warn(`[blockDetector] SOFT_BLOCK — ${attempt}/${maxRetries}회, ${actualWait / 1000}초 대기`);
          await new Promise((r) => setTimeout(r, actualWait));
          continue;
        }
        console.error(`[blockDetector] SOFT_BLOCK 재시도 ${maxRetries}회 소진 → HARD_BLOCK escalate`);
        return { success: false, escalated: true };
      }

      throw err; // ROW_ERROR — 즉시 상위 전파
    }
  }
}

// ── 이메일 발송 ───────────────────────────────────────────────────────────────

/**
 * 블록 알림 이메일 발송.
 *
 * 새 shape: { success, rowError, softBlock, hardBlock, total, lastUrl?, triggerReason }
 * 구 shape:  { blocked, total, success, error } | null  (하위 호환)
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

  const isNewShape = stats && stats.triggerReason !== undefined;

  const subject = isNewShape
    ? `[쿠팡수집] 블록 알림 — ${stats.triggerReason === 'HARD_BLOCK' ? 'HARD_BLOCK 감지' : 'ROW_ERROR 50% 초과'}`
    : '[쿠팡수집] IP 블록 비율 초과 — 수동 확인 필요';

  let statsLine = '';
  if (isNewShape && stats) {
    statsLine = [
      `triggerReason: ${stats.triggerReason}`,
      `success: ${stats.success} / total: ${stats.total}`,
      `rowError: ${stats.rowError} / softBlock: ${stats.softBlock} / hardBlock: ${stats.hardBlock}`,
      stats.lastUrl ? `lastUrl: ${stats.lastUrl}` : '',
    ].filter(Boolean).join('\n');
  } else if (stats) {
    statsLine = `수집 결과: 전체 ${stats.total}개 / 블록 ${stats.blocked}개 / 성공 ${stats.success}개 / 오류 ${stats.error}개`;
  }

  const text = [
    isNewShape
      ? (stats.triggerReason === 'HARD_BLOCK'
          ? 'HARD_BLOCK이 감지되어 수집 루프가 중단되었습니다.'
          : 'ROW_ERROR 비율이 50%를 초과했습니다.')
      : 'Akamai IP 차단이 전체 수집 대상의 50% 이상에서 감지되었습니다.',
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
  classifyError,
  wait,
  sendBlockAlertEmail,
  withBlockRetry,
  withSoftBlockRetry,
  RETRY_WAIT_MS,
  RETRY_COUNT,
};
