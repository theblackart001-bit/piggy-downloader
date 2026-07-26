// Electron 으로 manual.html / terms.html 을 PDF 로 렌더링 (외부 의존성 없음)
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const PKG = path.join(__dirname, '..', 'packaging');
// 이용약관은 배포에서 뺐으므로(2026-07-26) 매뉴얼만 만든다.
const jobs = [
  { html: 'manual.html', pdf: '사용매뉴얼.pdf' },
];

async function render(win, html, pdf) {
  await win.loadFile(path.join(PKG, html));
  const data = await win.webContents.printToPDF({
    printBackground: true,
    margins: { marginType: 'default' },
    pageSize: 'A4',
  });
  fs.writeFileSync(path.join(PKG, pdf), data);
  console.log('PDF ->', pdf, `(${Math.round(data.length / 1024)} KB)`);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    for (const j of jobs) await render(win, j.html, j.pdf);
    app.exit(0);
  } catch (e) {
    console.error('PDF 생성 실패:', e.message);
    app.exit(2);
  }
});
