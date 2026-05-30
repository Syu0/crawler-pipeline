'use strict';

/**
 * sellerCookieStore.js
 *
 * seller.qoo10.jp JWT + 세션 쿠키 저장/로드.
 *
 * 갱신 플로우:
 *   1. seller-cookie-refresh.js 실행 (브라우저 쿠키 추출 → 저장)
 *      또는 saveAuth({ jwt, custNo, cookieHeader }) 직접 호출
 *   2. qoo10-seller-daily.js가 loadAuth()로 읽어 직접 API 호출
 *
 * 저장 shape:
 * {
 *   "jwt": "eyJhbGci...",           ← ch-session-* 쿠키 값
 *   "custNo": "257796265",          ← qsm_cust_no 쿠키 값 (X-SELL-CUST-NO 헤더)
 *   "cookieHeader": "GiosisGsmJP=...; ch-session-...=...; ...",
 *   "updatedAt": "<ISO8601>",
 *   "expiresAt": "<ISO8601>"        ← JWT exp claim 기반 (없으면 24h)
 * }
 */

const fs = require('fs');
const path = require('path');

const COOKIES_DIR = path.join(__dirname, '..', '.cookies');
const AUTH_FILE = path.join(COOKIES_DIR, 'seller-qoo10.json');

function _ensureDir() {
  if (!fs.existsSync(COOKIES_DIR)) fs.mkdirSync(COOKIES_DIR, { recursive: true });
}

function _decodeJwtExpiry(token) {
  try {
    const payload = Buffer.from(token.split('.')[1], 'base64url').toString('utf8');
    const { exp } = JSON.parse(payload);
    return exp ? new Date(exp * 1000) : null;
  } catch (_) {
    return null;
  }
}

function saveAuth({ jwt, custNo, cookieHeader }) {
  _ensureDir();
  const expiresAt = _decodeJwtExpiry(jwt) || new Date(Date.now() + 24 * 60 * 60 * 1000);
  const data = {
    jwt,
    custNo,
    cookieHeader,
    updatedAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2));
  return data;
}

function loadAuthData() {
  if (!fs.existsSync(AUTH_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * 유효한 auth 반환. 만료됐거나 파일 없으면 null.
 * @returns {{ jwt: string, custNo: string, cookieHeader: string, expiresAt: string } | null}
 */
function loadAuth() {
  const data = loadAuthData();
  if (!data) return null;
  if (new Date() >= new Date(data.expiresAt)) return null;
  return data;
}

function isExpired() {
  const data = loadAuthData();
  if (!data) return true;
  return new Date() >= new Date(data.expiresAt);
}

function hoursUntilExpiry() {
  const data = loadAuthData();
  if (!data) return -1;
  const diff = new Date(data.expiresAt) - new Date();
  return Math.round(diff / (1000 * 60 * 60) * 10) / 10;
}

/**
 * openclaw browser cookies 출력(JSON 배열) → auth 추출 + 저장.
 * 외부에서 `openclaw browser --browser-profile chrome cookies` 결과를 파싱해 넘긴다.
 *
 * @param {Array<{name:string, value:string, domain:string}>} rawCookies
 */
function saveFromBrowserCookies(rawCookies) {
  const jwtCookie = rawCookies.find(c => c.name.startsWith('ch-session-'));
  if (!jwtCookie) throw new Error('ch-session-* 쿠키 없음 — seller.qoo10.jp에 로그인 상태인지 확인');

  const custNoCookie = rawCookies.find(c => c.name === 'qsm_cust_no');
  if (!custNoCookie) console.warn('[sellerCookieStore] qsm_cust_no 쿠키 없음 — X-SELL-CUST-NO 빈 값으로 저장');

  // seller API 호출에 필요한 도메인 쿠키만 필터
  const relevant = rawCookies.filter(c =>
    c.domain === '.qoo10.jp' ||
    c.domain === 'seller.qoo10.jp' ||
    c.domain === '.seller.qoo10.jp'
  );
  const cookieHeader = relevant.map(c => `${c.name}=${c.value}`).join('; ');

  const data = saveAuth({
    jwt: jwtCookie.value,
    custNo: custNoCookie?.value || '',
    cookieHeader,
  });

  const expiresAt = new Date(data.expiresAt);
  console.log(`[sellerCookieStore] 저장 완료 — jwt=${jwtCookie.name}, custNo=${data.custNo}, expiresAt=${expiresAt.toLocaleString('sv')}`);
  return data;
}

module.exports = {
  saveAuth,
  loadAuth,
  loadAuthData,
  isExpired,
  hoursUntilExpiry,
  saveFromBrowserCookies,
};
