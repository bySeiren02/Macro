import { defineConfig } from '@playwright/test';

const PORT = 4300;
const BASE_URL = `http://127.0.0.1:${PORT}`;
// strict 모드 서버: "테스트 토큰이 운영 설정에서는 통하지 않는다"를 검증하는 용도
export const STRICT_PORT = 4301;

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
  webServer: [
    {
      command: 'node server.js',
      url: `${BASE_URL}/api/seats`,
      env: { PORT: String(PORT), VERIFY_MODE: 'test' },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node server.js',
      url: `http://127.0.0.1:${STRICT_PORT}/api/seats`,
      env: { PORT: String(STRICT_PORT), VERIFY_MODE: 'strict' },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
