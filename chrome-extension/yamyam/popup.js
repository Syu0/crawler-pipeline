'use strict';

const COOKIE_FILENAME = 'coupang_cookie.txt';

const btn = document.getElementById('send-btn');
const statusEl = document.getElementById('status');
const metaEl = document.getElementById('meta');

chrome.storage.local.get(['lastSavedAt'], (data) => {
  renderMeta(data.lastSavedAt);
});

function renderMeta(lastSavedAt) {
  if (!lastSavedAt) { metaEl.textContent = ''; return; }
  metaEl.textContent = `마지막 저장: ${formatDatetime(lastSavedAt)}\n→ ~/Downloads/${COOKIE_FILENAME}`;
}

btn.addEventListener('click', async () => {
  btn.disabled = true;
  setStatus('🍪 쿠키 수집 중…', '');

  try {
    const cookies = await getCoupangCookies();

    if (cookies.length === 0) {
      setStatus('⚠️ 쿠팡에 로그인 후 눌러주세요', 'warn');
      return;
    }

    const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const blob = new Blob([cookieString], { type: 'text/plain;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);

    const downloadId = await new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: blobUrl,
        filename: COOKIE_FILENAME,
        conflictAction: 'overwrite',
        saveAs: false,
      }, (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(id);
      });
    });
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

    const now = new Date().toISOString();
    chrome.storage.local.set({ lastSavedAt: now });
    setStatus(`✅ 저장 완료 (${cookies.length}개)\n~/Downloads/${COOKIE_FILENAME}`, 'ok');
    renderMeta(now);

  } catch (err) {
    setStatus(`❌ 저장 실패: ${err.message}`, 'err');
  } finally {
    btn.disabled = false;
  }
});

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

function formatDatetime(isoString) {
  return new Date(isoString).toLocaleString('ko-KR', {
    month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
