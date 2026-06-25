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
});
