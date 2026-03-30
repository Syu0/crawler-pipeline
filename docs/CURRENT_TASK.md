# CURRENT_TASK.md

## 현재 상태
- 2026-03-30 업데이트
- `main` 브랜치 — 6개 추가 등록 완료 (누적 9개 REGISTERED)

---

## 오늘 완료된 작업 (2026-03-30)

### 코드 수정
- **`feat: extract categoryId from breadcrumb during collect and write to sheet`** (커밋 `839ecf2`)
  - `coupangApiClient.js` — Step 2 DOM evaluate에 브레드크럼 categoryId 추출 추가
    (selector: `ul.breadcrumb li a[href*="/np/categories/"]`)
  - `coupang-collect-discovered.js` — categoryId write-back 추가
  - `coupang-collect-one.js` — categoryId + WeightKg 기본값 `'1'` + 로그 출력 추가

- **`docs: clarify Browser Relay CLI dependency for coupang:collect`** (커밋 `7dfba15`)
  - RUNBOOK.md 매일 시작 절차 수정
  - `No pages available` 실패모드 명확화
  - `browser:start`는 stock:check 전용임을 명시

### 등록 완료 (오늘 6개)
| vendorItemId | qoo10ItemId | 가격(JPY) | 타이틀 |
|---|---|---|---|
| 88914244301 | 1198542938 | 4,092 | 韓国商品 250g 1개 (fallback) |
| 71152534271 | 1198542941 | 5,262 | 韓国商品 440g 1개 (fallback) |
| 91737670170 | 1198542943 | 2,505 | 韓国商品 360g 1개 (fallback) |
| 93082693153 | 1198542946 | 2,731 | 韓国商品 500g 2개 (fallback) |
| 92866072752 | 1198542948 | 6,708 | 韓国商品 300g 2개 (fallback) |
| 88596546635 | 1198542954 | 11,769 | 韓国商品 1kg 2개 (fallback) |

카테고리: `519992` → Qoo10 `320002604` (FALLBACK — category_mapping 매핑 없음)

---

## 다음 작업

### 🔴 우선순위 높음

#### 1. 타이틀 번역 401 수정 (누적 — 3/27부터 미해결)
- **증상:** `[titleTranslator] Claude API failed (OpenRouter API error: 401 Unauthorized)`
- **원인 추정:** OpenRouter 잔액 부족 또는 키 만료
- **확인:** OpenRouter 대시보드 → 크레딧 잔액 확인
- **영향:** 오늘 등록 6개 + 3/27 등록 3개 = 총 9개 타이틀이 fallback(`韓国商品`)으로 등록됨
- **해결 후:** 9개 needsUpdate=YES + changeFlags=TITLE_CHANGED 설정 후 `npm run qoo10:auto-register` 실행

#### 2. category_mapping 매핑 추가 (519992)
- **증상:** `coupangApiClient.js` 브레드크럼에서 categoryId=519992 수집됨, 하지만 category_mapping 시트에 매핑 없음 → FALLBACK jpCategoryId=320002604 사용
- **해결:** `category_mapping` 시트에서 coupangCategoryId=519992 행에 적절한 jpCategoryId 수동 입력
  - 519992 = 시리얼/그래놀라 카테고리로 추정
  - Qoo10 Japan 카테고리 트리에서 적합한 jpCategoryId 확인 후 MANUAL 입력

### 🟡 우선순위 보통

#### 3. COLLECTED 대기 중인 5개 (내일 자동 promote 대상)
| vendorItemId | ItemTitle | categoryId |
|---|---|---|
| 85321289776 | 마켓오네이처 오 그래놀라 다이제 시리얼 250g, 2개 | 433958 |
| 85296814940 | 마켓오네이처 오 그래놀라 다이제 시리얼 250g, 3개 | 433958 |
| 86533289539 | 마켓오네이처 오 그래놀라 다이제 시리얼 300g, 4개 | 433958 |
| 91816835421 | 마켓오네이처 오 그래놀라 저당 통보리 시리얼 360g, 2개 | 519992 |
| 91428368907 | 원더너츠 수제 그래놀라 시리얼 플레인 | 519992 |

- categoryId 수집됨, 내일 promote 시 자동 처리 예정
- 단, category_mapping 매핑이 없으면 FALLBACK으로 등록됨

#### 4. COLLECTED 대기 중인 나머지 ~12개 (이후 날짜 promote 대상)
- MAX_DAILY_REGISTER=6 기준 순차 처리

### 🟢 우선순위 낮음 (보류)

- [ ] **AUTO_REGISTER_ENABLED 플래그 추가** — cron 붙일 때
- [ ] **1195611873 카테고리 수동 재분류** — category_mapping 시트 MANUAL 수정
- [ ] **가격 상수 config 시트 이관** — pricingConstants.js 하드코딩 → 런타임 로드
- [ ] 일본어 상세페이지 콘텐츠 생성 (`contentStrategy.js`)
- [ ] Qoo10 시장 가격 경쟁성 스크래핑
- [ ] `getItemDetailInfo.js` / `editGoodsContents.js` 모듈 구현

---

## 현재 시트 상태 요약
- REGISTERED: 9개 (3/27 3개 + 오늘 6개)
- COLLECTED: ~17개 (내일 이후 promote 대상)
- MAX_DAILY_REGISTER: 6
