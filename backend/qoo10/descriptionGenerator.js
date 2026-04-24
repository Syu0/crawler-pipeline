/**
 * descriptionGenerator.js
 * ExtraImages(vision) 또는 텍스트 기반으로 일본어 상품 설명 HTML 생성
 *
 * 우선순위 (2026-04-23 B+C 적용):
 *   vision 경로: Ollama vision → (실패) → 바로 text 경로로 떨어뜨림 (OpenRouter vision 경유 X)
 *   text 경로:   Ollama text(가벼운 모델) → (실패) → OpenRouter text (크레딧 있을 때만 유효)
 *   최종 실패:   { html: '', method: 'skip' }
 *
 * 모델 분리:
 *   - OLLAMA_VISION_MODEL (기본 llama3.2-vision:11b) — 이미지 분석 전용. 무겁고 자주 timeout.
 *   - OLLAMA_TEXT_MODEL   (기본 gemma3:4b)          — text fallback 전용. 빠르고 안정적.
 *
 * 배경:
 *   OpenRouter 카드 결제 오류(2026-04) 이후 vision fallback 루트가 매번 402를 맞고 시간만 낭비.
 *   과거엔 vision 실패 → OpenRouter vision → text fallback 3단계였으나
 *   B안(OpenRouter vision 건너뛰기) + C안(text 모델 분리)을 적용해 2단계로 단축 + 모델 경량화.
 *
 * 사용:
 *   const { generateJapaneseDescription } = require('./descriptionGenerator');
 *   const { html, method } = await generateJapaneseDescription(row);
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const OPENROUTER_MODEL = 'anthropic/claude-haiku-4-5';
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'llama3.2-vision:11b';
const OLLAMA_TEXT_MODEL   = process.env.OLLAMA_TEXT_MODEL   || 'gemma3:4b';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const MAX_IMAGES = 5;

const SYSTEM_PROMPT = `あなたは韓国商品を日本市場向けに紹介するコピーライターです。
商品画像の韓国語テキストを読み取り、日本の消費者向けの商品説明を日本語で生成してください。
出力はHTML形式（<p>タグ使用）で200〜400文字程度にまとめてください。`;

/**
 * ExtraImages JSON string → URL 배열
 */
function parseExtraImages(extraImages) {
  if (!extraImages) return [];
  try {
    if (typeof extraImages === 'string') {
      if (extraImages.startsWith('[')) return JSON.parse(extraImages);
      return extraImages.split('|').map(u => u.trim()).filter(Boolean);
    }
    if (Array.isArray(extraImages)) return extraImages;
  } catch (e) {
    // ignore
  }
  return [];
}

/**
 * // 프로토콜 보정
 */
function normalizeUrl(url) {
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

/**
 * Ollama vision API 호출 (native /api/chat, base64 images 배열)
 */
async function callOllamaVision(textPrompt, base64Images) {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_VISION_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: textPrompt, images: base64Images },
      ],
      stream: false,
    }),
    signal: AbortSignal.timeout(90000), // 이미지 처리 최대 90초
  });
  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`Ollama ${response.status}: ${err.slice(0, 100)}`);
  }
  const d = await response.json();
  return (d.message?.content || '').replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '').trim();
}

/**
 * Ollama 텍스트 API 호출 (OLLAMA_TEXT_MODEL 사용 — vision 모델과 분리)
 */
async function callOllamaText(textPrompt) {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_TEXT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: textPrompt },
      ],
      stream: false,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`Ollama ${response.status}: ${err.slice(0, 100)}`);
  }
  const d = await response.json();
  return (d.message?.content || '').replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '').trim();
}

/**
 * OpenRouter API 호출 (Ollama 실패 시 fallback)
 */
async function callOpenRouter(messages) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set in backend/.env');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OPENROUTER_MODEL, max_tokens: 1024, messages }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`OpenRouter ${response.status}: ${errBody.slice(0, 200)}`);
  }
  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content?.trim() || '';
  return raw.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '').trim();
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB (Anthropic 제한 5MB에 여유 두기)

/**
 * URL의 해상도 파라미터를 400x400ex로 축소
 * e.g. /492x492ex/ → /400x400ex/
 *      /q89/       → /400x400ex/
 */
function downsizeImageUrl(url) {
  return url
    .replace(/\/\d+x\d+[a-z]*\//, '/400x400ex/')
    .replace(/\/q\d+\//, '/400x400ex/');
}

/**
 * 이미지 URL → base64 data URL 변환 (쿠팡 CDN 외부 fetch 차단 우회)
 * /q숫자/ 패턴 URL은 항상 400x400ex로 교체 (고해상도 원본은 수MB 단위)
 * 교체 후에도 4MB 초과 시 null 반환
 */
async function fetchImageAsDataUrl(url) {
  // /q89/ 등 품질 기반 URL은 무조건 크기 축소
  const fetchUrl = downsizeImageUrl(url);

  const res = await fetch(fetchUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.coupang.com/' },
  });
  if (!res.ok) throw new Error(`Image fetch failed: ${res.status} ${fetchUrl}`);
  const buf = await res.arrayBuffer();

  if (buf.byteLength > MAX_IMAGE_BYTES) {
    console.warn(`[descGen] Image too large (${(buf.byteLength / 1024 / 1024).toFixed(1)}MB) — skipping`);
    return null;
  }

  const b64 = Buffer.from(buf).toString('base64');
  const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
  const mimeMap = { png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
  const mime = mimeMap[ext] || 'image/jpeg';
  return `data:${mime};base64,${b64}`;
}

/**
 * vision 방식: Ollama vision만 시도. 실패 시 빈 문자열 반환 → caller가 text fallback.
 *
 * B안 적용 (2026-04-23): OpenRouter vision 경유 제거.
 *   과거엔 Ollama 실패 → OpenRouter vision → text fallback 이었으나,
 *   OpenRouter 카드 결제 오류 이후 vision fallback이 매번 402로 실패하며 시간만 낭비.
 *   Ollama 실패 → 바로 text 경로로 떨어뜨리는 게 훨씬 빠르고 실질적.
 *   OpenRouter vision 재활성화가 필요한 경우는 이 함수 내 분기 복구.
 */
async function generateVision(imageUrls) {
  const urls = imageUrls.slice(0, MAX_IMAGES).map(normalizeUrl);

  const dataUrls = (await Promise.all(
    urls.map(url => fetchImageAsDataUrl(url).catch(err => {
      console.warn(`[descGen] Image download failed (${err.message}) — skipping`);
      return null;
    }))
  )).filter(Boolean);

  if (dataUrls.length === 0) return '';

  const textPrompt = '上記の商品画像をもとに、日本の消費者向けの商品説明をHTML形式で生成してください。';

  // Ollama vision 단 1회 시도 (1장만 — llama3.2-vision은 multi-image 미지원)
  try {
    const base64Images = dataUrls.slice(0, 1).map(d => d.replace(/^data:[^;]+;base64,/, ''));
    return await callOllamaVision(textPrompt, base64Images);
  } catch (err) {
    console.warn(`[descGen] Ollama vision failed (${err.message}), falling through to text path (OpenRouter vision 경유 skip)`);
    return ''; // caller(generateJapaneseDescription)가 text fallback 처리
  }
}

/**
 * 텍스트 방식: Ollama 우선, OpenRouter fallback
 */
async function generateText(itemTitle, itemDescriptionText) {
  const userContent = [
    itemTitle ? `商品名（韓国語）: ${itemTitle}` : '',
    itemDescriptionText ? `商品説明（韓国語）: ${itemDescriptionText.slice(0, 500)}` : '',
  ].filter(Boolean).join('\n\n');

  if (!userContent) return '';

  const prompt = `${userContent}\n\n上記の情報をもとに、日本の消費者向けの商品説明をHTML形式で生成してください。`;

  // Ollama 시도
  try {
    return await callOllamaText(prompt);
  } catch (err) {
    console.warn(`[descGen] Ollama text failed (${err.message}), falling back to OpenRouter`);
  }

  // OpenRouter fallback
  return callOpenRouter([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ]);
}

/**
 * 일본어 상품 설명 생성 메인
 *
 * @param {object} row - { ItemTitle, ItemDescriptionText, ExtraImages, DetailImages }
 * @returns {Promise<{ html: string, method: 'vision'|'text'|'skip' }>}
 */
async function generateJapaneseDescription(row) {
  // DetailImages 우선, 없으면 ExtraImages fallback (기존 수집 상품 호환)
  const detailImages = parseExtraImages(row.DetailImages);
  const extraImages = parseExtraImages(row.ExtraImages);
  const visionImages = detailImages.length > 0 ? detailImages : extraImages;

  try {
    let html = '';
    let method;

    if (visionImages.length > 0) {
      console.log(`[descGen] vision mode — ${Math.min(visionImages.length, MAX_IMAGES)} images (source: ${detailImages.length > 0 ? 'DetailImages' : 'ExtraImages'})`);
      html = await generateVision(visionImages);
      method = 'vision';
    }

    // vision 실패 또는 이미지 없으면 텍스트 모드로 fallback
    if (!html) {
      if (visionImages.length > 0) console.log('[descGen] vision failed, falling back to text mode');
      else console.log('[descGen] text mode');
      html = await generateText(row.ItemTitle, row.ItemDescriptionText);
      method = 'text';
    }

    if (!html) {
      console.warn('[descGen] Empty response — skip');
      return { html: '', method: 'skip' };
    }

    // Append DetailImages as <img> tags after the generated text (fallback: ExtraImages)
    const appendImages = detailImages.length > 0 ? detailImages : extraImages;
    if (appendImages.length > 0) {
      const imgTags = appendImages
        .map(url => `<p><img src="${normalizeUrl(url)}" /></p>`)
        .join('\n');
      html = html + '\n' + imgTags;
    }

    console.log(`[descGen] Generated (${method}): ${html.slice(0, 80)}...`);
    return { html, method };
  } catch (err) {
    console.warn(`[descGen] API error (${err.message}) — skip`);
    return { html: '', method: 'skip' };
  }
}

module.exports = { generateJapaneseDescription };
