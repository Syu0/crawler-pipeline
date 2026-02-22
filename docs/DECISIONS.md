# DECISIONS

## 2026-02-22
- 문서 표준 구조를 `docs/` 하위로 고정.
- `PROJECT_CONTEXT.md`를 최우선 운영 규칙 문서로 채택.
- 에이전트 2개 정책(Coding/Architect) 적용.
- backend → src 마이그레이션은 **무기능변경(behavior-preserving)** 원칙으로 진행.
- 마이그레이션은 단일 PR이 아닌 단계 분리로 수행:
  1) 계획/체크리스트
  2) 복제(이동 아님)
  3) 진입점 전환
  4) 안정화 후 정리
- 기능변경과 구조변경은 같은 PR에 섞지 않는다.
