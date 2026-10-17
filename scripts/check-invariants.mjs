// 프로젝트 불변식(정책/보안/권한) 정적 검사. 사람, CI, 에이전트 hook이 공통으로 사용한다.
// 사용법: node scripts/check-invariants.mjs   (위반 시 exit 1)
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWED_PERMISSIONS = ['alarms', 'notifications', 'offscreen', 'scripting', 'storage'];
const EXPECTED_OPTIONAL_HOSTS = ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'];
const FORBIDDEN_MANIFEST_KEYS = ['host_permissions', 'externally_connectable', 'web_accessible_resources', 'content_scripts'];

/** 확장 정책: 인증정보 접근, 외부 통신, 동적 코드 실행 금지. 허용된 자동 조작은 감지된 예매 버튼의 실제 click() 한 번만 수행 */
const FORBIDDEN_CODE = [
  { pattern: /document\.cookie|chrome\.cookies/, reason: '쿠키/인증 정보 접근 금지' },
  { pattern: /\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/, reason: '외부 네트워크 요청 금지' },
  { pattern: /\binnerHTML\b|outerHTML\s*=|insertAdjacentHTML|document\.write/, reason: 'HTML 문자열 삽입 금지 (XSS)' },
  { pattern: /\beval\(|new Function\(/, reason: '동적 코드 실행 금지' },
  { pattern: /localStorage|sessionStorage/, reason: 'chrome.storage만 사용 (페이지 저장소 접근 금지)' },
];

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)])),
  );
  return nested.flat();
}

const sameSet = (a, b) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

async function checkManifest(violations) {
  const manifest = JSON.parse(await readFile(path.join(root, 'src/manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3) violations.push('manifest: manifest_version은 3이어야 함');
  const extra = (manifest.permissions ?? []).filter((p) => !ALLOWED_PERMISSIONS.includes(p));
  if (extra.length) violations.push(`manifest: 허용되지 않은 권한 ${extra.join(', ')} (최소 권한 원칙)`);
  if (!sameSet(manifest.optional_host_permissions ?? [], EXPECTED_OPTIONAL_HOSTS)) {
    violations.push('manifest: optional_host_permissions 변경됨 - src/shared/url.ts 검증 규칙과 함께 검토 필요');
  }
  for (const key of FORBIDDEN_MANIFEST_KEYS) {
    if (key in manifest) violations.push(`manifest: "${key}" 사용 금지 (런타임 권한/동적 등록만 사용)`);
  }
}

async function checkUrlRules(violations) {
  const urlTs = await readFile(path.join(root, 'src/shared/url.ts'), 'utf8');
  for (const host of ['localhost', '127.0.0.1']) {
    if (!urlTs.includes(`'${host}'`)) violations.push(`url.ts: 로컬 http 허용 호스트 '${host}'가 manifest와 불일치`);
  }
}

async function checkSource(violations) {
  const files = (await listFiles(path.join(root, 'src'))).filter((f) => /\.(ts|html)$/.test(f));
  for (const file of files) {
    const lines = (await readFile(file, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // 주석 제외
      for (const rule of FORBIDDEN_CODE) {
        if (rule.pattern.test(line)) violations.push(`${path.relative(root, file)}:${i + 1}: ${rule.reason}`);
      }
    });
  }
}

const violations = [];
await checkManifest(violations);
await checkUrlRules(violations);
await checkSource(violations);

if (violations.length) {
  console.error(`[invariants] ${violations.length}건 위반\n${violations.map((v) => `  - ${v}`).join('\n')}`);
  process.exit(1);
}
console.log('[invariants] OK');
