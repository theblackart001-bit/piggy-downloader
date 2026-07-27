'use strict';
/** 진단 전용 — 사이트별 로그인 판정이 실제 쿠키와 맞는지 찍어 본다. (배포 제외) */
const { app, session } = require('electron');

// ⚠️ 개발 실행은 userData 가 'Electron' 으로 잡혀 **설치된 앱과 다른 세션**을 본다.
//    실제 앱의 로그인 상태를 보려면 이름을 실제 제품명으로 맞춰야 한다.
app.setName('Piggy Downloader');
app.setPath('userData', require('path').join(app.getPath('appData'), 'Piggy Downloader'));
const sitelogin = require('../src/main/sitelogin');

app.whenReady().then(async () => {
  const st = await sitelogin.statusAll();
  for (const [key, site] of Object.entries(sitelogin.SITES)) {
    const ses = session.fromPartition(site.partition);
    const rows = [];
    for (const url of [...site.checkUrls, 'https://www.instagram.com', 'https://www.threads.com']) {
      const ck = await ses.cookies.get({ url });
      const hit = ck.filter((c) => site.cookieNames.includes(c.name) && c.value);
      rows.push(`${url.replace('https://www.', '')}: 쿠키 ${ck.length}개, ${site.cookieNames[0]}=${hit.length ? 'O' : 'X'}`);
    }
    console.log(`[${site.label}] 판정=${st[key] ? '로그인됨' : '아직 안 함'}  | ${rows.join(' | ')}`);
  }
  app.quit();
});
