'use strict';

/**
 * 🔑 사이트별 "앱 안에서 바로 로그인".
 *
 * ■ 왜 필요한가
 *   쓰레드·인스타그램·샤오홍슈는 로그인이 없으면 아예 안 받아지거나(비공개·로그인 전용),
 *   받아져도 **사진 일부가 빠진 채** 저장된다(쓰레드 실측). 그런데 예전 방식은
 *   "크롬 확장으로 cookies.txt 를 내보내 등록" 이라 초보자가 거의 못 넘는 벽이었다.
 *
 * ■ 어떻게 푸나
 *   크롬 쿠키를 훔쳐오는 건 불가능하다(크롬 127+ App-Bound Encryption).
 *   대신 앱 안에서 그 사이트 로그인 창을 열어 한 번 로그인받고, 그 결과 쿠키를
 *   **앱 전용 세션(partition)** 에 담아둔다. yt-dlp 는 파일로만 쿠키를 받으므로,
 *   받을 때마다 그 세션의 쿠키를 netscape 형식 파일로 내보내 넘긴다.
 *
 * ■ 개인정보
 *   비밀번호는 앱을 거치지 않는다(사이트 화면에서 직접 로그인). 남는 건 쿠키뿐이고
 *   내 컴퓨터 안에만 저장된다. 세션은 사이트별로 분리돼 서로 섞이지 않는다.
 */

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, session } = require('electron');

/** 인스타·쓰레드는 일렉트론 기본 UA 를 '지원하지 않는 브라우저'로 막는다 → 크롬 UA 로 통일. */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * ⚠️ 쓰레드와 인스타그램은 **같은 세션**을 쓴다(로그인이 인스타 계정으로 이뤄지므로).
 *
 * ⚠️⚠️ 하지만 **로그인 여부는 사이트마다 따로 봐야 한다.**
 *   쿠키는 도메인별로 붙는다. 인스타그램에만 로그인하면 `sessionid` 는 `.instagram.com`
 *   에만 생기고, `threads.com` 요청에는 **안 붙는다**. 그런데 예전에는 쓰레드 상태를
 *   확인할 때 인스타 쿠키까지 같이 보고 "로그인됨" 이라고 했다. 그 결과:
 *     · 화면엔 ✅ 로그인됨 인데 실제로는 비로그인으로 접속 → 쓰레드가 글을 가려
 *       사진이 일부만 내려왔다(실측: 4장짜리 글이 3장).
 *     · 이미 로그인됐다고 판단하니 로그인 창이 열리자마자 닫혀버렸다.
 *   → checkUrls 는 **그 사이트 자기 도메인만** 본다.
 *   (쓰레드에서 로그인하면 그 과정이 인스타 화면에서 이뤄져 양쪽 쿠키가 다 생긴다.
 *    즉 '쓰레드 로그인 → 둘 다' 는 여전히 참이고, 반대 방향만 참이 아니다.)
 */
const SITES = {
  threads: {
    label: '쓰레드',
    partition: 'persist:piggy-threads',
    loginUrl: 'https://www.threads.com/login',
    fallbackUrl: 'https://www.instagram.com/accounts/login/',
    checkUrls: ['https://www.threads.com'],   // 자기 도메인만 — 위 ⚠️⚠️ 참고
    cookieNames: ['sessionid'],
    urlRe: /(^|\/\/)(www\.)?threads\.(net|com)\//i,
    win: { width: 520, height: 780 },
  },
  instagram: {
    label: '인스타그램',
    partition: 'persist:piggy-threads',
    loginUrl: 'https://www.instagram.com/accounts/login/',
    checkUrls: ['https://www.instagram.com'],  // 자기 도메인만 — 위 ⚠️⚠️ 참고
    cookieNames: ['sessionid'],
    urlRe: /(^|\/\/)(www\.)?instagram\.com\//i,
    win: { width: 520, height: 780 },
  },
  xhs: {
    label: '샤오홍슈',
    partition: 'persist:piggy-xhs',
    // 로그인 전용 주소가 따로 없다 — 첫 화면을 열면 로그인 창이 뜬다.
    loginUrl: 'https://www.xiaohongshu.com/explore',
    checkUrls: ['https://www.xiaohongshu.com'],
    cookieNames: ['web_session'],
    urlRe: /(^|\/\/)(www\.)?xiaohongshu\.com\/|xhslink\.com\//i,
    win: { width: 1120, height: 840 },
  },
};

const getSite = (key) => SITES[key] || null;
const getSession = (key) => session.fromPartition(getSite(key).partition);

/** 이 주소가 어느 사이트인가 (쿠키를 붙일지 판단용) */
function siteOfUrl(url) {
  const u = String(url || '');
  for (const key of ['threads', 'instagram', 'xhs']) {
    if (SITES[key].urlRe.test(u)) return key;
  }
  return null;
}

/** 로그인 상태인가 — 세션 쿠키가 살아 있으면 로그인으로 본다. */
async function isLoggedIn(key) {
  const site = getSite(key);
  if (!site) return false;
  try {
    const ses = getSession(key);
    for (const url of site.checkUrls) {
      const cookies = await ses.cookies.get({ url });
      if (cookies.some((c) => site.cookieNames.includes(c.name) && c.value)) return true;
    }
  } catch (_) { /* 확인 실패는 '로그인 아님'으로 본다 */ }
  return false;
}

/** 세 사이트 상태를 한 번에 (UI 뱃지용) */
async function statusAll() {
  const out = {};
  for (const key of Object.keys(SITES)) out[key] = await isLoggedIn(key);
  return out;
}

/** 로그인 창이 눈에 보이기도 전에 닫히면 사용자는 "창이 깜빡하고 사라졌다" 로만 본다. */
const MIN_VISIBLE_MS = 2000;
const POLL_MS = 1200;

/**
 * 로그인 창을 열고, 로그인이 확인되면 **저절로 닫아준다**.
 * (사용자가 "이제 창을 닫아도 되나?" 를 고민하지 않게 한다)
 *
 * ⚠️ 이미 로그인된 상태에서 다시 누르면 = **계정을 바꾸겠다는 뜻**이다.
 *    이때 세션을 안 비우면 두 가지가 동시에 터진다.
 *      1) 로그인 화면 대신 이미 로그인된 피드가 뜬다(계정을 못 바꾼다)
 *      2) '로그인됨' 이 처음부터 참이라 감시 타이머가 즉시 창을 닫아버린다
 *    → 다시 로그인은 먼저 지우고 시작한다.
 */
function openLogin(key) {
  const site = getSite(key);
  if (!site) return Promise.resolve({ ok: false, error: '알 수 없는 사이트' });

  return (async () => {
    const relogin = await isLoggedIn(key);
    if (relogin) await logout(key);   // 계정 바꾸기 — 지우고 새로 받는다

    return new Promise((resolve) => {
      const win = new BrowserWindow({
        width: site.win.width,
        height: site.win.height,
        title: `${site.label} 로그인`,
        autoHideMenuBar: true,
        webPreferences: { session: getSession(key), javascript: true, images: true },
      });

      const openedAt = Date.now();
      let done = false;
      let timer = null;

      const finish = async () => {
        if (done) return;
        done = true;
        if (timer) clearInterval(timer);
        const loggedIn = await isLoggedIn(key);
        // 로그인했으면 그 자리에서 쿠키 파일로 내보내 둔다(다음 다운로드가 바로 쓰도록).
        if (loggedIn) { try { await exportCookieFile(key); } catch (_) { /* 실패해도 세션은 살아 있다 */ } }
        try { if (!win.isDestroyed()) win.destroy(); } catch (_) { /* 이미 닫힘 */ }
        resolve({ ok: true, loggedIn, site: key, relogin });
      };

      // 페이지가 뜬 뒤부터 감시한다. 로드 전에 돌리면 남아 있던 쿠키를 보고 바로 닫을 수 있다.
      win.webContents.once('did-finish-load', () => {
        if (done) return;
        timer = setInterval(async () => {
          if (done) return;
          if (Date.now() - openedAt < MIN_VISIBLE_MS) return;   // 깜빡임 방지
          if (await isLoggedIn(key)) finish();
        }, POLL_MS);
      });

      win.on('closed', () => finish());   // 사용자가 그냥 닫아도 상태는 확인해 준다
      win.loadURL(site.loginUrl, { userAgent: UA }).catch(() => {
        if (site.fallbackUrl) win.loadURL(site.fallbackUrl, { userAgent: UA }).catch(() => {});
      });
    });
  })();
}

/** 로그인을 지운다(계정 바꿀 때). 같은 세션을 쓰는 사이트는 함께 풀린다. */
async function logout(key) {
  const site = getSite(key);
  if (!site) return { ok: false };
  try {
    await getSession(key).clearStorageData();
    try { fs.unlinkSync(cookieFilePath(site.partition)); } catch (_) { /* 파일이 없으면 그만 */ }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/* ---------- yt-dlp 로 넘길 쿠키 파일 ---------- */

function cookieFilePath(partition) {
  const safe = partition.replace(/[^a-z0-9-]/gi, '_');
  return path.join(app.getPath('userData'), `session-${safe}.txt`);
}

/** 이 앱이 관리하는 도메인만 내보낸다(다른 사이트 쿠키는 애초에 없지만, 확실히 해 둔다). */
const EXPORT_DOMAIN_RE = /(threads|instagram|facebook|cdninstagram|xiaohongshu|xhscdn)/i;

/**
 * 세션 쿠키 → netscape cookies.txt.
 * yt-dlp 는 파일로만 쿠키를 받으므로 매번 최신 상태로 다시 쓴다(쿠키는 갱신·회전된다).
 * @returns {Promise<string|null>} 파일 경로(쿠키가 하나도 없으면 null)
 */
async function exportCookieFile(key) {
  const site = getSite(key);
  if (!site) return null;
  let cookies = [];
  try { cookies = await getSession(key).cookies.get({}); } catch (_) { return null; }

  const lines = ['# Netscape HTTP Cookie File', '# Piggy Downloader 가 앱 내 로그인 세션에서 자동 생성합니다.'];
  for (const c of cookies) {
    const domain = c.domain || '';
    if (!EXPORT_DOMAIN_RE.test(domain)) continue;
    const includeSub = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const expires = Math.floor(c.expirationDate || 0); // 세션 쿠키는 0
    // 값에 탭·줄바꿈이 들어가면 파일 형식이 깨진다 → 그런 쿠키는 건너뛴다.
    if (/[\t\r\n]/.test(c.name) || /[\t\r\n]/.test(c.value)) continue;
    lines.push([domain, includeSub, c.path || '/', c.secure ? 'TRUE' : 'FALSE', expires, c.name, c.value].join('\t'));
  }
  if (lines.length <= 2) return null;

  const dest = cookieFilePath(site.partition);
  try {
    fs.writeFileSync(dest, lines.join('\n') + '\n', 'utf8');
    return dest;
  } catch (_) {
    return null;
  }
}

/**
 * 이 주소를 받을 때 쓸 쿠키.
 * ⚠️ **그 사이트에 로그인돼 있을 때만** 돌려준다.
 *    로그인도 안 했는데 빈 쿠키 파일을 붙이면, 쿠키 없이도 잘 되던 경로(인스타 리졸버)를
 *    건너뛰어 버려서 오히려 안 받아진다.
 * @returns {Promise<{mode:'file', file:string}|null>}
 */
async function cookiesForUrl(url) {
  const key = siteOfUrl(url);
  if (!key) return null;
  if (!(await isLoggedIn(key))) return null;
  const file = await exportCookieFile(key);
  return file ? { mode: 'file', file } : null;
}

module.exports = { SITES, siteOfUrl, isLoggedIn, statusAll, openLogin, logout, exportCookieFile, cookiesForUrl };
