import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXPECTED_PERMISSIONS = ['alarms', 'notifications', 'offscreen', 'scripting', 'storage'];
const FORBIDDEN_PERMISSIONS = ['tabs', 'cookies', 'webRequest', 'webRequestBlocking', 'debugger', 'history', '<all_urls>'];

interface Manifest {
  manifest_version: number;
  version: string;
  background: { service_worker: string };
  action: { default_popup: string };
  icons: Record<string, string>;
  permissions: string[];
  host_permissions?: string[];
  optional_host_permissions: string[];
}

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Manifest;
}

for (const dirName of ['dist', 'dist-test']) {
  test.describe(`빌드 결과물: ${dirName}`, () => {
    const dir = path.resolve(dirName);

    test('MV3 manifest와 참조 파일이 모두 존재한다', () => {
      const manifest = readManifest(dir);
      const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
      expect(manifest.manifest_version).toBe(3);
      expect(manifest.version).toBe(pkg.version);
      const files = [
        manifest.background.service_worker,
        manifest.action.default_popup,
        'popup/popup.js',
        'popup/popup.css',
        'content/detector.js',
        'offscreen/offscreen.html',
        'offscreen/offscreen.js',
        ...Object.values(manifest.icons),
      ];
      for (const file of files) expect(existsSync(path.join(dir, file)), file).toBe(true);
      for (const icon of Object.values(manifest.icons)) {
        expect(readFileSync(path.join(dir, icon)).subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
      }
    });

    test('최소 권한만 요청한다', () => {
      const manifest = readManifest(dir);
      expect([...manifest.permissions].sort()).toEqual(EXPECTED_PERMISSIONS);
      for (const p of FORBIDDEN_PERMISSIONS) expect(manifest.permissions).not.toContain(p);
      expect(manifest.optional_host_permissions).toEqual(['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*']);
    });
  });
}

test('배포 빌드에는 호스트 권한과 테스트 훅이 없다', () => {
  expect(readManifest(path.resolve('dist')).host_permissions).toBeUndefined();
  expect(readFileSync(path.resolve('dist/background.js'), 'utf8')).not.toContain('__ticketAlertTest');
});

test('테스트 빌드는 로컬 호스트 권한만 사전 부여한다', () => {
  expect(readManifest(path.resolve('dist-test')).host_permissions).toEqual(['http://127.0.0.1/*', 'http://localhost/*']);
});
