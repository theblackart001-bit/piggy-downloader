'use strict';

const http = require('http');
const { clipboard } = require('electron');

/**
 * 브라우저/클립보드 ↔ 앱 브리지.
 *  1) 클립보드 감시: 영상 URL 이 복사되면 렌더러로 자동 전달
 *  2) 로컬 HTTP 서버: 크롬 확장의 플로팅 버튼이 호출 -> 다운로드 추가
 */

const VIDEO_HOST = /(youtu\.?be|youtube\.com|tiktok\.com|instagram\.com|threads\.(net|com)|vimeo\.com|facebook\.com|fb\.watch|twitter\.com|x\.com|naver\.com|kakao|twitch\.tv|bilibili\.com|dailymotion\.com|xiaohongshu\.com|rednote\.com|xhslink\.com|douyin\.com|iesdouyin\.com)/i;
const PORT = 53472; // 크롬 확장과 약속된 고정 포트

function isVideoUrl(text) {
  return typeof text === 'string' && /^https?:\/\/\S+$/.test(text.trim()) && VIDEO_HOST.test(text);
}

// 링크는 공백·따옴표·괄호·한중일/전각 문자(，。！【】 등)에서 끊는다.
//   샤오홍슈·도우인 앱 '공유' 문구는 링크 바로 뒤에 '，复制本条信息…' 처럼 전각 쉼표가 붙어 온다.
const LINK_RE = /https?:\/\/[^\s"'<>()\[\]{}　-〿㐀-鿿가-힯＀-￯]+/gi;
const MAX_SCAN_LEN = 2000; // 긴 문서를 통째로 복사했을 때까지 링크를 주워 가지는 않는다

/** 복사한 글에서 첫 영상 링크를 뽑는다(없으면 null).
 *  글 전체가 링크면 그대로, 앱 공유 문구('… http://xhslink.com/a/AbC，复制本条信息…')면 그 안의 링크만.
 *  🟥 쿼리(xsec_token 등)는 절대 건드리지 않는다 — 샤오홍슈는 토큰 없는 주소를 거절한다. */
function extractVideoUrl(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (!t) return null;
  if (isVideoUrl(t)) return t;
  if (t.length > MAX_SCAN_LEN) return null;
  for (const m of t.match(LINK_RE) || []) {
    const url = m.replace(/[.,;:!?]+$/, ''); // 문장 끝 마침표 등(= 는 토큰 끝일 수 있어 남긴다)
    if (VIDEO_HOST.test(url)) return url;
  }
  return null;
}

function startClipboardWatch(getWindow, intervalMs = 900) {
  let last = clipboard.readText();
  const timer = setInterval(() => {
    let cur;
    try { cur = clipboard.readText(); } catch (_) { return; }
    if (cur && cur !== last) {
      last = cur;
      const url = extractVideoUrl(cur);
      if (url) {
        const win = getWindow();
        if (win && !win.isDestroyed()) win.webContents.send('clipboard:url', url);
      }
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

function startServer(getWindow, handlers = {}) {
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

    // 자막 미리보기: 영상 본체 없이 오디오만 전사 → 미리보기 창
    if (url.pathname === '/transcribe') {
      const target = (url.searchParams.get('url') || '').trim();
      if (target && /^https?:\/\//.test(target) && typeof handlers.onTranscribe === 'function') {
        handlers.onTranscribe(target);
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

module.exports = { startClipboardWatch, startServer, isVideoUrl, extractVideoUrl, PORT };
