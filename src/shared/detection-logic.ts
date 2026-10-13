import {
  ENABLED_NOTIFY_COOLDOWN_MS,
  FRAME_STALE_MS,
  NOT_FOUND_WARNING_MS,
} from './constants';
import { isRecord } from './result';
import type { ButtonState, DetectionRuntime, FrameEntry } from './types';

export const INITIAL_RUNTIME: DetectionRuntime = Object.freeze({
  status: 'idle',
  sessionId: null,
  tabId: null,
  origin: null,
  buttonState: 'unknown',
  matchCount: 0,
  lastCheckedAt: null,
  lastChangedAt: null,
  notFoundSince: null,
  lastEnabledNotifiedAt: null,
  startedAt: null,
  message: null,
  pageKey: null,
  frames: Object.freeze({}),
});

const STATE_PRIORITY: Readonly<Record<ButtonState, number>> = {
  unknown: 0,
  not_found: 1,
  hidden: 2,
  disabled: 3,
  enabled: 4,
};

const BUTTON_STATES = Object.keys(STATE_PRIORITY) as ButtonState[];

export function isButtonState(value: unknown): value is ButtonState {
  return typeof value === 'string' && (BUTTON_STATES as string[]).includes(value);
}

export function parseRuntime(raw: unknown): DetectionRuntime {
  if (!isRecord(raw) || typeof raw.status !== 'string') return INITIAL_RUNTIME;
  return { ...INITIAL_RUNTIME, ...(raw as Partial<DetectionRuntime>) };
}

export interface Aggregate {
  readonly state: ButtonState;
  readonly matchCount: number;
}

const belongsToPage = (entry: FrameEntry, pageKey: number | null): boolean =>
  pageKey === null || entry.pageKey === null || entry.pageKey === pageKey;

/**
 * 현재 페이지에 속한 프레임 중 가장 "진행된" 상태를 대표값으로 사용: enabled > disabled > hidden > not_found.
 * 새 페이지의 iframe 보고가 최상위 보고보다 먼저 도착하면, 최상위 보고가 올 때까지 집계에서 보류된다.
 */
export function aggregateFrames(frames: Readonly<Record<string, FrameEntry>>, pageKey: number | null): Aggregate {
  let state: ButtonState = 'unknown';
  let matchCount = 0;
  for (const entry of Object.values(frames)) {
    if (!belongsToPage(entry, pageKey)) continue;
    matchCount += entry.matchCount;
    if (STATE_PRIORITY[entry.state] > STATE_PRIORITY[state]) state = entry.state;
  }
  return { state, matchCount };
}

export interface FrameReportInput {
  readonly documentKey: string;
  readonly frameId: number;
  readonly state: ButtonState;
  readonly matchCount: number;
  readonly pageKey: number | null;
}

/**
 * 프레임 보고를 반영한 새 프레임 맵.
 * 최상위 프레임이 새 페이지 키로 보고하면 이전 페이지(더 작은 키)의 프레임을 버린다.
 * (timeOrigin은 내비게이션마다 증가하므로, 먼저 도착한 새 페이지의 iframe 항목은 유지된다)
 */
export function mergeFrameReport(
  runtime: DetectionRuntime,
  report: FrameReportInput,
  now: number,
): Pick<DetectionRuntime, 'frames' | 'pageKey'> {
  const pageKey = report.frameId === 0 ? report.pageKey : runtime.pageKey;
  const isOlderPage = (f: FrameEntry): boolean => pageKey !== null && f.pageKey !== null && f.pageKey < pageKey;
  const fresh = Object.fromEntries(
    Object.entries(runtime.frames).filter(([, f]) => now - f.seenAt <= FRAME_STALE_MS && !isOlderPage(f)),
  );
  return {
    pageKey,
    frames: {
      ...fresh,
      [report.documentKey]: {
        state: report.state,
        matchCount: report.matchCount,
        seenAt: now,
        frameId: report.frameId,
        pageKey: report.pageKey,
      },
    },
  };
}

export interface ApplyResult {
  readonly runtime: DetectionRuntime;
  readonly shouldNotify: boolean;
}

/**
 * 상태 "전이"에서만 알림: 비활성 -> 활성으로 바뀔 때 1회, 그리고 쿨다운 내 재진입은 무시.
 * 하트비트로 같은 상태가 반복 보고되어도 알림은 발생하지 않는다.
 */
export function applyAggregate(
  runtime: DetectionRuntime,
  aggregate: Aggregate,
  now: number,
  notifyEnabled: boolean,
): ApplyResult {
  const changed = aggregate.state !== runtime.buttonState;
  const enteringEnabled = aggregate.state === 'enabled' && runtime.buttonState !== 'enabled';
  const cooledDown =
    runtime.lastEnabledNotifiedAt === null || now - runtime.lastEnabledNotifiedAt >= ENABLED_NOTIFY_COOLDOWN_MS;
  const shouldNotify = enteringEnabled && cooledDown && notifyEnabled;

  return {
    shouldNotify,
    runtime: {
      ...runtime,
      buttonState: aggregate.state,
      matchCount: aggregate.matchCount,
      lastCheckedAt: now,
      lastChangedAt: changed ? now : runtime.lastChangedAt,
      notFoundSince: aggregate.state === 'not_found' ? (runtime.notFoundSince ?? now) : null,
      lastEnabledNotifiedAt: shouldNotify ? now : runtime.lastEnabledNotifiedAt,
    },
  };
}

export function notFoundWarning(runtime: DetectionRuntime, buttonText: string, now: number): string | null {
  if (runtime.status !== 'running' || runtime.buttonState !== 'not_found' || runtime.notFoundSince === null) {
    return null;
  }
  if (now - runtime.notFoundSince < NOT_FOUND_WARNING_MS) return null;
  return `'${buttonText}' 버튼을 찾을 수 없습니다. 페이지 구조가 바뀌었거나 버튼 문구가 다를 수 있습니다. (오픈 전이라 버튼이 아직 없을 수도 있습니다)`;
}

export const BUTTON_STATE_LABEL: Readonly<Record<ButtonState, string>> = {
  unknown: '확인 중',
  not_found: '찾을 수 없음',
  hidden: '숨겨짐',
  disabled: '비활성화',
  enabled: '활성화됨',
};
