'use strict';

/**
 * 파일·폴더 이름 만들기 (윈도우 기준).
 *
 * 왜 따로 뺐나 — 예전엔 ytdlp.js 와 threads.js 가 각자 safe() 를 갖고 있었다.
 * ytdlp.js 쪽만 고쳤더니 폴더를 만드는 threads.js 는 그대로라 버그가 남았다.
 * 규칙은 한 곳에만 둔다.
 *
 * ⚠️ 윈도우는 이름 **끝의 마침표·공백을 조용히 잘라낸다.**
 *    "제목.." 으로 만들라고 해도 실제로는 "제목" 이 되는데,
 *    프로그램은 "제목.." 으로 알고 있어서 경로가 어긋난다
 *    → 탐색기로 열지도 지우지도 못하는 항목이 남는다.
 *    (실제 발생: "…어떻게 했어요.." 폴더)
 *    자르기(slice) 뒤에 다시 정리해야 한다 — 자르다가 끝이 마침표가 될 수 있어서.
 */

/** 윈도우 파일명에 못 쓰는 문자 */
const FORBIDDEN = /[\\/:*?"<>|]/g;
/** 이름 앞뒤의 마침표·공백 (앞의 마침표는 숨김파일로 잡힌다) */
const EDGE_DOTS = /^[.\s]+|[.\s]+$/g;
/** 제어문자 — 파일명에 들어가면 탐색기가 이상하게 군다 */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1f]/g;

/** 윈도우가 통째로 예약해 둔 이름. 이대로 만들면 만들어지지 않는다. */
const RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

const DEFAULT_MAX = 120;

/**
 * 제목을 안전한 파일·폴더 이름으로 바꾼다.
 * 못 쓸 이름이면 빈 문자열을 돌려준다 — 부르는 쪽에서 대체 이름을 쓰라는 뜻이다.
 *
 * @param {string} raw   원래 제목
 * @param {number} max   최대 길이(글자 수). 윈도우 경로 길이 제한을 피하려고 짧게 잡는다.
 * @returns {string}
 */
function safeName(raw, max = DEFAULT_MAX) {
  const cleaned = String(raw || '')
    .replace(CONTROL, ' ')
    .replace(FORBIDDEN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(EDGE_DOTS, '')
    .trim();

  if (!cleaned) return '';
  // NUL.mp4 도 예약어에 걸린다 → 확장자를 떼고 본다.
  const stem = cleaned.split('.')[0].toUpperCase();
  return RESERVED.has(stem) ? `_${cleaned}` : cleaned;
}

/**
 * 인스타 «제목» 고르기 (사장님 지시 2026-10-19: "피기 다운로더 받을 때 영상 제목으로 다운로드 받게").
 * 쿠키를 등록한 사람은 인스타도 yt-dlp 로 받는데, yt-dlp 가 주는 인스타 제목은 늘 «Video by 계정명» 이라
 * 파일이 `Video by chae2home.mp4` 로 쌓였다(유튜브·틱톡은 이미 제목 그대로). 인스타의 «제목» 은 게시물
 * 글(캡션)이다 — 첫 줄(비어 있지 않은 줄)을 쓴다. 캡션이 없으면 원래 제목을 그대로 돌려준다.
 * @param {string} title        yt-dlp 가 준 제목
 * @param {string} description  게시물 글(캡션)
 * @returns {string}
 */
function captionTitle(title, description) {
  const t = String(title || '').trim();
  if (!/^(video|photo|post) by /i.test(t)) return t;
  /* 첫 줄만 쓰면 같은 계정 게시물이 전부 같은 이름이 된다 — 실측(2026-10-20): 첫 줄이 «♥️댓글에 나도 남겨주세요😉»
       같은 계정 공통 문구였다. 줄들을 이어 앞 80자를 쓴다(틱톡도 캡션 전체를 이름으로 쓴다). */
  const joined = String(description || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(' ');
  return joined ? joined.slice(0, 80).trim() : t;
}

/** 인스타 파일명 — 캡션이 없어 아직 «Video by 계정명» 이면 게시물 코드(yt-dlp %(id)s)를 붙여
 *  같은 계정 영상끼리 구분한다(사장님 지시 2026-10-20: "같은 채널에서 여러 개 받아도 구분할 수 있게"). */
function 인스타이름(title) {
  if (!title) return '%(title).120B %(id)s';
  return /^(video|photo|post) by /i.test(title) ? `${title} %(id)s` : title;
}

const 받은확장자 = ['mp4', 'webm', 'mkv', 'mov', 'm4a', 'mp3', 'opus', 'jpg', 'png'];
/** 같은 이름의 파일이 이미 있으면 « (2)» · « (3)» … 을 붙인다 — 이름이 겹치면 yt-dlp 는 «이미 받았다» 며
 *  두 번째 영상을 조용히 건너뛴다. yt-dlp 틀(%(…)s)이 든 이름은 미리 알 수 없어 그대로 둔다(그건 %(id)s 로 이미 구분된다). */
function 겹치지않게(dir, base) {
  if (!dir || !base || base.includes('%(')) return base;
  const fs = require('fs');
  const path = require('path');
  const 있나 = (b) => 받은확장자.some((e) => fs.existsSync(path.join(dir, `${b}.${e}`)));
  if (!있나(base)) return base;
  for (let i = 2; i < 1000; i++) if (!있나(`${base} (${i})`)) return `${base} (${i})`;
  return `${base} (${Date.now()})`;
}

module.exports = { safeName, captionTitle, 인스타이름, 겹치지않게 };
