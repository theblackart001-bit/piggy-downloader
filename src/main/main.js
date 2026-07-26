'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const engine = require('./ytdlp');
const bridge = require('./bridge');
const whisper = require('./whisper');
const updater = require('./updater');
const ytdlpUpdater = require('./ytdlp-updater');
const history = require('./history');

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

/* ---------- 자막 미리보기 창 ---------- */
const previewWindows = new Map(); // win.id -> { url, audioFile }

function previewTempDir() {
  const base = process.platform === 'win32' ? (process.env.ProgramData || 'C:\\ProgramData') : os.tmpdir();
  const dir = path.join(base, 'PiggyDownloader', 'preview');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createPreviewWindow() {
  const win = new BrowserWindow({
    width: 640,
    height: 760,
    minWidth: 480,
    minHeight: 480,
    backgroundColor: '#0b7fd6',
    title: 'Piggy Downloader · 자막 미리보기',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preview-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'preview.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    const st = previewWindows.get(win.id);
    if (st && st.audioFile) { try { fs.rmSync(st.audioFile, { force: true }); } catch (_) {} }
    previewWindows.delete(win.id);
  });
  return win;
}

function openTranscribePreview(url) {
  const win = createPreviewWindow();
  previewWindows.set(win.id, { url, audioFile: null });
  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return;
    win.webContents.send('preview:init', { url });
    runTranscribe(win, 'auto');
  });
}

async function runTranscribe(win, lang) {
  if (!win || win.isDestroyed()) return;
  const st = previewWindows.get(win.id);
  if (!st) return;
  const send = (p) => { if (!win.isDestroyed()) win.webContents.send('preview:progress', p); };
  try {
    send({ type: 'busy' });
    // 오디오는 창 수명 동안 1회만 받아 캐시(언어 바꿔 재전사 시 재사용)
    if (!st.audioFile || !fs.existsSync(st.audioFile)) {
      send({ type: 'stage', text: '🎧 오디오 가져오는 중...' });
      st.audioFile = await engine.downloadAudioOnly(st.url, previewTempDir(), send);
      previewWindows.set(win.id, st);
    }
    send({ type: 'stage', text: '🤖 AI 전사 중...' });
    const { text } = await whisper.transcribeText(st.audioFile, { lang }, send);
    send({ type: 'done', text: text || '(인식된 음성이 없습니다)' });
  } catch (err) {
    send({ type: 'error', error: String(err.message || err) });
  }
}

let stopClipboard = null;
let bridgeServer = null;

app.whenReady().then(() => {
  createWindow();
  // 브라우저/클립보드 브리지 시작
  const getWin = () => mainWindow;
  // 클립보드 감시 = '복사하면 바로 받기'의 핵심. 계속 유지.
  stopClipboard = bridge.startClipboardWatch(getWin);
  // ⚠️ 크롬 확장용 로컬 HTTP 서버(127.0.0.1:53472)는 껐다(2026-07-26).
  //    확장을 배포에서 뺐으므로 부를 사람이 없고, CORS 가 '*' 로 열려 있어
  //    아무 웹페이지나 /add 를 호출해 임의 URL 다운로드를 시킬 수 있었다.
  //    (확장에만 있던 '자막만 보기'는 앱 버튼으로 옮겼다 → preview:open)
  if (!IS_DEV) updater.initAutoUpdate(getWin); // 자동 업데이트(설치형)

  // 🔄 yt-dlp 갱신 확인 — 하루 1회, 백그라운드.
  //    유튜브가 구조를 바꾸면 yt-dlp 도 바뀌어야 한다. 앱 재설치(300MB) 없이
  //    yt-dlp(17MB)만 따로 최신으로 유지한다. 실패해도 번들본으로 계속 동작한다.
  //    창이 뜬 뒤에 시작해 첫 실행 체감속도를 건드리지 않는다.
  setTimeout(() => {
    ytdlpUpdater
      .checkAndUpdate({
        loadSettings,
        saveSettings,
        onStatus: (s) => {
          const win = getWin();
          if (win && !win.isDestroyed()) win.webContents.send('ytdlp:status', s);
        },
      })
      .then((r) => {
        if (r.state === 'updated') console.log(`[yt-dlp] 갱신 ${r.from} → ${r.to}`);
        else if (r.state === 'error') console.warn('[yt-dlp] 갱신 실패:', r.error);
      })
      .catch(() => {});
  }, 4000);

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

// 설정에 저장된 쿠키 설정을 job 에 실어준다(로그인 필요한 사이트용).
function cookiesFromSettings() {
  const s = loadSettings();
  const c = s.cookies || {};
  if (!c.mode || c.mode === 'none') return null;
  if (c.mode === 'file' && c.file && fs.existsSync(c.file)) return { mode: 'file', file: c.file };
  if (c.mode === 'browser' && c.browser) return { mode: 'browser', browser: c.browser };
  return null;
}

ipcMain.handle('info:get', async (_e, url) => {
  try {
    const info = await engine.getInfo(url, { cookies: cookiesFromSettings() });
    return { ok: true, info: pickInfo(info) };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('download:start', async (e, job) => {
  const settings = loadSettings();
  // 저장 위치: 기본은 다운로드 폴더. '매번 묻기'가 켜져 있으면 폴더를 고른다.
  let outputDir = app.getPath('downloads');
  if (settings.askSaveLocation) {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '저장할 폴더를 고르세요',
      defaultPath: outputDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths?.[0]) {
      e.sender.send('download:progress', { id: job.id, type: 'canceled' });
      return { ok: false, canceled: true };
    }
    outputDir = r.filePaths[0];
  }
  job = { ...job, outputDir, cookies: cookiesFromSettings() };
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
    // 📜 기록에 남긴다 — 나중에 '어디 받았더라' 를 없앤다.
    try {
      let size = 0;
      try { size = res.file ? fs.statSync(res.file).size : 0; } catch (_) { /* 무시 */ }
      history.add({ url: job.url, title: job.title, file: res.file, mode: job.mode, thumbnail: job.thumbnail, size });
    } catch (_) { /* 기록 실패가 다운로드를 망치면 안 된다 */ }
    send({ type: 'done', outputDir: job.outputDir, file: res.file });
    return { ok: true };
  } catch (err) {
    send({ type: 'error', error: String(err.message || err) });
    return { ok: false, error: String(err.message || err) };
  }
});

/* ---------- 📜 기록 ---------- */
ipcMain.handle('history:list', () => history.list());
ipcMain.handle('history:clear', () => history.clear());
ipcMain.handle('history:remove', (_e, key) => history.remove(key));

/* ---------- 🔑 쿠키(로그인 필요한 사이트) ---------- */
// cookies.txt 파일 고르기. 브라우저 확장으로 내보낸 파일을 등록한다.
ipcMain.handle('cookies:pick', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'cookies.txt 파일을 고르세요',
    filters: [{ name: '쿠키 파일', extensions: ['txt'] }, { name: '모든 파일', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths?.[0]) return { ok: false };
  const picked = r.filePaths[0];
  // 원본이 지워져도 계속 쓰도록 앱 폴더로 복사해 둔다.
  const dest = path.join(app.getPath('userData'), 'cookies.txt');
  try { fs.copyFileSync(picked, dest); } catch (e) { return { ok: false, error: e.message }; }
  const s = loadSettings();
  saveSettings({ ...s, cookies: { mode: 'file', file: dest } });
  return { ok: true, file: dest };
});
ipcMain.handle('cookies:clear', () => {
  const s = loadSettings();
  saveSettings({ ...s, cookies: { mode: 'none' } });
  return { ok: true };
});
ipcMain.handle('cookies:useBrowser', (_e, browser) => {
  const s = loadSettings();
  saveSettings({ ...s, cookies: { mode: 'browser', browser } });
  return { ok: true };
});

ipcMain.handle('download:cancel', (_e, id) => engine.cancel(id));

ipcMain.handle('update:install', () => updater.quitAndInstall());

// 🔄 yt-dlp 수동 갱신(설정에서 버튼) — 하루 1회 제한을 무시하고 지금 확인한다.
ipcMain.handle('ytdlp:update', async () => {
  const win = mainWindow;
  return ytdlpUpdater.checkAndUpdate({
    force: true,
    loadSettings,
    saveSettings,
    onStatus: (s) => { if (win && !win.isDestroyed()) win.webContents.send('ytdlp:status', s); },
  });
});
ipcMain.handle('ytdlp:version', () => ytdlpUpdater.currentVersion());
ipcMain.handle('app:version', () => app.getVersion());

// 👀 자막만 보기 — 영상 본체는 받지 않고 오디오만 전사해 미리보기 창을 연다.
//    예전엔 크롬 확장에서만 열 수 있었다(앱 UI에 진입점이 없었음) → 확장을 빼면서 앱으로 옮김.
ipcMain.handle('preview:open', (_e, url) => {
  const target = String(url || '').trim();
  if (!/^https?:\/\//.test(target)) return { ok: false, error: '올바른 URL 이 아닙니다' };
  openTranscribePreview(target);
  return { ok: true };
});

/* 자막 미리보기 IPC */
ipcMain.handle('preview:retranscribe', (e, lang) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) runTranscribe(win, lang || 'auto');
  return true;
});
ipcMain.handle('preview:copy', (_e, text) => {
  clipboard.writeText(String(text || ''));
  return true;
});
ipcMain.handle('preview:close', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && !win.isDestroyed()) win.close();
  return true;
});

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
