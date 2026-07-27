'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('piggy', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  getDownloadsDir: () => ipcRenderer.invoke('paths:downloads'),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  getInfo: (url) => ipcRenderer.invoke('info:get', url),
  startDownload: (job) => ipcRenderer.invoke('download:start', job),
  cancelDownload: (id) => ipcRenderer.invoke('download:cancel', id),
  onProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('download:progress', handler);
    return () => ipcRenderer.removeListener('download:progress', handler);
  },
  onClipboardUrl: (cb) => ipcRenderer.on('clipboard:url', (_e, url) => cb(url)),
  onExternalAdd: (cb) => ipcRenderer.on('external:add', (_e, data) => cb(data)),
  onUpdateStatus: (cb) => ipcRenderer.on('update:status', (_e, data) => cb(data)),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  getAppVersion: () => ipcRenderer.invoke('app:version'),

  // yt-dlp 갱신 — 유튜브 구조가 바뀌면 이게 최신이어야 다운로드가 계속 된다.
  onYtdlpStatus: (cb) => ipcRenderer.on('ytdlp:status', (_e, data) => cb(data)),
  updateYtdlp: () => ipcRenderer.invoke('ytdlp:update'),
  getYtdlpVersion: () => ipcRenderer.invoke('ytdlp:version'),
  openTranscribe: (url) => ipcRenderer.invoke('preview:open', url),

  // 📜 다운로드 기록
  historyList: () => ipcRenderer.invoke('history:list'),
  historyClear: () => ipcRenderer.invoke('history:clear'),
  historyRemove: (key) => ipcRenderer.invoke('history:remove', key),

  // 🔑 쿠키(로그인 필요한 사이트)
  pickCookies: () => ipcRenderer.invoke('cookies:pick'),
  clearCookies: () => ipcRenderer.invoke('cookies:clear'),
  useBrowserCookies: (b) => ipcRenderer.invoke('cookies:useBrowser', b),
  threadsLogin: () => ipcRenderer.invoke('threads:login'),
  threadsLoginStatus: () => ipcRenderer.invoke('threads:loginStatus'),
  threadsLogout: () => ipcRenderer.invoke('threads:logout'),

  // 사이트별 앱 내 로그인 (threads · instagram · xhs)
  siteStatus: () => ipcRenderer.invoke('site:status'),
  siteLogin: (key) => ipcRenderer.invoke('site:login', key),
  siteLogout: (key) => ipcRenderer.invoke('site:logout', key),
});
