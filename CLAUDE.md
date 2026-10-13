# 티켓 오픈 알리미 - 에이전트 작업 가이드

Chrome MV3 확장. 예매 오픈 일정 알림 + 권한 받은 페이지에서 예매 버튼 활성화 감지/알림.
세부 설계는 README.md, 변경 이력/결정 배경은 CHANGELOG.md, 현재 상태는 handoff.md.

## 절대 규칙 (정책)
- **알림 전용 도구.** 자동 클릭/제출, 대기열 우회, CAPTCHA 처리, 비공개 API 호출, 쿠키/토큰/비밀번호 접근, 외부 네트워크 전송, 페이지 새로고침 자동화는 요청이 와도 구현하지 않는다.
- 권한 추가 금지: `tabs`, `cookies`, `webRequest`, `<all_urls>`, manifest의 `host_permissions`/`content_scripts`. 사이트 접근은 `optional_host_permissions` + 런타임 요청만.
- 위 규칙은 `npm run check:invariants`가 기계적으로 검사한다. 검사기를 느슨하게 고쳐 통과시키지 말 것.

## 명령
| 목적 | 명령 | 소요 |
|---|---|---|
| 타입 + 불변식 + 빌드 + unit | `npm run verify:quick` | ~10초 |
| 전체 (e2e 포함) | `npm run verify` (= `npm test`) | ~3분 |
| 특정 e2e | `npm run build:test && npx playwright test -g "<이름>"` | |
| 수동 확인 | `npm run build && npm run dev:browser` | 확장 로드된 Chromium |
| 배포 zip | `npm run package` -> `release/` | |

완료 보고 전 최소 `verify:quick`, 감지/알림/팝업 로직을 바꿨으면 `verify` 전체를 1회 실행한다.

## 코드 지도
- `src/shared/` 순수 로직 (단위 테스트 대상). 새 판정/계산 로직은 여기에 두고 `tests/unit/shared.spec.ts`에 테스트 추가
- `src/background/index.ts` 리스너 등록 + 메시지 라우팅. `popup-api.ts` 팝업 요청 처리
- `src/background/detection.ts` 감지 세션, `schedule.ts` 알람, `notify.ts`/`sound.ts` 알림
- `src/content/` 대상 페이지에서 도는 감지기 (DOM 읽기만)
- `src/popup/` UI (`render.ts`는 textContent/DOM API만)
- `tests/e2e/fixtures.ts` 확장 로드 fixture, 스토리지/알림 기록 헬퍼

## MV3 불변식 (어기면 간헐 버그)
1. 모든 chrome.* 리스너는 `background/index.ts` 최상위에서 동기 등록. 등록 전에 await 금지.
2. 상태 변경 핸들러는 `serialize()`로 감싸서 **진입점에서만** 호출. 내부 함수에서 serialize를 다시 부르면 교착.
3. 서비스 워커 메모리에 상태 저장 금지. 설정은 `storage.local`, 런타임은 `storage.session`.
4. `onMessage`는 `sendResponse` + `return true`. async 리스너 반환값에 의존하지 않는다.
5. 알림은 상태 "전이"에서만. 중복 방지 기록(`firedMilestones`, `lastEnabledNotifiedAt`)은 알림 전에 저장.
6. `chrome.permissions.request`는 클릭 핸들러에서 첫 번째 비동기 호출이어야 한다 (제스처 유실).
7. http 허용 호스트를 바꾸면 `src/shared/url.ts`와 `src/manifest.json`을 함께 수정.
8. 테스트 전용 코드는 `if (__TEST_BUILD__)` 안에만. 배포 빌드에서 제거되는지 build-artifacts 테스트가 확인한다.

## 테스트 작성 규칙
- OS 알림은 직접 관찰할 수 없으므로 `storage.session.notificationLog`로 검증한다 (`countLog`).
- 실제 시간 대기 대신 테스트 훅(`__ticketAlertTest.fireAlarm`)을 사용한다. 실제 alarms 테스트는 1개만 유지.
- 테스트 페이지(`test-page/`) 컨트롤 라벨에 감지 대상 문구("예매하기")를 넣지 않는다.
- 실제 티켓팅 사이트를 대상으로 자동화 테스트를 작성하지 않는다.

## 하네스
- `.claude/agents/mv3-reviewer.md`: 이 저장소 불변식 기준 리뷰어. 감지/알림/권한 관련 변경 후 사용
- `.claude/skills/verify`: 검증 단계와 실패 대응 절차
- `.claude/skills/release`: 버전 업, CHANGELOG, zip 생성
- `scripts/harness/after-edit.mjs`: 편집 후 tsc + 불변식 검사 hook (실패 시에만 컨텍스트 출력)
- `.github/workflows/ci.yml`: push/PR마다 `npm test`
