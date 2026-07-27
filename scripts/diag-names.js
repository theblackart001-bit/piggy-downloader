'use strict';
const { app, session } = require('electron');
app.setName('Piggy Downloader');
app.setPath('userData', require('path').join(app.getPath('appData'), 'Piggy Downloader'));
app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:piggy-threads');
  for (const u of ['https://www.threads.com','https://www.threads.net','https://www.instagram.com']) {
    const c = await ses.cookies.get({ url: u });
    console.log(u.replace('https://www.','') + '  →  ' + (c.map(x=>x.name).join(', ') || '(없음)'));
  }
  app.quit();
});
