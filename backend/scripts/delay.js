'use strict';

/**
 * delay.js — 수집 랜덤 딜레이 유틸리티
 *
 * 수집 스크립트의 상품 간 딜레이에 사용한다.
 * dry-run 모드에서는 500ms 고정.
 */

/**
 * min~max 사이 랜덤 딜레이 (ms)
 * @param {number} minMs
 * @param {number} maxMs
 * @returns {Promise<number>} 실제 대기한 ms
 */
async function randomDelay(minMs, maxMs) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  console.log(`  [딜레이] ${(ms / 1000).toFixed(1)}초 대기...`);
  await new Promise((resolve) => setTimeout(resolve, ms));
  return ms;
}

// 체류시간 시뮬레이션 (ms 단위 대기)
// short=true: 0.5~2초 (페이지 간 이동)
// short=false: 5~35초 (상품 읽는 척)
async function humanPause(short = false) {
  const range = short
    ? [500, 2000]
    : Math.random() < 0.6
      ? [5000, 12000]
      : [15000, 35000];
  await randomDelay(range[0], range[1]);
}

// 스크롤 시뮬레이션 (page 객체 필요)
// 2~5회, 대부분 아래로 가끔 위로, 불규칙 딜레이
async function humanScroll(page) {
  const cycles = Math.floor(Math.random() * 4) + 2; // 2~5회
  for (let i = 0; i < cycles; i++) {
    const down = Math.random() < 0.85; // 85% 아래로
    const delta = Math.floor(Math.random() * 650 + 150) * (down ? 1 : -1);
    await page.mouse.wheel(0, delta);
    await randomDelay(400, 2300);
  }
}

module.exports = { randomDelay, humanPause, humanScroll };
