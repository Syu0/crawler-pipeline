#!/usr/bin/env node
'use strict';

/**
 * coupang-browser-status.js — 브라우저 데몬 상태 확인
 *
 * Usage:
 *   npm run coupang:browser:status
 */

const browserManager = require('../coupang/browserManager');

async function main() {
  console.log('[BrowserStatus] 상태 확인 중...');

  const stats = browserManager.getStats();

  if (!stats) {
    console.log('  상태: 없음 (state 파일 없음)');
    process.exit(0);
  }

  const alive = await browserManager.isAlive();
  const uptimeSec = stats.uptimeMs != null ? Math.floor(stats.uptimeMs / 1000) : null;
  const uptimeStr = uptimeSec != null
    ? `${Math.floor(uptimeSec / 60)}분 ${uptimeSec % 60}초`
    : '알 수 없음';

  console.log(`  상태:        ${alive ? '✓ ALIVE' : '✗ DEAD (포트 응답 없음)'}`);
  console.log(`  PID:         ${stats.pid ?? '알 수 없음'}`);
  console.log(`  Uptime:      ${uptimeStr}`);
  console.log(`  WS endpoint: ${stats.wsEndpoint}`);

  if (!alive) {
    console.log('\n  state 파일이 남아있으나 브라우저가 응답하지 않습니다.');
    console.log('  npm run coupang:browser:stop 으로 정리 후 재기동하세요.');
  }
}

main().catch((err) => {
  console.error('[BrowserStatus] Error:', err.message);
  process.exit(1);
});
