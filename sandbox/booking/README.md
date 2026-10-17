# 테스트 예매 샌드박스 (127.0.0.1 전용)

Playwright E2E 테스트와 서버 측 동시성 처리(중복 예매 방지)를 공부하기 위한 독립 예제.
상위 프로젝트(크롬 확장)와 의존성/빌드/불변식 검사를 공유하지 않는다.

## 구성
| 파일 | 역할 |
|---|---|
| `server.js` | Express 서버. 좌석 조회, 선점(hold, TTL), 확정(멱등), reset API. `127.0.0.1`에만 바인딩 |
| `public/` | 예매 UI. 모든 상호작용 요소에 `data-testid` |
| `tests/local-only.js` | baseURL이 로컬이 아니면 실패시키는 fixture + 테스트마다 서버 상태 reset |
| `tests/booking-flow.spec.js` | data-testid 기반 기본 흐름 (좌석 선택 -> 선점 -> 확정) |
| `tests/concurrency.spec.js` | 동시 요청 시 1건만 성공하는지, 확정 멱등성, 다중 브라우저 세션 |
| `tests/network-helpers.js` | 응답 predicate, 클릭+응답 동기화(`actAndWaitForApi`), `/api/` 통신 기록기 |
| `public/verify.html`, `verify.js` | 입력 검증 폼 (이름 + 6자리 토큰) |
| `tests/verify-form.spec.js` | 테스트 토큰 성공/실패, 클라이언트·서버 이중 검증, 시도 제한, strict 모드 거부, 운영 기동 차단 |
| `tests/network.spec.js` | 상태 코드 + JSON 비즈니스 상태(`state`) 검증, 409/재요청/가짜 200 응답 사례 |

## 실행
```powershell
cd sandbox/booking
npm install
npx playwright install chromium   # 처음 한 번 (이미 설치돼 있으면 생략)

npm start                         # http://127.0.0.1:4300 브라우저로 직접 확인
npm run start:test                # 검증 모드 test 로 시작 (.env.test)
npm test                          # 서버 2개(test:4300, strict:4301)를 자동 실행하고 테스트 17개 수행
npm run test:headed               # 브라우저 창을 띄워서 실행 과정 보기
npx playwright test --ui          # UI 모드 (단계별 실행, 타임라인)
npm run report                    # 마지막 HTML 리포트
```

## data-testid 탐색 패턴
- `playwright.config.js`의 `testIdAttribute: 'data-testid'` + `page.getByTestId('hold-button')`
- 클릭 전에 `await expect(locator).toBeEnabled()`로 상태를 명시적으로 검증한다. `locator.click()`도 visible/enabled/stable까지 자동 대기하지만, 실패 원인이 리포트에 더 분명하게 드러난다.
- 고정 대기(`waitForTimeout`) 대신 web-first assertion(`toHaveText`, `toHaveAttribute`)으로 상태 변화를 기다린다.
- 목록 안의 요소는 범위를 좁혀서 찾는다: `page.getByTestId('seat-grid').getByRole('button')`

## 네트워크 동기화와 응답 검증
API 응답에는 내부 `status`와 별개로 비즈니스 상태 `state`가 들어 있다: `AVAILABLE` -> `HELD` -> `CONFIRMED`.

```js
// waitForResponse를 클릭 "전에" 등록하고 Promise.all로 함께 기다린다 (클릭 후 등록하면 응답을 놓칠 수 있음)
const [res] = await Promise.all([
  page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/holds'),
  page.getByTestId('hold-button').click(),
]);
expect(res.status()).toBe(201);                                 // 1) HTTP 상태
expect(res.request().postDataJSON()).toMatchObject({ seatId: 'A2' }); // 2) 보낸 요청
expect(await res.json()).toMatchObject({ state: 'HELD' });     // 3) 비즈니스 상태
```
- 응답을 받은 뒤 화면에 반영됐는지는 `expect(locator).toHaveText()` 같은 web-first assertion으로 따로 기다린다.
- `recordApiTraffic(page)`가 `/api/` 요청과 응답을 기록하고, 테스트가 실패하면 `api-traffic.json`으로 리포트에 첨부한다 (`npm run report`).
- `page.route(...).fulfill()`로 "200인데 실패" 응답을 넣어서, 상태 코드만 보고 성공으로 처리하면 안 된다는 점을 보여 준다.

## 입력 검증 폼과 테스트 모드
서버는 `VERIFY_MODE` 환경 변수로 검증 방식을 정한다. **기본값은 strict**이고, 고정 토큰 `TEST42`는 test 모드에서만 통과한다.

| 모드 | TEST42 | 용도 |
|---|---|---|
| `strict` (기본) | 422 거부 | 운영과 같은 설정. 실제라면 외부 검증 서비스에 위임할 자리 |
| `test` | 200 통과 | 로컬/CI 테스트. `NODE_ENV=production`이면 서버가 기동을 거부 |

설계 원칙:
- 테스트 우회는 **서버 설정**으로만 켠다. 요청 헤더나 파라미터로 우회를 켤 수 있으면 그게 곧 운영 취약점이다.
- 클라이언트 검증(`required`, `pattern`)은 UX용이다. 서버는 항상 다시 검증한다 (400 `VALIDATION_FAILED` + `fieldErrors`).
- 실패 5회면 세션을 잠근다 (429). 잠긴 뒤에는 올바른 토큰도 거부한다.
- "운영 설정에서는 테스트 토큰이 안 통한다"도 테스트로 고정한다 (strict 서버 + 기동 차단 테스트).

`npm start`(strict)를 4300에 띄워 둔 채 `npm test`를 실행하면 기존 서버를 재사용해서 test 모드 테스트가 실패한다. 테스트 전에 끄거나 `npm run start:test`로 띄울 것.

## 동시성 실험
서버는 "확인(빈 좌석?) -> DB 지연 -> 쓰기(선점)" 구간을 좌석 단위 promise-chain 락으로 감싼다.
Node가 싱글 스레드여도 `await`가 끼어 있으면 요청이 서로 끼어들어서 경쟁 상태가 생긴다.

```powershell
$env:UNSAFE='1'; npm start        # 락 끔 -> 같은 좌석 동시 선점 5건이 전부 201 (중복 예매)
$env:UNSAFE=$null; npm start      # 락 켬 -> 201 1건, 409 4건
```
환경 변수: `PORT`(4300), `HOLD_TTL_MS`(60000), `DB_DELAY_MS`(30), `UNSAFE`.

### DB 수준 실험 (`experiments/race-lab.mjs`)
워커 스레드 N개가 각자 연결을 열고 SQLite 파일 하나의 같은 좌석을 동시에 선점한다 (서버 여러 대 + DB 1개와 같은 구조).
SharedArrayBuffer 출발선으로 동시에 출발시키고, 라운드마다 "승자 = 1명" 불변식과 lost update를 센다.

```powershell
npm run lab                                  # 5개 전략 비교 (기본 workers=8, rounds=20, gap=5ms)
npm run lab -- --only naive,atomic --gap 0   # 간격 0에서도 naive가 깨지는지
npm run lab -- --workers 32 --rounds 50
```

| 전략 | 핵심 SQL | 원리 |
|---|---|---|
| naive | SELECT 후 UPDATE | 확인과 쓰기 사이에 다른 요청이 끼어듦 (UNSAFE 기대값) |
| atomic | `UPDATE ... WHERE status='AVAILABLE'` + `changes===1` | 확인과 쓰기를 한 문장으로 |
| optimistic | `UPDATE ... WHERE version=?` | 읽은 이후 바뀌었으면 실패, 재시도는 앱 책임 |
| pessimistic | `BEGIN IMMEDIATE` (≈ `SELECT ... FOR UPDATE`) | 읽기 전에 쓰기 락 |
| unique | `holds(seat_id UNIQUE)` | 규칙을 스키마에 맡김 |

naive가 아닌 전략이 불변식을 깨면 종료 코드 1.

실제 서비스로 확장할 때 대응 개념: 프로세스가 여러 개면 메모리 락이 무의미하므로
DB 조건부 업데이트(`UPDATE ... WHERE status='available'`), 유니크 제약, 분산 락(Redis 등), 대기열을 사용한다.

## 범위
테스트 대상은 이 로컬 서버뿐이다. 외부 사이트를 대상으로 쓰지 않는다 (`local-only.js`가 baseURL을 검사).
