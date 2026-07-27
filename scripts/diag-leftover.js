'use strict';
/** 진단 전용 — 로그아웃 안 한 '찌꺼기 쿠키' 상태에서 /login 이 어디로 가는지. (배포 제외) */
const { app, BrowserWindow, session } = require('electron');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

app.whenReady().then(async () => {
  const ses = session.fromPartition('test:leftover');
  await ses.clearStorageData();
  const win = new BrowserWindow({ show: false, width: 520, height: 800, webPreferences: { session: ses } });

  // 1) 먼저 피드를 한 번 열어 비로그인 쿠키(ig_did/mid/csrftoken)를 만든다 = 사용자 상태 재현
  await win.loadURL('https://www.threads.com/', { userAgent: UA }).catch(()=>{});
  await new Promise(r=>setTimeout(r,4000));
  const ck = await ses.cookies.get({ url: 'https://www.threads.com' });
  console.log('피드 방문 후 쿠키:', ck.length, ck.map(c=>c.name).join(','));

  // 2) 그 상태에서 /login 을 연다
  await win.loadURL('https://www.threads.com/login', { userAgent: UA }).catch(e=>console.log('load err', e.message));
  for (const s of [2,5,9]) {
    await new Promise(r=>setTimeout(r, s*1000 - (s===2?0:2000)));
    const p = await win.webContents.executeJavaScript(
      `({pw:document.querySelectorAll('input[type=password]').length,txt:(document.body.innerText||'').slice(0,50).replace(/\s+/g,' ')})`
    ).catch(()=>({}));
    console.log(`  ${s}초: ${win.webContents.getURL()}  비번칸=${p.pw} | ${p.txt}`);
  }
  win.destroy(); app.quit();
});
