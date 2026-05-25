#!/usr/bin/env node
/**
 * brain_logger.js — 파이프라인 일일 실행 결과를 ~/brain/notes/에 저장
 *
 * Google Sheets coupang_datas 탭에서 status별 건수 집계 후
 * ~/brain/notes/YYYY-MM-DD-pipeline-summary.md 로 저장 (덮어쓰기)
 *
 * Usage:
 *   node scripts/brain_logger.js
 *   node scripts/brain_logger.js --event "qoo10:auto-register" --count 12 --ok 10 --fail 2
 *
 * CLI 옵션:
 *   --event  실행한 파이프라인 단계명 (예: "coupang:collect")
 *   --count  처리 건수
 *   --ok     성공 건수
 *   --fail   실패 건수
 *   --note   특이사항 문자열
 */

'use strict';

require('dotenv').config({
  path: require('path').join(__dirname, '..', 'backend', '.env'),
});

const fs = require('fs');
const path = require('path');
const os = require('os');
const { google } = require('googleapis');

function ts() {
  return new Date().toLocaleString('sv');
}

function hhmm() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function todayStr() {
  return new Date().toLocaleDateString('sv');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      result[key] = args[i + 1] ?? true;
      i++;
    }
  }
  return result;
}

async function getStatusCounts() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!keyPath || !sheetId) {
    console.warn(`[${ts()}] ⚠ GOOGLE_SERVICE_ACCOUNT_JSON_PATH 또는 GOOGLE_SHEET_ID 미설정 — 집계 건너뜀`);
    return null;
  }

  const absoluteKeyPath = path.resolve(
    path.join(__dirname, '..', 'backend'),
    keyPath.replace(/^\.\/backend\//, '')
  );

  if (!fs.existsSync(absoluteKeyPath)) {
    console.warn(`[${ts()}] ⚠ 서비스 계정 키 파일 없음: ${absoluteKeyPath}`);
    return null;
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: absoluteKeyPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'coupang_datas!1:1',
  });
  const headers = headerRes.data.values?.[0] ?? [];
  const statusIdx = headers.indexOf('status');

  if (statusIdx === -1) {
    console.warn(`[${ts()}] ⚠ coupang_datas 시트에 status 컬럼 없음`);
    return null;
  }

  const colLetter = String.fromCharCode(65 + statusIdx);
  const dataRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `coupang_datas!${colLetter}2:${colLetter}`,
  });

  const rows = dataRes.data.values ?? [];
  const counts = {};
  for (const row of rows) {
    const s = row[0] || '(empty)';
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return counts;
}

async function main() {
  const opts = parseArgs();

  console.log(`[${ts()}] brain_logger 시작`);

  let counts = null;
  try {
    counts = await getStatusCounts();
  } catch (err) {
    console.warn(`[${ts()}] ⚠ Sheets 집계 실패: ${err.message}`);
  }

  const STATUSES = [
    'DISCOVERED',
    'COLLECTED',
    'PENDING_APPROVAL',
    'REGISTER_READY',
    'REGISTERING',
    'REGISTERED',
    'VALIDATING',
    'LIVE',
    'OUT_OF_STOCK',
    'DEACTIVATED',
    'ERROR',
  ];

  const statusTable = STATUSES.map((s) => {
    const n = counts?.[s] ?? (counts ? 0 : '?');
    return `| ${s} | ${n} |`;
  }).join('\n');

  const errorCount = counts?.['ERROR'] ?? 0;
  const errorSection = errorCount > 0
    ? `- ERROR 상태 ${errorCount}건 존재 — Sheets에서 직접 확인 필요`
    : '(오류 없음)';

  const today = todayStr();
  const nowTime = hhmm();
  const totalCollected = counts?.['COLLECTED'] ?? '?';
  const totalRegistered = counts?.['REGISTERED'] ?? '?';

  const summaryLine = `COLLECTED ${totalCollected}개, REGISTERED ${totalRegistered}개, ERROR ${errorCount}개 — ${today} 실행 결과`;

  const noteDir = path.join(os.homedir(), 'brain', 'notes');
  fs.mkdirSync(noteDir, { recursive: true });
  const notePath = path.join(noteDir, `${today}-pipeline-summary.md`);

  // 기존 파일에서 이력·특이사항 보존
  let existingHistory = '';
  let existingNotes = '';
  if (fs.existsSync(notePath)) {
    const old = fs.readFileSync(notePath, 'utf8');
    const histMarker = '## 오늘 실행 이력\n';
    const notesMarker = '## 특이사항\n';
    const histIdx = old.indexOf(histMarker);
    const notesIdx = old.indexOf(notesMarker);
    if (histIdx !== -1) {
      const end = notesIdx !== -1 ? notesIdx : old.length;
      existingHistory = old.slice(histIdx + histMarker.length, end).trimEnd();
    }
    if (notesIdx !== -1) {
      existingNotes = old.slice(notesIdx + notesMarker.length).trimEnd();
    }
  }

  let newEventLine = '';
  if (opts.event) {
    const ok = opts.ok ?? opts.count ?? '';
    const fail = opts.fail ? ` / ${opts.fail}건 실패` : '';
    newEventLine = `- ${nowTime} — ${opts.event} — ${ok}건 성공${fail}`;
  }

  const historyBlock = [newEventLine, existingHistory].filter(Boolean).join('\n');

  const noteExtra = opts.note ? `- ${opts.note}` : '';
  const notesBlock = [noteExtra, existingNotes].filter(Boolean).join('\n') || '(없음)';

  const content = `---
title: "파이프라인 일일 요약 ${today}"
date: "${today}"
topic: "pipeline-ops"
tags: ["crawler-pipeline", "daily-summary", "pipeline-ops"]
summary: "${summaryLine}"
status: "processed"
projects: ["crawler-pipeline"]
---

## 상태 스냅샷 (${nowTime} KST 기준)

| 상태 | 건수 |
|------|------|
${statusTable}

## 오늘 실행 이력

${historyBlock || '(기록 없음)'}

## 주요 오류

${errorSection}

## 특이사항

${notesBlock}
`;

  fs.writeFileSync(notePath, content, 'utf8');
  console.log(`[${ts()}] ✅ brain 저장 완료: ${notePath}`);
  console.log(`[${ts()}] 요약: ${summaryLine}`);
}

main().catch((err) => {
  console.error(`[${ts()}] ❌ brain_logger 오류:`, err.message);
  process.exit(1);
});
