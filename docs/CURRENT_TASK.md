# CURRENT_TASK

## 현재 상태
- 2026-03-16 작업 우선순위 최종 확정
- 핵심 블로킹 이슈 2건 (블록 대응, 수집 불충분) 선결 후 품질 작업 진행

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

### 3단계: 일본어 타이틀 변환 모듈 (3순위)
- [ ] `backend/qoo10/titleTranslator.js` 신규 생성
  - 입력: ItemTitle (한국어), coupangCategoryKeyUsed
  - 출력: 일본어 SEO 최적화 타이틀 (검색 키워드 중심)
  - 방식: 브랜드명/숫자/단위 regex 추출 → Claude API (Haiku) → 카테고리 템플릿 fallback
- [ ] `qoo10-auto-register.js`에 titleTranslator 연결

### 4단계: Update API 래퍼 추가 (4순위)
- [ ] UpdateGoods, EditGoodsContents 래퍼 구현
- [ ] 2단계에서 추가된 필드 기반으로 업데이트 테스트

## 보류 중
- 재고 모니터링 → qty=0 연결 (5순위)
- 등록 파이프라인 자동화 (6순위 — 운영 직전 착수)
- Qoo10 시장 가격 경쟁성 검증 스크래핑 자동화 (7순위)
