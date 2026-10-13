import { BUTTON_STATE_LABEL, notFoundWarning } from '../shared/detection-logic';
import { formatDuration, formatKst, formatKstTime, toKstParts } from '../shared/time';
import type { DetectionRuntime, NotificationLogEntry, PopupState, Settings, TargetTabInfo } from '../shared/types';
import { els } from './dom';

const STATUS_LABEL: Readonly<Record<DetectionRuntime['status'], string>> = {
  idle: '중지됨',
  running: '감지 중',
  paused: '일시정지',
  error: '오류',
};

/** 입력 필드는 팝업을 열 때 한 번만 채운다 (사용자가 입력 중인 값을 덮어쓰지 않도록) */
export function populateInputs(settings: Settings): void {
  if (settings.schedule.openAt !== null) {
    const parts = toKstParts(settings.schedule.openAt);
    els.openDate.value = parts.date;
    els.openTime.value = parts.time;
  }
  els.targetUrl.value = settings.target.url ?? '';
  els.buttonText.value = settings.detector.buttonText;
  els.matchMode.value = settings.detector.matchMode;
  for (const [key, input] of Object.entries(els.prefs)) {
    input.checked = settings.notifications[key as keyof Settings['notifications']];
  }
}

export function renderCountdown(openAt: number | null, now: number): void {
  if (openAt === null) {
    els.countdown.textContent = '설정된 일정 없음';
    els.countdown.dataset.tone = 'idle';
    els.openAtLabel.textContent = '';
    return;
  }
  const remaining = openAt - now;
  els.openAtLabel.textContent = `오픈: ${formatKst(openAt)}`;
  if (remaining > 0) {
    els.countdown.textContent = formatDuration(remaining, 'ceil');
    els.countdown.dataset.tone = remaining <= 60_000 ? 'soon' : 'normal';
  } else {
    els.countdown.textContent = `오픈됨 (+${formatDuration(-remaining)})`;
    els.countdown.dataset.tone = 'open';
  }
}

function renderBadge(runtime: DetectionRuntime): void {
  const enabled = runtime.status === 'running' && runtime.buttonState === 'enabled';
  els.badge.textContent = enabled ? '활성화!' : STATUS_LABEL[runtime.status];
  els.badge.dataset.tone = enabled ? 'success' : runtime.status;
}

function renderTab(tab: TargetTabInfo | null): void {
  if (!tab) {
    els.tabTitle.textContent = '-';
    els.tabStatus.textContent = 'URL 미등록';
    els.permissionStatus.textContent = '-';
    return;
  }
  els.tabTitle.textContent = tab.title ?? (tab.exists ? '(권한이 없어 제목을 읽을 수 없음)' : '-');
  els.tabStatus.textContent = tab.exists ? (tab.loading ? '로딩 중' : '열림') : '닫힘';
  els.permissionStatus.textContent = tab.hasPermission ? '허용됨' : '없음 - "권한 허용"을 눌러 주세요';
  els.permissionStatus.dataset.tone = tab.hasPermission ? '' : 'bad';
}

export function renderLastChecked(runtime: DetectionRuntime, now: number): void {
  if (runtime.lastCheckedAt === null) {
    els.lastChecked.textContent = '-';
    return;
  }
  const ago = Math.max(0, Math.floor((now - runtime.lastCheckedAt) / 1000));
  els.lastChecked.textContent = `${formatKstTime(runtime.lastCheckedAt)} (${ago}초 전)`;
}

export function renderDetectionWarning(state: PopupState, now: number): void {
  const { detection, settings } = state;
  const message = detection.message ?? notFoundWarning(detection, settings.detector.buttonText, now);
  els.detectionWarning.textContent = message ?? '';
  els.detectionWarning.hidden = message === null;
}

function renderDetection(state: PopupState, now: number): void {
  const { detection } = state;
  const active = detection.status === 'running' || detection.status === 'paused';
  els.detectionStatus.textContent = STATUS_LABEL[detection.status];
  els.buttonState.textContent = active ? BUTTON_STATE_LABEL[detection.buttonState] : '-';
  els.buttonState.dataset.tone =
    detection.buttonState === 'enabled' ? 'enabled' : detection.buttonState === 'not_found' ? 'bad' : '';
  els.matchCount.textContent = active ? `${detection.matchCount}개` : '-';
  renderLastChecked(detection, now);
  renderDetectionWarning(state, now);

  const running = detection.status === 'running';
  els.startDetection.disabled = active;
  els.pauseDetection.disabled = !active;
  els.pauseDetection.textContent = detection.status === 'paused' ? '재개' : '일시정지';
  els.stopDetection.disabled = !active;
  // 감지 중에는 대상/조건을 바꿀 수 없음 (일시정지 상태에서는 변경 후 재개 가능)
  els.targetUrl.disabled = running;
  els.saveTarget.disabled = running;
  els.buttonText.disabled = running;
  els.matchMode.disabled = running;
}

function renderNotificationPermission(level: PopupState['notificationPermission']): void {
  els.notificationPermission.textContent =
    level === 'granted'
      ? 'Chrome 알림 허용됨'
      : level === 'denied'
        ? 'Chrome 알림이 차단됨 - 아래 안내 참고'
        : '알림 권한 상태를 확인할 수 없음';
}

function renderLog(log: readonly NotificationLogEntry[]): void {
  const items = log.slice(0, 10).map((entry) => {
    const li = document.createElement('li');
    li.dataset.kind = entry.kind;
    const time = document.createElement('time');
    time.textContent = formatKstTime(entry.createdAt);
    const flags = [entry.delivered ? '' : ' (표시 실패)', entry.sound ? ' [소리]' : ''].join('');
    li.append(time, document.createTextNode(`${entry.title}${flags}`));
    if (entry.error) li.title = entry.error;
    return li;
  });
  if (items.length === 0) {
    const li = document.createElement('li');
    li.textContent = '아직 알림이 없습니다.';
    items.push(li);
  }
  els.notificationLog.replaceChildren(...items);
}

export function render(state: PopupState, now: number): void {
  renderBadge(state.detection);
  renderCountdown(state.settings.schedule.openAt, now);
  renderTab(state.tab);
  renderDetection(state, now);
  renderNotificationPermission(state.notificationPermission);
  renderLog(state.notificationLog);
  els.openTarget.disabled = state.settings.target.url === null;
  els.grantPermission.disabled = state.tab === null || state.tab.hasPermission;
}
