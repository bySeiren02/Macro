---
name: verify
description: 티켓 오픈 알리미 확장의 변경 사항을 검증한다. 코드 수정 후 완료를 보고하기 전, 또는 사용자가 "검증", "테스트 돌려" 를 요청할 때 사용한다.
---

# 검증 절차

변경 범위에 맞는 가장 짧은 단계부터 실행하고, 실패하면 다음 단계로 넘어가지 않는다.

## 1단계: 빠른 검증 (항상)
```bash
npm run verify:quick
```
타입체크 -> 불변식 검사 -> dist/dist-test 빌드 -> unit 테스트.

## 2단계: e2e (아래 중 하나라도 바꿨으면)
대상: `src/background/**`, `src/content/**`, `src/popup/**`, `src/manifest.json`, `test-page/**`, `tests/e2e/**`
```bash
npx playwright test --project=e2e            # 전체 ~3분
npx playwright test --project=e2e -g "<이름>" # 관련 테스트만 먼저
```

## 실패 대응
- **불변식 위반**: 검사기를 고치지 말고 코드를 정책에 맞게 고친다. 정책 자체를 바꿔야 하면 사용자에게 먼저 묻는다.
- **e2e 실패**: `test-results/<테스트>/error-context.md` 를 읽는다. 타이밍 문제처럼 보여도 바로 timeout을 늘리지 말고, 원인이 기능 쪽인지 먼저 확인한다 (예: 테스트 페이지 CSS가 hidden을 덮어쓴 사례).
- **headless에서만 실패**: `HEADED=1 npx playwright test -g "<이름>"` 으로 재현한다.
- 같은 테스트를 이유 없이 반복 실행하지 않는다. 수정 1회 후 재검증 1회.

## 보고
실행한 명령, 통과/실패 수, 실패가 있으면 원인과 조치를 짧게 보고한다. 실행하지 않은 단계는 실행하지 않았다고 명시한다.
