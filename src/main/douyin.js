'use strict';

/**
 * 🎬 도우인(抖音, Douyin) 리졸버.
 *
 * ■ 출처
 *   이 파일의 핵심 아이디어(숨긴 브라우저 창으로 실제 페이지를 띄워 그 창이 네트워크로
 *   가져가는 진짜 영상 CDN 주소를 가로챈다)는 **SB Downloader** 의 도우인 처리 방식을
 *   그대로 이식한 것이다. 원작자 동의 하에 포팅했다(2026-09-23, 사장님 확인).
 *   Piggy 코드 스타일(파일 분리·주석 규칙·세션 관리)에 맞춰 새로 작성했고,
 *   SB 의 소스 코드를 그대로 복사하지 않았다.
 *
 * ■ 왜 yt-dlp 로 안 되나
 *   도우인은 모든 요청에 서명 파라미터(X-Bogus/a_bogus)를 요구한다. 이 서명은 도우인의
 *   자바스크립트가 브라우저 안에서 즉석으로 만들어내는데, yt-dlp 는 그 자바스크립트를
 *   실행하지 못한다. 그래서 전 세계 yt-dlp 사용자가 도우인에서 막힌다
 *   (yt-dlp 이슈 #9667 — 2026-09 현재도 미해결).
 *
 * ■ 어떻게 우회하나 — "서명을 흉내 내지 않는다. 진짜 브라우저에게 만들게 한다."
 *   Electron 의 BrowserWindow 는 실제 크로미움이다. 도우인 페이지를 그 안에서 그대로
 *   열면, 도우인 자신의 자바스크립트가 X-Bogus/a_bogus/msToken/ttwid 를 스스로 계산해서
 *   영상 CDN 에 요청을 보낸다. 우리는 서명을 몰라도 되고, 그 요청이 어디로 갔는지
 *   (webRequest 로 가로챈 실제 URL)만 알면 된다 — 그 URL 은 이미 유효한 서명이 붙어 있다.
 *   공유 단축 링크(v.douyin.com)도 마찬가지로, 실제 브라우저가 리다이렉트를 그대로
 *   따라가므로 별도 해석 없이 처리된다.
 *
 * ■ 워터마크
 *   실제 웹페이지가 재생하려고 받아가는 주소를 그대로 쓴다 — 이게 도우인이
 *   화면에 보여주는 원본(play) 스트림이라 공유용 워터마크 mp4(playwm)와 다르다.
 *   워터마크가 있는 버전을 "선택"하는 게 아니라,애초에 워터마크 없는 재생 경로만
 *   가로채므로 별도 처리가 필요 없다.
 *
 * ■ 로그인
 *   `persist:piggy-douyin` 세션을 sitelogin.js 의 도우인 항목과 공유한다.
 *   사용자가 🔑 로그인 창에서 로그인해 두면, 이 창도 같은 세션이라 로그인 상태를
 *   그대로 물려받는다(쿠키 파일을 따로 주입할 필요가 없다 — msToken 처럼 JS 로 심는
 *   쿠키는 파일로 옮기면 이미 낡아 있다). 로그인 없이도 대부분의 공개 영상은 받아지고,
 *   캡차·연령 제한 등으로 막히면 창을 보이게 띄워 사람이 직접 풀 수 있게 한다(2단계 재시도).
 */

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, session } = require('electron');
const { safeName } = require('./filename');

const DOUYIN_RE = /(^|\/\/)(www\.|v\.)?douyin\.com\/|iesdouyin\.com\//i;

/** sitelogin.js 의 도우인 로그인 항목과 **반드시 같은 이름**이어야 로그인 세션을 물려받는다. */
const PARTITION = 'persist:piggy-douyin';
const getSession = () => session.fromPartition(PARTITION);

/** 일렉트론 기본 UA 는 흔적(Electron/x.x)이 남아 안티봇에 의심을 살 수 있어 지운다. */
function cleanUserAgent(ses) {
  try {
    const ua = ses.getUserAgent().replace(/\sElectron\/\S+/i, '').replace(/\spiggy-?downloader\/\S+/i, '');
    ses.setUserAgent(ua);
    return ua;
  } catch (_) {
    return ses.getUserAgent();
  }
}

/** 이 URL 이 도우인인가 */
function shouldHandle(url) {
  return DOUYIN_RE.test(String(url || ''));
}

/** 영상/노트 식별자(파일명·표시용): .../video/7123... 또는 .../note/7123... */
function awemeId(url) {
  const m = String(url || '').match(/\/(?:video|note)\/(\d+)/);
  return m ? m[1] : null;
}

/**
 * 실제 영상 CDN 요청만 골라낸다 — UI 애니메이션 mp4, 프로필 아바타 등은 걸러진다.
 * SB Downloader 실측 패턴(douyinvod·zjcdn·/video/tos/ CDN 도메인)을 그대로 가져왔다.
 */
function isVideoResponse(url, contentType, contentLength) {
  const ct = (contentType || '').toLowerCase();
  const isMp4 = /video\/mp4/.test(ct) || /\.mp4(\?|$)/i.test(url);
  if (!isMp4) return false;
  if (!/douyinvod|zjcdn|aweme|\/video\/tos\//i.test(url)) return false;
  // 아이콘·프리뷰 조각(수 KB)까지 후보로 잡히는 걸 막는다.
  return (contentLength || 0) === 0 || contentLength > 50 * 1024;
}

/** 노트(이미지 글)용 — 도우인 이미지 CDN 의 실제 사진만. */
function isPhotoResponse(url, contentType, contentLength) {
  const ct = (contentType || '').toLowerCase();
  if (!/^image\//.test(ct)) return false;
  if (!/douyinpic\.com/i.test(url)) return false;
  return (contentLength || 0) > 30 * 1024; // 작은 아이콘 제외
}

/**
 * 페이지가 안티봇에 걸려 응답이 없거나 로드가 끊긴 상태에서 executeJavaScript 를 부르면
 * 콜백이 영영 안 돌아올 수 있다(실측: 연결이 막힌 세션에서 무한 대기). 반드시 시간 제한을 둔다.
 */
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** 커스텀 프로토콜(bitbrowser:// 등)로의 이동을 막는다 — 안티봇이 열려는 "앱 설치" 팝업 차단. */
function guardNonHttpNavigation(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const block = (e, navUrl) => { if (navUrl && !/^https?:\/\//i.test(navUrl)) e.preventDefault(); };
  win.webContents.on('will-navigate', block);
  win.webContents.on('will-redirect', block);
  try { win.webContents.on('will-frame-navigate', (e) => { if (e.url && !/^https?:\/\//i.test(e.url)) e.preventDefault(); }); } catch (_) { /* 구버전 Electron엔 없음 */ }
}

/** 세션 쿠키 → netscape cookies.txt. yt-dlp 다운로드 단계에 그대로 넘긴다. */
async function exportCookieFile(ses) {
  let cookies = [];
  try { cookies = await ses.cookies.get({}); } catch (_) { return null; }
  if (!cookies.length) return null;
  const lines = ['# Netscape HTTP Cookie File', '# Piggy Downloader — 도우인 추출 세션'];
  for (const c of cookies) {
    const domain = c.domain || '';
    if (!domain || /[\t\r\n]/.test(c.name) || /[\t\r\n]/.test(c.value)) continue;
    lines.push([
      domain, domain.startsWith('.') ? 'TRUE' : 'FALSE', c.path || '/',
      c.secure ? 'TRUE' : 'FALSE', Math.floor(c.expirationDate || 0), c.name, c.value,
    ].join('\t'));
  }
  const dest = path.join(app.getPath('userData'), 'session-douyin-extract.txt');
  try { fs.writeFileSync(dest, lines.join('\n') + '\n', 'utf8'); return dest; } catch (_) { return null; }
}

/**
 * 화면에 실제로 재생 중인 <video> 의 currentSrc + 제목을 읽는다.
 * 감청한 후보보다 이쪽이 훨씬 정확하다(재생 중인 그 스트림이 곧 정답이므로).
 */
async function readPlayingVideo(win) {
  try {
    return await win.webContents.executeJavaScript(`(() => {
      try {
        const v = document.querySelector('video');
        if (v) { v.muted = true; const p = v.play(); if (p && p.catch) p.catch(() => {}); }
        return {
          src: v ? (v.currentSrc || v.src || '') : '',
          title: (document.title || '').replace(/\\s*[-|_]\\s*抖音.*$/i, '').trim(),
        };
      } catch (e) { return { src: '', title: '' }; }
    })()`, true);
  } catch (_) {
    return { src: '', title: '' };
  }
}

/** 노트(이미지 글) 여부 판단 후 화면에 실제로 붙은 사진들을 모은다(캐러셀 대응, threads.js 와 같은 원리). */
async function readNotePhotos(win) {
  try {
    return await win.webContents.executeJavaScript(`(() => {
      const isReal = (s) => /douyinpic\\.com/i.test(s);
      return [...document.querySelectorAll('img')]
        .filter((i) => (i.clientWidth || i.naturalWidth || 0) >= 200 && isReal(i.src || ''))
        .map((i) => i.src);
    })()`, true);
  } catch (_) {
    return [];
  }
}

/**
 * 도우인 글에서 미디어를 뽑는다. 공유 단축 링크(v.douyin.com)는 실제 브라우저가
 * 알아서 리다이렉트를 따라가므로 그대로 넘기면 된다.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {boolean} [opts.visible]   창을 보여주고 사람이 로그인/캡차를 풀게 한다(2단계 재시도용).
 * @param {function} [opts.onProgress]
 * @returns {Promise<{directUrl, kind:'video'|'photo', title, id, referer, origin, userAgent,
 *                     cookieFile, photoUrls:string[]}>}
 */
async function resolve(url, { visible = false, onProgress = null } = {}) {
  const say = (text) => { if (onProgress) onProgress({ type: 'stage', stage: 'resolving', text }); };
  const id = awemeId(url) || 'douyin';
  say(visible ? '🎬 창을 열었습니다 — 로그인/재생 후 잠시만 기다려주세요' : '🎬 도우인 페이지 여는 중...');

  const ses = getSession();
  const userAgent = cleanUserAgent(ses);

  const win = new BrowserWindow({
    show: visible,
    width: 900,
    height: 780,
    title: visible ? '도우인 — 로그인/재생 후 이 창을 닫아도 됩니다' : undefined,
    webPreferences: { session: ses, javascript: true, images: true },
  });
  guardNonHttpNavigation(win);

  const videoCandidates = []; // { url, len }
  const photoCandidates = new Set();
  let referer = null;
  let origin = null;

  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    // 이 미디어를 요청할 때 브라우저가 실제로 쓴 Referer/Origin — 다운로드 단계에서 그대로 재현해야
    // CDN 의 토큰 검사(핫링크 방지)를 통과한다.
    try {
      const h = details.requestHeaders || {};
      if (isVideoResponse(details.url, '', 0) || /douyinvod|zjcdn|\/video\/tos\//i.test(details.url)) {
        referer = referer || h.Referer || h.referer || null;
        origin = origin || h.Origin || h.origin || null;
      }
    } catch (_) { /* 무시 */ }
    cb({ requestHeaders: details.requestHeaders });
  });
  ses.webRequest.onHeadersReceived((details, cb) => {
    try {
      const h = details.responseHeaders || {};
      const ct = (h['content-type'] || h['Content-Type'] || [''])[0] || '';
      const len = parseInt((h['content-length'] || h['Content-Length'] || ['0'])[0], 10) || 0;
      const status = details.statusCode || 0;
      if (status >= 200 && status < 300) {
        if (isVideoResponse(details.url, ct, len) && !videoCandidates.some((c) => c.url === details.url)) {
          videoCandidates.push({ url: details.url, len });
        } else if (isPhotoResponse(details.url, ct, len)) {
          photoCandidates.add(details.url);
        }
      }
    } catch (_) { /* 무시 */ }
    cb({});
  });

  const IDLE_MS = visible ? 180000 : 20000;     // 문서 하나당 대기(챌린지→진짜 페이지 전환 대응)
  const HARD_CAP_MS = visible ? 300000 : 45000; // 전체 상한
  const startedAt = Date.now();

  try {
    await win.loadURL(url, { userAgent }).catch((e) => {
      say(`🎬 페이지 로드 경고(${String(e.message || e).slice(0, 40)}) — 계속 진행`);
    });

    // 재생/렌더에 시간이 걸리므로 여러 번 확인한다. 후보가 잡히면 조금 더 기다렸다가
    // (진짜 화질로 바뀌는 경우가 있다) 확정한다.
    let played = { src: '', title: '' };
    let stablePolls = 0;
    while (Date.now() - startedAt < Math.min(IDLE_MS, HARD_CAP_MS)) {
      // ⚠️ executeJavaScript 는 페이지가 죽은 채로 멈춰 있으면 콜백이 영영 안 온다 —
      //   시간 제한이 없으면 이 반복문 자체가 무한 대기가 된다(안티봇에 막힌 세션에서 실측).
      played = await withTimeout(readPlayingVideo(win), 5000, { src: '', title: '' });
      if (played.src && /^https?:/i.test(played.src)) { stablePolls++; if (stablePolls >= 2) break; }
      else if (videoCandidates.length) { stablePolls++; if (stablePolls >= 3) break; }
      await new Promise((r) => setTimeout(r, 700));
    }

    const title = safeName(played.title, 120) || `도우인 ${id}`;
    const best = played.src && /^https?:/i.test(played.src)
      ? played.src
      : videoCandidates.sort((a, b) => b.len - a.len)[0]?.url || null;

    if (best) {
      const cookieFile = await exportCookieFile(ses);
      say('🎬 영상 주소를 찾았습니다');
      return { directUrl: best, kind: 'video', title, id, referer: referer || 'https://www.douyin.com/', origin, userAgent, cookieFile, photoUrls: [] };
    }

    // 영상이 없으면 노트(이미지 글)인지 확인 — 화면에 실제 붙은 사진만 채택.
    const domPhotos = await withTimeout(readNotePhotos(win), 5000, []);
    const photos = domPhotos.length ? domPhotos : [...photoCandidates];
    if (photos.length) {
      const cookieFile = await exportCookieFile(ses);
      say(`🎬 사진 ${photos.length}장 확인`);
      return { directUrl: photos[0], kind: 'photo', title, id, referer: 'https://www.douyin.com/', origin, userAgent, cookieFile, photoUrls: photos };
    }

    const err = new Error(
      visible
        ? '이 창에서도 영상·사진을 찾지 못했습니다. 삭제된 게시물이거나 지역 제한일 수 있습니다.'
        : '영상 주소를 찾지 못했습니다(캡차·로그인 필요일 수 있습니다)',
    );
    // 사람이 창에서 직접 재생/로그인하면 풀릴 수 있는 실패만 재시도 대상으로 표시한다.
    err.retryableVisible = !visible;
    throw err;
  } finally {
    try { win.webContents.stop(); } catch (_) { /* 무시 */ }
    try { ses.webRequest.onBeforeSendHeaders(null); } catch (_) { /* 무시 */ }
    try { ses.webRequest.onHeadersReceived(null); } catch (_) { /* 무시 */ }
    // 사람이 보게 띄운 창은 본인이 결과를 확인할 시간을 뺏지 않도록 여기서 바로 닫는다
    // (추출은 이미 끝났고, 남겨둬도 다운로드 자체엔 필요 없다).
    try { win.destroy(); } catch (_) { /* 무시 */ }
  }
}

/**
 * 숨긴 창 → (필요하면) 보이는 창 순으로 한 번 더 시도한다.
 * SB Downloader 의 "숨김 실패 시 로그인 창으로 재시도" 흐름을 그대로 옮겼다.
 */
async function resolveWithRetry(url, { onProgress = null } = {}) {
  try {
    return await resolve(url, { visible: false, onProgress });
  } catch (e) {
    if (!e.retryableVisible) throw e;
    if (onProgress) onProgress({ type: 'stage', stage: 'resolving', text: '🎬 숨겨서는 못 찾았습니다 — 창을 열어 다시 시도합니다' });
    return resolve(url, { visible: true, onProgress });
  }
}

/** 미리보기용 메타 — yt-dlp `-J` 결과와 비슷한 모양으로 돌려준다. */
async function getInfoLike(url, opts = {}) {
  const r = await resolveWithRetry(url, opts);
  return {
    id: r.id,
    title: r.title || `도우인 ${r.id}`,
    thumbnail: r.kind === 'photo' ? r.photoUrls[0] : '',
    uploader: '도우인',
    duration: null,
    duration_string: '',
    extractor_key: 'DouyinBrowser',
    extractor: 'douyin:browser',
    webpage_url: url,
    formats: [],
    _douyin: r,
  };
}

/**
 * 노트(이미지 글) 저장 — yt-dlp 를 거치지 않고 사진을 직접 받는다.
 * threads.js 의 downloadAll 과 같은 규칙: 1장이면 파일 하나, 여러 장이면 폴더.
 * @returns {Promise<{ok:true, file:string, files:string[], dir:string|null}>}
 */
async function downloadPhotos(meta, outputDir) {
  const base = safeName(meta.title, 100) || `도우인 ${meta.id}`;
  const urls = meta.photoUrls.length ? meta.photoUrls : [meta.directUrl];
  const multi = urls.length > 1;
  let destDir = outputDir;
  if (multi) {
    destDir = path.join(outputDir, base);
    for (let i = 1; fs.existsSync(destDir); i++) destDir = path.join(outputDir, `${base} (${i})`);
    fs.mkdirSync(destDir, { recursive: true });
  }

  const files = [];
  let n = 0;
  for (const u of urls) {
    n++;
    const ext = (u.split('?')[0].match(/\.(jpe?g|png|webp)$/i) || [, 'jpg'])[1].toLowerCase();
    const dest = path.join(destDir, multi ? `${String(n).padStart(2, '0')}.${ext}` : `${base}.${ext}`);
    try {
      const res = await fetch(u, { headers: { Referer: 'https://www.douyin.com/' }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) throw new Error('파일이 너무 작습니다');
      fs.writeFileSync(dest, buf);
      files.push(dest);
    } catch (_) { /* 하나 실패해도 나머지는 계속 받는다 */ }
  }
  if (!files.length) {
    if (multi) { try { fs.rmdirSync(destDir); } catch (_) { /* 비어있지 않으면 그냥 둔다 */ } }
    throw new Error('사진을 받지 못했습니다');
  }
  return { ok: true, file: files[0], files, dir: multi ? destDir : null };
}

module.exports = { shouldHandle, resolve, resolveWithRetry, getInfoLike, downloadPhotos, awemeId, PARTITION };
