# PROJECT_CONTEXT.md — RoughDiamond 운영 컨텍스트

> 대상: OpenClaw 에이전트 쥬디
> 역할: 쿠팡→Qoo10 자동화 파이프라인 운영 보조
> 코드 수정이 필요한 작업은 반드시 `CLAUDE.md`를 추가로 읽고 진행할 것.

---

## 파이프라인 요약

```
쿠팡 키워드 탐색 → DISCOVERED → COLLECTED → PENDING_APPROVAL
→ (approve) REGISTER_READY → Qoo10 등록 → REGISTERED → LIVE
→ 재고 모니터링 → OUT_OF_STOCK (qty=0) / LIVE 복구
```

운영 환경: Mac Mini / Google Sheets SSOT

---

## 상품 상태 (status ENUM)

```
DISCOVERED       → 키워드 검색 발견
COLLECTED        → 쿠팡 상세 수집 완료
PENDING_APPROVAL → 일일 한도 대기 중 (approve 명령으로 일괄 REGISTER_READY 전이)
REGISTER_READY   → 등록 승인 완료
REGISTERING      → 등록 중 (락 — 중복 실행 금지)
REGISTERED       → Qoo10 등록 성공
LIVE             → 판매 중
OUT_OF_STOCK     → 쿠팡 품절 감지 → Qoo10 qty=0
DEACTIVATED      → 수동으로만 해제 가능 (코드 자동 해제 금지)
ERROR            → 복구 가능한 실패
```

---

## 주요 운영 명령어

> 전체 실행 순서 및 dry-run 정책 → `docs/RUNBOOK.md` 참조. 파이프라인 작업 전 반드시 읽어라.

```bash
npm run backend:start           # 매일 1번째 실행 (쿠키 수신 서버)
npm run cookie:refresh          # 쿠키 수동 갱신 (자동 갱신 실패 시)

# (선택) stock:check 실행 시에만 필요 — daily 파이프라인(collect/discover 포함)엔 불필요
# npm run coupang:browser:start   # Playwright 데몬
# npm run coupang:browser:status  # Playwright 데몬 상태

# 파이프라인 (순서대로)
npm run coupang:discover        # 키워드 탐색
npm run coupang:collect         # DISCOVERED → COLLECTED
npm run coupang:promote         # COLLECTED → PENDING_APPROVAL
npm run coupang:approve         # PENDING_APPROVAL → REGISTER_READY
npm run qoo10:auto-register     # REGISTER_READY → Qoo10 등록
npm run stock:check             # 재고 모니터링

# dry-run은 각 명령어에 :dry 접미어 (Playwright 단계는 생략 — RUNBOOK 참조)
```

쿠키 갱신: 매일 아침 cron 자동 실행 (결과 텔레그램 수신). 실패 시 `npm run cookie:refresh`.

---

## 현재 대기 중인 작업

→ `docs/CURRENT_TASK.md` 참조

---

## 핵심 제약사항 (운영 시 반드시 준수)

- `REGISTERING` / `VALIDATING` 상태 행에 중복 작업 절대 금지
- `DEACTIVATED` 상태는 코드로 자동 해제하지 않는다
- 브라우저 스크립트 실행 전 반드시 데몬 상태 확인 (`coupang:browser:status`)
- HARD_BLOCK 발생 시 1시간 쿨다운 후 재시작 (강제 재시작 금지)
- 쿠키 만료 텔레그램 알림 수신 시 즉시 `npm run cookie:refresh` 실행

---

## Qoo10 테스트 안전장치

```
QOO10_TEST_ITEMCODE=1194045329   # 테스트 전용 상품
QOO10_ALLOW_REAL_REG=1           # 없으면 dry-run
```

---

## 코드 수정이 필요한 경우

`CLAUDE.md`를 읽고 §8 개발 규칙을 반드시 준수한 뒤 작업한다.
