# CURRENT_TASK.md

## 현재 상태
- 2026-04-02 업데이트
- 브랜치: `main` (oc/fix-detail-images 완료 머지)
- changeFlags 분기 + 전체 플래그 테스트(REFRESH 포함) 완료
- 플래그명 확정: SYNC→REFRESH, ALL→REBUILD
- `jpTitle` 컬럼 추가 — TITLE/CREATE 시 write-back, CATEGORY 시 재사용

---

## 오늘 완료된 작업 (2026-04-02)

### changeFlags 플래그별 테스트 완료 ✅

| flag | 테스트 결과 |
|---|---|
| `PRICE` | ✅ 통과 |
| `IMAGE` | ✅ 통과 |
| `CATEGORY` | ✅ 통과 |
| `TITLE` | ✅ 통과 |
| `DESC` | ✅ 통과 |
| `REBUILD` (구 ALL) | ✅ 통과 |
| `REFRESH` (구 SYNC) | ✅ 통과 |

### DetailImages 수집 버그 수정 + DESC vision 입력 변경 ✅ (oc/fix-detail-images)

- `buildImageExtractFn()` return에 `detail` 누락 → DetailImages 항상 빈 배열 버그 수정
- ExtraImages = 슬라이더만, DetailImages = 상세페이지 이미지로 수집 분리
- `descriptionGenerator`: vision 입력을 DetailImages 우선 (없으면 ExtraImages fallback)으로 변경
- **플래그명 변경**: SYNC→REFRESH, ALL→REBUILD (코드 + 문서 반영 완료)

### 수정 사항
- **`pricingConstants.js`**: `DOMESTIC_SHIPPING_KRW=3800`, `MARKET_COMMISSION_RATE=0.13`, `TARGET_MARGIN_RATE=0.40` 수정
- **`jpTitle` 컬럼 추가** (`sheetSchema.js`): TITLE/CREATE 시 번역 결과 write-back, CATEGORY 시 저장값 재사용 (`stored`)
- **CATEGORY 플래그 jpTitle 없어 번역 시 write-back 버그 수정** (`qoo10-auto-register.js`)
- **PRICE 플래그 qty 하드코딩 버그 수정**: `qty: 100` → `qty: null` (가격만 변경, 재고 불변)
- **`change_flags` 시트 설명 정확화**: CATEGORY/TITLE 갱신 필드 전체 명시, `ItemDescription` 제거 (UpdateGoods가 상세페이지를 덮어쓰지 않음 확인)

---

## 이전 완료 작업 (2026-04-01)

### B-01 ItemTitle 빈값 + B-02 StandardImage 오수집 수정 ✅ 완료 (PR #14 머지)

- **B-02 원인:** `coupang-collect-discovered.js` dedup 분기의 `imageCopyFields`에 `StandardImage` 포함 → 동일 product_id의 첫 번째 상품 이미지가 다른 vendorItemId 행에 복사됨
- **B-02 수정:** `imageCopyFields`에서 `StandardImage` 제거. dedup 상품은 StandardImage 빈값(`''`)으로 유지 → `coupang:collect:one`으로 개별 재수집
- **B-02 추가 수정:** 메인 이미지 셀렉터를 `querySelectorAll+find` 방식으로 교체 + `vendor_inventory` 경로 제외 필터 추가 (옵션 썸네일 오수집 방지)
- **B-01 수정:** `coupangApiClient.js` `collectProductData` / `collectPriceStockReview` 반환 직전에 ItemTitle 빈값 체크 → 빈값이면 `Error` throw → 호출부에서 status=ERROR 기록
- **editGoodsImage.js 신규 구현:** `backend/qoo10/editGoodsImage.js` — `ItemsContents.EditGoodsImage` API 래퍼
- **qoo10-auto-register.js UPDATE 흐름:** `editGoodsImage` 호출 추가, `registrationMessage`에 `[imageUpdate=ok|skip|fail]` 기록

### SliderImages 수집 수정 ✅ 완료 (Claude Code)

- **원인:** B-02 수정 시 `vendor_inventory` 제외 필터 / 셀렉터 교체가 Phase 3 SliderImages 수집에 사이드이펙트 발생
- **증상:** 오전 재수집(09:30)까지 정상(7~10개)이다가 B-02 머지 이후 전부 0. ExtraImages는 정상.
- **수정 및 테스트:** Claude Code가 셀렉터 수정 + 테스트 완료

### 멀티이미지 슬라이더 real mode 검증 ✅ 완료

- EnlargedImage 파라미터 방식으로 Qoo10 슬라이더 반영 확인 완료

---

## 이전 완료 작업

### 2026-04-01
- **B-01/B-02 수정** PR #14 머지 완료
- **SliderImages 수집 수정** 완료 (B-02 사이드이펙트)
- **멀티이미지 슬라이더 real mode** 반영 확인 완료
- **changeFlags 분기 구현** — `qoo10-auto-register.js` UPDATE 흐름 플래그별 분기 + `change_flags` 시트 추가

### 2026-03-31
- **CATEGORY_CHANGED 플래그 재resolve 버그 수정** — UPDATE 흐름에 resolver 재실행 분기 추가 (PR 머지)
- **기등록 7개 상품 타이틀 패치** — OpenRouter 잔액 충전 후 TITLE_CHANGED 플래그로 일괄 업데이트, 7/7 SUCCESS
- **상세페이지 일본어 콘텐츠 생성 + Qoo10 반영** — `descriptionGenerator.js` + `editGoodsContents.js` 신규 구현, CREATE/UPDATE 후 자동 호출
- **멀티이미지(EditGoodsMultiImage) EnlargedImage 파라미터 교체** — `ImageUrl` 단일 파라미터 → `EnlargedImage1~50` 개별 파라미터로 교체

### 2026-03-30
- **collect 후 Chrome 탭 로딩 스피너 멈춤 수정** — `about:blank` navigate로 해결 (PR #11)
- **categoryId 브레드크럼 자동 추출** — `coupangApiClient.js` + `coupang-collect-discovered.js`

---

## 다음 작업

### 🟡 우선순위 보통

#### REGISTERED 10개 StandardImage 재수집 + 대표이미지 패치
- **완료 예정: 4/2 (Mac Mini 작업)**
- 절차: `coupang:collect:one` × 10개 → StandardImage 확인 → `qoo10:auto-register` dry-run → real 실행 → Qoo10 육안 확인

#### Dashboard Chat 탭 UI 확인
- `/api/openclaw/*` Vercel API Route 프록시 6개 엔드포인트 구현 완료 상태
- Chat 탭 프론트엔드 UI (OpenClaw 연동) 완성 여부 미확인
- Vercel 배포에서 실제 동작 확인 후 결과에 따라 구현 범위 결정

### ⏸ 보류 (운영 안정화 후)

- [ ] **Qoo10 API 테스트 스크립트** — UpdateGoods / EditGoodsContents / GetItemDetailInfo 단독 테스트 스크립트 미구현
- [ ] **getItemDetailInfo.js 모듈 구현** — GetItemDetailInfo API 래퍼
- [ ] **AUTO_REGISTER_ENABLED 플래그** — cron 자동화 붙일 때 같이 구현 (config 시트 키 + promote early exit)
- [ ] **가격 상수 config 시트 이관** — `pricingConstants.js` 하드코딩(환율/수수료/마진) → 런타임 로드
- [ ] **coupang_categorys 자동 기록 검증** — 3/30 이후 수집 상품 categoryId가 시트에 자동 기록되는지 확인. 미기록 시 `coupangApiClient.js` 브레드크럼 추출 코드 점검.
- [ ] **일본어 이미지 재생성** — 한국어 상세 이미지 일본어 재생성 시 파일 저장 경로 구조 + 정리 정책 + Sheets 연동 방식 설계. 현재는 base64 메모리 방식.
- [ ] **Qoo10 시장 가격 경쟁성 스크래핑**

### 📋 별도 논의

- [ ] **키워드/카테고리 전략** — 현재 텀블러/자동차용품 + 그래놀라/시리얼 진행 중. 추가 방향 논의.
- [ ] **경쟁력 분석 로직 방향** — 옵션 A(등록 상품 가격/리뷰/재고 모니터링) vs 옵션 B(시장 트렌드 → 키워드 자동 추천)
- [ ] **관세 기준가 정밀화** — 현재 `FILTER_PRICE_KRW_MAX=150,000` 고정. 환율 연동 or 배송비 포함 역산 검토 필요.

---

## 현재 시트 상태 요약
- REGISTERED: 10개 (3/27 3개 + 3/30 6개 + 3/30 그래놀라 1개)
- COLLECTED: ~17개 (다음 promote 대상)
- MAX_DAILY_REGISTER: 10

### COLLECTED 대기 중인 4개 (다음 promote 대상)
| vendorItemId | ItemTitle | categoryId |
|---|---|---|
| 85296814940 | 마켓오네이처 오 그래놀라 다이제 시리얼 250g, 3개 | 433958 |
| 86533289539 | 마켓오네이처 오 그래놀라 다이제 시리얼 300g, 4개 | 433958 |
| 91816835421 | 마켓오네이처 오 그래놀라 저당 통보리 시리얼 360g, 2개 | 519992 |
| 91428368907 | 원더너츠 수제 그래놀라 시리얼 플레인 | 519992 |
