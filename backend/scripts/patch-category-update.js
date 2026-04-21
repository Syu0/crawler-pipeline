#!/usr/bin/env node
/**
 * patch-category-update.js
 *
 * 특정 vendorItemId들의 Qoo10 카테고리를 시트의 jpCategoryIdUsed 값으로 업데이트.
 *
 * - REGISTERED 상품: Qoo10 UpdateGoods API 호출 (SecondSubCat 갱신)
 * - REGISTERING stuck 상품: REGISTER_READY로 리셋 (이후 qoo10:auto-register 실행)
 *
 * 사용법:
 *   node backend/scripts/patch-category-update.js --dry-run
 *   node backend/scripts/patch-category-update.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { getSheetsClient } = require('../coupang/sheetsClient');
const { updateExistingGoods } = require('../qoo10/updateGoods');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB      = process.env.GOOGLE_SHEET_TAB_NAME || 'coupang_datas';
const DRY_RUN  = process.argv.includes('--dry-run');

const TARGET_IDS = new Set([
  '79146586548', // FALLBACK 카테고리 수정
  '86533289904', // FALLBACK 카테고리 수정
]);

function colLetter(index) {
  let letter = '';
  while (index >= 0) {
    letter = String.fromCharCode((index % 26) + 65) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

async function updateSheetCells(sheets, headers, rowNum, updates) {
  const data = Object.entries(updates).map(([field, value]) => {
    const colIndex = headers.indexOf(field);
    if (colIndex === -1) throw new Error(`Header not found: ${field}`);
    return { range: `${TAB}!${colLetter(colIndex)}${rowNum}`, values: [[value]] };
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { valueInputOption: 'RAW', data },
  });
}

async function main() {
  console.log(`[patch-category] DRY_RUN=${DRY_RUN}`);
  console.log(`[patch-category] 대상: ${[...TARGET_IDS].join(', ')}\n`);

  const sheets = await getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A:ZZ`,
  });
  const [headers, ...dataRows] = res.data.values || [];

  const idx = h => headers.indexOf(h);

  let updated = 0, reset = 0, skipped = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row       = dataRows[i];
    const rowNum    = i + 2; // 1-based + header row
    const vid       = row[idx('vendorItemId')] || '';
    const status    = row[idx('status')] || '';

    if (!TARGET_IDS.has(vid)) continue;

    // 행 데이터를 객체로 변환
    const rowData = {};
    headers.forEach((h, ci) => { rowData[h] = row[ci] || ''; });

    // ── REGISTERED: Qoo10 UpdateGoods API 호출 ───────────────────────────
    if (status === 'REGISTERED') {
      const qoo10ItemId = rowData.qoo10ItemId;
      const category    = rowData.jpCategoryIdUsed;

      if (!qoo10ItemId) {
        console.log(`[patch-category] ${vid} (row ${rowNum}): qoo10ItemId 없음 — skip`);
        skipped++;
        continue;
      }
      if (!category) {
        console.log(`[patch-category] ${vid} (row ${rowNum}): jpCategoryIdUsed 없음 — skip`);
        skipped++;
        continue;
      }

      const price = Number(rowData.qoo10SellingPrice);
      if (!price || price <= 0) {
        console.log(`[patch-category] ${vid} (row ${rowNum}): qoo10SellingPrice 없음 — skip`);
        skipped++;
        continue;
      }

      console.log(`[patch-category] REGISTERED ${vid} (row ${rowNum}): qoo10ItemId=${qoo10ItemId} category=${category}`);

      if (!DRY_RUN) {
        const result = await updateExistingGoods(
          { ItemCode: qoo10ItemId, SecondSubCat: category, ItemPrice: String(price) },
          rowData
        );
        if (result.success) {
          console.log(`[patch-category]   ✓ UpdateGoods 성공`);
          updated++;
        } else {
          console.error(`[patch-category]   ✗ UpdateGoods 실패: ${result.resultMsg}`);
          skipped++;
        }
      } else {
        console.log(`[patch-category]   [dry-run] UpdateGoods 호출 예정 (ItemCode=${qoo10ItemId}, SecondSubCat=${category})`);
        updated++;
      }
      continue;
    }

    // ── REGISTERING stuck: REGISTER_READY로 리셋 ────────────────────────
    if (status === 'REGISTERING') {
      console.log(`[patch-category] REGISTERING stuck ${vid} (row ${rowNum}): → REGISTER_READY`);
      if (!DRY_RUN) {
        await updateSheetCells(sheets, headers, rowNum, {
          status:       'REGISTER_READY',
          updatedAt:    new Date().toISOString(),
          errorMessage: '',
        });
        console.log(`[patch-category]   ✓ 시트 업데이트 완료`);
      } else {
        console.log(`[patch-category]   [dry-run] status → REGISTER_READY 예정`);
      }
      reset++;
      continue;
    }

    // 그 외 status (DISCOVERED 등) — 건너뜀
    console.log(`[patch-category] ${vid} (row ${rowNum}): status=${status} — 대상 아님, skip`);
    skipped++;
  }

  console.log('');
  console.log(`[patch-category] 완료 — UpdateGoods: ${updated}개, 리셋: ${reset}개, 건너뜀: ${skipped}개`);
  if (reset > 0 && !DRY_RUN) {
    console.log('\n▶ 다음 단계: npm run qoo10:auto-register');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
