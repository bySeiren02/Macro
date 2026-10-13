---
name: release
description: 티켓 오픈 알리미 확장의 새 버전을 준비한다 (버전 업, CHANGELOG, 검증, zip 패키징). 사용자가 "릴리스", "버전 올려", "배포 파일 만들어" 를 요청할 때 사용한다.
---

# 릴리스 절차

1. **버전 결정**: 사용자가 지정하지 않았으면 마지막 릴리스 이후 변경을 보고 제안한다 (기능 추가 minor, 수정 patch).
   `git log --oneline <마지막 태그>..HEAD` 로 변경 확인.
2. **버전 반영**: `package.json` 의 `version` 만 수정한다. manifest 버전은 빌드 시 자동 주입된다.
3. **CHANGELOG.md**: 맨 위에 `## <버전> - <YYYY-MM-DD>` 섹션 추가. 추가/수정/설계 결정/삭제된 기능을 구분하고 결정 배경을 적는다.
4. **handoff.md**: 현재 상태의 버전 갱신.
5. **검증**: `verify` 스킬 전체 (e2e 포함). 실패하면 릴리스를 중단한다.
6. **패키징**: `npm run package` -> `release/ticket-open-alert-<버전>.zip`
   - 스크립트가 테스트 빌드를 거부하는지 확인 (host_permissions 없음)
7. **커밋/태그**: 사용자가 요청한 경우에만. 형식 `chore: release v<버전>`, 태그 `v<버전>`. push도 별도로 확인받는다.

`release/` 는 git에 올리지 않는다 (.gitignore).
