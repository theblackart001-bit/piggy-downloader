'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { getPaths, getWhisperPaths } = require('./binaries');

/**
 * 다운로드한 영상/오디오를 Whisper(whisper.cpp)로 음성분석하여 .srt 자막 생성.
 *
 * ⚠️ whisper.cpp 는 비ASCII(한글 등) 경로의 model/wav/output 파일을 못 다뤄 크래시한다.
 *    (실행파일 경로는 무관) → 모델·wav·출력은 반드시 ASCII 작업폴더에서 처리하고,
 *    완성된 .srt 만 원본(한글 가능) 위치로 복사한다.
 */

let seq = 0;

const isAscii = (s) => !/[^\x00-\x7F]/.test(s);

function asciiWorkRoot() {
  if (process.platform === 'win32') {
    const base = process.env.ProgramData || 'C:\\ProgramData';
    return path.join(base, 'PiggyDownloader', 'whisper');
  }
  return path.join(os.tmpdir(), 'piggy-whisper');
}

/** 모델 경로가 비ASCII 면 ASCII 작업폴더로 1회 캐시 복사 */
function ensureAsciiModel(model, workRoot) {
  if (isAscii(model)) return model;
  const cached = path.join(workRoot, 'model.bin');
  const need = !fs.existsSync(cached) || fs.statSync(cached).size !== fs.statSync(model).size;
  if (need) {
    fs.mkdirSync(workRoot, { recursive: true });
    fs.copyFileSync(model, cached);
  }
  return cached;
}

function transcribe(mediaFile, onProgress) {
  return new Promise((resolve, reject) => {
    const { ffmpeg } = getPaths();
    const { whisper, model } = getWhisperPaths();

    if (!model) return reject(new Error('Whisper 모델이 없습니다. `npm run prep` 으로 받으세요.'));
    if (!fs.existsSync(mediaFile)) return reject(new Error('원본 파일을 찾을 수 없습니다.'));

    const workRoot = asciiWorkRoot();
    const jobDir = path.join(workRoot, `job-${Date.now()}-${++seq}`);
    fs.mkdirSync(jobDir, { recursive: true });

    const asciiModel = ensureAsciiModel(model, workRoot);
    const wav = path.join(jobDir, 'audio.wav'); // ASCII
    const ofBase = path.join(jobDir, 'out'); // ASCII -> out.srt
    const srtTmp = `${ofBase}.srt`;

    // 최종 자막은 원본 옆에 (한글 경로 가능 — Node 가 유니코드 처리)
    const finalSrt = path.join(path.dirname(mediaFile), `${path.basename(mediaFile, path.extname(mediaFile))}.srt`);

    const cleanup = () => { try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch (_) {} };

    if (onProgress) onProgress({ type: 'stage', stage: 'transcribing', text: '🎙️ 오디오 추출 중...' });

    // 1) ffmpeg: (한글 가능)원본 → (ASCII)wav 16kHz mono
    const ff = spawn(ffmpeg, ['-y', '-i', mediaFile, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { windowsHide: true });
    let ffErr = '';
    ff.stderr.on('data', (d) => (ffErr += d.toString()));
    ff.on('error', (e) => { cleanup(); reject(e); });
    ff.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(wav)) { cleanup(); return reject(new Error('오디오 추출 실패: ' + (ffErr.split('\n').filter(Boolean).pop() || code))); }
      runWhisper();
    });

    // 2) whisper-cli: ASCII model/wav/output
    function runWhisper() {
      if (onProgress) onProgress({ type: 'stage', stage: 'transcribing', text: '🤖 AI 자막 생성 중...' });
      const args = ['-m', asciiModel, '-f', wav, '-l', 'auto', '-osrt', '-of', ofBase, '-pp'];
      const wp = spawn(whisper, args, { windowsHide: true });
      let wErr = '';
      wp.stderr.on('data', (d) => {
        const t = d.toString();
        wErr += t;
        const m = t.match(/progress\s*=\s*(\d+)%/i);
        if (m && onProgress) onProgress({ type: 'progress', percent: Number(m[1]), note: 'AI 자막' });
      });
      wp.on('error', (e) => { cleanup(); reject(e); });
      wp.on('close', (code) => {
        if (code === 0 && fs.existsSync(srtTmp)) {
          try {
            fs.copyFileSync(srtTmp, finalSrt); // ASCII → 한글 경로 (Node 유니코드 OK)
          } catch (e) {
            cleanup();
            return reject(new Error('자막 저장 실패: ' + e.message));
          }
          cleanup();
          if (onProgress) onProgress({ type: 'stage', stage: 'subdone', text: '✅ 자막 생성됨' });
          resolve({ ok: true, srt: finalSrt });
        } else {
          cleanup();
          reject(new Error('자막 생성 실패: ' + (wErr.split('\n').filter(Boolean).pop() || `code ${code}`)));
        }
      });
    }
  });
}

/**
 * 자막 미리보기용: 미디어(오디오/영상) → Whisper 로 **평문 텍스트**만 추출(파일 저장 없음).
 * 결과는 메모리(문자열)로만 반환하고 작업 폴더는 즉시 정리한다.
 * @param {string} mediaFile  전사할 미디어 파일(오디오 권장)
 * @param {{lang?: string}} [opts]  lang: 'auto'|'ko'|'en'|'ja'|'zh' ...
 */
function transcribeText(mediaFile, opts = {}, onProgress) {
  const lang = opts.lang && opts.lang !== 'auto' ? opts.lang : 'auto';
  return new Promise((resolve, reject) => {
    const { ffmpeg } = getPaths();
    const { whisper, model } = getWhisperPaths();

    if (!model) return reject(new Error('Whisper 모델이 없습니다. `npm run prep` 으로 받으세요.'));
    if (!fs.existsSync(mediaFile)) return reject(new Error('오디오 파일을 찾을 수 없습니다.'));

    const workRoot = asciiWorkRoot();
    const jobDir = path.join(workRoot, `pv-${Date.now()}-${++seq}`);
    fs.mkdirSync(jobDir, { recursive: true });

    const asciiModel = ensureAsciiModel(model, workRoot);
    const wav = path.join(jobDir, 'audio.wav'); // ASCII
    const ofBase = path.join(jobDir, 'out'); // ASCII -> out.txt
    const txtTmp = `${ofBase}.txt`;
    const cleanup = () => { try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch (_) {} };

    if (onProgress) onProgress({ type: 'stage', text: '🎙️ 오디오 변환 중...' });

    // 1) ffmpeg: (한글 가능)원본 → (ASCII)wav 16kHz mono
    const ff = spawn(ffmpeg, ['-y', '-i', mediaFile, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { windowsHide: true });
    let ffErr = '';
    ff.stderr.on('data', (d) => (ffErr += d.toString()));
    ff.on('error', (e) => { cleanup(); reject(e); });
    ff.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(wav)) { cleanup(); return reject(new Error('오디오 변환 실패: ' + (ffErr.split('\n').filter(Boolean).pop() || code))); }

      // 2) whisper-cli: ASCII model/wav/output, 평문(-otxt)
      if (onProgress) onProgress({ type: 'stage', text: '🤖 AI 전사 중...' });
      const args = ['-m', asciiModel, '-f', wav, '-l', lang, '-otxt', '-of', ofBase, '-pp'];
      const wp = spawn(whisper, args, { windowsHide: true });
      let wErr = '';
      wp.stderr.on('data', (d) => {
        const t = d.toString();
        wErr += t;
        const m = t.match(/progress\s*=\s*(\d+)%/i);
        if (m && onProgress) onProgress({ type: 'progress', percent: Number(m[1]) });
      });
      wp.on('error', (e) => { cleanup(); reject(e); });
      wp.on('close', (code2) => {
        if (code2 === 0 && fs.existsSync(txtTmp)) {
          let text = '';
          try { text = fs.readFileSync(txtTmp, 'utf-8'); } catch (_) {}
          cleanup();
          resolve({ ok: true, text: text.trim() });
        } else {
          cleanup();
          reject(new Error('전사 실패: ' + (wErr.split('\n').filter(Boolean).pop() || `code ${code2}`)));
        }
      });
    });
  });
}

module.exports = { transcribe, transcribeText };
