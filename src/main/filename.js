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

module.exports = { safeName };
