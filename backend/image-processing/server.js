/**
 * server.js — 로컬 이미지 static 호스팅.
 *
 * 목적: 재가공된 상품 이미지를 /images/<file> 경로로 공개 HTTP 서빙.
 * cloudflared tunnel이 이 서버를 공개 HTTPS URL로 노출 → Qoo10이 external URL로 참조.
 *
 * 실행:
 *   cd /Users/judy/dev/crawler-pipeline
 *   node backend/image-processing/server.js
 *
 * env:
 *   IMAGE_SERVER_PORT (default 8787)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.IMAGE_SERVER_PORT || 8787);
const HOSTED_DIR = path.resolve(__dirname, 'hosted');

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/' || pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('crawler-pipeline image host OK\n');
  }

  const m = pathname.match(/^\/images\/(.+)$/);
  if (!m) {
    res.writeHead(400);
    return res.end('bad path');
  }

  const rel = m[1];
  if (rel.includes('..')) {
    res.writeHead(403);
    return res.end('forbidden');
  }

  const full = path.resolve(HOSTED_DIR, rel);
  if (!full.startsWith(HOSTED_DIR + path.sep) && full !== HOSTED_DIR) {
    res.writeHead(403);
    return res.end('forbidden');
  }

  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404);
      return res.end('not found');
    }
    const mime = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': st.size,
      'Cache-Control': 'public, max-age=604800',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(full).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[img-server] listening on http://127.0.0.1:${PORT}`);
  console.log(`[img-server] serving ${HOSTED_DIR}`);
});
