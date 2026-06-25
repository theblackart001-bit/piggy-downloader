/* Piggy Downloader — 플로팅 다운로드 버튼 주입 */
(() => {
  const PORT = 53472;
  const BASE = `http://127.0.0.1:${PORT}`;
  if (window.__piggyInjected) return;
  window.__piggyInjected = true;

  const wrap = document.createElement('div');
  wrap.className = 'piggy-fab-wrap';
  wrap.innerHTML = `
    <div class="piggy-menu" id="piggyMenu">
      <button class="piggy-menu-item" data-mode="video">🎬 영상 다운로드</button>
      <button class="piggy-menu-item" data-mode="audio">🎵 MP3 추출</button>
    </div>
    <button class="piggy-fab" id="piggyFab" title="Piggy Downloader 로 보내기">
      <img src="${chrome.runtime.getURL('icon128.png')}" alt="Piggy" />
      <span class="piggy-fab-label">다운로드</span>
    </button>
    <div class="piggy-toast" id="piggyToast"></div>
  `;
  document.documentElement.appendChild(wrap);

  const fab = wrap.querySelector('#piggyFab');
  const menu = wrap.querySelector('#piggyMenu');
  const toast = wrap.querySelector('#piggyToast');

  let toastTimer = null;
  function showToast(msg, kind = 'ok') {
    toast.textContent = msg;
    toast.className = `piggy-toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.className = 'piggy-toast'), 2600);
  }

  async function send(mode) {
    const url = location.href;
    try {
      const res = await fetch(`${BASE}/add?mode=${mode}&url=${encodeURIComponent(url)}`);
      if (res.ok) showToast(mode === 'audio' ? 'MP3 추출 추가됨 🎵' : '다운로드 추가됨 ✅');
      else showToast('추가 실패 — 앱 상태 확인', 'err');
    } catch (e) {
      showToast('Piggy Downloader 앱을 먼저 실행하세요', 'err');
    }
    menu.classList.remove('open');
  }

  // 메인 버튼: 클릭 시 영상 다운로드 / 길게 또는 우클릭 시 메뉴
  fab.addEventListener('click', (e) => {
    if (menu.classList.contains('open')) { menu.classList.remove('open'); return; }
    send('video');
  });
  fab.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    menu.classList.toggle('open');
  });
  menu.querySelectorAll('.piggy-menu-item').forEach((b) =>
    b.addEventListener('click', () => send(b.dataset.mode)),
  );

  // 드래그로 위치 이동(세로)
  let dragging = false, startY = 0, startBottom = 24;
  fab.addEventListener('pointerdown', (e) => {
    dragging = false; startY = e.clientY;
    startBottom = parseInt(getComputedStyle(wrap).bottom) || 24;
    const move = (ev) => {
      if (Math.abs(ev.clientY - startY) > 6) dragging = true;
      if (dragging) wrap.style.bottom = `${Math.max(12, startBottom - (ev.clientY - startY))}px`;
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) menu.classList.remove('open');
  });
})();
