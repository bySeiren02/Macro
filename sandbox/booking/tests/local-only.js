// 이 샌드박스의 테스트는 로컬 서버만 대상으로 한다. baseURL이 로컬이 아니면 즉시 실패시킨다.
import { test as base, expect } from '@playwright/test';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    assertLocal(baseURL);
    await use(page);
  },
  request: async ({ request, baseURL }, use) => {
    assertLocal(baseURL);
    await request.post('/api/reset'); // 테스트 간 상태 격리
    await use(request);
  },
});

function assertLocal(baseURL) {
  const host = new URL(baseURL ?? '').hostname;
  if (!LOCAL_HOSTS.has(host)) throw new Error(`로컬 서버 전용 테스트입니다: ${baseURL}`);
}

export { expect };
