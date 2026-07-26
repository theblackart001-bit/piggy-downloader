'use strict';

/* 자막 미리보기 창 — 메인 프로세스(preview-preload.js)와 통신 */
(() => {
  const $ = (id) => document.getElementById(id);
  const urlEl = $('url');
  const statusEl = $('status');
  const barEl = $('bar');
  const barFill = barEl.querySelector('i');
  const textEl = $('text');
  const copyBtn = $('copy');
  const closeBtn = $('close');
  const redoBtn = $('redo');
  const langSel = $('lang');

  let busy = false;

  function setStatus(msg, kind = '') {
    statusEl.textContent = msg;
    statusEl.className = `status ${kind}`;
  }
  function setBusy(on) {
    busy = on;
    redoBtn.disabled = on;
    langSel.disabled = on;
    if (on) {
      copyBtn.disabled = true;
      barEl.style.display = '';
      barEl.classList.add('indet');
      barFill.style.width = '';
    } else {
      barEl.classList.remove('indet');
    }
  }

  window.preview.onInit(({ url }) => {
    urlEl.textContent = url || '';
    urlEl.title = url || '';
  });

  window.preview.onProgress((p) => {
    if (!p || !p.type) return;
    switch (p.type) {
      case 'busy':
        textEl.value = '';
        setBusy(true);
        setStatus('시작하는 중...');
        break;
      case 'stage':
        setBusy(true);
        setStatus(p.text || '처리 중...');
        break;
      case 'progress':
        if (typeof p.percent === 'number' && p.percent >= 0) {
          barEl.classList.remove('indet');
          barFill.style.width = `${Math.min(100, p.percent)}%`;
          setStatus(`${p.note || 'AI 전사'} ${Math.round(p.percent)}%`);
        }
        break;
      case 'done':
        setBusy(false);
        barFill.style.width = '100%';
        setStatus('완료 ✓', 'ok');
        textEl.value = p.text || '';
        copyBtn.disabled = !p.text;
        break;
      case 'error':
        setBusy(false);
        barEl.style.display = 'none';
        setStatus(`실패: ${p.error || '알 수 없는 오류'}`, 'err');
        break;
    }
  });

  redoBtn.addEventListener('click', () => {
    if (busy) return;
    window.preview.retranscribe(langSel.value);
  });

  copyBtn.addEventListener('click', async () => {
    if (!textEl.value) return;
    await window.preview.copy(textEl.value);
    const prev = copyBtn.textContent;
    copyBtn.textContent = '✅ 복사됨';
    setTimeout(() => (copyBtn.textContent = prev), 1500);
  });

  closeBtn.addEventListener('click', () => window.preview.close());
})();
