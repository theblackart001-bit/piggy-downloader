'use strict';

/**
 * 외부 리졸버(snapsave) — yt-dlp 순정으로는 로그인 쿠키가 없으면 막히는 사이트를
 * 로그인 없이 직접 미디어 URL로 해석한다. (현재: 인스타그램)
 *
 * 배경: 인스타는 공개 릴스/게시물도 'empty media response'로 yt-dlp를 막는다.
 * saveclip/snapsave 류 서비스는 자체 세션으로 직접 MP4 링크(rapidcdn 프록시)를 뽑아준다.
 * Piggy는 인스타 URL이면 이 경로로 직접 링크를 받아 yt-dlp에 넘겨 다운로드한다.
 */

const INSTAGRAM_RE = /instagram\.com|instagr\.am/i;

/** 이 URL을 외부 리졸버로 처리해야 하는가 (현재 인스타그램만) */
function shouldResolve(url) {
  return INSTAGRAM_RE.test(String(url || ''));
}

/** 인스타 URL에서 shortcode 추출 (파일명·표시용) */
function instagramShortcode(url) {
  const m = String(url || '').match(/instagram\.com\/(?:reels?|p|tv|share\/reel)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

let _snapsave = null;
async function getSnapsave() {
  if (!_snapsave) {
    // ESM 패키지를 CommonJS에서 동적 import
    const mod = await import('snapsave-media-downloader');
    _snapsave = mod.snapsave;
  }
  return _snapsave;
}

/**
 * 직접 미디어 URL + 메타로 해석. 비디오 우선, 없으면 첫 미디어.
 * 일시적 실패 대비 1회 재시도.
 * @returns {Promise<{shortcode:string|null, directUrl:string, thumbnail:string|null, type:string, count:number}>}
 */
async function resolve(url) {
  const snapsave = await getSnapsave();
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await snapsave(url);
      const media = r && r.success && r.data && Array.isArray(r.data.media) ? r.data.media : [];
      const picked = media.find((m) => m && m.type === 'video' && m.url) || media.find((m) => m && m.url);
      if (picked && picked.url) {
        return {
          shortcode: instagramShortcode(url),
          directUrl: picked.url,
          thumbnail: picked.thumbnail || (media.find((m) => m && m.thumbnail) || {}).thumbnail || null,
          type: picked.type || 'video',
          count: media.length,
        };
      }
      last = new Error('SNAPSAVE_EMPTY');
    } catch (e) {
      last = e;
    }
  }
  const err = new Error(
    '인스타그램 미디어를 찾을 수 없습니다 (비공개 계정·삭제된 게시물·잘못된 링크). 공개 릴스/게시물 링크인지 확인하세요.'
  );
  err.resolverEmpty = true;
  err.cause = last;
  throw err;
}

/**
 * yt-dlp `-J` 결과 형태로 흉내낸 info (main.js pickInfo 호환).
 * 화질 목록은 알 수 없어 formats=[] → UI는 '최고화질' 고정 정책과 부합.
 */
async function getInfoLike(url) {
  const meta = await resolve(url);
  const sc = meta.shortcode || 'instagram';
  return {
    id: sc,
    title: `Instagram ${sc}`,
    uploader: 'Instagram',
    duration: null,
    duration_string: '',
    thumbnail: meta.thumbnail,
    extractor_key: 'InstagramSnapSave',
    extractor: 'instagram:snapsave',
    _type: 'video',
    webpage_url: url,
    formats: [],
    _resolved: meta,
  };
}

module.exports = { shouldResolve, resolve, getInfoLike, instagramShortcode };
