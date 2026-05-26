'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') });

const fs = require('fs');
const path = require('path');
const os = require('os');

function ts() { return new Date().toLocaleString('sv'); }

const REPORTS_DIR = path.join(os.homedir(), '.openclaw', 'workspace', 'projects', 'crawler-pipeline', 'reports');
const OUTPUT_DIR = path.join(__dirname, '..', 'metrics', 'tactical');

function getDateStr(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toLocaleDateString('sv');
}

function parseReport(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');

  let totalSuccess = 0;
  let totalFailed = 0;
  let lastAutoPercent = null;
  let cumulativeSuccess = null;
  const failedReasons = {};

  // | register | ✅ | SUCCESS 15 / SKIPPED 2 / FAILED 0 |
  const registerRe = /\|\s*register\s*\|[^|]*\|\s*SUCCESS\s+(\d+)[^|]*FAILED\s+(\d+)/gi;
  let m;
  while ((m = registerRe.exec(content)) !== null) {
    totalSuccess += parseInt(m[1]);
    totalFailed += parseInt(m[2]);
  }

  // AUTO 10 / FALLBACK 4 / MANUAL 1 = **AUTO 66.7%**
  const autoMatches = [...content.matchAll(/AUTO\s+(\d+)\s*\/\s*FALLBACK\s+(\d+)\s*\/\s*MANUAL\s+(\d+)/gi)];
  if (autoMatches.length > 0) {
    const last = autoMatches[autoMatches.length - 1];
    const auto = parseInt(last[1]);
    const total = auto + parseInt(last[2]) + parseInt(last[3]);
    if (total > 0) lastAutoPercent = Math.round((auto / total) * 1000) / 10;
  }

  // 누적 SUCCESS**: 157 → **172** (+15)  ← 화살표 뒤 bold 숫자
  const cumMatches = [...content.matchAll(/누적[^\n]*→[^\n]*\*\*(\d+)\*\*/gi)];
  if (cumMatches.length > 0) {
    cumulativeSuccess = parseInt(cumMatches[cumMatches.length - 1][1]);
  }

  // FAILED 사유: [-102] 4건, MultiImage 1건
  for (const r of content.matchAll(/\[(-\d+)\][^(]*?(\d+)건/gi)) {
    const code = r[1];
    failedReasons[code] = (failedReasons[code] || 0) + parseInt(r[2]);
  }
  for (const r of content.matchAll(/MultiImage\s+(\d+)건/gi)) {
    failedReasons['MultiImage'] = (failedReasons['MultiImage'] || 0) + parseInt(r[1]);
  }

  return { totalSuccess, totalFailed, lastAutoPercent, cumulativeSuccess, failedReasons };
}

async function getSheetsData() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    console.warn(`[${ts()}] ⚠ GOOGLE_SHEET_ID 미설정 — Sheets 조회 skip`);
    return { discoveredRemaining: null, maxDailyRegister: null };
  }
  try {
    const { getSheetsClient, getDiscoveredProducts, getConfig } = require('../backend/coupang/sheetsClient');
    const sheets = await getSheetsClient();
    const [discovered, config] = await Promise.all([
      getDiscoveredProducts(sheets, spreadsheetId),
      getConfig(sheets, spreadsheetId),
    ]);
    return {
      discoveredRemaining: discovered.length,
      maxDailyRegister: parseInt(config['MAX_DAILY_REGISTER']) || null,
    };
  } catch (e) {
    console.warn(`[${ts()}] ⚠ Sheets 조회 실패: ${e.message}`);
    return { discoveredRemaining: null, maxDailyRegister: null };
  }
}

async function main() {
  console.log(`[${ts()}] collect-tactical-data 시작`);

  const today = getDateStr(0);

  // 최근 5일 리포트 파싱
  const days = [];
  for (let i = 0; i < 5; i++) {
    const dateStr = getDateStr(i);
    const parsed = parseReport(path.join(REPORTS_DIR, `${dateStr}_daily-qoo10.md`));
    days.push({ date: dateStr, parsed });
  }

  const recent3 = days.slice(0, 3).filter(d => d.parsed);
  const success3dayAvg = recent3.length > 0
    ? Math.round((recent3.reduce((s, d) => s + d.parsed.totalSuccess, 0) / recent3.length) * 10) / 10
    : null;

  const autoPct5day = days.map(d => d.parsed?.lastAutoPercent ?? null);
  const todayParsed = days[0].parsed;
  const latestCumulative = days.find(d => d.parsed?.cumulativeSuccess != null)?.parsed.cumulativeSuccess ?? null;

  const { discoveredRemaining, maxDailyRegister } = await getSheetsData();

  const output = {
    date: today,
    discovered_remaining: discoveredRemaining,
    success_today: todayParsed?.totalSuccess ?? null,
    success_3day_avg: success3dayAvg,
    auto_pct_5day: autoPct5day,
    failed_today: todayParsed?.totalFailed ?? null,
    failed_reasons: todayParsed?.failedReasons ?? {},
    registered_cumulative: latestCumulative,
    max_daily_register_current: maxDailyRegister,
  };

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const outputPath = path.join(OUTPUT_DIR, `${today}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`[${ts()}] ✅ 저장: ${outputPath}`);
  console.log(`[${ts()}] SUCCESS 오늘=${output.success_today} / 3일평균=${output.success_3day_avg} / AUTO%=${output.auto_pct_5day[0]} / DISCOVERED=${output.discovered_remaining}`);
}

main().catch(e => {
  console.error(`[${ts()}] ❌ 오류: ${e.message}`);
  process.exit(1);
});
