// 네트워크 동기화 + 응답 검증 예제.
// 1) 클릭과 API 응답을 waitForResponse로 묶는다  2) HTTP 상태 코드 확인  3) JSON 본문의 비즈니스 상태값(state) 확인
import { test, expect } from './local-only.js';
import { actAndWaitForApi, api, recordApiTraffic } from './network-helpers.js';

let traffic;

test.beforeEach(async ({ page, request }) => {
  void request; // 서버 상태 reset
  traffic = recordApiTraffic(page);

  // 페이지 로드가 일으키는 GET /api/seats 도 같은 방식으로 동기화한다.
  const [seatsResponse] = await Promise.all([page.waitForResponse(api('GET', '/api/seats')), page.goto('/')]);
  expect(seatsResponse.status()).toBe(200);
  const { seats } = await seatsResponse.json();
  expect(seats).toHaveLength(10);
  expect(seats.every((s) => s.state === 'AVAILABLE')).toBe(true);
});

// 실패한 테스트는 API 통신 기록을 리포트에 첨부한다 (npm run report 로 확인).
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('api-traffic.json', {
      body: JSON.stringify(traffic, null, 2),
      contentType: 'application/json',
    });
  }
});

test('선점 -> 확정: 상태 코드와 비즈니스 상태 AVAILABLE -> HELD -> CONFIRMED', async ({ page }) => {
  await page.getByTestId('seat-A2').click();

  // --- 선점 ---
  const hold = await actAndWaitForApi(page, 'POST', '/api/holds', () => page.getByTestId('hold-button').click());

  expect(hold.response.status()).toBe(201);
  // 요청 본문도 검증할 수 있다: UI가 서버에 무엇을 보냈는지
  expect(hold.response.request().postDataJSON()).toMatchObject({ seatId: 'A2' });
  expect(hold.body).toMatchObject({
    seatId: 'A2',
    state: 'HELD',
    holdId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    expiresAt: expect.any(Number),
  });
  expect(hold.body.expiresAt).toBeGreaterThan(Date.now());
  // 응답 처리 후 UI 반영까지는 web-first assertion으로 기다린다.
  await expect(page.getByTestId('status-message')).toContainText('선점했습니다');

  // --- 확정 ---
  const booking = await actAndWaitForApi(page, 'POST', '/api/bookings', () =>
    page.getByTestId('confirm-button').click(),
  );

  expect(booking.response.status()).toBe(201);
  expect(booking.response.request().postDataJSON()).toMatchObject({ holdId: hold.body.holdId });
  expect(booking.body).toMatchObject({ seatId: 'A2', state: 'CONFIRMED', bookingId: expect.stringMatching(/^BK-/) });
  await expect(page.getByTestId('booking-result')).toHaveAttribute('data-booking-id', booking.body.bookingId);

  // --- 확정 후 UI가 다시 불러온 좌석 목록 응답에도 반영됐는지 ---
  // (확정 클릭에서 이어지는 GET /api/seats 는 위 응답보다 늦게 오므로 별도로 기다리지 않고 API로 직접 조회)
  const seats = await (await page.request.get('/api/seats')).json();
  expect(seats.seats.find((s) => s.id === 'A2').state).toBe('CONFIRMED');
});

test('이미 선점된 좌석: 409 + state HELD + error SEAT_HELD', async ({ page, request }) => {
  // 다른 사용자가 먼저 선점 (API로 사전 조건 구성)
  const other = await request.post('/api/holds', { data: { seatId: 'B3', sessionId: 'other-user' } });
  expect(other.status()).toBe(201);

  await page.getByTestId('seat-B3').click(); // 페이지는 아직 이전 목록을 보고 있어서 선택 가능
  const hold = await actAndWaitForApi(page, 'POST', '/api/holds', () => page.getByTestId('hold-button').click());

  expect(hold.response.status()).toBe(409);
  expect(hold.response.ok()).toBe(false); // ok()는 200~299일 때만 true
  expect(hold.body).toEqual({ error: 'SEAT_HELD', seatId: 'B3', state: 'HELD' });
  await expect(page.getByTestId('status-message')).toHaveText('다른 사용자가 이미 선점한 좌석입니다.');
});

test('같은 hold로 확정 재요청: 200 + replay true + 같은 bookingId', async ({ page }) => {
  await page.getByTestId('seat-A4').click();
  const hold = await actAndWaitForApi(page, 'POST', '/api/holds', () => page.getByTestId('hold-button').click());
  const first = await actAndWaitForApi(page, 'POST', '/api/bookings', () => page.getByTestId('confirm-button').click());
  expect(first.response.status()).toBe(201);

  // 네트워크 재시도/더블 클릭 상황을 흉내 내서 같은 요청을 다시 보낸다. 브라우저 세션의 sessionId를 그대로 사용
  const { sessionId } = first.response.request().postDataJSON();
  const replay = await page.request.post('/api/bookings', { data: { holdId: hold.body.holdId, sessionId } });

  expect(replay.status()).toBe(200);
  expect(await replay.json()).toEqual({
    bookingId: first.body.bookingId,
    seatId: 'A4',
    state: 'CONFIRMED',
    replay: true,
  });
});

test('상태 코드 검사만으로는 부족한 이유: 200이어도 본문으로 판정한다', async ({ page }) => {
  // 서버 응답을 가로채 "200 이지만 비즈니스적으로 실패"인 응답을 주입한다 (디버깅/계약 테스트 기법).
  // 로컬 페이지 안에서 응답을 바꿔치기하는 것이며 실제 서버 상태는 변하지 않는다.
  await page.route('**/api/holds', (route) =>
    route.fulfill({ status: 200, json: { error: 'SEAT_HELD', seatId: 'A1', state: 'HELD' } }),
  );

  await page.getByTestId('seat-A1').click();
  const hold = await actAndWaitForApi(page, 'POST', '/api/holds', () => page.getByTestId('hold-button').click());

  expect(hold.response.status()).toBe(200);
  expect(hold.body.holdId).toBeUndefined();
  expect(hold.body.state).toBe('HELD');
  // UI는 status 201만 성공으로 보므로 오류 문구를 띄워야 한다
  await expect(page.getByTestId('status-message')).toHaveText('다른 사용자가 이미 선점한 좌석입니다.');
  await expect(page.getByTestId('confirm-button')).toBeDisabled();
});
