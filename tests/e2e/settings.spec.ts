import type { Settings } from '../../src/shared/types';
import { TEST_PAGE, expect, openPopup, readStorage, saveTargetUrl, setScheduleInputs, test } from './fixtures';

test.describe('설정 저장 및 복원', () => {
  test('팝업을 닫았다 다시 열어도 모든 설정이 복원된다', async ({ context, extensionId, popup }) => {
    const openAt = Math.ceil((Date.now() + 2 * 3_600_000) / 1000) * 1000;
    await setScheduleInputs(popup, openAt);
    await popup.click('#save-schedule');
    await expect(popup.locator('#alert')).toContainText('일정을 저장했습니다');

    await saveTargetUrl(popup, TEST_PAGE);

    await popup.fill('#button-text', '  예매   하기  ');
    await popup.selectOption('#match-mode', 'exact');
    await popup.locator('#button-text').blur();
    await popup.uncheck('#pref-before5m');
    await popup.uncheck('#pref-sound');

    await expect
      .poll(async () => (await readStorage<Settings>(context, 'local', 'settings'))?.notifications.sound)
      .toBe(false);
    await popup.close();

    const reopened = await openPopup(context, extensionId);
    await expect(reopened.locator('#target-url')).toHaveValue(TEST_PAGE);
    await expect(reopened.locator('#button-text')).toHaveValue('예매 하기'); // 공백 정규화
    await expect(reopened.locator('#match-mode')).toHaveValue('exact');
    await expect(reopened.locator('#pref-before5m')).not.toBeChecked();
    await expect(reopened.locator('#pref-before1m')).toBeChecked();
    await expect(reopened.locator('#pref-sound')).not.toBeChecked();
    await expect(reopened.locator('#open-at-label')).toContainText('KST');

    const settings = await readStorage<Settings>(context, 'local', 'settings');
    expect(settings?.schedule.openAt).toBe(openAt);
    expect(settings?.target.url).toBe(TEST_PAGE);
  });

  test('KST 입력은 시스템 시간대와 무관하게 UTC+9로 저장된다', async ({ context, popup }) => {
    const nextYear = new Date().getUTCFullYear() + 1;
    await popup.fill('#open-date', `${nextYear}-01-01`);
    await popup.fill('#open-time', '09:00:00');
    await popup.click('#save-schedule');
    await expect(popup.locator('#alert')).toContainText('일정을 저장했습니다');
    const settings = await readStorage<Settings>(context, 'local', 'settings');
    expect(settings?.schedule.openAt).toBe(Date.UTC(nextYear, 0, 1, 0, 0, 0));
  });

  test('지난 시각은 저장되지 않는다', async ({ context, popup }) => {
    await setScheduleInputs(popup, Date.now() - 60_000);
    await popup.click('#save-schedule');
    await expect(popup.locator('#alert')).toContainText('이미 지난 시각');
    expect((await readStorage<Settings>(context, 'local', 'settings'))?.schedule.openAt ?? null).toBeNull();
  });
});

test.describe('잘못된 URL 처리', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['javascript:alert(1)', '허용되지 않는 프로토콜'],
    ['ftp://example.com/ticket', '허용되지 않는 프로토콜'],
    ['file:///etc/passwd', '허용되지 않는 프로토콜'],
    ['data:text/html,hi', '허용되지 않는 프로토콜'],
    ['http://example.com/ticket', 'http 주소는 로컬 테스트'],
    ['ticket.example.com', '올바른 URL 형식이 아닙니다'],
    ['https://user:pw@example.com/', '계정 정보'],
    ['   ', 'URL을 입력하세요'],
  ];

  for (const [input, expected] of cases) {
    test(`거부: ${JSON.stringify(input)}`, async ({ context, popup }) => {
      await popup.fill('#target-url', input);
      await popup.click('#save-target');
      await expect(popup.locator('#alert')).toContainText(expected);
      await expect(popup.locator('#alert')).toHaveAttribute('data-tone', 'error');
      expect((await readStorage<Settings>(context, 'local', 'settings'))?.target.url ?? null).toBeNull();
    });
  }

  test('백그라운드도 독립적으로 URL을 검증한다 (팝업 우회 메시지)', async ({ popup }) => {
    const response = await popup.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'SAVE_TARGET', url: 'javascript:alert(1)' }),
    );
    expect(response).toMatchObject({ ok: false });
  });
});
