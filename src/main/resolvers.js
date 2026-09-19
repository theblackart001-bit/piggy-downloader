'use strict';

/**
 * 외부 리졸버(snapsave) — yt-dlp 순정으로는 로그인 쿠키가 없으면 막히는 사이트를
 * 로그인 없이 직접 미디어 URL로 해석한다.
 *
 * ## 2026-09-19 — 인스타 «하나»에서 네 곳으로 넓혔다
 *   사장님 지시: SB Downloader 의 «받는 경로(막힐 때 우회)» 를 Piggy 에도 옮길 것.
 *   snapsave.app 은 Instagram · Facebook · TikTok · Twitter(X) 를 받아 준다
 *   (snapsave-media-downloader 2.4.0 — 이미 의존성에 있다. 새로 깔 것이 없다).
 *
 * ## ⚠️ 넷을 «같은 자»로 다루지 않는다 — 여기가 이 파일의 핵심이다
 *   · 인스타는 공개 릴스조차 yt-dlp 가 «empty media response» 로 **늘** 막는다
 *     → 시도할 것도 없이 처음부터 우회한다(`always: true`).
 *   · 나머지 셋은 yt-dlp 가 **대체로 된다.** 그때는 화질 목록·길이·업로더가 제대로 오는데,
 *     우회로 가면 `formats: []` 라 그 정보를 **잃는다**(최고화질 고정 정책과도 어긋난다).
 *     → **막혔을 때만** 우회한다(폴백).
 *
 *   즉 «우회할 수 있다»와 «지금 우회해야 한다»는 **다른 질문**이다.
 *   그래서 함수를 갈라 뒀다 — `canResolve()` 와 `shouldResolve()`.
 *   한 함수로 합치면 셋 중 하나가 반드시 틀린 답을 받는다.
 */

/**
 * 우회할 수 있는 사이트들.
 * @property {boolean} always yt-dlp 가 늘 막히는 곳인가(=바로 우회). false 면 폴백 전용.
 * @property {RegExp}  idRe   파일명·표시에 쓸 id 를 뽑는 자리(없으면 null 로 두면 된다).
 */
const SITES = [
  {
    key: 'instagram',
    label: 'Instagram',
    re: /instagram\.com|instagr\.am/i,
    always: true,
    idRe: /instagram\.com\/(?:reels?|p|tv|share\/reel)\/([A-Za-z0-9_-]+)/i,
  },
  {
    key: 'facebook',
    label: 'Facebook',
    // fb.watch 단축과 web./m. 모바일 호스트까지 — 사람이 실제로 복사해 오는 모양들이다.
    re: /(^|\/\/)(www\.|web\.|m\.|business\.)?facebook\.com\/|(^|\/\/)fb\.watch\//i,
    always: false,
    idRe: /(?:\/videos?\/|\/reel\/|[?&]v=)(\d{6,})/i,
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    // vm./vt. 는 공유 단축 링크다 — 이게 제일 흔하게 들어온다.
    re: /(^|\/\/)(www\.|vm\.|vt\.|m\.)?tiktok\.com\//i,
    always: false,
    idRe: /\/(?:video|photo)\/(\d{6,})/i,
  },
  {
    key: 'twitter',
    label: 'X',
    re: /(^|\/\/)(www\.|mobile\.)?(twitter\.com|x\.com)\//i,
    always: false,
    idRe: /\/status(?:es)?\/(\d{6,})/i,
  },
];

/** 이 URL 이 어느 사이트인가 (아니면 null) */
function siteOf(url) {
  const u = String(url || '');
  return SITES.find((s) => s.re.test(u)) || null;
}

/**
 * **처음부터** 우회로 가야 하는가 — yt-dlp 가 늘 막히는 곳(현재 인스타)만 참.
 * ⚠️ 이름을 바꾸지 않았다. ytdlp.js 세 군데가 이 뜻 그대로 쓰고 있다.
 */
function shouldResolve(url) {
  const s = siteOf(url);
  return !!s && s.always === true;
}

/**
 * **막혔을 때** 우회를 시도해 볼 수 있는가 — 네 사이트 전부 참.
 * yt-dlp 가 실패한 뒤에만 묻는 질문이다(폴백).
 */
function canResolve(url) {
  return !!siteOf(url);
}

/** URL 에서 id 를 뽑는다(파일명·표시용). 못 뽑으면 null — 던지지 않는다. */
function mediaId(url) {
  const s = siteOf(url);
  if (!s || !s.idRe) return null;
  const m = String(url || '').match(s.idRe);
  return m ? m[1] : null;
}

/** 옛 이름 — 인스타 전용으로 쓰던 자리가 남아 있어 그대로 둔다. */
function instagramShortcode(url) {
  const m = String(url || '').match(SITES[0].idRe);
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
 * @returns {Promise<{site:string, label:string, shortcode:string|null, caption:string,
 *                    directUrl:string, thumbnail:string|null, type:string, count:number}>}
 */
async function resolve(url) {
  const site = siteOf(url);
  const snapsave = await getSnapsave();
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await snapsave(url);
      const media = r && r.success && r.data && Array.isArray(r.data.media) ? r.data.media : [];
      const picked = media.find((m) => m && m.type === 'video' && m.url) || media.find((m) => m && m.url);
      if (picked && picked.url) {
        // 글 내용(캡션)을 파일명으로 쓴다 — 'Instagram DM3x...' 는 나중에 뭐가 뭔지 모른다.
        // snapsave 응답의 키 이름이 버전마다 달라서 있을 만한 곳을 순서대로 본다.
        const cap = r.data.description || r.data.title || r.data.caption || '';
        return {
          site: site ? site.key : 'unknown',
          label: site ? site.label : 'Media',
          shortcode: mediaId(url),
          caption: String(cap).replace(/\s+/g, ' ').trim(),
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
  /* ⚠️ 안내 문구에 **사이트 이름을 넣는다.** 넷을 한 문구로 뭉뚱그리면
       틱톡을 받다 실패한 사람이 「인스타그램 미디어를 찾을 수 없습니다」를 읽는다. */
  const 이름 = site ? site.label : '미디어';
  const err = new Error(
    `${이름} 미디어를 찾을 수 없습니다 (비공개·삭제된 게시물·잘못된 링크). 공개 게시물 링크인지 확인하세요.`
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
  const id = meta.shortcode || meta.site || 'media';
  // 캡션이 있으면 그게 제목이다(미리보기·파일명 모두 여기서 나온다).
  const cap = (meta.caption || '').slice(0, 120);
  return {
    id,
    title: cap || `${meta.label} ${id}`,
    uploader: meta.label,
    duration: null,
    duration_string: '',
    thumbnail: meta.thumbnail,
    extractor_key: `${meta.label}SnapSave`,
    extractor: `${meta.site}:snapsave`,
    _type: 'video',
    webpage_url: url,
    formats: [],
    _resolved: meta,
  };
}

module.exports = {
  SITES,
  siteOf,
  shouldResolve,
  canResolve,
  mediaId,
  resolve,
  getInfoLike,
  instagramShortcode,
};
