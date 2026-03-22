# CURRENT_TASK.md

## 현재 상태
- 2026-03-22 업데이트
- `docs/doc-sync` 브랜치 — 문서 현행화 진행 중

## 현재 진행 중
- 문서 현행화 (Phase 3): CURRENT_TASK / USER_MANUAL / CHANGELOG / ARCHITECTURE 업데이트

## 대기 중
- [ ] 레거시 4개 상품 타이틀 Update 실행 (미긴급) — 운영 중 Update 흐름 시 자동 갱신됨
- [ ] 1195611873 카테고리 수동 재분류 (category_mapping 시트 MANUAL 수정)
- [ ] PENDING_APPROVAL 승인 자동화 (대시보드/Slack 버튼 — 추후)
- [ ] AUTO_REGISTER_ENABLED 플래그 추가 (cron 붙일 때, config 시트 + promote 스크립트)
- [ ] 가격 상수 config 시트 이관 (pricingConstants.js 하드코딩 → config 시트 런타임 로드)

## 보류 중
- 일본어 상세페이지 콘텐츠 생성 (`backend/qoo10/contentStrategy.js` — 착수 가능)
- Qoo10 시장 가격 경쟁성 자동 스크래핑 (7순위)
- `getItemDetailInfo.js` / `editGoodsContents.js` 모듈 구현 (changeFlags DESC_CHANGED 처리 시 필요)
