# CURRENT_TASK.md

## 현재 상태 (2026-04-01)

- 브랜치: `oc/fix-image-fields-step02` — PR #13 OPEN
- REGISTERED: 10개 (전부 `[multiImage=ok]` 반영 완료)
- COLLECTED 미등록 대기: 12개 (다음 promote → 등록 대상)
- DISCOVERED: 16개

**다음 액션:** PR #13 머지 → COLLECTED 12개 promote → 등록

---

## 완료된 작업

### Step 02. ExtraImages 슬라이더 썸네일 수집 + Qoo10 멀티이미지 반영 ✅ (2026-04-01)

- `ul.twc-static li img` 셀렉터로 슬라이더 썸네일 수집 → `ExtraImages` 컬럼 저장
  - StandardImage와 path 기준 중복 제거 (사이즈 세그먼트 무시)
  - 8개 상품 재수집 완료 (3~10개/상품)
- 10개 상품 `EditGoodsMultiImage` 호출 → 10/10 `[multiImage=ok]` SUCCESS

### Step 01. ExtraImages → DetailImages 필드 정정 ✅

- 결론: `ExtraImages`가 슬라이더 이미지 컬럼이 맞음. 정정 없이 유지.

### EditGoodsMultiImage 파라미터 수정 ✅ (2026-04-01 real 검증)

- `ImageUrl: "url1|url2|..."` → `EnlargedImage1~50` 개별 파라미터로 교체
  (기존 방식은 ResultCode=0 반환하지만 실제 미반영 — UpdateGoods ItemQty 무시와 동일 패턴)

### CATEGORY_CHANGED 플래그 카테고리 재resolve 버그 수정 ✅

- UPDATE 흐름 CATEGORY_CHANGED 분기 추가 → CategoryResolver 재실행 후 새 jpCategoryId 적용
- FALLBACK 6개 → jpCategoryId=300000546(시리얼) 정상 재분류

---

## 이전 완료 작업 (2026-03-31)

### 기등록 7개 상품 타이틀 패치 ✅
- OpenRouter 잔액 충전 후 `[titleMethod=fallback]` 7개 → 일본어 SEO 타이틀 전환 완료

### 상세페이지 일본어 콘텐츠 생성 + Qoo10 반영 ✅
- `descriptionGenerator.js`: vision(ExtraImages 있을 때) / text 모드 → 일본어 HTML
- `editGoodsContents.js`: EditGoodsContents 래퍼 (파라미터명 `Contents`)
- 검증: 상품 1197862497 상세페이지 일본어 + 이미지 정상 확인

---

### 2026-03-30
- collect 후 Chrome 탭 로딩 스피너 멈춤 수정 (PR #11)
- editGoodsMultiImage.js 신규 구현 (CREATE/UPDATE 후 자동 호출)
- categoryId 브레드크럼 추출 — coupangApiClient.js + coupang-collect-discovered.js

---

## 보류 (운영 안정화 후)

- [ ] **AUTO_REGISTER_ENABLED 플래그 추가** — cron 붙일 때
- [ ] **1195611873 카테고리 수동 재분류** — category_mapping 시트 MANUAL 수정
- [ ] **1198542941 StandardImage 오수집 수정** — EditGoodsImage 래퍼 미구현으로 현재 수정 불가
- [ ] **가격 상수 config 시트 이관** — pricingConstants.js 하드코딩 → 런타임 로드
- [ ] **일본어 이미지 재생성** — 한국어 상세 이미지 → 일본어 재생성 시 저장 경로/정책/Sheets 연동 설계 필요
- [ ] Qoo10 시장 가격 경쟁성 스크래핑
- [ ] `getItemDetailInfo.js` 모듈 구현
- [ ] **coupang_categorys 자동 기록 검증** — 2026-03-30 이후 수집된 상품 categoryId 자동 기록 여부 확인

---

## 현재 시트 상태 (2026-04-01)

| status | 개수 |
|---|---|
| REGISTERED | 10 |
| COLLECTED | 12 |
| DISCOVERED | 16 |
| **합계** | **38** |

### COLLECTED 미등록 12개 (다음 promote 대상)

| vendorItemId | ItemTitle |
|---|---|
| 85296814940 | 마켓오네이처 오 그래놀라 다이제 시리얼 250g, 3개 |
| 86533289539 | 마켓오네이처 오 그래놀라 다이제 시리얼 300g, 4개 |
| 91816835421 | 마켓오네이처 오 그래놀라 저당 통보리 시리얼 360g, 2개 |
| 91428368907 | 원더너츠 수제 그래놀라 시리얼 플레인 |
| 85861660468 | 그라놀로지 카카올로지 그래놀라 시리얼 440g, 2개 |
| 3000094712 | 동서 그래놀라 시리얼 1kg, 1개 |
| 79146586548 | 켈로그 리얼 그래놀라 오리지널 시리얼 400g, 2개 |
| 94790519284 | (ItemTitle 미수집) |
| 3965507525 | (ItemTitle 미수집) |
| 88255719615 | 마켓오네이처 오그래놀라 오트 리얼 초콜릿 시리얼 360g |
| 86205103055 | 켈로그 100% 벨기에산 그래놀라 시리얼 900g, 1개 |
| 92498743242 | 크놀라 시그니처 그래놀라 500g 1개 리필용 |
