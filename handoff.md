# 현재 상태
- 프로젝트 버전: 0.1.0 (package.json, manifest는 빌드 시 자동 주입)
- 감지-알림-자동 클릭 흐름 추가: 예매 버튼 활성화 시 실제 `click()` 1회 수행, 이후 동일 활성 상태 재진입 시 중복 클릭 방지
- 전체 테스트 상태는 검증 전

# 최근 작업
- 2026-10-17: 예매 버튼 활성화 감지 시 자동 클릭 로직 추가, e2e 회귀 테스트 추가
- 2026-10-13: 최초 구현. code-reviewer WARNING 3건 반영 (프레임 페이지 키 집계, onAdded origin 확인, 등록 정리), security-reviewer PASS (배포 빌드 sourcemap 제거)
- 2026-10-13: `npm run dev:browser` 추가 (확장 로드된 Chromium 자동 실행, 프로필은 .dev-profile/)

- 2026-10-17: 이 PC(Windows)에서 `npm ci` + `npx playwright install chromium` + build 후 `npm run dev:browser` 실행 확인 (정상 기동/종료)

- 2026-10-17: 학습용 `sandbox/booking/` 추가 (독립 package.json, Express 로컬 예매 서버 + Playwright 10개 통과, 네트워크 응답 검증 포함, `npm run lab` DB 동시성 실험, 입력 검증 폼 test/strict 모드). 샌드박스 테스트 17개 통과. 루트 프로젝트와 무관, 루트 `verify:quick` 통과 유지. 사용법은 `sandbox/booking/README.md`

# 알려진 이슈
- 권한 요청 경로(chrome.permissions.request 대화상자)는 e2e에서 검증 불가 (dist-test가 로컬 권한을 미리 부여). 수동 확인 필요
- 다른 출처 iframe / closed Shadow DOM 안의 버튼은 감지 불가 (README에 문서화)
- 클래스명만으로 비활성을 표현하는 사이트는 활성으로 오판할 수 있음
- 백그라운드 탭 강한 스로틀링 시 하트비트/마지막 감지 시간 갱신 지연 (감지 자체는 MutationObserver로 즉시)
- 실제 OS 알림 표시/소리는 headless 테스트에서 검증하지 않음 (세션 알림 기록으로만 검증)

# 다음 TODO
- `npm run verify:quick`로 회귀 검증
- 실제 Chrome 수동 점검: 권한 대화상자, macOS 알림 표시, 알림음, 자동 클릭 동작
- 필요 시 사이트별 예외 처리(클래스명 기반 비활성 판정 옵션)
