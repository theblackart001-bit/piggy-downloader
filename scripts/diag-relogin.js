'use strict';
/** 진단 전용 — 실제 앱 파티션에서 '로그아웃 → 로그인창' 이 어디로 가는지 추적. (배포 제외) */
const { app, BrowserWindow, session } = require('electron');
app.setName('Piggy Downloader');
app.setPath('userData', require('path').join(app.getPath('appData'), 'Piggy Downloader'));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:piggy-threads');
  const before = await ses.cookies.get({ url: 'https://www.threads.com' });
  console.log('지우기 전 threads.com 쿠키:', before.length, before.map(c=>c.name).join(','));

  await ses.clearStorageData();
  const after = await ses.cookies.get({ url: 'https://www.threads.com' });
  const afterIg = await ses.cookies.get({ url: 'https://www.instagram.com' });
  console.log('지운 뒤  threads.com 쿠키:', after.length, '| instagram.com:', afterIg.length);

  const win = new BrowserWindow({ show: false, width: 520, height: 800, webPreferences: { session: ses } });
  await win.loadURL('https://www.threads.com/login', { userAgent: UA }).catch(e=>console.log('load err',e.message));
  for (const s of [1,3,6,10]) {
    await new Promise(r=>setTimeout(r, s===1?1000:2000+(s*300)));
    const u = win.webContents.getURL();
    const p = await win.webContents.executeJavaScript(
      `({pw:document.querySelectorAll('input[type=password]').length,txt:(document.body.innerText||'').slice(0,45).replace(/\s+/g,' ')})`
    ).catch(()=>({}));
    console.log(`  ${s}초쯤: ${u}  비번칸=${p.pw}  | ${p.txt}`);
  }
  win.destroy(); app.quit();
});
