'use strict';

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

/**
 * yt-dlp / ffmpeg 바이너리 경로를 해석한다.
 * - 개발 모드: <project>/resources/<os>/
 * - 패키징 모드: process.resourcesPath/bin/   (electron-builder extraResources)
 */

const IS_WIN = process.platform === 'win32';
const OS_DIR = process.platform === 'win32' ? 'win' : 'mac';

function candidateDirs() {
  const dirs = [];
  // 패키징된 앱: extraResources 가 resources/bin 에 풀림
  if (process.resourcesPath) {
    dirs.push(path.join(process.resourcesPath, 'bin'));
  }
  // 개발 모드
  dirs.push(path.join(app.getAppPath(), 'resources', OS_DIR));
  dirs.push(path.join(__dirname, '..', '..', 'resources', OS_DIR));
  return dirs;
}

function resolveBinary(baseName) {
  const fileName = IS_WIN ? `${baseName}.exe` : baseName;
  for (const dir of candidateDirs()) {
    const full = path.join(dir, fileName);
    if (fs.existsSync(full)) return full;
  }
  // 마지막 수단: PATH 에 설치된 시스템 바이너리 사용
  return fileName;
}

function ensureExecutable(binPath) {
  if (IS_WIN) return;
  try {
    fs.chmodSync(binPath, 0o755);
  } catch (_) {
    /* PATH 바이너리이거나 권한 없음 — 무시 */
  }
}

function resolveWhisper() {
  const fileName = IS_WIN ? 'whisper-cli.exe' : 'whisper-cli';
  const subDirs = [
    process.resourcesPath && path.join(process.resourcesPath, 'bin', 'whisper'),
    path.join(app.getAppPath(), 'resources', OS_DIR, 'whisper'),
    path.join(__dirname, '..', '..', 'resources', OS_DIR, 'whisper'),
  ].filter(Boolean);
  for (const dir of subDirs) {
    const full = path.join(dir, fileName);
    if (fs.existsSync(full)) return full;
  }
  return fileName; // PATH 폴백 (예: brew 설치 whisper-cli)
}

function resolveModel() {
  const name = process.env.PIGGY_WHISPER_MODEL || 'ggml-base.bin';
  const dirs = [
    process.resourcesPath && path.join(process.resourcesPath, 'bin', 'models'),
    process.resourcesPath && path.join(process.resourcesPath, 'models'),
    path.join(app.getAppPath(), 'resources', 'models'),
    path.join(__dirname, '..', '..', 'resources', 'models'),
  ].filter(Boolean);
  for (const dir of dirs) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function getPaths() {
  const ytDlp = resolveBinary('yt-dlp');
  const ffmpeg = resolveBinary('ffmpeg');
  ensureExecutable(ytDlp);
  ensureExecutable(ffmpeg);
  // yt-dlp 가 번들된 deno(JS 런타임)를 PATH 에서 찾도록 바이너리 디렉토리 제공
  const binDir = path.dirname(ytDlp);
  return { ytDlp, ffmpeg, ffmpegDir: path.dirname(ffmpeg), binDir };
}

/** 번들 바이너리 폴더를 앞에 붙인 PATH 환경변수 */
function envWithBin() {
  const { binDir } = getPaths();
  const sep = IS_WIN ? ';' : ':';
  return { ...process.env, PATH: `${binDir}${sep}${process.env.PATH || ''}` };
}

function getWhisperPaths() {
  const whisper = resolveWhisper();
  ensureExecutable(whisper);
  return { whisper, model: resolveModel() };
}

module.exports = { getPaths, getWhisperPaths, envWithBin, IS_WIN };
