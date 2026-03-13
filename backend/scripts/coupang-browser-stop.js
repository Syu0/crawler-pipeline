#!/usr/bin/env node
'use strict';

/**
 * coupang-browser-stop.js — 브라우저 데몬 종료
 *
 * .browser-pid 파일에서 PID를 읽어 프로세스에 SIGTERM 전송.
 * state 파일 정리.
 *
 * Usage:
 *   npm run coupang:browser:stop
 */

const browserManager = require('../coupang/browserManager');

function main() {
  const stats = browserManager.getStats();

  if (!stats) {
    console.log('[BrowserStop] 실행 중인 브라우저 없음 (state 파일 없음)');
    process.exit(0);
  }

  console.log(`[BrowserStop] PID ${stats.pid} 종료 시도...`);

  if (stats.pid) {
    try {
      process.kill(stats.pid);
      console.log(`[BrowserStop] SIGTERM 전송 완료 (PID: ${stats.pid})`);
    } catch (e) {
      // 프로세스가 이미 없는 경우 무시하고 파일 정리
      if (e.code !== 'ESRCH') {
        console.warn(`[BrowserStop] kill 실패: ${e.message}`);
      } else {
        console.log('[BrowserStop] 프로세스 이미 종료됨, state 파일만 정리');
      }
    }
  }

  browserManager.clearState();
  console.log('[BrowserStop] state 파일 정리 완료');
}

main();
