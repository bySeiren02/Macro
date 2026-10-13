import { expect, test } from '@playwright/test';
import {
  INITIAL_RUNTIME,
  aggregateFrames,
  applyAggregate,
  mergeFrameReport,
  notFoundWarning,
} from '../../src/shared/detection-logic';
import { parsePopupRequest, parseContentRequest } from '../../src/shared/messages';
import { DEFAULT_SETTINGS, parseSettings, validateButtonText } from '../../src/shared/settings';
import {
  formatDuration,
  formatKst,
  isMilestoneStale,
  kstToEpoch,
  milestoneAt,
  upcomingMilestones,
} from '../../src/shared/time';
import type { DetectionRuntime } from '../../src/shared/types';
import { hostPermissionPattern, isSameDocumentUrl, validateTargetUrl } from '../../src/shared/url';

test.describe('time (KST)', () => {
  test('KST 입력을 UTC epoch로 변환한다', () => {
    expect(kstToEpoch('2026-10-20', '14:00')).toEqual({ ok: true, value: Date.UTC(2026, 9, 20, 5, 0, 0) });
    expect(kstToEpoch('2026-01-01', '08:59:59')).toEqual({ ok: true, value: Date.UTC(2025, 11, 31, 23, 59, 59) });
  });

  test('존재하지 않는 날짜/시각과 잘못된 형식을 거부한다', () => {
    expect(kstToEpoch('2026-02-30', '10:00').ok).toBe(false);
    expect(kstToEpoch('2026-13-01', '10:00').ok).toBe(false);
    expect(kstToEpoch('2026-10-20', '24:00').ok).toBe(false);
    expect(kstToEpoch('20261020', '10:00').ok).toBe(false);
    expect(kstToEpoch('2026-10-20', '').ok).toBe(false);
  });

  test('KST로 포맷한다', () => {
    expect(formatKst(Date.UTC(2026, 9, 20, 5, 0, 0))).toBe('2026-10-20 (화) 14:00:00 KST');
  });

  test('남은 시간 포맷 (올림/일 단위)', () => {
    expect(formatDuration(59_001, 'ceil')).toBe('00:01:00');
    expect(formatDuration(59_001)).toBe('00:00:59');
    expect(formatDuration(86_400_000 + 3_661_000)).toBe('1일 01:01:01');
    expect(formatDuration(-5_000)).toBe('00:00:00');
  });

  test('남은 마일스톤만 등록 대상이다', () => {
    const openAt = 10 * 60_000;
    expect(upcomingMilestones(openAt, 0)).toEqual(['T-5', 'T-1', 'T0']);
    expect(upcomingMilestones(openAt, milestoneAt(openAt, 'T-5'))).toEqual(['T-1', 'T0']);
    expect(upcomingMilestones(openAt, openAt)).toEqual([]);
  });

  test('늦게 도착한 알람은 stale로 판정한다', () => {
    const openAt = 10 * 60_000;
    expect(isMilestoneStale('T-5', openAt, milestoneAt(openAt, 'T-5') + 1_000)).toBe(false);
    expect(isMilestoneStale('T-5', openAt, milestoneAt(openAt, 'T-1'))).toBe(true);
    expect(isMilestoneStale('T-1', openAt, openAt)).toBe(true);
    expect(isMilestoneStale('T0', openAt, openAt + 9 * 60_000)).toBe(false);
    expect(isMilestoneStale('T0', openAt, openAt + 11 * 60_000)).toBe(true);
  });
});

test.describe('url', () => {
  test('https와 로컬 http만 허용한다', () => {
    expect(validateTargetUrl('https://ticket.example.com/game?id=1')).toEqual({
      ok: true,
      value: 'https://ticket.example.com/game?id=1',
    });
    expect(validateTargetUrl('http://127.0.0.1:4173/index.html').ok).toBe(true);
    expect(validateTargetUrl('http://localhost:3000/').ok).toBe(true);
    for (const bad of ['http://example.com', 'javascript:alert(1)', 'chrome://settings', 'file:///a', 'nope', 42]) {
      expect(validateTargetUrl(bad).ok).toBe(false);
    }
  });

  test('권한 패턴은 포트 없이 호스트 단위로 만든다', () => {
    expect(hostPermissionPattern('https://a.example.com:8443/x?y')).toBe('https://a.example.com/*');
    expect(hostPermissionPattern('http://127.0.0.1:4173/index.html')).toBe('http://127.0.0.1/*');
  });

  test('해시만 다른 주소는 같은 문서로 본다', () => {
    expect(isSameDocumentUrl('https://a.com/p?x=1#top', 'https://a.com/p?x=1')).toBe(true);
    expect(isSameDocumentUrl('https://a.com/p?x=1', 'https://a.com/p?x=2')).toBe(false);
  });
});

test.describe('settings', () => {
  test('손상된 저장값은 필드 단위로 기본값으로 대체한다', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    const parsed = parseSettings({
      schedule: { openAt: 'tomorrow' },
      target: { url: 'javascript:alert(1)' },
      detector: { buttonText: '  예매   하기 ', matchMode: 'regex' },
      notifications: { sound: false, before5m: 'yes' },
    });
    expect(parsed.schedule.openAt).toBeNull();
    expect(parsed.target.url).toBeNull();
    expect(parsed.detector).toEqual({ buttonText: '예매 하기', matchMode: 'contains' });
    expect(parsed.notifications.sound).toBe(false);
    expect(parsed.notifications.before5m).toBe(true);
  });

  test('버튼 텍스트 검증', () => {
    expect(validateButtonText('').ok).toBe(false);
    expect(validateButtonText('a'.repeat(101)).ok).toBe(false);
    expect(validateButtonText('예매\u0000').ok).toBe(false);
    expect(validateButtonText(' 예매\n하기 ')).toEqual({ ok: true, value: '예매 하기' });
    expect(validateButtonText('예매\u0007하기').ok).toBe(false);
  });
});

test.describe('messages', () => {
  test('형식이 잘못된 메시지를 거부한다', () => {
    expect(parsePopupRequest({ type: 'SAVE_TARGET', url: 1 })).toBeNull();
    expect(parsePopupRequest({ type: 'UNKNOWN' })).toBeNull();
    expect(parsePopupRequest('GET_STATE')).toBeNull();
    expect(parseContentRequest({ type: 'DETECTOR_REPORT', sessionId: 's', state: 'clicked', matchCount: 1 })).toBeNull();
    expect(parseContentRequest({ type: 'DETECTOR_REPORT', sessionId: 's', state: 'enabled', matchCount: -1 })).toBeNull();
  });
});

test.describe('detection logic', () => {
  const running: DetectionRuntime = { ...INITIAL_RUNTIME, status: 'running', sessionId: 's', tabId: 1 };

  test('비활성 -> 활성 전이에서만 알림, 반복 보고는 무시', () => {
    const disabled = applyAggregate(running, { state: 'disabled', matchCount: 1 }, 1_000, true);
    expect(disabled.shouldNotify).toBe(false);
    const enabled = applyAggregate(disabled.runtime, { state: 'enabled', matchCount: 1 }, 2_000, true);
    expect(enabled.shouldNotify).toBe(true);
    const heartbeat = applyAggregate(enabled.runtime, { state: 'enabled', matchCount: 1 }, 7_000, true);
    expect(heartbeat.shouldNotify).toBe(false);
  });

  test('쿨다운 내 재활성화는 알리지 않고, 쿨다운 이후에는 알린다', () => {
    const base = { ...running, buttonState: 'disabled' as const, lastEnabledNotifiedAt: 10_000 };
    expect(applyAggregate(base, { state: 'enabled', matchCount: 1 }, 20_000, true).shouldNotify).toBe(false);
    expect(applyAggregate(base, { state: 'enabled', matchCount: 1 }, 41_000, true).shouldNotify).toBe(true);
  });

  test('알림 설정이 꺼져 있으면 알리지 않는다', () => {
    expect(applyAggregate(running, { state: 'enabled', matchCount: 1 }, 1, false).shouldNotify).toBe(false);
  });

  test('프레임 집계는 현재 페이지의 가장 진행된 상태를 쓰고, 새 페이지가 오면 이전 페이지 프레임을 버린다', () => {
    const report = (documentKey: string, frameId: number, state: 'not_found' | 'disabled' | 'enabled', pageKey: number) => ({
      documentKey,
      frameId,
      state,
      matchCount: state === 'not_found' ? 0 : 1,
      pageKey,
    });
    let rt: DetectionRuntime = running;
    rt = { ...rt, ...mergeFrameReport(rt, report('top1', 0, 'not_found', 100), 1) };
    rt = { ...rt, ...mergeFrameReport(rt, report('sub1', 5, 'enabled', 100), 2) };
    expect(aggregateFrames(rt.frames, rt.pageKey)).toEqual({ state: 'enabled', matchCount: 1 });

    // 새로고침: 새 페이지의 iframe 보고가 최상위보다 먼저 도착 -> 최상위 보고 전까지 보류
    rt = { ...rt, ...mergeFrameReport(rt, report('sub2', 7, 'disabled', 200), 3) };
    expect(aggregateFrames(rt.frames, rt.pageKey).state).toBe('enabled');
    rt = { ...rt, ...mergeFrameReport(rt, report('top2', 0, 'not_found', 200), 4) };
    expect(Object.keys(rt.frames).sort()).toEqual(['sub2', 'top2']);
    expect(aggregateFrames(rt.frames, rt.pageKey)).toEqual({ state: 'disabled', matchCount: 1 });
  });

  test('요소 없음 경고는 3초 이상 지속될 때만 표시한다', () => {
    const notFound = applyAggregate(running, { state: 'not_found', matchCount: 0 }, 1_000, true).runtime;
    expect(notFoundWarning(notFound, '예매하기', 2_000)).toBeNull();
    expect(notFoundWarning(notFound, '예매하기', 4_000)).toContain('예매하기');
    const found = applyAggregate(notFound, { state: 'disabled', matchCount: 1 }, 5_000, true).runtime;
    expect(found.notFoundSince).toBeNull();
  });
});
