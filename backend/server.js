/**
 * backend/server.js — 쿠팡 자동화 백엔드 API 서버
 *
 * 엔드포인트:
 *   POST /api/cookie/coupang        — 크롬 확장에서 쿠키 수신
 *   GET  /api/cookie/coupang/status — 쿠키 만료 상태 조회
 *
 * Usage:
 *   node backend/server.js
 *   PORT=4000 node backend/server.js  (기본 포트: 4000)
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cookieRouter = require('./routes/cookie');

const app = express();
const PORT = process.env.BACKEND_PORT || 4000;

app.use(express.json());

// CORS — Chrome 확장에서 localhost 호출 허용
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/api/cookie', cookieRouter);

app.get('/health', (_, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[server] Backend API listening on http://localhost:${PORT}`);
});
