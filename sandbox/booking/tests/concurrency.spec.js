// 동시성 검증: 같은 좌석에 요청이 동시에 몰려도 서버가 정확히 1건만 승인하는지 확인한다.
// (클라이언트를 빠르게 만드는 테스트가 아니라, 서버의 중복 예매 방지 로직을 검증하는 테스트)
import { test, expect } from './local-only.js';

const USERS = 5;

test('API: 동시 선점 요청 중 1건만 성공 (좌석 락)', async ({ request }) => {
  const responses = await Promise.all(
    Array.from({ length: USERS }, (_, i) =>
      request.post('/api/holds', { data: { seatId: 'A1', sessionId: `user-${i}` } }),
    ),
  );
  const statuses = responses.map((r) => r.status()).sort();
  expect(statuses).toEqual([201, 409, 409, 409, 409]);
});

test('API: 서로 다른 좌석은 서로 막지 않는다', async ({ request }) => {
  const responses = await Promise.all(
    ['A1', 'A2', 'A3', 'A4', 'A5'].map((seatId, i) =>
      request.post('/api/holds', { data: { seatId, sessionId: `user-${i}` } }),
    ),
  );
  expect(responses.every((r) => r.status() === 201)).toBe(true);
});

test('API: 같은 hold로 확정을 중복 요청해도 예매는 1건 (멱등성)', async ({ request }) => {
  const { holdId } = await (await request.post('/api/holds', { data: { seatId: 'B2', sessionId: 'me' } })).json();
  const results = await Promise.all(
    [1, 2, 3].map(() => request.post('/api/bookings', { data: { holdId, sessionId: 'me' } })),
  );
  const bookingIds = new Set(await Promise.all(results.map(async (r) => (await r.json()).bookingId)));
  expect(bookingIds.size).toBe(1);
});

test('UI: 브라우저 세션 여러 개가 같은 좌석을 선점하면 1명만 성공', async ({ browser, request }) => {
  void request; // 서버 상태 reset
  // 각 context는 쿠키/스토리지가 분리된 독립 사용자
  const contexts = await Promise.all(Array.from({ length: 3 }, () => browser.newContext()));
  const pages = await Promise.all(contexts.map((c) => c.newPage()));

  for (const page of pages) {
    await page.goto('/');
    await page.getByTestId('seat-A5').click();
    await expect(page.getByTestId('hold-button')).toBeEnabled();
  }
  await Promise.all(pages.map((page) => page.getByTestId('hold-button').click()));

  const messages = await Promise.all(
    pages.map(async (page) => {
      const status = page.getByTestId('status-message');
      await expect(status).not.toHaveText(/요청 중|^$/);
      return status.textContent();
    }),
  );
  expect(messages.filter((m) => m.includes('선점했습니다'))).toHaveLength(1);
  expect(messages.filter((m) => m.includes('이미 선점'))).toHaveLength(2);

  await Promise.all(contexts.map((c) => c.close()));
});
