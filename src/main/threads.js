'use strict';

/**
 * 🧵 Threads(스레드) 리졸버.
 *
 * ■ 왜 따로 필요한가
 *   · yt-dlp 에 Threads 추출기가 아예 없다("Unsupported URL").
 *   · snapsave 도 인스타/페북/틱톡/X 만 지원한다.
 *   · 페이지 HTML 을 그냥 받아도 소용없다 — Threads 는 자바스크립트로 그리기 때문에
 *     처음 내려오는 HTML 에는 미디어 주소(video_versions 등)가 들어 있지 않다.
 *
 * ■ 어떻게 푸나 (쓰레드 쇼핑 자동화 앱에서 검증된 방식을 이식)
 *   숨긴 창으로 글을 실제로 열고, 그 페이지가 **네트워크로 가져가는 mp4/이미지 주소를
 *   가로채서** 모은다. 화면의 <video> 는 blob: 이라 못 받지만, 진짜 파일은
 *   scontent...fbcdn.net 에서 내려오므로 그 주소를 잡으면 된다.
 *
 * ■ 개인정보
 *   숨긴 창은 앱 전용 세션(partition)을 쓴다. 사용자가 [🔑 로그인]으로 쿠키를 등록해 두면
 *   비공개 글도 열 수 있도록 그 쿠키만 주입한다. 그 외에는 아무것도 저장하지 않는다.
 */

const fs = require('fs');
const path = require('path');
const { BrowserWindow, session } = require('electron');

const THREADS_RE = /(^|\/\/)(www\.)?threads\.(net|com)\//i;

/**
 * 스레드 전용 세션 이름.
 * ⚠️ 'persist:' 를 반드시 붙인다 — 없으면 메모리 세션이라 앱을 끄는 순간 로그인이 날아간다.
 *    (사용자가 매번 다시 로그인하게 된다)
 */
const PARTITION = 'persist:piggy-threads';
const getSession = () => session.fromPartition(PARTITION);

/** 스레드/인스타는 브라우저를 가려 받는다 — 로그인 창과 조회 창 모두 같은 크롬 UA 로 통일한다. */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 로그인 상태인가 — 스레드/인스타 세션 쿠키가 있으면 로그인으로 본다. */
async function isLoggedIn() {
  try {
    const ses = getSession();
    for (const url of ['https://www.threads.com', 'https://www.instagram.com']) {
      const cookies = await ses.cookies.get({ url });
      if (cookies.some((c) => c.name === 'sessionid' && c.value)) return true;
    }
  } catch (_) { /* 확인 실패는 '로그인 아님'으로 본다 */ }
  return false;
}

/**
 * 앱 안에서 직접 로그인시킨다(경쟁사 SB 다운로더와 같은 방식).
 *
 * ■ 왜 브라우저 쿠키를 긁어오지 않나
 *   크롬 127 부터 쿠키에 App-Bound Encryption 이 걸려서, 크롬을 꺼도 외부 프로그램이
 *   복호화할 수 없다(실측: 크롬 150, yt-dlp `--cookies-from-browser chrome` 실패).
 *   그래서 앱 안에서 한 번 로그인받아 이 세션에 담아두는 쪽이 확실하다.
 *
 * ■ 개인정보
 *   비밀번호는 앱을 거치지 않는다. 로그인은 인스타그램 화면에서 직접 이뤄지고,
 *   결과로 생긴 쿠키만 이 앱 전용 세션에 남는다(다른 사이트와 분리).
 *
 * @returns {Promise<{ok:boolean, loggedIn:boolean}>}
 */
function openLogin() {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: 760,
      title: '스레드 로그인',
      autoHideMenuBar: true,
      webPreferences: { session: getSession(), javascript: true, images: true },
    });
    let done = false;
    const finish = async () => {
      if (done) return;
      done = true;
      const loggedIn = await isLoggedIn();
      try { if (!win.isDestroyed()) win.destroy(); } catch (_) { /* 이미 닫힘 */ }
      resolve({ ok: true, loggedIn });
    };

    // 로그인이 끝나면 굳이 사용자가 창을 닫게 하지 않는다 — 확인되는 즉시 닫아준다.
    const timer = setInterval(async () => {
      if (done) return;
      if (await isLoggedIn()) { clearInterval(timer); finish(); }
    }, 1500);

    win.on('closed', () => { clearInterval(timer); finish(); });
    // ⚠️ 일렉트론 기본 UA 로 열면 인스타가 '지원하지 않는 브라우저'로 막을 수 있다 → 크롬 UA 로 연다.
    win.loadURL('https://www.threads.com/login', { userAgent: UA }).catch(() => {
      win.loadURL('https://www.instagram.com/accounts/login/', { userAgent: UA }).catch(() => {});
    });
  });
}

/** 로그인을 지운다(계정 바꿀 때). */
async function logout() {
  try { await getSession().clearStorageData(); return { ok: true }; } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

/** 이 URL 이 Threads 인가 */
function shouldHandle(url) {
  return THREADS_RE.test(String(url || ''));
}

/** 글 식별자(파일명·표시용): .../post/ABC123 → ABC123 */
function postCode(url) {
  const m = String(url || '').match(/\/post\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/** 미디어 주소 판별 — Threads/인스타 CDN 에서 오는 실제 파일만 고른다. */
const isVideoUrl = (u) => /\.mp4(\?|$)/i.test(u) && /(fbcdn|cdninstagram)/i.test(u);
const isPhotoUrl = (u) =>
  /\.(jpe?g|webp|png)(\?|$)/i.test(u) &&
  /(fbcdn|cdninstagram)/i.test(u) &&
  !/\/(rsrc|static)\b/i.test(u) &&   // 로고·아이콘 등 UI 리소스 제외
  !/\bs\d{2,3}x\d{2,3}\b/i.test(u);  // 프로필 썸네일(작은 정사각) 제외

/**
 * 후보 영상 주소 중 **실제 용량이 가장 큰 것**을 고른다(= 최고화질).
 * 스레드는 같은 영상을 여러 화질로 흘려보내고, 먼저 잡힌 게 최고화질이 아닐 수 있다.
 * 용량 확인에 실패한 주소는 0 으로 두고 넘어간다(전부 실패하면 첫 번째를 쓴다).
 */
// 진짜 영상으로 인정할 최소 크기.
// ⚠️ 스레드는 프로필 아바타를 mp4 컨테이너로 내보내기도 한다(실측: 150x150 mjpeg, 0.04초, 7.5KB).
//    그걸 영상으로 받아버리면 "받았는데 아무것도 없는 파일"이 나온다.
const MIN_VIDEO_BYTES = 200 * 1024; // 200KB

async function pickLargest(urls, say) {
  if (say) say(`🧵 화질 ${urls.length}개 확인 중...`);
  const sized = await Promise.all(
    urls.map(async (u) => {
      try {
        // HEAD 를 막는 CDN 이 있어 1바이트만 요청해 전체 크기를 읽는다.
        const res = await fetch(u, {
          method: 'GET',
          headers: { Range: 'bytes=0-0' },
          signal: AbortSignal.timeout(8000),
        });
        const cr = res.headers.get('content-range'); // "bytes 0-0/1234567"
        const total = cr && cr.includes('/') ? Number(cr.split('/')[1]) : Number(res.headers.get('content-length') || 0);
        return { u, size: Number.isFinite(total) ? total : 0 };
      } catch (_) {
        return { u, size: 0 };
      }
    }),
  );
  sized.sort((a, b) => b.size - a.size);
  const top = sized[0];
  // 가장 큰 것조차 너무 작으면 = 아바타/썸네일이지 영상이 아니다 → 영상 없음으로 처리.
  if (!top || top.size < MIN_VIDEO_BYTES) {
    if (say) say('🧵 (영상은 없고 사진만 있는 글로 보입니다)');
    return null;
  }
  if (say) say(`🧵 최고화질 선택 (${(top.size / 1024 / 1024).toFixed(1)}MB)`);
  return top.u;
}

/**
 * text 안의 pos 위치를 감싸는 가장 안쪽 JSON 객체({...})를 찾아 파싱한다.
 * 문자열 안의 중괄호에 속지 않도록 따옴표·이스케이프를 함께 추적한다.
 */
function enclosingObject(text, pos) {
  const stack = [];
  let inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') stack.push(i);
    else if (c === '}') {
      const start = stack.pop();
      // pos 를 품는 객체가 닫히는 순간이 곧 '가장 안쪽 객체'다.
      if (start !== undefined && start <= pos && i >= pos) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch (_) { /* 더 바깥 객체로 계속 */ }
      }
    }
  }
  return null;
}

/** 후보 중 가장 큰 것(픽셀 수 기준). 크기 정보가 없으면 첫 번째. */
function largest(cands) {
  if (!Array.isArray(cands) || !cands.length) return null;
  const withSize = cands.filter((c) => c && c.width && c.height);
  if (!withSize.length) return cands[0];
  return withSize.slice().sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
}

/**
 * ★ 페이지에 박혀 있는 **글 데이터(JSON)** 에서 이 글의 미디어만 순서대로 뽑는다.
 *
 * 왜 이게 낫나 — 예전엔 화면에 뜬 <img> 와 네트워크로 흘러간 주소를 긁어모았는데,
 *   · 캐러셀 1번이 **영상**이면 그 자리의 <img> 는 '영상 커버'라, 영상 대신 커버 사진을 받았다.
 *   · 글 하나를 열어도 아래 피드까지 같이 그려져서(실측 컨테이너 53개, 이미지 93장)
 *     남의 글 사진과 같은 사진의 다른 크기 판본이 섞여 15장이 받아졌다(실제 미디어는 3개).
 *   JSON 에는 이 글의 carousel_media 가 순서대로, 영상은 video_versions(진짜 mp4 주소)로 들어 있다.
 *
 * @returns {Promise<{media:Array<{kind:'video'|'photo',url:string}>, caption:string}|null>}
 */
async function extractFromPageData(win, code) {
  let raw = '';
  try {
    raw = await win.webContents.executeJavaScript(`
      (() => [...document.querySelectorAll('script')]
        .map((s) => s.textContent || '')
        .filter((t) => /carousel_media|video_versions/.test(t))
        .join('\\n'))()
    `);
  } catch (_) { return null; }
  if (!raw) return null;

  const idx = raw.indexOf(`"code":"${code}"`);
  if (idx < 0) return null;
  const post = enclosingObject(raw, idx);
  if (!post) return null;

  // 캐러셀이면 항목들, 아니면 글 자체가 미디어 하나다.
  const items = Array.isArray(post.carousel_media) && post.carousel_media.length
    ? post.carousel_media
    : [post];

  const media = [];
  for (const m of items) {
    const v = largest(m && m.video_versions);
    if (v && v.url) { media.push({ kind: 'video', url: v.url }); continue; }
    const img = largest(m && m.image_versions2 && m.image_versions2.candidates);
    if (img && img.url) media.push({ kind: 'photo', url: img.url });
  }
  if (!media.length) return null;

  const caption = String((post.caption && post.caption.text) || '').replace(/\s+/g, ' ').trim();
  return { media, caption };
}

/** 쿠키 파일(netscape 형식)을 세션에 주입 — 비공개 글용. 실패해도 계속 진행. */
async function applyCookies(ses, cookiesFile) {
  if (!cookiesFile || !fs.existsSync(cookiesFile)) return 0;
  let n = 0;
  try {
    const lines = fs.readFileSync(cookiesFile, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      if (!line || line.startsWith('#')) continue;
      const p = line.split('\t');
      if (p.length < 7) continue;
      const [domain, , cookiePath, secure, expires, name, value] = p;
      if (!/threads|instagram|facebook/i.test(domain)) continue;
      try {
        await ses.cookies.set({
          url: `https://${domain.replace(/^\./, '')}${cookiePath || '/'}`,
          name, value, domain,
          path: cookiePath || '/',
          secure: String(secure).toUpperCase() === 'TRUE',
          expirationDate: Number(expires) || undefined,
        });
        n++;
      } catch (_) { /* 쿠키 하나 실패는 무시 */ }
    }
  } catch (_) { /* 파일 문제는 무시 — 공개 글은 쿠키 없이도 된다 */ }
  return n;
}

/**
 * Threads 글에서 미디어 주소를 뽑는다.
 * @returns {Promise<{directUrl:string, kind:'video'|'photo', title:string, code:string,
 *                    videoUrls:string[], photoUrls:string[]}>}
 */
async function resolve(url, { cookiesFile = null, timeoutMs = 25000, onProgress = null } = {}) {
  const code = postCode(url) || 'threads';
  const say = (text) => { if (onProgress) onProgress({ type: 'stage', stage: 'resolving', text }); };
  say('🧵 스레드 글 여는 중...');

  // 앱 전용 세션(사용자 브라우저와 분리). 앱 안에서 로그인해 둔 쿠키가 여기 남아 있다.
  const ses = getSession();
  const cookieCount = await applyCookies(ses, cookiesFile);
  if (cookieCount) say(`🧵 로그인 쿠키 ${cookieCount}개 적용`);

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { session: ses, offscreen: false, javascript: true, images: true },
  });

  const videoUrls = new Set();
  const photoUrls = new Set();
  let title = '';
  let pageData = null; // 글 JSON 에서 뽑은 결과(1순위 경로)

  // 페이지가 가져가는 모든 요청을 훑어 미디어 주소만 줍는다.
  ses.webRequest.onCompleted({ urls: ['<all_urls>'] }, (details) => {
    const u = details.url || '';
    if (isVideoUrl(u)) videoUrls.add(u);
    else if (isPhotoUrl(u)) photoUrls.add(u);
  });

  try {
    // ⚠️ loadURL 은 페이지가 잘 떠도 거부(reject)될 때가 있다.
    //    (리다이렉트·중간 요청 취소 등으로 ERR_FAILED 가 올라온다)
    //    우리가 원하는 건 '네트워크로 흘러간 미디어 주소'이므로,
    //    로드 실패 자체로 포기하지 않고 계속 기다려 본다.
    await win.loadURL(url, { userAgent: UA }).catch((e) => {
      say(`🧵 페이지 로드 경고(${String(e.message || e).slice(0, 40)}) — 계속 진행`);
    });

    // 제목(본문 앞부분)을 파일명 후보로 뽑는다.
    try {
      title = await win.webContents.executeJavaScript(`
        (() => {
          const og = document.querySelector('meta[property="og:title"]');
          if (og && og.content) return og.content;
          const a = document.querySelector('[data-pressable-container] span');
          return (a && a.innerText) || document.title || '';
        })()
      `);
    } catch (_) { /* 제목 없어도 진행 */ }

    // ★ 1순위: 페이지에 박힌 글 데이터(JSON)에서 바로 뽑는다.
    //   화면을 긁는 것보다 정확하다 — 영상은 영상으로, 이 글 것만, 순서 그대로 나온다.
    //   렌더 직후엔 아직 안 박혀 있을 수 있어 잠깐 기다리며 몇 번 시도한다.
    say('🧵 미디어 찾는 중...');
    for (let i = 0; i < 8; i++) {
      pageData = await extractFromPageData(win, code);
      if (pageData) break;
      await new Promise((r) => setTimeout(r, 700));
    }
    if (pageData) {
      // ★ 로그인 벽 감지 — 로그인 없이 열면 스레드가 본문을 "이 콘텐츠를 이용할 수 없습니다"로 가린다(실측).
      //   그래도 페이지에 데이터 조각은 남아 있어 '일부만' 받아진다(실측: 5개짜리 글이 3개만).
      //   조용히 일부만 주면 그게 전부인 줄 알게 된다 → 반드시 알려야 한다.
      //   ⚠️ 판정은 화면이 다 그려진 **이 시점**에 해야 한다. 로드 직후에 물으면 아직 안 붙어 있다.
      let restricted = false;
      try {
        restricted = await win.webContents.executeJavaScript(
          "/이 콘텐츠를 이용할 수 없습니다|콘텐츠를 사용할 수 없습니다|This content isn't available/i.test(document.body.innerText || '')",
        );
      } catch (_) { /* 판단 실패 시 제한 없음으로 본다 */ }

      const nv = pageData.media.filter((m) => m.kind === 'video').length;
      const np = pageData.media.length - nv;
      say(`🧵 확인: 영상 ${nv}개 · 사진 ${np}개`);
      if (restricted) say('🧵 ⚠️ 로그인이 없어 이 글의 일부만 보입니다 — [🧵 스레드 로그인] 후 다시 받아주세요');
      return {
        restricted,
        directUrl: pageData.media[0].url,
        bestVideo: (pageData.media.find((m) => m.kind === 'video') || {}).url || null,
        kind: nv ? 'video' : 'photo',
        // 파일명은 본문 앞부분이 제일 알아보기 쉽다. 본문이 없으면 og:title 로 떨어진다.
        title: (pageData.caption || String(title || '')).replace(/\s+/g, ' ').trim().slice(0, 120),
        code,
        mediaList: pageData.media,
        videoUrls: pageData.media.filter((m) => m.kind === 'video').map((m) => m.url),
        photoUrls: pageData.media.filter((m) => m.kind === 'photo').map((m) => m.url),
      };
    }
    say('🧵 (글 데이터를 못 읽어 화면에서 찾습니다)');

    // ── 이하 예비 경로: JSON 을 못 읽었을 때만 화면·네트워크를 긁는다 ──
    // 영상은 재생을 건드려야 실제 mp4 를 받아오는 경우가 많다.
    try {
      await win.webContents.executeJavaScript(`
        (() => {
          const v = document.querySelector('video');
          if (v) { v.muted = true; const p = v.play(); if (p && p.catch) p.catch(() => {}); }
          window.scrollTo(0, 400);
          return true;
        })()
      `);
    } catch (_) { /* 무시 */ }

    // 사진 여러 장(캐러셀)은 옆으로 넘겨야 뒤쪽 장이 로드된다. 다음 버튼을 몇 번 눌러 준다.
    try {
      await win.webContents.executeJavaScript(`
        (async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          for (let i = 0; i < 12; i++) {
            const btn = document.querySelector('[aria-label="다음"],[aria-label="Next"],button[aria-label*="다음"]');
            if (!btn) break;
            btn.click();
            await sleep(450);
          }
          return true;
        })()
      `);
    } catch (_) { /* 캐러셀이 아니면 그냥 넘어간다 */ }

    // 미디어가 잡힐 때까지 짧게 기다린다(최대 timeoutMs).
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (videoUrls.size > 0) break;                       // 영상이 잡히면 바로 종료
      if (photoUrls.size > 0 && Date.now() > until - timeoutMs / 2) break; // 사진만이면 절반쯤 기다렸다 종료
      await new Promise((r) => setTimeout(r, 400));
    }

    // ★ 사진은 '네트워크에 흘러간 것' 대신 **화면에 실제로 붙은 사진**을 쓴다.
    //   네트워크만 보면 옆 글·추천 피드 사진까지 딸려와(실측 27장) 엉뚱한 걸 받는다.
    //   판별: 화면 표시 크기 140px 이상 + 링크 미리보기 썸네일 제외.
    //   (쇼핑 자동화 앱에서 쓰던 기준을 그대로 가져왔다)
    try {
      const domPhotos = await win.webContents.executeJavaScript(`
        (() => {
          const isReal = (s) => /scontent|cdninstagram|fbcdn/.test(s) && !/external[.-]|\\/emg\\d|[?&]url=/i.test(s);
          const pick = (scope) => [...scope.querySelectorAll('img')]
            .filter((i) => {
              const w = i.clientWidth || i.naturalWidth || 0;
              return w >= 140 && isReal(i.src || '');
            })
            .map((i) => i.src);
          const art = document.querySelector('[data-pressable-container="true"]') || document;
          let out = pick(art);
          if (!out.length) out = pick(document);
          return [...new Set(out)];
        })()
      `);
      if (Array.isArray(domPhotos) && domPhotos.length) {
        photoUrls.clear();
        for (const u of domPhotos) photoUrls.add(u);
      }
    } catch (_) { /* 실패하면 네트워크로 잡은 것을 쓴다 */ }
  } finally {
    // ⚠️ 정리 순서가 중요하다. 이 순서를 지키지 않으면 **앱 전체가 멈춘다**.
    //    (webRequest 리스너가 붙은 채로 창을 없애면 메인 프로세스 이벤트 루프가 막혀
    //     이후 다운로드는 물론 타이머까지 전부 죽는다 — 실제로 재현했다.)
    //    ① 진행 중인 네트워크 중지 → ② 리스너 해제 → ③ 창 파기
    try { win.webContents.stop(); } catch (_) { /* 무시 */ }
    try { ses.webRequest.onCompleted(null); } catch (_) { /* 무시 */ }
    try { win.destroy(); } catch (_) { /* 무시 */ }
  }

  const vids = [...videoUrls];
  const pics = [...photoUrls];
  if (!vids.length && !pics.length) {
    throw new Error('이 스레드 글에서 영상·사진을 찾지 못했습니다(글만 있는 게시물이거나 비공개일 수 있습니다)');
  }

  // ★ 스레드는 같은 영상을 여러 화질로 내보낸다. 먼저 잡힌 게 최고화질이라는 보장이 없어
  //   (실측: 첫 번째를 쓰면 7KB 짜리 조각이 받아졌다) 후보들의 실제 용량을 확인해 가장 큰 것을 고른다.
  const best = vids.length ? await pickLargest(vids, say) : null;

  if (!best && !pics.length) {
    throw new Error('받을 만한 영상·사진이 없습니다(프로필 사진만 있는 글일 수 있습니다)');
  }

  return {
    directUrl: best || pics[0],
    bestVideo: best || null,
    kind: vids.length ? 'video' : 'photo',
    title: String(title || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    code,
    videoUrls: vids,
    photoUrls: pics,
  };
}

/** 미리보기용 메타 — yt-dlp -J 결과와 비슷한 모양으로 돌려준다. */
async function getInfoLike(url, opts = {}) {
  const r = await resolve(url, opts);
  return {
    id: r.code,
    title: r.title || `Threads ${r.code}`,
    thumbnail: r.photoUrls[0] || '',
    uploader: (String(url).match(/@([A-Za-z0-9._]+)/) || [, ''])[1],
    duration: null,
    durationString: '',
    extractor: 'threads',
    webpage_url: url,
    _threads: r,
  };
}

/** 이미 있으면 뒤에 (2), (3)... 을 붙여 겹치지 않는 폴더를 만든다. */
function makeUniqueDir(parent, name) {
  for (let i = 1; i < 100; i++) {
    const dir = path.join(parent, i === 1 ? name : `${name} (${i})`);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); return dir; }
  }
  const dir = path.join(parent, `${name} (${Date.now()})`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 스레드 글의 **모든 미디어**(영상 + 사진)를 저장한다.
 * 유튜브처럼 "주소만 복사하면 알아서" 되도록, 한 글에 여러 장이 있어도 전부 받는다.
 *
 * ■ 저장 형태 (사장님 지시 2026-07-27)
 *   · 1개짜리 글  → 저장 폴더에 그냥  <제목>.mp4
 *   · 여러 개인 글 → **<제목>/ 폴더를 만들어 그 안에** 01.mp4, 02.jpg, 03.jpg ...
 *     사진 10장짜리 글을 받으면 저장 폴더가 통째로 어질러져서 어느 게 한 글인지 알 수 없었다.
 *     번호는 01 처럼 0 을 채운다 — 그래야 탐색기에서 10 이 2 앞으로 가지 않는다.
 *
 * @returns {Promise<{files:string[], first:string, dir:string|null}>}
 */
async function downloadAll(meta, outputDir, { onProgress = null, baseName = '' } = {}) {
  const say = (text) => { if (onProgress) onProgress({ type: 'stage', stage: 'downloading', text }); };
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  const base = safe(baseName || meta.title) || `Threads ${meta.code}`;

  // 글 JSON 을 읽었으면 **글에 실린 순서 그대로**(1번이 영상이면 01.mp4) 받는다.
  const extOf = (u, fallback) => (u.split('?')[0].match(/\.(mp4|jpe?g|png|webp)$/i) || [, fallback])[1].toLowerCase();
  const targets = Array.isArray(meta.mediaList) && meta.mediaList.length
    ? meta.mediaList.map((m) => ({
      url: m.url,
      ext: m.kind === 'video' ? 'mp4' : extOf(m.url, 'jpg'),
    }))
    : [
      ...(meta.bestVideo ? [{ url: meta.bestVideo, ext: 'mp4' }] : []),
      ...meta.photoUrls.map((u) => ({ url: u, ext: extOf(u, 'jpg') })),
    ];
  if (!targets.length) throw new Error('받을 미디어가 없습니다');

  // 여러 개일 때만 폴더를 만든다. 1개인데 폴더를 만들면 열어보는 손이 한 번 더 간다.
  const multi = targets.length > 1;
  const destDir = multi ? makeUniqueDir(outputDir, base) : outputDir;
  if (multi) say(`🧵 '${path.basename(destDir)}' 폴더에 ${targets.length}개 저장합니다`);

  const files = [];
  let n = 0;
  for (const t of targets) {
    n++;
    say(`🧵 ${n}/${targets.length} 받는 중...`);
    // 폴더 안에서는 순서만 알면 되므로 번호만 쓴다(제목이 파일명마다 반복되면 길어서 잘린다).
    const fileName = multi ? `${String(n).padStart(2, '0')}.${t.ext}` : `${base}.${t.ext}`;
    const dest = path.join(destDir, fileName);
    try {
      const res = await fetch(t.url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.threads.com/' },
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) throw new Error('파일이 너무 작습니다');
      fs.writeFileSync(dest, buf);
      files.push(dest);
    } catch (e) {
      // 하나 실패해도 나머지는 계속 받는다.
      say(`🧵 ${n}번째 실패(${String(e.message || e).slice(0, 30)}) — 계속`);
    }
  }
  if (!files.length) {
    // 전부 실패했는데 빈 폴더만 남으면 사용자는 '받아졌나?' 하고 열어보게 된다 → 치운다.
    if (multi) { try { fs.rmdirSync(destDir); } catch (_) { /* 비어있지 않으면 그냥 둔다 */ } }
    throw new Error('미디어를 받지 못했습니다');
  }
  return { files, first: files[0], dir: multi ? destDir : null };
}

module.exports = { shouldHandle, resolve, getInfoLike, downloadAll, postCode, isLoggedIn, openLogin, logout };
