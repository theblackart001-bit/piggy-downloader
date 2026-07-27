'use strict';
/** 진단 전용 — 앱 세션에 있는 쿠키를 도메인별로 전부 훑는다. (배포 제외) */
const { app, session } = require('electron');
app.setName('Piggy Downloader');
app.setPath('userData', require('path').join(app.getPath('appData'), 'Piggy Downloader'));

app.whenReady().then(async () => {
  for (const part of ['persist:piggy-threads', 'persist:piggy-xhs']) {
    const ses = session.fromPartition(part);
    const all = await ses.cookies.get({});       // 도메인 제한 없이 전부
    console.log(`\n[${part}] 총 ${all.length}개`);
    const byDomain = {};
    for (const c of all) (byDomain[c.domain] = byDomain[c.domain] || []).push(c.name);
    for (const d of Object.keys(byDomain).sort()) {
      const names = byDomain[d];
      const key = names.filter((n) => ['sessionid', 'ds_user_id', 'web_session'].includes(n));
      console.log(`  ${d}  (${names.length}개)${key.length ? '   ★ ' + key.join(',') : ''}`);
    }
  }
  app.quit();
});
