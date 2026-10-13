import { MAX_SCHEDULE_AHEAD_MS } from '../shared/constants';
import { UserError } from '../shared/result';
import { formatKst, isMilestoneStale, milestoneAt, upcomingMilestones } from '../shared/time';
import type { MilestoneKind, NotificationPrefs, Settings } from '../shared/types';
import { notify } from './notify';
import { loadFired, loadSettings, saveFired, saveSettings } from './store';

/** 알람 이름에 openAt을 넣어, 일정이 바뀐 뒤 늦게 도착한 이전 일정의 알람을 무시한다. */
const ALARM_PREFIX = 'ms';

export function alarmName(openAt: number, kind: MilestoneKind): string {
  return `${ALARM_PREFIX}|${openAt}|${kind}`;
}

export function parseAlarmName(name: string): { readonly openAt: number; readonly kind: MilestoneKind } | null {
  const [prefix, openAtRaw, kind] = name.split('|');
  const openAt = Number(openAtRaw);
  if (prefix !== ALARM_PREFIX || !Number.isFinite(openAt)) return null;
  if (kind !== 'T-5' && kind !== 'T-1' && kind !== 'T0') return null;
  return { openAt, kind };
}

/**
 * 서비스 워커의 setTimeout은 워커 종료 시 사라지므로 chrome.alarms만 사용한다.
 * 알람은 브라우저 재시작/업데이트 시 사라질 수 있어 onStartup/onInstalled에서 재동기화한다.
 */
export async function syncScheduleAlarms(settings: Settings, now: number): Promise<void> {
  const alarms = await chrome.alarms.getAll();
  await Promise.all(
    alarms.filter((a) => a.name.startsWith(`${ALARM_PREFIX}|`)).map((a) => chrome.alarms.clear(a.name)),
  );
  const { openAt } = settings.schedule;
  if (openAt === null) return;
  for (const kind of upcomingMilestones(openAt, now)) {
    await chrome.alarms.create(alarmName(openAt, kind), { when: milestoneAt(openAt, kind) });
  }
}

export async function saveSchedule(openAt: number | null, now: number): Promise<Settings> {
  if (openAt !== null) {
    if (!Number.isFinite(openAt)) throw new UserError('오픈 시각이 올바르지 않습니다.');
    if (openAt <= now) throw new UserError('이미 지난 시각입니다. 미래 시각을 입력하세요.');
    if (openAt - now > MAX_SCHEDULE_AHEAD_MS) throw new UserError('1년 이내의 시각만 설정할 수 있습니다.');
  }
  const settings = await loadSettings();
  const next: Settings = { ...settings, schedule: { openAt } };
  await saveSettings(next);

  // 같은 시각을 다시 저장하면 발송 이력을 유지(중복 알림 방지), 다른 시각이면 초기화
  const fired = await loadFired();
  if (openAt === null) await saveFired(null);
  else if (fired?.openAt !== openAt) await saveFired({ openAt, kinds: [] });

  await syncScheduleAlarms(next, now);
  return next;
}

const PREF_BY_KIND: Readonly<Record<MilestoneKind, keyof NotificationPrefs>> = {
  'T-5': 'before5m',
  'T-1': 'before1m',
  T0: 'atOpen',
};

function milestoneText(kind: MilestoneKind, openAt: number): { title: string; message: string } {
  const when = formatKst(openAt);
  switch (kind) {
    case 'T-5':
      return { title: '예매 오픈 5분 전', message: `${when} 오픈. 예매 페이지를 미리 열고 로그인 상태를 확인하세요.` };
    case 'T-1':
      return { title: '예매 오픈 1분 전', message: `${when} 오픈. 클릭하면 예매 페이지로 이동합니다.` };
    case 'T0':
      return { title: '예매 오픈 시각입니다', message: `${when}. 클릭하면 예매 페이지로 이동합니다.` };
  }
}

export type MilestoneOutcome = 'fired' | 'disabled' | 'duplicate' | 'stale' | 'outdated' | 'invalid';

export async function handleMilestoneAlarm(name: string, now: number): Promise<MilestoneOutcome> {
  const parsed = parseAlarmName(name);
  if (!parsed) return 'invalid';
  const settings = await loadSettings();
  if (settings.schedule.openAt !== parsed.openAt) return 'outdated';

  const fired = await loadFired();
  const kinds = fired?.openAt === parsed.openAt ? fired.kinds : [];
  if (kinds.includes(parsed.kind)) return 'duplicate';

  // 알림을 보내기 "전에" 발송 기록을 남겨 재진입/재시작 시 중복을 막는다
  await saveFired({ openAt: parsed.openAt, kinds: [...kinds, parsed.kind] });
  if (isMilestoneStale(parsed.kind, parsed.openAt, now)) return 'stale';
  if (!settings.notifications[PREF_BY_KIND[parsed.kind]]) return 'disabled';

  const text = milestoneText(parsed.kind, parsed.openAt);
  await notify({
    kind: `milestone-${parsed.kind}`,
    ...text,
    requireInteraction: parsed.kind === 'T0',
    sound: settings.notifications.sound ? (parsed.kind === 'T0' ? 'alert' : 'chime') : null,
  });
  return 'fired';
}

/** 브라우저가 꺼져 있어 오픈 알람을 놓친 경우, 유예 시간 내라면 시작 시 한 번 알린다. */
export async function catchUpMissedOpen(now: number): Promise<void> {
  const { openAt } = (await loadSettings()).schedule;
  if (openAt === null || now < openAt || isMilestoneStale('T0', openAt, now)) return;
  await handleMilestoneAlarm(alarmName(openAt, 'T0'), now);
}
