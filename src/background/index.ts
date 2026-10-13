import { INITIAL_RUNTIME } from '../shared/detection-logic';
import { parseContentRequest, parsePopupRequest, type Response } from '../shared/messages';
import { UserError, errorMessage } from '../shared/result';
import {
  handleContentRequest,
  onPermissionsAdded,
  onPermissionsRemoved,
  onTabRemoved,
  onTabUpdated,
  unregisterDetector,
} from './detection';
import { parseNotificationId } from './notify';
import { handlePopupRequest } from './popup-api';
import { catchUpMissedOpen, handleMilestoneAlarm, syncScheduleAlarms } from './schedule';
import { loadRuntime, loadSettings, saveRuntime, serialize } from './store';
import { focusTab, openTarget } from './target-tab';

const logError = (context: string) => (e: unknown) => console.error(`[ticket-alert] ${context}`, e);

/** 확장 설치/업데이트/브라우저 시작 시: 남은 감지 스크립트 정리 + 일정 알람 재동기화 */
async function onBoot(): Promise<void> {
  const now = Date.now();
  const runtime = await loadRuntime();
  if (runtime.status === 'running' || runtime.status === 'paused') {
    await saveRuntime({ ...INITIAL_RUNTIME, message: '확장 프로그램이 다시 시작되어 감지를 종료했습니다.' });
  }
  await unregisterDetector();
  await syncScheduleAlarms(await loadSettings(), now);
  await catchUpMissedOpen(now);
}

const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;

function isExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return sender.url !== undefined && new URL(sender.url).origin === extensionOrigin;
}

function toResponse(error: unknown): Response<never> {
  if (error instanceof UserError) return { ok: false, error: error.message };
  console.error('[ticket-alert] request failed', error);
  return { ok: false, error: `처리 중 오류가 발생했습니다: ${errorMessage(error)}` };
}

/**
 * MV3: 모든 리스너는 최상위에서 동기적으로 등록해야 워커가 이벤트로 깨어났을 때 유실되지 않는다.
 * onMessage는 async 함수 대신 sendResponse + `return true` 패턴을 사용한다.
 */
chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;

  let task: (() => Promise<unknown>) | null = null;
  if (isExtensionPage(sender)) {
    // 팝업 (또는 팝업 페이지를 탭으로 연 경우). 웹 페이지는 externally_connectable이 없어 여기 올 수 없다.
    const request = parsePopupRequest(raw);
    if (request) task = () => handlePopupRequest(request, Date.now());
  } else if (sender.tab !== undefined) {
    const request = parseContentRequest(raw);
    if (request) task = () => handleContentRequest(request, sender, Date.now());
  }
  if (!task) return false; // offscreen 전용 메시지 등은 응답하지 않음

  serialize(task).then(
    (data) => sendResponse({ ok: true, data } satisfies Response<unknown>),
    (error: unknown) => sendResponse(toResponse(error)),
  );
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  serialize(onBoot).catch(logError('onInstalled'));
});

chrome.runtime.onStartup.addListener(() => {
  serialize(onBoot).catch(logError('onStartup'));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  serialize(() => handleMilestoneAlarm(alarm.name, Date.now())).catch(logError('alarm'));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  serialize(() => onTabRemoved(tabId)).catch(logError('tabs.onRemoved'));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  serialize(() => onTabUpdated(tabId, tab)).catch(logError('tabs.onUpdated'));
});

chrome.permissions.onRemoved.addListener(() => {
  serialize(onPermissionsRemoved).catch(logError('permissions.onRemoved'));
});

chrome.permissions.onAdded.addListener((added) => {
  const origins = added.origins ?? [];
  serialize(() => onPermissionsAdded(Date.now(), origins)).catch(logError('permissions.onAdded'));
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (parseNotificationId(notificationId) === null) return;
  serialize(async () => {
    await chrome.notifications.clear(notificationId);
    const [{ target }, runtime] = await Promise.all([loadSettings(), loadRuntime()]);
    if (runtime.tabId !== null) {
      const tab = await chrome.tabs.get(runtime.tabId).catch(() => null);
      if (tab) return focusTab(tab);
    }
    if (target.url) await openTarget(target.url, null);
  }).catch(logError('notifications.onClicked'));
});

// 테스트 빌드 전용 훅: 실제 시간을 기다리지 않고 알람 처리 경로를 검증한다. 프로덕션 번들에서는 제거된다.
if (__TEST_BUILD__) {
  (globalThis as unknown as Record<string, unknown>).__ticketAlertTest = {
    fireAlarm: (name: string) => serialize(() => handleMilestoneAlarm(name, Date.now())),
  };
}
