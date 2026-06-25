'use strict';

const http = require('http');
const { clipboard } = require('electron');

/**
 * 브라우저/클립보드 ↔ 앱 브리지.
 *  1) 클립보드 감시: 영상 URL 이 복사되면 렌더러로 자동 전달
 *  2) 로컬 HTTP 서버: 크롬 확장의 플로팅 버튼이 호출 -> 다운로드 추가
 */

const VIDEO_HOST = /(youtu\.?be|youtube\.com|tiktok\.com|instagram\.com|vimeo\.com|facebook\.com|fb\.watch|twitter\.com|x\.com|naver\.com|kakao|twitch\.tv|bilibili\.com|dailymotion\.com)/i;
const PORT = 53472; // 크롬 확장과 약속된 고정 포트

function isVideoUrl(text) {
  return typeof text === 'string' && /^https?:\/\/\S+$/.test(text.trim()) && VIDEO_HOST.test(text);
}

function startClipboardWatch(getWindow, intervalMs = 900) {
  let last = clipboard.readText();
  const timer = setInterval(() => {
    let cur;
    try { cur = clipboard.readText(); } catch (_) { return; }
    if (cur && cur !== last) {
      last = cur;
      if (isVideoUrl(cur)) {
        const win = getWindow();
        if (win && !win.isDestroyed()) win.webContents.send('clipboard:url', cur.trim());
      }
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

function startServer(getWindow) {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    if (url.pathname === '/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, app: 'piggy-downloader' }));
    }

    if (url.pathname === '/add') {
      const target = (url.searchParams.get('url') || '').trim();
      const mode = url.searchParams.get('mode') === 'audio' ? 'audio' : 'video';
      const win = getWindow();
      if (target && /^https?:\/\//.test(target) && win && !win.isDestroyed()) {
        win.webContents.send('external:add', { url: target, mode });
        if (!win.isVisible()) win.show();
        win.focus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'invalid url' }));
    }

    res.writeHead(404);
    res.end();
  });

  server.on('error', (err) => console.error('[bridge] 서버 오류:', err.message));
  server.listen(PORT, '127.0.0.1', () => console.log(`[bridge] 로컬 서버 http://127.0.0.1:${PORT}`));
  return server;
}

module.exports = { startClipboardWatch, startServer, isVideoUrl, PORT };
