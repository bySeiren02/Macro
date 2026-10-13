import type { BrowserContext } from '@playwright/test';
import { countLog, expect, getServiceWorker, setScheduleInputs, test } from './fixtures';

async function fireAlarm(context: BrowserContext, name: string): Promise<string> {
  const worker = await getServiceWorker(context);
  return worker.evaluate(
    (n) => (globalThis as unknown as { __ticketAlertTest: { fireAlarm(x: string): Promise<string> } }).__ticketAlertTest.fireAlarm(n),
    name,
  );
}

async function alarmNames(context: BrowserContext): Promise<string[]> {
  const worker = await getServiceWorker(context);
  return worker.evaluate(async () => (await chrome.alarms.getAll()).map((a) => a.name).sort());
}

const roundUpToSecond = (ms: number): number => Math.ceil(ms / 1000) * 1000;

test.describe('카운트다운', () => {
  test('남은 시간을 KST 기준으로 표시하고 매초 갱신한다', async ({ popup }) => {
    const openAt = roundUpToSecond(Date.now() + 90 * 60_000);
    await setScheduleInputs(popup, openAt);
    await popup.click('#save-schedule');

    const countdown = popup.locator('#countdown');
    await expect(countdown).toHaveText(/^01:(29:[0-5]\d|30:00)$/);
    const first = await countdown.textContent();
    await expect(countdown).not.toHaveText(first ?? '', { timeout: 3_000 });
    await expect(popup.locator('#open-at-label')).toHaveText(/^오픈: \d{4}-\d{2}-\d{2} \(.\) \d{2}:\d{2}:\d{2} KST$/);
  });

  test('하루 이상 남으면 일 단위로 표시하고, 해제하면 초기화된다', async ({ popup }) => {
    await setScheduleInputs(popup, roundUpToSecond(Date.now() + 2 * 86_400_000 + 3_600_000));
    await popup.click('#save-schedule');
    await expect(popup.locator('#countdown')).toHaveText(/^2일 0[01]:\d{2}:\d{2}$/);
    await popup.click('#clear-schedule');
    await expect(popup.locator('#countdown')).toHaveText('설정된 일정 없음');
  });
});

test.describe('일정 알림', () => {
  test('지나간 마일스톤은 등록하지 않고, 남은 마일스톤만 알람으로 등록한다', async ({ context, popup }) => {
    const openAt = roundUpToSecond(Date.now() + 3 * 60_000);
    await setScheduleInputs(popup, openAt);
    await popup.click('#save-schedule');
    await expect(popup.locator('#alert')).toContainText('일정을 저장했습니다');
    expect(await alarmNames(context)).toEqual([`ms|${openAt}|T-1`, `ms|${openAt}|T0`].sort());
  });

  test('같은 알람이 여러 번 와도 알림은 1회만 발생한다', async ({ context, popup }) => {
    const openAt = roundUpToSecond(Date.now() + 3 * 60_000);
    await setScheduleInputs(popup, openAt);
    await popup.click('#save-schedule');
    await expect(popup.locator('#alert')).toContainText('일정을 저장했습니다');

    expect(await fireAlarm(context, `ms|${openAt}|T-1`)).toBe('fired');
    expect(await fireAlarm(context, `ms|${openAt}|T-1`)).toBe('duplicate');
    expect(await countLog(context, 'milestone-T-1')).toBe(1);

    // 같은 시각을 다시 저장해도 발송 이력이 유지된다
    await popup.click('#save-schedule');
    await expect(popup.locator('#alert')).toContainText('일정을 저장했습니다');
    expect(await fireAlarm(context, `ms|${openAt}|T-1`)).toBe('duplicate');
    expect(await countLog(context, 'milestone-T-1')).toBe(1);
    await expect(popup.locator('#notification-log li[data-kind="milestone-T-1"]')).toHaveCount(1);
  });

  test('이전 일정의 알람과 꺼진 알림 종류는 무시된다', async ({ context, popup }) => {
    const openAt = roundUpToSecond(Date.now() + 10 * 60_000);
    await setScheduleInputs(popup, openAt);
    await popup.click('#save-schedule');
    await expect(popup.locator('#alert')).toContainText('일정을 저장했습니다');

    expect(await fireAlarm(context, `ms|${openAt - 60_000}|T0`)).toBe('outdated');

    await popup.uncheck('#pref-before5m');
    await expect.poll(() => fireAlarm(context, `ms|${openAt}|T-5`)).toBe('disabled');
    expect(await countLog(context, 'milestone-T-5')).toBe(0);
  });

  test('오픈 시각이 되면 실제 alarms 이벤트로 오픈 알림이 1회 발생한다', async ({ context, popup }) => {
    test.setTimeout(90_000);
    const openAt = roundUpToSecond(Date.now() + 5_000);
    await setScheduleInputs(popup, openAt);
    await popup.click('#save-schedule');
    await expect(popup.locator('#alert')).toContainText('일정을 저장했습니다');

    // 압축 해제(unpacked) 확장은 30초 최소 알람 지연이 적용되지 않지만, 여유를 둔다
    await expect.poll(() => countLog(context, 'milestone-T0'), { timeout: 45_000 }).toBe(1);
    expect(await countLog(context, 'milestone-T-5')).toBe(0);
    expect(await countLog(context, 'milestone-T-1')).toBe(0);
    expect(await fireAlarm(context, `ms|${openAt}|T0`)).toBe('duplicate');
    await expect(popup.locator('#countdown')).toHaveText(/^오픈됨/);
  });
});
