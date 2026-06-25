// Electron 환경에서 whisper.transcribe 통합 테스트
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const whisper = require('../src/main/whisper');

const media = process.argv[process.argv.length - 1];

app.whenReady().then(async () => {
  console.log('TEST media:', media, 'exists:', fs.existsSync(media));
  try {
    const res = await whisper.transcribe(media, (e) => console.log('  progress:', JSON.stringify(e)));
    console.log('RESULT:', JSON.stringify(res));
    console.log('SRT exists:', fs.existsSync(res.srt));
    if (fs.existsSync(res.srt)) {
      console.log('--- SRT head ---');
      console.log(fs.readFileSync(res.srt, 'utf-8').split('\n').slice(0, 6).join('\n'));
    }
    app.exit(0);
  } catch (e) {
    console.error('FAIL:', e.message);
    app.exit(2);
  }
});
