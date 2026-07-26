'use strict';

/**
 * macOS 애드혹(ad-hoc) 코드 서명.
 *
 * ■ 왜 필요한가
 *   Apple Silicon(arm64) 맥은 **서명이 아예 없는 실행파일을 실행하지 않는다.**
 *   그 상태로 배포하면 사용자에게 "앱이 손상되었기 때문에 열 수 없습니다" 가 뜨고,
 *   우클릭 → 열기 로도 풀리지 않는다(휴지통으로 옮기라는 안내만 나온다).
 *
 *   애드혹 서명(`codesign --sign -`)은 애플 개발자 계정 없이 붙일 수 있는 '자체 서명'이다.
 *   이걸 붙이면 경고 문구가 **"확인되지 않은 개발자"** 로 바뀌고,
 *   우클릭 → 열기 로 정상 실행된다. (경쟁사 SB Downloader 도 같은 수준)
 *
 *   ※ 애플 공증(notarization)은 개발자 계정(연 $99)이 있어야 하며, 그걸 하면
 *     경고 자체가 사라진다. 계정이 생기면 이 파일 대신 정식 서명으로 교체할 것.
 *
 * ■ 주의
 *   서명은 반드시 **안쪽 바이너리부터** 하고 앱 번들을 마지막에 해야 한다.
 *   (번들 서명 후 내부 파일을 건드리면 서명이 깨진다)
 */

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  if (!fs.existsSync(appPath)) {
    console.warn(`[adhoc-sign] .app 을 찾지 못함: ${appPath}`);
    return;
  }

  const sign = (target, extra = []) => {
    execFileSync('codesign', ['--force', '--timestamp=none', '--sign', '-', ...extra, target], {
      stdio: 'inherit',
    });
  };

  console.log(`[adhoc-sign] 애드혹 서명 시작: ${appName}`);

  // ① 번들 안의 실행 가능한 것들을 먼저 서명한다.
  //    우리는 yt-dlp·ffmpeg·deno·whisper 같은 외부 바이너리를 Resources 에 넣으므로
  //    이들이 서명되지 않으면 앱 전체 서명이 유효하지 않다.
  const inner = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (full.endsWith('.framework') || full.endsWith('.app')) inner.push(full);
        else walk(full);
      } else if (e.isFile()) {
        try {
          // 실행 권한이 있는 파일 = 바이너리로 간주
          if (fs.statSync(full).mode & 0o111) inner.push(full);
        } catch (_) { /* 무시 */ }
      }
    }
  };
  try { walk(path.join(appPath, 'Contents')); } catch (_) { /* 무시 */ }

  let ok = 0, fail = 0;
  for (const target of inner) {
    try { sign(target); ok++; } catch (_) { fail++; }
  }
  console.log(`[adhoc-sign] 내부 항목 ${ok}개 서명 (실패 ${fail}개는 서명 대상이 아님)`);

  // ② 앱 번들을 마지막에 서명한다.
  sign(appPath, ['--deep']);
  console.log('[adhoc-sign] 앱 번들 서명 완료');

  // ③ 검증 — 여기서 실패하면 사용자 맥에서도 안 열린다. 빌드를 세운다.
  execFileSync('codesign', ['--verify', '--verbose=2', appPath], { stdio: 'inherit' });
  console.log('[adhoc-sign] ✅ 서명 검증 통과');
};
