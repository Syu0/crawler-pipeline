'use strict';

/**
 * telegramNotifier.js
 * 텔레그램 봇 API로 메시지를 전송한다.
 * 외부 라이브러리 불필요 — Node.js fetch 사용.
 */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

/**
 * 텔레그램으로 메시지를 전송한다.
 * 환경변수 미설정 시 콘솔 경고만 출력하고 조용히 넘어간다.
 * @param {string} text
 * @returns {Promise<void>}
 */
async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID 미설정 — 알림 생략');
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.warn('[telegram] 전송 실패:', res.status, body);
    }
  } catch (err) {
    console.warn('[telegram] 전송 오류:', err.message);
  }
}

module.exports = { sendTelegram };
