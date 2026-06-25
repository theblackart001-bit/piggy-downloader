'use strict';

/**
 * SB Downloader 와 동일한 구성으로 배포 폴더 + ZIP 생성.
 * 구성: <폴더>/ { chrome-extension.zip, Windows/, macOS/, 사용매뉴얼.pdf, 이용약관.pdf, 처음에 읽어주세요.txt }
 * (PowerShell 의 한글 인코딩 문제를 피하기 위해 Node 로 처리, 압축만 bsdtar 사용)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const VERSION = process.argv[2] || require('../package.json').version;
const ROOT = path.join(__dirname, '..');
const NAME = `PiggyDownloader-${VERSION}`;
const OUT = path.join(ROOT, 'release');
const STAGE = path.join(OUT, NAME);
const DIST = path.join(ROOT, 'dist');
const PKG = path.join(ROOT, 'packaging');

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function mkdir(p) { fs.mkdirSync(p, { recursive: true }); }
function zipDir(srcDir, outZip) {
  // bsdtar(Windows10+/mac 내장): -a 로 확장자(.zip) 자동 인식, 디렉토리 내용 압축
  rmrf(outZip);
  execFileSync('tar', ['-a', '-cf', outZip, '-C', srcDir, '.'], { stdio: 'ignore' });
}

// 초기화
rmrf(STAGE);
mkdir(path.join(STAGE, 'Windows'));
mkdir(path.join(STAGE, 'macOS'));

// 1) chrome-extension.zip
zipDir(path.join(ROOT, 'chrome-extension'), path.join(STAGE, 'chrome-extension.zip'));
console.log('[pkg] chrome-extension.zip');

// 2) Windows 산출물 + 자동업데이트 메타
const winFiles = [
  `Piggy Downloader Setup ${VERSION}.exe`,
  `PiggyDownloader-Portable-${VERSION}.exe`,
  'latest.yml',
];
for (const f of winFiles) {
  const src = path.join(DIST, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(STAGE, 'Windows', f));
  else console.warn('[pkg] (경고) 없음:', f);
}
console.log('[pkg] Windows 산출물 복사');

// 3) macOS 산출물 (있으면 복사, 없으면 빌드 안내)
const dmgs = fs.existsSync(DIST) ? fs.readdirSync(DIST).filter((f) => f.endsWith('.dmg')) : [];
if (dmgs.length) {
  for (const d of dmgs) fs.copyFileSync(path.join(DIST, d), path.join(STAGE, 'macOS', d));
  console.log('[pkg] macOS dmg 복사:', dmgs.join(', '));
} else {
  const note =
    'macOS 설치본(.dmg)은 macOS 에서 빌드해야 합니다.\r\n\r\n' +
    'Mac 에서:\r\n  npm install\r\n  node scripts/download-binaries.js --mac\r\n  npm run dist:mac\r\n\r\n' +
    '생성된 dist/*.dmg 를 이 macOS 폴더에 넣어 배포하세요.\r\n';
  fs.writeFileSync(path.join(STAGE, 'macOS', 'README - mac 빌드 안내.txt'), note);
  console.log('[pkg] macOS dmg 없음 -> 빌드 안내 파일 생성');
}

// 4) 문서
for (const f of ['사용매뉴얼.pdf', '이용약관.pdf', '처음에 읽어주세요.txt']) {
  fs.copyFileSync(path.join(PKG, f), path.join(STAGE, f));
}
console.log('[pkg] 문서 복사 (매뉴얼/약관/안내)');

// 5) 전체 ZIP
const finalZip = path.join(OUT, `${NAME}.zip`);
zipDir(STAGE, finalZip);
console.log('[pkg] 완성 ->', finalZip);

// 요약
console.log('\n=== 배포 구성 ===');
(function walk(dir, base) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = path.join(base, e.name);
    if (e.isDirectory()) walk(full, rel);
    else console.log(`  ${rel.padEnd(42)} ${(fs.statSync(full).size / 1024).toFixed(0)} KB`);
  }
})(STAGE, '');
console.log(`  ZIP = ${(fs.statSync(finalZip).size / 1024 / 1024).toFixed(1)} MB`);
