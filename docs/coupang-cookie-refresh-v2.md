# Mac Mini 세팅: Chrome CDP + 쿠팡 쿠키 자동 갱신

> Mac Mini를 새로 세팅하거나 교체할 때 참고하는 문서.
> 개발 작업 아님 — 터미널에서 직접 실행하는 절차.

---

## 배경

쿠팡 Akamai 우회에 필요한 쿠키를 자동으로 갱신하기 위해,
Chrome을 CDP(Chrome DevTools Protocol) 디버그 모드로 상시 실행한다.
`coupang-cookie-refresh.js` 스크립트가 이 Chrome에서 쿠키를 추출해 cookieStore에 저장한다.

---

## 사전 조건

- Google Chrome 설치됨 (`/Applications/Google Chrome.app`)
- `crawler-pipeline` repo 클론됨
- 쿠팡 계정 로그인 정보

---

## Step 1 — Chrome launchd 등록

Mac Mini 부팅 시 Chrome이 자동으로 CDP 포트 9223으로 실행되도록 등록한다.

```bash
cat > ~/Library/LaunchAgents/com.roughdiamond.chrome-debug.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.roughdiamond.chrome-debug</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Applications/Google Chrome.app/Contents/MacOS/Google Chrome</string>
    <string>--remote-debugging-port=9223</string>
    <string>--no-first-run</string>
    <string>--no-default-browser-check</string>
    <string>--user-data-dir=/Users/judy/Library/Application Support/Google/Chrome/RoughDiamond</string>
    <string>https://www.coupang.com</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>/tmp/chrome-debug.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/chrome-debug-error.log</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.roughdiamond.chrome-debug.plist
launchctl start com.roughdiamond.chrome-debug
```

---

## Step 2 — CDP 연결 확인

```bash
sleep 3 && curl -s http://localhost:9223/json/version
```

JSON이 출력되면 성공. 안 나오면 에러 로그 확인:

```bash
cat /tmp/chrome-debug-error.log
```

---

## Step 3 — 쿠팡 로그인

Chrome에서 coupang.com에 로그인한다. 이후 세션은 자동 유지된다.

---

## Step 4 — crontab 등록

```bash
crontab -e
```

아래 추가 (매일 오전 7시 50분 실행):

```
50 7 * * * cd /Users/judy/dev/crawler-pipeline && node backend/scripts/coupang-cookie-refresh.js >> /tmp/cookie-refresh.log 2>&1
```

---

## 동작 확인

```bash
node backend/scripts/coupang-cookie-refresh.js --force --dry-run
```

예상 출력:
```
[cookie-refresh] 쿠키 22개 추출 완료
[cookie-refresh] --dry-run 모드 — 저장 생략. 종료.
추출된 쿠키 이름: sid, ak_bmsc, _abck, ...
```

---

## launchd 관리 명령어

```bash
# 재시작
pkill -a "Google Chrome"
launchctl start com.roughdiamond.chrome-debug

# 등록 해제
launchctl unload ~/Library/LaunchAgents/com.roughdiamond.chrome-debug.plist

# 상태 확인
launchctl list | grep roughdiamond
```

---

## 주의사항

- Chrome 로그인 세션이 만료되면 사람이 직접 로그인 필요 (자동화 불가)
- Playwright 데몬(포트 9222)과 이 Chrome(포트 9223)은 별개 프로세스
- `--user-data-dir`은 기본 Chrome 프로필과 분리된 전용 디렉토리