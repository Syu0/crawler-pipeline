'use strict';

/**
 * blockStateManager.js — HARD_BLOCK 쿨다운 상태 관리
 *
 * HARD_BLOCK은 IP/세션 레벨 차단이므로 Playwright 프로세스가 살아있어도 수집 불가.
 * daemon alive(running: true) ≠ 수집 가능. collectSafe 값으로만 판단해야 한다.
 *
 * 상태 파일: backend/.browser-block-state.json (gitignored)
 *
 * 상태 구조:
 *   { blockState: 'CLEAR' }
 *   { blockState: 'HARD_BLOCKED', detectedAt: ISO, cooldownUntil: ISO }
 */

const fs   = require('fs');
const path = require('path');

const BLOCK_STATE_FILE = path.join(__dirname, '..', '.browser-block-state.json');
const COOLDOWN_MS      = 60 * 60 * 1000; // 1시간

/**
 * 현재 blockState를 읽는다.
 * 파일 없음 → CLEAR로 간주.
 * @returns {{ blockState: string, cooldownUntil?: string, detectedAt?: string }}
 */
function readBlockState() {
  try {
    if (!fs.existsSync(BLOCK_STATE_FILE)) return { blockState: 'CLEAR' };
    const raw = fs.readFileSync(BLOCK_STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return { blockState: 'CLEAR' };
  }
}

/**
 * blockState를 파일에 기록한다.
 * @param {{ blockState: string, detectedAt?: string, cooldownUntil?: string }} state
 */
function writeBlockState(state) {
  fs.writeFileSync(BLOCK_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * HARD_BLOCK 감지 시 호출. cooldownUntil = 지금 + 1시간.
 */
function setHardBlocked() {
  const now = Date.now();
  writeBlockState({
    blockState:    'HARD_BLOCKED',
    detectedAt:    new Date(now).toISOString(),
    cooldownUntil: new Date(now + COOLDOWN_MS).toISOString(),
  });
}

/**
 * blockState를 CLEAR로 리셋한다.
 */
function clearBlockState() {
  writeBlockState({ blockState: 'CLEAR' });
}

/**
 * blockState를 CLEAR로 초기화 (쿠키 갱신 성공 후 쿨다운 해제용).
 * 이미 CLEAR이면 아무 작업도 하지 않는다 (idempotent).
 */
function clearHardBlock() {
  const state = readBlockState();
  if (state.blockState !== 'CLEAR') {
    writeBlockState({ blockState: 'CLEAR', clearedAt: new Date().toISOString() });
    console.log('[blockStateManager] 쿨다운 해제 — CLEAR 전환');
  }
}

/**
 * 쿨다운이 완료되었으면 자동 CLEAR 후 CLEAR 반환.
 * 아직 쿨다운 중이면 현재 상태 그대로 반환.
 *
 * @returns {{ blockState: string, remainingMs?: number, cooldownUntil?: string }}
 */
function getEffectiveBlockState() {
  const state = readBlockState();
  if (state.blockState !== 'HARD_BLOCKED') return { blockState: 'CLEAR' };

  const remaining = new Date(state.cooldownUntil).getTime() - Date.now();
  if (remaining <= 0) {
    clearBlockState();
    return { blockState: 'CLEAR' };
  }

  return { ...state, remainingMs: remaining };
}

/**
 * collect 스크립트 시작 전 pre-flight 체크.
 * HARD_BLOCK 쿨다운 중이면 에러 출력 후 process.exit(1).
 */
function assertCollectSafe() {
  const state = getEffectiveBlockState();
  if (state.blockState === 'HARD_BLOCKED') {
    const remainingMin = Math.ceil(state.remainingMs / 60000);
    console.error(`✗ [collect] HARD_BLOCK 쿨다운 중 — 재개까지 약 ${remainingMin}분`);
    console.error(`  cooldownUntil: ${state.cooldownUntil}`);
    console.error('  쿨다운 완료 후 자동으로 CLEAR됩니다. 강제 해제는 backend/.browser-block-state.json 삭제.');
    process.exit(1);
  }
}

/**
 * browser-status 출력용 요약 반환.
 * @returns {{ collectSafe: boolean, blockState: string, cooldownUntil?: string, remainingCooldownMin?: number }}
 */
function getStatusSummary() {
  const state = getEffectiveBlockState();
  if (state.blockState === 'CLEAR') {
    return { collectSafe: true, blockState: 'CLEAR' };
  }
  const remainingMin = Math.ceil(state.remainingMs / 60000);
  return {
    collectSafe:          false,
    blockState:           'HARD_BLOCKED',
    cooldownUntil:        state.cooldownUntil,
    remainingCooldownMin: remainingMin,
  };
}

module.exports = {
  readBlockState,
  writeBlockState,
  setHardBlocked,
  clearBlockState,
  clearHardBlock,
  getEffectiveBlockState,
  assertCollectSafe,
  getStatusSummary,
};
