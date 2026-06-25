'use strict';

/* ============ 상태 ============ */
const state = {
  settings: null,
  mode: 'video',
  pendingInfo: null, // 불러온 미리보기 정보
  items: new Map(), // id -> { el, info, status }
  seq: 0,
};

const $ = (sel) => document.querySelector(sel);

const els = {
  url: $('#urlInput'),
  paste: $('#pasteBtn'),
  fetch: $('#fetchBtn'),
  modeSeg: $('#modeSeg'),
  qualityGroup: $('#qualityGroup'),
  subs: $('#subsCheck'),
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
  theme: $('#themeBtn'),
  folder: $('#folderBtn'),
  folderLabel: $('#folderLabel'),
  status: $('#statusText'),
  tpl: $('#queueItemTpl'),
};

/* ============ 초기화 ============ */
async function init() {
  state.settings = await window.piggy.getSettings();
  state.downloadsDir = await window.piggy.getDownloadsDir(); // 무조건 여기에 저장
  applyTheme(state.settings.theme || 'light');
  state.mode = state.settings.lastMode || 'video';
  setMode(state.mode);
  updateFolderLabel();
  bindEvents();
  subscribeProgress();
  subscribeBridge();
  subscribeUpdates();
  refreshEmptyState();
  await tryAutoPasteFromClipboard();
}

/* 클립보드 자동 감지 + 브라우저 플로팅 버튼 연동 */
function subscribeBridge() {
  // 브라우저에서 URL 복사 시 자동으로 입력칸에 채우고 미리보기까지
  window.piggy.onClipboardUrl((url) => {
    if (!url || url === els.url.value.trim()) return;
    els.url.value = url;
    setStatus('🔗 복사한 링크 감지 — 불러오는 중');
    fetchInfo();
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
  els.paste.addEventListener('click', async () => {
    const t = await window.piggy.readClipboard();
    if (t) { els.url.value = t; fetchInfo(); }
  });
  els.add.addEventListener('click', addCurrentToQueue);
  els.clearDone.addEventListener('click', clearDone);
  els.theme.addEventListener('click', toggleTheme);
  els.folder.addEventListener('click', () => window.piggy.openPath(state.downloadsDir));

  els.modeSeg.querySelectorAll('.seg-item').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  // 드래그 앤 드롭으로 URL/링크 받기
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const text = e.dataTransfer.getData('text');
    if (text && /^https?:\/\//.test(text)) { els.url.value = text.trim(); fetchInfo(); }
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
  };
  window.piggy.setSettings(state.settings);
}

/* ============ 폴더 (다운로드 폴더 고정, 클릭 시 열기) ============ */
function updateFolderLabel() {
  els.folderLabel.textContent = '다운로드 폴더';
  els.folder.title = `${state.downloadsDir} (클릭하면 열기)`;
}

/* ============ 정보 조회 ============ */
async function tryAutoPasteFromClipboard() {
  const t = await window.piggy.readClipboard();
  if (t && /^https?:\/\/\S+$/.test(t) && /(youtu|tiktok|instagram|vimeo|facebook|twitter|x\.com|naver|kakao)/i.test(t)) {
    els.url.value = t;
    setStatus('클립보드에서 링크 감지됨 — 불러오기를 누르세요');
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
        el.querySelector('.q-stage').textContent = '✅ 완료';
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
}

function setStatus(text) { els.status.textContent = text; }

init();
