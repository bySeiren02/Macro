// Claude Code PostToolUse(Edit|Write) hook용: 소스/테스트 파일이 바뀌면 타입체크 + 불변식 검사를 돌리고
// 실패 내용을 에이전트 컨텍스트로 돌려준다. 성공 시에는 아무것도 출력하지 않아 컨텍스트를 아끼고,
// 관련 없는 파일(문서 등)은 즉시 통과한다.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_OUTPUT = 3_000;

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
  });
}

function run(cmd, args) {
  try {
    execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    return null;
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`.trim().slice(0, MAX_OUTPUT);
  }
}

const input = JSON.parse((await readStdin()) || '{}');
const file = path.resolve(root, input.tool_input?.file_path ?? '');
const rel = path.relative(root, file);
if (rel.startsWith('..') || !/^(src|tests|scripts)\//.test(rel) || !/\.(ts|mjs|json|html)$/.test(rel)) {
  process.exit(0);
}

const failures = [
  ['tsc', run('npx', ['tsc', '--noEmit', '-p', '.'])],
  ['invariants', run(process.execPath, ['scripts/check-invariants.mjs'])],
].filter(([, out]) => out !== null);

if (failures.length) {
  const context = failures.map(([name, out]) => `[${name} 실패]\n${out}`).join('\n\n');
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `${rel} 수정 후 자동 검사 실패. 다음 작업 전에 수정하세요.\n${context}`,
      },
    }),
  );
}
