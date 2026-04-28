#!/usr/bin/env bash
# tunnel-daemon.sh — Phase 3: image static server + cloudflared quick tunnel 상시 가동
#
# 동작:
#   1. backend/image-processing/server.js (포트 8787) 가동.
#   2. cloudflared quick tunnel 가동, 발급 URL을 .tunnel-base에 기록.
#   3. 둘 중 하나라도 죽으면 양쪽 다 재시작 + .tunnel-base 갱신.
#   4. 종료 시 양쪽 정리.
#
# .tunnel-base 위치: /Users/judy/dev/crawler-pipeline/.tunnel-base (gitignored)
# 이 파일을 prepareForRegister.js / batch-* 스크립트가 읽어서 register payload에 사용.
#
# 사용:
#   foreground:  bash backend/image-processing/tunnel-daemon.sh
#   background:  nohup bash backend/image-processing/tunnel-daemon.sh > /tmp/tunnel-daemon.log 2>&1 &
#   LaunchAgent: ~/Library/LaunchAgents/com.openclaw.tunnel-daemon.plist 참조

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TUNNEL_FILE="$REPO_ROOT/.tunnel-base"
LOG_DIR="$REPO_ROOT/backend/image-processing/logs"
SERVER_LOG="$LOG_DIR/img-server.log"
TUNNEL_LOG="$LOG_DIR/cloudflared.log"
PORT="${IMAGE_SERVER_PORT:-8787}"

mkdir -p "$LOG_DIR"

SERVER_PID=""
TUNNEL_PID=""

cleanup() {
  echo "[tunnel-daemon] shutting down..."
  if [[ -n "$TUNNEL_PID" ]] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    kill "$TUNNEL_PID" 2>/dev/null || true
  fi
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$TUNNEL_FILE"
  exit 0
}
trap cleanup INT TERM

start_server() {
  echo "[tunnel-daemon] starting img-server on port $PORT..."
  (cd "$REPO_ROOT" && IMAGE_SERVER_PORT="$PORT" node backend/image-processing/server.js >> "$SERVER_LOG" 2>&1) &
  SERVER_PID=$!
  sleep 2
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "[tunnel-daemon] ERROR: img-server failed to start (see $SERVER_LOG)"
    return 1
  fi
  # health check
  if ! curl -sSf "http://127.0.0.1:$PORT/health" > /dev/null; then
    echo "[tunnel-daemon] ERROR: img-server health check failed"
    return 1
  fi
  echo "[tunnel-daemon] img-server PID=$SERVER_PID"
  return 0
}

start_tunnel() {
  echo "[tunnel-daemon] starting cloudflared quick tunnel..."
  : > "$TUNNEL_LOG"
  cloudflared tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate >> "$TUNNEL_LOG" 2>&1 &
  TUNNEL_PID=$!

  # cloudflared 출력에서 trycloudflare URL 파싱 (최대 30초 대기)
  local url=""
  for i in $(seq 1 30); do
    sleep 1
    if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
      echo "[tunnel-daemon] ERROR: cloudflared exited prematurely (see $TUNNEL_LOG)"
      return 1
    fi
    url=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1)
    if [[ -n "$url" ]]; then
      break
    fi
  done

  if [[ -z "$url" ]]; then
    echo "[tunnel-daemon] ERROR: tunnel URL not detected within 30s"
    kill "$TUNNEL_PID" 2>/dev/null || true
    return 1
  fi

  echo "$url" > "$TUNNEL_FILE"
  echo "[tunnel-daemon] tunnel URL: $url -> $TUNNEL_FILE"
  echo "[tunnel-daemon] cloudflared PID=$TUNNEL_PID"
  return 0
}

# 메인 루프: 둘 중 하나 죽으면 양쪽 재시작
while true; do
  if ! start_server; then
    sleep 5; continue
  fi
  if ! start_tunnel; then
    kill "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
    sleep 5; continue
  fi

  # 한 쪽이라도 죽을 때까지 대기
  while kill -0 "$SERVER_PID" 2>/dev/null && kill -0 "$TUNNEL_PID" 2>/dev/null; do
    sleep 5
  done

  echo "[tunnel-daemon] one of the processes died, restarting both..."
  kill "$SERVER_PID" 2>/dev/null || true
  kill "$TUNNEL_PID" 2>/dev/null || true
  rm -f "$TUNNEL_FILE"
  sleep 3
done
