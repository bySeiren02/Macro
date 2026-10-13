export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export type MatchMode = 'contains' | 'exact';
export type ButtonState = 'unknown' | 'not_found' | 'hidden' | 'disabled' | 'enabled';
export type DetectionStatus = 'idle' | 'running' | 'paused' | 'error';
export type MilestoneKind = 'T-5' | 'T-1' | 'T0';
export type NotificationKind = `milestone-${MilestoneKind}` | 'button-enabled' | 'test';
export type SoundPattern = 'alert' | 'chime';

export interface NotificationPrefs {
  readonly before5m: boolean;
  readonly before1m: boolean;
  readonly atOpen: boolean;
  readonly onEnabled: boolean;
  readonly sound: boolean;
}

export interface Settings {
  readonly schedule: { readonly openAt: number | null };
  readonly target: { readonly url: string | null };
  readonly detector: { readonly buttonText: string; readonly matchMode: MatchMode };
  readonly notifications: NotificationPrefs;
}

/** 프레임(문서) 단위 감지 결과. documentId 기준으로 저장한다. */
export interface FrameEntry {
  readonly state: ButtonState;
  readonly matchCount: number;
  readonly seenAt: number;
  readonly frameId: number;
  /** 이 프레임이 속한 최상위 페이지 키 (top.performance.timeOrigin). 알 수 없으면 null */
  readonly pageKey: number | null;
}

export interface DetectionRuntime {
  readonly status: DetectionStatus;
  readonly sessionId: string | null;
  readonly tabId: number | null;
  readonly origin: string | null;
  readonly buttonState: ButtonState;
  readonly matchCount: number;
  readonly lastCheckedAt: number | null;
  readonly lastChangedAt: number | null;
  readonly notFoundSince: number | null;
  readonly lastEnabledNotifiedAt: number | null;
  readonly startedAt: number | null;
  /** 오류/경고 메시지 (탭 닫힘, 권한 해제, 다른 사이트로 이동 등) */
  readonly message: string | null;
  /** 현재 최상위 페이지 키. 새로고침/이동 시 증가한다 */
  readonly pageKey: number | null;
  readonly frames: Readonly<Record<string, FrameEntry>>;
}

export interface FiredMilestones {
  readonly openAt: number;
  readonly kinds: readonly MilestoneKind[];
}

export interface NotificationLogEntry {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly message: string;
  readonly createdAt: number;
  readonly delivered: boolean;
  readonly sound: boolean;
  readonly error: string | null;
}

export interface TargetTabInfo {
  readonly exists: boolean;
  readonly tabId: number | null;
  readonly title: string | null;
  readonly url: string | null;
  readonly loading: boolean;
  readonly hasPermission: boolean;
}

export interface PopupState {
  readonly now: number;
  readonly settings: Settings;
  readonly detection: DetectionRuntime;
  readonly tab: TargetTabInfo | null;
  readonly notificationLog: readonly NotificationLogEntry[];
  readonly notificationPermission: 'granted' | 'denied' | 'unknown';
  readonly firedMilestones: readonly MilestoneKind[];
}

export interface DetectorConfig {
  readonly sessionId: string;
  readonly buttonText: string;
  readonly matchMode: MatchMode;
  readonly throttleMs: number;
  readonly pollMs: number;
  readonly heartbeatMs: number;
}
