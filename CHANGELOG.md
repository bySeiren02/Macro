# CHANGELOG

## Unreleased

### 추가 (학습용 샌드박스) - 2026-10-17
- `sandbox/booking/`: 127.0.0.1 전용 Express 테스트 예매 서버 + Playwright 테스트 6개 (data-testid 기본 흐름, 동시 선점/멱등 확정/다중 브라우저 세션)
- 확장과 분리한 독립 패키지로 둠: 확장은 런타임 의존성 0과 "자동 클릭 금지" 불변식을 유지해야 하므로 express 의존성과 클릭 자동화 테스트를 루트에 섞지 않음
- 좌석 단위 promise-chain 락으로 check-then-write 경쟁 상태 방지. `UNSAFE=1`로 락을 끄면 중복 예매 재현 (5건 동시 -> 5건 모두 201 확인)
- `tests/local-only.js`가 baseURL이 로컬이 아니면 테스트를 실패시킴
- 네트워크 검증: API 응답에 비즈니스 상태 `state`(AVAILABLE/HELD/CONFIRMED) 추가(기존 `status`는 UI 호환 위해 유지). `tests/network.spec.js` 4개 + `network-helpers.js`(클릭-응답 동기화, 실패 시 통신 기록 첨부). 확정 재요청 응답에서 sessionId/holdId 노출 제거

### 추가 (개발 하네스)
- `scripts/check-invariants.mjs`: 정책(자동 조작/외부 통신/쿠키 접근/HTML 삽입 금지)과 manifest 최소 권한을 정적 검사. 사람/CI/에이전트가 같은 기준을 쓰도록 스크립트로 둠
- `npm run verify:quick` / `verify` 단계화, `npm run package` 배포 zip (테스트 빌드 거부)
- `scripts/harness/after-edit.mjs`: 편집 후 tsc + 불변식 검사 hook. 성공 시 무출력으로 컨텍스트 절약
- 프로젝트 `CLAUDE.md`, `.claude/agents/mv3-reviewer.md`, `.claude/skills/{verify,release}`
- `.github/workflows/ci.yml`: push/PR마다 `npm test`
- `npm run dev:browser`: 확장 로드된 Chromium 실행

## 0.1.0 - 2026-10-13

### 추가
- Chrome MV3 확장 초기 구현 (TypeScript + esbuild, 런타임 의존성 없음)
- 예매 일정: KST 입력, 카운트다운, chrome.alarms 기반 5분 전/1분 전/오픈 알림, 발송 기록으로 중복 방지
- 예매 페이지: URL 검증(https, 로컬 http만), 기존 탭 재사용, 제목/탭 상태/권한 상태 표시
- 버튼 감지: 텍스트/접근성 이름 매칭(포함/정확히 일치), not_found/hidden/disabled/enabled 판정, 전이 시에만 알림 + 30초 쿨다운
- 감지 시작/일시정지/재개/종료, 탭 닫힘/권한 회수/다른 출처 이동 처리
- 알림: chrome.notifications + offscreen 문서 WebAudio 알림음, 알림 클릭 시 대상 탭 포커스, 세션 알림 기록
- 로컬 테스트 페이지(7개 상태) 및 정적 서버
- Playwright 테스트 55개 (unit 23, e2e 32), 서비스 워커 강제 종료 회복성 테스트 포함

### 설계 결정
- **Vite 대신 esbuild**: content script는 IIFE여야 하고 엔트리마다 출력 형식이 다르다. 직접 만든 빌드 스크립트 하나로 충분하다.
- **registerContentScripts 사용**: executeScript 재주입 방식 대신 동적 등록을 쓴다. 새로고침, 늦게 추가된 iframe, 워커 재시작에 모두 대응하고, content가 설정을 HELLO로 가져온다.
- **런타임/프레임 상태를 storage.session에 영속화**: 워커가 재시작된 뒤 같은 상태를 새 전이로 오인해 중복 알림이 나는 것을 막는다.
- **단일 promise 큐(serialize)**: chrome.storage에는 트랜잭션이 없어 read-modify-write 경합이 생길 수 있다.
- **알람 이름에 openAt 포함**: 일정을 변경한 뒤 이전 일정의 알람이 늦게 도착하면 무시한다.
- **tabs 권한 없음**: 대상 사이트 호스트 권한만으로 탭 URL과 제목을 읽는다.
- **권한 대화상자 대응**: 대화상자 때문에 팝업이 닫히는 경우를 대비해 pendingStart와 permissions.onAdded로 감지를 자동 시작한다.
- **테스트 빌드(dist-test) 분리**: 로컬 호스트 권한을 미리 부여하고 `__TEST_BUILD__` 알람 훅을 넣는다. 배포 빌드에서는 dead code로 제거된다.
- **배포 빌드 sourcemap 제거**: 보안 리뷰 지적에 따라 테스트 훅 소스가 맵에 남지 않게 했다.

### 수정
- (리뷰) 새로고침 직후 iframe 보고가 최상위 보고보다 먼저 오면 iframe 상태가 지워지던 문제 -> 프레임별 `top.performance.timeOrigin` 페이지 키로 집계
- (리뷰) 대상 사이트와 무관한 권한 추가에도 보류된 감지가 시작되던 문제 -> 추가된 origin 확인
- (리뷰) 탭 확보 실패 시 동적 content script 등록이 남던 문제 -> 실패 시 등록 해제
- 로딩 중인 기존 탭에도 직접 주입 (등록 이전에 커밋된 문서 대응)
- 테스트 페이지 `.book-btn { display }`가 `hidden` 속성을 덮어써, 숨김 상태인데 버튼이 실제로 보이던 문제 (감지기가 정확히 "활성"으로 판정해 발견)
