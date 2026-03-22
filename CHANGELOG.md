# Changelog

모든 주요 변경사항은 이 파일에 기록합니다.

---

## [2026-03-22] — 문서 현행화

- CLAUDE.md 코드베이스 감사 및 업데이트 (섹션 9-A/9-B/9-C/10 전면 정비)
- 루트 레벨 stale 문서 9개 삭제 (AB_TESTS_UPDATE, QAPI_DEBUG_SETUP 등)
- README.md 교체: CLAUDE.md 진입점 안내 + 빠른 시작

---

## [2026-03-22] — 데몬 안정성 강화 (oc/daemon-timeout-resilience)

- 데몬 잔여시간 체크 + Graceful Exit (EXIT_REASON=DAEMON_EXPIRING)
- blockState 분리: warming 블록 감지 + HARD_BLOCK/SOFT_BLOCK 에스컬레이션
- ExtraImages 수집 버그 수정 — Tailwind twc-* 신 UI CDN URL 폴백
- 이미지 URL 크기 토큰 800x800ex 업스케일
- ItemPrice 파싱 버그 수정 — 단위가격 혼입 방지 (첫 번째 숫자 블록 사용)
- OpenRouter API 연동 (titleTranslator fallback 경로)

---

## [2026-03-19] — 등록 파이프라인 자동화 (oc/auto-register-pipeline)

- COLLECTED → PENDING_APPROVAL → REGISTER_READY → Qoo10 자동 등록 파이프라인 연결
- `coupang-promote-to-pending.js`: MAX_DAILY_REGISTER 한도 내 promote
- `qoo10-auto-register.js`: REGISTER_READY만 처리, qoo10ItemId 중복 진입 버그 수정
- `setup-sheets.js`: MAX_DAILY_REGISTER 기본값 + --force-defaults 옵션

---

## [2026-03-19] — 브라우저 가드 + 블록 대응 (oc/browser-guard)

- `browserGuard.js`: 데몬 미실행 시 즉시 종료 + 안내
- `blockStateManager.js`: collectSafe / assertCollectSafe / setHardBlocked
- `.browser-block-state.json`: blockState 파일 기반 영속화
- 쿠키 유효성 자동 체크 — 만료 시 이메일 알림 + 수집 중단
- 랜덤 딜레이 (`delay.js`): 상품 간 4~10초, dry-run 500ms 고정

---

## [2026-03-17~19] — 일본어 타이틀 변환 + Qoo10 Update API

- `titleTranslator.js`: KR→JP SEO 타이틀 (Claude Haiku API + 카테고리 템플릿 fallback)
- `updateGoods.js`: UpdateGoods API 래퍼 (`updateExistingGoods`) — SecondSubCat 자동 resolve
- Qoo10 Update 흐름: needsUpdate=YES → UpdateGoods 전체 실행, changeFlags 클리어

---

## [2026-03-14] — 재고 모니터링

- `coupang-stock-monitor.js`: 품절 셀렉터 파싱 → SetGoodsPriceQty(qty=0/100) → status 전이
- OUT_OF_STOCK 감지 → Qoo10 qty=0, IN_STOCK 복구 → qty=100
- dry-run 지원, row 독립 try-catch

---

## [2026-03-13~16] — 수집 파이프라인 보강

- `coupang-keyword-discover.js`: keywords 시트 ACTIVE 키워드 → 쿠팡 검색 → DISCOVERED 저장
- `coupang-collect-discovered.js`: DISCOVERED → COLLECTED 자동 수집기
- `detailPageParser.js`: 상세 페이지 파싱 모듈 분리
- `blockDetector.js`: SOFT_BLOCK → HARD_BLOCK 에스컬레이션, 1시간 대기 × 2회
- Playwright 브라우저 데몬 생명주기 스크립트 (start/stop/status)
- 카테고리 Jaccard 단일 최적 매칭 + breadcrumb 추출

---

## [2026-03-13] — pricing 모듈 + sheetSchema 표준화

- `backend/pricing/`: priceDecision / pricingConstants / shippingLookup 모듈화
- 가격 공식: baseCostJpy → requiredPrice/targetPrice → max → round (Txlogis 배송비 동적 조회)
- `backend/coupang/sheetSchema.js`: status ENUM + 컬럼 정의 표준화
- `setup-sheets.js`: 시트 스키마 자동 초기화

---

## [2026-02-08] — Qoo10 API 기반 구축

- SetNewGoods / UpdateGoods / SetGoodsPriceQty API 래퍼 구현 및 검증
- Playwright + stealth + yamyam 쿠키 주입으로 Akamai 우회 성공
- `registerNewGoods.js`, `payloadGenerator.js`, `client.js`
- Google Sheets SSOT 구조 확립

---

## [2026-02-05] — Initial commit
