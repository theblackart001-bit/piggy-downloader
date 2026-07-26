'use strict';

/**
 * yt-dlp 자동 갱신.
 *
 * ■ 왜 필요한가
 *   유튜브·틱톡은 수시로 내부 구조를 바꾼다. 그때마다 yt-dlp 가 새로 나오는데,
 *   앱에 번들된 yt-dlp 는 빌드 시점에 고정돼 있다 → 몇 주만 지나도
 *   "유튜브만 안 받아져요" 상태가 된다. 다운로더에서 이건 사실상 고장이다.
 *   앱 자동업데이트(electron-updater)로도 갱신되긴 하지만, 그건 300MB 재설치라
 *   자주 낼 수 없다. yt-dlp(약 17MB)만 따로 갱신하는 통로가 필요하다.
 *
 * ■ 왜 userData 에 받나
 *   설치본은 Program Files 에 깔린다 = 관리자 권한 없이는 못 쓴다.
 *   번들 파일을 덮어쓰려 하면 EPERM 으로 실패한다.
 *   → 쓰기 가능한 userData/bin/ 에 새 yt-dlp 를 받고, binaries.js 가 그걸 먼저 찾게 한다.
 *     (번들본은 그대로 남아 있어서, 갱신이 실패해도 앱은 항상 동작한다.)
 *
 * ■ 안전 원칙
 *   · 실패해도 절대 앱을 막지 않는다(조용히 번들본 사용).
 *   · 임시파일로 받고 검증한 뒤 rename = 중간에 끊겨도 반쪽짜리가 남지 않는다.
 *   · 하루 1회만 확인(설정에 마지막 확인 시각 기록). 수동 갱신은 언제든 가능.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { updatesDir, getPaths, IS_WIN } = require('./binaries');

const RELEASE_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const ASSET = IS_WIN ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp';
const TARGET_NAME = IS_WIN ? 'yt-dlp.exe' : 'yt-dlp';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 하루
const MIN_SIZE = 1_000_000; // 1MB 미만이면 받다 만 것(정상 yt-dlp 는 10MB 이상)

/** 지금 쓰는 yt-dlp 의 버전 문자열(예: "2026.07.20"). 실패하면 null. */
function currentVersion() {
  return new Promise((resolve) => {
    let bin;
    try { bin = getPaths().ytDlp; } catch { return resolve(null); }
    execFile(bin, ['--version'], { timeout: 15000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(String(stdout || '').trim().split(/\s+/)[0] || null);
    });
  });
}

/** GitHub 최신 릴리즈 태그(= yt-dlp 버전). 실패하면 null. */
async function latestVersion() {
  try {
    const res = await fetch(RELEASE_API, {
      headers: { 'User-Agent': 'PiggyDownloader', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const tag = String(json.tag_name || '').trim();
    return tag || null;
  } catch {
    return null;
  }
}

/** 새 yt-dlp 를 userData/bin 에 내려받는다. 성공하면 경로, 실패하면 null. */
async function downloadTo(version) {
  const dir = updatesDir();
  await fsp.mkdir(dir, { recursive: true });
  const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${encodeURIComponent(version)}/${ASSET}`;
  const tmp = path.join(os.tmpdir(), `piggy-ytdlp-${Date.now()}${IS_WIN ? '.exe' : ''}`);

  const res = await fetch(url, {
    headers: { 'User-Agent': 'PiggyDownloader' },
    redirect: 'follow',
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`다운로드 실패 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < MIN_SIZE) throw new Error(`파일이 너무 작습니다(${buf.length} bytes)`);
  await fsp.writeFile(tmp, buf);
  if (!IS_WIN) await fsp.chmod(tmp, 0o755);

  // 원자적 교체 — 같은 볼륨이 아닐 수 있으므로 rename 실패 시 복사로 폴백
  const dest = path.join(dir, TARGET_NAME);
  try {
    await fsp.rm(dest, { force: true });
    await fsp.rename(tmp, dest);
  } catch {
    await fsp.copyFile(tmp, dest);
    await fsp.rm(tmp, { force: true });
  }
  return dest;
}

/** 받아둔 갱신본이 실제로 실행되는지 확인. 깨졌으면 지워서 번들본으로 되돌린다. */
async function verifyOrRollback(dest) {
  const ok = await new Promise((resolve) => {
    execFile(dest, ['--version'], { timeout: 20000, windowsHide: true }, (err) => resolve(!err));
  });
  if (!ok) {
    await fsp.rm(dest, { force: true }).catch(() => {});
    throw new Error('받은 파일이 실행되지 않아 되돌렸습니다');
  }
}

/**
 * 갱신 확인 + 필요 시 적용.
 * @param {object} opts
 * @param {boolean} opts.force      true면 하루 1회 제한을 무시(수동 버튼)
 * @param {function} opts.loadSettings / opts.saveSettings  마지막 확인 시각 기록용
 * @param {function} opts.onStatus  진행 상황 콜백({state, ...})
 * @returns {Promise<{state:string, from?:string, to?:string, error?:string}>}
 */
async function checkAndUpdate({ force = false, loadSettings, saveSettings, onStatus = () => {} } = {}) {
  const settings = (loadSettings && loadSettings()) || {};
  const last = Number(settings.ytdlpLastCheck || 0);

  if (!force && Date.now() - last < CHECK_INTERVAL_MS) {
    return { state: 'skipped' };
  }
  // 자동 갱신을 꺼둔 사람은 수동 실행일 때만 돈다
  if (!force && settings.ytdlpAutoUpdate === false) return { state: 'disabled' };

  try {
    onStatus({ state: 'checking' });
    const [cur, latest] = await Promise.all([currentVersion(), latestVersion()]);

    // 확인 시각은 성공/실패와 무관하게 기록(네트워크가 없을 때 매번 두드리지 않게)
    if (saveSettings) saveSettings({ ...settings, ytdlpLastCheck: Date.now() });

    if (!latest) { onStatus({ state: 'error', error: '최신 버전 확인 실패' }); return { state: 'error', error: 'check-failed' }; }
    if (cur && cur === latest) { onStatus({ state: 'latest', version: cur }); return { state: 'latest', to: cur }; }

    onStatus({ state: 'downloading', version: latest });
    const dest = await downloadTo(latest);
    await verifyOrRollback(dest);

    onStatus({ state: 'updated', from: cur || '(알 수 없음)', to: latest });
    return { state: 'updated', from: cur, to: latest };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    onStatus({ state: 'error', error: msg });
    return { state: 'error', error: msg }; // 절대 throw 하지 않는다 — 실패해도 앱은 계속 동작
  }
}

module.exports = { checkAndUpdate, currentVersion, latestVersion };
