'use strict';

/**
 * browserManager.js — Persistent Playwright Browser Manager
 *
 * 브라우저를 1회 기동 + warming 후 CDP URL을 파일에 저장.
 * 이후 수집 스크립트는 connectOverCDP()로 재사용 → Akamai 봇 판정 방지.
 *
 * playwright-extra는 browser.wsEndpoint()를 노출하지 않으므로
 * --remote-debugging-port 인자로 CDP 엔드포인트를 직접 지정한다.
 *
 * State files (project root, gitignored):
 *   .browser-ws-endpoint  — CDP URL (http://localhost:PORT)
 *   .browser-pid          — 브라우저 오너 Node.js 프로세스 PID
 *   .browser-started-at   — 기동 시각 ISO string
 */

const fs = require('fs');
const net = require('net');
const path = require('path');

const { chromium: playwrightChromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

const cookieStore = require('../services/cookieStore');
const {
  isBlocked,
  sendBlockAlertEmail,
} = require('./blockDetector');
const { setHardBlocked } = require('./blockStateManager');

// 쿠키 유효성 체크 — warming 전에 만료 시 즉시 종료
async function _assertCookieValid() {
  // COUPANG_COOKIE env var로 직접 주입 시 체크 스킵
  const envCookie = process.env.COUPANG_COOKIE;
  if (envCookie && envCookie.trim()) return;

  const data = cookieStore.loadCookieData();
  if (!data) {
    console.error('[BrowserManager] 쿠팡 쿠키가 없습니다.');
    console.error("yamyam 크롬 확장에서 쿠키를 갱신한 후 'npm run coupang:browser:start'를 다시 실행하세요.");
    await sendBlockAlertEmail(null, {
      subject: '[RoughDiamond] Coupang 쿠키 만료',
      text: "쿠팡 쿠키가 없습니다. yamyam 크롬 확장에서 쿠키를 갱신한 후 'npm run coupang:browser:start'를 다시 실행하세요.",
    });
    process.exit(1);
  }

  if (cookieStore.isExpired()) {
    const updatedAt = data.updatedAt ? new Date(data.updatedAt) : null;
    const elapsedH = updatedAt
      ? Math.floor((Date.now() - updatedAt.getTime()) / 3600000)
      : null;
    const elapsedStr = elapsedH != null ? `(수신 후 ${elapsedH}시간 경과)` : '';
    console.error(`[BrowserManager] 쿠키가 만료되었습니다. ${elapsedStr}`);
    console.error("yamyam 크롬 확장에서 쿠키를 갱신한 후 'npm run coupang:browser:start'를 다시 실행하세요.");
    await sendBlockAlertEmail(null, {
      subject: '[RoughDiamond] Coupang 쿠키 만료',
      text: `쿠팡 쿠키가 만료되었습니다. ${elapsedStr} yamyam 크롬 확장에서 쿠키를 갱신한 후 'npm run coupang:browser:start'를 다시 실행하세요.`,
    });
    process.exit(1);
  }

  const updatedAt = data.updatedAt ? new Date(data.updatedAt) : null;
  if (updatedAt) {
    const elapsedMs = Date.now() - updatedAt.getTime();
    const h = Math.floor(elapsedMs / 3600000);
    const m = Math.floor((elapsedMs % 3600000) / 60000);
    console.log(`[BrowserManager] 쿠키 유효 확인 (수신 후 ${h}h ${m}m 경과)`);
  }
}

playwrightChromium.use(StealthPlugin());

// ── CDP 포트 (env 오버라이드 가능) ────────────────────────────────────────────
const CDP_PORT = parseInt(process.env.BROWSER_CDP_PORT || '9222', 10);
const CDP_URL  = `http://localhost:${CDP_PORT}`;

// ── state 파일 경로 ───────────────────────────────────────────────────────────
const ROOT       = path.join(__dirname, '..', '..');
const WS_FILE    = path.join(ROOT, '.browser-ws-endpoint');
const PID_FILE   = path.join(ROOT, '.browser-pid');
const START_FILE = path.join(ROOT, '.browser-started-at');

// ── User-Agent 풀 ─────────────────────────────────────────────────────────────
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ── 쿠키 파싱 ─────────────────────────────────────────────────────────────────
function parseCookieString(cookieStr) {
  if (!cookieStr) return [];
  return cookieStr
    .split(';')
    .map((part) => {
      const eqIdx = part.indexOf('=');
      if (eqIdx === -1) return null;
      const name = part.substring(0, eqIdx).trim();
      const value = part.substring(eqIdx + 1).trim();
      if (!name) return null;
      return { name, value, domain: '.coupang.com', path: '/' };
    })
    .filter(Boolean);
}

// ── state 파일 관리 ───────────────────────────────────────────────────────────
function _writeState(wsEndpoint, pid) {
  fs.writeFileSync(WS_FILE,    wsEndpoint,            'utf8');
  fs.writeFileSync(PID_FILE,   String(pid),           'utf8');
  fs.writeFileSync(START_FILE, new Date().toISOString(), 'utf8');
}

function clearState() {
  [WS_FILE, PID_FILE, START_FILE].forEach((f) => {
    try { fs.unlinkSync(f); } catch (_) {}
  });
}

// ── 내부: warming ─────────────────────────────────────────────────────────────
async function _warmup(context) {
  const page = await context.newPage();
  try {
    console.log('[BrowserManager] warming 방문 중...');
    await page.goto('https://www.coupang.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page
      .waitForFunction(() => document.title.length > 0, { timeout: 45000 })
      .catch(() => {});
    const title = await page.title();
    console.log(`[BrowserManager] warming 완료 (title: ${title})`);
    const html = await page.content();
    return isBlocked(page, html);
  } finally {
    await page.close();
  }
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * launch(options): 브라우저 기동 or 기존 연결
 *
 * state 파일이 있고 WS 연결이 살아있으면 connect() 재사용.
 * 없거나 연결 실패 시 신규 launch + warming.
 *
 * @param {object}  [options]
 * @param {boolean} [options.skipWarming=false]
 * @returns {Promise<import('playwright').Browser>}
 */
async function launch(options = {}) {
  const { skipWarming = false } = options;

  // 기존 브라우저 연결 시도 (CDP)
  if (fs.existsSync(WS_FILE)) {
    const cdpUrl = fs.readFileSync(WS_FILE, 'utf8').trim();
    if (cdpUrl) {
      try {
        console.log('[BrowserManager] 기존 브라우저에 연결 중...');
        const browser = await playwrightChromium.connectOverCDP(cdpUrl);
        console.log('[BrowserManager] 연결 성공 (warming 스킵)');
        return browser;
      } catch (e) {
        console.warn(`[BrowserManager] 연결 실패 (${e.message}), 새 브라우저 기동`);
        clearState();
      }
    }
  }

  // 신규 브라우저 기동 (--remote-debugging-port로 CDP 노출)
  const headless = process.env.PLAYWRIGHT_HEADLESS !== '0';
  console.log('[BrowserManager] 새 브라우저 기동 중...');
  const browser = await playwrightChromium.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1920,1080',
      `--remote-debugging-port=${CDP_PORT}`,
    ],
  });

  if (!skipWarming) {
    await _assertCookieValid();

    const warmCtx = await getContext(browser);
    const blocked = await _warmup(warmCtx);

    if (blocked) {
      console.error('[BrowserManager] 블록 감지 — blockState 기록 후 이메일 발송 후 종료');
      setHardBlocked();
      await sendBlockAlertEmail(null, {
        subject: '[RoughDiamond] Coupang IP 블록 감지',
        text: "IP 블록이 감지되었습니다. 공유기 재시작 후 'npm run coupang:browser:start'를 다시 실행하세요.",
      });
      await warmCtx.close();
      await browser.close();
      process.exit(1);
    }

    await warmCtx.close();
  }

  _writeState(CDP_URL, process.pid);
  console.log('[BrowserManager] 브라우저 준비 완료');
  return browser;
}

/**
 * getContext(browser): 새 BrowserContext 생성 + 쿠키 주입
 *
 * @param {import('playwright').Browser} browser
 * @returns {Promise<import('playwright').BrowserContext>}
 */
async function getContext(browser) {
  const context = await browser.newContext({
    userAgent: randomUA(),
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: { 'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8' },
  });

  // 쿠키 주입
  let cookieStr = process.env.COUPANG_COOKIE;
  if (!cookieStr || !cookieStr.trim()) {
    if (cookieStore.isExpired()) {
      const data = cookieStore.loadCookieData();
      if (data) {
        await context.close();
        throw new Error(`쿠팡 쿠키 만료. yam yam으로 갱신 필요. 만료일: ${data.expiresAt}`);
      }
    } else {
      cookieStr = cookieStore.loadCookies();
    }
  }

  if (cookieStr && cookieStr.trim()) {
    const cookies = parseCookieString(cookieStr);
    if (cookies.length > 0) await context.addCookies(cookies);
  }

  return context;
}

/**
 * close(browser): 브라우저 종료 + state 정리
 * --shutdown 시, 또는 browser:stop 스크립트에서만 호출.
 *
 * @param {import('playwright').Browser} [browser]
 */
async function close(browser) {
  clearState();
  if (browser) await browser.close().catch(() => {});
}

/**
 * isAlive(): TCP 연결 시도로 WS 포트 생존 확인 (browser 종료 없음)
 * @returns {Promise<boolean>}
 */
async function isAlive() {
  if (!fs.existsSync(WS_FILE)) return false;
  const wsEndpoint = fs.readFileSync(WS_FILE, 'utf8').trim();
  if (!wsEndpoint) return false;

  try {
    const url = new URL(wsEndpoint);
    const host = url.hostname;
    const port = parseInt(url.port, 10) || 80;

    return await new Promise((resolve) => {
      const socket = net.connect(port, host, () => {
        socket.destroy();
        resolve(true);
      });
      socket.setTimeout(2000);
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
      socket.on('error', () => resolve(false));
    });
  } catch (_) {
    return false;
  }
}

/**
 * getStats(): state 파일에서 메타 정보 반환
 * @returns {{ pid: number|null, uptimeMs: number|null, wsEndpoint: string }|null}
 */
function getStats() {
  if (!fs.existsSync(WS_FILE)) return null;
  const wsEndpoint = fs.readFileSync(WS_FILE, 'utf8').trim();
  const pid = fs.existsSync(PID_FILE)
    ? parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10)
    : null;
  const startedAt = fs.existsSync(START_FILE)
    ? new Date(fs.readFileSync(START_FILE, 'utf8').trim())
    : null;
  const uptimeMs = startedAt ? Date.now() - startedAt.getTime() : null;
  return { pid, uptimeMs, wsEndpoint };
}

module.exports = { launch, getContext, close, isAlive, getStats, clearState };
