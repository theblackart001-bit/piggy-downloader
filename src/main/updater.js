'use strict';

const { autoUpdater } = require('electron-updater');

/**
 * 자동 업데이트 (electron-updater).
 * 설치형(NSIS)에서만 동작. 앱 실행 시 백그라운드로 새 버전을 확인·다운로드하고,
 * 다음 실행(또는 사용자 동의) 시 적용한다. 진행 상황은 렌더러로 전달.
 *
 * 배포 흐름: package.json version 올림 → `npm run dist:win` →
 *            GitHub Release 에 산출물(+latest.yml) 업로드 (gh release / --publish always).
 */
function initAutoUpdate(getWindow) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  const send = (channel, data) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, data);
  };

  autoUpdater.on('update-available', (info) =>
    send('update:status', { state: 'available', version: info.version }),
  );
  autoUpdater.on('update-not-available', () =>
    send('update:status', { state: 'none' }),
  );
  autoUpdater.on('download-progress', (p) =>
    send('update:status', { state: 'downloading', percent: Math.round(p.percent) }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    send('update:status', { state: 'ready', version: info.version }),
  );
  autoUpdater.on('error', (err) =>
    send('update:status', { state: 'error', message: String(err && err.message) }),
  );

  // 앱 시작 직후 + 6시간마다 확인 (개발 모드/미설정 시 조용히 무시)
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 4000);
  setInterval(check, 6 * 60 * 60 * 1000).unref?.();
}

function quitAndInstall() {
  try {
    autoUpdater.quitAndInstall();
  } catch (_) {
    /* noop */
  }
}

module.exports = { initAutoUpdate, quitAndInstall };
