# CURRENT_TASK

## Task
- backend → src 구조 마이그레이션 사전 검토/기준선 캡처 (소스코드 동작 영향 0 목표)

## 상태
- 승인됨 (2026-02-22 13:05 KST)
- 기준선 캡처 완료 (예외 2건 기록)

## 예외
1. `QOO10_SAK` 미설정으로 Qoo10 연동 테스트 실패
2. macOS 기본 `timeout` 명령 미존재 (대체 방식 적용)

## 진행 업데이트 (2026-02-22 14:30 KST)
- Step 1(복제) 완료: `src/`에 진입점/모듈 복제
- Step 2(호환 진입점) 완료: `src/*`는 래퍼로 추가, `backend/*` 기존 실행 경로 유지
- Step 3(스크립트 전환 준비) 반영:
  - `backend/package.json`에 `start`(기존), `start:src`(신규 경로 검증) 추가
  - `docs/RUNBOOK.md` 실행 명령을 스크립트 기준으로 정리
- 부팅 스모크체크: `node backend/index.js`, `node src/index.js` 모두 기동 확인

## 다음 액션
1. 구조 변경 PR 생성(무기능변경, before/after 기록 포함) — 초안 작성 완료: `docs/PR_IMPLEMENTATION_backend_to_src_step1_3.md`
2. 시크릿 제공 후 Qoo10 연동 회귀 재검증
