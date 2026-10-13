import { defineConfig } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // 확장 프로그램 테스트는 persistent context를 사용하므로 순차 실행
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  webServer: {
    command: 'node scripts/serve-test-page.mjs',
    url: `http://127.0.0.1:${PORT}/index.html`,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'unit', testDir: 'tests/unit' },
    { name: 'e2e', testDir: 'tests/e2e' },
  ],
});
