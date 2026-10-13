import {
  DETECTOR_FILE,
  DETECTOR_GLOBAL,
  DETECTOR_SCRIPT_ID,
  DETECTOR_TIMING,
  PENDING_START_TTL_MS,
} from '../shared/constants';
import { INITIAL_RUNTIME, aggregateFrames, applyAggregate, mergeFrameReport } from '../shared/detection-logic';
import type { ContentRequest, HelloReply, ReportReply } from '../shared/messages';
import { UserError, errorMessage } from '../shared/result';
import type { DetectionRuntime, DetectionStatus } from '../shared/types';
import { hostPermissionPattern, originOf } from '../shared/url';
import { notify } from './notify';
import { loadPendingStart, loadRuntime, loadSettings, saveRuntime, savePendingStart } from './store';
import { clearManagedTabIfMatches, ensureTargetTab } from './target-tab';

export const MSG_PERMISSION_MISSING =
  '대상 사이트 접근 권한이 없습니다. 팝업의 "권한 허용" 버튼을 눌러 이 사이트에 대한 권한을 부여하세요.';
const MSG_OFF_ORIGIN =
  '대상 탭이 등록한 사이트가 아닌 페이지(로그인/대기열 등)를 표시 중입니다. 등록한 사이트로 돌아오면 자동으로 감지를 재개합니다.';
const MSG_TAB_CLOSED = '대상 탭이 닫혀 감지를 종료했습니다.';
const MSG_PERMISSION_REVOKED = '사이트 접근 권한이 해제되어 감지를 종료했습니다.';

const isActive = (r: DetectionRuntime): boolean => r.status === 'running' || r.status === 'paused';

/**
 * 감지 스크립트를 동적 content script로 등록한다. 등록해 두면
 * 사용자의 새로고침, 늦게 추가된 같은 출처 iframe, 서비스 워커 재시작 후에도 자동으로 주입된다.
 * persistAcrossSessions:false 이므로 브라우저 재시작 시 자동 해제된다.
 */
async function registerDetector(pattern: string): Promise<void> {
  await unregisterDetector();
  await chrome.scripting.registerContentScripts([
    {
      id: DETECTOR_SCRIPT_ID,
      matches: [pattern],
      js: [DETECTOR_FILE],
      allFrames: true,
      runAt: 'document_idle',
      persistAcrossSessions: false,
    },
  ]);
}

export async function unregisterDetector(): Promise<void> {
  const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: [DETECTOR_SCRIPT_ID] });
  if (scripts.length > 0) await chrome.scripting.unregisterContentScripts({ ids: [DETECTOR_SCRIPT_ID] });
}

/** 이미 로드된 페이지는 등록된 content script가 적용되지 않으므로 1회 직접 주입 */
async function injectIntoTab(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [DETECTOR_FILE] });
    return true;
  } catch (e) {
    console.warn('[ticket-alert] inject failed', e);
    return false;
  }
}

/** 탭의 모든 프레임에서 감지기 인스턴스를 즉시 정리 (옵저버/타이머 해제) */
async function stopInstancesInTab(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      args: [DETECTOR_GLOBAL],
      func: (key: string) => {
        const holder = globalThis as unknown as Record<string, { stop(): void } | undefined>;
        holder[key]?.stop();
      },
    });
  } catch {
    // 탭이 닫혔거나 권한 밖 페이지. content 측은 다음 보고에서 active:false를 받고 스스로 중단한다.
  }
}

export async function startDetection(now: number): Promise<DetectionRuntime> {
  const current = await loadRuntime();
  if (current.status === 'running') return current;

  const settings = await loadSettings();
  const url = settings.target.url;
  if (!url) throw new UserError('먼저 예매 페이지 URL을 저장하세요.');
  const pattern = hostPermissionPattern(url);
  if (!(await chrome.permissions.contains({ origins: [pattern] }))) throw new UserError(MSG_PERMISSION_MISSING);

  await registerDetector(pattern);
  let target: Awaited<ReturnType<typeof ensureTargetTab>>;
  try {
    target = await ensureTargetTab(url, current.tabId);
    if (target.tab.id === undefined) throw new Error('대상 탭 정보를 가져오지 못했습니다.');
  } catch (e) {
    await unregisterDetector(); // 실패 시 등록을 남기지 않는다
    throw e;
  }
  const { tab, created } = target;
  const tabId = tab.id as number;

  const runtime: DetectionRuntime = {
    ...INITIAL_RUNTIME,
    status: 'running',
    sessionId: crypto.randomUUID(),
    tabId,
    origin: originOf(url),
    startedAt: now,
    lastEnabledNotifiedAt: current.lastEnabledNotifiedAt,
  };
  // content의 HELLO는 이 작업이 끝난 뒤(직렬화 큐) 처리되므로 런타임이 먼저 저장된다
  await saveRuntime(runtime);

  // 메모리 세이버가 감지 중인 탭을 폐기하지 않도록 (tabs 권한 불필요)
  await chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => undefined);

  // 등록 이전에 커밋된 문서(로딩 중 포함)에는 등록 스크립트가 적용되지 않으므로 직접 주입.
  // 새로 만든 탭은 등록 스크립트가 처리한다. 중복 주입은 content 측 전역 가드가 정리한다.
  if (!created && !(await injectIntoTab(tabId))) {
    const latest = await chrome.tabs.get(tabId).catch(() => null);
    if (originOf(latest?.url) !== runtime.origin) {
      const next = { ...runtime, message: MSG_OFF_ORIGIN };
      await saveRuntime(next);
      return next;
    }
  }
  return runtime;
}

export async function stopDetection(
  status: Exclude<DetectionStatus, 'running'>,
  message: string | null,
): Promise<DetectionRuntime> {
  const current = await loadRuntime();
  // 세션을 먼저 무효화: 이후 도착하는 보고는 모두 active:false 응답을 받는다
  const next: DetectionRuntime =
    status === 'paused'
      ? { ...current, status, sessionId: null, message, frames: {}, pageKey: null }
      : { ...INITIAL_RUNTIME, status, message, lastEnabledNotifiedAt: current.lastEnabledNotifiedAt };
  await saveRuntime(next);
  await unregisterDetector();
  if (current.tabId !== null) await stopInstancesInTab(current.tabId);
  return next;
}

export async function pauseDetection(): Promise<DetectionRuntime> {
  const current = await loadRuntime();
  if (current.status !== 'running') throw new UserError('감지 중일 때만 일시정지할 수 있습니다.');
  return stopDetection('paused', null);
}

function isFromDetectionTab(runtime: DetectionRuntime, sender: chrome.runtime.MessageSender): boolean {
  return (
    runtime.status === 'running' &&
    runtime.sessionId !== null &&
    sender.tab?.id === runtime.tabId &&
    originOf(sender.url) === runtime.origin
  );
}

async function handleHello(sender: chrome.runtime.MessageSender): Promise<HelloReply> {
  const runtime = await loadRuntime();
  if (!isFromDetectionTab(runtime, sender) || runtime.sessionId === null) return { active: false };
  if (runtime.message === MSG_OFF_ORIGIN) await saveRuntime({ ...runtime, message: null });
  const { detector } = await loadSettings();
  return {
    active: true,
    config: { sessionId: runtime.sessionId, ...detector, ...DETECTOR_TIMING },
  };
}

async function handleReport(
  request: Extract<ContentRequest, { type: 'DETECTOR_REPORT' }>,
  sender: chrome.runtime.MessageSender,
  now: number,
): Promise<ReportReply> {
  const runtime = await loadRuntime();
  if (!isFromDetectionTab(runtime, sender) || request.sessionId !== runtime.sessionId) return { active: false };

  const frameId = sender.frameId ?? 0;
  const merged = mergeFrameReport(
    runtime,
    {
      documentKey: sender.documentId ?? `frame-${frameId}`,
      frameId,
      state: request.state,
      matchCount: request.matchCount,
      pageKey: request.pageKey,
    },
    now,
  );
  const settings = await loadSettings();
  const { runtime: next, shouldNotify } = applyAggregate(
    { ...runtime, ...merged },
    aggregateFrames(merged.frames, merged.pageKey),
    now,
    settings.notifications.onEnabled,
  );
  await saveRuntime(next);

  if (shouldNotify) {
    await notify({
      kind: 'button-enabled',
      title: '예매 버튼이 활성화되었습니다!',
      message: `'${settings.detector.buttonText}' 버튼을 사용할 수 있습니다. 클릭하면 예매 탭으로 이동합니다.`,
      requireInteraction: true,
      sound: settings.notifications.sound ? 'alert' : null,
    });
  }
  return { active: true };
}

export function handleContentRequest(
  request: ContentRequest,
  sender: chrome.runtime.MessageSender,
  now: number,
): Promise<HelloReply | ReportReply> {
  return request.type === 'DETECTOR_HELLO' ? handleHello(sender) : handleReport(request, sender, now);
}

export async function onTabRemoved(tabId: number): Promise<void> {
  await clearManagedTabIfMatches(tabId);
  const runtime = await loadRuntime();
  if (isActive(runtime) && runtime.tabId === tabId) await stopDetection('idle', MSG_TAB_CLOSED);
}

/** 대상 탭이 다른 출처로 이동하면(로그인/대기열 리다이렉트) "찾을 수 없음"과 구분해 표시 */
export async function onTabUpdated(tabId: number, tab: chrome.tabs.Tab): Promise<void> {
  const runtime = await loadRuntime();
  if (runtime.status !== 'running' || runtime.tabId !== tabId) return;
  if (originOf(tab.url) === runtime.origin) return;
  await saveRuntime({
    ...runtime,
    buttonState: 'unknown',
    notFoundSince: null,
    frames: {},
    pageKey: null,
    message: MSG_OFF_ORIGIN,
  });
}

export async function onPermissionsRemoved(): Promise<void> {
  const runtime = await loadRuntime();
  if (!isActive(runtime)) return;
  const { target } = await loadSettings();
  const stillGranted =
    target.url !== null && (await chrome.permissions.contains({ origins: [hostPermissionPattern(target.url)] }));
  if (!stillGranted) await stopDetection('error', MSG_PERMISSION_REVOKED);
}

/**
 * 일부 환경에서는 권한 요청 대화상자가 뜨면 팝업이 닫혀 START 메시지가 전송되지 않는다.
 * 팝업이 요청 직전에 남긴 pendingStart가 유효하면 권한 부여 이벤트로 감지를 시작한다.
 */
export async function onPermissionsAdded(now: number, addedOrigins: readonly string[]): Promise<void> {
  const pendingAt = await loadPendingStart();
  if (pendingAt === null) return;
  // 대상 사이트 권한이 추가된 경우에만 시작 (다른 권한 변경으로 의도치 않게 시작하지 않도록)
  const { target } = await loadSettings();
  if (target.url === null || !addedOrigins.includes(hostPermissionPattern(target.url))) return;
  await savePendingStart(null);
  if (now - pendingAt > PENDING_START_TTL_MS) return;
  try {
    await startDetection(now);
  } catch (e) {
    await saveRuntime({ ...(await loadRuntime()), status: 'error', message: errorMessage(e) });
  }
}
