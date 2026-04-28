/**
 * batch-retranslate-titles.js — title-rework-input.json의 51건 KR title을 gemma3:12b로 일괄 일본어 번역.
 *
 * 출력:
 *   - title-rework-output.json : { itemCode, krTitle, currentJpTitle, newJpTitle, method, dt }
 *
 * 실행:
 *   cd /Users/judy/dev/crawler-pipeline
 *   OLLAMA_TITLE_MODEL=gemma3:12b node backend/image-processing/batch-retranslate-titles.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { translateTitle } = require('../qoo10/titleTranslator');

const INPUT = path.join(__dirname, 'title-rework-input.json');
const OUTPUT = path.join(__dirname, 'title-rework-output.json');

(async () => {
  const items = JSON.parse(fs.readFileSync(INPUT, 'utf-8'));
  console.log(`[batch] translating ${items.length} titles with model=${process.env.OLLAMA_TITLE_MODEL || 'gemma3:4b'}`);
  console.log('');

  const results = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const t0 = Date.now();
    try {
      const r = await translateTitle(it.krTitle, it.coupangCategoryPath || null);
      const dt = Number(((Date.now() - t0) / 1000).toFixed(1));
      results.push({
        ...it,
        newJpTitle: r.jpTitle,
        method: r.method,
        dt,
      });
      console.log(`[${String(i + 1).padStart(2, '0')}/${items.length}] ${it.itemCode} ${r.method.padEnd(8)} ${dt}s  ${r.jpTitle}`);
    } catch (e) {
      results.push({ ...it, newJpTitle: null, error: e.message });
      console.error(`[${String(i + 1).padStart(2, '0')}/${items.length}] ${it.itemCode} FAIL: ${e.message}`);
    }
  }

  fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));
  console.log('');
  console.log(`[batch] saved ${OUTPUT}`);

  const okCount = results.filter(r => r.method === 'api').length;
  const fallbackCount = results.filter(r => r.method === 'fallback').length;
  const failCount = results.filter(r => r.error).length;
  console.log(`[batch] api=${okCount}  fallback=${fallbackCount}  fail=${failCount}`);
})().catch(e => { console.error(e); process.exit(1); });
