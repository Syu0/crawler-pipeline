# CURRENT_TASK.md

## 현재 상태
- 2026-04-01 업데이트
- `oc/fix-image-fields-step02` 브랜치 — PR 생성 예정
- 10개 REGISTERED, `[multiImage=ok]` 반영 완료
- Qoo10 슬라이더 육안 확인 필요 (PR 생성 후 최대 10분 소요)

---

## 완료된 작업

### Step 02. ExtraImages 슬라이더 썸네일 수집 + Qoo10 멀티이미지 반영 ✅ 완료 (2026-04-01)

- **수집:** `ul.twc-static li img` 셀렉터로 슬라이더 썸네일 수집 → `ExtraImages` 컬럼 저장
  - StandardImage와 path 기준 중복 제거 (사이즈 세그먼트 무시)
  - 8개 REGISTERED 상품 재수집 완료 (SliderImages 3~10개/상품)
- **Qoo10 반영:** 10개 상품 `EditGoodsMultiImage` 호출 → 전부 `[multiImage=ok]` 성공
  - 결과: 10/10 SUCCESS, `registrationStatus=SUCCESS`

### Step 01. ExtraImages → DetailImages 필드 정정 ✅ 완료

- **결론:** 설계 의도 확인 — `ExtraImages`가 슬라이더 이미지 컬럼이 맞음. 정정 없이 유지.

### EditGoodsMultiImage 파라미터 수정 ✅ 완료 (2026-04-01 real 검증)

- **원인:** 기존 `ImageUrl` 파라미터가 Qoo10 서버에서 무시됨 (`ResultCode=0` 반환하지만 실제 미반영)
- **해결:** `backend/qoo10/editGoodsMultiImage.js` 파라미터 교체
  - `ImageUrl: "url1|url2|..."` → `EnlargedImage1: url1`, `EnlargedImage2: url2` ... (개별 파라미터, max 50개)
  - URL 200자 초과 건 skip, 50개 초과 분 slice
- **검증:** real mode UPDATE 10개 전부 `[multiImage=ok]` 확인 완료

### CATEGORY_CHANGED 플래그 카테고리 재resolve 버그 수정 ✅ 완료

- **원인:** UPDATE 흐름에서 `changeFlags=CATEGORY_CHANGED`를 무시하고 기존 `jpCategoryIdUsed` 그대로 UpdateGoods 호출
- **해결:** `scripts/qoo10-auto-register.js` UPDATE 블록에 CATEGORY_CHANGED 분기 추가 → `CategoryResolver` 재실행 후 새 jpCategoryId로 payload 구성
- **결과:** FALLBACK 등록 6개 상품 중 519992 카테고리 상품 정상 재분류 확인 (jpCategoryId=300000546)

---

## 이전 완료 작업 (2026-03-31)

### 기등록 7개 상품 타이틀 패치 ✅ 완료

- **원인:** OpenRouter 잔액 소진으로 `[titleMethod=fallback]` 으로 등록됨 (`韓国商品 300g 1개` 형식)
- **해결:** OpenRouter 잔액 충전 후 `registrationMessage`에 `[titleMethod=fallback]` 포함된 7개 행에 `needsUpdate=YES` + `changeFlags=TITLE_CHANGED` 설정 → `npm run qoo10:auto-register` 실행
- **결과:** 7/7 SUCCESS — 모두 일본어 SEO 타이틀로 업데이트 완료

### 상세페이지 일본어 콘텐츠 생성 + Qoo10 반영 ✅ 완료

- **`backend/qoo10/descriptionGenerator.js`** 신규 구현
  - ExtraImages 있음 → OpenRouter vision (Claude Haiku) → 일본어 HTML 생성
  - ExtraImages 없음 → ItemTitle + ItemDescriptionText 텍스트 기반 생성
  - API 실패 시 `{ html: '', method: 'skip' }` 반환 (파이프라인 중단 없음)
  - 생성된 일본어 텍스트 뒤에 ExtraImages를 `<p><img src="..." /></p>` 형식으로 이어붙임

- **`backend/qoo10/editGoodsContents.js`** 신규 구현
  - `ItemsContents.EditGoodsContents` API 래퍼
  - 핵심: 파라미터명 `Contents` (≠ `ItemDescription`) — 검증 완료

- **검증:** Qoo10 상품 1197862497 상세페이지에서 일본어 설명 + 이미지 정상 표시 확인

---

### 2026-03-30
- **collect 후 Chrome 탭 로딩 스피너 멈춤 수정** — `about:blank` navigate로 해결 (PR #11)
- **이미지 미반영 버그 수정** — `editGoodsMultiImage.js` 신규 구현, CREATE/UPDATE 후 자동 호출
- **categoryId 브레드크럼 추출** — `coupangApiClient.js` + `coupang-collect-discovered.js`

---

## 다음 작업

## 보류 (운영 안정화 후)

- [ ] **AUTO_REGISTER_ENABLED 플래그 추가** — cron 붙일 때
- [ ] **1195611873 카테고리 수동 재분류** — category_mapping 시트 MANUAL 수정
- [ ] **1198542941 StandardImage 오수집 수정** — EditGoodsImage 래퍼 미구현으로 현재 수정 불가
- [ ] **가격 상수 config 시트 이관** — pricingConstants.js 하드코딩 → 런타임 로드
- [ ] **일본어 이미지 재생성** — 한국어 상세 이미지를 일본어로 재생성할 때
  이미지 파일 저장 경로 구조 + 정리 정책 + Sheets 연동 방식 함께 설계.
  현재는 base64 메모리 방식으로 vision 처리 중 (디스크 저장 없음)
- [ ] Qoo10 시장 가격 경쟁성 스크래핑
- [ ] `getItemDetailInfo.js` 모듈 구현
- [ ] **수집 시 `coupang_categorys` 자동 기록 검증** — 2026-03-30 이후 수집된 상품의 categoryId가 `coupang_categorys` 시트에 자동으로 기록되는지 확인 필요.

---

## 현재 시트 상태 요약 (2026-04-01)
- REGISTERED: 10개
- COLLECTED: ~20개 (다음 promote 대상)
- MAX_DAILY_REGISTER: 10
