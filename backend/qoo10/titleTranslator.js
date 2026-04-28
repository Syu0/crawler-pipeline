/**
 * titleTranslator.js
 * 한국어 쿠팡 타이틀 → 일본 Qoo10 SEO 최적화 타이틀 변환
 *
 * 전략 (하이브리드):
 *   1. regex로 브랜드명/숫자/단위 추출 (구조화 메타데이터)
 *   2. Claude API SEO 프롬프트 → 일본어 검색 키워드 중심 타이틀
 *   3. API 실패 시 카테고리 템플릿 fallback
 *
 * 사용:
 *   const { translateTitle } = require('./titleTranslator');
 *   const jpTitle = await translateTitle(krTitle, categoryPath3);
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const MAX_JP_TITLE_LEN = 100; // Qoo10 ItemTitle 최대 길이

// ─── 1. Regex 메타데이터 추출 ──────────────────────────────────────────────

/**
 * 한국어 타이틀에서 구조화 메타데이터를 추출한다.
 * @param {string} title - 원본 한국어 타이틀
 * @returns {{ brand: string|null, numbers: string[], units: string[], raw: string }}
 */
function extractMeta(title) {
  // 브랜드명: 앞부분 영문 대문자 연속 or 대괄호 [ ] 안 값
  const brandMatch =
    title.match(/^\[([^\]]+)\]/) ||   // [브랜드명] 패턴
    title.match(/^([A-Z][A-Z0-9\-]{1,})\s/); // 연속 대문자 영문 (첫 단어)
  const brand = brandMatch ? brandMatch[1].trim() : null;

  // 숫자+단위 (용량, 개수, 무게 등)
  const numberUnitPairs = [];
  const numUnitRe = /(\d+(?:\.\d+)?)\s*(ml|ML|mL|L|g|kg|KG|mg|개|팩|박스|세트|매|장|인분|회분|캡슐|정|포|ea|EA|cm|mm|m|inch|인치|oz|OZ|fl\.?oz)/g;
  let m;
  while ((m = numUnitRe.exec(title)) !== null) {
    numberUnitPairs.push(`${m[1]}${m[2]}`);
  }

  // 순수 숫자 (모델번호 등): 4자리 이상
  const modelNums = [];
  const modelRe = /\b(\d{4,})\b/g;
  while ((m = modelRe.exec(title)) !== null) {
    modelNums.push(m[1]);
  }

  return {
    brand,
    numbers: [...new Set([...numberUnitPairs, ...modelNums])],
    raw: title
  };
}

// ─── 2. 카테고리 템플릿 Fallback ──────────────────────────────────────────

/**
 * 카테고리 경로에서 일본어 SEO 타이틀 prefix를 반환.
 * Claude API 실패 시 사용.
 *
 * @param {string|null} categoryPath - 쿠팡 카테고리 경로 (예: "식품/음료/과자")
 * @param {object} meta - extractMeta() 결과
 * @returns {string} 일본어 타이틀
 */
function buildFallbackTitle(categoryPath, meta) {
  const path = (categoryPath || '').toLowerCase();

  // 카테고리별 일본語 키워드 템플릿
  const templates = [
    { match: ['식품', '음식', '과자', '스낵', '라면', '음료', '주스', '차', '커피', '식품/음료'],
      prefix: '韓国食品' },
    { match: ['뷰티', '화장품', '스킨케어', '마스크팩', '선크림', '로션', '크림'],
      prefix: '韓国コスメ' },
    { match: ['헬스', '건강', '영양제', '비타민', '프로틴', '보충제'],
      prefix: '韓国サプリメント' },
    { match: ['의류', '패션', '옷', '셔츠', '티셔츠', '바지', '원피스', '코트'],
      prefix: '韓国ファッション' },
    { match: ['생활', '주방', '가전', '청소', '인테리어'],
      prefix: '韓国生活用品' },
    { match: ['유아', '아기', '베이비', '어린이', '키즈'],
      prefix: '韓国ベビー用品' },
    { match: ['문구', '사무', '도서', '책'],
      prefix: '韓国文具' },
  ];

  let prefix = '韓国商品'; // 기본
  for (const tpl of templates) {
    if (tpl.match.some(kw => path.includes(kw))) {
      prefix = tpl.prefix;
      break;
    }
  }

  // brand + 숫자단위 붙이기
  const parts = [prefix];
  if (meta.brand) parts.push(meta.brand);
  if (meta.numbers.length > 0) parts.push(meta.numbers.slice(0, 2).join(' '));

  const result = parts.join(' ');
  return result.slice(0, MAX_JP_TITLE_LEN);
}

// ─── 3. LLM API 호출 (Ollama 우선, OpenRouter fallback) ──────────────────

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2000;

// 한국→일본 어휘 매핑 가이드 (모델이 자주 틀리는 케이스)
const KR_JP_GLOSSARY = `
【韓国語→日本語の重要な訳語ルール — 厳守】
- 「김」(海苔・乾海苔) は必ず「海苔」と訳す。絶対に「キムチ」ではない。
- 「김치」(発酵白菜) のみ「キムチ」と訳す。
- 「캔김」「도시락김」「전장김」「조미김」など「〇〇김」は全て「○○ 海苔」(海苔)。
- 「곱창」(腸) は「ホルモン」または「韓国もつ」。
- ブランド名・地名・人名は不要な音訳カタカナを避ける。意味のない長いカタカナ羅列は禁止。
  - 例: 「광천김」→ 「広川海苔」または「韓国海苔」(✗ ガンチェンギム)
  - 例: 「대천김」→ 「大川海苔」(✗ デチョンキム)
  - 例: 「해달음」「마켓오네이처」など固有ブランドは英字や原音そのまま、不必要に伸ばさない
- 数字+単位 (g, ml, 個, 봉, p, 호) は原文そのまま保持
- 韓国独自食品は「韓国○○」prefix を活用 (例: 韓国海苔, 韓国おつまみ, 韓国ごはん)
`;

async function callLLMWithRetry(body) {
  const ollamaBase = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const ollamaModel = process.env.OLLAMA_TITLE_MODEL || 'gemma3:4b';

  // Ollama 시도 (native /api/chat)
  try {
    const messages = [
      {
        role: 'system',
        content:
          'あなたはQoo10 Japan SEOタイトル専門家です。韓国語商品名を日本語の検索キーワード型タイトルに変換します。' +
          'タイトル文字列のみ出力 (説明・記号・引用符不要)。' +
          KR_JP_GLOSSARY,
      },
      ...(body.messages || []),
    ];
    const response = await fetch(`${ollamaBase}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        messages,
        stream: false,
        keep_alive: '10m',           // 모델 unload 방지 → 두번째 호출부터 빠름
        think: false,                // qwen3 thinking 비활성 — 토큰 낭비/지연 방지 (ollama 0.10+)
        options: {
          num_predict: 200,           // title ~30자 + 약간 여유
          temperature: 0.3,           // 일관성 ↑
        },
      }),
      signal: AbortSignal.timeout(240000),  // 12B 모델 첫 로드 시 ~60s 가능, 여유분
    });
    if (response.ok) {
      const d = await response.json();
      // Ollama native 응답 → OpenAI 호환 구조로 변환
      return { choices: [{ message: { content: d.message?.content || '' } }] };
    }
    const errBody = await response.text().catch(() => '');
    console.warn(`[titleTranslator] Ollama ${response.status}: ${errBody.slice(0, 100)}, falling back to OpenRouter`);
  } catch (err) {
    console.warn(`[titleTranslator] Ollama unreachable (${err.message}), falling back to OpenRouter`);
  }

  // OpenRouter fallback
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('Ollama failed and OPENROUTER_API_KEY not set');

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (response.ok) return response.json();

    let errBody = '';
    try { errBody = await response.text(); } catch (_) {}
    const errMsg = `OpenRouter ${response.status} ${response.statusText}: ${errBody.slice(0, 200)}`;

    const isRetryable = response.status === 429 || response.status >= 500;
    if (!isRetryable || attempt === MAX_RETRIES) throw new Error(errMsg);

    const waitMs = RETRY_BASE_MS * Math.pow(2, attempt - 1);
    console.warn(`[titleTranslator] ${errMsg} — retry ${attempt}/${MAX_RETRIES} after ${waitMs}ms`);
    await new Promise(r => setTimeout(r, waitMs));
    lastError = errMsg;
  }
  throw new Error(lastError);
}

/**
 * LLM API로 SEO 최적화 일본어 타이틀 생성.
 */
async function callClaudeForTitle(krTitle, categoryPath, meta) {
  const metaHints = [];
  if (meta.brand) metaHints.push(`ブランド: ${meta.brand}`);
  if (meta.numbers.length > 0) metaHints.push(`数量/容量: ${meta.numbers.join(', ')}`);

  const prompt = `あなたは日本のQoo10マーケットプレイスのSEO専門家です。
韓国語の商品タイトルを、日本語の検索ユーザーが実際に検索するキーワードを中心とした商品タイトルに変換してください。

【ルール】
- 自然な翻訳ではなく、検索キーワード重視の羅列型タイトル
- 最大${MAX_JP_TITLE_LEN}文字
- 英数字・容量・個数はそのまま保持
- 不要な助詞・文末表現は省略
- カテゴリーに合った日本語検索ワードを先頭に
- 出力はタイトル文字列のみ（説明・記号・引用符なし）
${KR_JP_GLOSSARY}
【商品情報】
韓国語タイトル: ${krTitle}
カテゴリー: ${categoryPath || '不明'}
${metaHints.length > 0 ? metaHints.join('\n') : ''}

日本語SEOタイトル:`;

  const data = await callLLMWithRetry({
    model: 'anthropic/claude-haiku-4-5',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = data.choices?.[0]?.message?.content?.trim() || '';
  return raw.replace(/^["「『]|["」』]$/g, '').trim().slice(0, MAX_JP_TITLE_LEN);
}

// ─── 4. Public API ────────────────────────────────────────────────────────

/**
 * 한국어 타이틀을 일본어 SEO 최적화 타이틀로 변환.
 *
 * @param {string} krTitle - 원본 한국어 타이틀
 * @param {string|null} [categoryPath=null] - 쿠팡 카테고리 경로 (예: "식품>음료>주스")
 * @returns {Promise<{ jpTitle: string, method: 'claude'|'fallback', meta: object }>}
 */
async function translateTitle(krTitle, categoryPath = null) {
  if (!krTitle || typeof krTitle !== 'string' || krTitle.trim() === '') {
    throw new Error('translateTitle: krTitle is required');
  }

  const meta = extractMeta(krTitle.trim());

  // LLM API 시도 (Ollama 우선, OpenRouter fallback)
  try {
    const jpTitle = await callClaudeForTitle(krTitle, categoryPath, meta);
    if (jpTitle && jpTitle.length >= 4) {
      return { jpTitle, method: 'api', confidence: 0.8, meta };
    }
  } catch (err) {
    console.warn(`[titleTranslator] Claude API failed (${err.message}), using fallback`);
  }

  // Fallback
  const jpTitle = buildFallbackTitle(categoryPath, meta);
  return { jpTitle, method: 'fallback', confidence: 0.3, meta };
}

/**
 * 일본어 Qoo10 타이틀 → 한국어 상품명 역번역.
 * ItemTitle 컬럼 write-back용 배치 역번역에 사용.
 *
 * @param {string} jpTitle - 일본어 상품명
 * @returns {Promise<string>} 한국어 상품명
 */
async function translateTitleJpToKr(jpTitle) {
  if (!jpTitle || typeof jpTitle !== 'string' || jpTitle.trim() === '') {
    throw new Error('translateTitleJpToKr: jpTitle is required');
  }

  const data = await callLLMWithRetry({
    model: 'anthropic/claude-haiku-4-5',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `다음 일본어 상품명을 한국어로 번역해줘. 상품명만 출력.\n\n${jpTitle.trim()}`,
    }],
  });

  const raw = data.choices?.[0]?.message?.content?.trim() || '';
  return raw.replace(/^["「『]|["」』]$/g, '').trim();
}

module.exports = { translateTitle, translateTitleJpToKr, extractMeta, buildFallbackTitle };
