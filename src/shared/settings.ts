import { BUTTON_TEXT_MAX } from './constants';
import { err, isRecord, ok } from './result';
import type { MatchMode, NotificationPrefs, Result, Settings } from './types';
import { validateTargetUrl } from './url';

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = Object.freeze({
  before5m: true,
  before1m: true,
  atOpen: true,
  onEnabled: true,
  sound: true,
});

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  schedule: Object.freeze({ openAt: null }),
  target: Object.freeze({ url: null }),
  detector: Object.freeze({ buttonText: '예매하기', matchMode: 'contains' as MatchMode }),
  notifications: DEFAULT_NOTIFICATION_PREFS,
});

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function validateButtonText(input: unknown): Result<string> {
  if (typeof input !== 'string') return err('버튼 텍스트는 문자열이어야 합니다.');
  const text = input.replace(/\s+/g, ' ').trim();
  if (!text) return err('감지할 버튼 텍스트를 입력하세요.');
  if (text.length > BUTTON_TEXT_MAX) return err(`버튼 텍스트는 ${BUTTON_TEXT_MAX}자 이하여야 합니다.`);
  if (CONTROL_CHARS.test(text)) return err('버튼 텍스트에 제어 문자를 사용할 수 없습니다.');
  return ok(text);
}

export function isMatchMode(value: unknown): value is MatchMode {
  return value === 'contains' || value === 'exact';
}

export function parseNotificationPrefs(raw: unknown): Result<NotificationPrefs> {
  if (!isRecord(raw)) return err('알림 설정 형식이 올바르지 않습니다.');
  const keys = Object.keys(DEFAULT_NOTIFICATION_PREFS) as (keyof NotificationPrefs)[];
  if (!keys.every((k) => typeof raw[k] === 'boolean')) return err('알림 설정 값이 올바르지 않습니다.');
  return ok({
    before5m: raw.before5m as boolean,
    before1m: raw.before1m as boolean,
    atOpen: raw.atOpen as boolean,
    onEnabled: raw.onEnabled as boolean,
    sound: raw.sound as boolean,
  });
}

const pickRecord = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});

/**
 * 저장소 값은 손상되었거나 이전 버전일 수 있으므로 필드 단위로 검증하고,
 * 잘못된 필드만 기본값으로 대체한다.
 */
export function parseSettings(raw: unknown): Settings {
  const root = pickRecord(raw);
  const schedule = pickRecord(root.schedule);
  const target = pickRecord(root.target);
  const detector = pickRecord(root.detector);
  const notifications = pickRecord(root.notifications);

  const openAt = typeof schedule.openAt === 'number' && Number.isFinite(schedule.openAt) ? schedule.openAt : null;
  const url = validateTargetUrl(target.url);
  const buttonText = validateButtonText(detector.buttonText);

  const prefs = Object.fromEntries(
    Object.entries(DEFAULT_NOTIFICATION_PREFS).map(([k, d]) => [
      k,
      typeof notifications[k] === 'boolean' ? notifications[k] : d,
    ]),
  ) as unknown as NotificationPrefs;

  return {
    schedule: { openAt },
    target: { url: url.ok ? url.value : null },
    detector: {
      buttonText: buttonText.ok ? buttonText.value : DEFAULT_SETTINGS.detector.buttonText,
      matchMode: isMatchMode(detector.matchMode) ? detector.matchMode : DEFAULT_SETTINGS.detector.matchMode,
    },
    notifications: prefs,
  };
}
