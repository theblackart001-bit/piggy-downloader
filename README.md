# 🐷 Piggy Downloader

YouTube · TikTok · Instagram 등 **1000+ 사이트** 영상/오디오 다운로더.
yt-dlp + ffmpeg + Whisper(AI 자막) 엔진을 내장한 Electron 데스크톱 앱(Windows · macOS).

## 주요 기능
- 🎬 **무조건 최고화질** 영상 다운로드 (최적 비디오+오디오 자동 병합, mp4)
- 🎵 MP3 오디오 추출 (썸네일 커버 + 메타데이터 임베드)
- 📋 **클립보드 자동 감지** — 브라우저에서 영상 URL 복사 시 앱이 자동으로 불러옴
- 🧲 **브라우저 플로팅 버튼** — 크롬 확장 설치 시 어느 영상 페이지에서나 우측 하단 🐷 버튼으로 바로 다운로드 (우클릭 시 MP3)
- 🤖 **AI 자막** — 다운로드 후 Whisper 음성분석으로 `.srt` 자막 자동 생성 (무료·오프라인, 한국어 지원)
- 📦 다운로드 대기열(여러 개 동시) · 실시간 진행률/속도/남은시간
- 🌙 다크/라이트 테마, 저장 폴더 지정 기억

## 개발 실행
```bash
npm install          # 의존성 + 바이너리 자동 다운로드(postinstall: yt-dlp/ffmpeg/whisper/모델)
npm run prep         # (수동) 바이너리·모델 다시 받기
npm start            # 앱 실행
npm run dev          # 개발자도구 포함 실행
```
> 최초 `npm install` 시 Whisper 모델(약 142MB) 까지 받으므로 시간이 걸립니다.
> 더 정확한 한국어 자막을 원하면: `set PIGGY_WHISPER_MODEL=ggml-small.bin && npm run prep` (약 466MB)

## 크롬 확장 설치 (플로팅 버튼)
1. Chrome → `chrome://extensions` → 우상단 **개발자 모드** ON
2. **압축해제된 확장 프로그램을 로드** → `chrome-extension/` 폴더 선택
3. Piggy Downloader 앱을 실행해 두면, 영상 페이지 우측 하단 🐷 버튼으로 바로 전송됩니다.
   - 좌클릭 = 영상 다운로드 / 우클릭 = 메뉴(영상·MP3) / 드래그 = 위치 이동
   - 앱과는 로컬 서버(`127.0.0.1:53472`)로만 통신 (외부 전송 없음)

## 빌드(설치본 생성)
```bash
python scripts/make-icon.py          # 아이콘 재생성(원본 변경 시)
node scripts/download-binaries.js --all   # 교차 빌드용: win+mac 바이너리·모델
npm run dist:win                     # Windows: NSIS 설치본 + 포터블 exe (dist/)
npm run dist:mac                     # macOS: dmg  (반드시 mac 에서 실행)
```

## 배포 패키지 만들기 (SB식 구성)
```bash
npm run pdfs       # 매뉴얼/약관 PDF 생성 (packaging/*.html → *.pdf)
npm run dist:win   # 설치본 + 포터블 + latest.yml
npm run package    # release/PiggyDownloader-<버전>.zip 생성
```
ZIP 구성: `chrome-extension.zip` · `Windows/`(설치본·포터블·latest.yml) · `macOS/`(dmg 또는 빌드안내) · `사용매뉴얼.pdf` · `이용약관.pdf` · `처음에 읽어주세요.txt`

## 자동 업데이트 (electron-updater + GitHub Releases)
설치형은 새 버전을 자동으로 받아 다음 실행 때 적용합니다. 설정 방법:
1. `package.json`의 `build.publish.owner`를 본인 **GitHub 아이디**로 변경(`CHANGE_ME_github_id`), repo는 `piggy-downloader`(원하는 이름).
2. 해당 이름으로 GitHub 저장소 생성(공개).
3. 새 버전 배포:
   ```bash
   # package.json version 올림 (예: 1.0.1)
   set GH_TOKEN=<github personal access token>
   npm run dist:win
   npm run publish:win    # 산출물 + latest.yml 을 GitHub Release 에 업로드
   ```
   또는 수동으로 `gh release create v1.0.1 "dist/Piggy Downloader Setup 1.0.1.exe" dist/latest.yml`.
4. 기존 설치 사용자는 다음 실행 시 자동으로 1.0.1 로 업데이트됩니다.

> 포터블(.exe)은 자동 업데이트가 적용되지 않습니다(설치형만 지원).

## 구조
```
src/main/      Electron 메인
  main.js        윈도우, IPC, 다운로드 오케스트레이션, 설정 저장
  ytdlp.js       yt-dlp 래퍼(메타데이터·다운로드·진행률·취소)
  whisper.js     Whisper 전사 → .srt 자막 생성
  bridge.js      클립보드 감시 + 로컬 HTTP 서버(크롬 확장 연동)
  binaries.js    yt-dlp/ffmpeg/whisper/모델 경로 해석
  preload.js     contextBridge IPC
src/renderer/  UI — index.html / styles.css / renderer.js
chrome-extension/  플로팅 버튼 확장 (manifest v3)
scripts/       바이너리 다운로드 · 아이콘 생성
resources/     번들 바이너리 (win/, mac/, models/) — git 제외, prep 으로 생성
build/         electron-builder 아이콘(icon.png)
```

## 폴백 동작 (안전장치)
- yt-dlp/ffmpeg 번들이 없으면 시스템 PATH 의 바이너리로 자동 폴백.
- Whisper 바이너리/모델이 없으면 영상 다운로드는 정상 완료되고, 자막 단계만 경고로 건너뜁니다.
- macOS 는 Whisper prebuilt 가 없어 `brew install whisper-cpp` 의 `whisper-cli` 를 PATH 폴백으로 사용합니다.
