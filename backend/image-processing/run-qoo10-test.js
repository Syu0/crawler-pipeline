/**
 * run-qoo10-test.js — Qoo10이 외부 tunnel URL을 수용하는지 실전 테스트.
 *
 * 절차:
 *   1. 시트에서 registrationStatus=REGISTERED + qoo10ItemId 있는 행을 랜덤 1건 선택
 *   2. 원본 StandardImage URL 기록 (롤백용)
 *   3. IMAGE_TEST_URL (tunnel 이미지 URL)로 StandardImage 교체
 *   4. EditGoodsImage API REAL 호출 (QOO10_ALLOW_REAL_REG=1 필요)
 *   5. 결과 출력 + 롤백 명령 안내
 *
 * 실행:
 *   cd /Users/judy/dev/crawler-pipeline
 *   IMAGE_TEST_URL='https://...trycloudflare.com/images/samples/sample_01_800x800ex_processed.jpg' \
 *   QOO10_ALLOW_REAL_REG=1 \
 *   node backend/image-processing/run-qoo10-test.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { getSheetsClient } = require('../coupang/sheetsClient');
const { editGoodsImage } = require('../qoo10/editGoodsImage');

async function main() {
  const testUrl = process.env.IMAGE_TEST_URL;
  if (!testUrl) throw new Error('IMAGE_TEST_URL env required');
  if (process.env.QOO10_ALLOW_REAL_REG !== '1') {
    console.warn('[test] QOO10_ALLOW_REAL_REG != 1 → DRY-RUN only');
  }

  const sheets = await getSheetsClient();
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const tab = process.env.GOOGLE_SHEET_TAB_NAME || 'coupang_datas';
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tab}!A1:ZZ`,
  });
  const [headers, ...rows] = res.data.values || [];

  const col = {
    status: headers.indexOf('registrationStatus'),
    itemCode: headers.indexOf('qoo10ItemId'),
    stdImg: headers.indexOf('StandardImage'),
    title: headers.indexOf('ItemTitle'),
    vendor: headers.indexOf('vendorItemId'),
  };
  for (const [k, v] of Object.entries(col)) {
    if (v < 0) throw new Error(`column "${k}" not found`);
  }

  // 시트의 registrationStatus='SUCCESS'가 등록 성공. Qoo10 QSM의 'REGISTERED'와 대응.
  const registered = rows.filter(
    r => r[col.status] === 'SUCCESS' && r[col.itemCode] && r[col.stdImg]
  );
  if (registered.length === 0) throw new Error('No SUCCESS rows with qoo10ItemId + StandardImage');

  // Seeded or true random — true random this time
  const picked = registered[Math.floor(Math.random() * registered.length)];
  const itemCode = picked[col.itemCode];
  const vendorItemId = picked[col.vendor];
  const originalUrl = picked[col.stdImg];
  const title = picked[col.title];

  console.log('');
  console.log('=== 테스트 대상 (SUCCESS 중 랜덤 1건) ===');
  console.log(`  vendorItemId:   ${vendorItemId}`);
  console.log(`  qoo10ItemId:    ${itemCode}`);
  console.log(`  title:          ${title}`);
  console.log(`  current image:  ${originalUrl}`);
  console.log('');
  console.log('=== 교체 시도 ===');
  console.log(`  new image:      ${testUrl}`);
  console.log(`  API:            ItemsContents.EditGoodsImage (1.1)`);
  console.log('');

  const result = await editGoodsImage(itemCode, testUrl);

  console.log('=== 결과 ===');
  console.log(`  success:   ${result.success}`);
  console.log(`  message:   ${result.message}`);
  if (result.dryRun) console.log('  (DRY-RUN)');
  console.log('');

  if (result.success && !result.dryRun) {
    console.log('=== 🚨 롤백 정보 (반드시 저장) ===');
    console.log(`  상품:       vendorItemId=${vendorItemId}, qoo10ItemId=${itemCode}`);
    console.log(`  원본 URL:   ${originalUrl}`);
    console.log('');
    console.log('  롤백 명령:');
    console.log(`    cd /Users/judy/dev/crawler-pipeline`);
    console.log(
      `    IMAGE_TEST_URL='${originalUrl}' QOO10_ALLOW_REAL_REG=1 node backend/image-processing/rollback-qoo10-image.js ${itemCode}`
    );
  }

  console.log('');
  console.log('=== Qoo10 QSM 육안 확인 체크포인트 ===');
  console.log(`  1. https://qsm.qoo10.jp 로그인`);
  console.log(`  2. 상품 검색: ItemCode = ${itemCode}`);
  console.log(`  3. 대표 이미지가 교체된 이미지로 표시되는지`);
  console.log(`  4. 상품 상세 페이지 소스에서 이미지 URL이`);
  console.log(`     (a) Qoo10 CDN으로 복사됐는지 (https://.../gd/...) → 안정`);
  console.log(`     (b) tunnel URL (trycloudflare.com) 그대로인지 → tunnel 지속 필요`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
