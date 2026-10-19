'use strict';
// node scripts/test-instagram-title.js
// 인스타를 «Video by 계정명» 대신 게시물 글(캡션) 첫 줄로 저장하는가 (사장님 지시 2026-10-19).
const fs = require('fs');
const path = require('path');
const { captionTitle, safeName } = require('../src/main/filename');

let bad = 0;
const ok = (c, m, h) => { console.log(`${c ? '  ✅' : '  ❌'} ${m}`); if (!c) { bad++; if (h) console.log(`      → ${h}`); } };

ok(captionTitle('Video by chae2home', '\n  다이소 신상 꿀템 🔥\r\n#살림 #다이소') === '다이소 신상 꿀템 🔥', '캡션 첫 줄(빈 줄 건너뜀)을 제목으로');
ok(captionTitle('Video by x', '') === 'Video by x', '캡션이 없으면 원래 제목 그대로');
ok(captionTitle('유튜브 영상 제목', '설명') === '유튜브 영상 제목', '«Video by» 가 아닌 제목(유튜브 등)은 안 건드린다');
ok(captionTitle('Photo by abc', '첫 줄') === '첫 줄', '«Photo by» 도 같은 규칙');
ok(captionTitle('Video by x', 'a'.repeat(300)).length === 100, '캡션이 길면 100자로 자른다');
ok(safeName(captionTitle('Video by x', '이게 뭐죠? "진짜" 대박 / 꿀템')) === '이게 뭐죠 진짜 대박 꿀템', '파일명에 못 쓰는 글자는 safeName 이 정리한다');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ytdlp.js'), 'utf8');
ok((src.match(/withCaptionTitle\(JSON\.parse\(stdout\), url\)/g) || []).length === 2, 'getInfo 의 두 반환(기본·유튜브 재시도) 모두 인스타 제목을 바꾼다');
ok(/IG_HOST_RE\.test\(safeHost\(job\.url\)\) && safe\(captionTitle\(job\.title/.test(src), '파일명(_buildArgs)도 인스타면 캡션 제목을 쓴다');

console.log('');
if (bad) { console.log(`❌ ${bad}건 — 인스타가 아직 «Video by» 로 저장됩니다`); process.exit(1); }
console.log('✅ 인스타도 게시물 글 첫 줄(제목)로 저장됩니다');
