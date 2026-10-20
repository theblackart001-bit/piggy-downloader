// «유튜브 채널 링크는 받지 않고, 개별 영상 링크는 예전 그대로» 검사 (사장님 지시 2026-10-20)
//   실행: node scripts/test-channel-one.js   — 유튜브에 요청을 보내지 않는다(채널은 조회 전에 막히므로)
const ytdlp = require('../src/main/ytdlp');

let fail = 0;
const check = (name, ok) => { console.log(`${ok ? '✅' : '❌'} ${name}`); if (!ok) fail++; };

const CHANNEL = [
  'https://www.youtube.com/@AIBizPT/videos',
  'https://www.youtube.com/@%EC%8B%9C%EC%84%A0_SEESUN/shorts',
  'https://www.youtube.com/@timetotalkstudio',
  'https://www.youtube.com/channel/UCLbgiRyNR6lEb8fNROWRBQQ',
  'https://m.youtube.com/@AIBizPT',
  'https://www.youtube.com/playlist?list=PL123',
];
const SINGLE = [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123',
  'https://youtu.be/dQw4w9WgXcQ',
  'https://www.youtube.com/shorts/WSF7yVL4LKU',
  'https://www.xiaohongshu.com/explore/66b1c2d3000000001e01a2b3?xsec_token=AB',
  'http://xhslink.com/a/AbC123xYz',
  'https://www.instagram.com/reel/ABC123/',
  'https://www.tiktok.com/@user/video/7412345678901234567',
  'https://www.douyin.com/video/7412345678901234567',
];

(async () => {
  for (const url of CHANNEL) {
    check(`채널 판정 : ${url}`, ytdlp.isYoutubeListUrl(url));
    let err = null;
    try { await ytdlp.getInfo(url, {}); } catch (e) { err = e; }
    check(`  → 조회하지 않고 안내 문구로 거절`, err && err.code === 'CHANNEL_URL' && err.message === ytdlp.CHANNEL_URL_MESSAGE);
    let derr = null;
    try { await ytdlp.download({ url, outputDir: '.', mode: 'video' }, () => {}); } catch (e) { derr = e; }
    check(`  → 받기도 거절`, derr && derr.code === 'CHANNEL_URL');
  }
  for (const url of SINGLE) {
    check(`개별 링크는 채널 아님(예전처럼 받음) : ${url}`, !ytdlp.isYoutubeListUrl(url));
    const args = ytdlp._buildArgs({ url, outputDir: '.', mode: 'video', playlist: false }, '.');
    check(`  → 받기 인자에 1개 제한 같은 새 옵션 없음`, !args.includes('--playlist-items'));
  }
  console.log(fail ? `\n실패 ${fail}건` : '\n모두 통과');
  process.exit(fail ? 1 : 0);
})();
