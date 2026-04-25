/**
 * rollback-qoo10-image.js — run-qoo10-test.js의 롤백 스크립트.
 *
 * 실행:
 *   cd /Users/judy/dev/crawler-pipeline
 *   IMAGE_TEST_URL='<원본 URL>' QOO10_ALLOW_REAL_REG=1 \
 *   node backend/image-processing/rollback-qoo10-image.js <qoo10ItemId>
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { editGoodsImage } = require('../qoo10/editGoodsImage');

async function main() {
  const itemCode = process.argv[2];
  const restoreUrl = process.env.IMAGE_TEST_URL;
  if (!itemCode) throw new Error('usage: rollback-qoo10-image.js <qoo10ItemId>');
  if (!restoreUrl) throw new Error('IMAGE_TEST_URL env required (원본 URL)');

  console.log(`[rollback] qoo10ItemId=${itemCode}`);
  console.log(`[rollback] restoring to: ${restoreUrl}`);

  const result = await editGoodsImage(itemCode, restoreUrl);
  console.log(`[rollback] success=${result.success}, message=${result.message}`);
}

main().catch(e => { console.error(e); process.exit(1); });
