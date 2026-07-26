# 🐷 Piggy Downloader

YouTube · TikTok · Instagram 등 **1000+ 사이트** 영상/오디오 다운로더.
yt-dlp + ffmpeg + Whisper(AI 자막) 엔진을 내장한 Electron 데스크톱 앱(Windows · macOS).

## 주요 기능
- ⚡ **복사하면 바로 다운로드** — 영상 URL을 복사하면 불러오기·추가 없이 곧바로 받는다.
  (📋 붙여넣기 버튼·드래그앤드롭도 동일. 옵션 `⚡ 복사하면 바로 받기`로 끌 수 있음)
- 🎬 **무조건 최고화질** 영상 다운로드 (최적 비디오+오디오 자동 병합, mp4)
- 🎵 MP3 오디오 추출 (썸네일 커버 + 메타데이터 임베드)
- 🤖 **AI 자막** — 다운로드 후 Whisper 음성분석으로 `.srt` 생성 (무료·오프라인, 한국어 지원)
- 👀 **자막만 보기** — 영상은 받지 않고 오디오만 전사해 텍스트 창으로 표시
- 🔄 **yt-dlp 자동 갱신** — 하루 1회 최신 엔진 확인·적용 (아래 참조)
- 📦 다운로드 대기열(여러 개 동시) · 실시간 진행률/속도/남은시간
- 🌙 다크/라이트 테마

## 개발 실행
```bash
npm install          # 의존성 + 바이너리 자동 다운로드(postinstall: yt-dlp/ffmpeg/whisper/모델)
npm run prep         # (수동) 바이너리·모델 다시 받기
npm start            # 앱 실행
npm run dev          # 개발자도구 포함 실행
```
> 최초 `npm install` 시 Whisper 모델(약 142MB)까지 받으므로 시간이 걸립니다.
> 더 정확한 한국어 자막을 원하면: `set PIGGY_WHISPER_MODEL=ggml-small.bin && npm run prep` (약 466MB)

## 빌드(설치본 생성)
```bash
python scripts/make-icon.py               # 아이콘 재생성(원본 변경 시)
node scripts/download-binaries.js --all   # 교차 빌드용: win+mac 바이너리·모델
npm run dist:win                          # Windows: NSIS 설치본 (dist/)
npm run dist:mac                          # macOS: dmg  (반드시 mac 에서 실행)
```

## 배포 패키지 만들기
```bash
npm run pdfs       # 사용매뉴얼 PDF 생성 (packaging/manual.html → 사용매뉴얼.pdf)
npm run dist:win   # 설치본 + latest.yml
npm run package    # release/PiggyDownloader-<버전>.zip 생성
```
ZIP 구성: `Windows/`(설치본 -x64) · `macOS/`(dmg 또는 빌드안내) · `사용매뉴얼.pdf`

> **설치본만 배포합니다.** 포터블은 앱 자동 업데이트를 못 받는데, 이 앱의 핵심인 yt-dlp 는
> 대상 사이트가 구조를 바꿀 때마다 갱신돼야 한다 → 포터블 사용자는 얼마 못 가 고장난다.
> `latest.yml` 은 GitHub Releases 의 자동업데이트용 메타라 배포 ZIP 에는 넣지 않는다.

## 자동 업데이트

### 1) 앱 (electron-updater + GitHub Releases)
설치형은 새 버전을 자동으로 받아 다음 실행 때 적용합니다.
```bash
# package.json version 올림
set GH_TOKEN=<github personal access token>
npm run dist:win
npm run publish:win    # 산출물 + latest.yml 을 GitHub Release 에 업로드
```

### 2) yt-dlp 엔진 (`src/main/ytdlp-updater.js`)
유튜브 등이 구조를 바꾸면 yt-dlp 가 새로 나온다. 번들본은 빌드 시점에 고정이라
몇 주만 지나도 "유튜브만 안 받아짐" 상태가 되므로, yt-dlp 만 따로 갱신한다.

- 설치 폴더(Program Files)는 쓰기 불가 → **`userData/bin/` 에 받고 그걸 먼저 사용**한다.
  번들본은 그대로 남아 있어 **갱신이 실패해도 앱은 항상 동작**한다(폴백).
- 하루 1회 백그라운드 확인. 임시파일 → 크기 검증 → rename(반쪽 파일 방지),
  받은 파일이 실행되지 않으면 자동 롤백. 어떤 경우에도 throw 하지 않는다.
- 하단 상태바의 `yt-dlp <버전>` 을 누르면 즉시 확인/갱신.

## 구조
```
src/main/      Electron 메인
  main.js          윈도우, IPC, 다운로드 오케스트레이션, 설정 저장
  ytdlp.js         yt-dlp 래퍼(메타데이터·다운로드·진행률·취소)
  ytdlp-updater.js yt-dlp 자동 갱신(GitHub 릴리즈 → userData/bin)
  whisper.js       Whisper 전사 → .srt 자막 생성
  bridge.js        클립보드 감시 (※ 로컬 HTTP 서버는 사용하지 않음, 아래 참조)
  binaries.js      yt-dlp/ffmpeg/whisper/모델 경로 해석 (갱신본 우선)
  preload.js       contextBridge IPC
src/renderer/  UI — index.html / styles.css / renderer.js
scripts/       바이너리 다운로드 · 아이콘 생성 · PDF · 배포 패키징
resources/     번들 바이너리 (win/, mac/, models/) — git 제외, prep 으로 생성
build/         electron-builder 아이콘(icon.png)
```

> **크롬 확장은 제거했습니다(2026-07-26).** URL 복사만으로 바로 받게 되면서 기능이 겹쳤고,
> 설치가 번거로웠으며(개발자 모드 + 압축해제 로드) 모든 페이지 접근 권한이 필요했다.
> 확장이 쓰던 로컬 HTTP 서버(`127.0.0.1:53472`)도 함께 껐다 — CORS 가 `*` 라
> 임의의 웹페이지가 `/add` 를 호출해 원하는 URL 을 다운로드시킬 수 있었다.
> 확장에만 있던 '자막만 보기'는 앱 버튼(👀)으로 옮겼다.
> `bridge.js` 의 `startServer()` 는 코드만 남아 있고 호출하지 않는다.

## 폴백 동작 (안전장치)
- yt-dlp 갱신본이 없거나 깨졌으면 번들본으로 자동 폴백.
- yt-dlp/ffmpeg 번들이 없으면 시스템 PATH 의 바이너리로 자동 폴백.
- Whisper 바이너리/모델이 없으면 영상 다운로드는 정상 완료되고, 자막 단계만 경고로 건너뜁니다.
- macOS 는 Whisper prebuilt 가 없어 `brew install whisper-cpp` 의 `whisper-cli` 를 PATH 폴백으로 사용합니다.
