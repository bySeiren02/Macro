import { NOTIFICATION_LOG_LIMIT, STORAGE_KEYS } from '../shared/constants';
import { parseRuntime } from '../shared/detection-logic';
import { isRecord } from '../shared/result';
import { parseSettings } from '../shared/settings';
import type { DetectionRuntime, FiredMilestones, MilestoneKind, NotificationLogEntry, Settings } from '../shared/types';

/**
 * chrome.storage에는 트랜잭션이 없다. 서비스 워커는 단일 인스턴스이므로
 * 모든 상태 변경 핸들러를 하나의 promise 큐로 직렬화해 read-modify-write 경합을 막는다.
 * 규칙: serialize는 이벤트 진입점(index.ts)에서만 호출한다. 중첩 호출 시 교착된다.
 */
let queue: Promise<unknown> = Promise.resolve();

export function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return parseSettings(raw[STORAGE_KEYS.settings]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
}

export async function loadRuntime(): Promise<DetectionRuntime> {
  const raw = await chrome.storage.session.get(STORAGE_KEYS.detection);
  return parseRuntime(raw[STORAGE_KEYS.detection]);
}

export async function saveRuntime(runtime: DetectionRuntime): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEYS.detection]: runtime });
}

const MILESTONE_KINDS: readonly string[] = ['T-5', 'T-1', 'T0'];

export async function loadFired(): Promise<FiredMilestones | null> {
  const raw = (await chrome.storage.local.get(STORAGE_KEYS.firedMilestones))[STORAGE_KEYS.firedMilestones];
  if (!isRecord(raw) || typeof raw.openAt !== 'number' || !Array.isArray(raw.kinds)) return null;
  const kinds = raw.kinds.filter((k): k is MilestoneKind => typeof k === 'string' && MILESTONE_KINDS.includes(k));
  return { openAt: raw.openAt, kinds };
}

export async function saveFired(fired: FiredMilestones | null): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.firedMilestones]: fired });
}

export async function loadNotificationLog(): Promise<readonly NotificationLogEntry[]> {
  const raw = (await chrome.storage.session.get(STORAGE_KEYS.notificationLog))[STORAGE_KEYS.notificationLog];
  return Array.isArray(raw) ? (raw as NotificationLogEntry[]) : [];
}

export async function appendNotificationLog(entry: NotificationLogEntry): Promise<void> {
  const log = await loadNotificationLog();
  await chrome.storage.session.set({
    [STORAGE_KEYS.notificationLog]: [entry, ...log].slice(0, NOTIFICATION_LOG_LIMIT),
  });
}

async function loadSessionNumber(key: string): Promise<number | null> {
  const value = (await chrome.storage.session.get(key))[key];
  return typeof value === 'number' ? value : null;
}

export const loadManagedTabId = (): Promise<number | null> => loadSessionNumber(STORAGE_KEYS.managedTabId);
export const loadPendingStart = (): Promise<number | null> => loadSessionNumber(STORAGE_KEYS.pendingStart);

export async function saveManagedTabId(tabId: number | null): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEYS.managedTabId]: tabId });
}

export async function savePendingStart(at: number | null): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEYS.pendingStart]: at });
}
