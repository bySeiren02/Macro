import { errorMessage } from '../shared/result';
import { validateButtonText } from '../shared/settings';
import { kstToEpoch } from '../shared/time';
import type { MatchMode, NotificationPrefs, PopupState } from '../shared/types';
import { hostPermissionPattern, validateTargetUrl } from '../shared/url';
import { clearAlert, els, send, showAlert } from './dom';
import { populateInputs, render, renderCountdown, renderDetectionWarning, renderLastChecked } from './render';

const REFRESH_MS = 2_000;
const TICK_MS = 250;
const MSG_PERMISSION_DENIED =
  '사이트 접근 권한이 거부되었습니다. 감지는 권한을 허용한 사이트에서만 동작합니다. "권한 허용" 버튼으로 다시 시도하세요.';

let state: PopupState | null = null;
let initialized = false;

async function refresh(): Promise<void> {
  try {
    state = await send<PopupState>({ type: 'GET_STATE' });
    if (!initialized) {
      populateInputs(state.settings);
      initialized = true;
    }
    render(state, Date.now());
  } catch (e) {
    showAlert(errorMessage(e), 'error');
  }
}

/** 버튼 동작 공통 처리: 중복 클릭 방지, 오류 표시, 완료 후 상태 갱신 */
async function runAction(button: HTMLButtonElement, action: () => Promise<string | null>): Promise<void> {
  button.disabled = true;
  try {
    const info = await action();
    if (info) showAlert(info, 'info');
    else clearAlert();
  } catch (e) {
    showAlert(errorMessage(e), 'error');
  } finally {
    button.disabled = false;
    await refresh();
  }
}

function saveSchedule(): Promise<string | null> {
  const parsed = kstToEpoch(els.openDate.value, els.openTime.value);
  if (!parsed.ok) return Promise.reject(new Error(parsed.error));
  return send({ type: 'SAVE_SCHEDULE', openAt: parsed.value }).then(() => '일정을 저장했습니다.');
}

async function saveTarget(): Promise<string | null> {
  const url = validateTargetUrl(els.targetUrl.value);
  if (!url.ok) throw new Error(url.error);
  await send({ type: 'SAVE_TARGET', url: url.value });
  els.targetUrl.value = url.value;
  return 'URL을 저장했습니다. 감지를 사용하려면 "권한 허용"을 눌러 주세요.';
}

function saveDetector(): void {
  const text = validateButtonText(els.buttonText.value);
  if (!text.ok) {
    showAlert(text.error, 'error');
    return;
  }
  send({ type: 'SAVE_DETECTOR', buttonText: text.value, matchMode: els.matchMode.value as MatchMode })
    .then(() => clearAlert())
    .catch((e: unknown) => showAlert(errorMessage(e), 'error'));
}

function saveNotificationPrefs(): void {
  const prefs = Object.fromEntries(
    Object.entries(els.prefs).map(([key, input]) => [key, input.checked]),
  ) as unknown as NotificationPrefs;
  send({ type: 'SAVE_NOTIFICATIONS', prefs }).catch((e: unknown) => showAlert(errorMessage(e), 'error'));
}

/**
 * chrome.permissions.request는 사용자 제스처 안에서 "첫 번째로" 호출해야 한다.
 * 앞에 await가 있으면 제스처가 사라져 요청이 거부될 수 있다.
 */
function requestHostPermission(): Promise<boolean> | null {
  const url = state?.settings.target.url;
  if (!url) return null;
  return chrome.permissions.request({ origins: [hostPermissionPattern(url)] });
}

function onGrantPermission(): void {
  const request = requestHostPermission();
  if (!request) {
    showAlert('먼저 URL을 저장하세요.', 'error');
    return;
  }
  void runAction(els.grantPermission, async () => {
    if (!(await request)) throw new Error(MSG_PERMISSION_DENIED);
    return '사이트 접근 권한이 허용되었습니다.';
  });
}

function onStartDetection(): void {
  if (!state?.settings.target.url) {
    showAlert('먼저 예매 페이지 URL을 저장하세요.', 'error');
    return;
  }
  if (state.tab?.hasPermission) {
    void runAction(els.startDetection, () => send({ type: 'DETECTION_START' }).then(() => '감지를 시작했습니다.'));
    return;
  }
  // 권한 대화상자 때문에 팝업이 닫혀도 백그라운드가 permissions.onAdded로 시작할 수 있도록 먼저 표시
  chrome.runtime.sendMessage({ type: 'DETECTION_ARM' }).catch(() => undefined);
  const request = requestHostPermission();
  void runAction(els.startDetection, async () => {
    if (!request || !(await request)) {
      await send({ type: 'DETECTION_DISARM' });
      throw new Error(MSG_PERMISSION_DENIED);
    }
    await send({ type: 'DETECTION_START' });
    return '감지를 시작했습니다.';
  });
}

function onPauseOrResume(): void {
  const paused = state?.detection.status === 'paused';
  void runAction(els.pauseDetection, () =>
    send({ type: paused ? 'DETECTION_START' : 'DETECTION_PAUSE' }).then(() =>
      paused ? '감지를 재개했습니다.' : '감지를 일시정지했습니다.',
    ),
  );
}

function bindEvents(): void {
  els.saveSchedule.addEventListener('click', () => void runAction(els.saveSchedule, saveSchedule));
  els.clearSchedule.addEventListener('click', () => {
    void runAction(els.clearSchedule, async () => {
      await send({ type: 'SAVE_SCHEDULE', openAt: null });
      els.openDate.value = '';
      els.openTime.value = '';
      return '일정을 해제했습니다.';
    });
  });
  els.saveTarget.addEventListener('click', () => void runAction(els.saveTarget, saveTarget));
  els.openTarget.addEventListener('click', () => {
    void runAction(els.openTarget, () => send<{ created: boolean }>({ type: 'OPEN_TARGET' }).then(() => null));
  });
  els.grantPermission.addEventListener('click', onGrantPermission);
  els.buttonText.addEventListener('change', saveDetector);
  els.matchMode.addEventListener('change', saveDetector);
  els.startDetection.addEventListener('click', onStartDetection);
  els.pauseDetection.addEventListener('click', onPauseOrResume);
  els.stopDetection.addEventListener('click', () => {
    void runAction(els.stopDetection, () => send({ type: 'DETECTION_STOP' }).then(() => '감지를 종료했습니다.'));
  });
  for (const input of Object.values(els.prefs)) input.addEventListener('change', saveNotificationPrefs);
  els.testNotification.addEventListener('click', () => {
    void runAction(els.testNotification, () =>
      send({ type: 'TEST_NOTIFICATION' }).then(
        () => '테스트 알림을 보냈습니다. 보이지 않으면 아래 "알림이 보이지 않나요?"를 확인하세요.',
      ),
    );
  });
}

function tick(): void {
  if (!state) return;
  const now = Date.now();
  renderCountdown(state.settings.schedule.openAt, now);
  renderLastChecked(state.detection, now);
  renderDetectionWarning(state, now);
}

let refreshQueued = false;
function queueRefresh(): void {
  if (refreshQueued) return;
  refreshQueued = true;
  setTimeout(() => {
    refreshQueued = false;
    void refresh();
  }, 50);
}

bindEvents();
chrome.storage.onChanged.addListener(queueRefresh);
setInterval(tick, TICK_MS);
setInterval(() => void refresh(), REFRESH_MS);
void refresh();
