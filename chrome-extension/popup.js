const PORT = 53472;
const el = document.getElementById('status');
fetch(`http://127.0.0.1:${PORT}/ping`)
  .then((r) => r.json())
  .then((d) => {
    if (d && d.ok) { el.textContent = '✅ 앱 연결됨'; el.className = 'status ok'; }
    else throw new Error();
  })
  .catch(() => {
    el.textContent = '⚠ 앱이 실행되어 있지 않습니다';
    el.className = 'status err';
  });
