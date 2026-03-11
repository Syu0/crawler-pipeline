'use strict';

const DEFAULT_SERVER = 'http://localhost:4000';

const btn = document.getElementById('send-btn');
const statusEl = document.getElementById('status');
const metaEl = document.getElementById('meta');
const urlInput = document.getElementById('server-url');
const saveUrlBtn = document.getElementById('save-url-btn');

// ── 초기화 ───────────────────────────────────────────────────────────────────
chrome.storage.local.get(['serverUrl', 'lastSentAt', 'expiresAt'], (data) => {
  urlInput.value = data.serverUrl || DEFAULT_SERVER;
  renderMeta(data.lastSentAt, data.expiresAt);
});

function renderMeta(lastSentAt, expiresAt) {
  const parts = [];
  if (lastSentAt) {
    parts.push(`마지막 전송: ${formatDatetime(lastSentAt)}`);
  }
  if (expiresAt) {
    const days = daysUntil(expiresAt);
    parts.push(`만료까지 D-${days > 0 ? days : 0}일 (${formatDate(expiresAt)})`);
  }
  metaEl.textContent = parts.join('\n');
}

// ── 서버 URL 저장 ─────────────────────────────────────────────────────────────
saveUrlBtn.addEventListener('click', () => {
  const url = urlInput.value.trim();
  chrome.storage.local.set({ serverUrl: url }, () => {
    setStatus('✅ 서버 URL 저장됨', 'ok');
  });
});

// ── yam yam 버튼 ─────────────────────────────────────────────────────────────
btn.addEventListener('click', async () => {
  btn.disabled = true;
  setStatus('🍪 쿠키 수집 중…', '');

  try {
    // 1. 쿠팡 쿠키 수집
    const cookies = await getCoupangCookies();

    if (cookies.length === 0) {
      setStatus('⚠️ 쿠팡에 로그인 후 눌러주세요', 'warn');
      return;
    }

    // 2. "key=value; ..." 문자열로 변환
    const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    // 3. 서버 전송
    const serverUrl = urlInput.value.trim() || DEFAULT_SERVER;
    const res = await fetch(`${serverUrl}/api/cookie/coupang`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookies: cookieString, updatedAt: new Date().toISOString() }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`서버 오류 ${res.status}: ${text}`);
    }

    const json = await res.json();
    const now = new Date().toISOString();

    // 4. 결과 저장 및 표시
    chrome.storage.local.set({ lastSentAt: now, expiresAt: json.expiresAt });
    setStatus(`✅ 신선한 쿠키 전송 완료!\n(${cookies.length}개)`, 'ok');
    renderMeta(now, json.expiresAt);

  } catch (err) {
    setStatus(`❌ 전송 실패: ${err.message}`, 'err');
  } finally {
    btn.disabled = false;
  }
});

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────
function getCoupangCookies() {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain: '.coupang.com' }, (cookies) => {
      resolve(cookies || []);
    });
  });
}

function setStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = cls;
}

function daysUntil(isoString) {
  const diff = new Date(isoString) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('ko-KR');
}

function formatDatetime(isoString) {
  return new Date(isoString).toLocaleString('ko-KR', {
    month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
