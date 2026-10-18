// «링크를 복사하면 바로 받기» 판정 검사 — 샤오홍슈·더우인 공유 문구까지 잡는지 확인
//   실행: npx electron scripts/test-clipboard-link.js
//   1) extractVideoUrl 판정표  2) 실제 클립보드에 써 넣고 감시기가 렌더러로 보내는 값 확인
//   (검사 전 클립보드 내용은 끝나면 되돌린다)
const { app, clipboard } = require('electron');
const bridge = require('../src/main/bridge');
const ytdlp = require('../src/main/ytdlp');

const XHS_WEB = 'https://www.xiaohongshu.com/explore/66b1c2d3000000001e01a2b3?xsec_token=ABcDeF12_gH-ij34KLmn=&xsec_source=pc_share';
const REDNOTE = 'https://www.rednote.com/explore/66b1c2d3000000001e01a2b3?xsec_token=ABcDeF12_gH-ij34KLmn=&xsec_source=pc_share';

const CASES = [
  // [이름, 복사한 글, 기대값(null = 무시)]
  ['샤오홍슈 웹 «링크 복사»(순수 링크)', XHS_WEB, XHS_WEB],
  ['샤오홍슈 앱 공유 문구', '【여름 원피스 추천】 小红书号 12345 http://xhslink.com/a/AbC123xYz，复制本条信息，打开【小红书】App查看精彩内容！', 'http://xhslink.com/a/AbC123xYz'],
  ['샤오홍슈 웹 공유 문구(제목+링크)', '夏天必备好物分享 ' + XHS_WEB + ' 复制后打开【小红书】查看笔记！', XHS_WEB],
  ['rednote 링크', REDNOTE, REDNOTE],
  ['더우인 앱 공유 문구', '7.43 复制打开抖音，看看【某某的作品】夏日穿搭 # 原创 https://v.douyin.com/iRNBho6u/ xyz:/ 01/12 Fbg:/', 'https://v.douyin.com/iRNBho6u/'],
  ['더우인 웹 링크', 'https://www.douyin.com/video/7412345678901234567', 'https://www.douyin.com/video/7412345678901234567'],
  ['유튜브 순수 링크(기존 동작)', 'https://youtu.be/dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ'],
  ['문장 끝 마침표 붙은 링크', '이거 봐 https://www.youtube.com/shorts/abc123.', 'https://www.youtube.com/shorts/abc123'],
  ['관련 없는 글', '오늘 회의는 3시에 합니다. 자료는 메일로 보낼게요.', null],
  ['영상 사이트 아닌 링크', '참고: https://www.google.com/search?q=piggy', null],
  ['링크 없는 중국어 글', '复制本条信息，打开【小红书】App查看精彩内容！', null],
  ['긴 문서 속 링크(2000자 초과)', 'ㄱ'.repeat(2100) + ' https://youtu.be/dQw4w9WgXcQ', null],
];

let fail = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}\n       → ${got}${ok ? '' : `\n       기대 ${want}`}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  console.log('── 1) extractVideoUrl 판정 ──');
  for (const [name, text, want] of CASES) check(name, bridge.extractVideoUrl(text), want);

  console.log('\n── 2) rednote → xiaohongshu 변환 후에도 xsec_token 유지 ──');
  const canon = ytdlp.canonicalRednoteUrl(bridge.extractVideoUrl(REDNOTE));
  check('rednote 변환', canon, XHS_WEB);
  check('샤오홍슈 링크는 변환해도 그대로', ytdlp.canonicalRednoteUrl(XHS_WEB), XHS_WEB);

  console.log('\n── 3) 실제 클립보드 감시기 → 렌더러로 보내는 값 ──');
  const saved = clipboard.readText();
  const sent = [];
  const fakeWin = { isDestroyed: () => false, webContents: { send: (ch, v) => sent.push([ch, v]) } };
  const stop = bridge.startClipboardWatch(() => fakeWin, 100);
  try {
    for (const [name, text, want] of CASES) {
      sent.length = 0;
      clipboard.writeText(text);
      await sleep(300);
      const got = sent.length ? sent[sent.length - 1] : null;
      if (got && got[0] !== 'clipboard:url') { fail++; console.log('FAIL 채널 이름', got[0]); }
      check('[클립보드] ' + name, got ? got[1] : null, want);
    }
  } finally {
    stop();
    clipboard.writeText(saved);
  }

  console.log(fail ? `\n❌ 실패 ${fail}건` : '\n✅ 전부 통과');
  app.exit(fail ? 1 : 0);
});
