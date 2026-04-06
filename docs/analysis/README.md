# Analysis Scripts

경쟁 분석 및 시장 조사용 독립 스크립트 모음.

> **공통 전제조건:** Chrome 실행 중 + Browser Relay 연결 가능 상태
> ```bash
> openclaw browser --browser-profile chrome tabs  # 연결 확인
> ```

---

## 스크립트 목록

| 스크립트 | 목적 | 상태 |
|----------|------|------|
| [qoo10-market-analysis](#qoo10-market-analysis) | Qoo10 JP 경쟁 상품 분석 → 가격 전략 도출 | ✅ 완료 |

---

## qoo10-market-analysis

**파일:** `scripts/qoo10-market-analysis.js`

Qoo10 Japan 검색 결과를 스크래핑하여 경쟁 상품의 가격/셀러 등급/발송국을 분석하고,
내 판매가 대비 전략 판단(등록/검토/보류)을 자동 도출한다.

### 동작 방식

```
키워드 입력
    → Qoo10 검색 페이지 (Browser Relay navigate)
    → DOM 파싱 (Browser Relay evaluate)
    → 가격 통계 계산
    → 전략 판단
    → 결과 출력 (텍스트 or JSON)
```

**Browser Relay 사용 이유:** Playwright headless는 Qoo10에서 차단됨.
`coupangApiClient.js`와 동일한 `openclaw browser --browser-profile chrome` 방식 사용.

### 사용법

```bash
# 키워드 직접 입력
node scripts/qoo10-market-analysis.js --keyword "グラノーラ 250g"

# 키워드 + 내 가격 지정
node scripts/qoo10-market-analysis.js --keyword "グラノーラ 250g" --myPrice 2500

# vendorItemId → coupang_datas 시트에서 qoo10SellingPrice 자동 조회
node scripts/qoo10-market-analysis.js --vendorItemId 85296814940

# 여러 페이지 수집 (최대 3)
node scripts/qoo10-market-analysis.js --keyword "グラノーラ" --pages 2

# JSON 출력 (자동화 연동용)
node scripts/qoo10-market-analysis.js --keyword "グラノーラ 250g" --myPrice 2500 --json
```

### 출력 예시

```
📊 Qoo10 경쟁 분석: "グラノーラ 250g"
   내 판매가: ¥2,500

🔍 검색 결과: 총 43개 (분석: 43개)

📈 경쟁가 분포:
   최저가: ¥1,120
   중앙값: ¥2,484
   평균가: ¥3,616
   최고가: ¥17,050

👥 셀러 현황:
   Power: 13명 (30%)
   Good:  14명
   한국발: 7개 / 일본발: 36개
   리뷰 100+: 0개 상품

💡 전략 분석:
   • 총 43개 상품 — 과열 시장
   • 내 가격 ¥2,500 ≤ 중앙값 ¥2,484 +20% — 경쟁력 있음

⚠️ 판단: 경쟁 있음 — 등록 가능하나 가격/전략 검토 필요

🏆 상위 경쟁 상품 (최대 5개):
   1. [Good][KR][무료배송] ¥2,512 (리뷰15) ああグラノーラ ダイジェシリアル 250g2個...
   2. [Power][JP] ¥1,490 (리뷰1) パーフェクトビオ プロテイングラノーラ...
```

### JSON 출력 스키마

```json
{
  "keyword": "string",
  "myPrice": 2500,
  "totalSearchCount": 43,
  "analyzedCount": 43,
  "myProduct": null,
  "stats": {
    "count": 43,
    "priceMin": 1120,
    "priceMax": 17050,
    "priceMedian": 2484,
    "priceAvg": 3616,
    "powerCount": 13,
    "goodCount": 14,
    "powerSellerRatio": 30,
    "krCount": 7,
    "jpCount": 36,
    "highReviewCount": 0
  },
  "judgment": {
    "recommendation": "CAUTION",
    "reason": "경쟁 있음 — 등록 가능하나 가격/전략 검토 필요",
    "tags": ["CAUTION"],
    "strategies": ["총 43개 상품 — 과열 시장", "내 가격 ¥2,500 ≤ 중앙값 ¥2,484 +20% — 경쟁력 있음"]
  },
  "topCompetitors": [
    {
      "title": "string",
      "price": 2512,
      "reviewCount": 15,
      "sellerGrade": "Good",
      "origin": "KR",
      "freeShip": true
    }
  ]
}
```

### 전략 판단 기준

| 조건 | 판단 (`recommendation`) |
|------|------------------------|
| 경쟁 상품 3개 미만 | `REGISTER` — 블루오션 |
| 시장 30개↑ | 과열 시장 경고 |
| Power seller 50%↑ | 강한 경쟁 경고 |
| 내 가격 ≤ 중앙값 +20% | 경쟁력 있음 → `REGISTER` or `CAUTION` |
| 내 가격 중앙값 +20~40% | `CAUTION` — 가격 조정 또는 패키지 검토 |
| 내 가격 중앙값 +40% 초과 | `PACKAGE_OR_HOLD` — 등록 보류 추천 |

임계값 변경: `scripts/qoo10-market-analysis.js` 상단 `THRESHOLDS` 객체 수정.

### DOM 파싱 구조 (참고)

Qoo10 검색 결과 `table tbody tr` 기준:

| cell | 내용 |
|------|------|
| `cells[0]` | 이미지/썸네일 (첫 번째 `a`는 이미지 링크 — 상품명 아님) |
| `cells[1]` | 브랜드명 링크 + **상품명 링크** + `(리뷰수)` + `"Good/Power seller 셀러명"` |
| `cells[2]` | `<strong>` 현재가격, `<del>` 정가 |
| `cells[3]` | 발송국 (`KR` / `JP`) + 배송비 정보 |

총 결과수: `dd strong` 셀렉터로 파싱.

### 환경변수 (--vendorItemId 사용 시만 필요)

```
GOOGLE_SHEET_ID=...
GOOGLE_SERVICE_ACCOUNT_JSON_PATH=...
```

`backend/.env` 에 설정.
