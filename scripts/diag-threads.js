'use strict';
/**
 * 🧵 진단 전용 — 쓰레드 글 하나를 앱과 같은 세션으로 열어
 *    "글 JSON 에 미디어가 실제로 몇 개 들어 있는지"를 그대로 찍어 본다.
 *
 *    사용: npx electron scripts/diag-threads.js "<글주소>"
 *    (배포에는 들어가지 않는다 — build.files 는 src/** 만 담는다)
 */
const { app, BrowserWindow, session } = require('electron');

const URL_ARG = process.argv.slice(2).find((a) => /^https?:\/\//.test(a));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PARTITION = 'persist:piggy-threads';

const codeOf = (u) => (String(u).match(/\/post\/([A-Za-z0-9_-]+)/) || [])[1] || null;

function enclosingObjects(text, pos) {
  // pos 를 감싸는 객체를 '안쪽부터 바깥쪽까지' 전부 돌려준다.
  const out = [];
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
      if (start !== undefined && start <= pos && i >= pos) {
        try { out.push(JSON.parse(text.slice(start, i + 1))); } catch (_) { /* skip */ }
      }
    }
  }
  return out;
}

app.whenReady().then(async () => {
  if (!URL_ARG) { console.log('URL 인자가 필요합니다'); app.quit(); return; }
  const code = codeOf(URL_ARG);
  console.log('code =', code);

  const ses = session.fromPartition(PARTITION);
  const ck = await ses.cookies.get({ url: 'https://www.threads.com' });
  console.log('threads cookies =', ck.length, '| sessionid =', ck.some((c) => c.name === 'sessionid'));

  const win = new BrowserWindow({ show: false, width: 1280, height: 900,
    webPreferences: { session: ses } });

  const netVideo = new Set(), netPhoto = new Set();
  ses.webRequest.onCompleted({ urls: ['<all_urls>'] }, (d) => {
    const u = d.url || '';
    if (/\.mp4(\?|$)/i.test(u) && /(fbcdn|cdninstagram)/i.test(u)) netVideo.add(u.split('?')[0]);
    else if (/\.(jpe?g|webp|png)(\?|$)/i.test(u) && /(fbcdn|cdninstagram)/i.test(u)
             && !/\/(rsrc|static)\b/i.test(u) && !/\bs\d{2,3}x\d{2,3}\b/i.test(u)) {
      netPhoto.add(u.split('?')[0]);
    }
  });

  await win.loadURL(URL_ARG, { userAgent: UA }).catch((e) => console.log('load warn:', e.message));

  for (let round = 1; round <= 10; round++) {
    await new Promise((r) => setTimeout(r, 1200));
    const raw = await win.webContents.executeJavaScript(`
      (() => [...document.querySelectorAll('script')]
        .map((s) => s.textContent || '')
        .filter((t) => /carousel_media|video_versions/.test(t))
        .join('\\n'))()
    `).catch(() => '');

    let best = null, occurrences = 0;
    if (raw) {
      const needle = '"code":"' + code + '"';
      let at = raw.indexOf(needle);
      while (at >= 0) {
        occurrences++;
        for (const obj of enclosingObjects(raw, at)) {
          const n = Array.isArray(obj.carousel_media) ? obj.carousel_media.length
                  : (obj.video_versions || obj.image_versions2) ? 1 : 0;
          if (!best || n > best.n) best = { n, obj };
        }
        at = raw.indexOf(needle, at + 1);
      }
    }
    const restricted = await win.webContents.executeJavaScript(
      "/이 콘텐츠를 이용할 수 없습니다|콘텐츠를 사용할 수 없습니다|This content isn't available/i.test(document.body.innerText||'')",
    ).catch(() => null);

    console.log(`round ${round}: rawLen=${raw.length} codeHits=${occurrences} `
      + `bestCarousel=${best ? best.n : '-'} netVideo=${netVideo.size} netPhoto=${netPhoto.size} `
      + `restricted=${restricted}`);

    if (round === 10 && best) {
      const items = Array.isArray(best.obj.carousel_media) && best.obj.carousel_media.length
        ? best.obj.carousel_media : [best.obj];
      console.log('--- 최종 미디어 목록 ---');
      items.forEach((m, i) => {
        const kind = (m.video_versions && m.video_versions.length) ? 'video' : 'photo';
        const cands = kind === 'video' ? m.video_versions
                    : (m.image_versions2 && m.image_versions2.candidates) || [];
        console.log(`  ${i + 1}. ${kind}  후보 ${cands.length}개`);
      });
      console.log('caption =', String((best.obj.caption && best.obj.caption.text) || '').slice(0, 60));
    }
  }

  console.log('--- 네트워크로 흘러간 사진(중복 제거) ---');
  [...netPhoto].slice(0, 25).forEach((u, i) => console.log(`  p${i + 1}`, u.slice(-70)));
  console.log('--- 네트워크로 흘러간 영상 ---');
  [...netVideo].forEach((u, i) => console.log(`  v${i + 1}`, u.slice(-70)));

  app.quit();
});
