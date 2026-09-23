# SB Downloader 분석 — 도우인(抖音) 우회 방식과 Piggy 이식 (2026-09-23)

> 대상: SB Downloader **1.5.4**(설치본 `C:\Program Files\SB Downloader\resources\app.asar` 추출, 원작자 동의 하에 분석·이식)
> 방법: `npx @electron/asar extract` 로 asar 를 꺼내 `electron/main.js`(1709줄) + `server.js`(3147줄) + `public/app.js` 를 코드 기준으로 직접 확인.
> 비교 대상: Piggy Downloader 1.8.8

## 1. 전체 구조

SB Downloader 는 Electron 앱이며, 다운로드 로직은 두 파일에 나뉘어 있다.

- `electron/main.js` — 창 관리, **도우인/샤오홍슈 전용 "숨긴 브라우저 추출 엔진"**, 사이트 로그인(쿠키 수집) 창.
- `server.js` (Express, localhost 로컬 서버로 렌더러와 통신) — yt-dlp 호출, 큐 관리, 재시도/폴백 로직.
- 사이트별 쿠키는 `%APPDATA%` 아래 `cookies/<site>.txt` 에 Netscape 형식으로 저장하고 `--cookies` 로 yt-dlp 에 넘긴다.
- `resources/bin` 에 `yt-dlp.exe · aria2c.exe · ffmpeg.exe · ffprobe.exe` 를 동봉. aria2c 는 멀티커넥션 다운로드 가속용(유튜브는 CDN이 멀티커넥션을 강제로 조인다는 이유로 제외).
- 커스텀 추출기(자체 파서)는 없다. 도우인·샤오홍슈용 "브라우저 추출"은 자체 서명 알고리즘이 아니라 **진짜 Electron BrowserWindow(크로미움)를 그대로 이용하는 방식**이다.

## 2. URL 분류와 사이트별 처리 — 한눈에

| 사이트 | 처리 방식 | 비고 |
|---|---|---|
| 유튜브 | yt-dlp 그대로(포맷 선택자로 H.264/AV1 분기) | aria2c 제외(멀티커넥션 시 CDN이 30KB/s로 목조름) |
| 틱톡 | yt-dlp + `--extractor-args tiktok:api_hostname=api.tiktokv.com` | UA 위장(impersonate)은 오히려 블랙리스트당해 제거된 이력 있음 |
| 인스타그램 | yt-dlp + 등록 쿠키(`--cookies`), 없으면 `--cookies-from-browser chrome` | 쿠키는 앱 내장 브라우저 로그인으로 수집 |
| 샤오홍슈 | 도우인과 같은 "브라우저 추출" 대상 | JS 로 영상을 늦게 붙이는 사이트라 yt-dlp 단독으론 약함 |
| 트위터(X) | yt-dlp + 등록 쿠키(연령 제한 미디어 대응) | |
| **도우인** | **yt-dlp 시도 → (사실상 항상 실패) → 숨긴 브라우저 추출로 전환** | 아래 3장에서 상세 |

`applySiteSpecificArgs()` 가 URL 정규식으로 사이트를 나누고, `MAJOR_PLATFORM_HOSTS` 에 오른 사이트는 "브라우저 추출" 대상에서 원칙적으로 제외한다(이미 되는 곳에 25초짜리 느린 폴백을 걸면 헛수고). **도우인만 예외**로 이 제외 목록에 있으면서도 `isDouyin` 플래그로 브라우저 추출을 강제 허용한다 — "주요 플랫폼이지만 yt-dlp 로는 절대 안 되는" 유일한 사례이기 때문이다.

## 3. 도우인 우회 — 핵심 아이디어: "서명을 풀지 않는다, 진짜 브라우저에게 만들게 한다"

### 3-1. 왜 yt-dlp 로 안 되는가
도우인은 영상 재생 요청마다 `X-Bogus` / `a_bogus` 서명 파라미터, 그리고 `msToken` · `ttwid` 쿠키를 요구한다. 이 서명은 도우인의 자바스크립트가 브라우저 안에서 그때그때 계산하는 값이라, yt-dlp(파이썬, JS 엔진 없음)는 이를 만들어낼 수 없다. 이는 SB 개발자가 코드 주석에 직접 남긴 사실이기도 하다.

```js
// server.js 2576행 부근
// v1.5.2: 도우인은 주요 플랫폼이지만 yt-dlp가 전세계 차단(a_bogus 서명, yt-dlp#9667)이라
```

(`yt-dlp#9667` 은 실제 yt-dlp GitHub 이슈 번호로, 2026-09 현재도 미해결 상태다.)

### 3-2. 우회 방식 — 숨긴 BrowserWindow + 네트워크 감청
`electron/main.js` 의 `browserExtract()` 함수(1137행~)가 핵심이다. 순서:

1. **숨긴(`show:false`) BrowserWindow** 를 하나 띄운다. Electron 의 BrowserWindow 는 진짜 크로미움이므로, 도우인 페이지를 열면 **도우인 자신의 자바스크립트가 X-Bogus/a_bogus/msToken/ttwid 를 스스로 계산**해서 영상 CDN 에 요청을 보낸다.
2. `session.webRequest.onHeadersReceived` 로 **그 창이 실제로 받은 모든 응답**을 가로챈다. 그중 실제 영상 CDN 패턴(`douyinvod|zjcdn|/video/tos/` 도메인 + `video/mp4` 콘텐츠타입)에 맞는 것만 후보로 줍는다. UI 애니메이션 mp4, 아이콘 등은 걸러진다.
3. `<video>` 태그의 `currentSrc` 를 우선 채택(가장 정확), 없으면 감청한 후보 중 **가장 큰 것**을 최고화질로 선택한다.
4. `session.webRequest.onBeforeSendHeaders` 로 **그 요청에 실제로 쓰인 Referer/Origin** 도 함께 기록해 둔다 — 나중에 다운로드할 때 CDN 의 핫링크 방지(토큰 검사)를 통과하려면 이 값을 그대로 재현해야 하기 때문이다.
5. 성공하면 세션의 쿠키를 Netscape 파일로 내보내고(`exportSessionCookies`), User-Agent 도 같이 넘긴다.
6. 이렇게 얻은 `{ videoUrl, referer, origin, cookiePath, userAgent }` 를 `server.js` 로 넘기면, `server.js` 는 **그 URL 을 yt-dlp 로** 받는다(`--referer`, `--cookies`, `--user-agent`, 필요 시 `--add-header Origin:...`).

즉 "서명을 훔치거나 계산하는" 게 아니라, **서명이 이미 붙어서 나온 진짜 요청 주소를 옆에서 베껴 쓰는** 방식이다. 서명 로직이 바뀌어도(도우인이 자주 바꾼다) 코드를 고칠 필요가 없다 — 브라우저가 알아서 최신 버전으로 계산해주기 때문이다. 이것이 SB 방식의 가장 큰 강점이다.

### 3-3. 공유 단축 링크(v.douyin.com) 처리
별도의 리다이렉트 해석 코드가 없다. `win.loadURL(rawUrl)` 을 그대로 부르면, 실제 크로미움이 알아서 `v.douyin.com → www.douyin.com/video/...` 리다이렉트를 따라간다. 짧은 링크든 긴 링크든 **완전히 동일한 코드 경로**로 처리된다. (직접 실측: `https://www.iesdouyin.com/share/video/<id>/` 형태도 동일하게 `www.douyin.com/video/<id>` 로 302 리다이렉트됨을 curl 로 확인.)

### 3-4. 워터마크 없는 주소를 어떻게 고르나
별도의 "워터마크 제거" 로직이 없다. **실제 웹페이지가 재생을 위해 요청하는 스트림을 그대로 가로채므로**, 처음부터 워터마크가 있는 공유용 mp4(`playwm`)가 아니라 웹 재생용 원본(`play`) 경로만 잡힌다. "선택"이 아니라 "애초에 그것만 감청 대상"인 구조다.

### 3-5. 로그인·쿠키
- `SITE_CONNECT.douyin` — 앱 안에서 `https://www.douyin.com/` 을 직접 띄워 로그인시키고, 완료(창 닫기) 시 쿠키를 Netscape 파일로 저장한다.
- **게스트에게도 `ttwid`/`msToken` 이 바로 심긴다**는 점에 주의해서, "쿠키가 하나라도 있으면 로그인"으로 오판하지 않고 **`sessionid` 가 있을 때만 로그인**으로 판정한다(SB 실측 주석).
- 추출 시 "연결(로그인) 세션"이 있으면 **그 세션을 그대로 재사용**한다(쿠키 파일로 옮기지 않는다) — `msToken` 처럼 JS 가 실시간으로 심는 쿠키는 파일로 내보내는 순간 이미 낡아 있기 때문이다.

### 3-6. 실패 시 재시도 — "챌린지를 대신 풀지 않는다"
- 숨긴 창에서 실패(`NO_REQUESTS`/`NO_MEDIA_MATCH`/`CLOUDFLARE`/`MEDIA_BLOCKED`)하면, **창을 사람 눈에 보이게 띄워** 로그인·캡차를 사람이 직접 풀게 하고 한 번 더 시도한다(최대 5분 대기).
- 다운로드 단계에서 403 이 나면(=추출 당시 세션이 이미 로그인 상태가 아니었을 가능성) 마찬가지로 창을 띄워 재로그인 후 1회 재시도한다.
- 코드 주석에 명시: "챌린지를 대신 풀지 않는다. 진짜 브라우저가 스스로 통과하길 기다릴 뿐이고, 사람 클릭이 필요한 유형이면 그대로 실패시키고 안내한다." — 즉 캡차 자동 우회 같은 공격적인 수법은 쓰지 않는다.

## 4. 그 외 사이트(참고)

- **틱톡**: `--extractor-args tiktok:api_hostname=api.tiktokv.com` 고정. UA 를 크롬으로 위장하는 실험은 오히려 틱톡에 블랙리스트당해 제거된 이력이 코드 주석에 남아 있다(2026-08-14).
- **인스타그램**: yt-dlp + 등록 쿠키. 쿠키가 없으면 `--cookies-from-browser chrome` 시도(대개 App-Bound Encryption 으로 실패 → 앱 내 로그인 창이 주된 경로).
- **샤오홍슈**: 도우인과 같은 "브라우저 추출" 대상(JS 로 영상을 늦게 그리는 사이트라 yt-dlp 단독 대응이 약함).
- **빌리빌리·콰이쇼우**: 코드 전체(`server.js`/`main.js`)에서 관련 문자열이 전혀 발견되지 않았다 — SB 1.5.4 는 이 두 사이트를 별도 취급하지 않는다(지원 목록에 없거나 yt-dlp 기본 추출기에만 의존).
- **aria2c**: 멀티커넥션(-x16 -s16) 가속용. 유튜브·구간 다운로드·HLS 는 제외. 실패 시 내장 다운로더로 1회 자동 재시도.

## 5. Piggy 이식 내역

| SB 원본 | Piggy 이식 | 파일 |
|---|---|---|
| `browserExtract()`(도우인 전용 분기) | `resolve()` / `resolveWithRetry()` | `src/main/douyin.js` (신규) |
| `SITE_CONNECT.douyin`(로그인 창) | `SITES.douyin` 항목 추가 | `src/main/sitelogin.js` |
| `session.webRequest` 감청 | 동일 원리(Piggy 의 기존 `threads.js` 패턴과 통일) | `src/main/douyin.js` |
| `exportSessionCookies` | `exportCookieFile()` | `src/main/douyin.js` |
| `direct-dl`(추출 URL을 yt-dlp 로 받기) | `_directHeaders`(referer/origin/UA/cookieFile) + `directHeaderArgs()` | `src/main/ytdlp.js` |
| 403 재시도(로그인 창) | `download()` 의 douyin 분기 catch 안에서 1회 재시도 | `src/main/ytdlp.js` |
| 숨김→보임 재시도(캡차/로그인) | `resolveWithRetry()` | `src/main/douyin.js` |

Piggy 는 이미 Threads 를 같은 원리(숨긴 BrowserWindow + `webRequest` 감청)로 처리하고 있었기 때문에, SB 의 아이디어를 Piggy 고유의 파일 분리 관례(사이트별 리졸버 파일 하나씩)에 맞춰 새로 작성했다 — SB 의 소스 코드를 그대로 옮기지 않았다.

## 6. 이식하지 않은 것 / 못한 것

- **aria2c 동봉** — Piggy 는 "배포할 실행파일을 늘리지 않는다"는 기존 설계 결정(코드 주석 참고)을 유지했다. yt-dlp 자체의 `--concurrent-fragments` 로 같은 효과를 낸다.
- **Sentry 오류 수집** — Piggy 는 사용자 데이터 외부 전송을 하지 않는다는 기존 방침 유지.
- **`--impersonate chrome`** — SB 는 403 재시도 시 이 옵션을 붙이지만, 실측 코드 주석에 "UA 까지 바꿔버려 애써 넘긴 쿠키가 무효화된다"는 부작용이 적혀 있고 실제 효과도 제한적이라 판단해, Piggy 는 이 옵션에 의존하지 않고 "창을 보이게 띄워 재로그인" 경로만 가져왔다.
- **빌리빌리/콰이쇼우** — SB 자체에 해당 코드가 없어 이식할 대상이 없었다(4장 참고).
