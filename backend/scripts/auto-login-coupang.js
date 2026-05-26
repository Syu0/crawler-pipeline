#!/usr/bin/env node
/**
 * auto-login-coupang.js — coupang.com 자동 로그인
 *
 * cookieStore가 만료된 경우 또는 D-3 이하 안내와 함께 실행.
 * 이미 로그인된 경우 즉시 exit 0.
 * 로그인 필요 시 .env의 COUPANG_ID + COUPANG_PW로 자동 입력.
 * 실패 시 exit 1 (daily-qoo10 Pre-flight에서 yamyam 안내 fallback).
 *
 * 주의: Akamai 봇탐지는 실제 Chrome CDP 연결이라 위험 낮음.
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

function ts() { return new Date().toLocaleString('sv'); }

const COUPANG_LOGIN_URL = 'https://login.coupang.com/login/login.pang';
const COUPANG_HOME_URL = 'https://www.coupang.com/';

const COUPANG_ID = process.env.COUPANG_ID;
const COUPANG_PW = process.env.COUPANG_PW;

if (!COUPANG_ID || !COUPANG_PW) {
  console.error(`[${ts()}] ❌ COUPANG_ID 또는 COUPANG_PW가 .env에 없습니다.`);
  process.exit(1);
}

// ── Browser helpers ──────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function browserTabs() {
  return execSync('openclaw browser --browser-profile chrome tabs', { encoding: 'utf8', timeout: 15000 });
}

function findTabId(urlSubstring) {
  const lines = browserTabs().split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(urlSubstring)) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const m = lines[j].match(/id:\s*([A-F0-9]+)/);
        if (m) return m[1];
      }
    }
  }
  return null;
}

function browserOpenTab(url) {
  const escUrl = url.replace(/"/g, '\\"');
  const out = execSync(`openclaw browser --browser-profile chrome open "${escUrl}"`, { encoding: 'utf8', timeout: 30000 });
  const m = out.match(/id:\s*([A-F0-9]+)/);
  return m ? m[1] : null;
}

function browserNavigate(targetId, url) {
  const escUrl = url.replace(/"/g, '\\"');
  execSync(`openclaw browser --browser-profile chrome navigate --target-id ${targetId} "${escUrl}"`, { encoding: 'utf8', timeout: 30000 });
}

function browserEvaluate(targetId, fn) {
  const escFn = fn.replace(/'/g, "'\\''");
  const cmd = `openclaw browser --browser-profile chrome evaluate --target-id ${targetId} --fn '${escFn}'`;
  const out = execSync(cmd, { encoding: 'utf8', timeout: 30000 });
  return JSON.parse(out);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[${ts()}] 쿠팡 자동 로그인 시작`);

  // 1. coupang.com 탭 찾기
  let tabId = findTabId('coupang.com');

  if (tabId) {
    // 1a. 이미 로그인됐는지 확인 (로그인 링크가 없으면 로그인 상태)
    const homeState = browserEvaluate(tabId, `() => ({
      url: location.href,
      hasLoginLink: !!document.querySelector("a[href*=\\"login.coupang.com\\"]"),
      hasMyCoupang: !!document.querySelector("a[href*=\\"mypage\\"], .header-user-info, [data-testid=\\"my-coupang\\"]")
    })`);

    console.log(`[${ts()}] 쿠팡 탭 URL: ${homeState.url}`);

    if (!homeState.hasLoginLink || homeState.hasMyCoupang) {
      console.log(`[${ts()}] ✅ 이미 로그인됨 — 완료`);
      process.exit(0);
    }
  }

  // 2. 로그인 페이지 열기 (기존 탭 or 새 탭)
  console.log(`[${ts()}] 로그인 페이지로 이동`);
  if (tabId) {
    browserNavigate(tabId, COUPANG_LOGIN_URL);
  } else {
    tabId = browserOpenTab(COUPANG_LOGIN_URL);
    if (!tabId) {
      console.error(`[${ts()}] ❌ 로그인 탭 열기 실패`);
      process.exit(1);
    }
  }
  await sleep(3000);

  // 3. 로그인 폼 확인
  const loginState = browserEvaluate(tabId, `() => ({
    url: location.href,
    hasEmailField: !!document.querySelector("#login-email-input"),
    hasPwField: !!document.querySelector("#login-password-input")
  })`);

  if (!loginState.hasEmailField || !loginState.hasPwField) {
    console.log(`[${ts()}] ✅ 로그인 폼 없음 — 이미 로그인 상태`);
    process.exit(0);
  }

  console.log(`[${ts()}] 로그인 폼 감지 — 자동 입력 시작`);

  // 4. React 폼에 값 주입 (native input setter 사용)
  const safeId = JSON.stringify(COUPANG_ID);
  const safePw = JSON.stringify(COUPANG_PW);

  const fillResult = browserEvaluate(tabId, `() => {
    function setNativeValue(el, value) {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      nativeSetter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const emailField = document.querySelector("#login-email-input");
    const pwField = document.querySelector("#login-password-input");
    if (!emailField || !pwField) return { error: "fields_not_found" };
    setNativeValue(emailField, ${safeId});
    setNativeValue(pwField, ${safePw});
    return { ok: true };
  }`);

  if (fillResult.error) {
    console.error(`[${ts()}] ❌ 폼 필드 입력 실패: ${fillResult.error}`);
    process.exit(1);
  }

  console.log(`[${ts()}] ID/PW 입력 완료 — 로그인 버튼 클릭`);
  await sleep(800);

  // 5. 로그인 버튼 클릭
  const clickResult = browserEvaluate(tabId, `() => {
    const btn = document.querySelector("button.login__button--submit");
    if (!btn) return { error: "btn_not_found" };
    btn.click();
    return { ok: true };
  }`);

  if (clickResult.error) {
    console.error(`[${ts()}] ❌ 로그인 버튼 클릭 실패: ${clickResult.error}`);
    process.exit(1);
  }

  // 6. 로그인 완료 대기
  console.log(`[${ts()}] 로그인 처리 대기 중 (5초)...`);
  await sleep(5000);

  // 7. 성공 확인 (login.coupang.com에서 벗어났는지)
  const newTabId = findTabId('coupang.com') || tabId;
  const afterState = browserEvaluate(newTabId, `() => ({
    url: location.href,
    hasLoginForm: !!document.querySelector("#login-email-input"),
    hasCaptcha: !!document.querySelector(".login__content--captcha:not([style*=none])") &&
      window.getComputedStyle(document.querySelector(".login__content--captcha")).display !== "none"
  })`);

  console.log(`[${ts()}] 로그인 후 URL: ${afterState.url}`);

  if (afterState.hasCaptcha) {
    console.error(`[${ts()}] ❌ 쿠팡 CAPTCHA 발생 — 수동 로그인 필요`);
    process.exit(1);
  }

  if (afterState.hasLoginForm || afterState.url.includes('login.coupang.com')) {
    console.error(`[${ts()}] ❌ 로그인 실패 — 여전히 로그인 페이지 (ID/PW 확인 필요)`);
    process.exit(1);
  }

  // 8. 성공 시 쿠팡 홈으로 정리
  console.log(`[${ts()}] ✅ 쿠팡 로그인 성공`);
  process.exit(0);
}

main().catch(err => {
  console.error(`[${ts()}] ❌ 예외 발생:`, err.message);
  process.exit(1);
});
