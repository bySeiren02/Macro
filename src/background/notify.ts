import { NOTIFICATION_ICON, NOTIFICATION_ID_PREFIX } from '../shared/constants';
import { errorMessage } from '../shared/result';
import type { NotificationKind, NotificationLogEntry, SoundPattern } from '../shared/types';
import { playSound } from './sound';
import { appendNotificationLog } from './store';

export interface NotifyOptions {
  readonly kind: NotificationKind;
  readonly title: string;
  readonly message: string;
  readonly requireInteraction: boolean;
  readonly sound: SoundPattern | null;
}

/** 알림 id는 매번 고유해야 한다. 같은 id를 재사용하면 기존 알림이 조용히 교체된다. */
function makeNotificationId(kind: NotificationKind): string {
  return `${NOTIFICATION_ID_PREFIX}|${kind}|${Date.now()}|${crypto.randomUUID().slice(0, 8)}`;
}

export function parseNotificationId(id: string): NotificationKind | null {
  const [prefix, kind] = id.split('|');
  return prefix === NOTIFICATION_ID_PREFIX && kind ? (kind as NotificationKind) : null;
}

/**
 * 데스크톱 알림 + (선택) 소리. 알림 실패해도 소리는 독립 채널로 시도한다.
 * 결과는 세션 로그에 남겨 팝업에서 확인할 수 있게 한다. (호출자는 serialize 안에서 호출)
 */
export async function notify(options: NotifyOptions): Promise<NotificationLogEntry> {
  const id = makeNotificationId(options.kind);
  let delivered = false;
  let error: string | null = null;
  try {
    await chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL(NOTIFICATION_ICON),
      title: options.title,
      message: options.message,
      priority: 2,
      requireInteraction: options.requireInteraction,
    });
    delivered = true;
  } catch (e) {
    error = errorMessage(e);
    console.error('[ticket-alert] notification failed', e);
  }

  if (options.sound) {
    // 소리 재생은 큐를 막지 않도록 기다리지 않는다
    playSound(options.sound).catch((e: unknown) => console.warn('[ticket-alert] sound failed', e));
  }

  const entry: NotificationLogEntry = {
    id,
    kind: options.kind,
    title: options.title,
    message: options.message,
    createdAt: Date.now(),
    delivered,
    sound: options.sound !== null,
    error,
  };
  await appendNotificationLog(entry);
  return entry;
}

export async function getNotificationPermission(): Promise<'granted' | 'denied' | 'unknown'> {
  try {
    const level = await chrome.notifications.getPermissionLevel();
    return level === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unknown';
  }
}
