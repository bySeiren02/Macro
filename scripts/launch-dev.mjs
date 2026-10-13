// 확장(dist)이 로드된 Chromium 창을 띄우고, 테스트 페이지와 팝업을 탭으로 연다.
// 사용법: npm run build && npm run dev:browser   (창을 닫으면 종료)
// 프로필은 .dev-profile/ 에 유지되어 설정/권한이 다음 실행에도 남는다.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = path.join(root, 'dist');
const testPage = 'http://127.0.0.1:4173/index.html';

if (!existsSync(path.join(extensionPath, 'manifest.json'))) {
  console.error('dist/가 없습니다. 먼저 npm run build 를 실행하세요.');
  process.exit(1);
}

// 테스트 페이지 서버 (이미 실행 중이면 포트 충돌로 종료되며, 기존 서버를 그대로 사용)
const server = spawn(process.execPath, [path.join(root, 'scripts/serve-test-page.mjs')], { stdio: 'ignore' });

const context = await chromium.launchPersistentContext(path.join(root, '.dev-profile'), {
  channel: 'chromium',
  headless: false,
  viewport: null,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});

const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
const extensionId = new URL(worker.url()).host;

const [first] = context.pages();
const page = first ?? (await context.newPage());
await page.goto(testPage);
const popup = await context.newPage();
await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);

console.log(`extension id: ${extensionId}`);
console.log(`popup: chrome-extension://${extensionId}/popup/popup.html`);
console.log('브라우저 창을 닫으면 종료됩니다.');

context.on('close', () => {
  server.kill();
  process.exit(0);
});
