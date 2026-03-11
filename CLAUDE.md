# CLAUDE.md — Coupang → Qoo10 Auto Registration Project

> 이 파일은 Claude Code(및 OpenClaw)가 프로젝트 맥락을 즉시 파악할 수 있도록 작성된 컨텍스트 문서다.
> 새 세션 시작 시 이 파일을 먼저 읽고 작업을 이어가라.

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

| 구분 | 내용 |
|------|------|
| 언어 | Node.js |
| 데이터 저장소 | Google Sheets (SSOT — DB 없음) |
| 쿠팡 수집 | 크롤링 (Playwright 또는 유사 도구) |
| Qoo10 연동 | QAPI (REST, form-encoded) |
| 대시보드 | Next.js + Vercel 배포 (glassmorphism UI, mobile-first) |
| 에이전트 | OpenClaw (메인 Dev Agent + Sub Agent 2개, 각 다른 LLM) |
| 레포 | `crawler-pipeline` — 작업 브랜치: `emergent` |

---

## 4. Google Sheets 구조

**스프레드시트명:** `[러프다이먼드] 쿠팡상품 자동 수집리스트 managed by judy`
**주요 시트:** `coupang_datas`

### 상품 상태 머신 (status ENUM)

상품은 반드시 아래 단일 status 값 하나만 가진다. **불린 플래그 복수 사용 금지.**

```
DISCOVERED      → 검색결과에서 발견
COLLECTED       → 쿠팡 상세 수집 완료
REGISTER_READY  → Qoo10 등록 필수값 충족
REGISTERING     → 등록 시도 중 (락 상태 — 중복 작업 금지)
REGISTERED      → Qoo10 등록 성공
VALIDATING      → 검수 진행 중 (락 상태)
LIVE            → 판매 유지 중
OUT_OF_STOCK    → 쿠팡 품절/판매불가 감지 → Qoo10 qty=0
DEACTIVATED     → 삭제/복구 불가 → Qoo10 qty=0 고정 (수동으로만 해제)
ERROR           → 복구 가능한 실패 상태
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

**URL:** Vercel 배포 (외부 접근 가능)
**UI:** Glassmorphism + iPhone 스타일, **Mobile-first** (휴대폰에서 주로 확인함)

### 탭 구성

| 탭 | 내용 |
|----|------|
| Overview | Total Rows / Registered / Needs Update / Last Sync 카드 |
| Qoo10 | 등록 실행, 상태 테이블, 실패 로그 |
| Tasks | 작업 리스트 + 진행률 |
| Logs & Alerts | 예외 발생 시 로그 + 팝업 알림 |
| Chat | OpenClaw 현재 세션 연동 (프롬프트 주입 + 컨펌) |

### 연동 환경변수 목록

```
VERCEL_TOKEN
GOOGLE_SHEETS_CLIENT_EMAIL
GOOGLE_SHEETS_PRIVATE_KEY
GOOGLE_SHEETS_SPREADSHEET_ID
OPENCLAW_BASE_URL          # Mac Mini → Tailscale Funnel URL
OPENCLAW_API_TOKEN
OPENCLAW_SESSION_ID
```

> `OPENCLAW_BASE_URL`은 Mac Mini에서 Tailscale Funnel로 노출한 주소.
> Chat 탭은 클라이언트에서 직접 Tailscale URL 호출 금지 → `/api/openclaw/*` Vercel API Route 프록시로만 호출.

---

## 7. 에이전트 구성 (OpenClaw)

| 에이전트 | 역할 |
|---------|------|
| Main Dev Agent | 핵심 로직 설계 및 구현, Qoo10 API 통합 |
| Sub Agent A | 쿠팡 크롤링, 로켓배송 필터링, Sheets 업로드 |
| Sub Agent B | 상태 모니터링, 재고 확인, Qoo10 재고 업데이트, 검수 |

각 에이전트는 **서로 다른 LLM**을 사용. Task Unit 기반으로 분리 실행.

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

---

## 9. 현재 진행 상태 (2026-03 기준)

### 9-A. crawler-pipeline 우선 작업

- [x] **1순위** 재고/가격 업데이트 — `SetGoodsPriceQty` 기능 완성 및 실제 API 검증 완료
- [x] **2순위** 쿠팡 서버사이드 수집 완료
  - Playwright + stealth + cookieStore 쿠키 주입으로 Akamai 우회 성공
  - 가격 셀렉터 타이밍 이슈 수정 완료 (`.final-price-amount` + `waitForSelector`)
  - yam yam 크롬 확장으로 쿠키 원클릭 갱신 (`chrome-extension/yamyam/`)
  - 쿠키 만료 이메일 알림 구현 (meaningful.jy@gmail.com, D-3/D-0)
  - 수집 필드: ItemTitle / ItemPrice / StandardImage / ItemDescriptionText
  - 검증 완료: `npm run coupang:pw:dry:trace`
- [ ] **3순위** 재고 모니터링 + Qoo10 qty=0 업데이트
- [ ] **4순위** 룰 기반 자동 검수 시스템
- [ ] **보류** UpdateGoods / EditGoodsContents / GetItemDetailInfo 테스트 스크립트

### 9-B. dashboard 작업

- [ ] Chat 탭 OpenClaw 세션 연동 — `/api/openclaw/*` Vercel API Route 프록시

### 완료

- [x] Qoo10 `SetNewGoods` 기본 통합
- [x] `UpdateGoods` overwrite-safe 검증
- [x] 필드별 API 매핑 확인 (Title / Qty / Description)
- [x] 자동 필드 탐색 시스템 v2a 구축
- [x] 대시보드 초기 배포 (Vercel)
- [x] gracejudy 브랜치 통합 (dashboard + v2a docs)
- [x] `SetGoodsPriceQty` 재고/가격 업데이트 API 래퍼 구현 및 실제 검증 완료

---

## 10. 레포 구조 참고

```
crawler-pipeline/
├── backend/
│   └── scripts/
│       └── qoo10.v2a.discovery.auto.js   # 자동 필드 탐색 시스템
├── docs/
│   ├── ARCHITECTURE.md
│   ├── SHEET_SCHEMA.md
│   └── RUNBOOK.md
└── CLAUDE.md                              # 이 파일
```

---

*마지막 업데이트: 2026-03-10 | 대화 기록 기반 자동 생성*
