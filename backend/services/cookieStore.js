/**
 * cookieStore.js
 *
 * backend/.cookies/coupang.json 에 쿠팡 세션 쿠키를 저장/로드한다.
 *
 * shape:
 * {
 *   "cookieString": "key=value; key=value; ...",
 *   "updatedAt": "<ISO8601>",
 *   "expiresAt": "<ISO8601>"
 * }
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const COOKIES_DIR = path.join(__dirname, '..', '.cookies');
const COOKIE_FILE = path.join(COOKIES_DIR, 'coupang.json');
const TTL_DAYS = parseInt(process.env.COOKIE_TTL_DAYS || '14', 10);

function ensureDir() {
  if (!fs.existsSync(COOKIES_DIR)) {
    fs.mkdirSync(COOKIES_DIR, { recursive: true });
  }
}

/**
 * 쿠키 문자열 저장
 * @param {string} cookieString - "key=val; key=val; ..." 형식
 * @param {string} [updatedAt] - ISO8601 (기본값: now)
 * @returns {{ cookieString, updatedAt, expiresAt }}
 */
function saveCookies(cookieString, updatedAt) {
  ensureDir();
  const now = updatedAt ? new Date(updatedAt) : new Date();
  const expiresAt = new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000);

  const data = {
    cookieString,
    updatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  fs.writeFileSync(COOKIE_FILE, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

/**
 * 저장된 쿠키 전체 데이터 반환 (파일이 없으면 null)
 * @returns {{ cookieString, updatedAt, expiresAt } | null}
 */
function loadCookieData() {
  if (!fs.existsSync(COOKIE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * 쿠키 문자열만 반환 (없으면 null)
 * @returns {string | null}
 */
function loadCookies() {
  const data = loadCookieData();
  return data ? data.cookieString : null;
}

/**
 * 쿠키 만료 여부 확인
 * @returns {boolean}
 */
function isExpired() {
  const data = loadCookieData();
  if (!data) return true;
  return new Date() >= new Date(data.expiresAt);
}

/**
 * 만료까지 남은 일수 (음수면 이미 만료)
 * @returns {number}
 */
function daysUntilExpiry() {
  const data = loadCookieData();
  if (!data) return -1;
  const diff = new Date(data.expiresAt) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

module.exports = { saveCookies, loadCookies, loadCookieData, isExpired, daysUntilExpiry };
