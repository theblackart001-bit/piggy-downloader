'use strict';

/* ============ 상태 ============ */
const state = {
  settings: null,
  mode: 'video',
  pendingInfo: null, // 불러온 미리보기 정보
  items: new Map(), // id -> { el, info, status }
  seq: 0,
  lastAutoUrl: '', // 복사 감지로 이미 받은 링크(같은 걸 반복해서 받지 않게)
};

const $ = (sel) => document.querySelector(sel);

const els = {
  url: $('#urlInput'),
  paste: $('#pasteBtn'),
  transcribe: $('#transcribeBtn'),
  fetch: $('#fetchBtn'),
  modeSeg: $('#modeSeg'),
  qualityGroup: $('#qualityGroup'),
  subs: $('#subsCheck'),
  autoDl: $('#autoDlCheck'),
  preview: $('#preview'),
  previewThumb: $('#previewThumb'),
  previewTitle: $('#previewTitle'),
  previewUploader: $('#previewUploader'),
  previewDuration: $('#previewDuration'),
  previewSite: $('#previewSite'),
  add: $('#addBtn'),
  fetchStatus: $('#fetchStatus'),
  queue: $('#queue'),
  queueCount: $('#queueCount'),
  emptyState: $('#emptyState'),
  clearDone: $('#clearDoneBtn'),
  stopAll: $('#stopAllBtn'),
  theme: $('#themeBtn'),
  folder: $('#folderBtn'),
  folderLabel: $('#folderLabel'),
  status: $('#statusText'),
  ytdlpInfo: $('#ytdlpInfo'),
  appVersion: $('#appVersion'),
  tpl: $('#queueItemTpl'),
  // ✂️ 구간
  askSave: $('#askSaveCheck'),
  sectionCheck: $('#sectionCheck'),
  sectionInputs: $('#sectionInputs'),
  secStart: $('#secStart'),
  secEnd: $('#secEnd'),
  // 📜 받은 목록
  historyBtn: $('#historyBtn'),
  historyModal: $('#historyModal'),
  historyList: $('#historyList'),
  historyCloseBtn: $('#historyCloseBtn'),
  historyClearBtn: $('#historyClearBtn'),
  // 🔑 로그인(쿠키)
  cookieBtn: $('#cookieBtn'),
  cookieModal: $('#cookieModal'),
  cookieCloseBtn: $('#cookieCloseBtn'),
  cookiePickBtn: $('#cookiePickBtn'),
  cookieClearBtn: $('#cookieClearBtn'),
  cookieState: $('#cookieState'),
  cookieDoneMsg: $('#cookieDoneMsg'),
};

/* ============ ✂️ 구간 · 📜 기록 · 🔑 쿠키 ============ */
function bindExtras() {
  // ── 구간 다운로드 ──
  if (els.sectionCheck) {
    els.sectionCheck.addEventListener('change', () => {
      els.sectionInputs.classList.toggle('hidden', !els.sectionCheck.checked);
      if (els.sectionCheck.checked) els.secStart.focus();
    });
  }

  // ── 받은 목록 ──
  const openHistory = async () => {
    const rows = await window.piggy.historyList();
    els.historyList.innerHTML = rows.length
      ? rows.map((r) => {
          const name = (r.file || r.url).split(/[\\/]/).pop();
          const mb = r.size ? (r.size / 1024 / 1024).toFixed(1) + 'MB' : '';
          const when = (r.at || '').slice(0, 10);
          return `<li>
            <span class="t ${r.exists ? '' : 'gone'}" title="${esc(r.file || r.url)}">${r.mode === 'audio' ? '🎵' : '🎬'} ${esc(name)}</span>
            <span class="m">${mb} · ${when}</span>
            ${r.exists ? `<button class="mini-btn h-open" data-f="${esc(r.file)}">폴더 열기</button>` : '<span class="m">파일 없음</span>'}
            <button class="mini-btn h-again" data-u="${esc(r.url)}">다시 받기</button>
          </li>`;
        }).join('')
      : '<li><span class="t">아직 받은 것이 없습니다.</span></li>';
    els.historyModal.classList.remove('hidden');
  };
  els.historyBtn?.addEventListener('click', openHistory);
  els.historyCloseBtn?.addEventListener('click', () => els.historyModal.classList.add('hidden'));
  els.historyClearBtn?.addEventListener('click', async () => {
    await window.piggy.historyClear();
    openHistory();
  });
  els.historyList?.addEventListener('click', async (e) => {
    const open = e.target.closest('.h-open');
    if (open) return window.piggy.showItem(open.dataset.f);
    const again = e.target.closest('.h-again');
    if (again) {
      els.historyModal.classList.add('hidden');
      els.url.value = again.dataset.u;
      state.lastAutoUrl = again.dataset.u;
      await fetchInfo();
      if (state.pendingInfo) addCurrentToQueue();
    }
  });

  // ── 로그인(쿠키) ──
  const showCookieState = () => {
    const c = state.settings?.cookies || {};
    els.cookieState.textContent =
      c.mode === 'file' ? '현재: 쿠키 파일 연결됨 ✅'
      : c.mode === 'browser' ? `현재: ${c.browser} 브라우저에서 가져오기 ✅`
      : '현재: 연결 안 됨';
    // 버튼 라벨은 연결 여부만 바꾼다. 옆의 안내문(.hint-inline)은 건드리지 않는다.
    const connected = c.mode && c.mode !== 'none';
    if (els.cookieBtn) els.cookieBtn.textContent = connected ? '🔑 연결됨' : '🔑 로그인';
    // 방법 1 을 4단계까지 끝냈을 때(= 쿠키 파일 등록)만 완료 안내를 띄운다.
    els.cookieDoneMsg?.classList.toggle('hidden', c.mode !== 'file');
    // 2단계 칩 + 이미 해둔 사람은 접힌 걸 펼쳐서 상태를 바로 보게 한다(닫는 건 사용자 몫).
    const chip = $('#cookieStepState');
    if (chip) {
      chip.textContent = connected ? '✅ 연결됨' : '안 함';
      chip.classList.toggle('on', !!connected);
    }
    if (connected) { const fold = $('#cookieAdvanced'); if (fold) fold.open = true; }
    // 연결한 뒤에는 '안 받아질 때만' 안내가 더 이상 필요 없다 → 상태 문구로 바꾼다.
    const hint = document.querySelector('.hint-inline');
    if (hint) hint.innerHTML = '← <b>쓰레드·인스타·샤오홍슈</b>는 여기를 참고해서 <b>먼저 세팅</b>해주세요';
  };
  // 🔑 사이트별 로그인 — 확장·쿠키파일 없이 앱 안에서 바로 로그인시킨다
  //    (크롬 쿠키를 긁어오는 방법은 크롬 127+ 의 App-Bound Encryption 때문에 불가능하다)
  const SITE_LABEL = { threads: '🧵 쓰레드', instagram: '📸 인스타그램', xhs: '📕 샤오홍슈' };
  const siteRows = [...document.querySelectorAll('.site-row')];
  const threadsDoneMsg = $('#threadsDoneMsg');
  const setRow = (row, text, kind) => {
    const chip = row.querySelector('.site-state');
    const btn = row.querySelector('.site-login');
    const out = row.querySelector('.site-logout');
    chip.textContent = text;
    chip.classList.toggle('on', kind === 'on');
    chip.classList.toggle('wait', kind === 'wait');
    row.classList.toggle('done', kind === 'on');
    if (btn) btn.textContent = kind === 'on' ? '다시 로그인' : '로그인';
    // 로그아웃은 로그인해둔 줄에만 — 안 해둔 줄에 있으면 무슨 버튼인지 헷갈린다.
    if (out) out.classList.toggle('hidden', kind !== 'on');
  };
  const showThreadsState = async () => {
    if (!siteRows.length) return;
    const st = await window.piggy.siteStatus();
    for (const row of siteRows) {
      const on = !!st[row.dataset.site];
      setRow(row, on ? '✅ 로그인됨' : '아직 안 함', on ? 'on' : null);
    }
    // ⚠️ '하나라도 됐으면 완료' 로 쓰면 안 된다. 인스타만 해둔 사람에게 "빠짐없이 받아집니다"
    //    라고 말해놓고 정작 쓰레드는 사진이 빠진 채 받아졌다. 어느 사이트가 됐는지 그대로 말한다.
    const okNames = Object.keys(st).filter((k) => st[k]).map((k) => SITE_LABEL[k]);
    if (threadsDoneMsg) {
      threadsDoneMsg.classList.toggle('hidden', !okNames.length);
      threadsDoneMsg.innerHTML = `✅ <b>${okNames.join(' · ')} 로그인됨</b> — 이 사이트는 사진·영상이 빠짐없이 받아집니다.`;
    }
    updateSiteHint(st);
  };

  // 상단 안내문 — 로그인 전에는 눈에 띄게, 해두면 조용하게.
  //  (로그인 없이 받으면 쓰레드가 글을 가려서 사진이 일부만 내려온다)
  const updateSiteHint = (st) => {
    const hint = $('#siteHint');
    if (!hint) return;
    const okNames = Object.keys(st).filter((k) => st[k]).map((k) => SITE_LABEL[k]);
    // 사진 누락이 실제로 터지는 곳은 쓰레드다 → 쓰레드가 안 돼 있으면 완료라고 말하지 않는다.
    const ok = !!st.threads;
    hint.classList.toggle('ok', ok);
    hint.innerHTML = ok
      ? `✅ <b>${okNames.join(' · ')} 로그인됨</b> — 사진이 빠짐없이 받아집니다`
      : (okNames.length
        ? `← <b>쓰레드는 아직입니다</b> (${okNames.join('·')}만 로그인됨) — 쓰레드 줄에서 로그인하세요`
        : '← <b>쓰레드·인스타·샤오홍슈</b>는 <b>먼저 로그인</b>하세요 (안 하면 일부만 받아져요)');
  };
  // 쓰레드·인스타는 세션이 분리돼 있다 → 한쪽을 지워도 다른 쪽은 그대로다.
  const SHARED = {};

  for (const row of siteRows) {
    row.querySelector('.site-login')?.addEventListener('click', async () => {
      const key = row.dataset.site;
      const relogin = row.classList.contains('done');
      setRow(row, relogin ? '기존 로그인을 지우고 여는 중…' : '로그인 창에서 진행 중…', 'wait');
      const r = await window.piggy.siteLogin(key);
      await showThreadsState();
      setStatus(r?.loggedIn
        ? `${SITE_LABEL[key]} 로그인 완료 — 이제 빠짐없이 받아집니다`
        : `${SITE_LABEL[key]} 로그인이 확인되지 않았습니다. 창에서 로그인을 끝까지 마쳐주세요`);
    });

    row.querySelector('.site-logout')?.addEventListener('click', async () => {
      const key = row.dataset.site;
      const also = SHARED[key] ? `\n\n${SHARED[key]}도 같은 계정이라 함께 로그아웃됩니다.` : '';
      if (!confirm(`${SITE_LABEL[key]} 로그인을 지울까요?${also}`)) return;
      setRow(row, '로그아웃 중…', 'wait');
      await window.piggy.siteLogout(key);
      await showThreadsState();
      setStatus(`${SITE_LABEL[key]} 로그아웃했습니다`);
    });
  }

  // 창을 열기 전에도 안내문이 실제 상태를 말해야 한다(모달을 열어야 알 수 있으면 소용없다)
  showThreadsState();

  els.cookieBtn?.addEventListener('click', () => { showCookieState(); showThreadsState(); els.cookieModal.classList.remove('hidden'); });
  els.cookieCloseBtn?.addEventListener('click', () => els.cookieModal.classList.add('hidden'));
  els.cookiePickBtn?.addEventListener('click', async () => {
    const r = await window.piggy.pickCookies();
    if (r?.ok) {
      state.settings = await window.piggy.getSettings();
      showCookieState();
      setStatus('🔑 쿠키를 등록했습니다 — 이제 로그인 전용 영상도 받아집니다');
    } else if (r?.error) setStatus(`⚠ 쿠키 등록 실패: ${r.error}`);
  });
  document.querySelectorAll('.cookie-browser').forEach((b) => {
    b.addEventListener('click', async () => {
      await window.piggy.useBrowserCookies(b.dataset.b);
      state.settings = await window.piggy.getSettings();
      showCookieState();
      setStatus(`🔑 ${b.dataset.b} 에서 쿠키를 가져오도록 설정했습니다`);
    });
  });
  els.cookieClearBtn?.addEventListener('click', async () => {
    await window.piggy.clearCookies();
    state.settings = await window.piggy.getSettings();
    showCookieState();
    setStatus('🔑 로그인 연결을 해제했습니다');
  });
  showCookieState();

  // 모달 바깥을 누르면 닫기
  [els.historyModal, els.cookieModal].forEach((m) => {
    m?.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
  });
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============ yt-dlp 엔진 상태 ============ */
// 유튜브가 구조를 바꾸면 yt-dlp 가 최신이어야 계속 받아진다.
// 앱이 하루 1회 자동 확인하고, 여기를 누르면 즉시 확인한다.
function subscribeYtdlp() {
  const el = els.ytdlpInfo;
  if (!el) return;

  const show = (text, title) => {
    el.textContent = text;
    if (title) el.title = title;
  };

  window.piggy.getYtdlpVersion().then((v) => {
    if (v) show(`yt-dlp ${v}`, '눌러서 지금 최신인지 확인합니다');
    else show('yt-dlp', '눌러서 지금 최신인지 확인합니다');
  });
  // 푸터 버전 — 예전엔 v1.0.0 이 하드코딩돼 있어 올려도 그대로였다.
  if (els.appVersion) {
    window.piggy.getAppVersion().then((v) => { els.appVersion.textContent = `Piggy Downloader v${v}`; });
  }

  window.piggy.onYtdlpStatus((s) => {
    if (!s) return;
    if (s.state === 'checking') show('yt-dlp 확인 중…');
    else if (s.state === 'downloading') show(`yt-dlp ${s.version} 받는 중…`);
    else if (s.state === 'updated') { show(`yt-dlp ${s.to} ✅`, `${s.from} → ${s.to} 로 갱신했습니다`); setStatus(`🔄 다운로드 엔진을 최신(${s.to})으로 갱신했습니다`); }
    else if (s.state === 'latest') show(`yt-dlp ${s.version} ✅`, '최신입니다');
    else if (s.state === 'error') show('yt-dlp ⚠', `갱신 실패: ${s.error} (기존 버전으로 계속 동작합니다)`);
  });

  el.style.cursor = 'pointer';
  el.addEventListener('click', async () => {
    show('yt-dlp 확인 중…');
    const r = await window.piggy.updateYtdlp();
    if (r && r.state === 'latest') setStatus('✅ 다운로드 엔진이 이미 최신입니다');
    else if (r && r.state === 'error') setStatus(`⚠ 엔진 갱신 실패 — 기존 버전으로 계속 씁니다`);
  });
}

/* ============ 초기화 ============ */
async function init() {
  state.settings = await window.piggy.getSettings();
  state.downloadsDir = await window.piggy.getDownloadsDir(); // 무조건 여기에 저장
  applyTheme(state.settings.theme || 'light');
  state.mode = state.settings.lastMode || 'video';
  // ⚡ 복사하면 바로 받기 — 기본 켜짐(껐던 사람만 꺼진 상태로 복원)
  if (els.autoDl) {
    // 예전 버전에서 기본값이 켜짐이라 저장돼 버린 사람들이 있다. 한 번은 꺼준다.
    if (state.settings.autoDownloadMigrated !== true) {
      state.settings.autoDownloadOnCopy = false;
      state.settings.autoDownloadMigrated = true;
      window.piggy.setSettings(state.settings);
    }
    els.autoDl.checked = state.settings.autoDownloadOnCopy === true;
    els.autoDl.addEventListener('change', persistPrefs);
  }
  // 📁 저장 위치 묻기 — 기본 꺼짐(다운로드 폴더 고정이 기본 설계)
  if (els.askSave) {
    els.askSave.checked = !!state.settings.askSaveLocation;
    els.askSave.addEventListener('change', persistPrefs);
  }
  setMode(state.mode);
  updateFolderLabel();
  bindEvents();
  subscribeProgress();
  subscribeBridge();
  subscribeUpdates();
  subscribeYtdlp();
  bindExtras();
  refreshEmptyState();
  await tryAutoPasteFromClipboard();
}

/* 클립보드 자동 감지 + 브라우저 플로팅 버튼 연동 */
function subscribeBridge() {
  // 브라우저에서 URL 을 복사하면 → 불러오기 → (자동 다운로드가 켜져 있으면) 곧바로 큐에 넣는다.
  //   예전엔 여기서 멈춰 사람이 [불러오기] → [대기열 추가]를 눌러야 했다.
  //   크롬 확장(onExternalAdd)은 원래 원클릭이었는데 복사 경로만 2단계라 어긋나 있었다 → 통일.
  window.piggy.onClipboardUrl(async (url) => {
    if (!url || url === state.lastAutoUrl) return;
    if (url === els.url.value.trim() && state.pendingInfo) return;
    state.lastAutoUrl = url;                    // 같은 링크로 두 번 받지 않게
    els.url.value = url;
    const auto = state.settings?.autoDownloadOnCopy === true;
    setStatus(auto ? '🔗 링크 복사 감지 — 바로 다운로드' : '🔗 복사한 링크 감지 — 불러오는 중');
    await fetchInfo();
    if (auto && state.pendingInfo) addCurrentToQueue();
  });
  // 브라우저 플로팅 버튼/확장에서 추가 요청 → 불러온 뒤 곧바로 큐에 추가·다운로드
  window.piggy.onExternalAdd(async ({ url, mode }) => {
    if (mode) setMode(mode);
    els.url.value = url;
    await fetchInfo();
    if (state.pendingInfo) addCurrentToQueue();
  });
}

function bindEvents() {
  els.fetch.addEventListener('click', fetchInfo);
  els.url.addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchInfo(); });
  // 📋 붙여넣기 — 사람이 직접 누른 것이므로 의도가 확실하다 → 바로 다운로드까지.
  els.paste.addEventListener('click', async () => {
    const t = await window.piggy.readClipboard();
    if (!t) return;
    els.url.value = t;
    state.lastAutoUrl = t;
    await fetchInfo();
    if (state.settings?.autoDownloadOnCopy === true && state.pendingInfo) addCurrentToQueue();
  });
  // 👀 자막만 보기 — 영상은 안 받고 음성만 전사해 텍스트로 보여준다.
  //   예전엔 크롬 확장에서만 열 수 있던 기능이라 확장을 빼면서 앱으로 옮겼다.
  if (els.transcribe) {
    els.transcribe.addEventListener('click', async () => {
      const url = els.url.value.trim();
      if (!url) { setStatus('먼저 영상 주소를 넣어주세요'); return; }
      const r = await window.piggy.openTranscribe(url);
      setStatus(r && r.ok ? '👀 자막 미리보기 창을 열었습니다' : `⚠ ${(r && r.error) || '열지 못했습니다'}`);
    });
  }
  els.add.addEventListener('click', addCurrentToQueue);
  els.clearDone.addEventListener('click', clearDone);
  // 재생목록이 수십 개씩 쌓이면 ✕ 를 하나씩 누르는 건 멈추는 방법이 못 된다.
  els.stopAll?.addEventListener('click', async () => {
    if (!confirm('받는 중인 것과 대기 중인 것을 모두 중단할까요? 이미 받아진 파일은 그대로 남습니다.')) return;
    await window.piggy.cancelAllDownloads();
    setStatus('전체 중단했습니다');
  });
  els.theme.addEventListener('click', toggleTheme);
  els.folder.addEventListener('click', () => window.piggy.openPath(state.downloadsDir));

  els.modeSeg.querySelectorAll('.seg-item').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  // 드래그 앤 드롭으로 URL/링크 받기 — 끌어다 놓은 것도 의도가 확실하므로 바로 다운로드.
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    const text = (e.dataTransfer.getData('text') || '').trim();
    if (!/^https?:\/\//.test(text)) return;
    els.url.value = text;
    state.lastAutoUrl = text;
    await fetchInfo();
    if (state.settings?.autoDownloadOnCopy === true && state.pendingInfo) addCurrentToQueue();
  });
}

/* ============ 테마 ============ */
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  els.theme.textContent = theme === 'dark' ? '☀️' : '🌙';
}
function toggleTheme() {
  const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  persistPrefs();
}

/* ============ 모드/옵션 ============ */
function setMode(mode) {
  state.mode = mode;
  els.modeSeg.querySelectorAll('.seg-item').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === mode),
  );
  els.qualityGroup.classList.toggle('hidden', mode === 'audio');
  els.subs.parentElement.classList.toggle('hidden', mode === 'audio');
  persistPrefs();
}

function persistPrefs() {
  state.settings = {
    ...state.settings,
    theme: document.body.dataset.theme,
    lastMode: state.mode,
    autoDownloadOnCopy: els.autoDl ? els.autoDl.checked : true,
    askSaveLocation: els.askSave ? els.askSave.checked : false,
  };
  window.piggy.setSettings(state.settings);
}

/* ============ 폴더 (다운로드 폴더 고정, 클릭 시 열기) ============ */
function updateFolderLabel() {
  els.folderLabel.textContent = '다운로드 폴더';
  els.folder.title = `${state.downloadsDir} (클릭하면 열기)`;
}

/* ============ 정보 조회 ============ */
// 앱을 켤 때 클립보드에 링크가 있으면 채워만 둔다.
//   ⚠️ 여기서는 자동 다운로드를 하지 않는다 — 어제 복사해 둔 오래된 링크일 수 있어서
//     앱을 켰다는 이유만으로 받아버리면 곤란하다. '방금 복사'만 자동으로 받는다.
async function tryAutoPasteFromClipboard() {
  const t = await window.piggy.readClipboard();
  if (t && /^https?:\/\/\S+$/.test(t) && /(youtu|tiktok|instagram|threads\.|vimeo|facebook|twitter|x\.com|naver|kakao)/i.test(t)) {
    // ⚠️ 주소칸에 미리 박아두지 않는다. 어제 복사해 둔 링크가 켤 때마다 들어가 있으면
    //    지우고 쓰는 게 일이 된다. 있다는 사실만 알리고, 넣을지는 사용자가 정한다.
    state.lastAutoUrl = t; // 이 링크는 '방금 복사'가 아니므로 자동 다운로드 대상에서 제외
    setStatus('클립보드에 링크가 있습니다 — [붙여넣기] 를 누르세요');
  }
}

async function fetchInfo() {
  const url = els.url.value.trim();
  if (!url) return;
  if (!/^https?:\/\//.test(url)) { showFetchStatus('error', '올바른 URL 이 아닙니다.'); return; }

  els.fetch.disabled = true;
  els.preview.classList.add('hidden');
  showFetchStatus('loading', '정보를 불러오는 중...');
  setStatus('정보 조회 중...');

  const res = await window.piggy.getInfo(url);
  els.fetch.disabled = false;

  if (!res.ok) {
    showFetchStatus('error', `불러오기 실패: ${res.error}`);
    setStatus('실패');
    return;
  }
  els.fetchStatus.classList.add('hidden');
  state.pendingInfo = { ...res.info, url };
  renderPreview(res.info);
  setStatus('준비됨');
}

function renderPreview(info) {
  els.previewThumb.src = info.thumbnail || '';
  els.previewTitle.textContent = info.title || '(제목 없음)';
  els.previewUploader.textContent = info.uploader || '';
  els.previewDuration.textContent = info.durationString || '';
  els.previewDuration.classList.toggle('hidden', !info.durationString);
  els.previewSite.textContent = info.extractor || '';
  els.preview.classList.remove('hidden');
}

function showFetchStatus(kind, msg) {
  els.fetchStatus.className = `fetch-status ${kind}`;
  els.fetchStatus.textContent = msg;
  els.fetchStatus.classList.remove('hidden');
}

/* ============ 큐 ============ */
function addCurrentToQueue() {
  if (!state.pendingInfo) return;
  const info = state.pendingInfo;
  const id = `job_${++state.seq}_${info.id || 'x'}`;
  const job = {
    id,
    url: info.url,
    outputDir: state.downloadsDir,
    mode: state.mode,
    maxHeight: 0, // 무조건 최고화질
    audioFormat: 'mp3',
    aiSubtitles: state.mode === 'video' && els.subs.checked, // 다운로드 후 AI 음성분석 자막
    playlist: false,
    // ✂️ 구간 다운로드(체크했을 때만). 빈 칸은 처음/끝으로 해석된다.
    section: els.sectionCheck && els.sectionCheck.checked
      ? { start: (els.secStart.value || '').trim(), end: (els.secEnd.value || '').trim() }
      : null,
    // 📜 기록에 남길 메타
    title: info.title || '',
    thumbnail: info.thumbnail || '',
  };
  const el = buildQueueItem(id, info, job);
  els.queue.prepend(el);
  state.items.set(id, { el, info, job, status: 'starting' });
  refreshEmptyState();

  // 입력 정리
  els.preview.classList.add('hidden');
  els.url.value = '';
  state.pendingInfo = null;

  startJob(id, job);
}

function buildQueueItem(id, info, job) {
  const node = els.tpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = id;
  node.querySelector('.q-thumb').src = info.thumbnail || '';
  node.querySelector('.q-title').textContent = info.title || info.url;
  node.querySelector('.q-badge.mode').textContent = job.mode === 'audio' ? 'MP3' : '영상';
  node.querySelector('.q-badge.quality').textContent = job.mode === 'audio' ? '오디오' : '최고화질';

  node.querySelector('.q-cancel').addEventListener('click', () => cancelJob(id));
  node.querySelector('.q-open').addEventListener('click', () => window.piggy.openPath(job.outputDir));
  node.querySelector('.q-retry').addEventListener('click', () => {
    const it = state.items.get(id);
    setItemState(id, 'starting');
    node.querySelector('.q-retry').classList.add('hidden');
    startJob(id, it.job);
  });
  return node;
}

async function startJob(id, job) {
  setStatus(`다운로드 중: ${state.items.get(id)?.info.title || ''}`);
  const res = await window.piggy.startDownload(job);
  if (res.ok) setStatus('완료');
}

function cancelJob(id) {
  window.piggy.cancelDownload(id);
  setItemState(id, 'canceled');
}

function clearDone() {
  for (const [id, it] of state.items) {
    if (['done', 'error', 'canceled'].includes(it.status)) {
      it.el.remove();
      state.items.delete(id);
    }
  }
  refreshEmptyState();
}

function refreshEmptyState() {
  const n = state.items.size;
  els.queueCount.textContent = String(n);
  els.emptyState.classList.toggle('hidden', n > 0);
  // 아직 끝나지 않은 게 하나라도 있으면 [전체 중단] 을 보여준다.
  // 재생목록처럼 수십 개가 쌓였을 때 빠져나올 유일한 길이다.
  const running = [...state.items.values()]
    .some((it) => it.status !== 'done' && it.status !== 'error' && it.status !== 'canceled');
  els.stopAll?.classList.toggle('hidden', !running);
}

/* ============ 진행률 수신 ============ */
function subscribeProgress() {
  window.piggy.onProgress((data) => {
    const it = state.items.get(data.id);
    if (!it) return;
    const el = it.el;

    switch (data.type) {
      case 'stage':
        el.querySelector('.q-stage').textContent = data.text || '';
        if (data.stage && data.stage !== 'downloading') setItemState(data.id, 'working');
        break;
      case 'progress': {
        if (data.percent != null) {
          el.querySelector('.q-bar').style.width = `${data.percent}%`;
          el.querySelector('.q-percent').textContent = `${data.percent.toFixed(1)}%`;
        }
        el.querySelector('.q-speed').textContent = data.speed && data.speed !== 'Unknown' ? `⬇ ${data.speed}` : '';
        el.querySelector('.q-eta').textContent = data.eta && data.eta !== 'Unknown' ? `남은시간 ${data.eta}` : '';
        if (data.note) el.querySelector('.q-stage').textContent = data.note;
        setItemState(data.id, 'downloading');
        break;
      }
      case 'done':
        setItemState(data.id, 'done');
        // 일부만 받아진 경우엔 '완료'로 덮지 않는다 — 그러면 다 받은 줄 안다.
        if (data.warning) {
          el.querySelector('.q-stage').textContent = `⚠️ ${data.warning}`;
          el.querySelector('.q-stage').classList.add('warn');
          setStatus(`⚠️ ${data.warning}`);
        } else {
          el.querySelector('.q-stage').textContent = '✅ 완료';
        }
        el.querySelector('.q-bar').style.width = '100%';
        el.querySelector('.q-percent').textContent = '100%';
        el.querySelector('.q-speed').textContent = '';
        el.querySelector('.q-eta').textContent = '';
        el.querySelector('.q-open').classList.remove('hidden');
        el.querySelector('.q-cancel').classList.add('hidden');
        break;
      case 'error':
        setItemState(data.id, 'error');
        el.querySelector('.q-stage').textContent = `⚠ ${data.error || '실패'}`;
        el.querySelector('.q-cancel').classList.add('hidden');
        el.querySelector('.q-retry').classList.remove('hidden');
        break;
      case 'canceled':
        setItemState(data.id, 'canceled');
        el.querySelector('.q-stage').textContent = '취소됨';
        el.querySelector('.q-cancel').classList.add('hidden');
        el.querySelector('.q-retry').classList.remove('hidden');
        break;
    }
  });
}

/* 자동 업데이트 상태 표시 */
function subscribeUpdates() {
  window.piggy.onUpdateStatus((d) => {
    if (!d) return;
    switch (d.state) {
      case 'available':
        setStatus(`⬇ 새 버전 ${d.version} 다운로드 중...`);
        break;
      case 'downloading':
        setStatus(`⬇ 업데이트 ${d.percent}% 다운로드 중...`);
        break;
      case 'ready':
        setStatus(`✅ 새 버전 ${d.version} 준비됨 — 클릭하면 재시작하여 적용`);
        els.status.style.cursor = 'pointer';
        els.status.onclick = () => window.piggy.installUpdate();
        break;
      case 'error':
        // 미설정/개발 모드 등은 조용히 무시
        break;
    }
  });
}

function setItemState(id, status) {
  const it = state.items.get(id);
  if (!it) return;
  it.status = status;
  it.el.classList.remove('done', 'error');
  if (status === 'done') it.el.classList.add('done');
  if (status === 'error' || status === 'canceled') it.el.classList.add('error');
  refreshEmptyState();   // 남은 작업이 없어지면 [전체 중단] 도 같이 사라져야 한다
}

function setStatus(text) { els.status.textContent = text; }

init();
