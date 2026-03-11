# PROJECT_CONTEXT (DASHBOARD: roughdiamond-dashboard)

## 목적
진행 중 프로젝트들의 상태를 한 화면에서 확인/관측하기 위한 운영 대시보드.

## 스코프
- Tasks / Logs / Chat / Registration 등 운영 UI
- OpenClaw 연동 프록시 라우트
- 헬스체크/상태표시/모바일 UX 개선

## 현재 역할 정의
- Dashboard는 **1차에서는 운영/관측 인터페이스**다. (`제어` 기능은 2차 고도화로 이관)
- Qoo10 상품 등록/업데이트의 실제 도메인 처리 로직은 CORE(crawler-pipeline)가 담당한다.

## 작업 원칙
1. Dashboard 작업 시 코어 비즈니스 로직 변경 금지(명시적 요청 제외)
2. 1차 범위에서는 관측/표시 기능 우선, 제어 기능은 stash로 보존 후 2차에서 재도입
3. API 프록시 응답 판정은 보수적으로(성공/실패 명확화)
4. UI 변경 시 로그/오류 노출 경로를 함께 점검

## 관련 핵심 파일
- `src/app/page.tsx`
- `src/app/api/openclaw/send/route.ts`
- `src/app/api/openclaw/history/route.ts`
- `src/app/api/openclaw/health/route.ts`

## 최근 진행 상태 스냅샷 (2026-02-27 14:20 KST)
- 세션 초기화 대비 상태 동기화 완료
- 분류 정정 반영
  - `DASH-T23`~`DASH-T25`는 CORE 기능 추가 성격으로 재분류되어 CORE(`CORE-T04`~`CORE-T06`)로 이관
  - DASHBOARD에서는 active work로 취급하지 않음
- Qoo10 탭 v1(read-only) 구축 완료
  - Sticky Header: Run Status / Last Sync / Coverage / Data Source
  - Ingestion Snapshot(google extension) 카드 추가
  - KPI 카드(Overview 동일 4종) + drill-down 필터 연동
  - 레코드 테이블/필터/검색/상세 슬라이드오버(모두 read-only)
  - 액션 요소(run/retry/chat/trigger/write) 미포함
  - 관련 task `DASH-T14`~`DASH-T22` DONE 처리

- Project Overview 섹션 고도화 유지
  - 프로젝트별 목적/컨텍스트 경로/작업목록 표시
  - 경로 Copy/Open 동작 반영
- task/issue ID 체계 반영
  - `[DASH-Txx]`, `[DASH-Ixx]` 형식으로 표기
- 1차 범위 조정 반영
  - task 제어 버튼(실행/중지/롤백) 제거 시작
  - 제어 기능은 2차 고도화(stash) 트랙으로 이관 중
- 표시 포맷 개선
  - Last Sync를 KST(예: `2026-02-27 오전 10:17`) 형식으로 표시
- 운영 URL 최신 반영: `https://roughdiamond-dashboard.vercel.app`

## 진행 업데이트 (2026-02-27 12:20 KST)
- 대시보드 1차 목표에서 `제어` 기능 제외 방향 확정
- 제어 기능(실행/중지/롤백, 연동 안정화)은 2차 고도화용 stash 트랙으로 이관 예정
- 즉시 우선순위: 관측 중심 UX 정리 + task/issue 구조 재정렬

## 운영 참고
- 배포 URL/인증/연동 세션 등 운영값은 환경변수 및 배포설정 기준으로 관리
- 세부 진행 상태는 상위 `../docs/CURRENT_TASK.md`와 함께 확인
