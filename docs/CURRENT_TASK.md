# CURRENT_TASK

## 현재 상태
- 2026-03-17 업데이트
- 3순위(일본어 타이틀 변환) + 4순위(Update API 래퍼) + 5순위(재고 모니터 → Qoo10 qty 연결) 완료
- 현재: 재고 모니터 실검증 진행 중 (dry-run 확인 완료, 실제 시트/Qoo10 반영 확인 단계)

## 다음 액션 (순서대로)

### 1단계: 쿠팡 블록 대응 강화 (1순위) ✅ 완료
- [x] 블록 상황에서 파이프라인 중단 없이 처리되는 전략 수립
- [x] `blockDetector.js` 블록 판단 로직 검토
- [x] `coupang-collect-discovered.js` 재시도/복구 흐름 수정
- [x] 완료 기준: 블록 발생 시에도 다른 row 처리 계속 가능
- 브랜치: `oc/block-handling` | 커밋: `7b4f723`

### 2단계: 쿠팡 수집 보강 (2순위) ✅ 완료
- [x] ExtraImages 수집 (셀렉터: ul.twc-static li img, 해상도 492x492ex 정규화)
- [x] DetailImages 수집 (셀렉터: div.type-IMAGE_NO_SPACE img, 해상도 정규화)
- [x] OptionType / OptionsRaw 수집
- [x] StockStatus 수집 (가격 기반 판단 로직)
- [x] ReviewCount / ReviewAvgRating 수집 (별 카운팅 방식)
- [x] ReviewSummary 수집 (상위 5개 리뷰 JSON, 최대 500자)
- [x] 필드별 독립 try-catch — row 전체 실패 방지
- [x] CollectedPhases "1,2,..." 형식 기록
- ⏸ 문의글(Q&A) — 전략 모듈(상세페이지/타이틀 전략) 시점으로 보류
- 브랜치: `oc/collection-enhance` | 커밋: `395bb2f`

### 3단계: 일본어 타이틀 변환 모듈 (3순위) ✅ 완료
- [x] `backend/qoo10/titleTranslator.js` 신규 생성
  - 입력: ItemTitle (한국어), coupangCategoryKeyUsed
  - 출력: 일본어 SEO 최적화 타이틀 (검색 키워드 중심)
  - 방식: 브랜드명/숫자/단위 regex 추출 → Claude API (Haiku) → 카테고리 템플릿 fallback
- [x] `qoo10-auto-register.js`에 titleTranslator 연결
- 브랜치: `oc/collection-enhance` | 커밋: `f32bd61`

### 4단계: Update API 래퍼 추가 (4순위) ✅ 완료
- [x] `getItemDetailInfo.js`: SecondSubCat 조회 (UpdateGoods 필수 전처리)
- [x] `updateGoods.js` → `updateGoodsTitle()`: ItemTitle 업데이트 전용 (SecondSubCat 자동 조회 포함)
- [x] `editGoodsContents.js`: 상세페이지 HTML 업데이트
- [x] `qoo10-auto-register.js` UPDATE 흐름: changeFlags 기반 분기로 교체
- 브랜치: `oc/collection-enhance` | 커밋: `d133625`

### 5단계: 재고 모니터링 → Qoo10 qty 연결 (5순위) ✅ 완료
- [x] OUT_OF_STOCK 감지 → SetGoodsPriceQty(qty=0) → status OUT_OF_STOCK 전이
- [x] IN_STOCK 복구 감지 → SetGoodsPriceQty(qty=100) → status LIVE 전이
- [x] qoo10ItemId 없음 / API 실패 시 status 변경 없이 errorMessage만 기록
- [x] dry-run 지원, row 독립 try-catch
- 브랜치: `oc/collection-enhance` | 커밋: `a3c8eb1`

## 현재 진행 중

- [ ] 재고 모니터링 실검증 (stock:check dry-run 확인 완료, 실제 시트 업데이트 + Qoo10 반영 확인)

## 대기 중 (순서대로)

- [ ] 6순위: COLLECTED → Qoo10 등록 파이프라인 자동 연결
  - 착수 조건: 재고 모니터 실검증 완료 후
  - 안전장치: PENDING_APPROVAL 게이트 + MAX_DAILY_REGISTER 상한 포함 설계

## 보류 중
- 일본어 상세페이지 콘텐츠 생성 (전략 파트 — 6순위 이후 착수)
- Qoo10 시장 가격 경쟁성 검증 스크래핑 자동화 (7순위)
