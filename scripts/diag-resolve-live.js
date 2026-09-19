/**
 * scripts/diag-resolve-live.js — 🌐 우회가 **실제로 미디어 URL을 뽑아 오는지** 잰다(네트워크 사용).
 *
 *   node scripts/diag-resolve-live.js <url> [url2 ...]
 *   (인자 없이 돌리면 아래 기본 표본을 쓴다)
 *
 * diag-resolvers.js 는 «어느 길로 갈까» 만 본다(네트워크 없음).
 * 이 파일은 그 길 끝에 실제로 파일이 있는지 본다 — 둘은 다른 질문이다.
 *
 * ⚠️ 받지는 않는다. 직접 URL 이 나오는지까지만 확인하고 끝낸다
 *   (사장님 디스크에 시험 파일을 흘리지 않는다).
 */
'use strict';

const r = require('../src/main/resolvers');

// 기본 표본: snapsave 패키지 README 에 실린 공개 게시물.
const 기본 = ['https://www.instagram.com/p/C51YHfWJwHK/'];

const urls = process.argv.slice(2).filter(Boolean);
const 대상 = urls.length ? urls : 기본;

(async () => {
  console.log(`🌐 우회 실측 — ${대상.length}건\n`);
  let 성공 = 0;
  for (const url of 대상) {
    const site = r.siteOf(url);
    const 이름 = site ? site.label : '(대상 아님)';
    const 길 = !site ? 'yt-dlp 전담' : site.always ? '바로 우회' : '폴백(yt-dlp 먼저)';
    console.log(`── ${이름}  [${길}]`);
    console.log(`   ${url}`);
    if (!site) { console.log('   ⏭  우회 대상이 아닙니다 — yt-dlp 가 처리합니다\n'); continue; }
    const t0 = Date.now();
    try {
      const meta = await r.resolve(url);
      const 초 = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`   ✅ ${초}초 · type=${meta.type} · 미디어 ${meta.count}개`);
      console.log(`      id=${meta.shortcode || '(없음)'} · label=${meta.label}`);
      console.log(`      제목: ${meta.caption ? meta.caption.slice(0, 60) : '(캡션 없음)'}`);
      console.log(`      직접URL: ${String(meta.directUrl).slice(0, 80)}…`);
      성공++;
    } catch (e) {
      const 초 = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`   ❌ ${초}초 · ${e.message}`);
      if (e.cause) console.log(`      속사정: ${e.cause.message}`);
    }
    console.log('');
  }
  console.log(`${성공}/${대상.length} 성공`);
  /* ⚠️ `process.exit()` 를 쓰지 않는다 — snapsave 가 아직 붙잡고 있는 핸들이 있어서
       윈도우에서 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` 로 끝난다.
       결과는 멀쩡한데 마지막 줄이 빨간 글씨라 «실패했다» 로 읽힌다(실제로 그렇게 보였다).
       종료 코드만 정해 두고 이벤트 루프가 스스로 비도록 둔다. */
  process.exitCode = 성공 === 대상.length ? 0 : 1;
})();
