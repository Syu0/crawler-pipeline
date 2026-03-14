'use strict';

/**
 * stockChecker.js — 쿠팡 상품 상세 페이지 품절 여부 판별
 *
 * Playwright로 상품 페이지를 열어 DOM 파싱으로 품절 판단.
 * quantity-info 엔드포인트 직접 호출은 Akamai 차단됨 — 사용 금지.
 *
 * @param {string} productUrl
 * @param {import('playwright').BrowserContext} [externalContext] - 외부 컨텍스트 (배치용). 없으면 브라우저 자체 생성.
 * @returns {Promise<{ available: boolean, reason: string | null }>}
 */

const browserManager = require('./browserManager');
const { isBlocked } = require('./blockDetector');

const SOLDOUT_SELECTORS = [
  '[class*="soldout"]',
  '[class*="sold-out"]',
  'button[disabled][class*="buy"]',
  '.prod-buy-btn__btn--soldout',
];

const SOLDOUT_TEXTS = ['일시품절', '판매종료', '품절'];

async function checkStock(productUrl, externalContext = null) {
  let browser = null;
  let context = externalContext;

  if (!context) {
    browser = await browserManager.launch({ skipWarming: true });
    context = await browserManager.getContext(browser);
  }

  const page = await context.newPage();
  try {
    await page.goto(productUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    const html = await page.content().catch(() => '');

    if (isBlocked(page, html)) {
      throw new Error('BLOCK_DETECTED');
    }

    // 셀렉터 기반 체크 (첫 매칭에서 즉시 반환)
    for (const selector of SOLDOUT_SELECTORS) {
      const el = await page.$(selector).catch(() => null);
      if (el) {
        return { available: false, reason: `selector:${selector}` };
      }
    }

    // 텍스트 기반 체크
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    for (const text of SOLDOUT_TEXTS) {
      if (bodyText.includes(text)) {
        return { available: false, reason: `text:${text}` };
      }
    }

    return { available: true, reason: null };
  } finally {
    await page.close();
    if (browser) await browser.close();
  }
}

module.exports = { checkStock };
