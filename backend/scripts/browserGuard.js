'use strict';

/**
 * browserGuard.js — 브라우저 데몬 실행 여부 확인
 *
 * 브라우저를 사용하는 모든 스크립트는 시작 시 assertBrowserRunning()을 호출한다.
 * 데몬이 없으면 exit(1) + 안내 메시지 출력.
 */

const browserManager = require('../coupang/browserManager');

/**
 * 브라우저 데몬이 살아있는지 확인한다.
 * 미실행 상태면 안내 메시지를 출력하고 process.exit(1)로 종료한다.
 */
async function assertBrowserRunning() {
  const alive = await browserManager.isAlive();
  if (!alive) {
    console.error(`
[ERROR] 브라우저 데몬이 실행 중이지 않습니다.
이 명령어를 실행하기 전에 별도 터미널에서 먼저 실행하세요:

  npm run coupang:browser:start

데몬이 ready 상태가 된 후 이 명령어를 다시 실행하세요.
`);
    process.exit(1);
  }
}

module.exports = { assertBrowserRunning };
