/**
 * run-drive-test.js — 처리본 샘플 5건을 Drive에 업로드하여 공개 URL을 검증.
 *
 * 전제: run-sample.js로 backend/image-processing/output/ 에 sample_NN_800x800ex_processed.jpg가 이미 존재.
 *
 * 실행: cd /Users/judy/dev/crawler-pipeline && node backend/image-processing/run-drive-test.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs').promises;
const path = require('path');
const { uploadAndShare, ensureFolder } = require('./driveUploader');

async function main() {
  const outputDir = path.join(__dirname, 'output');
  const files = (await fs.readdir(outputDir))
    .filter(f => f.includes('_processed') && f.endsWith('.jpg'))
    .sort();

  if (files.length === 0) {
    console.error('[drive-test] No processed files. Run run-sample.js first.');
    process.exit(1);
  }

  // 최신 batch만 — 800x800ex 처리본 우선
  const hiRes = files.filter(f => f.includes('_800x800ex_processed'));
  const targets = (hiRes.length > 0 ? hiRes : files).slice(0, 5);

  console.log(`[drive-test] uploading ${targets.length} file(s) to Drive...`);
  const folderId = await ensureFolder();
  console.log(`[drive-test] folder id: ${folderId}`);
  console.log('');

  const results = [];
  for (const f of targets) {
    const local = path.join(outputDir, f);
    try {
      const r = await uploadAndShare(local, f);
      results.push({ file: f, ...r });
      console.log(`  ✓ ${f}`);
      console.log(`      id:        ${r.id}`);
      console.log(`      direct:    ${r.directUrl}`);
      console.log(`      webView:   ${r.webViewLink}`);
    } catch (e) {
      console.error(`  ✗ ${f} — ${e.message}`);
      if (e.message.includes('storageQuotaExceeded')) {
        console.error('    → Service Account는 자체 Drive 스토리지가 없음.');
        console.error('    → 사용자 수동 작업 필요: Drive에 폴더 만들고 SA 이메일 Editor 공유 후 DRIVE_IMAGES_FOLDER_ID env 설정.');
        break;
      }
    }
  }

  console.log('');
  console.log(`[drive-test] done. ${results.length} / ${targets.length} uploaded.`);
  if (results.length > 0) {
    console.log('');
    console.log('=== Qoo10 수용 테스트용 direct URL ===');
    results.forEach(r => console.log(`  ${r.directUrl}`));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
