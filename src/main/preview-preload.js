'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** 자막 미리보기 창 전용 API */
contextBridge.exposeInMainWorld('preview', {
  onInit: (cb) => ipcRenderer.on('preview:init', (_e, d) => cb(d)),
  onProgress: (cb) => ipcRenderer.on('preview:progress', (_e, d) => cb(d)),
  retranscribe: (lang) => ipcRenderer.invoke('preview:retranscribe', lang),
  copy: (text) => ipcRenderer.invoke('preview:copy', text),
  close: () => ipcRenderer.invoke('preview:close'),
});
