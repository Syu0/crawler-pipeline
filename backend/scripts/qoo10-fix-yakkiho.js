#!/usr/bin/env node
/**
 * qoo10-fix-yakkiho.js
 *
 * Qoo10 셀러센터 "약기법(薬機法) + 건강증진법 위반 의심" 알림이 떴을 때,
 * 해당 상품의 description을 sanitizer 통과한 새 HTML로 EditContents 호출하여 갱신.
 *
 * 흐름:
 *   1) 인자(--vid 또는 --item)로 시트 행 lookup
 *   2) generateJapaneseDescription(row) — 시스템 프롬프트에 약기법 가이드 + 후처리 sanitize 자동 적용
 *   3) editGoodsContents({ itemCode, htmlContent })
 *
 * 사용:
 *   node backend/scripts/qoo10-fix-yakkiho.js --vid=86469250569,86297592268
 *   node backend/scripts/qoo10-fix-yakkiho.js --item=1203566605,1203611981
 *   node backend/scripts/qoo10-fix-yakkiho.js --vid=86469250569 --dry-run
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { getSheetsClient } = require('../coupang/sheetsClient');
const { generateJapaneseDescription } = require('../qoo10/descriptionGenerator');
const { editGoodsContents } = require('../qoo10/editGoodsContents');
const { detect, sanitize } = require('../qoo10/yakkihoSanitizer');

function ts() { return new Date().toLocaleString('sv'); }

function parseListArg(name) {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  if (!a) return [];
  return a.split('=')[1].split(',').map(s => s.trim()).filter(Boolean);
}

(async () => {
  const vids = parseListArg('vid');
  const items = parseListArg('item');
  const dryRun = process.argv.includes('--dry-run');

  if (vids.length === 0 && items.length === 0) {
    console.error('사용법: --vid=A,B 또는 --item=X,Y');
    process.exit(1);
  }

  const sheets = await getSheetsClient();
  const SHEET_ID = process.env.GOOGLE_SHEET_ID;
  const TAB = process.env.GOOGLE_SHEET_TAB_NAME || 'coupang_datas';

  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TAB}!A1:ZZ` });
  const [headers, ...rows] = res.data.values;
  const colIdx = (name) => headers.indexOf(name);
  const iVid = colIdx('vendorItemId');
  const iQid = colIdx('qoo10ItemId');

  const targets = [];
  for (const r of rows) {
    if ((vids.length && vids.includes(r[iVid])) || (items.length && items.includes(r[iQid]))) {
      const row = {};
      headers.forEach((h, j) => { row[h] = r[j]; });
      targets.push(row);
    }
  }

  if (targets.length === 0) {
    console.error(`[${ts()}] 매칭된 행이 없습니다. 인자: vids=${vids.join(',')} items=${items.join(',')}`);
    process.exit(2);
  }

  console.log(`[${ts()}] [fix-yakkiho] targets=${targets.length}, dryRun=${dryRun}`);

  let okCount = 0, failCount = 0;
  for (const row of targets) {
    const itemCode = row.qoo10ItemId;
    const vid = row.vendorItemId;
    if (!itemCode) {
      console.warn(`[${ts()}] [skip] vid=${vid} qoo10ItemId 없음`);
      failCount++;
      continue;
    }

    console.log(`\n[${ts()}] [fix] itemCode=${itemCode} vid=${vid} title=${(row.ItemTitle || '').slice(0, 40)}`);

    let descResult;
    try {
      descResult = await generateJapaneseDescription(row);
    } catch (err) {
      console.error(`[${ts()}] [fix] descGen ERROR: ${err.message}`);
      failCount++;
      continue;
    }

    if (!descResult.html) {
      console.warn(`[${ts()}] [fix] descGen empty (method=${descResult.method}) — skip itemCode=${itemCode}`);
      failCount++;
      continue;
    }

    const remainingHits = detect(descResult.html);
    if (remainingHits.length > 0) {
      // descGen에서 이미 sanitize 했지만 안전망: 한 번 더 적용
      const re = sanitize(descResult.html);
      descResult.html = re.html;
      console.warn(`[${ts()}] [fix] post-detect re-sanitized: ${remainingHits.join(',')}`);
    }

    if (dryRun) {
      console.log(`[${ts()}] [fix] DRY-RUN length=${descResult.html.length} preview=${descResult.html.slice(0, 120)}...`);
      okCount++;
      continue;
    }

    let edit;
    try {
      edit = await editGoodsContents({ itemCode, htmlContent: descResult.html });
    } catch (err) {
      console.error(`[${ts()}] [fix] EditContents ERROR: ${err.message}`);
      failCount++;
      continue;
    }

    if (edit.success) {
      console.log(`[${ts()}] [fix] ✓ EditContents OK itemCode=${itemCode} (${edit.message})`);
      okCount++;
    } else {
      console.error(`[${ts()}] [fix] ✗ EditContents FAIL itemCode=${itemCode}: ${edit.message}`);
      failCount++;
    }
  }

  console.log(`\n[${ts()}] [fix-yakkiho] done — ok=${okCount} fail=${failCount}`);
})();
