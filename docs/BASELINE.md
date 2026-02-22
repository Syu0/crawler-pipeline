# BASELINE (Migration Pre-check)

- 실행 시각: 2026-02-22 13:06:21 KST
- 기준 커밋: `fccd656dd3cb5bd009afb54b6650595bef7887b7`
- 브랜치: `oc/migration-baseline-capture`

## Environment
- Node: `v25.6.1`
- npm: `11.9.0`

## Server boot check
- Command: `cd backend && node index.js`
- Result: ✅ boot 성공 (`Backend listening on http://localhost:8787`)

## API spot-check
- `GET /` → `Cannot GET /` (예상 동작)
- `GET /api/qoo10/shipping-groups` → `{"ok":false,"error":"Missing env QOO10_SAK"}`

## Test baseline
- Command: `cd backend && npm run test:qoo10:register`
- Result: ❌ 실패
- Reason: `Missing env QOO10_SAK`

## Exception notes
1. 환경변수 `QOO10_SAK` 미설정으로 Qoo10 연동 테스트 실패.
2. 초기 실행 스크립트에서 `timeout` 명령 미존재(macOS 기본) 확인. 이후 백그라운드 실행 + kill 방식으로 대체.

## Decision
- 마이그레이션 구조 작업은 계속 진행 가능.
- Qoo10 연동 동등성 검증은 `QOO10_SAK` 제공 시점에 재수행 필요.
