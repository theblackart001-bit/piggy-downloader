'use strict';
/** 진단 전용 — 어느 주소가 '진짜 로그인 폼'을 띄우는지 빈 세션으로 시험한다. (배포 제외) */
const { app, BrowserWindow, session } = require('electron');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CANDIDATES = [
  'https://www.threads.com/login',
  'https://www.threads.net/login',
  'https://www.threads.com/login?show_choice_screen=false',
  'https://www.threads.com/login/?next=%2F',
  'https://www.instagram.com/accounts/login/',
];

app.whenReady().then(async () => {
  for (const url of CANDIDATES) {
    const ses = session.fromPartition('test:' + Math.abs(url.length * 7919) + url.slice(-6));
    await ses.clearStorageData();
    const win = new BrowserWindow({ show: false, width: 520, height: 800, webPreferences: { session: ses } });
    let finalUrl = '(load 실패)', probe = {};
    try {
      await win.loadURL(url, { userAgent: UA });
      await new Promise((r) => setTimeout(r, 3500));
      finalUrl = win.webContents.getURL();
      probe = await win.webContents.executeJavaScript(`(() => ({
        pw: document.querySelectorAll('input[type=password]').length,
        user: document.querySelectorAll('input[name=username], input[autocomplete=username]').length,
        txt: (document.body.innerText||'').slice(0,60).replace(/\s+/g,' '),
      }))()`).catch(() => ({}));
    } catch (e) { finalUrl = 'ERR ' + e.message; }
    console.log(`\n[${url}]\n  → ${finalUrl}\n  비밀번호칸=${probe.pw} 아이디칸=${probe.user}\n  화면: ${probe.txt || '?'}`);
    win.destroy();
  }
  app.quit();
});
