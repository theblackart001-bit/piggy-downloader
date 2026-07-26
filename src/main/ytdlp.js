'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getPaths, envWithBin, YTDLP_BASE_ARGS } = require('./binaries');
const resolvers = require('./resolvers');
const threads = require('./threads');

/**
 * 🔑 로그인이 필요한 콘텐츠용 쿠키 인자.
 *
 * 인스타그램·샤오홍슈 등은 로그인해야 보이는 글이 많다. yt-dlp 에 쿠키를 주면 받을 수 있다.
 * 두 가지 방식을 지원한다(사용자가 고른 쪽만 쓴다):
 *   ① cookies.txt 파일   — 가장 확실. 브라우저 확장으로 내보낸 파일을 등록.
 *   ② 브라우저에서 직접  — 편하지만 최신 크롬은 쿠키를 App-Bound 암호화해 실패할 수 있다.
 *
 * ⚠️ 쿠키는 '로그인한 나'와 같은 권한이다. 본계정 말고 **부계정 쿠키**를 권한다.
 *    쿠키 값은 이 앱이 어디로도 보내지 않는다(로컬에서 yt-dlp 에만 전달).
 */
function cookieArgs(job) {
  const c = job && job.cookies;
  if (!c || !c.mode || c.mode === 'none') return [];
  if (c.mode === 'file' && c.file && fs.existsSync(c.file)) return ['--cookies', c.file];
  if (c.mode === 'browser' && c.browser) return ['--cookies-from-browser', c.browser];
  return [];
}

/**
 * ✂️ 구간 다운로드 — 긴 영상에서 필요한 부분만.
 * 시작/끝은 "90" 또는 "1:30" 또는 "01:02:03" 형식을 받는다.
 * 끝을 비우면 끝까지, 시작을 비우면 처음부터.
 */
function sectionArgs(job) {
  const s = job && job.section;
  if (!s || (!s.start && !s.end)) return [];
  const from = (s.start || '0').trim();
  const to = (s.end || 'inf').trim();
  // --force-keyframes-at-cuts: 자른 지점이 깨지지 않게(없으면 앞부분이 검게 나올 수 있다)
  return ['--download-sections', `*${from}-${to}`, '--force-keyframes-at-cuts'];
}

/**
 * yt-dlp 래퍼: 메타데이터 조회 + 다운로드 + 진행률/취소 관리.
 * 모든 활성 다운로드 프로세스를 추적해 취소를 지원한다.
 */
class YtDlpEngine {
  constructor() {
    /** @type {Map<string, import('child_process').ChildProcess>} */
    this.active = new Map();
  }

  /** 공통 spawn — JSON/텍스트 stdout 을 모아서 반환 */
  _run(args, { onLine } = {}) {
    const { ytDlp, ffmpegDir } = getPaths();
    return new Promise((resolve, reject) => {
      const child = spawn(ytDlp, [...YTDLP_BASE_ARGS, ...args], {
        windowsHide: true,
        env: envWithBin(),
      });
      let stdout = '';
      let stderr = '';
      let buf = '';
      child.stdout.on('data', (d) => {
        const text = d.toString();
        stdout += text;
        if (onLine) {
          buf += text;
          let idx;
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (line) onLine(line);
          }
        }
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        if (buf.trim() && onLine) onLine(buf.trim());
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(stderr || `yt-dlp exited with code ${code}`));
      });
    });
  }

  /**
   * URL 메타데이터 조회 (단일 영상 또는 재생목록 평면 정보).
   * @returns {Promise<object>} yt-dlp -J 결과(JSON)
   */
  async getInfo(url, opts = {}) {
    // 🧵 Threads 는 yt-dlp 에 추출기 자체가 없다 → 전용 리졸버로 처리.
    if (threads.shouldHandle(url)) {
      return threads.getInfoLike(url, { cookiesFile: opts.cookies?.file || null });
    }
    // 인스타 등 쿠키가 막는 사이트는 외부 리졸버로 메타 조회(로그인 불필요)
    // 단, 사용자가 쿠키를 등록했다면 리졸버보다 쿠키가 더 정확하므로 yt-dlp 로 간다.
    const hasCookies = !!(opts.cookies && opts.cookies.mode && opts.cookies.mode !== 'none');
    if (!hasCookies && resolvers.shouldResolve(url)) {
      return resolvers.getInfoLike(url);
    }
    const args = [
      '-J',
      '--no-warnings',
      '--no-playlist', // 미리보기는 단일 항목만; 재생목록은 다운로드 시 처리
      ...cookieArgs(opts),
      url,
    ];
    const { stdout } = await this._run(args);
    return JSON.parse(stdout);
  }

  /**
   * 다운로드 실행.
   * @param {object} job
   * @param {string} job.id            고유 ID(취소용)
   * @param {string} job.url
   * @param {string} job.outputDir
   * @param {'video'|'audio'} job.mode
   * @param {number} [job.maxHeight]   video 모드 최대 화질(예: 1080). 0/undefined=최고
   * @param {string} [job.audioFormat] audio 모드 컨테이너(mp3/m4a). 기본 mp3
   * @param {boolean}[job.subtitles]   자막 다운로드(가능 시)
   * @param {boolean}[job.playlist]    재생목록 전체 다운로드
   * @param {function} onProgress      진행률 콜백
   */
  async download(job, onProgress) {
    // 🧵 Threads: 숨긴 창으로 글을 열어 실제 mp4/이미지 주소를 잡아낸 뒤 그걸 받는다.
    if (threads.shouldHandle(job.url)) {
      const meta = await threads.resolve(job.url, {
        cookiesFile: job.cookies?.file || null,
        onProgress,
      });
      job = {
        ...job,
        url: meta.directUrl,
        _direct: true,
        _threadsCode: meta.code,
        _threadsTitle: meta.title,
      };
      return this._spawnDownload(job, onProgress);
    }
    // 인스타 등: 로그인 없이 직접 미디어 URL로 해석 후 그 URL을 다운로드.
    //  ⚠️ 쿠키를 등록했다면 리졸버를 쓰지 않는다 — 쿠키가 있으면 yt-dlp 가
    //    비공개·로그인 전용 게시물까지 정식으로 처리하므로 그쪽이 정확하다.
    const hasCookies = !!(job.cookies && job.cookies.mode && job.cookies.mode !== 'none');
    if (!hasCookies && resolvers.shouldResolve(job.url)) {
      if (onProgress) onProgress({ type: 'stage', stage: 'resolving', text: '🔗 인스타그램 링크 분석 중...' });
      const meta = await resolvers.resolve(job.url);
      job = { ...job, url: meta.directUrl, _direct: true, _igShortcode: meta.shortcode };
    }
    return this._spawnDownload(job, onProgress);
  }

  _spawnDownload(job, onProgress) {
    const { ytDlp, ffmpegDir } = getPaths();
    const args = this._buildArgs(job, ffmpegDir);

    return new Promise((resolve, reject) => {
      // envWithBin() — 번들 바이너리(deno·ffmpeg) 폴더를 PATH 에 넣는다.
      //   예전엔 여기만 process.env 를 그대로 써서 다운로드 중 deno 를 못 찾을 수 있었다.
      const child = spawn(ytDlp, [...YTDLP_BASE_ARGS, ...args], { windowsHide: true, env: envWithBin() });
      this.active.set(job.id, child);

      let stderr = '';
      let buf = '';
      let finalFile = null;
      const handleLine = (line) => {
        const f = this._extractFinalPath(line);
        if (f) finalFile = f;
        const evt = this._parseProgress(line);
        if (evt && onProgress) onProgress(evt);
      };

      child.stdout.on('data', (d) => {
        buf += d.toString();
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (line) handleLine(line);
        }
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      child.on('error', (err) => {
        this.active.delete(job.id);
        reject(err);
      });
      child.on('close', (code) => {
        this.active.delete(job.id);
        if (code === 0) resolve({ ok: true, file: finalFile });
        else if (child.killed) resolve({ ok: false, canceled: true });
        else reject(new Error(this._friendlyError(stderr, code)));
      });
    });
  }

  /**
   * 자막 미리보기용: 영상 본체 없이 **오디오만** 빠르게 받아 파일 경로 반환.
   * (재인코딩/메타데이터/썸네일 없이 원본 오디오 스트림을 그대로 저장 → 속도 우선)
   * @param {string} url
   * @param {string} outDir   ASCII 임시 폴더 권장
   * @param {function} [onProgress]
   * @returns {Promise<string>} 받은 오디오 파일 절대경로
   */
  async downloadAudioOnly(url, outDir, onProgress) {
    // 인스타 등: 직접 미디어 URL로 먼저 해석
    if (resolvers.shouldResolve(url)) {
      if (onProgress) onProgress({ type: 'stage', text: '🔗 인스타그램 링크 분석 중...' });
      const meta = await resolvers.resolve(url);
      url = meta.directUrl;
    }
    const { ytDlp, ffmpegDir } = getPaths();
    const id = `preview:${Date.now()}`;
    const outTemplate = path.join(outDir, 'pa-%(id)s.%(ext)s');
    const args = [
      '--newline',
      '--no-warnings',
      '--no-playlist',
      '--ffmpeg-location', ffmpegDir,
      '--restrict-filenames',
      '--no-mtime',
      '-f', 'ba/bestaudio/best',
      '-o', outTemplate,
      '--progress-template', 'DLP|%(progress._percent_str)s',
      '--print', 'after_move:FILE|%(filepath)s',
      url,
    ];
    return new Promise((resolve, reject) => {
      const child = spawn(ytDlp, [...YTDLP_BASE_ARGS, ...args], { windowsHide: true, env: envWithBin() });
      this.active.set(id, child);
      let stderr = '';
      let buf = '';
      let finalFile = null;
      child.stdout.on('data', (d) => {
        buf += d.toString();
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          if (line.startsWith('FILE|')) {
            const p = line.slice(5).trim();
            if (p && p !== 'NA') finalFile = p;
          } else if (line.startsWith('DLP|') && onProgress) {
            const pct = parseFloat((line.split('|')[1] || '').replace('%', '').trim());
            onProgress({ type: 'progress', percent: Number.isFinite(pct) ? pct : null, note: '오디오 받는 중' });
          }
        }
      });
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('error', (err) => { this.active.delete(id); reject(err); });
      child.on('close', (code) => {
        this.active.delete(id);
        if (code === 0 && finalFile) resolve(finalFile);
        else if (child.killed) reject(new Error('취소됨'));
        else reject(new Error(this._friendlyError(stderr, code)));
      });
    });
  }

  cancel(id) {
    const child = this.active.get(id);
    if (!child) return false;
    child.kill('SIGKILL');
    this.active.delete(id);
    return true;
  }

  cancelAll() {
    for (const id of [...this.active.keys()]) this.cancel(id);
  }

  _buildArgs(job, ffmpegDir) {
    // 리졸버로 이미 직접 미디어 URL을 받은 경우(_direct): 단일 프로그레시브 파일이라
    // 포맷 병합·자막·재생목록 로직을 건너뛰고, 파일명은 shortcode 기준으로 고정한다.
    const direct = !!job._direct;
    // ★ 파일명 = 영상 제목 그대로 (사장님 지시 2026-07-27).
    //   예전엔 '%(title).200B [%(id)s]' + --restrict-filenames 였다. 그러면
    //     · 공백이 전부 '_' 로 바뀌고
    //     · 한글이 통째로 지워지고 (--restrict-filenames 는 ASCII 만 남긴다)
    //     · 뒤에 [dQw4w9WgXcQ] 같은 영상 ID 가 붙었다
    //   → 제목만 쓰고, 길이는 150바이트로 잘라 윈도우 경로 길이 제한을 피한다.
    //     (파일명에 못 쓰는 문자 \ / : * ? " < > | 는 yt-dlp 가 알아서 바꿔준다)
    // 스레드/인스타는 직접 미디어 URL 이라 yt-dlp 가 제목을 모른다 → 우리가 잡은 제목을 쓴다.
    const safe = (s) => String(s || '').replace(/[\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    const nameBase = direct && job._threadsCode
      ? (safe(job._threadsTitle) || `Threads ${job._threadsCode}`)
      : direct && job._igShortcode
        ? `Instagram ${job._igShortcode}`
        : '%(title).150B';
    const outTemplate = path.join(job.outputDir, `${nameBase}.%(ext)s`);
    const args = [
      '--newline',
      '--no-warnings',
      '--ffmpeg-location', ffmpegDir,
      '--windows-filenames',   // 윈도우에서 못 쓰는 문자만 안전하게 치환(한글·공백은 유지)
      '--no-mtime',
      '-o', outTemplate,
      // 진행률을 파싱하기 쉬운 토큰으로 출력
      '--progress-template',
      'DLP|%(progress._percent_str)s|%(progress._total_bytes_estimate_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
      // 최종 산출 파일 경로를 후처리 후 출력(자막 생성용)
      '--print', 'after_move:FILE|%(filepath)s',
      ...cookieArgs(job),
      ...sectionArgs(job),
    ];

    if (job.playlist && !direct) {
      args.push('--yes-playlist');
    } else {
      args.push('--no-playlist');
    }

    if (job.mode === 'audio') {
      const fmt = job.audioFormat || 'mp3';
      args.push('-x', '--audio-format', fmt, '--audio-quality', '0');
      // 썸네일을 커버로 임베드(mp3/m4a)
      args.push('--add-metadata');
      if (!direct) args.push('--embed-thumbnail');
    } else if (direct) {
      // 직접 URL: 단일 progressive 스트림. 병합 불필요, mp4로 리먹스만 보장.
      args.push('-f', 'b/best', '--remux-video', 'mp4', '--add-metadata');
    } else {
      const cap = job.maxHeight && job.maxHeight > 0 ? `[height<=${job.maxHeight}]` : '';
      // 최고 화질 비디오 + 최고 오디오 병합, 실패 시 단일 best
      args.push(
        '-f',
        `bv*${cap}+ba/b${cap}/bv*+ba/b`,
        '--merge-output-format',
        'mp4',
        '--add-metadata',
        '--embed-thumbnail',
      );
      if (job.subtitles) {
        args.push('--write-subs', '--write-auto-subs', '--sub-langs', 'ko,en', '--embed-subs');
      }
    }

    args.push(job.url);
    return args;
  }

  _extractFinalPath(line) {
    if (line.startsWith('FILE|')) {
      const p = line.slice(5).trim();
      return p && p !== 'NA' ? p : null;
    }
    return null;
  }

  _parseProgress(line) {
    if (line.startsWith('DLP|')) {
      const [, percent, total, speed, eta] = line.split('|');
      const pct = parseFloat((percent || '').replace('%', '').trim());
      return {
        type: 'progress',
        percent: Number.isFinite(pct) ? pct : null,
        total: (total || '').trim(),
        speed: (speed || '').trim(),
        eta: (eta || '').trim(),
      };
    }
    if (line.includes('[download] Destination:')) {
      return { type: 'stage', stage: 'downloading', text: line.replace('[download] Destination:', '').trim() };
    }
    if (line.includes('[Merger]') || line.includes('Merging formats')) {
      return { type: 'stage', stage: 'merging', text: '병합 중...' };
    }
    if (line.includes('[ExtractAudio]')) {
      return { type: 'stage', stage: 'extracting', text: '오디오 추출 중...' };
    }
    if (line.includes('[EmbedThumbnail]') || line.includes('[Metadata]')) {
      return { type: 'stage', stage: 'finishing', text: '마무리 중...' };
    }
    if (/has already been downloaded/.test(line)) {
      return { type: 'progress', percent: 100, note: '이미 다운로드됨' };
    }
    return null;
  }

  _friendlyError(stderr, code) {
    const s = (stderr || '').toLowerCase();
    if (s.includes('snapsave_empty') || s.includes('resolverempty')) {
      return '인스타그램 미디어를 찾을 수 없습니다(비공개 계정·삭제·잘못된 링크). 공개 게시물/릴스인지 확인하세요.';
    }
    if (s.includes('unsupported url')) return '지원하지 않는 URL 입니다.';
    if (s.includes('private video') || s.includes('login')) return '비공개/로그인이 필요한 영상입니다.';
    if (s.includes('video unavailable')) return '영상을 사용할 수 없습니다(삭제/지역 제한).';
    if (s.includes('ffmpeg')) return 'ffmpeg 오류 — 바이너리를 확인하세요.';
    const firstErr = (stderr || '').split('\n').filter((l) => l.toUpperCase().includes('ERROR')).pop();
    return firstErr || `다운로드 실패 (code ${code})`;
  }
}

module.exports = new YtDlpEngine();
