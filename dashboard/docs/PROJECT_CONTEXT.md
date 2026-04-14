# PROJECT_CONTEXT.md
> crawler-pipeline-dashboard 프로젝트 — judy 전용 컨텍스트 문서

---

## 프로젝트 정의

crawler-pipeline의 수집/등록 데이터를 시각화하는 **관측 전용 대시보드**.
제어 기능은 2차 고도화(stash) — 1차 원칙: **Read-only 관측 중심**.

- **배포 URL:** https://roughdiamond-dashboard.vercel.app
- **실제 경로:** `/Users/judy/dev/crawler-pipeline/dashboard/`
- **연관 프로젝트:** crawler-pipeline (데이터 소스)

---

## 기술 스택

| 항목 | 내용 |
|------|------|
| 프론트엔드 | Next.js (Vercel 배포) |
| 백엔드 프록시 | `/api/openclaw/send|history|health` |
| 데이터 소스 | crawler-pipeline API + Google Sheets |
| 터널 | Cloudflare (DASH-T09: named tunnel 미완료) |

---

## 현재 상태 (2026-04-14 기준)

- RoughDiamond Dashboard 1차 구축 및 배포 완료
- Overview / Qoo10 read-only / Chat 탭 구현 완료
- Cloudflare named tunnel 미완료 → quick tunnel 임시 사용 중
- OPENCLAW_BASE_URL 불안정 → 간헐적 send 실패 가능

---

## 핵심 원칙

1. **관측 중심** — 제어 버튼/제어 상태 필드 제거 완료
2. **코드 수정 건은 완료 보고 전 배포 필수**
3. crawler-pipeline CORE 변경 시 dashboard 파서 동기화 필요

---

## 주요 링크

- CURRENT_TASK: `~/.openclaw/workspace/projects/crawler-pipeline-dashboard/CURRENT_TASK.md`
- 연관 태스크: `../crawler-pipeline/CURRENT_TASK.md`
