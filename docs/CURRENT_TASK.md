# CURRENT_TASK.md

## 현재 상태
- 2026-03-27 업데이트
- `main` 브랜치 — 1차 등록 파이프라인 완료 (3개 Qoo10 등록 성공)

---

## 오늘 완료된 작업 (2026-03-27)

### 코드 수정
- **`fix: add WeightKg default and copy collected fields to dedup rows`** (커밋 `e089fd6`)
  - `coupang-collect-discovered.js` — WeightKg 기본값 `'1'` 추가
  - dedup 분기에서 `collectedDataByProductId` Map으로 첫 번째 수집 데이터 복사
    (StandardImage, ExtraImages, ItemTitle, ItemPrice, DetailImages, ReviewCount, ReviewAvgRating, ProductAttributes, StockStatus, StockQty, WeightKg)

### 등록 완료
| vendorItemId | qoo10ItemId | 가격(JPY) | 카테고리 | 타이틀 |
|---|---|---|---|---|
| 77232047334 (1개입) | 1197862497 | 2,335 | AUTO (300000546) | 韓国商品 300g 1개 (fallback) |
| 86533289327 (3개입) | 1197862499 | 3,714 | AUTO (300000546) | 韓国商品 300g 3개 (fallback) |
| 86533289904 (5개입) | 1197862500 | 5,092 | AUTO (300000546) | 韓国商品 300g 5개 (fallback) |

카테고리: `식품 > 견과류・시리얼 > 시리얼` (confidence=0.6)

---

## 내일 이어서 할 작업

### 🔴 우선순위 높음

#### 1. 타이틀 번역 401 수정
- **증상:** `[titleTranslator] Claude API failed (OpenRouter API error: 401 Unauthorized)`
- **원인 추정:** OpenRouter 잔액 부족 또는 키 만료
- **확인:** OpenRouter 대시보드 → 크레딧 잔액 확인
- **영향:** 등록된 3개 상품 타이틀이 fallback(`韓国商品 300g N개`)으로 등록됨 → Update 필요
- **해결 후:** 3개 상품 needsUpdate=YES + changeFlags=TITLE_CHANGED 설정 후 `npm run qoo10:auto-register` 실행

#### 2. SKIPPED 5개 — categoryId 없음
| vendorItemId | ItemTitle |
|---|---|
| 85321289776 | 마켓오네이처 오 그래놀라 다이제 시리얼, 250g, 2개 |
| 85296814940 | 마켓오네이처 오 그래놀라 다이제 시리얼, 250g, 3개 |
| 86533289539 | 마켓오네이처 오 그래놀라 다이제 시리얼 300g, 4개 |
| 91816835421 | 마켓오네이처 오 그래놀라 저당 통보리 시리얼 360g, 2개 |
| 91428368907 | 원더너츠 수제 그래놀라 시리얼 플레인 |

- **원인:** 시트 `categoryId` 컬럼 비어있음 — `coupang_categorys` 시트 매핑 누락 가능성
- **해결:** `npm run coupang:collect:dry`로 categoryId 수집됐는지 확인 후 재처리

### 🟡 우선순위 보통

- [ ] **AUTO_REGISTER_ENABLED 플래그 추가** — cron 붙일 때 (config 시트 + promote 스크립트 긴급정지용)
- [ ] **1195611873 카테고리 수동 재분류** — category_mapping 시트 MANUAL 수정
- [ ] **가격 상수 config 시트 이관** — pricingConstants.js 하드코딩 → 런타임 로드

### 🟢 우선순위 낮음 (보류)
- [ ] 일본어 상세페이지 콘텐츠 생성 (`contentStrategy.js`)
- [ ] Qoo10 시장 가격 경쟁성 스크래핑
- [ ] `getItemDetailInfo.js` / `editGoodsContents.js` 모듈 구현

---

## 현재 시트 상태 요약
- REGISTERED: 3개 (오늘 등록)
- REGISTER_READY: 5개 (categoryId 없어서 SKIPPED — 재처리 필요)
- COLLECTED: ~18개 (다음 날 promote 대상)
- MAX_DAILY_REGISTER: 6 (config 시트에서 변경됨)
