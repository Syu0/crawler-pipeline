# CURRENT_TASK.md

## 현재 상태
- 2026-03-30 업데이트
- `main` 브랜치 — 10개 REGISTERED (그래놀라 1개 추가)

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

#### ~~1. collect 후 Chrome 탭 로딩 스피너 멈춤 수정~~ ✅ 완료 (2026-03-30)
- 수집 완료 후 `about:blank` navigate로 pending request 정리
- Chrome 탭이 about:blank로 이동 (쿠키 유지 — 다음 수집 정상 동작)
- PR #11 머지, 브랜치 `oc/fix-chrome-tab-cleanup`

#### ~~2. 이미지 미반영 버그 (StandardImage / ExtraImages)~~ ✅ 완료 (2026-03-30)
- **원인:** ExtraImages는 SetNewGoods만으로는 업로드 불가 — 등록 후 `EditGoodsMultiImage` 별도 호출 필요
- **해결:**
  - `backend/qoo10/editGoodsMultiImage.js` 신규 구현 (`ItemsContents.EditGoodsMultiImage` 래퍼)
  - `scripts/qoo10-auto-register.js` — CREATE/UPDATE 성공 후 `editGoodsMultiImage` 호출 추가
  - `backend/qoo10/payloadGenerator.js` — `normalizeImageUrl` `//` 프로토콜 상대 URL 처리 추가
- **검증:** Qoo10 상품 상세페이지에서 ExtraImages 정상 표시 확인

### 🟡 우선순위 보통

#### 3. 상세페이지 일본어 콘텐츠 생성 + Qoo10 반영
- **배경:** 쿠팡 수집 상세페이지는 한국어 이미지 위주. 일본 소비자가 이해할 수 있는 일본어 설명 필요
- **생성 방식 (검토 옵션):**
  - 옵션 A — 코드 구현: DetailImages를 Claude API에 vision으로 전달 → 한국어 읽기 → 일본어 설명 생성
  - 옵션 B — OpenClaw 위임: OpenClaw의 이미지 이해 스킬로 이미지 보고 직접 일본어 설명 생성
    → 코드 파이프라인 없이도 가능. 두 옵션 병행 검토.
- **출력 구조:**
  - `DetailImages` 있음 → `[일본어 설명 텍스트]` + `[DetailImages]`
  - `DetailImages` 없음 → `[일본어 설명 텍스트]` + `[ExtraImages]`
- **적용 API:** `EditGoodsContents` (현재 래퍼 미구현 — `editGoodsContents.js` 신규 구현 필요)
- **선행 조건:** 2번(이미지 미반영) 해결 후 착수

#### 4. titleTranslator 401 수정 + 9개 타이틀 패치
- **증상:** `[titleTranslator] Claude API failed (OpenRouter API error: 401 Unauthorized)`
- **원인:** OpenRouter 잔액 부족 또는 키 만료
- **해결:** `backend/qoo10/titleTranslator.js` — OpenRouter 호출 제거, Anthropic API 직접 호출로 교체
  (`ANTHROPIC_API_KEY` + `@anthropic-ai/sdk` 사용, 이미 의존성 설치됨)
- **패치 대상:** 총 9개 (3/27 3개 + 오늘 6개) — 수정 후 needsUpdate=YES + changeFlags=TITLE_CHANGED 설정 → `npm run qoo10:auto-register`

### 🟢 우선순위 낮음

#### 5. category_mapping 519992 추가
- **해결:** `category_mapping` 시트에서 coupangCategoryId=519992 행에 jpCategoryId 수동 입력
  - 519992 = 시리얼/그래놀라 카테고리로 추정
  - Qoo10 Japan 카테고리 트리에서 적합한 jpCategoryId 확인 후 matchType=MANUAL 입력

---

## 보류 (운영 안정화 후)

- [ ] **AUTO_REGISTER_ENABLED 플래그 추가** — cron 붙일 때
- [ ] **1195611873 카테고리 수동 재분류** — category_mapping 시트 MANUAL 수정
- [ ] **가격 상수 config 시트 이관** — pricingConstants.js 하드코딩 → 런타임 로드
- [ ] Qoo10 시장 가격 경쟁성 스크래핑
- [ ] `getItemDetailInfo.js` 모듈 구현

---

## 현재 시트 상태 요약
- REGISTERED: 10개 (3/27 3개 + 3/30 6개 + 3/30 그래놀라 1개)
- COLLECTED: ~17개 (내일 이후 promote 대상)
- MAX_DAILY_REGISTER: 6

### COLLECTED 대기 중인 4개 (다음 promote 대상)
| vendorItemId | ItemTitle | categoryId |
|---|---|---|
| 85296814940 | 마켓오네이처 오 그래놀라 다이제 시리얼 250g, 3개 | 433958 |
| 86533289539 | 마켓오네이처 오 그래놀라 다이제 시리얼 300g, 4개 | 433958 |
| 91816835421 | 마켓오네이처 오 그래놀라 저당 통보리 시리얼 360g, 2개 | 519992 |
| 91428368907 | 원더너츠 수제 그래놀라 시리얼 플레인 | 519992 |
- 519992 카테고리 매핑 미완료 시 FALLBACK으로 등록됨 (5번 작업 선행 권장)