# qoo10-seller-daily.js — Qoo10 셀러 통계 + 시장 키워드 일일 수집

**버전**: v0 (2026-04-30)
**LaunchAgent**: `com.judy.qoo10-seller` (매일 09:00 KST)
**저장 경로**: `<repoRoot>/metrics/qoo10_seller/YYYY-MM-DD/`

## v0 한계

| 데이터 | 동작 여부 | 비고 |
|------|--------|------|
| qsm.qoo10.jp 인기 키워드 411개 | ✅ 안정 | navigate + DOM table 추출 |
| seller.qoo10.jp 6개 endpoint | ⚠️ best-effort | Authorization JWT 캡처 실패 시 graceful skip |

## seller endpoint 캡처 실패 원인

main world XHR/fetch monkey-patch가 React initial XHR보다 늦게 inject돼서 Authorization 헤더 캡처 실패. 다음 시도들 모두 실패:

1. 같은 탭 navigate + query param 변경 → React cached state, 추가 호출 없음
2. 새 탭 open + sleep 600ms + patch → React initial XHR 이미 끝남
3. `responsebody` CDP 명령 background 호출 + navigate → timing race 어려움

## v1 개선 후보 (다음 세션)

1. **`responsebody` 병렬 시작 + open 동시 트리거**: shell async로 6개 endpoint pattern 동시 대기 → open 시 자동 호출 매칭. timing 정밀.
2. **`Page.addScriptToEvaluateOnNewDocument` 동등 명령** OpenClaw에 있는지 추가 조사.
3. **page React 강제 트리거**: date range select 변경, 메뉴 클릭 등 fetch 트리거 element 찾아서 evaluate로 click.
4. **사용자 매일 1회 셀러 페이지 방문 의존**: cron이 그 시점에 매칭. 회피책으로 단순.

## 운영

### 수동 실행
```bash
node /Users/judy/dev/crawler-pipeline/backend/scripts/qoo10-seller-daily.js
```

### 로그 확인
```bash
tail -f /tmp/qoo10-seller-daily.log
tail -f /tmp/qoo10-seller-daily.err
```

### 다음 실행 시각
LaunchAgent 등록 후 매일 09:00 KST. 다음 자동 실행은 내일 오전 9시.

### 출력 파일
```
metrics/qoo10_seller/YYYY-MM-DD/
├── qsm_popular_keywords.json    # 시장 인기 키워드 411개 (rows 배열)
├── transaction_table_date.json  # ⚠️ Authorization 캡처 시에만
├── ... (기타 5개 endpoint)
└── _meta.json                   # 실행 시각, 응답 크기, 에러 목록
```

## v1 변경 시 영향

- `qoo10-seller-daily.js`: 핵심 흐름 변경
- LaunchAgent plist: 변경 없음 (스크립트만 교체)
- 저장 경로: 동일 (이전 데이터 호환)
