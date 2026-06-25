'use strict';

/**
 * yt-dlp + ffmpeg 바이너리를 플랫폼별로 내려받아 resources/<os>/ 에 배치한다.
 *  - 기본: 현재 플랫폼만
 *  - --all  : win + mac 모두 (배포 PC 에서 교차 빌드용)
 *  - --win / --mac : 특정 플랫폼 강제
 * 이미 존재하면 건너뛴다(--force 로 재다운로드).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const RES = path.join(ROOT, 'resources');
const TMP = path.join(os.tmpdir(), 'piggy-bin-tmp');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
let targets = [];
if (args.includes('--all')) targets = ['win', 'mac'];
else if (args.includes('--win')) targets = ['win'];
else if (args.includes('--mac')) targets = ['mac'];
else targets = [process.platform === 'darwin' ? 'mac' : 'win'];

const SOURCES = {
  win: {
    ytdlp: {
      url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
      out: 'yt-dlp.exe',
    },
    ffmpeg: {
      url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
      out: 'ffmpeg.exe',
      zipEntry: /bin[\\/]ffmpeg\.exe$/,
    },
    // YouTube 고화질 추출에 필요한 JS 런타임 (yt-dlp 가 PATH 에서 자동 감지)
    deno: {
      url: 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip',
      out: 'deno.exe',
      zipEntry: /deno\.exe$/,
    },
  },
  mac: {
    ytdlp: {
      url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
      out: 'yt-dlp',
    },
    ffmpeg: {
      // evermeet 정적 빌드 (zip 내부에 단일 ffmpeg 바이너리)
      url: 'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip',
      out: 'ffmpeg',
      zipEntry: /(^|[\\/])ffmpeg$/,
    },
    deno: {
      // Apple Silicon 기준. Intel 맥은 시스템 deno 폴백 권장.
      url: 'https://github.com/denoland/deno/releases/latest/download/deno-aarch64-apple-darwin.zip',
      out: 'deno',
      zipEntry: /(^|[\\/])deno$/,
    },
  },
};

function log(...m) { console.log('[bin]', ...m); }

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('redirect 과다'));
    const file = fs.createWriteStream(dest);
    https
      .get(url, { headers: { 'User-Agent': 'PiggyDownloader' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.rmSync(dest, { force: true });
          return resolve(download(res.headers.location, dest, redirects + 1));
        }
        if (res.statusCode !== 200) {
          file.close();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const total = Number(res.headers['content-length'] || 0);
        let got = 0;
        let lastPct = -1;
        res.on('data', (c) => {
          got += c.length;
          if (total) {
            const pct = Math.floor((got / total) * 100);
            if (pct !== lastPct && pct % 10 === 0) { lastPct = pct; process.stdout.write(`  ${pct}%\r`); }
          }
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(dest)));
      })
      .on('error', (err) => {
        file.close();
        fs.rmSync(dest, { force: true });
        reject(err);
      });
  });
}

function unzipExtract(zipPath, entryRegex, destFile) {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  // Windows10+/mac 모두 tar 로 zip 해제 가능
  execFileSync('tar', ['-xf', zipPath, '-C', TMP], { stdio: 'ignore' });
  const found = walk(TMP).find((f) => entryRegex.test(f));
  if (!found) throw new Error(`zip 안에서 대상 파일을 못 찾음: ${entryRegex}`);
  fs.copyFileSync(found, destFile);
  fs.rmSync(TMP, { recursive: true, force: true });
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

async function fetchBinary(osKey, kind) {
  const spec = SOURCES[osKey][kind];
  const outDir = path.join(RES, osKey);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, spec.out);

  if (fs.existsSync(outPath) && !FORCE) { log(`${osKey}/${spec.out} 이미 존재 — 건너뜀`); return; }

  log(`다운로드 ${osKey}/${kind} ...`);
  if (spec.zipEntry) {
    const zipTmp = path.join(os.tmpdir(), `piggy-${osKey}-${kind}.zip`);
    await download(spec.url, zipTmp);
    unzipExtract(zipTmp, spec.zipEntry, outPath);
    fs.rmSync(zipTmp, { force: true });
  } else {
    await download(spec.url, outPath);
  }
  if (osKey === 'mac') { try { fs.chmodSync(outPath, 0o755); } catch (_) {} }
  log(`완료 -> ${outPath}`);
}

/* ---------- Whisper (AI 자막) ---------- */
const WHISPER_TAG = 'v1.9.1';
const WHISPER_WIN_ZIP = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_TAG}/whisper-bin-x64.zip`;
// 모델: 기본 base(약 142MB). 정확도 우선 시 ggml-small.bin 으로 교체 가능.
const WHISPER_MODEL = process.env.PIGGY_WHISPER_MODEL || 'ggml-base.bin';
const WHISPER_MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_MODEL}?download=true`;

async function fetchWhisperWin() {
  const outDir = path.join(RES, 'win', 'whisper');
  const cli = path.join(outDir, 'whisper-cli.exe');
  if (fs.existsSync(cli) && !FORCE) { log('win/whisper 이미 존재 — 건너뜀'); return; }
  log('다운로드 win/whisper ...');
  const zipTmp = path.join(os.tmpdir(), 'piggy-whisper-win.zip');
  await download(WHISPER_WIN_ZIP, zipTmp);
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  execFileSync('tar', ['-xf', zipTmp, '-C', TMP], { stdio: 'ignore' });
  // whisper-cli.exe(신) 또는 main.exe(구) 가 들어있는 폴더를 통째로 복사
  const exe = walk(TMP).find((f) => /whisper-cli\.exe$/i.test(f)) || walk(TMP).find((f) => /[\\/]main\.exe$/i.test(f));
  if (!exe) throw new Error('whisper 실행파일을 zip 에서 못 찾음');
  const srcDir = path.dirname(exe);
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(srcDir)) {
    fs.copyFileSync(path.join(srcDir, f), path.join(outDir, f));
  }
  // main.exe 만 있으면 표준 이름으로 별칭 생성
  if (!fs.existsSync(cli) && fs.existsSync(path.join(outDir, 'main.exe'))) {
    fs.copyFileSync(path.join(outDir, 'main.exe'), cli);
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.rmSync(zipTmp, { force: true });
  log(`완료 -> ${outDir}`);
}

async function fetchWhisperModel() {
  const modelDir = path.join(RES, 'models');
  fs.mkdirSync(modelDir, { recursive: true });
  const out = path.join(modelDir, WHISPER_MODEL);
  if (fs.existsSync(out) && !FORCE) { log(`model ${WHISPER_MODEL} 이미 존재 — 건너뜀`); return; }
  log(`다운로드 Whisper 모델 ${WHISPER_MODEL} (수백 MB, 시간 소요) ...`);
  await download(WHISPER_MODEL_URL, out);
  log(`완료 -> ${out}`);
}

(async () => {
  log('대상 플랫폼:', targets.join(', '));
  for (const osKey of targets) {
    for (const kind of ['ytdlp', 'ffmpeg', 'deno']) {
      try {
        await fetchBinary(osKey, kind);
      } catch (err) {
        console.error(`[bin] 실패 ${osKey}/${kind}:`, err.message);
        if (osKey === process.platform.replace('darwin', 'mac').replace('win32', 'win')) {
          console.error(`[bin] ${kind} 누락 — 앱은 시스템 PATH 의 ${kind} 로 폴백합니다.`);
        }
      }
    }
  }
  // Whisper: Windows 바이너리(릴리스 제공) + 공통 모델
  if (targets.includes('win')) {
    try { await fetchWhisperWin(); }
    catch (err) { console.error('[bin] whisper(win) 실패:', err.message, '— AI 자막 시 PATH whisper-cli 로 폴백'); }
  }
  if (targets.includes('mac')) {
    log('mac: whisper prebuilt 미제공 — `brew install whisper-cpp` 의 whisper-cli 를 PATH 폴백으로 사용');
  }
  try { await fetchWhisperModel(); }
  catch (err) { console.error('[bin] whisper 모델 실패:', err.message); }

  log('바이너리 준비 종료');
})();
