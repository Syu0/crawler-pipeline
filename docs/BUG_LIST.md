# BUG_LIST.md — 버그 추적

---

### B-01 — ItemTitle 빈값인데 status=COLLECTED 전이

- **발견:** 2026-04-01, Step 02 재수집 중
- **증상:** `npm run coupang:collect:one` 실행 후 status=COLLECTED로 전이됐으나
  `ItemTitle` 컬럼이 빈값
- **영향:** 빈 타이틀 상품이 promote → 등록 흐름을 타면 fallback 타이틀 또는 등록 실패
- **원인:**
  - Browser Relay `quantity-info` API 응답에서 ItemTitle 누락
  - 수집 성공 판정 시 ItemTitle 유무 미체크 → 빈값 그대로 write-back
- **재현 조건:** 미확인
- **임시 대응:** promote 전 ItemTitle 빈값 행 수동 확인
- **수정 방향:**
  1. `coupangApiClient.js`: ItemTitle 빈값이면 수집 실패 처리 (throw)
  2. `qoo10-auto-register.js`: UPDATE 흐름에서 ItemTitle 빈값 행 사전 필터링
- **상태:** ✅ 수정 완료 (2026-04-01, oc/fix-bugs-b01-b02)

---

### B-02 — StandardImage에 다른 상품 이미지가 수집됨

- **발견:** 2026-04-01, Step 02 재수집 결과 확인 중
- **증상:** REGISTERED 상품 전체의 `StandardImage` 컬럼에 해당 상품이 아닌
  다른 상품의 대표 이미지가 들어있음
- **영향:** Qoo10 등록 상품 대표 이미지가 잘못 표시됨 (전체 기등록 상품 영향)
- **원인:**
  - dedup 분기(`coupang-collect-discovered.js`)에서 `StandardImage`가 `imageCopyFields`에
    포함되어 첫 번째 수집 상품의 이미지가 동일 product_id의 다른 vendorItemId 행에 복사됨
  - 동일 `coupang_product_id`를 가진 변형 상품은 대표 이미지가 다를 수 있으므로
    복사 자체가 잘못된 설계
- **임시 대응:** 해당 상품 Qoo10 대표 이미지 수동 확인 필요
- **수정 방향:**
  - `coupang-collect-discovered.js` dedup 분기에서 `StandardImage` 복사 제거
  - dedup 상품의 StandardImage는 `''`(빈값)으로 두고, `coupang:collect:one`으로 개별 재수집
- **상태:** ✅ 수정 완료 (2026-04-01, oc/fix-bugs-b01-b02)
