#!/usr/bin/env node
/**
 * qoo10-market-analysis.js
 * Qoo10 Japan 경쟁 상품 분석 → 가격 전략 도출
 *
 * Browser Relay 방식 사용 (openclaw browser evaluate)
 * 사전 조건: Chrome 실행 중이어야 함
 *
 * Usage:
 *   node scripts/qoo10-market-analysis.js --keyword "グラノーラ 250g"
 *   node scripts/qoo10-market-analysis.js --vendorItemId 85296814940
 *   node scripts/qoo10-market-analysis.js --keyword "グラノーラ" --myPrice 2500
 *   node scripts/qoo10-market-analysis.js --keyword "グラノーラ" --pages 2
 *
 * Options:
 *   --keyword      Qoo10 검색 키워드 (필수, --vendorItemId 없을 때)
 *   --vendorItemId coupang_datas 시트에서 상품 조회 (qoo10SellingPrice 자동 사용)
 *   --myPrice      내 판매가 (JPY) - 직접 지정 시
 *   --pages        검색 페이지 수 (기본 1, 최대 3)
 *   --json         JSON 출력 모드
 *
 * Author: claude (by claude)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') });

const { execSync } = require('child_process');
const { getSheetsClient } = require('../backend/coupang/sheetsClient');

// ── 설정 ────────────────────────────────────────────────────────────────────

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SEARCH_BASE_URL = 'https://www.qoo10.jp/gmkt.inc/Search/Default.aspx';

// 전략 판단 임계값
const THRESHOLDS = {
  PRICE_OVER_MEDIAN_WARN: 0.20,     // 중앙값 초과 20% → 경고
  PRICE_OVER_MEDIAN_BAD: 0.40,      // 중앙값 초과 40% → 가격 경쟁 불리
  POWER_SELLER_RATIO_HIGH: 50,      // Power seller 50% 이상 → 강한 경쟁
  HIGH_REVIEW_THRESHOLD: 100,       // 리뷰 100개 이상 = 안착한 상품
  MARKET_SATURATED_COUNT: 30,       // 유사 상품 30개 이상 → 과열 시장
  MARKET_HOT_COUNT: 10,             // 10~30개 → 경쟁 있음
  MIN_COMPETITORS_FOR_ANALYSIS: 3,  // 최소 3개 이상 있어야 분석 의미
};

// ── 인수 파싱 ────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { keyword: null, vendorItemId: null, myPrice: null, pages: 1, json: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--keyword':      result.keyword = args[++i]; break;
      case '--vendorItemId': result.vendorItemId = args[++i]; break;
      case '--myPrice':      result.myPrice = parseFloat(args[++i]); break;
      case '--pages':        result.pages = Math.min(3, Math.max(1, parseInt(args[++i]) || 1)); break;
      case '--json':         result.json = true; break;
    }
  }

  return result;
}

// ── Browser Relay ────────────────────────────────────────────────────────────

function browserNavigate(url) {
  const escaped = url.replace(/'/g, "'\\''");
  execSync(`openclaw browser --browser-profile chrome navigate '${escaped}'`, {
    encoding: 'utf8',
    timeout: 20_000,
  });
}

function browserEvaluate(fn) {
  const escaped = fn.replace(/'/g, "'\\''");
  const stdout = execSync(
    `openclaw browser --browser-profile chrome evaluate --fn '${escaped}'`,
    { encoding: 'utf8', timeout: 20_000 }
  );
  return JSON.parse(stdout);
}

// ── 시트에서 상품 조회 ────────────────────────────────────────────────────────

async function getProductFromSheet(vendorItemId) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'coupang_datas!A:ZZ',
  });

  const rows = res.data.values || [];
  if (rows.length < 2) return null;

  const headers = rows[0];
  const vidIdx   = headers.indexOf('vendorItemId');
  const titleIdx = headers.indexOf('ItemTitle');
  const priceIdx = headers.indexOf('qoo10SellingPrice');
  const statusIdx = headers.indexOf('status');

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][vidIdx] === vendorItemId) {
      return {
        vendorItemId,
        itemTitle:         rows[i][titleIdx]  || '',
        qoo10SellingPrice: parseFloat(rows[i][priceIdx]) || null,
        status:            rows[i][statusIdx] || '',
      };
    }
  }
  return null;
}

// ── Qoo10 검색 파싱 (Browser Relay) ─────────────────────────────────────────

async function scrapeSearchResults(keyword, pages = 1) {
  const competitors = [];
  let totalCount = 0;

  for (let p = 1; p <= pages; p++) {
    const url = `${SEARCH_BASE_URL}?keyword=${encodeURIComponent(keyword)}&srt=4&p=${p}`;
    browserNavigate(url);

    // 페이지 로딩 대기 (약 1.5초)
    await new Promise(r => setTimeout(r, 1500));

    const result = browserEvaluate(`
      function() {
        var items = [];
        var total = 0;

        // 총 결과수: "商品: 155" 형식의 dd > strong
        var ddEls = document.querySelectorAll('dd strong');
        for (var i = 0; i < ddEls.length; i++) {
          var n = parseInt(ddEls[i].textContent.replace(/[^0-9]/g, ''));
          if (n > 0) { total = n; break; }
        }

        // 상품 리스트: 테이블 tbody tr
        var rows = document.querySelectorAll('table tbody tr');
        rows.forEach(function(row) {
          var cells = row.querySelectorAll('td');
          if (cells.length < 2) return;

          // cell[1]: 상품명 링크 (cell[0]은 이미지/썸네일)
          // 여러 링크 중 가장 긴 텍스트 = 상품명, 단 셀러 등급/쿠폰 링크 제외
          var infoCell = cells.length >= 2 ? cells[1] : cells[0];
          var titleLinks = infoCell.querySelectorAll('a');
          var title = '';
          var maxLen = 0;
          for (var ai = 0; ai < titleLinks.length; ai++) {
            var lt = titleLinks[ai].textContent.trim();
            if (lt.indexOf('Power seller') === 0 || lt.indexOf('Good seller') === 0 ||
                lt === 'クーポン' || lt.length < 5) continue;
            if (lt.length > maxLen) { maxLen = lt.length; title = lt; }
          }
          if (!title) return;

          // 가격 셀: cell[2] 또는 그 이후
          var price = 0;
          for (var ci = 2; ci < cells.length; ci++) {
            var strongEl = cells[ci].querySelector('strong');
            if (strongEl) {
              var p = parseInt(strongEl.textContent.replace(/[^0-9]/g, ''));
              if (p > 0) { price = p; break; }
            }
          }
          if (!price) return;

          var infoText = infoCell.textContent;

          var sellerGrade = 'General';
          // "Power seller xxx", "Good seller xxx" 링크 텍스트에서 추출
          var sellerLinks = infoCell.querySelectorAll('a');
          for (var li = 0; li < sellerLinks.length; li++) {
            var lt = sellerLinks[li].textContent;
            if (lt.indexOf('Power seller') === 0) { sellerGrade = 'Power'; break; }
            if (lt.indexOf('Good seller') === 0) { sellerGrade = 'Good'; break; }
          }

          // 리뷰수: (숫자) 패턴
          var reviewMatch = infoText.match(/\\((\\d+)\\)/);
          var reviewCount = (reviewMatch && reviewMatch[1]) ? parseInt(reviewMatch[1]) : 0;

          // 발송국: 마지막 td의 순수 텍스트 노드
          var lastCell = cells[cells.length - 1];
          var origin = 'OTHER';
          var lastText = lastCell.textContent.trim();
          if (lastText === 'KR') origin = 'KR';
          else if (lastText === 'JP') origin = 'JP';
          else if (lastCell.textContent.includes('KR')) origin = 'KR';
          else if (lastCell.textContent.includes('JP')) origin = 'JP';

          // 무료배송
          var freeShip = row.textContent.includes('無料');

          items.push({ title: title, price: price, reviewCount: reviewCount, sellerGrade: sellerGrade, origin: origin, freeShip: freeShip });
        });

        return { items: items, total: total };
      }
    `);

    if (p === 1 && result && result.total) totalCount = result.total;
    if (result && result.items) competitors.push(...result.items);
  }

  // 총 결과수가 0이면 URL 파라미터에서 count 추출 시도
  if (totalCount === 0 && competitors.length > 0) totalCount = competitors.length;

  return { competitors, totalCount };
}

// ── 통계 계산 ────────────────────────────────────────────────────────────────

function calcStats(competitors) {
  if (competitors.length === 0) return null;

  const prices = competitors.map(c => c.price).filter(p => p > 0).sort((a, b) => a - b);
  if (prices.length === 0) return null;

  const min    = prices[0];
  const max    = prices[prices.length - 1];
  const median = prices[Math.floor(prices.length / 2)];
  const avg    = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);

  const powerCount       = competitors.filter(c => c.sellerGrade === 'Power').length;
  const goodCount        = competitors.filter(c => c.sellerGrade === 'Good').length;
  const krCount          = competitors.filter(c => c.origin === 'KR').length;
  const jpCount          = competitors.filter(c => c.origin === 'JP').length;
  const highReviewCount  = competitors.filter(c => c.reviewCount >= THRESHOLDS.HIGH_REVIEW_THRESHOLD).length;
  const powerSellerRatio = competitors.length > 0 ? Math.round(powerCount / competitors.length * 100) : 0;

  return { count: competitors.length, priceMin: min, priceMax: max, priceMedian: median, priceAvg: avg,
           powerCount, goodCount, powerSellerRatio, krCount, jpCount, highReviewCount };
}

// ── 전략 판단 ────────────────────────────────────────────────────────────────

function judgeStrategy(stats, myPrice, totalCount) {
  if (!stats || stats.count < THRESHOLDS.MIN_COMPETITORS_FOR_ANALYSIS) {
    return {
      recommendation: 'REGISTER',
      reason: '경쟁 상품 없음 (블루오션)',
      tags: ['BLUE_OCEAN'],
      strategies: ['등록 추천. 가격 자유롭게 설정 가능'],
    };
  }

  const strategies = [];
  let recommendation = 'REGISTER';
  const { count, priceMedian, priceMin, powerSellerRatio, highReviewCount } = stats;

  // 시장 포화도
  if (totalCount >= THRESHOLDS.MARKET_SATURATED_COUNT) {
    strategies.push(`총 ${totalCount}개 상품 — 과열 시장`);
    recommendation = 'CAUTION';
  } else if (totalCount >= THRESHOLDS.MARKET_HOT_COUNT) {
    strategies.push(`총 ${totalCount}개 상품 — 경쟁 있음`);
  } else {
    strategies.push(`총 ${totalCount}개 상품 — 경쟁 적음`);
  }

  // 강한 경쟁자
  if (powerSellerRatio >= THRESHOLDS.POWER_SELLER_RATIO_HIGH) {
    strategies.push(`Power seller ${powerSellerRatio}% — 강한 경쟁`);
    if (recommendation === 'REGISTER') recommendation = 'CAUTION';
  }

  // 고리뷰 상품
  if (highReviewCount >= 3) {
    strategies.push(`리뷰 ${THRESHOLDS.HIGH_REVIEW_THRESHOLD}개↑ 상품 ${highReviewCount}개 — 시장 안착`);
  }

  // 내 가격 비교
  if (myPrice) {
    const priceDiff = (myPrice - priceMedian) / priceMedian;

    if (priceDiff <= THRESHOLDS.PRICE_OVER_MEDIAN_WARN) {
      strategies.push(`내 가격 ¥${myPrice.toLocaleString()} ≤ 중앙값 ¥${priceMedian.toLocaleString()} +20% — 경쟁력 있음`);
    } else if (priceDiff <= THRESHOLDS.PRICE_OVER_MEDIAN_BAD) {
      strategies.push(`내 가격 ¥${myPrice.toLocaleString()} > 중앙값 ¥${priceMedian.toLocaleString()} +${Math.round(priceDiff * 100)}% — 가격 조정 또는 패키지 검토`);
      if (recommendation === 'REGISTER') recommendation = 'CAUTION';
    } else {
      strategies.push(`내 가격 ¥${myPrice.toLocaleString()} >> 중앙값 ¥${priceMedian.toLocaleString()} +${Math.round(priceDiff * 100)}% — 가격 경쟁 불리`);
      recommendation = 'PACKAGE_OR_HOLD';
    }

    if (myPrice <= priceMin) {
      strategies.push(`최저가(¥${priceMin.toLocaleString()})보다 저렴/동급 — 최저가 포지션 가능`);
    }
  } else {
    strategies.push(`참고: 가격 분포 ¥${stats.priceMin.toLocaleString()} ~ ¥${stats.priceMax.toLocaleString()} (중앙값 ¥${priceMedian.toLocaleString()})`);
  }

  const reasonMap = {
    REGISTER:         '경쟁 환경 양호 — 등록 추천',
    CAUTION:          '경쟁 있음 — 등록 가능하나 가격/전략 검토 필요',
    PACKAGE_OR_HOLD:  '가격 경쟁 불리 — 패키지 구성 또는 등록 보류 추천',
  };

  return { recommendation, reason: reasonMap[recommendation] || '', tags: [recommendation], strategies };
}

// ── 출력 ────────────────────────────────────────────────────────────────────

function printReport(keyword, myPrice, myProduct, stats, judgment, competitors, totalCount, jsonMode) {
  const result = {
    keyword, myPrice, totalSearchCount: totalCount, analyzedCount: competitors.length,
    myProduct: myProduct ? { vendorItemId: myProduct.vendorItemId, itemTitle: myProduct.itemTitle,
      qoo10SellingPrice: myProduct.qoo10SellingPrice, status: myProduct.status } : null,
    stats, judgment,
    topCompetitors: competitors.slice(0, 10).map(c => ({
      title: c.title.substring(0, 60), price: c.price, reviewCount: c.reviewCount,
      sellerGrade: c.sellerGrade, origin: c.origin, freeShip: c.freeShip,
    })),
  };

  if (jsonMode) { console.log(JSON.stringify(result, null, 2)); return; }

  console.log('\n' + '='.repeat(60));
  console.log(`📊 Qoo10 경쟁 분석: "${keyword}"`);
  console.log('='.repeat(60));

  if (myProduct) {
    console.log(`\n📦 내 상품: ${myProduct.itemTitle}`);
    console.log(`   상태: ${myProduct.status}`);
  }
  if (myPrice) console.log(`   내 판매가: ¥${myPrice.toLocaleString()}`);

  console.log(`\n🔍 검색 결과: 총 ${totalCount}개 (분석: ${competitors.length}개)`);

  if (stats) {
    console.log('\n📈 경쟁가 분포:');
    console.log(`   최저가: ¥${stats.priceMin.toLocaleString()}`);
    console.log(`   중앙값: ¥${stats.priceMedian.toLocaleString()}`);
    console.log(`   평균가: ¥${stats.priceAvg.toLocaleString()}`);
    console.log(`   최고가: ¥${stats.priceMax.toLocaleString()}`);
    console.log(`\n👥 셀러 현황:`);
    console.log(`   Power: ${stats.powerCount}명 (${stats.powerSellerRatio}%)`);
    console.log(`   Good:  ${stats.goodCount}명`);
    console.log(`   한국발: ${stats.krCount}개 / 일본발: ${stats.jpCount}개`);
    console.log(`   리뷰 ${THRESHOLDS.HIGH_REVIEW_THRESHOLD}+: ${stats.highReviewCount}개 상품`);
  }

  console.log('\n💡 전략 분석:');
  judgment.strategies.forEach(s => console.log(`   • ${s}`));

  const emoji = { REGISTER: '✅', CAUTION: '⚠️', PACKAGE_OR_HOLD: '🔴' };
  console.log(`\n${emoji[judgment.recommendation] || '•'} 판단: ${judgment.reason}`);

  if (competitors.length > 0) {
    console.log('\n🏆 상위 경쟁 상품 (최대 5개):');
    competitors.slice(0, 5).forEach((c, i) => {
      const freeTag = c.freeShip ? '[무료배송]' : '';
      const review = (c.reviewCount == null || isNaN(c.reviewCount)) ? 0 : c.reviewCount;
      console.log(`   ${i + 1}. [${c.sellerGrade}][${c.origin}]${freeTag} ¥${c.price.toLocaleString()} (리뷰${review}) ${c.title.substring(0, 50)}`);
    });
  }

  console.log('\n' + '='.repeat(60));
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  if (!args.keyword && !args.vendorItemId) {
    console.error('Error: --keyword 또는 --vendorItemId 중 하나는 필수입니다.');
    console.error('Usage: node scripts/qoo10-market-analysis.js --keyword "グラノーラ 250g"');
    process.exit(1);
  }

  // Chrome 연결 확인
  try {
    execSync('openclaw browser --browser-profile chrome tabs', { encoding: 'utf8', timeout: 5000 });
  } catch (e) {
    console.error('Error: Chrome이 실행 중이지 않거나 Browser Relay 연결 실패');
    console.error('Chrome을 실행하고 다시 시도하세요.');
    process.exit(1);
  }

  let keyword = args.keyword;
  let myPrice = args.myPrice;
  let myProduct = null;

  if (args.vendorItemId) {
    if (!SPREADSHEET_ID) {
      console.error('Error: GOOGLE_SHEET_ID 환경변수가 설정되지 않았습니다.');
      process.exit(1);
    }
    myProduct = await getProductFromSheet(args.vendorItemId);
    if (!myProduct) {
      console.error(`Error: vendorItemId ${args.vendorItemId}를 시트에서 찾을 수 없습니다.`);
      process.exit(1);
    }
    if (!keyword) keyword = myProduct.itemTitle;
    if (!myPrice && myProduct.qoo10SellingPrice) myPrice = myProduct.qoo10SellingPrice;
    if (!args.json) console.log(`[시트] ${myProduct.itemTitle} (${myProduct.status}) | ¥${myPrice}`);
  }

  if (!args.json) console.log(`[검색] "${keyword}" (${args.pages}페이지)...`);

  const { competitors, totalCount } = await scrapeSearchResults(keyword, args.pages);

  if (!args.json) console.log(`[완료] ${competitors.length}개 파싱`);

  const stats    = calcStats(competitors);
  const judgment = judgeStrategy(stats, myPrice, totalCount);

  printReport(keyword, myPrice, myProduct, stats, judgment, competitors, totalCount, args.json);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
