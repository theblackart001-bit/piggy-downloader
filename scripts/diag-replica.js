'use strict';
/** 진단 전용 — 실제 앱 openLogin 과 똑같은 조건으로 재현. (배포 제외) */
const { app, BrowserWindow, session } = require('electron');
app.setName('Piggy Downloader');
app.setPath('userData', require('path').join(app.getPath('appData'), 'Piggy Downloader'));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const probe = (win) => win.webContents.executeJavaScript(
  `({pw:document.querySelectorAll('input[type=password]').length,txt:(document.body.innerText||'').slice(0,45).replace(/\s+/g,' ')})`
).catch(() => ({}));

app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:piggy-threads');
  const dump = async (tag) => {
    const t = await ses.cookies.get({ url: 'https://www.threads.com' });
    const i = await ses.cookies.get({ url: 'https://www.instagram.com' });
    console.log(`${tag} threads=[${t.map(c=>c.name).join(',')}] instagram=[${i.map(c=>c.name).join(',')}]`);
  };
  await dump('로그인창 열기 전:');
  await ses.clearStorageData();
  await dump('clearStorageData 후:');

  for (const url of ['https://www.threads.com/login', 'https://www.instagram.com/accounts/login/']) {
    const win = new BrowserWindow({ show: false, width: 520, height: 780, autoHideMenuBar: true,
      webPreferences: { session: ses, javascript: true, images: true } });
    await win.loadURL(url, { userAgent: UA }).catch(e => console.log('  load err', e.message));
    await new Promise(r => setTimeout(r, 4000));
    const p = await probe(win);
    console.log(`\n[${url}]\n  최종주소=${win.webContents.getURL()}\n  비번칸=${p.pw} | ${p.txt}`);
    win.destroy();
  }
  app.quit();
});
