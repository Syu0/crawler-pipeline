#!/usr/bin/env node
/**
 * seller-cookie-refresh.js
 *
 * 현재 Chrome 브라우저(포트 9223)의 seller.qoo10.jp 쿠키를
 * sellerCookieStore에 저장한다.
 *
 * 사용:
 *   node backend/scripts/seller-cookie-refresh.js
 *
 * 전제조건:
 *   - Chrome이 실행 중이고 seller.qoo10.jp에 로그인된 탭이 있어야 함
 *   - openclaw gateway 실행 중 (쿠키 추출용, 1회성)
 *
 * 나중에 Playwright 로그인 자동화로 교체 예정 (v2).
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const { saveFromBrowserCookies, loadAuthData } = require('../services/sellerCookieStore');

function ts() { return new Date().toLocaleString('sv'); }

function main() {
  console.log(`[${ts()}] seller-cookie-refresh 시작`);

  // 1. 브라우저에서 전체 쿠키 추출
  let rawCookies;
  try {
    const out = execSync('openclaw browser --browser-profile chrome cookies', {
      encoding: 'utf8',
      timeout: 15000,
    });
    rawCookies = JSON.parse(out);
  } catch (e) {
    console.error(`[${ts()}] ❌ 쿠키 추출 실패:`, e.message.split('\n')[0]);
    console.error('  → Chrome 실행 중인지, openclaw gateway 동작 중인지 확인');
    process.exit(1);
  }

  console.log(`[${ts()}] 전체 쿠키 ${rawCookies.length}개 추출`);

  // 2. seller 관련 쿠키만 저장
  let data;
  try {
    data = saveFromBrowserCookies(rawCookies);
  } catch (e) {
    console.error(`[${ts()}] ❌ 저장 실패:`, e.message);
    console.error('  → seller.qoo10.jp 탭이 열려 있고 로그인 상태인지 확인');
    process.exit(1);
  }

  const expiresAt = new Date(data.expiresAt);
  const now = new Date();
  const hoursLeft = Math.round((expiresAt - now) / 3600000 * 10) / 10;

  console.log(`[${ts()}] ✅ 저장 완료`);
  console.log(`  JWT   : ${data.jwt.substring(0, 40)}...`);
  console.log(`  custNo: ${data.custNo}`);
  console.log(`  만료  : ${expiresAt.toLocaleString('sv')} (${hoursLeft}시간 후)`);

  if (hoursLeft < 2) {
    console.warn(`[${ts()}] ⚠️  만료까지 ${hoursLeft}시간 — 오늘 내로 재갱신 필요`);
  }
}

main();
