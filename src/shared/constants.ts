export const STORAGE_KEYS = {
  /** chrome.storage.local */
  settings: 'settings',
  firedMilestones: 'firedMilestones',
  /** chrome.storage.session (브라우저 재시작 시 초기화) */
  detection: 'detection',
  notificationLog: 'notificationLog',
  pendingStart: 'pendingStart',
  managedTabId: 'managedTabId',
} as const;

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const ONE_MINUTE_MS = 60_000;
export const MAX_SCHEDULE_AHEAD_MS = 366 * 24 * 60 * ONE_MINUTE_MS;

/** 오픈 시각 이후 이 시간 내에만 T0 알림을 보낸다 (절전 해제 후 늦은 알람 방지) */
export const OPEN_NOTIFICATION_GRACE_MS = 10 * ONE_MINUTE_MS;
/** 활성화 알림 재발송 최소 간격 (상태가 깜빡일 때 알림 폭주 방지) */
export const ENABLED_NOTIFY_COOLDOWN_MS = 30_000;
/** 이 시간 이상 요소를 못 찾으면 경고 표시 */
export const NOT_FOUND_WARNING_MS = 3_000;
/** 하트비트가 끊긴 프레임은 집계에서 제외 (백그라운드 탭 강한 스로틀링 고려해 넉넉히) */
export const FRAME_STALE_MS = 120_000;
export const PENDING_START_TTL_MS = 120_000;
export const NOTIFICATION_LOG_LIMIT = 20;

export const DETECTOR_TIMING = {
  throttleMs: 250,
  pollMs: 2_000,
  heartbeatMs: 5_000,
} as const;

export const DETECTOR_SCRIPT_ID = 'ticket-alert-detector';
export const DETECTOR_FILE = 'content/detector.js';
export const DETECTOR_GLOBAL = '__ticketAlertDetector';
export const NOTIFICATION_ICON = 'icons/icon-128.png';
export const OFFSCREEN_PATH = 'offscreen/offscreen.html';
export const NOTIFICATION_ID_PREFIX = 'ta';

export const BUTTON_TEXT_MAX = 100;
export const URL_MAX = 2048;
