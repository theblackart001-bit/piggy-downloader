'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { getPaths, envWithBin } = require('./binaries');

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
      const child = spawn(ytDlp, args, {
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
  async getInfo(url) {
    const args = [
      '-J',
      '--no-warnings',
      '--no-playlist', // 미리보기는 단일 항목만; 재생목록은 다운로드 시 처리
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
  download(job, onProgress) {
    const { ytDlp, ffmpegDir } = getPaths();
    const args = this._buildArgs(job, ffmpegDir);

    return new Promise((resolve, reject) => {
      const child = spawn(ytDlp, args, { windowsHide: true, env: { ...process.env } });
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
    const outTemplate = path.join(job.outputDir, '%(title).200B [%(id)s].%(ext)s');
    const args = [
      '--newline',
      '--no-warnings',
      '--ffmpeg-location', ffmpegDir,
      '--restrict-filenames',
      '--no-mtime',
      '-o', outTemplate,
      // 진행률을 파싱하기 쉬운 토큰으로 출력
      '--progress-template',
      'DLP|%(progress._percent_str)s|%(progress._total_bytes_estimate_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
      // 최종 산출 파일 경로를 후처리 후 출력(자막 생성용)
      '--print', 'after_move:FILE|%(filepath)s',
    ];

    if (job.playlist) {
      args.push('--yes-playlist');
    } else {
      args.push('--no-playlist');
    }

    if (job.mode === 'audio') {
      const fmt = job.audioFormat || 'mp3';
      args.push('-x', '--audio-format', fmt, '--audio-quality', '0');
      // 썸네일을 커버로 임베드(mp3/m4a)
      args.push('--embed-thumbnail', '--add-metadata');
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
    if (s.includes('unsupported url')) return '지원하지 않는 URL 입니다.';
    if (s.includes('private video') || s.includes('login')) return '비공개/로그인이 필요한 영상입니다.';
    if (s.includes('video unavailable')) return '영상을 사용할 수 없습니다(삭제/지역 제한).';
    if (s.includes('ffmpeg')) return 'ffmpeg 오류 — 바이너리를 확인하세요.';
    const firstErr = (stderr || '').split('\n').filter((l) => l.toUpperCase().includes('ERROR')).pop();
    return firstErr || `다운로드 실패 (code ${code})`;
  }
}

module.exports = new YtDlpEngine();
