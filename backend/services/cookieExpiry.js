/**
 * cookieExpiry.js
 *
 * 쿠팡 쿠키 만료 이메일 알림.
 *   - 만료 3일 전 + 당일 발송
 *   - backend/.cookies/notify_log.json 으로 중복 발송 방지
 *
 * .env:
 *   GMAIL_USER=meaningful.jy@gmail.com
 *   GMAIL_APP_PASSWORD=<앱 비밀번호>
 *   NOTIFY_EMAIL=meaningful.jy@gmail.com
 *   COOKIE_TTL_DAYS=14
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { loadCookieData, isExpired, daysUntilExpiry } = require('./cookieStore');

const COOKIES_DIR = path.join(__dirname, '..', '.cookies');
const NOTIFY_LOG = path.join(COOKIES_DIR, 'notify_log.json');

// 알림을 보낼 D-days 목록
const NOTIFY_AT_DAYS = [3, 0];

function loadNotifyLog() {
  if (!fs.existsSync(NOTIFY_LOG)) return {};
  try {
    return JSON.parse(fs.readFileSync(NOTIFY_LOG, 'utf8'));
  } catch (_) {
    return {};
  }
}

function saveNotifyLog(log) {
  if (!fs.existsSync(COOKIES_DIR)) fs.mkdirSync(COOKIES_DIR, { recursive: true });
  fs.writeFileSync(NOTIFY_LOG, JSON.stringify(log, null, 2), 'utf8');
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function sendMail(daysLeft, expiresAt) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.NOTIFY_EMAIL || user;

  if (!user || !pass) {
    console.warn('[cookieExpiry] GMAIL_USER / GMAIL_APP_PASSWORD 미설정 — 이메일 발송 스킵');
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  const dLabel = daysLeft <= 0 ? '오늘 만료' : `D-${daysLeft}일`;
  const subject = `[🍪 yam yam] 쿠팡 쿠키 갱신 필요 — ${dLabel}`;
  const text = [
    `쿠팡 쿠키가 ${daysLeft <= 0 ? '오늘 만료됩니다.' : `${daysLeft}일 후 만료됩니다.`}`,
    '',
    'Chrome에서 coupang.com 접속 후 yam yam 버튼을 눌러주세요.',
    '',
    `만료일: ${expiresAt}`,
  ].join('\n');

  await transporter.sendMail({ from: user, to, subject, text });
  console.log(`[cookieExpiry] 알림 이메일 발송 완료 → ${to} (${dLabel})`);
}

/**
 * 만료 알림이 필요하면 이메일을 발송한다.
 * 수집 스크립트 시작 시 호출.
 */
async function checkAndNotify() {
  const data = loadCookieData();
  if (!data) return; // 쿠키 자체가 없으면 알림 불필요

  const daysLeft = daysUntilExpiry();
  const shouldNotify = NOTIFY_AT_DAYS.some((d) => daysLeft <= d);
  if (!shouldNotify) return;

  // 중복 방지 — 오늘 이미 발송했는지 확인
  const log = loadNotifyLog();
  const key = todayKey();
  if (log[key]) {
    console.log(`[cookieExpiry] 오늘 이미 알림 발송됨 (${key}) — 스킵`);
    return;
  }

  try {
    await sendMail(daysLeft, data.expiresAt);
    log[key] = { daysLeft, sentAt: new Date().toISOString() };
    saveNotifyLog(log);
  } catch (err) {
    console.error('[cookieExpiry] 이메일 발송 실패:', err.message);
  }
}

/**
 * 쿠키 만료가 임박(D-thresholdDays 이하)하거나 이미 만료된 경우 true 반환.
 * @param {number} thresholdDays 기본값 1 (내일 만료 포함)
 * @returns {boolean}
 */
function isCookieExpiredOrSoon(thresholdDays = 1) {
  const data = loadCookieData();
  if (!data) return true;
  return daysUntilExpiry() <= thresholdDays;
}

module.exports = { checkAndNotify, isCookieExpiredOrSoon };
