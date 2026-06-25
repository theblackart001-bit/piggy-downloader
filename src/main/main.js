'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const engine = require('./ytdlp');
const bridge = require('./bridge');
const whisper = require('./whisper');
const updater = require('./updater');

const IS_DEV = process.argv.includes('--dev');
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

let mainWindow = null;

/* ---------- 설정 저장/로드 ---------- */
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
  } catch (_) {
    return {
      outputDir: app.getPath('downloads'),
      theme: 'light',
      lastMode: 'video',
      lastQuality: 0,
    };
  }
}
function saveSettings(s) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2));
  } catch (e) {
    console.error('설정 저장 실패', e);
  }
}

/* ---------- 윈도우 ---------- */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    backgroundColor: '#0b7fd6',
    title: 'Piggy Downloader',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // 외부 링크는 기본 브라우저로
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });
  Menu.setApplicationMenu(null);
}

let stopClipboard = null;
let bridgeServer = null;

app.whenReady().then(() => {
  createWindow();
  // 브라우저/클립보드 브리지 시작
  const getWin = () => mainWindow;
  stopClipboard = bridge.startClipboardWatch(getWin);
  bridgeServer = bridge.startServer(getWin);
  if (!IS_DEV) updater.initAutoUpdate(getWin); // 자동 업데이트(설치형)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  engine.cancelAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  engine.cancelAll();
  if (stopClipboard) stopClipboard();
  if (bridgeServer) bridgeServer.close();
});

/* ---------- IPC ---------- */
ipcMain.handle('settings:get', () => loadSettings());
ipcMain.handle('settings:set', (_e, s) => {
  saveSettings(s);
  return true;
});

// 다운로드는 무조건 OS 다운로드 폴더로 고정
ipcMain.handle('paths:downloads', () => app.getPath('downloads'));

ipcMain.handle('clipboard:read', () => clipboard.readText().trim());

ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));
ipcMain.handle('shell:showItem', (_e, p) => shell.showItemInFolder(p));

ipcMain.handle('info:get', async (_e, url) => {
  try {
    const info = await engine.getInfo(url);
    return { ok: true, info: pickInfo(info) };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('download:start', async (e, job) => {
  // 저장 위치는 무조건 다운로드 폴더로 강제
  job = { ...job, outputDir: app.getPath('downloads') };
  const send = (payload) =>
    e.sender.send('download:progress', { id: job.id, ...payload });
  try {
    send({ type: 'stage', stage: 'starting', text: '준비 중...' });
    const res = await engine.download(job, send);
    if (res.canceled) {
      send({ type: 'canceled' });
      return { ok: false, canceled: true };
    }
    // AI 자막: 영상 다운로드 후 음성분석으로 .srt 생성 (실패해도 다운로드는 성공 처리)
    if (job.aiSubtitles && res.file) {
      try {
        await whisper.transcribe(res.file, send);
      } catch (subErr) {
        send({ type: 'stage', stage: 'subwarn', text: `⚠ AI 자막 실패: ${subErr.message}` });
      }
    }
    send({ type: 'done', outputDir: job.outputDir, file: res.file });
    return { ok: true };
  } catch (err) {
    send({ type: 'error', error: String(err.message || err) });
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('download:cancel', (_e, id) => engine.cancel(id));

ipcMain.handle('update:install', () => updater.quitAndInstall());

/* yt-dlp 의 방대한 info 에서 UI 에 필요한 필드만 추린다 */
function pickInfo(info) {
  const heights = new Set();
  for (const f of info.formats || []) {
    if (f.vcodec && f.vcodec !== 'none' && f.height) heights.add(f.height);
  }
  return {
    id: info.id,
    title: info.title,
    uploader: info.uploader || info.channel || '',
    duration: info.duration,
    durationString: info.duration_string || formatDuration(info.duration),
    thumbnail: info.thumbnail,
    extractor: info.extractor_key || info.extractor,
    isPlaylist: info._type === 'playlist',
    webpage_url: info.webpage_url,
    availableHeights: [...heights].sort((a, b) => b - a),
  };
}

function formatDuration(sec) {
  if (!sec && sec !== 0) return '';
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
