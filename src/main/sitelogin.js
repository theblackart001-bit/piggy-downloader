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
    // ⚠️ /login 으로 직행하면 폼이 잠깐 떴다가 쓰레드가 피드로 되돌려 버린다(실측).
    //    잘 되는 '쓰레드 쇼핑 자동화' 앱은 **루트를 열고 사용자가 [로그인] 을 누르는** 방식이다.
    //    그 검증된 흐름을 그대로 따른다 — 안내 막대로 어디를 누를지 알려준다.
    // ⚠️ 잘 되는 두 앱(쓰레드 쇼핑 자동화 · SBreads)은 모두 **threads.net** 을 쓴다.
    //    .com 으로 열면 로그인 도중 404('페이지는 길을 잃었습니다')로 끊겨
    //    마지막 sessionid 발급 직전에 멈춘다(실측: ds_user_id 만 심기고 끝났다).
    // 쓰레드 전용 로그인 화면. 인스타 계정을 쓰긴 하지만 **쓰레드 쪽 로그인**이라
    // 여기서 해야 threads.com 에 ds_user_id 가 심긴다.
    loginUrl: 'https://www.threads.com/login',
    fallbackUrl: 'https://www.threads.net/login',
    formUrl: 'https://www.threads.com/login',
    // 쓰레드는 threads.net → threads.com 으로 옮겨왔다. 쿠키가 어느 쪽에 떨어져도 잡는다.
    checkUrls: ['https://www.threads.com', 'https://www.threads.net'],
    // ⚠️ 쓰레드는 threads.com 에 sessionid 를 두지 않는다. 실측한 쿠키:
    //      로그인 전 : csrftoken, ig_did, mid
    //      로그인 후 : csrftoken, ig_did, mid, **ds_user_id**
    //    (sessionid 는 instagram.com 쪽에만 생긴다)
    //    그래서 sessionid 만 찾으면 쓰레드는 영원히 '아직 안 함' 이 된다.
    //    ds_user_id 는 인증을 거쳐야만 생기므로 로그인 표식으로 안전하다.
    cookieNames: ['sessionid', 'ds_user_id'],
    urlRe: /(^|\/\/)(www\.)?threads\.(net|com)\//i,
    win: { width: 520, height: 780 },
  },
  instagram: {
    label: '인스타그램',
    // ⚠️ 쓰레드와 **세션을 나눈다**. 두 계정을 따로 쓰는 사람이 있어서
    //    한 세션을 공유하면 한쪽을 로그인할 때 다른 쪽 계정이 밀려난다.
    partition: 'persist:piggy-instagram',
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
 * 사이트당 로그인 창은 **하나만** 둔다.
 * ⚠️ 누를 때마다 새 창을 띄우면, 앞서 열어둔 창이 위에 겹쳐 있을 수 있다.
 *    사용자는 새로 뜬 로그인 화면 대신 **예전 창(피드)** 을 보고 "로그인이 안 된다" 고 여긴다.
 */
const openWindows = new Map();

/** 로그인 화면이 아닌 곳(피드 등)에 떨어져도 스스로 빠져나올 수 있게 띄우는 안내 막대. */
function bannerScript(loginUrl, label) {
  return `(() => {
    const ID = '__piggy_login_bar__';
    if (document.getElementById(ID)) return;
    const bar = document.createElement('div');
    bar.id = ID;
    bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483647;'
      + 'background:#1f9bf0;color:#fff;font:600 13px/1.4 system-ui,sans-serif;'
      + 'padding:9px 12px;display:flex;align-items:center;gap:10px;box-shadow:0 2px 8px rgba(0,0,0,.25)';
    const txt = document.createElement('span');
    txt.textContent = '${label} 로그인 화면이 아닙니다 — 이 창 오른쪽 위의 [로그인] 을 누르거나, 오른쪽 버튼을 눌러주세요. 로그인을 마치면 창이 저절로 닫힙니다.';
    txt.style.flex = '1';
    const btn = document.createElement('button');
    btn.textContent = '로그인 화면 열기';
    btn.style.cssText = 'flex:none;border:0;border-radius:7px;padding:6px 12px;cursor:pointer;'
      + 'background:#fff;color:#1257a0;font:700 12.5px system-ui,sans-serif';
    btn.onclick = () => { location.href = ${JSON.stringify(loginUrl)}; };
    bar.appendChild(txt); bar.appendChild(btn);
    document.documentElement.appendChild(bar);
    document.body && (document.body.style.paddingTop = '42px');
  })();`;
}

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
    // ⚠️⚠️ 세션을 지우면 안 된다. 지우는 순간 쓰레드에게 **처음 보는 기기**가 되고,
    //    그때마다 이메일 인증 코드를 요구한다(실측: 누를 때마다 코드 요구 → 인증 통과 →
    //    또 지워짐 → 다음에 또 코드. 영원히 로그인이 안 끝난다).
    //    잘 되는 '쓰레드 쇼핑 자동화'·SBreads 는 프로필을 **절대 지우지 않아서**
    //    한 번 인증한 기기로 남고, 그래서 다시는 코드를 묻지 않는다. 그 방식을 따른다.
    //    계정을 바꾸고 싶을 땐 [로그아웃] 버튼을 쓰면 된다 — 그건 사용자가 정할 일이다.

    // 앞서 열어둔 같은 사이트 로그인 창이 있으면 먼저 없앤다(겹쳐 보이는 것을 막는다).
    const prev = openWindows.get(key);
    if (prev && !prev.isDestroyed()) { try { prev.destroy(); } catch (_) { /* 이미 닫힘 */ } }
    openWindows.delete(key);

    return new Promise((resolve) => {
      const win = new BrowserWindow({
        width: site.win.width,
        height: site.win.height,
        title: `${site.label} 로그인`,
        autoHideMenuBar: true,
        webPreferences: { session: getSession(key), javascript: true, images: true },
      });
      openWindows.set(key, win);

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
        if (openWindows.get(key) === win) openWindows.delete(key);
        resolve({ ok: true, loggedIn, site: key, relogin });
      };

      // 페이지가 뜬 뒤부터 감시한다. 로드 전에 돌리면 남아 있던 쿠키를 보고 바로 닫을 수 있다.
      win.webContents.once('did-finish-load', () => {
        if (done || timer) return;
        timer = setInterval(async () => {
          if (done || win.isDestroyed()) return;
          if (Date.now() - openedAt >= MIN_VISIBLE_MS && await isLoggedIn(key)) { finish(); return; }

          // ⚠️ 한 번만 검사하면 못 잡는다. 쓰레드는 **로그인 폼을 먼저 보여준 뒤**
          //    잠시 후 피드로 넘겨버린다(실측: 사용자 화면에 안내 막대가 아예 안 떴다
          //    = 첫 검사 시점엔 폼이 있었다는 뜻). 그래서 매번 다시 확인한다.
          try {
            const state = await win.webContents.executeJavaScript(`({
              form: document.querySelectorAll('input[type=password]').length > 0,
              bar: !!document.getElementById('__piggy_login_bar__'),
              lost: /길을 잃었습니다|Sorry, this page isn't available|페이지가 존재하지 않/i
                      .test(document.body ? document.body.innerText : ''),
            })`);
            // ⚠️ 로그인 막바지에 404 로 튕기는 일이 있다(실측: 이메일 인증 코드까지 통과했는데
            //    '이 페이지는 길을 잃었습니다' 가 뜨고 sessionid 발급 직전에 멈췄다).
            //    그대로 두면 사용자는 다 해놓고 실패한다 → 홈으로 되돌려 세션을 마무리시킨다.
            if (state.lost && !win.isDestroyed()) {
              await win.loadURL(site.loginUrl, { userAgent: UA }).catch(() => {});
              return;
            }
            if (!state.form && !state.bar) {
              await win.webContents.executeJavaScript(bannerScript(site.formUrl || site.loginUrl, site.label)).catch(() => {});
            } else if (state.form && state.bar) {
              // 로그인 화면으로 돌아왔으면 막대는 치운다(폼을 가리지 않게).
              await win.webContents.executeJavaScript(
                "(()=>{const e=document.getElementById('__piggy_login_bar__');if(e){e.remove();document.body&&(document.body.style.paddingTop='');}})()",
              ).catch(() => {});
            }
          } catch (_) { /* 페이지 이동 중이면 실패할 수 있다 — 다음 차례에 다시 본다 */ }
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
