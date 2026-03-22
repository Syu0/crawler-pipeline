#!/usr/bin/env node
'use strict';

/**
 * test-email-alert.js — SMTP 이메일 발송 테스트
 *
 * Usage: npm run email:test
 *
 * GMAIL_USER, GMAIL_APP_PASSWORD, NOTIFY_EMAIL 환경변수가 올바르게
 * 설정되어 있는지 확인한다. Gmail 2FA 활성화 시 반드시 App Password(16자리)를 사용해야 한다.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { sendBlockAlertEmail } = require('../coupang/blockDetector');

(async () => {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to   = process.env.NOTIFY_EMAIL || user;

  console.log('[email:test] 환경변수 확인');
  console.log(`  GMAIL_USER:        ${user || '❌ 미설정'}`);
  console.log(`  GMAIL_APP_PASSWORD: ${pass ? '✓ 설정됨 (' + pass.length + '자)' : '❌ 미설정'}`);
  console.log(`  NOTIFY_EMAIL:      ${to || '❌ 미설정'}`);
  console.log('');

  if (!user || !pass) {
    console.error('✗ GMAIL_USER 또는 GMAIL_APP_PASSWORD가 설정되지 않았습니다.');
    console.error('  backend/.env 파일에 다음을 추가하세요:');
    console.error('  GMAIL_USER=youraddress@gmail.com');
    console.error('  GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx  (16자리 앱 비밀번호)');
    console.error('');
    console.error('  Gmail 앱 비밀번호 발급: Google 계정 → 보안 → 2단계 인증 → 앱 비밀번호');
    process.exit(1);
  }

  try {
    await sendBlockAlertEmail(null, {
      subject: '[RoughDiamond] 이메일 발송 테스트',
      text: [
        'SMTP 설정이 정상입니다.',
        '',
        `발송 시각: ${new Date().toISOString()}`,
        `수신 주소: ${to}`,
      ].join('\n'),
    });
    console.log(`✓ 이메일 발송 성공 → ${to}`);
    console.log('  받은 편지함을 확인하세요. (스팸 폴더도 확인)');
  } catch (e) {
    console.error('✗ 이메일 발송 실패:', e.message);
    console.error('');
    console.error('  일반적인 원인:');
    console.error('  - GMAIL_APP_PASSWORD가 일반 비밀번호임 (App Password 필요)');
    console.error('  - Gmail 계정에서 2FA 미활성화');
    console.error('  - 앱 비밀번호에 공백 포함 → 제거 후 재시도');
    process.exit(1);
  }
})();
