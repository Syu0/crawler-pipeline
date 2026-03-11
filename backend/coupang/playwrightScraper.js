/**
 * Coupang Playwright Scraper
 *
 * 서버사이드에서 Playwright(Chromium) + Stealth 플러그인으로 쿠팡 상품 데이터를 수집한다.
 *
 * 인증 전략 (우선순위 순):
 *   1. COUPANG_COOKIE — 브라우저에서 복사한 쿠키 문자열을 context에 직접 주입
 *   2. COUPANG_ID + COUPANG_PW — 자동 로그인
 *   3. 비인증 — Stealth만으로 시도 (차단될 수 있음)
 *
 * 환경변수:
 *   COUPANG_COOKIE          - Chrome DevTools에서 복사한 cookie 헤더 값
 *   COUPANG_ID              - 쿠팡 로그인 ID
 *   COUPANG_PW              - 쿠팡 비밀번호
 *   COUPANG_TRACER=1        - 상세 로그
 *   PLAYWRIGHT_HEADLESS=0   - 브라우저 창 표시 (디버그)
 */

'use strict';

const { chromium: playwrightChromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cookieStore = require('../services/cookieStore');

playwrightChromium.use(StealthPlugin());

const TRACE = process.env.COUPANG_TRACER === '1';

function trace(...args) {
  if (TRACE) console.log('[TRACER]', ...args);
}

// ---------------------------------------------------------------------------
// URL parser
// ---------------------------------------------------------------------------
function parseProductUrl(urlString) {
  const { URL } = require('url');
  const url = new URL(urlString);
  const pathMatch = url.pathname.match(/\/vp\/products\/(\d+)/);
  return {
    sourceUrl: urlString,
    coupangProductId: pathMatch ? pathMatch[1] : null,
    itemId: url.searchParams.get('itemId') || null,
    vendorItemId: url.searchParams.get('vendorItemId') || null,
    coupangCategoryId: url.searchParams.get('categoryId') || null,
  };
}

function normalizeImageUrl(url) {
  if (!url) return '';
  if (url.startsWith('//')) url = 'https:' + url;
  const idx = url.indexOf('thumbnails/');
  if (idx !== -1) return url.substring(idx);
  const imgIdx = url.indexOf('image/');
  if (imgIdx !== -1) return url.substring(imgIdx);
  return url;
}

// ---------------------------------------------------------------------------
// 쿠키 문자열 파서 (Cookie 헤더 형식 → playwright addCookies 형식)
// ---------------------------------------------------------------------------
function parseCookieString(cookieStr) {
  if (!cookieStr) return [];
  return cookieStr
    .split(';')
    .map((part) => {
      const eqIdx = part.indexOf('=');
      if (eqIdx === -1) return null;
      const name = part.substring(0, eqIdx).trim();
      const value = part.substring(eqIdx + 1).trim();
      if (!name) return null;
      return { name, value, domain: '.coupang.com', path: '/' };
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// 브라우저 팩토리
// ---------------------------------------------------------------------------
async function launchBrowser() {
  const headless = process.env.PLAYWRIGHT_HEADLESS !== '0';
  trace(`Launching Chromium + Stealth (headless=${headless})`);

  const browser = await playwrightChromium.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1280,900',
    ],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: {
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
    },
  });

  return { browser, context };
}

// ---------------------------------------------------------------------------
// 인증 전략 1: 쿠키 직접 주입
// 우선순위: process.env.COUPANG_COOKIE > cookieStore 파일
// ---------------------------------------------------------------------------
async function injectCookiesIfSet(context) {
  // 1순위: .env의 COUPANG_COOKIE
  let cookieStr = process.env.COUPANG_COOKIE;

  // 2순위: cookieStore 파일 (yam yam 확장이 저장한 쿠키)
  if (!cookieStr || !cookieStr.trim()) {
    if (cookieStore.isExpired()) {
      const data = cookieStore.loadCookieData();
      if (data) {
        // 파일은 있지만 만료됨
        throw new Error(
          '쿠팡 쿠키가 만료되었습니다. yam yam 버튼을 눌러 갱신해주세요.\n' +
            `만료일: ${data.expiresAt}`
        );
      }
      return false; // 파일 자체가 없음 — ID/PW 로그인으로 폴백
    }
    cookieStr = cookieStore.loadCookies();
    if (cookieStr) {
      trace(`cookieStore에서 쿠키 로드 (${cookieStore.daysUntilExpiry()}일 남음)`);
    }
  }

  if (!cookieStr || !cookieStr.trim()) return false;

  const cookies = parseCookieString(cookieStr);
  if (cookies.length === 0) return false;

  trace(`Injecting ${cookies.length} cookies from COUPANG_COOKIE`);
  await context.addCookies(cookies);
  return true;
}

// ---------------------------------------------------------------------------
// 인증 전략 2: ID/PW 자동 로그인
// ---------------------------------------------------------------------------
async function loginWithCredentials(context) {
  const id = process.env.COUPANG_ID;
  const pw = process.env.COUPANG_PW;
  if (!id || !pw) return false;

  trace(`Attempting login as ${id}`);
  const page = await context.newPage();
  try {
    await page.goto('https://login.coupang.com/login/login.pang', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // 로그인 폼 셀렉터 (여러 패턴 시도)
    const emailSelectors = [
      '#login-email-input',
      'input[name="email"]',
      'input[type="email"]',
      'input[id*="email"]',
      'input[id*="id"]',
      'input[placeholder*="이메일"]',
      'input[placeholder*="아이디"]',
    ];
    const pwSelectors = [
      '#login-password-input',
      'input[name="password"]',
      'input[type="password"]',
      'input[id*="password"]',
      'input[id*="pw"]',
    ];

    let emailFilled = false;
    for (const sel of emailSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.fill(id);
        emailFilled = true;
        trace(`Filled email with selector: ${sel}`);
        break;
      }
    }

    let pwFilled = false;
    for (const sel of pwSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.fill(pw);
        pwFilled = true;
        trace(`Filled password with selector: ${sel}`);
        break;
      }
    }

    if (!emailFilled || !pwFilled) {
      trace('Login form selectors not found — skipping login');
      return false;
    }

    // 제출
    const submitSelectors = [
      '.login__button--submit',
      'button[type="submit"]',
      'input[type="submit"]',
    ];
    for (const sel of submitSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        trace(`Clicked submit: ${sel}`);
        break;
      }
    }

    await page.waitForURL('https://www.coupang.com/**', { timeout: 15000 }).catch(() =>
      trace('Login redirect timeout — may still be OK')
    );

    trace('Login step completed');
    return true;
  } catch (err) {
    trace(`Login failed: ${err.message}`);
    return false;
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// 상품 페이지 스크래핑
// ---------------------------------------------------------------------------
async function scrapePage(context, productUrl) {
  const page = await context.newPage();

  try {
    trace(`Navigating to ${productUrl}`);
    const response = await page.goto(productUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    const status = response ? response.status() : null;
    trace(`Page status: ${status}`);

    if (status === 403 || status === 429) {
      throw new Error(
        `Coupang returned ${status}.\n` +
          'COUPANG_COOKIE 또는 COUPANG_ID/COUPANG_PW를 backend/.env에 설정하세요.'
      );
    }

    // Akamai JS 챌린지 해소 대기
    trace('Waiting for Akamai JS challenge (networkidle)...');
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() =>
      trace('networkidle timeout — proceeding')
    );

    // 챌린지 페이지 감지
    const pageTitle = await page.title().catch(() => '');
    trace(`Page title: ${pageTitle}`);

    if (
      pageTitle.toLowerCase().includes('access denied') ||
      pageTitle.toLowerCase().includes('denied')
    ) {
      throw new Error(
        'Akamai 봇 탐지 우회 실패 — "Access Denied" 페이지.\n' +
          '해결 방법:\n' +
          '  1. Chrome에서 쿠팡 로그인 후 DevTools→Network→cookie 헤더 복사\n' +
          '     → backend/.env: COUPANG_COOKIE=<붙여넣기>\n' +
          '  2. PLAYWRIGHT_HEADLESS=0 (npm run coupang:pw:dry:headed) 으로 실행 확인'
      );
    }

    // 상품 타이틀 요소 대기 (Akamai 챌린지가 아닌 실제 상품 페이지)
    await page.waitForSelector(
      '.prod-buy-header__title, [class*="productTitle"]',
      { timeout: 15000 }
    ).catch(() => trace('Product title selector timeout — extracting anyway'));

    // ── 타이틀 ──────────────────────────────────────────────────────────────
    const itemTitle = await page.evaluate(() => {
      const selectors = [
        '.prod-buy-header__title',
        '[class*="productTitle"]',
        'h1.prod-title',
        'h1',
      ];
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el && el.innerText.trim()) return el.innerText.trim();
      }
      const og = document.querySelector('meta[property="og:title"]');
      return og ? og.content.trim() : '';
    }).catch(() => '');

    trace(`Title: ${itemTitle.substring(0, 60)}`);

    // itemTitle 기반 챌린지 감지 (headed 모드에서 <title>이 정상이어도 body가 챌린지인 경우)
    if (itemTitle.toLowerCase() === 'access denied' || itemTitle === '') {
      throw new Error(
        'Akamai 봇 탐지 우회 실패 — 상품 데이터를 가져오지 못했습니다.\n' +
          '해결 방법:\n' +
          '  1. Chrome에서 쿠팡 로그인 후 DevTools→Network→cookie 헤더 복사\n' +
          '     → backend/.env: COUPANG_COOKIE=<붙여넣기>\n' +
          '  2. 재실행: npm run coupang:pw:dry:trace'
      );
    }

    // ── 가격 ──────────────────────────────────────────────────────────────
    const itemPrice = await page.evaluate(() => {
      const selectors = [
        '.total-price strong',
        '.prod-sale-price .value',
        '[class*="salePrice"]',
        '[class*="totalPrice"]',
      ];
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el && el.innerText.trim()) {
          return el.innerText.replace(/[^0-9]/g, '');
        }
      }
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of scripts) {
        try {
          const data = JSON.parse(s.textContent);
          if (data.offers && data.offers.price) return String(data.offers.price);
        } catch (_) {}
      }
      return '';
    }).catch(() => '');

    trace(`Price: ${itemPrice}`);

    // ── 대표 이미지 ──────────────────────────────────────────────────────────
    const standardImageRaw = await page.evaluate(() => {
      const og = document.querySelector('meta[property="og:image"]');
      if (og && og.content) return og.content;
      const img = document.querySelector(
        '.prod-image__detail img, #repImageContainer img, .prod-cover img'
      );
      return img ? img.src || img.dataset.src || '' : '';
    }).catch(() => '');

    const standardImage = normalizeImageUrl(standardImageRaw);
    trace(`Main image: ${standardImage.substring(0, 80)}`);

    // ── 추가 이미지 ──────────────────────────────────────────────────────────
    const extraImagesRaw = await page.evaluate(() => {
      const imgs = [];
      document.querySelectorAll('.prod-image-list img, .thumb-list img').forEach((el) => {
        const src = el.src || el.dataset.src || '';
        if (src) imgs.push(src);
      });
      return imgs.slice(0, 5);
    }).catch(() => []);

    const seen = new Set();
    if (standardImage) seen.add(standardImage);
    const extraImages = extraImagesRaw
      .map(normalizeImageUrl)
      .filter((u) => u && !seen.has(u) && seen.add(u));

    trace(`Extra images: ${extraImages.length}`);

    // ── 상품 설명 ────────────────────────────────────────────────────────────
    const itemDescriptionText = await page.evaluate(() => {
      const el = document.querySelector(
        '#productDetail, .product-description, [id*="detail"], [class*="productDetail"]'
      );
      if (!el) return '';
      return el.innerText.replace(/\s+/g, ' ').trim().substring(0, 5000);
    }).catch(() => '');

    trace(`Description length: ${itemDescriptionText.length}`);

    return { itemTitle, itemPrice, standardImage, extraImages, itemDescriptionText };

  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------
/**
 * Playwright + Stealth로 쿠팡 상품 페이지를 수집한다.
 *
 * @param {string} productUrl
 * @returns {Promise<Object>} 수집된 상품 데이터 (기존 scraper.js 와 동일한 shape)
 */
async function scrapeCoupangProductPlaywright(productUrl) {
  console.log('\n=== Coupang Playwright Scraper ===');
  console.log(`URL: ${productUrl}\n`);

  const urlInfo = parseProductUrl(productUrl);
  if (!urlInfo.coupangProductId) {
    throw new Error('Invalid Coupang product URL: could not extract product ID');
  }

  console.log(`Product ID:     ${urlInfo.coupangProductId}`);
  console.log(`Vendor Item ID: ${urlInfo.vendorItemId || '(none)'}`);

  const { browser, context } = await launchBrowser();

  try {
    // 인증 전략 선택
    const hasCookie = await injectCookiesIfSet(context);
    if (!hasCookie) {
      await loginWithCredentials(context);
    }

    const { itemTitle, itemPrice, standardImage, extraImages, itemDescriptionText } =
      await scrapePage(context, productUrl);

    const result = {
      vendorItemId: urlInfo.vendorItemId,
      itemId: urlInfo.itemId,
      coupang_product_id: urlInfo.coupangProductId,
      categoryId: urlInfo.coupangCategoryId,
      ProductURL: urlInfo.sourceUrl,
      ItemTitle: itemTitle,
      ItemPrice: itemPrice,
      StandardImage: standardImage,
      ExtraImages: extraImages,
      WeightKg: '1',
      Options: null,
      ItemDescriptionText: itemDescriptionText || itemTitle,
      updatedAt: new Date().toISOString(),
    };

    console.log('\n=== Extraction Summary ===');
    console.log(`Title:        ${result.ItemTitle.substring(0, 60)}${result.ItemTitle.length > 60 ? '...' : ''}`);
    console.log(`Price:        ${result.ItemPrice || '(not found)'}`);
    console.log(`Main Image:   ${result.StandardImage ? 'OK' : '(not found)'}`);
    console.log(`Extra Images: ${result.ExtraImages.length}`);

    return result;

  } finally {
    await browser.close();
  }
}

module.exports = { scrapeCoupangProductPlaywright };
