/**
 * scripts/diag-resolvers.js — 🔁 «막힐 때 우회» 가 **어디에 걸리고 어디에 안 걸리는지** 시험한다.
 *
 *   node scripts/diag-resolvers.js
 *
 * 왜 필요한가 (2026-09-19)
 *   우회 대상이 인스타 하나에서 넷(인스타·페북·틱톡·X)으로 늘었다.
 *   정규식이 넓어지면 **엉뚱한 사이트를 먹는다.** 그게 제일 무서운 회귀다 —
 *   유튜브가 우회로 새면 화질 목록을 잃고(우회는 formats=[]) 최고화질 정책이 조용히 깨진다.
 *   오류는 한 줄도 안 난다. 그래서 «안 걸려야 하는 것» 을 «걸려야 하는 것» 만큼 시험한다.
 *
 * ⚠️ 여기서는 네트워크를 쓰지 않는다. 판정(어느 길로 갈까)만 본다.
 *   실제 다운로드가 되는지는 링크를 받아 따로 잰다.
 */
'use strict';

const r = require('../src/main/resolvers');

let bad = 0;
const ok = (c, m) => { console.log((c ? '  o  ' : '  X  ') + m); if (!c) bad++; };
const head = (s) => console.log('\n' + s);

/** [url, 기대하는 site key 또는 null, 바로우회(always)여야 하는가] */
const 표 = [
  // ── 인스타 — 늘 막히는 곳이라 «바로 우회» 여야 한다(기존 동작 유지)
  ['https://www.instagram.com/reel/DM3xAbCdEfG/', 'instagram', true],
  ['https://www.instagram.com/p/C51YHfWJwHK/', 'instagram', true],
  ['https://instagram.com/tv/ABC123/', 'instagram', true],
  ['https://www.instagram.com/share/reel/_xyz123/', 'instagram', true],

  // ── 페이스북 — yt-dlp 먼저, 막히면 우회(폴백)
  ['https://www.facebook.com/watch/?v=1234567890', 'facebook', false],
  ['https://fb.watch/abcDEF123/', 'facebook', false],
  ['https://web.facebook.com/someone/videos/9876543210/', 'facebook', false],
  ['https://m.facebook.com/reel/1122334455', 'facebook', false],

  // ── 틱톡 — vm./vt. 공유 단축이 제일 흔하게 들어온다
  ['https://www.tiktok.com/@someone/video/7123456789012345678', 'tiktok', false],
  ['https://vm.tiktok.com/ZMabcdefg/', 'tiktok', false],
  ['https://vt.tiktok.com/ZSabcdefg/', 'tiktok', false],
  ['https://www.tiktok.com/@u/photo/7123456789012345678', 'tiktok', false],

  // ── X(트위터)
  ['https://x.com/someone/status/1234567890123456789', 'twitter', false],
  ['https://twitter.com/someone/status/1234567890123456789', 'twitter', false],
  ['https://mobile.twitter.com/u/status/1234567890123456789', 'twitter', false],

  /* ── 🚨 여기부터는 «안 걸려야» 한다. 걸리면 조용한 회귀다. ── */
  ['https://www.youtube.com/watch?v=jNQXAC9IVRw', null, false],
  ['https://youtu.be/jNQXAC9IVRw', null, false],
  ['https://www.youtube.com/shorts/abcdefghijk', null, false],
  // 샤오홍슈·rednote 는 yt-dlp 가 처리한다(canonicalRednoteUrl 로 호스트만 바꿔서)
  ['https://www.xiaohongshu.com/explore/1234567890abcdef', null, false],
  ['https://www.rednote.com/explore/1234567890abcdef', null, false],
  ['https://xhslink.com/aBcDeF', null, false],
  // 스레드는 전용 리졸버(threads.js)가 따로 있다 — 여기 걸리면 그쪽이 안 돈다
  ['https://www.threads.net/@someone/post/ABC123', null, false],
  ['https://www.threads.com/@someone/post/ABC123', null, false],
  // 남의 도메인에 이름만 들어간 경우 — 넓은 정규식이 흔히 먹는 모양
  ['https://notfacebook.example.com/watch?v=1', null, false],
  ['https://example.com/?ref=tiktok.com', null, false],
];

head('[1] 🎯 어느 길로 가는가 (siteOf / shouldResolve)');
for (const [url, 기대, always] of 표) {
  const s = r.siteOf(url);
  const 실제 = s ? s.key : null;
  const 짧게 = url.length > 52 ? url.slice(0, 52) + '…' : url;
  ok(실제 === 기대, `${기대 === null ? '안 걸림' : 기대.padEnd(9)} ← ${짧게}${실제 === 기대 ? '' : `   (실제: ${실제})`}`);
  if (기대) ok(r.shouldResolve(url) === always,
    `   └ ${always ? '바로 우회' : '폴백(yt-dlp 먼저)'} — shouldResolve=${r.shouldResolve(url)}`);
}

head('[2] 🔁 canResolve 는 «우회할 수 있는 넷» 전부를 잡는가');
{
  ok(r.canResolve('https://www.instagram.com/reel/AB/') === true, '인스타');
  ok(r.canResolve('https://fb.watch/xy/') === true, '페이스북');
  ok(r.canResolve('https://vm.tiktok.com/Z1/') === true, '틱톡');
  ok(r.canResolve('https://x.com/u/status/1') === true, 'X');
  ok(r.canResolve('https://www.youtube.com/watch?v=a') === false, '유튜브는 아니다');
  ok(r.canResolve('https://www.threads.net/@u/post/A') === false, '스레드는 아니다');
}

head('[3] 🏷 파일명에 쓸 id 와 라벨 — «Instagram» 이 박혀 있지 않은가');
{
  ok(r.mediaId('https://www.instagram.com/reel/DM3xAbCdEfG/') === 'DM3xAbCdEfG', '인스타 shortcode');
  ok(r.mediaId('https://www.tiktok.com/@u/video/7123456789012345678') === '7123456789012345678', '틱톡 video id');
  ok(r.mediaId('https://x.com/u/status/1234567890123456789') === '1234567890123456789', 'X status id');
  ok(r.mediaId('https://www.facebook.com/u/videos/9876543210/') === '9876543210', '페북 video id');
  // 못 뽑아도 «던지지» 않아야 한다 — 파일명 하나 때문에 다운로드가 죽으면 안 된다
  ok(r.mediaId('https://vm.tiktok.com/ZMabcdefg/') === null, '단축 링크는 id 가 없다(null, 안 던짐)');
  ok(r.mediaId('https://www.youtube.com/watch?v=a') === null, '대상이 아니면 null');
  // 라벨이 사이트마다 달라야 파일명이 「Instagram 7123…」 이 되지 않는다
  const 라벨 = r.SITES.map((s) => s.label);
  ok(new Set(라벨).size === 라벨.length, `라벨이 서로 다르다 (${라벨.join(' · ')})`);
}

head('[4] 🔒 바로 우회는 «인스타 하나» 뿐인가 (폴백이 앞질러 가지 않게)');
{
  const 바로 = r.SITES.filter((s) => s.always).map((s) => s.key);
  ok(바로.length === 1 && 바로[0] === 'instagram',
    `바로 우회 = ${바로.join(',') || '(없음)'} — 나머지는 yt-dlp 를 먼저 쓴다`);
}

console.log(bad
  ? `\n❌ ${bad}건 어긋났습니다 — 우회가 엉뚱한 곳으로 가거나 가야 할 곳에 안 갑니다.\n`
  : '\n=== 전부 통과 (우회가 갈 곳에만 갑니다) ===\n');
process.exit(bad ? 1 : 0);
