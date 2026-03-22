#!/usr/bin/env node
'use strict';

/**
 * coupang-browser-start.js — 브라우저 데몬 기동
 *
 * Playwright 브라우저를 기동 + warming 후 WS endpoint를 파일에 저장.
 * 이후 collect/discover 스크립트가 connect()로 재사용.
 *
 * Usage:
 *   npm run coupang:browser:start
 *   node backend/scripts/coupang-browser-start.js [--timeout-minutes N]
 *
 * 종료: Ctrl+C | SIGTERM | npm run coupang:browser:stop | 타임아웃 자동 종료
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const browserManager = require('../coupang/browserManager');
const { getEffectiveBlockState, clearBlockState } = require('../coupang/blockStateManager');

async function main() {
  const timeoutIdx = process.argv.indexOf('--timeout-minutes');
  const timeoutMinutes = timeoutIdx !== -1 ? parseInt(process.argv[timeoutIdx + 1], 10) : 60;

  console.log('='.repeat(50));
  console.log('Coupang Browser Start');
  console.log('='.repeat(50));
  console.log(`자동 종료: ${timeoutMinutes}분 후`);
  console.log('');

  // blockState 확인 — 데몬 시작은 허용, 쿨다운 정보만 출력
  const blockState = getEffectiveBlockState();
  if (blockState.blockState === 'HARD_BLOCKED') {
    const min = Math.ceil(blockState.remainingMs / 60000);
    console.warn(`⚠ [daemon] HARD_BLOCK 쿨다운 중`);
    console.warn(`  수집 재개 가능까지: 약 ${min}분 (${blockState.cooldownUntil})`);
    console.warn(`  데몬은 시작되지만, 쿨다운 전에 collect를 실행하면 즉시 차단됩니다.\n`);
  }

  const browser = await browserManager.launch();
  const stats = browserManager.getStats();

  console.log('');
  console.log('[BrowserStart] 준비 완료.');
  console.log(`  WS endpoint: ${stats?.wsEndpoint}`);
  console.log(`  PID:         ${stats?.pid}`);
  console.log('');
  console.log('이제 collect/discover 스크립트를 실행하면 이 브라우저를 재사용합니다.');
  console.log('종료: Ctrl+C 또는 npm run coupang:browser:stop');

  // 브라우저가 외부에서 종료되면 정리 후 exit
  browser.on('disconnected', () => {
    console.log('\n[BrowserStart] 브라우저 연결 끊김 — 종료');
    browserManager.clearState();
    process.exit(0);
  });

  const cleanup = async () => {
    console.log('\n[BrowserStart] 종료 중...');
    await browserManager.close(browser);
    process.exit(0);
  };

  process.on('SIGINT',  cleanup);
  process.on('SIGTERM', cleanup);

  setTimeout(async () => {
    console.log(`\n[BrowserStart] ${timeoutMinutes}분 경과 → 자동 종료`);
    await cleanup();
  }, timeoutMinutes * 60 * 1000);

  // 프로세스 유지
  await new Promise(() => {});
}

main().catch(async (err) => {
  console.error('[BrowserStart] Error:', err.message);
  browserManager.clearState();
  process.exit(1);
});
