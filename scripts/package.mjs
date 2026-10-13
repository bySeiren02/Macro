// 배포용 zip 생성: release/ticket-open-alert-<version>.zip  (dist/ 기준, 먼저 npm run build)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const manifestPath = path.join(dist, 'manifest.json');

if (!existsSync(manifestPath)) {
  console.error('dist/manifest.json이 없습니다. 먼저 npm run build 를 실행하세요.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.host_permissions) {
  console.error('dist가 테스트 빌드처럼 보입니다 (host_permissions 존재). npm run build 로 다시 빌드하세요.');
  process.exit(1);
}

const outDir = path.join(root, 'release');
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `ticket-open-alert-${manifest.version}.zip`);
rmSync(out, { force: true });
execFileSync('zip', ['-r', '-q', '-X', out, '.', '-x', '*.map', '-x', '.DS_Store'], { cwd: dist, stdio: 'inherit' });
console.log(`[package] ${path.relative(root, out)}`);
