# CLAUDE.md — Coupang → Qoo10 Auto Registration Project

> 이 파일은 Claude Code(및 OpenClaw)가 프로젝트 맥락을 즉시 파악할 수 있도록 작성된 컨텍스트 문서다.
> 새 세션 시작 시 이 파일을 먼저 읽고 작업을 이어가라.

---

## 참조 문서 가이드

> 이 파일(CLAUDE.md)은 매 세션 자동 로드되는 핵심 컨텍스트다.
> 아래 상황별로 추가 문서를 참조하라. 해당 상황이 아니면 읽지 않아도 된다.

| 상황 | 참조 문서 |
|------|-----------|
| 시스템 구조·기술스택·대시보드·에이전트 구성 파악 | `docs/ARCHITECTURE.md` |
| Google Sheets 컬럼·스키마 확인 | `docs/SHEET_SCHEMA.md` |
| Qoo10 API 필드별 엔드포인트 매핑 | `docs/QOO10_FIELD_API_MAP.md` |
| 운영 중 오류 대응·데몬 재시작·cron 설정 | `docs/RUNBOOK.md` |
| Mac Mini 신규 환경 세팅 (사람 전용) | `docs/USER_LOCAL_SETUP_STEPS.md` |

> `USER_LOCAL_SETUP_STEPS.md`는 **사람이 "이 프로젝트 어떻게 세팅해?"라고 물을 때** 참고하는 파일이다.
> 에이전트는 이 파일을 읽을 필요 없다.

---

## 1. 프로젝트 목적

쿠팡 로켓배송 상품을 **자동으로 수집 → Qoo10 Japan에 API로 등록 → 상태 모니터링 → 업데이트**하는 풀 자동화 파이프라인 구축.

**1차 목표 (MVP):**
판매 가능 상품 탐색 → 수집 → 등록 → 검수 → 상태 모니터링 → 재고/가격 업데이트 워크플로우 완성.

**2차 목표:**
각 단계에 전략(Strategy) 레이어 추가.

---

## 2. 전체 워크플로우

```
[STEP 1] 쿠팡 키워드 검색
         → 로켓배송 상품만 필터링
         → Google Sheets (coupang_datas) 에 등록

[STEP 2] Google Sheets 데이터 읽기
         → Qoo10 API (SetNewGoods) 로 상품 등록
         → 등록된 qoo10ItemId를 시트에 write-back

[STEP 3] 등록 상품 쿠팡 판매 상태 주기적 확인
         → 품절/삭제 감지 시 Qoo10 재고 qty=0 업데이트

[STEP 4] 등록 상품 자동 검수
         → 가격 경쟁력 / 제목 검색성 / 상세페이지 유효성 확인
         → 룰 기반 검수 (LLM 사용 안 함)
```

---

## 3. 기술 스택

→ `docs/ARCHITECTURE.md` 참조.

---

## 4. Google Sheets 구조

**스프레드시트명:** `[러프다이먼드] 쿠팡상품 자동 수집리스트 managed by judy`
**주요 시트:** `coupang_datas`

### 상품 상태 머신 (status ENUM)

상품은 반드시 아래 단일 status 값 하나만 가진다. **불린 플래그 복수 사용 금지.**

```
DISCOVERED       → 검색결과에서 발견
COLLECTED        → 쿠팡 상세 수집 완료
PENDING_APPROVAL → 수집 완료, 일일 한도 내 대기 중. 시트에서 REGISTER_READY로 변경하면 등록 대상
REGISTER_READY   → Qoo10 등록 필수값 충족 (수동 승인 완료)
REGISTERING      → 등록 시도 중 (락 상태 — 중복 작업 금지)
REGISTERED       → Qoo10 등록 성공
VALIDATING       → 검수 진행 중 (락 상태)
LIVE             → 판매 유지 중
OUT_OF_STOCK     → 쿠팡 품절/판매불가 감지 → Qoo10 qty=0
DEACTIVATED      → 삭제/복구 불가 → Qoo10 qty=0 고정 (수동으로만 해제)
ERROR            → 복구 가능한 실패 상태
```

> `REGISTERING`, `VALIDATING`은 락 상태. 중복 실행 방지 필수.
> `DEACTIVATED`는 코드가 자동으로 되살리지 않는다.

---

## 5. Qoo10 API 핵심 정보

**Base URL:**
```
https://api.qoo10.jp/GMKT.INC.Front.QAPIService/ebayjapan.qapi
```

**Content-Type:** `application/x-www-form-urlencoded; charset=UTF-8`
**QAPIVersion:** `1.1`
**인증 헤더:** `GiosisCertificationKey`

### 주요 API 메서드

| 메서드 | 용도 |
|--------|------|
| `ItemsBasic.SetNewGoods` | 신규 상품 등록 |
| `ItemsBasic.UpdateGoods` | 상품 수정 (Title 업데이트 유효) |
| `ItemsOrder.SetGoodsPriceQty` | 가격 / 재고 수량 업데이트 |
| `ItemsContents.EditGoodsContents` | 상세페이지 내용 수정 |
| `ItemsLookup.GetItemDetailInfo` | 등록 상품 상세 조회 (read-back 검증용) |
| `ItemsLookup.GetAllGoodsInfo` | 전체 상품 목록 조회 |

### 알려진 에러 & 해결법

| 에러 | 원인 | 해결 |
|------|------|------|
| `ResultCode: -10101` / `Processing Error [-112] 7|17` | SetNewGoods 필수 파라미터 누락 또는 인코딩 오류 | SellerAuthKey(SAK) 확인, Content-Type charset 확인, 필수 필드 재검증 |
| `ResultCode: -99` / `SecondSubCatは必須です` | UpdateGoods 호출 시 2차 카테고리 누락 | UPDATE payload에 `SecondSubCat` 강제 포함. 먼저 `GetItemDetailInfo`로 현재 값 조회 후 사용 |
| `Login IDは必須です` | 인증키 타입 불일치 (API Key vs SAK) | 상품등록 API에는 SAK(판매자 인증키) 사용 |

### UpdateGoods 필드별 실제 API 매핑 (검증 완료)

```
ItemTitle        → ItemsBasic.UpdateGoods       ✅ overwrite-safe 확인
ItemQty          → ItemsOrder.SetGoodsPriceQty
ItemDescription  → ItemsContents.EditGoodsContents
```

> `UpdateGoods`는 Title 업데이트 전용으로만 안정적으로 동작한다.
> 재고/가격/상세는 반드시 전용 API를 사용하라.

### 테스트 안전장치

```
QOO10_TEST_ITEMCODE=1194045329   # 테스트 전용 상품
QOO10_ALLOW_REAL_REG=1           # 실행 승인 플래그 (없으면 dry-run)
write calls 쿼터: 10회/세션
```

---

## 6. 대시보드

→ `docs/ARCHITECTURE.md` §G Dashboard 참조.

---

## 7. 에이전트 구성

→ `docs/ARCHITECTURE.md` §H Agent Configuration 참조.

---

## 8. 개발 규칙

- Google Sheet가 **단일 진실원(SSOT)**. DB 없음.
- 상품 상태는 **단일 status ENUM** 하나만 사용. 불린 플래그 금지.
- 검수는 **룰 기반**. LLM 판단 사용 안 함.
- 처리량 목표: **MVP 10개/일 → Scale 100개/일**
- `REGISTERING` / `VALIDATING` 상태는 **락**. 중복 실행 금지.
- `DEACTIVATED`는 코드가 자동 해제 금지. 사람이 수동으로만 풀기.
- Emergent 프롬프트 작성 시: **수정 범위 명시 + 아키텍처 변경 금지 지시 포함**.
- 군더더기 없이 바로 구현. 한 줄이면 한 줄로 끝낸다.
- 브라우저를 사용하는 스크립트는 반드시 `browserGuard.assertBrowserRunning()`으로 시작한다.
  새 Playwright 인스턴스 생성 = Akamai 블록 트리거.
- 쿠키 갱신은 `coupang-cookie-refresh.js` 스크립트로 수행한다 (yamyam 확장 대체).
  OpenClaw 위임 가능: 수집 전 `npm run cookie:refresh` 실행 → sid 없으면 텔레그램 알림 → 사람 개입 대기.
- 수집 스크립트의 상품 간 딜레이는 `delay.js`의 `randomDelay(4000, 10000)`을 사용한다.
  dry-run 모드에서는 500ms 고정.
- 동일 `coupang_product_id`를 가진 vendorItemId 변형들은 세션 내에서 중복 Playwright 접근을 하지 않는다.
  첫 번째 수집 후 나머지는 `registrationMessage=[dedup]` + status=COLLECTED 처리.
- collect 스크립트는 행 처리 전마다 데몬 잔여시간을 체크한다.
  잔여 2분 이하 시 Graceful Exit (EXIT_REASON=DAEMON_EXPIRING). 재개 시 DISCOVERED 행이 남아있으면 자동으로 이어서 처리.
- daemon `running: true`는 프로세스 생존만을 의미한다. 수집 재개 가능 여부는 반드시
  `collectSafe` 값으로 판단한다. HARD_BLOCK 발생 시 `collectSafe: false`가 설정되며
  쿨다운(1시간) 이후 자동으로 `CLEAR`로 전환된다.
- blockState는 `backend/.browser-block-state.json`에 저장된다 (Sheets 비저장).
  collect 시작 전 pre-flight 체크 필수 (`blockStateManager.assertCollectSafe()`).
- HARD_BLOCK 감지 시 `blockStateManager.setHardBlocked()`로 쿨다운 기록. 쿨다운 중 collect 실행 시 즉시 종료.

---

## 9. 현재 진행 상태 (2026-03 기준)

### 9-A. crawler-pipeline 완료 항목

- [x] `SetGoodsPriceQty` 재고/가격 업데이트 API 래퍼 구현 및 실제 검증 완료
- [x] 브라우저 데몬 가드 (`browserGuard.js`) — 데몬 미실행 시 즉시 종료 + 안내
- [x] 블록 감지 즉시 이메일 발송 + 종료 (재시도 2회 제거)
- [x] 쿠키 유효성 자동 체크 — 만료 시 이메일 알림 + 수집 중단 (`browserManager.launch()` warming 전)
- [x] 수집 랜덤 딜레이 (`delay.js`) — 상품 간 4~10초, dry-run 500ms 고정
- [x] 쿠팡 서버사이드 수집 기반 구축
  - Playwright + stealth + cookieStore 쿠키 주입으로 Akamai 우회 성공
  - 가격 셀렉터 타이밍 이슈 수정 완료 (`.final-price-amount` + `waitForSelector`)
  - yamyam 크롬 확장 → **스크립트 기반 쿠키 갱신으로 교체** (`coupang-cookie-refresh.js`)
    - Chrome 데몬에 CDP로 attach → coupang.com 쿠키 추출 → cookieStore 저장
    - `npm run cookie:refresh` (만료 시에만) / `npm run cookie:refresh:force` (강제 갱신)
    - sid 쿠키 없음(로그인 만료) 시 텔레그램 알림 → 사람이 Chrome에서 재로그인
    - 갱신 성공 시 HARD_BLOCK 쿨다운 자동 해제
    - yamyam 확장은 Chrome에서 수동 로그인 후 **재로그인 보조용**으로만 잔존
  - 쿠키 만료 이메일 알림 구현 (meaningful.jy@gmail.com, D-3/D-0)
  - 기본 수집 필드 동작 확인: ItemTitle / ItemPrice / StandardImage / ItemDescriptionText
- [x] 키워드 기반 탐색 파이프라인 (`coupang-keyword-discover.js`)
  - `keywords` 시트 ACTIVE 키워드 → 쿠팡 검색 → 필터 체인 → DISCOVERED 저장
  - 필터 조건값 `config` 시트 런타임 로드 (코드 수정 없이 변경 가능)
  - IP 블록 감지 + 재시도 (`blockDetector.js`): 1시간 대기 × 2회 → 이메일 알림
- [x] DISCOVERED → COLLECTED 수집기 (`coupang-collect-discovered.js`)
- [x] 시트 스키마 표준화 (`sheetSchema.js`) + `setup-sheets.js` 자동화
- [x] status ENUM 파이프라인 전체 연결
- [x] 재고 모니터링 → Qoo10 qty 연결 (`coupang-stock-monitor.js`, 브랜치: oc/stock-monitor-qoo10)
  - 접근법: 상품 상세 페이지 HTML에서 품절 셀렉터 파싱 (Playwright, Akamai 우회)
  - OUT_OF_STOCK 감지 → SetGoodsPriceQty(qty=0) → status OUT_OF_STOCK 전이
  - IN_STOCK 복구 감지 → SetGoodsPriceQty(qty=100) → status LIVE 전이
  - qoo10ItemId 없음 / API 실패 시 status 변경 없이 errorMessage만 기록
  - dry-run 지원, row 독립 try-catch
- [x] 일본어 타이틀 변환 모듈 (`backend/qoo10/titleTranslator.js`)
  - 방식: regex 추출 → Claude Haiku API → 카테고리 템플릿 fallback
  - 등록 직전 `qoo10-auto-register.js`에 삽입
  - API 실패 시에도 파이프라인 중단 없음 (fallback → 원본 타이틀 순)
  - `registrationMessage`에 `[titleMethod=api|fallback]` prefix 기록
- [x] Qoo10 Update API 래퍼 완성 (브랜치: oc/update-api-wrappers)
  - `updateGoods.js` → `updateExistingGoods()` / `buildUpdateGoodsParams()`: UpdateGoods 호출. SecondSubCat은 파라미터에서 직접 resolve (`jpCategoryIdUsed` 컬럼 사용), getItemDetailInfo 별도 조회 없음.
  - `qoo10-auto-register.js` UPDATE 흐름: changeFlags 기반 분기 **미구현** — needsUpdate=YES이면 UpdateGoods 전체 실행. changeFlags는 단순히 처리 후 `''`로 클리어만 됨.
  > **⚠️ changeFlags 분기 미구현 (추후 논의 필요)**
  > 설계 의도: 플래그별로 호출 API를 분리 (TITLE_CHANGED → UpdateGoods, DESC_CHANGED → EditGoodsContents, PRICE_UP/DOWN → SetGoodsPriceQty)
  > 현재 실제 동작: 플래그 무관, UpdateGoods 전체 호출 후 changeFlags='' 클리어
  > **허용값:** `PRICE_UP` | `PRICE_DOWN` | `TITLE_CHANGED` | `DESC_CHANGED` | `CATEGORY_CHANGED`
  > 복수 플래그는 파이프(`|`)로 구분.
  > `CATEGORY_CHANGED`: 현재 자동 처리 코드 없음 → 수동 트리거.
  > 전체 목록은 config 시트 `VALID_CHANGE_FLAGS` 키 참고.
  > **⚠️ 미구현 래퍼:** `getItemDetailInfo.js`, `editGoodsContents.js` 파일 없음. EditGoodsContents API 호출 경로 현재 없음.
- [x] 인벤토리 관리 qoo10_inventory 시트 + 동기화/qty처리 스크립트 | 브랜치: oc/qoo10-inventory-mgmt

### 9-B. 현재 작업 순서 (2026-03-18 기준)

#### ✅ 완료
- [x] **1순위** 쿠팡 블록 대응 강화 | 브랜치: oc/block-handling → oc/browser-guard (머지 완료)
  - 블록 감지 즉시 종료, 쿠키 유효성 자동 체크, 브라우저 데몬 가드 (`browserGuard.js`), 랜덤 딜레이 (`delay.js`)
- [x] **2순위** 쿠팡 수집 보강 | 브랜치: oc/collection-enhance | 커밋: 395bb2f
- [x] **3순위** 일본어 타이틀 변환 (`titleTranslator.js`) | 브랜치: oc/collection-enhance
- [x] **4순위** Qoo10 Update API 래퍼 완성 | 브랜치: oc/update-api-wrappers
- [x] **5순위** 재고 모니터링 → qty=0 연결 (`coupang-stock-monitor.js`) | 브랜치: oc/stock-monitor-qoo10
- [x] **인벤토리 관리** qoo10_inventory 시트 + 동기화/qty처리 스크립트 | 브랜치: oc/qoo10-inventory-mgmt
- [x] **선행①** 타이틀 변환 미적용 상품 원인 파악
  - 결론: 코드 버그 없음. 시트 ItemTitle은 원본 한국어 유지(설계 의도), Qoo10 실제 타이틀은 일본어 정상 적용.
  - 레거시 4개(머지 이전 등록): 운영 중 Update 흐름 실행 시 자동 갱신됨
- [x] **선행②** 재고 모니터 실검증
  - IN_STOCK 유지 정상 확인. OUT_OF_STOCK 전이 경로는 dry-run 검증 완료.
  - 추가 발견: 1195611873 카테고리 미스매치 (category_mapping 시트 MANUAL 수정 필요)
- [x] **6순위** COLLECTED → Qoo10 등록 파이프라인 자동 연결 | 브랜치: oc/auto-register-pipeline (머지 완료)
  - `coupang-promote-to-pending.js`: COLLECTED → PENDING_APPROVAL (MAX_DAILY_REGISTER 한도)
  - `qoo10-auto-register.js`: REGISTER_READY만 처리 (COLLECTED 건너뜀)
  - `setup-sheets.js`: MAX_DAILY_REGISTER 기본값 추가 + --force-defaults 옵션
  - fix: qoo10ItemId 있는 행이 CREATE 큐에 중복 진입하던 버그 수정

#### 🔄 대기 중

- [ ] **[추후 연동]** PENDING_APPROVAL 승인 자동화
  - 현재: 시트에서 수동으로 REGISTER_READY 변경
  - 검토: 대시보드 승인 버튼 or Slack 액션 연동
  - 착수 조건: 대시보드 개발 단계 또는 운영 자동화 필요 시점

- [ ] **[cron 붙일 때]** AUTO_REGISTER_ENABLED 플래그 추가
  - config 시트에 `AUTO_REGISTER_ENABLED` 키 추가 (true/false)
  - promote 스크립트 실행 시작 시점에 이 값을 읽어 false면 즉시 종료 (cron 긴급정지용)
  - false 시 출력: `[promote] 비활성화 상태입니다 (AUTO_REGISTER_ENABLED=false). config 시트에서 true로 변경하면 재개됩니다.`
  - setup-sheets.js 기본값에도 추가

- [ ] **[추후 작업] 가격 상수 config 시트 이관**
  - 현재: `backend/pricing/pricingConstants.js`에 하드코딩
    (`MARKET_COMMISSION_RATE=0.10`, `TARGET_MARGIN_RATE=0.20`, `MIN_MARGIN_RATE=0.25`, `FX_JPY_TO_KRW=10`)
  - 목표: `config` 시트에서 런타임 로드 — 코드 수정 없이 수수료율·환율·마진 조정 가능
  - 착수 조건: 운영 안정화 후

- [ ] **[전략] 일본어 상세페이지 콘텐츠 생성**
  - 착수 조건: 6순위 자동 연결 완료 후
  - 구현 위치: `backend/qoo10/contentStrategy.js`
  - 트리거: DetailImages < 3개 OR ItemDescriptionText < 100자

#### ⏸ 보류 (운영 안정화 후)
- [ ] **7순위** Qoo10 시장 가격 경쟁성 자동 스크래핑
- [ ] **운영 후** 카테고리 특화 전략, 마케팅, 상세페이지 품질 향상

#### 📋 별도 논의 (코드 작업 아님)
- [ ] **시장 조사** 키워드/카테고리 전략 수립
  - 현재 등록 카테고리: 텀블러, 자동차용품 계열
  - 논의 필요: 이 방향 유지 vs 새 카테고리 진입
  - 진행 방식: 새 채팅에서 별도 논의 후 keywords 시트에 반영
- [ ] **카테고리 미스매치 수동 수정**: 1195611873 (자동차 기어노브) → category_mapping 시트에서 jpCategoryId를 자동차 카테고리로 MANUAL 변경

### 9-C. dashboard 작업

- [x] `/api/openclaw/*` Vercel API Route 프록시 구현 완료
  - `health`, `send`, `history`, `session-status`, `aegis-send`, `aegis-history` 6개 엔드포인트 존재
  - 위치: `dashboard/src/app/api/openclaw/`
- [ ] Chat 탭 프론트엔드 UI — OpenClaw 연동 UI 완성 여부 별도 확인 필요

### 9-D. 보류

- [ ] `getItemDetailInfo.js` 모듈 구현 — GetItemDetailInfo API 래퍼 (현재 미존재)
- [ ] `editGoodsContents.js` 모듈 구현 — EditGoodsContents API 래퍼 (현재 미존재)
  - 구현 시 주의: large payload(일본어 상세 HTML) 처리 + 인코딩 edge case 검증 필수
- [ ] UpdateGoods / EditGoodsContents / GetItemDetailInfo 테스트 스크립트
- [ ] **[운영 매뉴얼 작성 시]** 매일 시작 절차 문서화
  - 순서 중요. 아래 명령을 매일 출근 시 / PC 재시작 후 실행해야 함:
    1. `npm run backend:start`              # yamyam 쿠키 수신 서버 (쿠키 주입 없으면 Akamai 블록)
    2. `npm run coupang:browser:start`      # Playwright 브라우저 데몬
    3. `npm run cookie:refresh`             # 쿠키 만료 시 자동 갱신 (만료 아니면 skip)
  - 3번은 OpenClaw가 수집 시작 전에도 자동 실행 가능 (위임 가능 단계)
  - sid 없음(로그인 만료) 시 텔레그램 알림 → Chrome에서 수동 재로그인 후 `cookie:refresh:force`
  - 운영 매뉴얼(RUNBOOK.md 또는 별도 OPERATIONS.md)에 정식 절차로 포함할 것

---

## 10. 레포 구조 참고

```
crawler-pipeline/
├── backend/
│   ├── coupang/
│   │   ├── blockDetector.js          # IP 블록 감지 + 재시도 에스컬레이션
│   │   ├── blockStateManager.js      # collectSafe / assertCollectSafe / setHardBlocked
│   │   ├── browserManager.js         # Playwright 브라우저 데몬 관리
│   │   ├── detailPageParser.js       # 상품 상세 HTML 파서
│   │   ├── keywordSearch.js          # 키워드 검색 로직
│   │   ├── playwrightScraper.js      # Playwright 수집 엔진
│   │   ├── productFilters.js         # 필터 체인
│   │   ├── scraper.js
│   │   ├── sheetsClient.js
│   │   ├── sheetSchema.js            # status ENUM + 컬럼 정의
│   │   └── stockChecker.js           # 품절 셀렉터 파싱
│   ├── qoo10/
│   │   ├── client.js                 # QAPI HTTP 클라이언트
│   │   ├── payloadGenerator.js       # SetNewGoods 파라미터 빌더
│   │   ├── registerNewGoods.js       # SetNewGoods 래퍼
│   │   ├── titleTranslator.js        # KR→JP 타이틀 변환 (Claude Haiku)
│   │   └── updateGoods.js            # UpdateGoods 래퍼 (updateExistingGoods)
│   │   # ⚠️ 미존재: getItemDetailInfo.js, editGoodsContents.js
│   ├── category/
│   │   ├── japanCategoriesSync.js
│   │   ├── parser.js
│   │   ├── resolver.js
│   │   └── sheetClient.js
│   ├── pricing/
│   │   ├── priceDecision.js
│   │   ├── pricingConstants.js
│   │   └── shippingLookup.js
│   ├── services/
│   │   ├── cookieExpiry.js           # 쿠키 만료 이메일 알림
│   │   └── cookieStore.js
│   ├── routes/
│   │   └── cookie.js
│   ├── scripts/
│   │   ├── browserGuard.js           # assertBrowserRunning()
│   │   ├── delay.js                  # randomDelay(min, max)
│   │   ├── coupang-browser-start.js  # Playwright 데몬 시작
│   │   ├── coupang-browser-stop.js
│   │   ├── coupang-browser-status.js
│   │   ├── coupang-cookie-refresh.js # 쿠키 갱신 (CDP attach → cookieStore 저장)
│   │   ├── coupang-keyword-discover.js
│   │   ├── coupang-collect-discovered.js
│   │   ├── coupang-promote-to-pending.js
│   │   ├── coupang-stock-monitor.js
│   │   ├── setup-sheets.js
│   │   └── qoo10.setGoodsPriceQty.js
│   └── server.js                     # yamyam 쿠키 수신 서버
├── scripts/                           # 루트 레벨 (레거시/유틸)
│   ├── qoo10-auto-register.js         # 메인 등록 스크립트 (REGISTER_READY 처리)
│   ├── qoo10-register-cli.js
│   ├── qoo10-sync-japan-categories.js
│   └── (기타 디버그/테스트 스크립트)
├── dashboard/                         # Next.js 대시보드 (Vercel 배포)
│   └── src/app/api/
│       ├── openclaw/                  # OpenClaw 프록시 (6개 엔드포인트)
│       ├── qoo10/
│       ├── registration/
│       ├── sheets/
│       └── chat/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── SHEET_SCHEMA.md
│   ├── RUNBOOK.md
│   ├── CHANGELOG.md
│   └── (기타 문서)
└── CLAUDE.md                          # 이 파일
```

---

*마지막 업데이트: 2026-03-23 | coupang-cookie-refresh.js 반영 — yamyam 확장 → 스크립트 기반 갱신 교체, 레포 구조·개발 규칙·운영 매뉴얼 절차 업데이트*

---

## 11. 상품 탐색 전략 메모

_마지막 업데이트: 2026-03-12_

### 결정된 방향

- 수집 방식: 사용자 지정 키워드 기반 검색 (`keywords` 시트 관리)
- 1단계 필터 (검색결과 수준): 로켓배송 + 비제외카테고리 + 가격 상한
- 필터 조건값 (가격 상한, 제외 카테고리): `config` 시트에서 런타임 로드 — 코드 수정 없이 시트에서 변경
- 필터 구조: 체인 방식 (`productFilters.js`) — 조건 추가 시 이 파일만 수정
- 상태 흐름: DISCOVERED(검색발견) → COLLECTED(상세수집) 2단계 분리 구현
- SSOT: Google Sheets (`config` + `keywords` + `coupang_datas` 시트)

### 미결 결정사항

- [ ] **경쟁력 분석 로직 방향** (2차 목표)
  - 옵션 A: 등록 상품에 대해 경쟁력 검사 (가격/리뷰/재고 모니터링)
  - 옵션 B: 시장 트렌드 분석 → 키워드 자동 추천 → 사용자 승인 후 ACTIVE 전환
  - 현재 방향: 옵션 A 먼저 구현 후 옵션 B 검토

- [ ] **관세 기준가 정밀화**
  - 현재: `config` 시트 `FILTER_PRICE_KRW_MAX` 값 사용 (초기값 150,000)
  - 검토 필요: 환율 연동, 배송비 포함 판매가 기준으로 역산하는 로직

- [ ] **카테고리 제외 방식 결정**
  - 현재: `config` 시트 `EXCLUDED_CATEGORY_KEYWORDS` 값으로 이름 키워드 매칭
  - 이상적: categoryId 기반 정확한 매핑 테이블 구축

- [x] **검색결과 페이지 수 (maxPages) config 시트 이관 완료**
  - config 시트 `MAX_DISCOVER_PAGES` 키로 관리 (기본값 1)
  - 코드 수정 없이 시트에서 변경 가능

### 에이전트 위임 시 고려사항

- `keywords` 시트 ACTIVE 키워드를 에이전트가 주기적으로 읽어 자동 수집 실행 가능
- 에이전트가 새 키워드 제안 → 시트에 `status=PENDING`으로 추가 → 사용자가 ACTIVE 전환
- 필터 조건 변경은 `config` 시트에서만 → 에이전트/사용자 모두 코드 없이 조정 가능
- `--dry-run` 모드로 에이전트가 결과 미리 확인 후 사용자 승인 받는 흐름 가능
- IP 블록 감지 시: 1시간 대기 × 2회 재시도 → 포기 + 이메일 알림 (meaningful.jy@gmail.com)
- 블록 감지 시점: warming 단계 + 검색 페이지 파싱 0개 시 둘 다 체크 (`blockDetector.js`)
- 블록 판단 기준: HTML < 1000bytes OR 차단 키워드 포함 OR 비정상 URL 리다이렉트
- 테스트용: `--test-block-wait` 플래그로 대기 시간을 5초로 단축 가능
