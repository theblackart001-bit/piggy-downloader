'use strict';

/**
 * SB Downloader 와 동일한 구성으로 배포 폴더 + ZIP 생성.
 * 구성: <폴더>/ { Windows/, macOS/, 사용매뉴얼.pdf }
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
// ⚠️ Git Bash 에서 실행하면 PATH 의 'tar' 가 GNU tar(MSYS)로 잡히는데, GNU tar 는
//    '-a'(확장자로 압축형식 자동선택)를 모른다 → exit 128 로 죽는다.
//    Windows 10+ 내장 bsdtar(System32\tar.exe)를 절대경로로 지정해 셸과 무관하게 동작시킨다.
const TAR = (() => {
  if (process.platform !== 'win32') return 'tar';
  const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return fs.existsSync(sys) ? sys : 'tar';
})();

function zipDir(srcDir, outZip) {
  // bsdtar(Windows10+/mac 내장): -a 로 확장자(.zip) 자동 인식, 디렉토리 내용 압축
  rmrf(outZip);
  execFileSync(TAR, ['-a', '-cf', outZip, '-C', srcDir, '.'], { stdio: 'ignore' });
}

// 초기화
// ★ 폴더 구조는 '실제로 넣을 게 있을 때만' 만든다.
//   Windows 것만 있으면 폴더 없이 최상위에 그냥 둔다 = 압축 풀자마자 설치파일이 보인다.
//   (빈 macOS 폴더에 개발자용 빌드 메모를 넣어두면 산 사람만 헷갈린다.)
rmrf(STAGE);
mkdir(STAGE);
const dmgs = fs.existsSync(DIST) ? fs.readdirSync(DIST).filter((f) => f.endsWith('.dmg')) : [];
const MULTI_OS = dmgs.length > 0; // mac 산출물이 있을 때만 OS별 폴더로 나눈다
const winDir = MULTI_OS ? path.join(STAGE, 'Windows') : STAGE;
if (MULTI_OS) { mkdir(winDir); mkdir(path.join(STAGE, 'macOS')); }

// 1) (제외) 크롬 확장 — 배포하지 않는다(사장님 결정 2026-07-26).
//    링크를 복사하면 앱이 바로 받도록 바뀌면서 확장의 존재 이유가 사라졌다.
//    게다가 설치가 번거롭고(개발자 모드+압축해제 로드) 모든 페이지 접근 권한이 필요했다.
//    확장에만 있던 '자막만 보기'는 앱 버튼(👀 자막만 보기)으로 옮겼다.

// 2) Windows 산출물 — 설치본(NSIS)만 배포한다(사장님 결정 2026-07-26).
//    ⚠️ 포터블은 일부러 뺐다. 포터블은 앱 자동업데이트를 못 받는데, 이 앱의 핵심인
//      yt-dlp 는 유튜브가 구조를 바꿀 때마다 갱신돼야 한다. 포터블 사용자는
//      몇 주 뒤 "유튜브만 안 돼요" 상태가 된다. (+ZIP 이 두 배가 되고 실행도 느리다)
//      → 설치본만 배포 = 모두가 자동 업데이트를 받는다.
//    latest.yml 은 GitHub Releases 의 자동업데이트용 메타라 배포 ZIP 에는 넣지 않음(SB 와 동일).
const winCopies = [
  // [dist 원본명, 배포 ZIP 내 파일명]
  [`Piggy Downloader Setup ${VERSION}.exe`, `Piggy Downloader-${VERSION}-x64.exe`],
];
const winMade = [];
for (const [srcName, dstName] of winCopies) {
  const src = path.join(DIST, srcName);
  if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(winDir, dstName)); winMade.push(dstName); }
  else console.warn('[pkg] (경고) 없음:', srcName);
}
console.log('[pkg] Windows 산출물 복사:', winMade.join(' · ') || '(없음)');

// 3) macOS 산출물 — dmg 가 있을 때만 넣는다.
//    없으면 macOS 폴더 자체를 만들지 않는다. 대신 Mac 사용자가 헤매지 않도록
//    '맥 사용자 안내' 파일을 최상위에 하나 둔다(개발용 빌드 명령이 아니라 안내문).
if (MULTI_OS) {
  for (const d of dmgs) fs.copyFileSync(path.join(DIST, d), path.join(STAGE, 'macOS', d));
  console.log('[pkg] macOS dmg 복사:', dmgs.join(', '));
} else {
  const note = [
    'Mac 을 쓰고 계신가요?',
    '',
    '이 프로그램은 현재 Windows 전용입니다.',
    '지금 들어 있는 설치 파일(.exe)은 Mac 에서는 열리지 않습니다.',
    '',
    'Mac 용은 준비 중입니다. 나오면 안내드리겠습니다.',
    '문의: AI부업플랜 / callos9987@gmail.com',
    '',
    '(Mac 에서 꼭 지금 쓰셔야 한다면, 윈도우가 설치된 PC 나',
    ' 회사 PC 에서 사용하시는 방법밖에 없습니다. 죄송합니다.)',
    '',
  ].join('\r\n');
  // ⚠️ BOM 을 붙여 저장한다. BOM 없는 UTF-8 한글 txt 는 메모장 등에서 깨져 보일 수 있다
  //    (받은 사람이 여는 파일이라 깨지면 안내가 아니라 불신이 된다).
  fs.writeFileSync(path.join(STAGE, '맥 사용자는 읽어주세요.txt'), '﻿' + note, 'utf8');
  console.log('[pkg] macOS dmg 없음 -> 맥 사용자 안내문 생성(폴더 없음)');
}

// 4) 문서 — 사용매뉴얼만 넣는다(사장님 지시 2026-07-26).
//    이용약관.pdf, 처음에 읽어주세요.txt 는 배포에서 제외. 설치 안내는 매뉴얼에 다 있다.
for (const f of ['사용매뉴얼.pdf']) {
  fs.copyFileSync(path.join(PKG, f), path.join(STAGE, f));
}
console.log('[pkg] 문서 복사 (사용매뉴얼.pdf 만)');

// 5) 전체 ZIP (SB-Downloader 와 동일하게 최상위 폴더 `PiggyDownloader-<버전>/` 로 감싼다)
const finalZip = path.join(OUT, `${NAME}.zip`);
rmrf(finalZip);
execFileSync(TAR, ['-a', '-cf', finalZip, '-C', OUT, NAME], { stdio: 'ignore' });
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
