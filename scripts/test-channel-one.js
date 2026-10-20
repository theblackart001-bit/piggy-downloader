// «유튜브 채널 주소를 복사해도 영상 1개만» 검사 (사장님 지시 2026-10-20)
//   실행: node scripts/test-channel-one.js   — 네트워크·유튜브 요청 없음(인자·판정만 본다)
//   ⚠️ 샤오홍슈·인스타·틱톡·X 는 한 게시물에 영상이 여러 개일 수 있어 «1개만» 을 걸면 안 된다.
const ytdlp = require('../src/main/ytdlp');

let fail = 0;
const check = (name, ok) => { console.log(`${ok ? '✅' : '❌'} ${name}`); if (!ok) fail++; };

// 1) 미리보기: 채널을 물으면 yt-dlp 는 목록을 준다 → 첫 영상으로 풀어야 한다
const playlist = { _type: 'playlist', title: 'AI 사업일지', entries: [{ id: 'abc', title: '첫 영상' }, { id: 'def', title: '둘째' }] };
check('목록 → 첫 영상으로 바뀐다', ytdlp.firstEntry(playlist).id === 'abc');
check('일반 영상은 그대로', ytdlp.firstEntry({ id: 'x', title: '영상' }).id === 'x');
check('빈 목록은 그대로(에러 안 냄)', ytdlp.firstEntry({ _type: 'playlist', entries: [] })._type === 'playlist');

// 2) 받기 인자
const has1 = (args) => { const i = args.indexOf('--playlist-items'); return i >= 0 && args[i + 1] === '1'; };
const build = (url, playlist = false) => ytdlp._buildArgs({ url, outputDir: '.', mode: 'video', playlist }, '.');
for (const url of [
  'https://www.youtube.com/@AIBizPT/videos',
  'https://www.youtube.com/@%EC%8B%9C%EC%84%A0_SEESUN/shorts',
  'https://www.youtube.com/channel/UCLbgiRyNR6lEb8fNROWRBQQ',
  'https://www.youtube.com/playlist?list=PL123',
]) check(`유튜브 채널·재생목록 → 1개만 : ${url}`, has1(build(url)));
for (const url of [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://www.youtube.com/shorts/WSF7yVL4LKU',
  'https://www.xiaohongshu.com/explore/66b1c2d3000000001e01a2b3?xsec_token=AB',
  'http://xhslink.com/a/AbC123xYz',
  'https://www.instagram.com/p/ABC123/',
  'https://www.tiktok.com/@user/video/7412345678901234567',
  'https://x.com/user/status/1234567890',
  'https://www.douyin.com/video/7412345678901234567',
]) check(`그 밖의 주소는 예전 그대로(1개 제한 없음) : ${url}`, !has1(build(url)));
check('재생목록 모드를 켜면 전체', (() => { const a = build('https://www.youtube.com/playlist?list=PL1', true); return a.includes('--yes-playlist') && !has1(a); })());

console.log(fail ? `\n실패 ${fail}건` : '\n모두 통과');
process.exit(fail ? 1 : 0);
