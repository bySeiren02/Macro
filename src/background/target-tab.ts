import { isSameDocumentUrl, isSameOrigin, hostPermissionPattern } from '../shared/url';
import type { TargetTabInfo } from '../shared/types';
import { loadManagedTabId, saveManagedTabId } from './store';

async function getTab(tabId: number | null): Promise<chrome.tabs.Tab | null> {
  if (tabId === null) return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null; // 닫힌 탭
  }
}

/**
 * "tabs" 권한이 없으므로 tab.url은 호스트 권한이 있는 사이트에서만 보인다.
 * (권한이 없으면 tabs.query의 url 필터가 무시되므로 직접 필터링한다.)
 * 우선순위: 감지 중인 탭 > 이 확장이 열었던 탭 > 같은 주소의 기존 탭.
 */
export async function findTargetTab(url: string, preferredTabId: number | null): Promise<chrome.tabs.Tab | null> {
  for (const id of [preferredTabId, await loadManagedTabId()]) {
    const tab = await getTab(id);
    // url이 안 보이면(권한 없음) 우리가 연 탭이므로 신뢰, 보이면 같은 사이트인지 확인
    if (tab && (tab.url === undefined || isSameOrigin(tab.url, url))) return tab;
  }
  const tabs = await chrome.tabs.query({});
  return tabs.find((t) => t.url !== undefined && isSameDocumentUrl(t.url, url)) ?? null;
}

export async function ensureTargetTab(
  url: string,
  preferredTabId: number | null,
): Promise<{ readonly tab: chrome.tabs.Tab; readonly created: boolean }> {
  const existing = await findTargetTab(url, preferredTabId);
  if (existing?.id !== undefined) return { tab: existing, created: false };
  const tab = await chrome.tabs.create({ url, active: true });
  if (tab.id === undefined) throw new Error('탭을 만들지 못했습니다.');
  await saveManagedTabId(tab.id);
  return { tab, created: true };
}

export async function focusTab(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
}

export async function openTarget(url: string, preferredTabId: number | null): Promise<{ readonly created: boolean }> {
  const { tab, created } = await ensureTargetTab(url, preferredTabId);
  if (!created) await focusTab(tab);
  return { created };
}

export async function hasHostPermission(url: string): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: [hostPermissionPattern(url)] });
  } catch {
    return false;
  }
}

export async function getTargetTabInfo(url: string, preferredTabId: number | null): Promise<TargetTabInfo> {
  const [tab, hasPermission] = await Promise.all([findTargetTab(url, preferredTabId), hasHostPermission(url)]);
  return {
    exists: tab !== null,
    tabId: tab?.id ?? null,
    title: tab?.title ?? null,
    url: tab?.url ?? null,
    loading: tab?.status === 'loading',
    hasPermission,
  };
}

export async function clearManagedTabIfMatches(tabId: number): Promise<void> {
  if ((await loadManagedTabId()) === tabId) await saveManagedTabId(null);
}
