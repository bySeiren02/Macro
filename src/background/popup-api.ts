import type { PopupRequest } from '../shared/messages';
import { UserError } from '../shared/result';
import { isMatchMode, parseNotificationPrefs, validateButtonText } from '../shared/settings';
import type { PopupState, Settings } from '../shared/types';
import { validateTargetUrl } from '../shared/url';
import { pauseDetection, startDetection, stopDetection } from './detection';
import { getNotificationPermission, notify } from './notify';
import { saveSchedule, syncScheduleAlarms } from './schedule';
import {
  loadFired,
  loadNotificationLog,
  loadRuntime,
  loadSettings,
  savePendingStart,
  saveSettings,
} from './store';
import { getTargetTabInfo, openTarget } from './target-tab';

async function assertNotDetecting(): Promise<void> {
  const { status } = await loadRuntime();
  if (status === 'running') throw new UserError('감지 중에는 변경할 수 없습니다. 먼저 감지를 종료하거나 일시정지하세요.');
}

async function updateSettings(patch: (s: Settings) => Settings): Promise<Settings> {
  const next = patch(await loadSettings());
  await saveSettings(next);
  return next;
}

async function buildState(now: number): Promise<PopupState> {
  const [settings, detection, notificationLog, notificationPermission, fired] = await Promise.all([
    loadSettings(),
    loadRuntime(),
    loadNotificationLog(),
    getNotificationPermission(),
    loadFired(),
  ]);
  const tab = settings.target.url ? await getTargetTabInfo(settings.target.url, detection.tabId) : null;
  const firedMilestones = fired && fired.openAt === settings.schedule.openAt ? fired.kinds : [];
  return { now, settings, detection, tab, notificationLog, notificationPermission, firedMilestones };
}

export async function handlePopupRequest(request: PopupRequest, now: number): Promise<unknown> {
  switch (request.type) {
    case 'GET_STATE':
      return buildState(now);

    case 'SAVE_SCHEDULE':
      return saveSchedule(request.openAt, now);

    case 'SAVE_TARGET': {
      const url = validateTargetUrl(request.url);
      if (!url.ok) throw new UserError(url.error);
      await assertNotDetecting();
      return updateSettings((s) => ({ ...s, target: { url: url.value } }));
    }

    case 'SAVE_DETECTOR': {
      const text = validateButtonText(request.buttonText);
      if (!text.ok) throw new UserError(text.error);
      if (!isMatchMode(request.matchMode)) throw new UserError('일치 방식이 올바르지 않습니다.');
      await assertNotDetecting();
      const matchMode = request.matchMode;
      return updateSettings((s) => ({ ...s, detector: { buttonText: text.value, matchMode } }));
    }

    case 'SAVE_NOTIFICATIONS': {
      const prefs = parseNotificationPrefs(request.prefs);
      if (!prefs.ok) throw new UserError(prefs.error);
      const next = await updateSettings((s) => ({ ...s, notifications: prefs.value }));
      await syncScheduleAlarms(next, now);
      return next;
    }

    case 'OPEN_TARGET': {
      const { target } = await loadSettings();
      if (!target.url) throw new UserError('먼저 예매 페이지 URL을 저장하세요.');
      return openTarget(target.url, (await loadRuntime()).tabId);
    }

    case 'DETECTION_ARM':
      await savePendingStart(now);
      return null;

    case 'DETECTION_DISARM':
      await savePendingStart(null);
      return null;

    case 'DETECTION_START':
      await savePendingStart(null);
      return startDetection(now);

    case 'DETECTION_PAUSE':
      return pauseDetection();

    case 'DETECTION_STOP':
      return stopDetection('idle', null);

    case 'TEST_NOTIFICATION': {
      const { notifications } = await loadSettings();
      return notify({
        kind: 'test',
        title: '테스트 알림',
        message: '이 알림이 보이면 데스크톱 알림이 정상 동작합니다.',
        requireInteraction: false,
        sound: notifications.sound ? 'chime' : null,
      });
    }
  }
}
