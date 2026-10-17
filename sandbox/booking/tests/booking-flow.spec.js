// 기본 흐름: data-testid로 요소를 찾고, 상태(활성/표시)를 확인한 뒤 클릭한다.
import { test, expect } from './local-only.js';

test.beforeEach(async ({ request, page }) => {
  void request; // fixture 사용 -> 서버 상태 reset
  await page.goto('/');
  await expect(page.getByTestId('seat-grid').getByRole('button')).toHaveCount(10);
});

test('좌석 선택 -> 선점 -> 확정', async ({ page }) => {
  const seat = page.getByTestId('seat-A3');
  const holdButton = page.getByTestId('hold-button');
  const confirmButton = page.getByTestId('confirm-button');

  // 클릭 전 상태를 명시적으로 검증하면 "왜 실패했는지"가 리포트에 바로 드러난다.
  await expect(holdButton).toBeDisabled();
  await expect(seat).toBeEnabled();
  await seat.click(); // locator.click()은 visible/enabled/stable 상태가 될 때까지 자동 대기
  await expect(seat).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('selected-seat')).toHaveText('A3');

  await expect(holdButton).toBeEnabled();
  await holdButton.click();
  await expect(page.getByTestId('status-message')).toContainText('선점했습니다');

  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();

  const result = page.getByTestId('booking-result');
  await expect(result).toBeVisible();
  await expect(result).toHaveAttribute('data-booking-id', /^BK-[0-9A-F]{8}$/);
  await expect(page.getByTestId('seat-A3')).toHaveAttribute('data-status', 'sold');
  await expect(page.getByTestId('seat-A3')).toBeDisabled();
});

test('판매된 좌석은 다시 선택할 수 없다', async ({ page, request }) => {
  const hold = await (await request.post('/api/holds', { data: { seatId: 'B1', sessionId: 'other' } })).json();
  await request.post('/api/bookings', { data: { holdId: hold.holdId, sessionId: 'other' } });

  await page.reload();
  await expect(page.getByTestId('seat-B1')).toHaveAttribute('data-status', 'sold');
  await expect(page.getByTestId('seat-B1')).toBeDisabled();
});
