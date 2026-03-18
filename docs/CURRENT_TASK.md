# CURRENT_TASK

## 현재 상태
- 2026-03-18 업데이트
- 선행①(타이틀 변환 미적용 원인 파악) + 선행②(재고 모니터 실검증) 완료
- 현재: 6순위 COLLECTED → Qoo10 자동 연결 파이프라인 설계 착수

## 완료 항목 (전체)

### 1순위: 쿠팡 블록 대응 강화 ✅
- 브랜치: `oc/block-handling` | 커밋: `7b4f723`

### 2순위: 쿠팡 수집 보강 ✅
- 브랜치: `oc/collection-enhance` | 커밋: `395bb2f`

### 3순위: 일본어 타이틀 변환 모듈 ✅
- 브랜치: `oc/collection-enhance` | 커밋: `f32bd61`

### 4순위: Update API 래퍼 완성 ✅
- 브랜치: `oc/collection-enhance` | 커밋: `d133625`

### 5순위: 재고 모니터링 → Qoo10 qty 연결 ✅
- 브랜치: `oc/collection-enhance` | 커밋: `a3c8eb1`

### 인벤토리 관리 ✅
- qoo10_inventory 시트 + 동기화/qty처리 스크립트
- 브랜치: `oc/qoo10-inventory-mgmt`

### 선행①: 타이틀 변환 미적용 상품 원인 파악 ✅
- 결론: 코드 버그 없음. 시트 ItemTitle = 원본 한국어 유지(설계 의도), Qoo10 실제 타이틀 = 일본어 정상 적용.
- 레거시 4개(머지 이전 등록): Update 흐름 1회 실행 시 자동 갱신됨 (미긴급)

### 선행②: 재고 모니터 실검증 ✅
- 실행 결과: 처리 2개, IN_STOCK 정상 유지, 블록 없음
- OUT_OF_STOCK 전이 경로: dry-run에서 정상 확인 (현재 전 상품 판매중이라 실전이 미발생)
- 추가 발견: 1195611873 카테고리 미스매치 (자동차 기어노브 → 가구/인테리어) → category_mapping 시트 수동 수정 필요

## 현재 진행 중

### 6순위: COLLECTED → Qoo10 자동 연결 파이프라인
- 브랜치: `oc/auto-register-pipeline` (신규 생성 예정)
- 설계 포인트:
  - `PENDING_APPROVAL` 상태 추가 (COLLECTED → PENDING_APPROVAL → REGISTER_READY)
  - `MAX_DAILY_REGISTER`: config 시트 관리 (초기값 10)
  - 자동 파이프라인 가동 후에도 소량(10개/일) 검증 운영 먼저
- status ENUM 추가 필요: `PENDING_APPROVAL`

## 대기 중

- [ ] 레거시 4개 상품 타이틀 Update 실행 (미긴급 — 운영 중 자동 처리 가능)
- [ ] 1195611873 카테고리 수동 재분류 (category_mapping 시트 MANUAL 수정)

## 보류 중
- 일본어 상세페이지 콘텐츠 생성 (6순위 완료 후 착수)
- Qoo10 시장 가격 경쟁성 자동 스크래핑 (7순위)
