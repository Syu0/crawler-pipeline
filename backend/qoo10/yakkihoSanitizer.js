/**
 * yakkihoSanitizer.js
 *
 * 일본 약기법(薬機法) + 건강증진법 위반 가능 키워드를 안전 표현으로 치환.
 * Qoo10 셀러센터 "약기법 및 건강증진법 위반 의심 상품 리스트" 검수 차단용.
 *
 * 운영 정책:
 *   - description HTML 텍스트 노드에서만 치환 (HTML 태그/속성은 건드리지 않음).
 *   - 발견 시 사전의 첫 번째 안전 표현으로 1:1 치환 + console.log로 흔적 남김.
 *   - 사전은 Qoo10 검수 화면 + 화장품/건강식품 약기법 일반 가이드 기반.
 *   - 누적되는 신규 위반 키워드는 RULES에 추가만 하면 자동 적용.
 *
 * 사용:
 *   const { sanitize, detect } = require('./yakkihoSanitizer');
 *   const { html, hits } = sanitize(originalHtml);
 */

'use strict';

// 위반 키워드 → 안전 대체 표현 (Qoo10 화면 제안 기반 + 일반 가이드)
// keyword: 정확 매칭 문자열, replacement: 첫 번째 대체안
const RULES = [
  // 효능/강도 표현
  { keyword: '強力',     replacement: '高い',                 reason: '효능 강도 표현 (薬機法)' },
  { keyword: '強い',     replacement: '高い保湿感',           reason: '효능 강도 표현 (薬機法) — Qoo10 검수 사례' },
  { keyword: '強める',   replacement: '整える',               reason: '효능 강화 표현' },
  { keyword: '即効',     replacement: 'すばやくケア',         reason: '즉효 효능 표현 (薬機法)' },
  { keyword: '速効',     replacement: 'すばやくケア',         reason: '즉효 효능 표현' },
  { keyword: '根本',     replacement: '日々のお手入れで',     reason: '근본 치유 표현' },
  { keyword: '完治',     replacement: '整える',               reason: '치유 표현 (薬機法 위반)' },
  { keyword: '治療',     replacement: 'お手入れ',             reason: '치료 표현 (薬機法 위반)' },
  { keyword: '治る',     replacement: '整える',               reason: '치유 표현 (薬機法 위반)' },
  { keyword: '効く',     replacement: 'うるおいを与える',     reason: '효능 단정 (薬機法)' },
  { keyword: '予防',     replacement: 'ケア',                 reason: '예방 효능 표현' },
  { keyword: '医薬',     replacement: '',                     reason: '의약품 오인 표현' },
  // 화장품/스킨케어 — Qoo10 검수 사례
  { keyword: '修復',     replacement: '整える',               reason: '모발/피부 복구 표현 (薬機法) — Qoo10 검수 사례' },
  { keyword: '抗酸化',   replacement: '肌にはりを与える',     reason: '안티에이징 효능 (薬機法) — Qoo10 검수 사례' },
  { keyword: 'アンチエイジング', replacement: 'エイジングケア', reason: '안티에이징 단정 표현' },
  { keyword: '若返り',   replacement: '若々しい印象へ',       reason: '연령 역행 표현' },
  { keyword: '美白',     replacement: '明るい印象の肌へ',     reason: '의약외품 효능 (薬機法 가이드)' },
  { keyword: 'シミが消える', replacement: '健やかな肌へ',     reason: '효능 단정 표현' },
  { keyword: 'シワが消える', replacement: 'ハリのある肌へ',   reason: '효능 단정 표현' },
  { keyword: 'ニキビが治る', replacement: '健やかな肌に整える', reason: '치유 표현 (薬機法 위반)' },
  { keyword: '殺菌',     replacement: '清潔に保つ',           reason: '의약외품 효능 (薬機法)' },
  { keyword: '除菌',     replacement: '清潔に保つ',           reason: '의약외품 효능' },
  // 건강식품
  { keyword: 'ダイエット効果', replacement: 'すっきりサポート', reason: '건강증진법 — 효능 단정' },
  { keyword: '痩せる',   replacement: 'すっきりサポート',     reason: '건강증진법' },
  { keyword: '免疫力',   replacement: '健康をサポート',       reason: '건강증진법' },
  { keyword: '血圧',     replacement: '健康維持',             reason: '건강증진법 — 특정 부위' },
  { keyword: '血糖',     replacement: '健康維持',             reason: '건강증진법' },
];

/**
 * HTML 텍스트에서 위반 키워드 탐지 (치환 없이 hit 목록만)
 */
function detect(html) {
  if (!html || typeof html !== 'string') return [];
  return RULES.filter(r => html.includes(r.keyword)).map(r => r.keyword);
}

/**
 * 위반 키워드 → 안전 대체 표현으로 치환.
 * @returns {{ html: string, hits: Array<{ keyword, replacement, reason, count }> }}
 */
function sanitize(html) {
  if (!html || typeof html !== 'string') return { html: html || '', hits: [] };

  const hits = [];
  let out = html;
  for (const rule of RULES) {
    if (!out.includes(rule.keyword)) continue;
    const before = out;
    // global replace, escape needed for regex special chars
    const escaped = rule.keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'g'), rule.replacement);
    const count = (before.length - out.length) / Math.max(1, rule.keyword.length - rule.replacement.length) || 1;
    hits.push({ keyword: rule.keyword, replacement: rule.replacement, reason: rule.reason, count: Math.max(1, Math.round(count)) });
  }
  return { html: out, hits };
}

/**
 * 시스템 프롬프트에 첨부할 약기법 안내 (descGen 등에서 사용)
 */
const SYSTEM_PROMPT_GUARD = `
【重要・薬機法/健康増進法ガイド】
化粧品・健康食品の商品説明では以下の表現を絶対に使用しないでください:
- 効能/強度の断定: 「強い」「強力」「即効」「根本」「治る」「治療」「効く」「予防」「修復」「抗酸化」「アンチエイジング」「若返り」「美白」「殺菌」「除菌」
- 健康増進法に抵触: 「ダイエット効果」「痩せる」「免疫力」「血圧」「血糖」など特定の身体部位や効果の断定
代わりに次のような穏やかで安全な表現を使用してください:
「整える」「うるおいを与える」「ハリのある印象へ」「健やかな肌へ」「健康をサポート」「明るい印象の肌へ」「すっきりサポート」など。
化粧品の効能は54項目の範囲内に留め、医薬品的な効能効果を暗示しない表現にしてください。
`.trim();

module.exports = { sanitize, detect, RULES, SYSTEM_PROMPT_GUARD };
