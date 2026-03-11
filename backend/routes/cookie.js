/**
 * cookie.js — Express 라우터
 *
 * POST /api/cookie/coupang
 *   body: { cookies: "<cookie string>", updatedAt: "<ISO8601>" }
 *   → backend/.cookies/coupang.json 에 저장
 *   → { success: true, expiresAt: "<ISO8601>" }
 *
 * GET /api/cookie/coupang/status
 *   → { hasData: bool, expiresAt, daysLeft, isExpired }
 */

'use strict';

const { Router } = require('express');
const { saveCookies, loadCookieData, isExpired, daysUntilExpiry } = require('../services/cookieStore');

const router = Router();

// POST /api/cookie/coupang
router.post('/coupang', (req, res) => {
  const { cookies, updatedAt } = req.body || {};

  if (!cookies || typeof cookies !== 'string' || !cookies.trim()) {
    return res.status(400).json({ success: false, error: 'cookies 필드가 비어 있습니다.' });
  }

  try {
    const data = saveCookies(cookies.trim(), updatedAt || undefined);
    console.log(`[cookie] 쿠팡 쿠키 저장됨 — expires: ${data.expiresAt}`);
    return res.json({ success: true, expiresAt: data.expiresAt });
  } catch (err) {
    console.error('[cookie] 저장 실패:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/cookie/coupang/status
router.get('/coupang/status', (req, res) => {
  const data = loadCookieData();
  if (!data) {
    return res.json({ hasData: false, isExpired: true, daysLeft: -1, expiresAt: null });
  }
  return res.json({
    hasData: true,
    isExpired: isExpired(),
    daysLeft: daysUntilExpiry(),
    expiresAt: data.expiresAt,
    updatedAt: data.updatedAt,
  });
});

module.exports = router;
