# CURRENT_TASK.md

## 현재 상태
- 2026-04-01 업데이트
- `main` 브랜치 — 10개 REGISTERED
- 브랜치 `oc/fix-bugs-b01-b02` 작업 중 (B-01 ItemTitle 빈값 + B-02 StandardImage 오수집 수정)

---

## 오늘 완료된 작업 (2026-04-01)

### B-01 ItemTitle 빈값 + B-02 StandardImage 오수집 수정 ✅ 완료 (코드)

- **B-02 원인:** `coupang-collect-discovered.js` dedup 분기의 `imageCopyFields`에 `StandardImage` 포함 → 동일 product_id의 첫 번째 상품 이미지가 다른 vendorItemId 행에 복사됨
- **B-02 수정:** `imageCopyFields`에서 `StandardImage` 제거. dedup 상품은 StandardImage 빈값(`''`)으로 유지 → `coupang:collect:one`으로 개별 재수집
- **B-01 수정:** `coupangApiClient.js` `collectProductData` / `collectPriceStockReview` 반환 직전에 ItemTitle 빈값 체크 → 빈값이면 `Error` throw → 호출부에서 status=ERROR 기록
- **editGoodsImage.js 신규 구현:** `backend/qoo10/editGoodsImage.js` — `ItemsContents.EditGoodsImage` API 래퍼. `editGoodsContents.js` 패턴과 동일.
- **qoo10-auto-register.js UPDATE 흐름:** `editGoodsImage` 호출 추가 (multiImage 업로드 직전). `registrationMessage`에 `[imageUpdate=ok|skip|fail]` 기록.
- **다음 단계:** Mac Mini에서 REGISTERED/LIVE 상품 전체 `coupang:collect:one` 재수집 → StandardImage 확인 → `qoo10:auto-register` dry-run → real 실행 → Qoo10 대표 이미지 육안 확인

---

## 오늘 완료된 작업 (2026-03-31)

### 6. 상단 썸네일 갤러리 이미지 등록 (EditGoodsMultiImage) ✅ 완료

- **원인:** 기존 `ImageUrl` 파라미터가 Qoo10 서버에서 무시됨 (`ResultCode=0` 반환하지만 실제 미반영 — UpdateGoods의 ItemQty 무시와 동일 패턴)
- **해결:** `backend/qoo10/editGoodsMultiImage.js` 파라미터 교체
  - `ImageUrl: "url1|url2|..."` → `EnlargedImage1: url1`, `EnlargedImage2: url2` ... (개별 파라미터, max 50개)
  - URL 200자 초과 건 skip, 50개 초과 분 slice
- **`scripts/qoo10-auto-register.js`** 수정
  - CREATE/UPDATE 성공 후 multiImageMethod 추적 (ok/skip/fail)
  - `registrationMessage`에 `[multiImage=ok|skip|fail]` 기록
- **검증:** real mode UPDATE 실행 후 Qoo10 상품 페이지 슬라이더 반영 확인 필요 (real mode 미검증 상태로 머지)

---

### 5. CATEGORY_CHANGED 플래그 카테고리 재resolve 버그 수정 ✅ 완료

- **원인:** UPDATE 흐름에서 `changeFlags=CATEGORY_CHANGED`를 무시하고 기존 `jpCategoryIdUsed` 그대로 UpdateGoods 호출 — resolver 재실행 로직 없음
- **해결:** `scripts/qoo10-auto-register.js` UPDATE 블록에 CATEGORY_CHANGED 분기 추가 → `CategoryResolver` 재실행 후 새 jpCategoryId로 payload 구성
- **부가 발견:** `coupang_categorys` 시트에 categoryId=519992 행이 없어 resolver가 path를 조회 불가. 원인은 해당 상품이 브레드크럼 자동 기록 기능(2026-03-30) 추가 이전에 수집된 레거시 행이었기 때문. `식품 > 견과류・시리얼 > 시리얼` 행을 수동으로 추가하여 해결.
- **결과:** FALLBACK 등록 6개 상품 중 519992 카테고리 상품 정상 재분류 확인 (jpCategoryId=300000546)

---

### 4. 기등록 7개 상품 타이틀 패치 ✅ 완료

- **원인:** OpenRouter 잔액 소진으로 `[titleMethod=fallback]` 으로 등록됨 (`韓国商品 300g 1개` 형식)
- **해결:** OpenRouter 잔액 충전 후 `registrationMessage`에 `[titleMethod=fallback]` 포함된 7개 행에 `needsUpdate=YES` + `changeFlags=TITLE_CHANGED` 설정 → `npm run qoo10:auto-register` 실행
- **결과:** 7/7 SUCCESS — 모두 일본어 SEO 타이틀로 업데이트 완료
  - `titleTranslator.js` 코드 변경 없음 (OpenRouter 그대로 유지)

---

### 3. 상세페이지 일본어 콘텐츠 생성 + Qoo10 반영 ✅ 완료

- **`backend/qoo10/descriptionGenerator.js`** 신규 구현
  - ExtraImages 있음 → OpenRouter vision (Claude Haiku) → 일본어 HTML 생성
  - ExtraImages 없음 → ItemTitle + ItemDescriptionText 텍스트 기반 생성
  - API 실패 시 `{ html: '', method: 'skip' }` 반환 (파이프라인 중단 없음)
  - 생성된 일본어 텍스트 뒤에 ExtraImages를 `<p><img src="..." /></p>` 형식으로 이어붙임

- **`backend/qoo10/editGoodsContents.js`** 신규 구현
  - `ItemsContents.EditGoodsContents` API 래퍼
  - 핵심: 파라미터명 `Contents` (≠ `ItemDescription`) — 검증 완료

- **`scripts/qoo10-auto-register.js`** 수정
  - CREATE/UPDATE 성공 후 `generateJapaneseDescription` + `editGoodsContents` 자동 호출
  - `registrationMessage`에 `[descMethod=vision|text|skip]` 기록

- **검증:** Qoo10 상품 1197862497 상세페이지에서 일본어 설명 + 이미지 정상 표시 확인

- **주요 트러블슈팅:**
  - `descriptionGenerator.js`는 `OPENROUTER_API_KEY` 사용 (Anthropic SDK 아님)
  - 쿠팡 CDN 이미지 → OpenRouter가 직접 fetch 불가 → 로컬 base64 다운로드 후 전달
  - `/q89/` URL은 고해상도(5MB+) → 항상 `/400x400ex/`로 교체
  - 5MB 초과 이미지는 건너뛰지 않고 URL 해상도 파라미터 축소 후 재시도
  - `EditGoodsContents` 파라미터명 `Contents` (아닐 경우 ResultCode=-99 `Contentsは必須です`)
  - `<img>` 태그 형식: `<p><img src="..." /></p>` (style 속성 없음, self-closing)
  - 쿠팡 CDN URL은 Qoo10 상세페이지에서 정상 렌더링됨 — 외부 CDN 차단 아님 (1198587484 검증)
  - `DetailImages` 컬럼은 스키마에 있지만 수집기가 채우지 않음 → ExtraImages 사용
  - 이미지는 base64 메모리 방식으로 처리 (디스크 저장 없음)

---

## 이전 완료 작업

### 2026-03-30
- **collect 후 Chrome 탭 로딩 스피너 멈춤 수정** — `about:blank` navigate로 해결 (PR #11)
- **이미지 미반영 버그 수정** — `editGoodsMultiImage.js` 신규 구현, CREATE/UPDATE 후 자동 호출
- **categoryId 브레드크럼 추출** — `coupangApiClient.js` + `coupang-collect-discovered.js`

---

## 다음 작업

### 🟡 우선순위 보통

## 보류 (운영 안정화 후)

- [ ] **AUTO_REGISTER_ENABLED 플래그 추가** — cron 붙일 때
- [ ] **1195611873 카테고리 수동 재분류** — category_mapping 시트 MANUAL 수정
- [ ] **가격 상수 config 시트 이관** — pricingConstants.js 하드코딩 → 런타임 로드
- [ ] **일본어 이미지 재생성** — 한국어 상세 이미지를 일본어로 재생성할 때
  이미지 파일 저장 경로 구조 + 정리 정책 + Sheets 연동 방식 함께 설계.
  현재는 base64 메모리 방식으로 vision 처리 중 (디스크 저장 없음)
- [ ] **상단 썸네일 갤러리 이미지 real mode 검증** — UPDATE 실행 후 Qoo10 슬라이더 표시 확인. EnlargedImage 파라미터로 교체 완료, 반영 여부 미확인.
- [ ] Qoo10 시장 가격 경쟁성 스크래핑
- [ ] `getItemDetailInfo.js` 모듈 구현
- [ ] **수집 시 `coupang_categorys` 자동 기록 검증** — 2026-03-30 이후 수집된 상품의 categoryId가 `coupang_categorys` 시트에 자동으로 기록되는지 확인 필요. 미기록 시 `coupangApiClient.js` 브레드크럼 추출 코드 점검. (레거시 행은 수동 추가로 대응)

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
- 519992 카테고리 매핑 미완료 시 FALLBACK으로 등록됨 (2번 작업 선행 권장)