/**
 * backfill-extraimages.js — 기존 시트의 ExtraImages URL을 800x800ex로 일괄 치환.
 *
 * 2026-04-24 파이프라인 수정으로 신규 수집은 800x800ex로 저장되지만, 기존 66건은
 * 여전히 /492x492ex/로 저장돼있다. 이를 /800x800ex/로 치환한다.
 *
 * DetailImages(/q89/)는 손대지 않는다 — 이미 원본 해상도.
 *
 * 실행:
 *   cd /Users/judy/dev/crawler-pipeline
 *   node backend/image-processing/backfill-extraimages.js          # dry-run
 *   node backend/image-processing/backfill-extraimages.js --apply  # 실제 적용
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { getSheetsClient } = require('../coupang/sheetsClient');

function indexToColumn(idx) {
  let n = idx;
  let s = '';
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function upsizeCell(cell) {
  if (!cell || typeof cell !== 'string') return { cell, changed: 0 };
  const s = cell.trim();
  if (!s) return { cell: s, changed: 0 };

  const pattern = /\/\d+x\d+(?:ex|cr)\//;
  const TARGET = '/800x800ex/';

  // JSON 배열 포맷
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      let changed = 0;
      const updated = parsed.map(u => {
        if (typeof u !== 'string') return u;
        const nu = u.replace(pattern, TARGET);
        if (nu !== u) changed++;
        return nu;
      });
      return { cell: JSON.stringify(updated), changed };
    } catch (_) {
      // fall through to pipe-delimited handling
    }
  }

  // pipe-delimited 또는 단일 URL
  const parts = s.split('|');
  let changed = 0;
  const updated = parts.map(part => {
    const trimmed = part.trim();
    const nu = trimmed.replace(pattern, TARGET);
    if (nu !== trimmed) changed++;
    return nu;
  });
  return { cell: updated.join('|'), changed };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const sheets = await getSheetsClient();
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const tab = process.env.GOOGLE_SHEET_TAB_NAME || 'coupang_datas';
  if (!sheetId) throw new Error('GOOGLE_SHEET_ID not set');

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tab}!A1:ZZ`,
  });
  const values = res.data.values || [];
  if (values.length === 0) throw new Error('Sheet is empty');
  const [headers, ...rows] = values;

  const idx = headers.indexOf('ExtraImages');
  if (idx < 0) throw new Error('ExtraImages column not found');
  const colLetter = indexToColumn(idx);

  console.log(`[backfill] ExtraImages column at index ${idx} (${colLetter})`);
  console.log(`[backfill] total rows: ${rows.length}`);
  console.log(`[backfill] mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log('');

  let changedRows = 0;
  let totalUrls = 0;
  const updates = [];

  for (let i = 0; i < rows.length; i++) {
    const cell = rows[i][idx];
    const { cell: newCell, changed } = upsizeCell(cell);
    if (changed > 0) {
      changedRows++;
      totalUrls += changed;
      const rowNumber = i + 2; // +1 header, +1 1-based
      updates.push({
        range: `${tab}!${colLetter}${rowNumber}`,
        values: [[newCell]],
      });
    }
  }

  console.log(`[backfill] rows with changes:  ${changedRows}`);
  console.log(`[backfill] total URLs upsized: ${totalUrls}`);
  console.log('');

  if (updates.length > 0) {
    console.log(`[backfill] preview (first 3):`);
    updates.slice(0, 3).forEach(u => {
      const preview = u.values[0][0].substring(0, 180);
      console.log(`  ${u.range}`);
      console.log(`    → ${preview}${u.values[0][0].length > 180 ? '…' : ''}`);
    });
    console.log('');
  }

  if (!apply) {
    console.log(`[backfill] DRY-RUN. Re-run with --apply to write.`);
    return;
  }

  if (updates.length === 0) {
    console.log(`[backfill] nothing to update.`);
    return;
  }

  console.log(`[backfill] writing ${updates.length} cells to sheet...`);
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: updates,
    },
  });
  console.log(`[backfill] done.`);
}

main().catch(e => { console.error(e); process.exit(1); });
