/**
 * descriptionGenerator.js
 * ExtraImages(vision) 또는 텍스트 기반으로 일본어 상품 설명 HTML 생성
 *
 * 우선순위:
 *   1. ExtraImages 있으면 → OpenRouter vision (최대 5장)
 *   2. ExtraImages 없으면 → ItemTitle + ItemDescriptionText 텍스트 기반
 *   3. API 실패 → { html: '', method: 'skip' }
 *
 * 사용:
 *   const { generateJapaneseDescription } = require('./descriptionGenerator');
 *   const { html, method } = await generateJapaneseDescription(row);
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const MODEL = 'anthropic/claude-haiku-4-5';
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
 * OpenRouter API 호출 (vision 또는 텍스트)
 */
async function callOpenRouter(messages) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set in backend/.env');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content?.trim() || '';
  // 마크다운 코드펜스 제거 (```html ... ``` 또는 ``` ... ```)
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
 * vision 방식: 이미지를 base64로 다운로드 후 image_url 블록으로 전달
 * (쿠팡 CDN은 OpenRouter 서버의 직접 fetch를 차단하므로 로컬에서 다운로드 필요)
 */
async function generateVision(imageUrls) {
  const urls = imageUrls.slice(0, MAX_IMAGES).map(normalizeUrl);

  // 병렬 다운로드 (실패한 이미지는 건너뜀)
  const dataUrls = (await Promise.all(
    urls.map(url => fetchImageAsDataUrl(url).catch(err => {
      console.warn(`[descGen] Image download failed (${err.message}) — skipping`);
      return null;
    }))
  )).filter(Boolean);

  if (dataUrls.length === 0) return '';

  const imageBlocks = dataUrls.map(dataUrl => ({
    type: 'image_url',
    image_url: { url: dataUrl },
  }));

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        ...imageBlocks,
        { type: 'text', text: '上記の商品画像をもとに、日本の消費者向けの商品説明をHTML形式で生成してください。' },
      ],
    },
  ];

  return callOpenRouter(messages);
}

/**
 * 텍스트 방식: ItemTitle + ItemDescriptionText 기반
 */
async function generateText(itemTitle, itemDescriptionText) {
  const userContent = [
    itemTitle ? `商品名（韓国語）: ${itemTitle}` : '',
    itemDescriptionText ? `商品説明（韓国語）: ${itemDescriptionText.slice(0, 500)}` : '',
  ].filter(Boolean).join('\n\n');

  if (!userContent) return '';

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${userContent}\n\n上記の情報をもとに、日本の消費者向けの商品説明をHTML形式で生成してください。`,
    },
  ];

  return callOpenRouter(messages);
}

/**
 * 일본어 상품 설명 생성 메인
 *
 * @param {object} row - { ItemTitle, ItemDescriptionText, ExtraImages }
 * @returns {Promise<{ html: string, method: 'vision'|'text'|'skip' }>}
 */
async function generateJapaneseDescription(row) {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('[descGen] OPENROUTER_API_KEY not set — skip');
    return { html: '', method: 'skip' };
  }

  const extraImages = parseExtraImages(row.ExtraImages);

  try {
    let html = '';
    let method;

    if (extraImages.length > 0) {
      console.log(`[descGen] vision mode — ${Math.min(extraImages.length, MAX_IMAGES)} images`);
      html = await generateVision(extraImages);
      method = 'vision';
    } else {
      console.log('[descGen] text mode');
      html = await generateText(row.ItemTitle, row.ItemDescriptionText);
      method = 'text';
    }

    if (!html) {
      console.warn('[descGen] Empty response — skip');
      return { html: '', method: 'skip' };
    }

    // Append ExtraImages as <img> tags after the generated text
    if (extraImages.length > 0) {
      const imgTags = extraImages
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
