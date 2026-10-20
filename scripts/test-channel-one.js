// «채널 주소를 복사해도 영상 1개만» 검사 (사장님 지시 2026-10-20)
//   실행: node scripts/test-channel-one.js   — 네트워크·유튜브 요청 없음(인자·판정만 본다)
const ytdlp = require('../src/main/ytdlp');

let fail = 0;
const check = (name, ok) => { console.log(`${ok ? '✅' : '❌'} ${name}`); if (!ok) fail++; };

// 1) 미리보기: 채널을 물으면 yt-dlp 는 목록을 준다 → 첫 영상으로 풀어야 한다
const playlist = { _type: 'playlist', title: 'AI 사업일지', entries: [{ id: 'abc', title: '첫 영상' }, { id: 'def', title: '둘째' }] };
check('목록 → 첫 영상으로 바뀐다', ytdlp.firstEntry(playlist).id === 'abc');
check('일반 영상은 그대로', ytdlp.firstEntry({ id: 'x', title: '영상' }).id === 'x');
check('빈 목록은 그대로(에러 안 냄)', ytdlp.firstEntry({ _type: 'playlist', entries: [] })._type === 'playlist');

// 2) 받기 인자: 재생목록 모드가 아니면 언제나 «1개만»
const has1 = (args) => { const i = args.indexOf('--playlist-items'); return i >= 0 && args[i + 1] === '1'; };
for (const url of [
  'https://www.youtube.com/@AIBizPT/videos',
  'https://www.youtube.com/@%EC%8B%9C%EC%84%A0_SEESUN/shorts',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
]) {
  const args = ytdlp._buildArgs({ url, outputDir: '.', mode: 'video', playlist: false }, '.');
  check(`받기 인자에 --playlist-items 1 : ${url}`, has1(args) && !args.includes('--yes-playlist'));
}
const plArgs = ytdlp._buildArgs({ url: 'https://www.youtube.com/playlist?list=PL1', outputDir: '.', mode: 'video', playlist: true }, '.');
check('재생목록 모드를 켜면 전체(1개 제한 없음)', plArgs.includes('--yes-playlist') && !has1(plArgs));

console.log(fail ? `\n실패 ${fail}건` : '\n모두 통과');
process.exit(fail ? 1 : 0);
