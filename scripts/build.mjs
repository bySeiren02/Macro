// 사용법: node scripts/build.mjs [--test] [--watch]
//   기본    -> dist/       (Chrome에 로드할 배포용 빌드)
//   --test  -> dist-test/  (Playwright용: 로컬 호스트 권한 사전 부여 + 테스트 훅 포함)
import * as esbuild from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeIcons } from './icons.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isTest = process.argv.includes('--test');
const isWatch = process.argv.includes('--watch');
const outDir = path.join(root, isTest ? 'dist-test' : 'dist');

const STATIC_FILES = [
  ['src/popup/popup.html', 'popup/popup.html'],
  ['src/popup/popup.css', 'popup/popup.css'],
  ['src/offscreen/offscreen.html', 'offscreen/offscreen.html'],
];

/** content script는 모듈로 주입할 수 없으므로 모든 엔트리를 IIFE로 번들 */
const buildOptions = {
  absWorkingDir: root,
  entryPoints: {
    background: 'src/background/index.ts',
    'popup/popup': 'src/popup/popup.ts',
    'offscreen/offscreen': 'src/offscreen/offscreen.ts',
    'content/detector': 'src/content/detector.ts',
  },
  outdir: outDir,
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  sourcemap: isTest ? 'linked' : false, // 배포 빌드는 맵 제외 (번들은 minify하지 않아 그대로 읽을 수 있음)
  minifySyntax: true, // define된 __TEST_BUILD__ 분기(dead code) 제거
  legalComments: 'none',
  define: { __TEST_BUILD__: JSON.stringify(isTest) },
  logLevel: 'info',
};

async function writeManifest() {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(root, 'src/manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  if (isTest) {
    // Playwright는 권한 대화상자를 조작할 수 없으므로 로컬 테스트 서버 권한만 미리 부여
    manifest.name = `${manifest.name} (TEST)`;
    manifest.host_permissions = ['http://127.0.0.1/*', 'http://localhost/*'];
  }
  await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function copyStatic() {
  for (const [from, to] of STATIC_FILES) {
    const dest = path.join(outDir, to);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(path.join(root, from), dest);
  }
  await writeManifest();
  await writeIcons(path.join(outDir, 'icons'));
}

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await copyStatic();
    await ctx.watch();
    console.log(`[build] watching -> ${path.relative(root, outDir)} (HTML/CSS/manifest 변경 시 재실행 필요)`);
    return;
  }
  await esbuild.build(buildOptions);
  await copyStatic();
  console.log(`[build] done -> ${path.relative(root, outDir)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
