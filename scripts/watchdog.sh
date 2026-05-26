#!/bin/bash
# daily-qoo10 watchdog — 10:00 KST에 오늘 리포트 존재 여부 확인

set -euo pipefail

REPORT_DIR="$HOME/.openclaw/workspace/projects/crawler-pipeline/reports"
TODAY=$(date +%Y-%m-%d)
REPORT_FILE="$REPORT_DIR/${TODAY}_daily-qoo10.md"

# .env에서 텔레그램 환경변수 로드
ENV_FILE="$(dirname "$0")/../backend/.env"
if [ -f "$ENV_FILE" ]; then
  export $(grep -E '^(TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID)=' "$ENV_FILE" | xargs)
fi

send_telegram() {
  local msg="$1"
  if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
    echo "[watchdog] TELEGRAM 환경변수 미설정 — 콘솔 출력만"
    echo "$msg"
    return
  fi
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\":\"${TELEGRAM_CHAT_ID}\",\"text\":\"${msg}\",\"parse_mode\":\"HTML\"}" \
    > /dev/null
}

if [ -f "$REPORT_FILE" ]; then
  echo "[watchdog] $(date '+%Y-%m-%d %H:%M:%S') ✅ 리포트 확인됨: $REPORT_FILE"
  exit 0
fi

echo "[watchdog] $(date '+%Y-%m-%d %H:%M:%S') ⚠ 오늘 리포트 없음 — 텔레그램 알림 전송"

MSG="🚨 daily-qoo10 미실행 (10:00 KST 기준)
날짜: ${TODAY}

파이프라인이 오늘 실행되지 않았습니다.

💬 Claude 세션에서 확인하려면:
\"daily-qoo10 실행 안 된 이유 확인하고 지금 실행해줘\""

send_telegram "$MSG"
echo "[watchdog] $(date '+%Y-%m-%d %H:%M:%S') 알림 전송 완료"
