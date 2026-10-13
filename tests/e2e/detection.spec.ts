import type { BrowserContext, Page } from '@playwright/test';
import {
  TEST_PAGE,
  countLog,
  detectionRuntime,
  expect,
  getServiceWorker,
  openTestPage,
  saveTargetUrl,
  setTicketState,
  test,
} from './fixtures';

async function startDetection(popup: Page): Promise<void> {
  await popup.click('#start-detection');
  await expect(popup.locator('#detection-status')).toHaveText('감지 중');
}

async function registeredScripts(context: BrowserContext): Promise<number> {
  const worker = await getServiceWorker(context);
  return worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length);
}

const buttonState = (popup: Page) => popup.locator('#button-state');

test.describe('예매 페이지 관리', () => {
  test('페이지 열기는 기존 탭을 재사용하고 제목/상태를 표시한다', async ({ context, popup }) => {
    await saveTargetUrl(popup, TEST_PAGE);
    await expect(popup.locator('#tab-status')).toHaveText('닫힘');
    await expect(popup.locator('#permission-status')).toHaveText('허용됨');

    const opened = context.waitForEvent('page');
    await popup.click('#open-target');
    const page = await opened;
    await page.waitForLoadState('load');
    await expect(popup.locator('#tab-title')).toHaveText('테스트 야구 예매 페이지');
    await expect(popup.locator('#tab-status')).toHaveText('열림');

    await popup.click('#open-target');
    await popup.click('#open-target');
    await popup.waitForTimeout(500);
    expect(context.pages().filter((p) => p.url() === TEST_PAGE)).toHaveLength(1);
  });

  test('사용자가 직접 연 같은 주소의 탭도 재사용한다', async ({ context, popup }) => {
    await openTestPage(context);
    await saveTargetUrl(popup, TEST_PAGE);
    await popup.click('#open-target');
    await popup.waitForTimeout(500);
    expect(context.pages().filter((p) => p.url() === TEST_PAGE)).toHaveLength(1);
  });
});

test.describe('예매 버튼 상태 감지', () => {
  test('오픈 전 -> 비활성 -> 활성 상태를 순서대로 감지하고 활성화 알림은 1회만 보낸다', async ({ context, popup }) => {
    const page = await openTestPage(context, 'before-open');
    await saveTargetUrl(popup, TEST_PAGE);
    await startDetection(popup);

    await expect(buttonState(popup)).toHaveText('숨겨짐');
    await setTicketState(page, 'disabled');
    await expect(buttonState(popup)).toHaveText('비활성화');
    await setTicketState(page, 'disabled-aria');
    await expect(buttonState(popup)).toHaveText('비활성화');
    expect(await countLog(context, 'button-enabled')).toBe(0);

    await setTicketState(page, 'enabled');
    await expect(buttonState(popup)).toHaveText('활성화됨');
    await expect(popup.locator('#status-badge')).toHaveText('활성화!');
    await expect.poll(() => countLog(context, 'button-enabled')).toBe(1);
    await expect(popup.locator('#last-checked')).toHaveText(/^\d{2}:\d{2}:\d{2} \(\d+초 전\)$/);

    // 하트비트(5초)로 같은 상태가 반복 보고되어도 추가 알림 없음
    await popup.waitForTimeout(6_000);
    expect(await countLog(context, 'button-enabled')).toBe(1);

    // 쿨다운(30초) 내 비활성 -> 활성 깜빡임도 추가 알림 없음
    await setTicketState(page, 'disabled');
    await expect(buttonState(popup)).toHaveText('비활성화');
    await setTicketState(page, 'enabled');
    await expect(buttonState(popup)).toHaveText('활성화됨');
    await popup.waitForTimeout(1_000);
    expect(await countLog(context, 'button-enabled')).toBe(1);
  });

  test('활성화 상태에서 페이지를 열어도 시작 즉시 감지한다', async ({ context, popup }) => {
    await openTestPage(context, 'enabled');
    await saveTargetUrl(popup, TEST_PAGE);
    await startDetection(popup);
    await expect(buttonState(popup)).toHaveText('활성화됨');
    await expect.poll(() => countLog(context, 'button-enabled')).toBe(1);
    await expect(popup.locator('#match-count')).toHaveText('1개');
  });

  test('정확히 일치 모드에서는 부분 일치 요소를 무시한다', async ({ context, popup }) => {
    await openTestPage(context, 'enabled');
    await saveTargetUrl(popup, TEST_PAGE);
    await popup.fill('#button-text', '예매');
    await popup.selectOption('#match-mode', 'exact');
    await startDetection(popup);
    await expect(buttonState(popup)).toHaveText('찾을 수 없음');
  });

  for (const state of ['removed', 'renamed'] as const) {
    test(`페이지 구조 변경(${state}) 시 명확한 오류를 표시한다`, async ({ context, popup }) => {
      const page = await openTestPage(context, 'disabled');
      await saveTargetUrl(popup, TEST_PAGE);
      await startDetection(popup);
      await expect(buttonState(popup)).toHaveText('비활성화');

      await setTicketState(page, state);
      await expect(buttonState(popup)).toHaveText('찾을 수 없음');
      await expect(popup.locator('#detection-warning')).toBeVisible();
      await expect(popup.locator('#detection-warning')).toContainText("'예매하기' 버튼을 찾을 수 없습니다");
      // 요소가 다시 나타나면 경고가 사라진다
      await setTicketState(page, 'disabled');
      await expect(popup.locator('#detection-warning')).toBeHidden();
    });
  }

  test('버튼 클릭 후 다음 화면으로 넘어가면 요소 없음으로 전환되고 추가 알림은 없다', async ({ context, popup }) => {
    const page = await openTestPage(context, 'enabled');
    await saveTargetUrl(popup, TEST_PAGE);
    await startDetection(popup);
    await expect(buttonState(popup)).toHaveText('활성화됨');

    await page.click('#book-btn');
    await expect(page.locator('h2', { hasText: '좌석 선택' })).toBeVisible();
    await expect(buttonState(popup)).toHaveText('찾을 수 없음');
    expect(await countLog(context, 'button-enabled')).toBe(1);
  });

  test('사용자가 새로고침해도 감지가 자동으로 이어진다', async ({ context, popup }) => {
    const page = await openTestPage(context, 'disabled');
    await saveTargetUrl(popup, TEST_PAGE);
    await startDetection(popup);
    await expect(buttonState(popup)).toHaveText('비활성화');

    await page.reload();
    await expect(buttonState(popup)).toHaveText('숨겨짐'); // 새로고침 후 초기 상태(오픈 전)
    await setTicketState(page, 'enabled');
    await expect(buttonState(popup)).toHaveText('활성화됨');
    await expect.poll(() => countLog(context, 'button-enabled')).toBe(1);
  });
});

test.describe('감지 중지', () => {
  test('종료하면 보고/알림이 완전히 멈추고 등록된 스크립트도 해제된다', async ({ context, popup }) => {
    const page = await openTestPage(context, 'disabled');
    await saveTargetUrl(popup, TEST_PAGE);
    await startDetection(popup);
    await expect(buttonState(popup)).toHaveText('비활성화');
    expect(await registeredScripts(context)).toBe(1);

    await popup.click('#stop-detection');
    await expect(popup.locator('#detection-status')).toHaveText('중지됨');
    expect(await registeredScripts(context)).toBe(0);

    await setTicketState(page, 'enabled');
    await page.reload();
    await setTicketState(page, 'enabled');
    await popup.waitForTimeout(6_500); // 하트비트 주기 이상 대기
    const runtime = await detectionRuntime(context);
    expect(runtime?.status).toBe('idle');
    expect(runtime?.lastCheckedAt).toBeNull();
    expect(await countLog(context, 'button-enabled')).toBe(0);
    await expect(buttonState(popup)).toHaveText('-');
  });

  test('일시정지 중에는 감지하지 않고, 재개하면 다시 감지한다', async ({ context, popup }) => {
    const page = await openTestPage(context, 'disabled');
    await saveTargetUrl(popup, TEST_PAGE);
    await startDetection(popup);
    await expect(buttonState(popup)).toHaveText('비활성화');

    await popup.click('#pause-detection');
    await expect(popup.locator('#detection-status')).toHaveText('일시정지');
    await expect(popup.locator('#pause-detection')).toHaveText('재개');
    await setTicketState(page, 'enabled');
    await popup.waitForTimeout(1_500);
    await expect(buttonState(popup)).toHaveText('비활성화');
    expect(await countLog(context, 'button-enabled')).toBe(0);

    await popup.click('#pause-detection');
    await expect(popup.locator('#detection-status')).toHaveText('감지 중');
    await expect(buttonState(popup)).toHaveText('활성화됨');
    await expect.poll(() => countLog(context, 'button-enabled')).toBe(1);
  });

  test('대상 탭을 닫으면 감지가 종료되고 이유를 표시한다', async ({ context, popup }) => {
    const page = await openTestPage(context, 'disabled');
    await saveTargetUrl(popup, TEST_PAGE);
    await startDetection(popup);
    await expect(buttonState(popup)).toHaveText('비활성화');

    await page.close();
    await expect(popup.locator('#detection-status')).toHaveText('중지됨');
    await expect(popup.locator('#detection-warning')).toContainText('대상 탭이 닫혀');
    expect(await registeredScripts(context)).toBe(0);
  });

  test('감지 중에는 URL/버튼 조건을 변경할 수 없다', async ({ context, popup }) => {
    await openTestPage(context, 'disabled');
    await saveTargetUrl(popup, TEST_PAGE);
    await startDetection(popup);
    await expect(popup.locator('#target-url')).toBeDisabled();
    await expect(popup.locator('#button-text')).toBeDisabled();
    const response = await popup.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'SAVE_TARGET', url: 'https://example.com/' }),
    );
    expect(response).toMatchObject({ ok: false });
  });
});

test.describe('서비스 워커 재시작', () => {
  test('워커가 강제 종료되어도 감지가 이어지고 같은 상태로 중복 알림이 발생하지 않는다', async ({ context, popup }) => {
    const page = await openTestPage(context, 'enabled');
    await saveTargetUrl(popup, TEST_PAGE);
    await startDetection(popup);
    await expect(buttonState(popup)).toHaveText('활성화됨');
    await expect.poll(() => countLog(context, 'button-enabled')).toBe(1);

    // 전역 마커가 사라지면 워커가 새 인스턴스로 재시작된 것 (메모리 상태 소실)
    const worker = await getServiceWorker(context);
    const marker = () => worker.evaluate(() => (globalThis as unknown as { __marker?: number }).__marker ?? null);
    await worker.evaluate(() => {
      (globalThis as unknown as { __marker?: number }).__marker = 1;
    });
    const cdp = await context.newCDPSession(popup);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await expect.poll(marker).toBeNull();

    // 하트비트/상태 변경 메시지가 워커를 다시 깨운다. 런타임은 storage.session에 있어 유지된다.
    await popup.waitForTimeout(6_000);
    expect(await countLog(context, 'button-enabled')).toBe(1);
    await setTicketState(page, 'disabled');
    await expect(buttonState(popup)).toHaveText('비활성화');
    expect((await detectionRuntime(context))?.status).toBe('running');
  });
});
