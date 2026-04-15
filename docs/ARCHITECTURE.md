# Architecture

## Tech Stack

| 구분 | 내용 |
|------|------|
| 언어 | Node.js |
| 데이터 저장소 | Google Sheets (SSOT — DB 없음) |
| 쿠팡 수집 | Playwright + stealth + yamyam 크롬 익스텐션 (쿠키 갱신) → 서버사이드 수집 |
| Qoo10 연동 | QAPI (REST, form-encoded) |
| 대시보드 | Next.js + Vercel 배포 (glassmorphism UI, mobile-first) |
| 에이전트 | OpenClaw (메인 Dev Agent + Sub Agent 2개, 각 다른 LLM) |
| 레포 | `crawler-pipeline` — 주 브랜치: `main` |

---

## Module Boundaries

### A) Coupang Collection (`backend/coupang/`)

쿠팡에서 상품 데이터를 수집하여 Google Sheets에 저장.

| File | Purpose |
|------|---------|
| `blockDetector.js` | IP 블록 감지 + SOFT_BLOCK → HARD_BLOCK 에스컬레이션 |
| `blockStateManager.js` | blockState 파일 기반 영속화 (`collectSafe` / `assertCollectSafe` / `setHardBlocked`) |
| `browserManager.js` | Playwright 브라우저 데몬 연결 관리 (CDP) |
| `detailPageParser.js` | 상품 상세 페이지 HTML 파서 |
| `keywordSearch.js` | 키워드 검색 결과 파싱 |
| `playwrightScraper.js` | Playwright 기반 수집 엔진 (레거시 — stock-monitor 전용으로만 잔존) |
| `coupangApiClient.js` | Browser Relay evaluate(fetch()) 기반 수집 엔진 (next-api + DOM 파싱) |
| `productFilters.js` | 필터 체인 (로켓배송 / 가격 상한 / 제외 카테고리) |
| `scraper.js` | HTTP 기반 스크래퍼 (레거시) |
| `sheetsClient.js` | Google Sheets API 래퍼 (read/write/upsert) |
| `sheetSchema.js` | status ENUM + 컬럼 정의 |
| `stockChecker.js` | 품절 셀렉터 파싱 |

Entry points:
- `backend/scripts/coupang-keyword-discover.js` — keywords 시트 → 쿠팡 검색 → DISCOVERED
- `backend/scripts/coupang-collect-discovered.js` — DISCOVERED → COLLECTED
- `backend/scripts/coupang-promote-to-pending.js` — COLLECTED → PENDING_APPROVAL
- `backend/scripts/coupang-stock-monitor.js` — LIVE/REGISTERED 재고 모니터링
- `backend/scripts/coupang-collect-one.js` — vendorItemId 지정 단일 상품 강제 재수집

> ⚠️ **수집 방식 변경 (2026-03-26)**
> Playwright headless 상세 페이지 접근 → Browser Relay evaluate(fetch()) 방식으로 교체.
> Akamai TLS 핑거프린트 차단 확인으로 인한 구조적 변경.
>
> 사용 API:
> - `next-api/products/quantity-info` — ItemTitle·ItemPrice·StockStatus
> - `next-api/review` — ReviewCount·ReviewAvgRating
> - DOM 파싱 (Browser Relay) — StandardImage·ExtraImages
>
> 폐기된 API: `other-seller-info`, `btf`, `vp/products/*/quantity-info` (모두 404)
>
> 운영 전제: 하루 1회 사람이 Chrome 쿠팡 로그인 탭에서 Browser Relay attach 필요.

---

### B) Qoo10 Registration (`backend/qoo10/`)

Qoo10 QAPI를 통해 상품 등록/수정.

| File | Purpose |
|------|---------|
| `client.js` | Qoo10 QAPI HTTP 클라이언트 (form-encoded POST) |
| `payloadGenerator.js` | SetNewGoods 파라미터 빌더 |
| `registerNewGoods.js` | SetNewGoods API 래퍼 (CREATE) |
| `titleTranslator.js` | KR→JP 타이틀 변환 (Claude Haiku API + 카테고리 템플릿 fallback) |
| `updateGoods.js` | UpdateGoods API 래퍼 (UPDATE) — `updateExistingGoods()`, `buildUpdateGoodsParams()` |
| `editGoodsContents.js` | EditGoodsContents 래퍼 (일본어 상세 HTML + 이미지) |
| `editGoodsImage.js` | EditGoodsImage 래퍼 (대표이미지 업데이트) |
| `editGoodsMultiImage.js` | EditGoodsMultiImage 래퍼 (슬라이더 이미지 EnlargedImage1~50) |
| `descriptionGenerator.js` | 일본어 상세페이지 HTML 생성 (vision/text via OpenRouter) |

> ⚠️ **미존재:** `getItemDetailInfo.js` (GetItemDetailInfo 래퍼)
> SecondSubCat은 시트 `jpCategoryIdUsed` 컬럼에서 직접 resolve. GetItemDetailInfo 조회 없음.

Entry points:
- `scripts/qoo10-auto-register.js` — 메인 등록/업데이트 실행기 (REGISTER_READY 처리)
- `scripts/qoo10-register-cli.js` — 단일 상품 CLI 등록 (테스트용)

---

### C) Category Resolution (`backend/category/`)

쿠팡 카테고리 → Qoo10 Japan 카테고리 매핑.

| File | Purpose |
|------|---------|
| `parser.js` | breadcrumb 텍스트 파싱 |
| `sheetClient.js` | category_mapping 시트 조회 |
| `resolver.js` | KR→JP 카테고리 매핑 로직 (MANUAL → AUTO/Jaccard → FALLBACK) |
| `japanCategoriesSync.js` | Qoo10 카테고리 목록 동기화 |

---

### D) Pricing (`backend/pricing/`)

쿠팡 KRW 원가 → Qoo10 JPY 판매가 계산.

| File | Purpose |
|------|---------|
| `pricingConstants.js` | 환율/수수료/마진 상수 (하드코딩 — 추후 config 시트 이관 예정) |
| `priceDecision.js` | 가격 계산 로직 (`decideItemPriceJpy`) |
| `shippingLookup.js` | Txlogis_standard 시트에서 배송비 동적 조회 |

가격 공식:
```
baseCostJpy   = (ItemPrice_KRW + DOMESTIC_SHIPPING_KRW) / FX_JPY_TO_KRW + japanShippingJpy
requiredPrice = baseCostJpy / (1 - MARKET_COMMISSION_RATE - MIN_MARGIN_RATE)
targetPrice   = baseCostJpy * (1 + TARGET_MARGIN_RATE)
finalPrice    = Math.round(Math.max(requiredPrice, targetPrice))
```

---

### E) Backend Server (`backend/server.js`, `backend/services/`, `backend/routes/`)

yamyam 크롬 익스텐션이 전송하는 쿠키를 수신·저장하는 Express 서버.

| File | Purpose |
|------|---------|
| `server.js` | Express 서버 (포트 4000) |
| `services/cookieStore.js` | 쿠키 저장/조회 |
| `services/cookieExpiry.js` | 쿠키 만료 이메일 알림 (D-3/D-0, nodemailer) |
| `routes/cookie.js` | `/cookie` POST 엔드포인트 |

---

### F) CLI Scripts (`backend/scripts/`)

파이프라인 스크립트 + 유틸리티.

| File | Purpose |
|------|---------|
| `browserGuard.js` | `assertBrowserRunning()` — 데몬 미실행 시 즉시 종료 |
| `delay.js` | `randomDelay(min, max)` — 상품 간 랜덤 딜레이 |
| `coupang-browser-start.js` | Playwright 브라우저 데몬 시작 |
| `coupang-browser-stop.js` | 데몬 종료 |
| `coupang-browser-status.js` | 데몬 상태 확인 |
| `setup-sheets.js` | 시트 스키마 초기화 (--force-defaults 옵션) |
| `qoo10.setGoodsPriceQty.js` | 재고/가격 직접 업데이트 유틸 |
| `fix-stuck-registering.js` | REGISTERING 락 상태 수동 해제 유틸 |
| `migrate-coupang-datas-schema.js` | 스키마 마이그레이션 유틸 |
| `qoo10-order-sync.js` | Qoo10 주문 조회 → qoo10_orders 시트 upsert |

---

---

## Key Data Structures

### Product Row (coupang_datas sheet)

```
# ── 수집 필드 ────────────────────────────────────────
vendorItemId        # Primary key (URL 파라미터)
itemId              # Fallback key (URL 파라미터)
coupang_product_id  # Coupang 상품 ID (URL path)
categoryId          # Coupang 카테고리 ID
ProductURL          # 원본 쿠팡 상품 URL
ItemTitle           # 상품명 (한국어 원본 유지)
ItemPrice           # 쿠팡 판매가 (KRW)
StandardImage       # 대표 이미지 URL (800x800ex) # 풀 URL 저장 (https://thumbnail.coupangcdn.com/...)
ExtraImages         # 추가 이미지 배열 (JSON 문자열) # 풀 URL 저장 (https://thumbnail.coupangcdn.com/...)
WeightKg            # 무게 (Txlogis 배송비 조회 필수)
ItemDescriptionText # 상세 설명
updatedAt           # 수집 시각 (ISO 8601)
status              # 파이프라인 상태 ENUM

# ── Qoo10 등록 write-back 필드 ──────────────────────
qoo10SellingPrice       # 계산된 판매가 (JPY, write-back)
qoo10ItemId             # Qoo10 ItemCode (등록 성공 시)
qoo10SellerCode         # 사용된 SellerCode
jpCategoryIdUsed        # 사용된 Qoo10 카테고리 ID
categoryMatchType       # MANUAL | AUTO | FALLBACK
categoryMatchConfidence # 매핑 신뢰도 (AUTO only)
coupangCategoryKeyUsed  # 카테고리 매핑 key
registrationMode        # DRY_RUN | REAL
registrationStatus      # SUCCESS | WARNING | DRY_RUN | FAILED
registrationMessage     # 상태 메시지 ([titleMethod=api|fallback] 포함)
lastRegisteredAt        # 마지막 등록 시도 시각 (ISO 8601)
needsUpdate             # YES | NO
changeFlags             # PRICE_UP | PRICE_DOWN | TITLE_CHANGED | DESC_CHANGED | CATEGORY_CHANGED
```

### Status ENUM

```
DISCOVERED       → 검색결과에서 발견
COLLECTED        → 쿠팡 상세 수집 완료
PENDING_APPROVAL → 일일 한도 내 대기 (수동으로 REGISTER_READY 변경)
REGISTER_READY   → 등록 필수값 충족, 등록 대기
REGISTERING      → 등록 시도 중 (락)
REGISTERED       → Qoo10 등록 성공
VALIDATING       → 검수 진행 중 (락)
LIVE             → 판매 유지 중
OUT_OF_STOCK     → 쿠팡 품절 감지 → Qoo10 qty=0
DEACTIVATED      → 삭제/복구 불가 (수동으로만 해제)
ERROR            → 복구 가능한 실패
```

---

## API Methods

### Qoo10 QAPI

| Method | Purpose |
|--------|---------|
| `ItemsBasic.SetNewGoods` | 신규 상품 등록 |
| `ItemsBasic.UpdateGoods` | 상품 수정 (Title 업데이트에만 안정적) |
| `ItemsOrder.SetGoodsPriceQty` | 재고/가격 업데이트 |
| `ItemsContents.EditGoodsContents` | 상세페이지 수정 |
| `ItemsLookup.GetItemDetailInfo` | 상품 상세 조회 (래퍼 미구현) |
| `ItemsLookup.GetAllGoodsInfo` | 전체 상품 목록 조회 |
| `ShippingBasic.GetShippingInfo_v3` | 주문 배송 상태 조회 (복수) |
| `ShippingBasic.SetSendingInfo` | 발송 처리 (송장번호 등록) |

---

## Sheet Tabs

| Tab | Primary Key | Purpose |
|-----|-------------|---------|
| `coupang_datas` | `vendorItemId` | 상품 데이터 (SSOT) |
| `category_mapping` | `coupangCategoryKey` | KR→JP 카테고리 매핑 |
| `japan_categories` | `jpCategoryId` | JP 카테고리 캐시 |
| `keywords` | `keyword` | 수집 대상 키워드 (ACTIVE/PAUSED/PENDING) |
| `config` | `key` | 필터 조건값 등 운영 설정 |
| `Txlogis_standard` | (weight range) | 일본 배송비 구간 테이블 |
| `qoo10_orders` | `장바구니번호` | Qoo10 주문 데이터 (자동 동기화, SSOT) — ※ 별도 스프레드시트 (`1RZ5Kol8iAW2myXQOSRsG3MCwYIw1rQk6HY3a90GLyRs`) |

---

## H. Agent Configuration (OpenClaw)

| 에이전트 | 역할 |
|---------|------|
| Main Dev Agent | 핵심 로직 설계 및 구현, Qoo10 API 통합 |
| Sub Agent A | 쿠팡 크롤링, 로켓배송 필터링, Sheets 업로드 |
| Sub Agent B | 상태 모니터링, 재고 확인, Qoo10 재고 업데이트, 검수 |

각 에이전트는 서로 다른 LLM을 사용. Task Unit 기반으로 분리 실행.
