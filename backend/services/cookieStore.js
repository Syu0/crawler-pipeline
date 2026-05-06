/**
 * cookieStore.js
 *
 * 쿠팡 세션 쿠키 저장/로드.
 *
 * 갱신 플로우 (yamyam 확장 v2.0~):
 *   1. 사용자가 yamyam 확장 "🔑 쿠키 복사" 버튼 클릭
 *   2. 확장이 ~/Downloads/coupang_cookie.txt 에 cookie string 저장
 *   3. loadCookies() 호출 시 mtime 비교해서 캐시(.cookies/coupang.json)보다
 *      신선하면 자동 흡수
 *
 * loadCookies() 우선순위:
 *   ① Downloads 파일 mtime > 캐시 updatedAt → 흡수 + 캐시 갱신
 *   ② 캐시 valid (not expired) → 캐시 사용
 *   ③ 만료/없음 → .env COUPANG_FALLBACK_COOKIES 폴백 + 경고
 *   ④ 다 없음 → null
 *
 * 캐시 shape:
 * {
 *   "cookieString": "key=value; key=value; ...",
 *   "updatedAt": "<ISO8601>",
 *   "expiresAt": "<ISO8601>"
 * }
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const os = require('os');
const path = require('path');

const COOKIES_DIR = path.join(__dirname, '..', '.cookies');
const COOKIE_FILE = path.join(COOKIES_DIR, 'coupang.json');
const TTL_DAYS = parseInt(process.env.COOKIE_TTL_DAYS || '14', 10);
const DOWNLOAD_COOKIE_PATH = process.env.COUPANG_DOWNLOAD_COOKIE_PATH
  || path.join(os.homedir(), 'Downloads', 'coupang_cookie.txt');

function ensureDir() {
  if (!fs.existsSync(COOKIES_DIR)) {
    fs.mkdirSync(COOKIES_DIR, { recursive: true });
  }
}

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

function loadCookieData() {
  if (!fs.existsSync(COOKIE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * Downloads 파일이 캐시보다 신선하면 흡수 후 캐시 갱신.
 * 흡수했으면 새 data, 아니면 null.
 */
function importFromDownloadIfNewer() {
  if (!fs.existsSync(DOWNLOAD_COOKIE_PATH)) return null;

  let dlMtime;
  let cookieString;
  try {
    dlMtime = fs.statSync(DOWNLOAD_COOKIE_PATH).mtime;
    cookieString = fs.readFileSync(DOWNLOAD_COOKIE_PATH, 'utf8').trim();
  } catch (err) {
    console.warn('[cookieStore] Downloads 쿠키 읽기 실패:', err.message);
    return null;
  }

  if (!cookieString) return null;

  const cached = loadCookieData();
  if (cached && cached.updatedAt && new Date(cached.updatedAt) >= dlMtime) {
    return null;
  }

  const data = saveCookies(cookieString, dlMtime.toISOString());
  console.log(`[cookieStore] Downloads 쿠키 흡수 (mtime=${dlMtime.toISOString()}) → 캐시 갱신`);
  return data;
}

/**
 * 쿠키 문자열 반환. 우선순위: Downloads → 캐시 → .env fallback → null.
 * @returns {string | null}
 */
function loadCookies() {
  importFromDownloadIfNewer();

  const cached = loadCookieData();
  if (cached && new Date() < new Date(cached.expiresAt)) {
    return cached.cookieString;
  }

  const fallback = process.env.COUPANG_FALLBACK_COOKIES;
  if (fallback && fallback.trim()) {
    console.warn('[cookieStore] ⚠ 캐시 만료/없음 — .env COUPANG_FALLBACK_COOKIES 폴백 사용. yamyam 확장으로 쿠키 갱신 필요.');
    return fallback.trim();
  }

  if (cached) {
    console.warn('[cookieStore] ⚠ 캐시 만료, 폴백 없음 — null 반환. yamyam 확장으로 쿠키 갱신 필요.');
  }
  return null;
}

function isExpired() {
  const data = loadCookieData();
  if (!data) return true;
  return new Date() >= new Date(data.expiresAt);
}

function daysUntilExpiry() {
  const data = loadCookieData();
  if (!data) return -1;
  const diff = new Date(data.expiresAt) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

module.exports = {
  saveCookies,
  loadCookies,
  loadCookieData,
  isExpired,
  daysUntilExpiry,
  importFromDownloadIfNewer,
};
