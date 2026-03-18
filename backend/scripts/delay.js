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

module.exports = { randomDelay };
