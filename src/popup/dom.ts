import { isResponse, type PopupRequest } from '../shared/messages';
import { errorMessage } from '../shared/result';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`popup element #${id} not found`);
  return el as T;
}

export const els = {
  badge: byId<HTMLSpanElement>('status-badge'),
  alert: byId<HTMLDivElement>('alert'),
  openDate: byId<HTMLInputElement>('open-date'),
  openTime: byId<HTMLInputElement>('open-time'),
  saveSchedule: byId<HTMLButtonElement>('save-schedule'),
  clearSchedule: byId<HTMLButtonElement>('clear-schedule'),
  countdown: byId<HTMLParagraphElement>('countdown'),
  openAtLabel: byId<HTMLParagraphElement>('open-at-label'),
  targetUrl: byId<HTMLInputElement>('target-url'),
  saveTarget: byId<HTMLButtonElement>('save-target'),
  openTarget: byId<HTMLButtonElement>('open-target'),
  grantPermission: byId<HTMLButtonElement>('grant-permission'),
  tabTitle: byId<HTMLElement>('tab-title'),
  tabStatus: byId<HTMLElement>('tab-status'),
  permissionStatus: byId<HTMLElement>('permission-status'),
  buttonText: byId<HTMLInputElement>('button-text'),
  matchMode: byId<HTMLSelectElement>('match-mode'),
  startDetection: byId<HTMLButtonElement>('start-detection'),
  pauseDetection: byId<HTMLButtonElement>('pause-detection'),
  stopDetection: byId<HTMLButtonElement>('stop-detection'),
  detectionStatus: byId<HTMLElement>('detection-status'),
  buttonState: byId<HTMLElement>('button-state'),
  matchCount: byId<HTMLElement>('match-count'),
  lastChecked: byId<HTMLElement>('last-checked'),
  detectionWarning: byId<HTMLParagraphElement>('detection-warning'),
  prefs: {
    before5m: byId<HTMLInputElement>('pref-before5m'),
    before1m: byId<HTMLInputElement>('pref-before1m'),
    atOpen: byId<HTMLInputElement>('pref-atOpen'),
    onEnabled: byId<HTMLInputElement>('pref-onEnabled'),
    sound: byId<HTMLInputElement>('pref-sound'),
  },
  testNotification: byId<HTMLButtonElement>('test-notification'),
  notificationPermission: byId<HTMLSpanElement>('notification-permission'),
  notificationLog: byId<HTMLOListElement>('notification-log'),
} as const;

/** 백그라운드 호출. 실패는 사용자에게 보여줄 수 있는 Error로 변환한다. */
export async function send<T>(request: PopupRequest): Promise<T> {
  let response: unknown;
  try {
    response = await chrome.runtime.sendMessage(request);
  } catch (e) {
    throw new Error(`백그라운드와 통신하지 못했습니다. 확장 프로그램을 다시 로드해 보세요. (${errorMessage(e)})`);
  }
  if (!isResponse(response)) throw new Error('백그라운드 응답 형식이 올바르지 않습니다.');
  if (!response.ok) throw new Error(response.error);
  return response.data as T;
}

let alertTimer: ReturnType<typeof setTimeout> | null = null;

export function showAlert(message: string, tone: 'error' | 'info'): void {
  els.alert.textContent = message;
  els.alert.dataset.tone = tone;
  els.alert.hidden = false;
  if (alertTimer !== null) clearTimeout(alertTimer);
  // 오류는 사용자가 읽을 수 있도록 유지, 안내는 잠시 후 닫음
  alertTimer = tone === 'info' ? setTimeout(() => (els.alert.hidden = true), 4_000) : null;
}

export function clearAlert(): void {
  els.alert.hidden = true;
}
