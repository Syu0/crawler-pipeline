'use strict';

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3001';
const COOKIE_ENDPOINT = process.env.BACKEND_COOKIE_URL || 'http://localhost:4000/api/cookie/coupang';

/**
 * OpenClaw 세션이 활성화되어 있는지 확인한다.
 * @returns {Promise<boolean>}
 */
async function isSessionActive() {
  try {
    const res = await fetch(`${DASHBOARD_URL}/api/openclaw/session-status`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data?.active === true || data?.connected === true;
  } catch {
    return false;
  }
}

/**
 * OpenClaw에 Browser Relay 쿠키 추출 지시를 전송한다.
 * OpenClaw는 쿠팡 탭에서 쿠키를 추출하여 COOKIE_ENDPOINT로 POST한다.
 * @returns {Promise<void>}
 */
async function requestCookieRefresh() {
  const instruction = [
    'Browser Relay를 사용해서 현재 Chrome에 열려 있는 coupang.com 탭에 접속해줘.',
    'CDP Network.getAllCookies 명령으로 coupang.com 도메인의 모든 쿠키를 추출하고,',
    `아래 형식으로 POST ${COOKIE_ENDPOINT} 에 JSON 바디로 전송해줘.`,
    '',
    '전송 형식:',
    '{',
    '  "cookies": "<추출한 쿠키를 name=value; name2=value2 형식의 단일 문자열로 변환>",',
    '  "updatedAt": "<현재 ISO8601 시각>"',
    '}',
    '',
    '전송 후 HTTP 응답 상태 코드와 바디를 그대로 알려줘.',
  ].join('\n');

  const res = await fetch(`${DASHBOARD_URL}/api/openclaw/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: instruction }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenClaw send 실패: ${res.status} ${text}`);
  }
}

module.exports = { isSessionActive, requestCookieRefresh };
