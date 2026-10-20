'use strict';
// node scripts/test-instagram-title.js
// 인스타를 «Video by 계정명» 대신 게시물 글(캡션) 첫 줄로 저장하는가 (사장님 지시 2026-10-19).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { captionTitle, safeName, 인스타이름, 겹치지않게 } = require('../src/main/filename');

let bad = 0;
const ok = (c, m, h) => { console.log(`${c ? '  ✅' : '  ❌'} ${m}`); if (!c) { bad++; if (h) console.log(`      → ${h}`); } };

ok(captionTitle('Video by chae2home', '\n  다이소 신상 꿀템 🔥\r\n#살림 #다이소') === '다이소 신상 꿀템 🔥 #살림 #다이소', '캡션 줄들을 이어 제목으로(빈 줄 건너뜀)');
ok(captionTitle('Video by x', '') === 'Video by x', '캡션이 없으면 원래 제목 그대로');
ok(captionTitle('유튜브 영상 제목', '설명') === '유튜브 영상 제목', '«Video by» 가 아닌 제목(유튜브 등)은 안 건드린다');
ok(captionTitle('Photo by abc', '첫 줄') === '첫 줄', '«Photo by» 도 같은 규칙');
ok(captionTitle('Video by a', '♥️댓글에 나도 남겨주세요😉\n다이소 수납함') !== captionTitle('Video by a', '♥️댓글에 나도 남겨주세요😉\n쿠팡 텀블러'), '첫 줄이 같은 계정 공통 문구여도 뒷줄로 구분된다');
ok(captionTitle('Video by x', 'a'.repeat(300)).length === 80, '캡션이 길면 80자로 자른다');
ok(safeName(captionTitle('Video by x', '이게 뭐죠? "진짜" 대박 / 꿀템')) === '이게 뭐죠 진짜 대박 꿀템', '파일명에 못 쓰는 글자는 safeName 이 정리한다');

// 같은 계정 여러 개 — 캡션이 없으면 게시물 코드로 구분, 같은 캡션이면 (2)·(3)
ok(인스타이름('Video by chae2home') === 'Video by chae2home %(id)s', '캡션 없는 영상은 «Video by 계정 + 게시물 코드» 로 구분');
ok(인스타이름('') === '%(title).120B %(id)s', '제목이 아예 없어도 게시물 코드로 구분');
ok(인스타이름('다이소 꿀템') === '다이소 꿀템', '캡션 제목은 그대로');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piggy-name-'));
  ok(겹치지않게(dir, '다이소 꿀템') === '다이소 꿀템', '처음엔 그 이름 그대로');
  fs.writeFileSync(path.join(dir, '다이소 꿀템.mp4'), '');
  ok(겹치지않게(dir, '다이소 꿀템') === '다이소 꿀템 (2)', '같은 이름이 이미 있으면 (2)');
  fs.writeFileSync(path.join(dir, '다이소 꿀템 (2).mp4'), '');
  ok(겹치지않게(dir, '다이소 꿀템') === '다이소 꿀템 (3)', '(2) 도 있으면 (3)');
  ok(겹치지않게(dir, 'Video by x %(id)s') === 'Video by x %(id)s', 'yt-dlp 틀이 든 이름은 그대로(코드로 이미 구분)');
  fs.rmSync(dir, { recursive: true, force: true });
}

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ytdlp.js'), 'utf8');
// (2026-10-20) 채널 주소 대응으로 firstEntry(…) 로 한 번 감쌌다 — 감싸도 «두 반환 모두 캡션 제목» 이라는 뜻은 같다
ok((src.match(/withCaptionTitle\((?:firstEntry\()?JSON\.parse\(stdout\)\)?, url\)/g) || []).length === 2, 'getInfo 의 두 반환(기본·유튜브 재시도) 모두 인스타 제목을 바꾼다');
ok(/인스타이름\(safe\(captionTitle\(job\.title/.test(src), '파일명(_buildArgs)도 인스타면 캡션 제목 → 없으면 코드');
ok(/겹치지않게\(job\.outputDir, nameBase\)/.test(src), '모든 다운로드 파일명이 겹치지 않게 (2)·(3) 을 거친다');

console.log('');
if (bad) { console.log(`❌ ${bad}건 — 인스타가 아직 «Video by» 로 저장됩니다`); process.exit(1); }
console.log('✅ 인스타도 게시물 글 첫 줄(제목)로 저장됩니다');
