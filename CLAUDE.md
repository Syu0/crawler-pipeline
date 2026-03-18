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
| 쿠팡 수집 | Playwright + stealth + yamyam 크롬 익스텐션 (쿠키 갱신) → 서버사이드 수집 |
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
- 브라우저를 사용하는 스크립트는 반드시 `browserGuard.assertBrowserRunning()`으로 시작한다.
  새 Playwright 인스턴스 생성 = Akamai 블록 트리거.

---

## 9. 현재 진행 상태 (2026-03 기준)

### 9-A. crawler-pipeline 완료 항목

- [x] `SetGoodsPriceQty` 재고/가격 업데이트 API 래퍼 구현 및 실제 검증 완료
- [x] 브라우저 데몬 가드 (`browserGuard.js`) — 데몬 미실행 시 즉시 종료 + 안내
- [x] 쿠팡 서버사이드 수집 기반 구축
  - Playwright + stealth + cookieStore 쿠키 주입으로 Akamai 우회 성공
  - 가격 셀렉터 타이밍 이슈 수정 완료 (`.final-price-amount` + `waitForSelector`)
  - yamyam 크롬 확장으로 쿠키 원클릭 갱신 (`chrome-extension/yamyam/`)
  - 쿠키 만료 이메일 알림 구현 (meaningful.jy@gmail.com, D-3/D-0)
  - 기본 수집 필드 동작 확인: ItemTitle / ItemPrice / StandardImage / ItemDescriptionText
- [x] 키워드 기반 탐색 파이프라인 (`coupang-keyword-discover.js`)
  - `keywords` 시트 ACTIVE 키워드 → 쿠팡 검색 → 필터 체인 → DISCOVERED 저장
  - 필터 조건값 `config` 시트 런타임 로드 (코드 수정 없이 변경 가능)
  - IP 블록 감지 + 재시도 (`blockDetector.js`): 1시간 대기 × 2회 → 이메일 알림
- [x] DISCOVERED → COLLECTED 수집기 (`coupang-collect-discovered.js`)
- [x] 시트 스키마 표준화 (`sheetSchema.js`) + `setup-sheets.js` 자동화
- [x] status ENUM 파이프라인 전체 연결
- [x] 재고 모니터링 품절 감지 구현 (`coupang-stock-monitor.js`)
  - 접근법: 상품 상세 페이지 HTML에서 품절 셀렉터 파싱 (Playwright, Akamai 우회)
  - 감지 동작 확인 완료 / Qoo10 qty 연결은 미완

### 9-B. 현재 작업 순서

- [ ] **1순위** `쿠팡 블록 대응 강화`
  - 현재: 블록 감지 → 1시간 대기 × 2회 → 포기 + 이메일 알림 → 파이프라인 중단
  - 목표: 블록 상황에서도 파이프라인이 멈추지 않도록 대응 전략 강화
  - 수정 대상: `blockDetector.js`, `coupang-collect-discovered.js` 흐름 제어
  - **선행 이유**: 블록 대응이 안정화되어야 수집 보강 테스트 결과를 신뢰할 수 있음
    (새 셀렉터 실패 원인이 블록인지 코드 문제인지 구분 불가 → 디버깅 오염 방지)

- [ ] **2순위** `쿠팡 수집 보강`
  - 미수집 필드 추가: Options, ExtraImages, 상세 이미지 URL, 리뷰 5개, 문의글 5개
  - 수집 실패 시 해당 필드 null 처리 (전체 row 실패로 이어지지 않도록)
  - **3순위 Update API 테스트의 전제조건**: 수집 필드가 늘어나야 Update API 검증 대상이 생김

- [ ] **3순위** `일본어 상품 타이틀 변환`
  - **문제**: 한국어 타이틀 그대로 등록 → 일본 Qoo10 검색 노출 불가
  - **요건**: 자연어 번역 아님 — 일본어 검색 키워드 중심의 SEO 최적화 타이틀
  - **채택 방식**: 하이브리드 (브랜드명/숫자/단위 regex 추출 → Claude API SEO 프롬프트 → 카테고리 템플릿 fallback)
  - **구현 위치**: `backend/qoo10/titleTranslator.js` 신규 모듈 → `qoo10-auto-register.js` 등록 직전 삽입

- [ ] **4순위** `Qoo10 Update API 로직 추가`
  - 현재 구현된 `SetGoodsPriceQty` 외 API 목록 검토
  - 래퍼 추가: `UpdateGoods`, `EditGoodsContents`
  - CLAUDE.md 섹션 5 `UpdateGoods 필드별 실제 API 매핑` 기준 준수

- [ ] **5순위** `재고 모니터링 → Qoo10 qty=0 연결`
  - 품절 감지 결과 → `SetGoodsPriceQty(qty=0)` 호출
  - 시트 status → OUT_OF_STOCK 전이
  - 재판매 감지 시 → qty=100 + LIVE 복구

- [ ] **6순위** `COLLECTED → Qoo10 등록 파이프라인 자동 연결` (운영 직전)
  - **포인트**: 현재 `qoo10-auto-register.js`는 status ENUM 흐름과 분리 — 수동 실행만 가능
  - 목표: COLLECTED 상태 자동 감지 → REGISTERING 락 → 등록 → REGISTERED 전이 end-to-end 자동화
  - **착수 조건**: 1~5순위 완료 후 — 수집/품질/업데이트 파이프라인이 안정화된 시점

- [ ] **7순위** `Qoo10 시장 가격 경쟁성 검증`
  - **채택 방식**: Qoo10 검색 스크래핑 자동화 (동일/유사 키워드 → 상위 N개 가격 수집 → 우리 가격 비교)
  - **판단 로직**: 경쟁 불가 → 상품 교체 플래그 or 번들 기획 제안
  - **선행 요건**: 1~5순위 파이프라인 안정화 이후 착수
  - **난이도**: 높음

### 9-C. dashboard 작업

- [ ] Chat 탭 OpenClaw 세션 연동 — `/api/openclaw/*` Vercel API Route 프록시

### 9-D. 보류

- [ ] UpdateGoods / EditGoodsContents / GetItemDetailInfo 테스트 스크립트 (3순위 작업 시 함께 진행)

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

*마지막 업데이트: 2026-03-16 | 작업 우선순위 최종 확정*

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

- [ ] **검색결과 페이지 수 (maxPages) 운영 기준**
  - 현재: 기본값 2페이지 (listSize=60 → 최대 120개 후보)
  - 검토 필요: 키워드별 페이지 수 설정 or `config` 시트 관리

### 에이전트 위임 시 고려사항

- `keywords` 시트 ACTIVE 키워드를 에이전트가 주기적으로 읽어 자동 수집 실행 가능
- 에이전트가 새 키워드 제안 → 시트에 `status=PENDING`으로 추가 → 사용자가 ACTIVE 전환
- 필터 조건 변경은 `config` 시트에서만 → 에이전트/사용자 모두 코드 없이 조정 가능
- `--dry-run` 모드로 에이전트가 결과 미리 확인 후 사용자 승인 받는 흐름 가능
- IP 블록 감지 시: 1시간 대기 × 2회 재시도 → 포기 + 이메일 알림 (meaningful.jy@gmail.com)
- 블록 감지 시점: warming 단계 + 검색 페이지 파싱 0개 시 둘 다 체크 (`blockDetector.js`)
- 블록 판단 기준: HTML < 1000bytes OR 차단 키워드 포함 OR 비정상 URL 리다이렉트
- 테스트용: `--test-block-wait` 플래그로 대기 시간을 5초로 단축 가능
