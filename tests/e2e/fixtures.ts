import { test as base, chromium, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { toKstParts } from '../../src/shared/time';
import type { DetectionRuntime, NotificationLogEntry } from '../../src/shared/types';

export const TEST_ORIGIN = 'http://127.0.0.1:4173';
export const TEST_PAGE = `${TEST_ORIGIN}/index.html`;
const EXTENSION_PATH = path.resolve('dist-test');

interface Fixtures {
  context: BrowserContext;
  extensionId: string;
  popup: Page;
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'ticket-alert-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium', // 확장 프로그램을 지원하는 new headless
      headless: !process.env.HEADED,
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    await use(context);
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  },
  extensionId: async ({ context }, use) => {
    const worker = await getServiceWorker(context);
    await use(new URL(worker.url()).host);
  },
  popup: async ({ context, extensionId }, use) => {
    await use(await openPopup(context, extensionId));
  },
});

export { expect };

export async function getServiceWorker(context: BrowserContext): Promise<Worker> {
  const [worker] = context.serviceWorkers();
  return worker ?? context.waitForEvent('serviceworker');
}

/** 팝업을 일반 탭으로 연다 (툴바 팝업과 동일한 페이지/코드) */
export async function openPopup(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await expect(page.locator('#detection-status')).not.toHaveText('-');
  return page;
}

export async function readStorage<T>(
  context: BrowserContext,
  area: 'local' | 'session',
  key: string,
): Promise<T | undefined> {
  const worker = await getServiceWorker(context);
  return worker.evaluate(
    async ([a, k]) => (await chrome.storage[a as 'local' | 'session'].get(k))[k as string],
    [area, key] as const,
  ) as Promise<T | undefined>;
}

export async function notificationLog(context: BrowserContext): Promise<NotificationLogEntry[]> {
  return (await readStorage<NotificationLogEntry[]>(context, 'session', 'notificationLog')) ?? [];
}

export async function detectionRuntime(context: BrowserContext): Promise<DetectionRuntime | undefined> {
  return readStorage<DetectionRuntime>(context, 'session', 'detection');
}

export async function countLog(context: BrowserContext, kind: string): Promise<number> {
  return (await notificationLog(context)).filter((e) => e.kind === kind).length;
}

export async function setScheduleInputs(popup: Page, epoch: number): Promise<void> {
  const parts = toKstParts(epoch);
  await popup.fill('#open-date', parts.date);
  await popup.fill('#open-time', parts.time);
}

export async function saveTargetUrl(popup: Page, url: string): Promise<void> {
  await popup.fill('#target-url', url);
  await popup.click('#save-target');
  await expect(popup.locator('#alert')).toContainText('URL을 저장했습니다');
}

export async function openTestPage(context: BrowserContext, state = 'before-open'): Promise<Page> {
  const page = await context.newPage();
  await page.goto(TEST_PAGE);
  await setTicketState(page, state);
  return page;
}

export async function setTicketState(page: Page, state: string): Promise<void> {
  await page.evaluate((s) => (window as unknown as { setTicketState(v: string): void }).setTicketState(s), state);
}
