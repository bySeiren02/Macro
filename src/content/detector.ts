/**
 * 대상 페이지(사용자가 권한을 부여한 사이트)에서만 실행되는 감지기.
 * - 페이지의 DOM만 읽는다. 클릭/입력/네트워크 요청/쿠키 접근을 하지 않는다.
 * - MutationObserver 콜백에서 바로 검사(백그라운드 탭에서도 타이머 스로틀링 영향이 적음),
 *   보조로 저빈도 폴링. 상태가 바뀔 때와 하트비트 때만 백그라운드에 보고한다.
 */
import { DETECTOR_GLOBAL } from '../shared/constants';
import { isResponse, type ContentRequest, type HelloReply, type ReportReply } from '../shared/messages';
import { isRecord } from '../shared/result';
import type { DetectorConfig } from '../shared/types';
import { findMatchingElement, inspectDocument, type InspectResult } from './inspect';

interface DetectorHandle {
  stop(): void;
}

type Timer = ReturnType<typeof setTimeout>;

const HELLO_RETRY_MS = 2_000;
const HELLO_MAX_ATTEMPTS = 5;
const OBSERVED_ATTRIBUTES = ['disabled', 'aria-disabled', 'class', 'style', 'hidden', 'aria-hidden', 'aria-label', 'value'];

/** 같은 페이지의 프레임을 묶는 키. 같은 출처 iframe은 top에 접근 가능, 아니면 null */
function topPageKey(): number | null {
  try {
    return window.top?.performance.timeOrigin ?? null;
  } catch {
    return null;
  }
}

const holder = globalThis as unknown as Record<string, DetectorHandle | undefined>;

function createDetector(): DetectorHandle {
  let stopped = false;
  let observer: MutationObserver | null = null;
  const timers = new Set<Timer>();
  const intervals = new Set<Timer>();

  const handle: DetectorHandle = { stop };

  function stop(): void {
    if (stopped) return;
    stopped = true;
    observer?.disconnect();
    observer = null;
    timers.forEach(clearTimeout);
    intervals.forEach(clearInterval);
    timers.clear();
    intervals.clear();
    if (holder[DETECTOR_GLOBAL] === handle) holder[DETECTOR_GLOBAL] = undefined;
  }

  /** 확장이 재로드/삭제되면 chrome.runtime.id가 사라지거나 동기 예외가 발생한다 */
  async function send(message: ContentRequest): Promise<unknown> {
    try {
      if (!chrome.runtime?.id) {
        stop();
        return undefined;
      }
      const response: unknown = await chrome.runtime.sendMessage(message);
      return isResponse(response) && response.ok ? response.data : undefined;
    } catch (error) {
      if (/context invalidated/i.test(String(error))) stop();
      return undefined; // 일시적 실패(워커 재시작 등)는 다음 하트비트에서 재시도
    }
  }

  function run(config: DetectorConfig): void {
    let last: InspectResult | null = null;
    let lastCheckAt = 0;
    let pending: Timer | null = null;
    let autoClicked = false;

    const report = async (result: InspectResult): Promise<void> => {
      const reply = (await send({
        type: 'DETECTOR_REPORT',
        sessionId: config.sessionId,
        state: result.state,
        matchCount: result.matchCount,
        pageKey: topPageKey(),
      })) as ReportReply | undefined;
      if (reply && reply.active === false) stop(); // 세션 만료 = 사용자가 중지함
    };

    const maybeAutoClick = (result: InspectResult): void => {
      if (result.state !== 'enabled') {
        autoClicked = false;
        return;
      }
      if (autoClicked) return;
      const target = findMatchingElement(document, config.buttonText, config.matchMode);
      if (!target) return;
      const click = (target as { click?: () => void }).click;
      if (typeof click !== 'function') return;
      try {
        click.call(target);
        autoClicked = true;
      } catch {
        // 일부 사이트는 클릭 자체가 거부되거나 이슈가 있어도 감지는 계속된다.
      }
    };

    const check = (): void => {
      if (stopped) return;
      lastCheckAt = performance.now();
      const result = inspectDocument(document, config.buttonText, config.matchMode);
      const changed = !last || last.state !== result.state || last.matchCount !== result.matchCount;
      last = result;
      if (changed) void report(result);
      maybeAutoClick(result);
    };

    // leading-edge 실행 + trailing 1회: 연속 변경 시에도 throttleMs당 최대 1회 탐색
    const scheduleCheck = (): void => {
      if (stopped) return;
      const elapsed = performance.now() - lastCheckAt;
      if (elapsed >= config.throttleMs) {
        check();
        return;
      }
      if (pending !== null) return;
      pending = setTimeout(() => {
        if (pending !== null) timers.delete(pending);
        pending = null;
        check();
      }, config.throttleMs - elapsed);
      timers.add(pending);
    };

    observer = new MutationObserver(scheduleCheck);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: OBSERVED_ATTRIBUTES,
    });
    intervals.add(setInterval(check, config.pollMs)); // CSS만 바뀌는 경우 등 옵저버가 못 잡는 변화 보완
    intervals.add(
      setInterval(() => {
        if (last) void report(last);
      }, config.heartbeatMs),
    );
    check();
  }

  async function hello(attempt: number): Promise<void> {
    if (stopped) return;
    const reply = (await send({ type: 'DETECTOR_HELLO' })) as HelloReply | undefined;
    if (stopped) return;
    if (reply === undefined) {
      if (attempt + 1 >= HELLO_MAX_ATTEMPTS) {
        stop();
        return;
      }
      const t = setTimeout(() => void hello(attempt + 1), HELLO_RETRY_MS);
      timers.add(t);
      return;
    }
    if (!reply.active || !isRecord(reply.config)) {
      stop(); // 감지 대상 탭이 아님 (같은 사이트의 다른 탭 등)
      return;
    }
    run(reply.config);
  }

  void hello(0);
  return handle;
}

// 같은 문서에 중복 주입되면 기존 인스턴스를 정리하고 교체한다
holder[DETECTOR_GLOBAL]?.stop();
holder[DETECTOR_GLOBAL] = createDetector();
