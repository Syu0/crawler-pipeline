# RoughDiamond Dashboard

Mobile-first control room for Coupang → Qoo10 automation.

## Features
- Glassmorphism dark UI (mobile-first)
- Tabs: Overview / Qoo10 Registration / Tasks / Logs & Alerts / Chat
- Google Sheets summary (`coupang_datas`)
- Registration trigger + live polling status
- OpenClaw existing session integration (history + send + confirm)
- Basic-auth passcode gate (`DASHBOARD_PASSCODE`)

## Env vars (server only)

```bash
DASHBOARD_PASSCODE=your-passcode

# Sheets
GOOGLE_SHEETS_CLIENT_EMAIL=
GOOGLE_SHEETS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEETS_SPREADSHEET_ID=

# OpenClaw current session integration
OPENCLAW_BASE_URL=
OPENCLAW_API_TOKEN=
OPENCLAW_SESSION_ID=

# Registration runner
REGISTRATION_WORKDIR=../backend
REGISTRATION_CMD="npm run test:qoo10:register"
```

## Run
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
npm run start
```

## Deploy (Vercel)
```bash
npm i -g vercel
vercel
vercel --prod
```
