const { app } = require('electron');
app.whenReady().then(() => { console.log('appName =', app.getName()); console.log('userData =', app.getPath('userData')); app.quit(); });
