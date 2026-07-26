'use strict';

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

/**
 * yt-dlp / ffmpeg 바이너리 경로를 해석한다.
 * - 갱신본:     userData/bin/            (ytdlp-updater 가 받아둔 최신 yt-dlp — 최우선)
 * - 패키징 모드: process.resourcesPath/bin/   (electron-builder extraResources)
 * - 개발 모드:   <project>/resources/<os>/
 */

const IS_WIN = process.platform === 'win32';
const OS_DIR = process.platform === 'win32' ? 'win' : 'mac';

/**
 * 갱신 바이너리를 두는 곳(쓰기 가능).
 * 설치본은 Program Files 에 깔려 번들 파일을 덮어쓸 수 없다(관리자 권한 필요) →
 * 갱신본은 여기에 받아두고, 아래 candidateDirs 에서 '먼저' 찾게 한다.
 */
function updatesDir() {
  return path.join(app.getPath('userData'), 'bin');
}

/** 앱에 번들된 바이너리 폴더(deno·ffmpeg 등이 함께 있는 곳) */
function bundledBinDir() {
  for (const dir of bundledDirs()) {
    if (fs.existsSync(dir)) return dir;
  }
  return bundledDirs()[0];
}

function bundledDirs() {
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

function candidateDirs() {
  // ★ 갱신본 우선 — 최신 yt-dlp 가 있으면 그걸 쓰고, 없으면 번들본으로 자동 폴백.
  return [updatesDir(), ...bundledDirs()];
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

/**
 * 번들 바이너리 폴더를 앞에 붙인 PATH 환경변수.
 * ⚠️ 갱신본 폴더(userData/bin)에는 yt-dlp 하나만 있다. deno·ffmpeg 는 번들 폴더에만 있으므로
 *    두 폴더를 모두 PATH 에 넣어야 한다. (갱신본만 넣으면 yt-dlp 가 deno 를 못 찾는다.)
 */
function envWithBin() {
  const sep = IS_WIN ? ';' : ':';
  const dirs = [updatesDir(), bundledBinDir()].filter((d, i, a) => d && a.indexOf(d) === i);
  return { ...process.env, PATH: `${dirs.join(sep)}${sep}${process.env.PATH || ''}` };
}

/**
 * 모든 yt-dlp 호출에 반드시 앞에 붙일 인자.
 *
 * ★ `--encoding utf-8` 이 없으면 yt-dlp 는 stdout 을 **윈도우 시스템 코드페이지**
 *   (한국어 윈도우 = CP949)로 쓴다. 우리는 stdout 을 UTF-8 로 읽으므로
 *   경로·제목의 한글이 전부 U+FFFD 로 깨진다.
 *   → 저장된 파일 경로를 못 찾아 **AI 자막·파일 열기가 실패**한다.
 *   사용자명이 한글인 PC(대부분의 국내 사용자)에서 100% 재현된다.
 *
 *   ※ PYTHONIOENCODING 환경변수로는 해결되지 않는다(PyInstaller 로 묶인
 *     yt-dlp.exe 는 이를 따르지 않음). yt-dlp 자체 옵션을 써야 한다. 실측 확인함.
 */
const YTDLP_BASE_ARGS = ['--encoding', 'utf-8'];

function getWhisperPaths() {
  const whisper = resolveWhisper();
  ensureExecutable(whisper);
  return { whisper, model: resolveModel() };
}

module.exports = { getPaths, getWhisperPaths, envWithBin, updatesDir, bundledBinDir, YTDLP_BASE_ARGS, IS_WIN };
