# 현재 상태
- 프로젝트 버전: 0.1.0 (package.json, manifest는 빌드 시 자동 주입)
- 1~7단계 완료: 설계, 빌드 체계, 일정/카운트다운, 버튼 감지/알림, 테스트 페이지 + Playwright, 리뷰 반영, README 가이드
- 전체 테스트 55개 통과 (`npm test`: tsc + dist/dist-test 빌드 + unit 23 + e2e 32)
- git: https://github.com/bySeiren02/Macro (main, 최신 33483a2). GitHub Actions CI 통과 (ubuntu, npm test 전체)

# 최근 작업
- 2026-10-13: 최초 구현. code-reviewer WARNING 3건 반영 (프레임 페이지 키 집계, onAdded origin 확인, 등록 정리), security-reviewer PASS (배포 빌드 sourcemap 제거)

- 2026-10-13: `npm run dev:browser` 추가 (확장 로드된 Chromium 자동 실행, 프로필은 .dev-profile/)

- 2026-10-13: 개발 하네스 구성 (CLAUDE.md, 불변식 검사, verify 단계, mv3-reviewer, verify/release 스킬, CI, .claude/settings.json 편집 후 검사 hook)

# 알려진 이슈
- 권한 요청 경로(chrome.permissions.request 대화상자)는 e2e에서 검증 불가 (dist-test가 로컬 권한을 미리 부여). 수동 확인 필요
- 다른 출처 iframe / closed Shadow DOM 안의 버튼은 감지 불가 (README에 문서화)
- 클래스명만으로 비활성을 표현하는 사이트는 활성으로 오판할 수 있음
- 백그라운드 탭 강한 스로틀링 시 하트비트/마지막 감지 시간 갱신 지연 (감지 자체는 MutationObserver로 즉시)
- 실제 OS 알림 표시/소리는 headless 테스트에서 검증하지 않음 (세션 알림 기록으로만 검증)

# 다음 TODO
- 실제 Chrome 수동 점검 (2026-10-16 dist 로드 확인됨): 권한 대화상자, macOS 알림 표시, 알림음, 알림 클릭 이동
- (선택) 클래스명 기반 비활성 판정 옵션 (예: 사용자 지정 disabled 클래스)
- (선택) 오픈 시각에 감지 자동 시작 옵션
