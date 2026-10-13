import { KST_OFFSET_MS, ONE_MINUTE_MS, OPEN_NOTIFICATION_GRACE_MS } from './constants';
import { err, ok } from './result';
import type { MilestoneKind, Result } from './types';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

export const MILESTONE_ORDER: readonly MilestoneKind[] = ['T-5', 'T-1', 'T0'];
const MILESTONE_OFFSET_MS: Readonly<Record<MilestoneKind, number>> = {
  'T-5': 5 * ONE_MINUTE_MS,
  'T-1': ONE_MINUTE_MS,
  T0: 0,
};

export interface KstParts {
  readonly date: string;
  readonly time: string;
  readonly weekday: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * 사용자의 시스템 시간대와 무관하게 입력값을 KST(UTC+9, DST 없음)로 해석한다.
 * Intl/로컬 Date API를 쓰지 않고 UTC 연산만 사용한다.
 */
export function kstToEpoch(date: string, time: string): Result<number> {
  const d = DATE_RE.exec(date.trim());
  if (!d) return err('날짜 형식이 올바르지 않습니다 (YYYY-MM-DD).');
  const t = TIME_RE.exec(time.trim());
  if (!t) return err('시간 형식이 올바르지 않습니다 (HH:MM 또는 HH:MM:SS).');

  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [hour, minute, second] = [Number(t[1]), Number(t[2]), Number(t[3] ?? '0')];
  if (hour > 23 || minute > 59 || second > 59) return err('존재하지 않는 시각입니다.');

  const epoch = Date.UTC(year, month - 1, day, hour, minute, second) - KST_OFFSET_MS;
  // Date.UTC는 2월 30일 같은 값을 다음 달로 넘기므로 왕복 비교로 검증
  if (toKstParts(epoch).date !== `${d[1]}-${d[2]}-${d[3]}`) return err('존재하지 않는 날짜입니다.');
  return ok(epoch);
}

export function toKstParts(epoch: number): KstParts {
  const k = new Date(epoch + KST_OFFSET_MS);
  return {
    date: `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`,
    time: `${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}:${pad(k.getUTCSeconds())}`,
    weekday: WEEKDAYS_KO[k.getUTCDay()] ?? '',
  };
}

export function formatKst(epoch: number): string {
  const p = toKstParts(epoch);
  return `${p.date} (${p.weekday}) ${p.time} KST`;
}

export function formatKstTime(epoch: number): string {
  return toKstParts(epoch).time;
}

/** 남은 시간은 올림(ceil)해야 오픈 시각에 정확히 00:00:00이 된다 */
export function formatDuration(ms: number, rounding: 'ceil' | 'floor' = 'floor'): string {
  const seconds = Math.max(0, rounding === 'ceil' ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const days = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  const s = seconds % 60;
  const hms = `${pad(h)}:${pad(m)}:${pad(s)}`;
  return days > 0 ? `${days}일 ${hms}` : hms;
}

export function milestoneAt(openAt: number, kind: MilestoneKind): number {
  return openAt - MILESTONE_OFFSET_MS[kind];
}

/** 아직 도래하지 않은 마일스톤만 알람으로 등록한다 (이미 지난 알림은 즉시 울리지 않음) */
export function upcomingMilestones(openAt: number, now: number): MilestoneKind[] {
  return MILESTONE_ORDER.filter((kind) => milestoneAt(openAt, kind) > now);
}

/**
 * 알람이 늦게 도착(절전, 브라우저 지연)했을 때 의미 없는 알림을 막는다.
 * T-5는 T-1 시점 이후, T-1은 오픈 이후, T0는 유예 시간 이후면 무효.
 */
export function isMilestoneStale(kind: MilestoneKind, openAt: number, now: number): boolean {
  switch (kind) {
    case 'T-5':
      return now >= milestoneAt(openAt, 'T-1');
    case 'T-1':
      return now >= openAt;
    case 'T0':
      return now > openAt + OPEN_NOTIFICATION_GRACE_MS;
  }
}
