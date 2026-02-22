# PROJECT_CONTEXT

## 목적
- 구매대행 비즈니스 워크플로우 자동화 개발.

## 운영 규칙 (최우선)
- 이 레포를 Single Source of Truth로 사용.
- 작업 전: main 최신화 + 커밋 해시 확인.
- 작업 시작 전 아키텍처/환경 체크리스트 갱신.
- 브랜치 규칙: `oc/<short-task-name>`.
- 작은 커밋 + 명확한 메시지.
- PR에 반드시 `(planning)` / `(implementation)` 기재.
- Architect가 계획해도 코드 수정/테스트 실행은 Coding Agent가 수행.
- 명시 요청 없이는 신규 외부 유료 API 추가 금지.
- 제품 동작 변경 시 before/after + 근거 기록.
- 현재 세션 컨텍스트가 50%를 초과하면 세션 리셋을 수행.
- 리셋 직후 첫 지시는 반드시 다음 문장으로 고정: `Read docs/PROJECT_CONTEXT.md and docs/CURRENT_TASK.md first.`

## 에이전트 정책
- Agent A (Coding / NVIDIA NIM): 소규모 수정, lint/format, minor fix, simple tests.
- Agent B (Architect / OpenRouter Claude Sonnet 4.6): 장문맥 이해, 설계, 복잡 디버깅, 리스크 분석.

## 레포 구조 정책
- `src/`: 실제 코드(목표 구조)
- `docs/`: 운영/설계/실행 문서
- `docs/PROMPTS/`: 시스템/에이전트 프롬프트
