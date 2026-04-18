<!-- CURRENT_TASK.md (루트) — judy(운영자) 전용. 오늘 할 일, 운영 체크리스트 등 비기술적 내용 -->

# CURRENT_TASK.md

## 현재 상태
- 2026-04-15 업데이트
- 브랜치: `main`
- 마켓 잔존: 31개 (judy-ops 500개 목표 진행 중)
- 다음: 전략 고도화 [전략-1] market-analysis 활용안 논의

---

## 🟡 전략 고도화 — 데이터 수집 기반 구축

### [전략-1] qoo10:market-analysis 활용안 논의 (별도 세션)
- 대상 커밋:
  - `c3e7ab2` — `analysis/` 폴더 생성, qoo10-market-analysis README
  - `dc9aefd` — 리뷰수 regex 이스케이프 수정
  - `8a1142c` — `qoo10:market-analysis` Browser Relay 기반 경쟁 분석 스크립트
- 논의 목표: 전략이 필요한 지점 도출 → 데이터 수집 방법 설계 → 판매 전략 생성 연결
- 착수 조건: 별도 세션에서 진행

### [전략-2] SearchKeyword 경쟁사 벤치마킹 수집 스크립트
- 현황: `buildSearchKeywords()`는 jpTitle 단어 분해 방식 — 실제 검색 트래픽 미반영
- 목표: Qoo10에서 키워드 검색 → 경쟁 상품 검색키워드 수집 → 우리 상품에 적용
- 방법 후보:
  1. `qoo10:market-analysis` 스크립트 확장 — 경쟁사 상품 상세페이지 SearchKeyword 스크래핑
  2. Qoo10 통계 API 활용 — 마켓 제공 통계 데이터 endpoint 확인 필요
  3. 수동 큐레이션 + 시트 관리 — `keywords` 시트 `searchKeywords` 컬럼 추가
- 착수 조건: [전략-1] 논의 완료 후

---

## 다음 작업

### 🟡 우선순위 보통

#### Dashboard Chat 탭 UI 확인
- `/api/openclaw/*` Vercel API Route 프록시 6개 엔드포인트 구현 완료 상태
- Chat 탭 프론트엔드 UI (OpenClaw 연동) 완성 여부 미확인
- Vercel 배포에서 실제 동작 확인 후 결과에 따라 구현 범위 결정

### ⏸ 보류 (운영 안정화 후)

- [ ] **getItemDetailInfo.js 모듈 구현** — GetItemDetailInfo API 래퍼. EXT_ 상품 이미지 역수입 시 필요
- [ ] **EXT_ 상품 이미지 역수입** — GetItemDetailInfo로 StandardImage, EnlargedImage1~50 조회 → 시트 반영 (getItemDetailInfo.js 구현 후)
- [ ] **Qoo10 API 테스트 스크립트** — UpdateGoods / EditGoodsContents / GetItemDetailInfo 단독 테스트 스크립트 미구현
- [ ] **AUTO_REGISTER_ENABLED 플래그** — cron 자동화 붙일 때 같이 구현 (config 시트 키 + promote early exit)
- [ ] **가격 상수 config 시트 이관** — `pricingConstants.js` 하드코딩(환율/수수료/마진) → 런타임 로드
- [ ] **일본어 이미지 재생성** — 한국어 상세 이미지 일본어 재생성 시 파일 저장 경로 구조 + 정리 정책 + Sheets 연동 방식 설계
- [ ] **coupang_categorys 자동 기록 검증** — 수집 상품 categoryId가 시트에 자동 기록되는지 확인

### 📋 별도 논의

- [ ] **키워드/카테고리 전략** — 현재 텀블러/자동차용품 + 그래놀라/시리얼 진행 중. 추가 방향 논의.
- [ ] **경쟁력 분석 로직 방향** — 옵션 A(등록 상품 가격/리뷰/재고 모니터링) vs 옵션 B(시장 트렌드 → 키워드 자동 추천)
- [ ] **관세 기준가 정밀화** — 현재 `FILTER_PRICE_KRW_MAX=150,000` 고정. 환율 연동 or 배송비 포함 역산 검토 필요.

---

## 완료된 작업

### 2026-04-15
- **기등록 상품 최적화 완료** — EXT_ 236개 정리
  - `strategyNote` 컬럼 신설 (`sheetSchema.js`)
  - 전략 인사이트 보유 23개 메모 아카이빙 (패턴A/B/C 태그)
  - 즉시 삭제 202개 거래폐지 (`EditGoodsStatus status=3`)
  - 아카이빙 23개 거래폐지 완료
  - 최종 마켓 잔존: 31개 (KEEP 11개 + judy-ops 20개)
  - `qoo10-archive-strategy-notes.js`, `qoo10-retire-goods.js` 신규 작성

### 2026-04-14
- **운영 초기화 완료**
  - `qoo10ItemId` 없는 파이프라인 잔존 행 수동 삭제
  - `SearchKeyword` 컬럼 신설 (`sheetSchema.js`)
  - `reset-coupang-datas.js` 신규 작성 (qoo10ItemId 없는 행 삭제)
  - `qoo10-import-existing-goods.js` 엑셀 파싱 방식으로 전면 교체
  - `qoo10-auto-register.js` EXT_ IMAGE/DESC skip 규칙 추가
  - `qoo10-translate-titles.js` 신규 작성 (jpTitle JP→KR 역번역, OpenRouter)
- **Qoo10 기존 운영 상품 역수입 완료** — 236개 EXT_ 가상키로 coupang_datas 통합
  - 채운 필드: vendorItemId, qoo10ItemId, jpTitle, qoo10SellingPrice, qoo10SellerCode,
    jpCategoryIdUsed(MANUAL), StandardImage, ExtraImages, OptionsRaw, SearchKeyword, WeightKg,
    status=LIVE, registrationMessage=[imported=qoo10_native]
- **ItemTitle 역번역 배치 완료** — 성공 236개 / 실패 0개

### 2026-04-08
- **파이프라인 등록분 Qoo10 수동 삭제** 완료
- **운영 초기화 + 역수입 설계** 확정 (EXT_ 가상키 규칙, 이미지 URL 저장, 지침 파일 작성)

### 2026-04-02
- **changeFlags 플래그별 테스트 완료** (PRICE/IMAGE/CATEGORY/TITLE/DESC/REBUILD/REFRESH 전체)
- **DetailImages 수집 버그 수정** (oc/fix-detail-images)
- **플래그명 변경** — SYNC→REFRESH, ALL→REBUILD
- **pricingConstants.js 수정** — DOMESTIC_SHIPPING_KRW=3800, MARKET_COMMISSION_RATE=0.13, TARGET_MARGIN_RATE=0.40
- **jpTitle 컬럼 추가** — TITLE/CREATE 시 번역 결과 write-back
- **PRICE 플래그 qty 버그 수정** / **CATEGORY 플래그 jpTitle write-back 버그 수정**

### 2026-04-01
- **B-01/B-02 수정** PR #14 머지 완료
- **SliderImages 수집 수정** 완료
- **멀티이미지 슬라이더 real mode** 반영 확인
- **changeFlags 분기 구현** — qoo10-auto-register.js UPDATE 흐름 플래그별 분기

### 2026-03-31
- **CATEGORY_CHANGED 플래그 재resolve 버그 수정** (PR 머지)
- **기등록 7개 상품 타이틀 패치** — 7/7 SUCCESS
- **상세페이지 일본어 콘텐츠 생성 + Qoo10 반영** — descriptionGenerator.js + editGoodsContents.js 신규 구현
- **EditGoodsMultiImage EnlargedImage 파라미터 교체**

### 2026-03-30
- **collect 후 Chrome 탭 로딩 스피너 멈춤 수정** (PR #11)
- **categoryId 브레드크럼 자동 추출**

### Freedom 거리계 Step 2
- [ ] Qoo10 수입 수집 스크립트 작성 (GetSellingReportDetailList 재활용)
- [ ] 주간 정산 예정액 파싱 로직 구현
- [ ] 크론 등록 (주 1회, REPORT 사이클 동기화)
