import { defineConfig } from '@playwright/test';

const PORT = 4300;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // 서버 상태(메모리)를 테스트마다 reset 하므로 순차 실행
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    testIdAttribute: 'data-testid',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node server.js',
    url: `${BASE_URL}/api/seats`,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
  },
});
