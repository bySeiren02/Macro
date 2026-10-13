import { isButtonState } from './detection-logic';
import { isRecord } from './result';
import type { ButtonState, DetectorConfig, MatchMode, NotificationPrefs, SoundPattern } from './types';

export type PopupRequest =
  | { readonly type: 'GET_STATE' }
  | { readonly type: 'SAVE_SCHEDULE'; readonly openAt: number | null }
  | { readonly type: 'SAVE_TARGET'; readonly url: string }
  | { readonly type: 'SAVE_DETECTOR'; readonly buttonText: string; readonly matchMode: MatchMode }
  | { readonly type: 'SAVE_NOTIFICATIONS'; readonly prefs: NotificationPrefs }
  | { readonly type: 'OPEN_TARGET' }
  | { readonly type: 'DETECTION_ARM' }
  | { readonly type: 'DETECTION_DISARM' }
  | { readonly type: 'DETECTION_START' }
  | { readonly type: 'DETECTION_PAUSE' }
  | { readonly type: 'DETECTION_STOP' }
  | { readonly type: 'TEST_NOTIFICATION' };

export type ContentRequest =
  | { readonly type: 'DETECTOR_HELLO' }
  | {
      readonly type: 'DETECTOR_REPORT';
      readonly sessionId: string;
      readonly state: ButtonState;
      readonly matchCount: number;
      readonly pageKey: number | null;
    };

export interface OffscreenRequest {
  readonly target: 'offscreen';
  readonly type: 'PLAY_SOUND';
  readonly pattern: SoundPattern;
}

export type Response<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };

export interface HelloReply {
  readonly active: boolean;
  readonly config?: DetectorConfig;
}

export interface ReportReply {
  readonly active: boolean;
}

const SIMPLE_POPUP_TYPES = new Set([
  'GET_STATE',
  'OPEN_TARGET',
  'DETECTION_ARM',
  'DETECTION_DISARM',
  'DETECTION_START',
  'DETECTION_PAUSE',
  'DETECTION_STOP',
  'TEST_NOTIFICATION',
]);

/** 형태(shape)만 검증한다. 값의 의미 검증(URL, 시간 범위 등)은 각 핸들러가 담당. */
export function parsePopupRequest(raw: unknown): PopupRequest | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  if (SIMPLE_POPUP_TYPES.has(raw.type)) return { type: raw.type } as PopupRequest;
  switch (raw.type) {
    case 'SAVE_SCHEDULE':
      return raw.openAt === null || typeof raw.openAt === 'number' ? { type: raw.type, openAt: raw.openAt } : null;
    case 'SAVE_TARGET':
      return typeof raw.url === 'string' ? { type: raw.type, url: raw.url } : null;
    case 'SAVE_DETECTOR':
      return typeof raw.buttonText === 'string' && typeof raw.matchMode === 'string'
        ? { type: raw.type, buttonText: raw.buttonText, matchMode: raw.matchMode as MatchMode }
        : null;
    case 'SAVE_NOTIFICATIONS':
      return isRecord(raw.prefs) ? { type: raw.type, prefs: raw.prefs as unknown as NotificationPrefs } : null;
    default:
      return null;
  }
}

export function parseContentRequest(raw: unknown): ContentRequest | null {
  if (!isRecord(raw)) return null;
  if (raw.type === 'DETECTOR_HELLO') return { type: 'DETECTOR_HELLO' };
  if (
    raw.type === 'DETECTOR_REPORT' &&
    typeof raw.sessionId === 'string' &&
    isButtonState(raw.state) &&
    typeof raw.matchCount === 'number' &&
    Number.isInteger(raw.matchCount) &&
    raw.matchCount >= 0 &&
    (raw.pageKey === null || (typeof raw.pageKey === 'number' && Number.isFinite(raw.pageKey)))
  ) {
    return {
      type: raw.type,
      sessionId: raw.sessionId,
      state: raw.state,
      matchCount: Math.min(raw.matchCount, 10_000),
      pageKey: raw.pageKey,
    };
  }
  return null;
}

export function isOffscreenRequest(raw: unknown): raw is OffscreenRequest {
  return (
    isRecord(raw) &&
    raw.target === 'offscreen' &&
    raw.type === 'PLAY_SOUND' &&
    (raw.pattern === 'alert' || raw.pattern === 'chime')
  );
}

export function isResponse(raw: unknown): raw is Response<unknown> {
  return isRecord(raw) && typeof raw.ok === 'boolean';
}
