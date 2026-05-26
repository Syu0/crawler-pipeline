#!/usr/bin/env node
/**
 * auto-login-qsm.js — qsm.qoo10.jp 자동 로그인
 *
 * 이미 로그인된 경우 즉시 exit 0.
 * 로그인 필요 시 .env의 QOO10_USER_ID + QOO10_USER_PW로 폼 자동 입력 후 exit 0.
 * 실패 시 exit 1 (daily-qoo10 Pre-flight에서 수동 fallback 처리).
 *
 * 의존: openclaw browser CLI, CDP 9223 포트 실행 중인 Chrome
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { sendTelegram } = require('../services/telegramNotifier');

function _notifyTelegram(msg) {
  sendTelegram(msg).catch(() => {});
}

function ts() { return new Date().toLocaleString('sv'); }

const QSM_URL = 'https://qsm.qoo10.jp/GMKT.INC.Gsm.Web/Default.aspx';
const LOGIN_URL_PATTERN = 'login.aspx';

const USER_ID = process.env.QOO10_USER_ID;
const USER_PW = process.env.QOO10_USER_PW;

if (!USER_ID || !USER_PW) {
  console.error(`[${ts()}] ❌ QOO10_USER_ID 또는 QOO10_USER_PW가 .env에 없습니다.`);
  process.exit(1);
}

// ── Browser helpers (qoo10-seller-daily.js 패턴 재사용) ──────────────────────

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

function browserNavigate(targetId, url) {
  const escUrl = url.replace(/"/g, '\\"');
  const cmd = targetId
    ? `openclaw browser --browser-profile chrome navigate --target-id ${targetId} "${escUrl}"`
    : `openclaw browser --browser-profile chrome navigate "${escUrl}"`;
  execSync(cmd, { encoding: 'utf8', timeout: 30000 });
}

function browserOpenTab(url) {
  const escUrl = url.replace(/"/g, '\\"');
  const out = execSync(`openclaw browser --browser-profile chrome open "${escUrl}"`, { encoding: 'utf8', timeout: 30000 });
  const m = out.match(/id:\s*([A-F0-9]+)/);
  return m ? m[1] : null;
}

function browserEvaluate(targetId, fn) {
  const escFn = fn.replace(/'/g, "'\\''");
  const cmd = `openclaw browser --browser-profile chrome evaluate --target-id ${targetId} --fn '${escFn}'`;
  const out = execSync(cmd, { encoding: 'utf8', timeout: 30000 });
  return JSON.parse(out);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[${ts()}] qsm 자동 로그인 시작`);

  // 1. qsm 탭 찾기 or 열기
  let tabId = findTabId('qsm.qoo10.jp');
  if (!tabId) {
    console.log(`[${ts()}] qsm 탭 없음 — 새 탭 열기`);
    tabId = browserOpenTab(QSM_URL);
    if (!tabId) {
      console.error(`[${ts()}] ❌ qsm 탭 열기 실패`);
      process.exit(1);
    }
    await sleep(3000);
  } else {
    // 탭이 있으면 Default.aspx로 이동 (로그인 상태라면 그대로 머무름, 로그아웃이면 login.aspx로 리다이렉트)
    console.log(`[${ts()}] 기존 qsm 탭 발견: ${tabId} — 페이지 갱신`);
    browserNavigate(tabId, QSM_URL);
    await sleep(2000);
  }

  // 2. 현재 URL 확인 — login.aspx가 아니면 이미 로그인
  const pageState = browserEvaluate(tabId, '() => ({ url: location.href, hasLoginForm: !!document.querySelector("#txtLoginID") })');
  console.log(`[${ts()}] 현재 URL: ${pageState.url}`);

  if (!pageState.hasLoginForm && !pageState.url.includes(LOGIN_URL_PATTERN)) {
    console.log(`[${ts()}] ✅ 이미 로그인됨 — 완료`);
    process.exit(0);
  }

  console.log(`[${ts()}] 로그인 폼 감지 — 자동 입력 시작`);

  // 3. ID/PW 입력
  const safeId = JSON.stringify(USER_ID);
  const safePw = JSON.stringify(USER_PW);

  const fillResult = browserEvaluate(tabId, `() => {
    const idField = document.querySelector("#txtLoginID");
    const pwField = document.querySelector("#txtLoginPwd");
    if (!idField || !pwField) return { error: "fields_not_found" };
    idField.value = ${safeId};
    idField.dispatchEvent(new Event("input", { bubbles: true }));
    pwField.value = ${safePw};
    pwField.dispatchEvent(new Event("input", { bubbles: true }));
    return { ok: true };
  }`);

  if (fillResult.error) {
    console.error(`[${ts()}] ❌ 폼 필드 입력 실패: ${fillResult.error}`);
    process.exit(1);
  }

  console.log(`[${ts()}] ID/PW 입력 완료 — 로그인 버튼 클릭`);
  await sleep(500);

  // 4. 로그인 버튼 클릭 (reCAPTCHA v3 자동 처리됨 — 실제 Chrome이라 정상 점수)
  const clickResult = browserEvaluate(tabId, `() => {
    const btn = document.querySelector("button.g-recaptcha");
    if (!btn) return { error: "btn_not_found" };
    btn.click();
    return { ok: true };
  }`);

  if (clickResult.error) {
    console.error(`[${ts()}] ❌ 로그인 버튼 클릭 실패: ${clickResult.error}`);
    process.exit(1);
  }

  // 5. 로그인 완료 대기 (reCAPTCHA 토큰 생성 + 폼 제출 + 리다이렉트)
  console.log(`[${ts()}] 로그인 처리 대기 중 (5초)...`);
  await sleep(5000);

  // 새 탭 ID로 갱신 (리다이렉트로 탭 ID 변경될 수 있음)
  const newTabId = findTabId('qsm.qoo10.jp') || tabId;

  // 6. 로그인 결과 확인
  // bframe = reCAPTCHA v2 챌린지 팝업 (anchor = badge/체크박스 — 항상 존재, 무시)
  const afterState = browserEvaluate(newTabId, `() => ({
    url: location.href,
    hasLoginForm: !!document.querySelector("#txtLoginID"),
    hasBframeChallenge: !!document.querySelector("iframe[src*='bframe']")
  })`);

  console.log(`[${ts()}] 로그인 후 URL: ${afterState.url}`);

  if (afterState.hasBframeChallenge) {
    // reCAPTCHA v2 챌린지 발생 — 사용자가 직접 해결해야 함
    console.log(`[${ts()}] ⚠️ reCAPTCHA 챌린지 발생 — Telegram 알림 후 최대 3분 대기`);
    _notifyTelegram('🤖 qsm reCAPTCHA 챌린지 발생\n브라우저에서 체크박스/이미지 선택 해주세요. 해결되면 자동으로 감지합니다 (최대 3분).');

    // 최대 3분(180초)간 10초마다 폴링 + 매 회차 로그인 버튼 재클릭 시도
    // bframe iframe은 챌린지 해결 후에도 DOM에 남아있으므로 존재 여부로 상태 판단 불가
    let solved = false;
    for (let i = 0; i < 18; i++) {
      await sleep(10000);
      try {
        const pollState = browserEvaluate(newTabId, `() => ({
          url: location.href,
          hasLoginForm: !!document.querySelector("#txtLoginID")
        })`);
        if (!pollState.hasLoginForm && !pollState.url.includes(LOGIN_URL_PATTERN)) {
          solved = true;
          break;
        }
        // 아직 로그인 안 됨 — 버튼 클릭 재시도 (reCAPTCHA 해결됐으면 이번에 제출됨)
        try {
          browserEvaluate(newTabId, `() => { const btn = document.querySelector("button.g-recaptcha"); if (btn) btn.click(); return !!btn; }`);
        } catch (_) {}
      } catch (_) {}
      console.log(`[${ts()}] 대기 중 (${(i + 1) * 10}초)...`);
    }

    if (!solved) {
      console.error(`[${ts()}] ❌ reCAPTCHA 3분 내 미해결 — 중단`);
      process.exit(1);
    }

    console.log(`[${ts()}] ✅ reCAPTCHA 해결 확인 — 로그인 성공`);
    process.exit(0);
  }

  if (afterState.hasLoginForm || afterState.url.includes(LOGIN_URL_PATTERN)) {
    console.error(`[${ts()}] ❌ 로그인 실패 — 여전히 로그인 페이지 (ID/PW 또는 reCAPTCHA 확인 필요)`);
    process.exit(1);
  }

  console.log(`[${ts()}] ✅ qsm 로그인 성공`);
  process.exit(0);
}

main().catch(err => {
  console.error(`[${ts()}] ❌ 예외 발생:`, err.message);
  process.exit(1);
});
