# 티켓 오픈 알리미 (Chrome MV3 확장)

예매 오픈 시각 알림(카운트다운, 5분 전/1분 전/오픈 시점)과, 사용자가 권한을 준 예매 페이지에서
예매 버튼이 **활성화되는 순간**을 감지해 데스크톱 알림과 소리로 알려주는 개인용 도구입니다.

> 알림 전용 도구입니다. 자동 클릭, 대기열 우회, CAPTCHA 처리, 비공개 API 호출, 쿠키/토큰 접근 기능은 없습니다.
> 페이지 새로고침이나 네트워크 요청도 하지 않고, 이미 열린 페이지의 DOM만 읽습니다.

## 기술 스택과 선택 이유

| 항목 | 선택 | 이유 |
|---|---|---|
| 언어 | TypeScript (strict) | 메시지 프로토콜과 저장소 스키마를 타입으로 고정 |
| 번들러 | esbuild (직접 스크립트) | content script는 ES 모듈로 주입할 수 없어 IIFE가 필요. Vite는 엔트리마다 다른 형식이 필요한 확장 빌드에 플러그인(crxjs 등)이 필요하지만, esbuild는 15ms 안에 4개 엔트리를 IIFE로 번들 |
| UI | 순수 DOM + CSS | 팝업 1개 규모라 프레임워크 런타임이 오히려 부담 |
| 테스트 | Playwright (unit + 실제 확장 로드 e2e) | persistent context로 압축 해제 확장을 로드해 서비스 워커/스토리지/알람을 직접 검증 |
| 런타임 의존성 | 없음 | devDependencies만 사용 |

## 아키텍처

```
┌──────────── popup (popup.html) ─────────────┐
│ 입력/표시. 상태는 GET_STATE + storage.onChanged  │
└──────────────┬──────────────────────────────┘
               │ runtime.sendMessage (형태 검증)
┌──────────────▼──────── service worker ──────────────────────────┐
│ index.ts      리스너 최상위 등록, 발신자 검증, serialize() 큐        │
│ schedule.ts   chrome.alarms(T-5/T-1/T0), 발송 기록으로 중복 방지      │
│ detection.ts  registerContentScripts / 세션 / 프레임 집계 / 전이 알림  │
│ target-tab.ts 탭 재사용(감지 탭 > 확장이 연 탭 > 같은 URL 탭)          │
│ notify.ts     chrome.notifications + 세션 알림 기록                 │
│ sound.ts ─────► offscreen.html (WebAudio 알림음)                   │
└──────────────▲──────────────────────────────────────────────────┘
               │ DETECTOR_HELLO / DETECTOR_REPORT(sessionId)
┌──────────────┴──── content/detector.js (대상 사이트, 모든 같은 출처 프레임) ─┐
│ MutationObserver(250ms 스로틀) + 2초 폴링, 상태 변경 시 + 5초 하트비트 보고  │
└───────────────────────────────────────────────────────────────────┘
```

**저장소**
- `chrome.storage.local`: 설정(`settings`), 마일스톤 발송 기록(`firedMilestones`) - 팝업/브라우저를 닫아도 유지
- `chrome.storage.session`: 감지 런타임(세션 ID, 프레임별 상태, 마지막 감지 시간), 알림 기록 - 브라우저 재시작 시 초기화

**MV3 설계 포인트**
- 서비스 워커에는 장기 타이머를 두지 않습니다. 일정은 `chrome.alarms`, 감지 주기는 content script가 담당합니다.
- 워커가 언제 종료되어도 되도록 모든 상태를 storage에 둡니다. 프레임별 상태도 저장하므로 워커 재시작 후 같은 상태를 "새 전이"로 오인해 다시 알리지 않습니다 (e2e로 검증).
- `chrome.storage`에는 트랜잭션이 없어서, 모든 이벤트 핸들러를 하나의 promise 큐(`serialize`)로 직렬화합니다.
- 알람 이름에 `openAt`을 넣어(`ms|<openAt>|T0`), 일정을 바꾼 뒤 늦게 도착한 이전 알람은 무시합니다. 늦게 도착한 알람(절전 해제 등)은 stale로 판정해 버립니다.
- 감지 스크립트는 감지 중에만 `registerContentScripts`로 등록하고(브라우저 재시작 시 자동 해제), 중지하면 등록 해제 후 탭의 모든 인스턴스에 `stop()`을 실행합니다. 늦게 도착한 보고는 세션 ID가 맞지 않아 `active:false` 응답을 받고 content가 스스로 멈춥니다.
- 감지 대상 탭은 `autoDiscardable:false`로 설정해 메모리 세이버가 탭을 폐기하지 않게 합니다.

## 디렉터리 구조

```
.
├── package.json / tsconfig.json / playwright.config.ts
├── scripts/
│   ├── build.mjs              esbuild 번들 + 정적 파일 복사 + manifest 버전 주입 (--test, --watch)
│   ├── icons.mjs              의존성 없는 PNG 아이콘 생성기
│   └── serve-test-page.mjs    로컬 테스트 페이지 서버 (127.0.0.1:4173)
├── src/
│   ├── manifest.json
│   ├── env.d.ts
│   ├── shared/                팝업/워커/content 공용 (순수 함수, 단위 테스트 대상)
│   │   ├── constants.ts  types.ts  result.ts
│   │   ├── time.ts            KST 변환, 카운트다운, 마일스톤 계산
│   │   ├── url.ts             URL 검증, 권한 패턴
│   │   ├── settings.ts        설정 스키마/기본값/검증
│   │   ├── messages.ts        메시지 타입과 형태 검증
│   │   └── detection-logic.ts 프레임 집계, 전이/쿨다운 판정
│   ├── background/            index.ts store.ts schedule.ts detection.ts target-tab.ts notify.ts sound.ts popup-api.ts
│   ├── content/               detector.ts inspect.ts
│   ├── popup/                 popup.html popup.css popup.ts render.ts dom.ts
│   └── offscreen/             offscreen.html offscreen.ts
├── test-page/                 index.html app.js style.css
└── tests/
    ├── unit/                  shared.spec.ts build-artifacts.spec.ts
    └── e2e/                   fixtures.ts settings.spec.ts schedule.spec.ts detection.spec.ts
```

## 설치 및 실행

```bash
npm install
npx playwright install chromium   # 최초 1회 (e2e용)
npm run build                     # dist/ 생성 -> Chrome에 로드
npm test                          # 타입 체크 + 두 빌드 + unit/e2e 전체
npm run test:unit                 # 빠른 단위 테스트
npm run test:e2e                  # dist-test 빌드 후 e2e
HEADED=1 npm run test:e2e         # 브라우저 창을 띄워 확인
npm run watch                     # 개발 중 자동 재빌드 (HTML/CSS/manifest 변경 시 재실행)
npm run serve:test-page           # http://127.0.0.1:4173/index.html
npm run dev:browser               # dist가 로드된 Chromium 창 + 테스트 페이지 + 팝업 탭 자동 실행
```

### Chrome에 개발자 모드로 설치

1. `npm run build`
2. Chrome 주소창에 `chrome://extensions` 입력
3. 오른쪽 위 **개발자 모드** 켜기
4. **압축해제된 확장 프로그램을 로드합니다** 클릭, 프로젝트의 `dist` 폴더 선택
5. 툴바의 퍼즐 아이콘에서 "티켓 오픈 알리미"를 고정
6. 코드를 수정하면 `npm run build` 후 확장 카드의 새로고침 버튼 클릭

> `dist-test`는 테스트 전용 빌드(로컬 호스트 권한 사전 부여 + 테스트 훅)이니 실사용에 로드하지 마세요.

### 로컬 테스트 페이지로 수동 확인

1. `npm run serve:test-page`
2. 팝업에서 URL `http://127.0.0.1:4173/index.html` 저장 -> **권한 허용** -> **감지 시작**
3. 테스트 페이지 아래 컨트롤로 상태 전환: 오픈 전(숨김) / 비활성(disabled) / 비활성(aria) / 활성 / 구조 변경 / 문구 변경
4. `?state=disabled&openIn=10` 으로 열면 10초 뒤 자동 활성화

## 사용 방법

1. **예매 일정**: 날짜/시각을 KST로 입력 -> 일정 저장. 이미 지난 마일스톤(예: 3분 남았을 때의 5분 전 알림)은 울리지 않습니다.
2. **예매 페이지**: https URL 저장 -> **권한 허용**(해당 사이트 하나만 허용됨) -> **페이지 열기**(이미 열려 있으면 그 탭으로 이동)
3. **버튼 감지**: 버튼 문구(기본 "예매하기")와 일치 방식(포함/정확히 일치) 설정 -> **감지 시작**. 활성화되면 알림 + 소리, 알림을 클릭하면 해당 탭으로 이동합니다.
4. **알림 설정**: 종류별 on/off, **테스트 알림**으로 OS 알림이 실제로 보이는지 미리 확인하세요.

## 디버깅

| 대상 | 방법 |
|---|---|
| 서비스 워커 | `chrome://extensions` > 확장 카드의 **서비스 워커** 링크 > DevTools 콘솔 (`[ticket-alert]` 로그) |
| 저장 상태 | 워커 콘솔에서 `await chrome.storage.local.get()` / `await chrome.storage.session.get()` |
| 알람 | 워커 콘솔에서 `await chrome.alarms.getAll()` |
| 감지 스크립트 | 대상 페이지 DevTools > 콘솔 상단 컨텍스트를 "티켓 오픈 알리미"로 전환 |
| 등록 상태 | 워커 콘솔에서 `await chrome.scripting.getRegisteredContentScripts()` |
| 팝업 | 팝업에서 우클릭 > 검사 |
| 소리 | `chrome://inspect/#other`에서 offscreen 문서 검사 |
| e2e 실패 | `test-results/`의 error-context.md, `HEADED=1`로 재실행, `npx playwright test -g "<이름>" --debug` |

**자주 겪는 문제**
- 알림이 안 보임: 팝업 하단 "최근 알림"에 기록이 있으면 확장은 정상입니다. OS 알림 설정(macOS 시스템 설정 > 알림 > Google Chrome, 스타일 "알림" 권장), 방해 금지 모드를 확인하세요.
- "찾을 수 없음": 버튼 문구가 다르거나(정확히 일치 모드), 버튼이 다른 출처의 iframe/Shadow DOM 안에 있는 경우입니다. 오픈 전이라 아직 버튼이 없을 수도 있습니다.
- "등록한 사이트가 아닌 페이지": 로그인/대기열 페이지로 리다이렉트된 상태입니다. 원래 사이트로 돌아오면 자동으로 다시 감지합니다.
- 코드 수정 후 동작이 이상함: 확장을 새로고침하면 기존 탭의 감지 스크립트는 무효화됩니다. 감지를 다시 시작하세요.

## 권한과 주의사항

| 권한 | 용도 |
|---|---|
| `storage` | 설정/런타임 상태 저장 (로컬에만 저장, 외부 전송 없음) |
| `alarms` | 오픈 5분 전/1분 전/오픈 알림 예약 |
| `notifications` | 데스크톱 알림 |
| `scripting` | 권한을 준 사이트에만 감지 스크립트 주입 |
| `offscreen` | 알림음 재생 (서비스 워커는 오디오 재생 불가) |
| `optional_host_permissions` | 사용자가 **권한 허용**을 누른 사이트 하나만 런타임에 허용. `chrome://extensions` > 세부정보 > 사이트 액세스에서 언제든 회수 가능하며, 회수 시 감지가 즉시 종료됩니다 |

`tabs`, `cookies`, `webRequest`, `<all_urls>` 권한은 요청하지 않습니다. 그래서 권한이 없는 사이트의 탭 제목/주소는 읽을 수 없습니다.

**주의사항**
- 각 예매 사이트의 이용약관을 확인하고 지키세요. 이 도구는 사람이 직접 예매하도록 알려주기만 합니다.
- 감지는 같은 출처 프레임만 대상으로 합니다. 다른 도메인 iframe, closed Shadow DOM 안의 버튼은 감지할 수 없습니다.
- 백그라운드 탭에서는 Chrome이 타이머를 제한합니다(5분 이상 숨겨진 탭은 분당 1회 수준). DOM 변경 자체는 MutationObserver로 즉시 감지하지만, "마지막 감지 시간" 갱신은 늦어질 수 있습니다. 오픈 직전에는 대상 탭을 별도 창에 띄워 보이게 두는 것을 권장합니다.
- 사이트가 클래스명(`.disabled`)만으로 비활성을 표현하고 `pointer-events`도 그대로 두면 활성으로 판단될 수 있습니다. 실제 사이트에서 테스트 알림과 함께 미리 확인하세요.
- 압축 해제 확장은 알람 최소 지연(30초) 제한을 받지 않지만, 알람은 수 초 늦을 수 있습니다. 카운트다운은 팝업에서 로컬 시계로 계산하므로 PC 시계를 동기화해 두세요.
- 일부 OS에서는 권한 대화상자가 뜨면 팝업이 닫힙니다. 이 경우에도 권한을 허용하면 백그라운드가 감지를 자동 시작합니다(2분 내).
