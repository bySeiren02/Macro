import type { ButtonState, MatchMode } from '../shared/types';

/** 버튼 역할을 할 수 있는 요소만 탐색해 전체 DOM 순회를 피한다 */
const CANDIDATE_SELECTOR = [
  'button',
  'a',
  '[role="button"]',
  '[role="link"]',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="image"]',
].join(',');

const STATE_PRIORITY: Readonly<Record<Exclude<ButtonState, 'unknown'>, number>> = {
  not_found: 0,
  hidden: 1,
  disabled: 2,
  enabled: 3,
};

export function normalizeText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * 간이 접근성 이름 후보. 완전한 accname 알고리즘 대신,
 * 실제 사이트에서 버튼 문구가 들어가는 위치들을 모두 후보로 본다.
 */
function nameCandidates(el: Element): string[] {
  const names: string[] = [];
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ');
    names.push(text);
  }
  names.push(el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? '');
  if (el instanceof HTMLInputElement) names.push(el.value, el.alt);
  else names.push(el.textContent ?? '');
  return names.map(normalizeText).filter((n) => n.length > 0);
}

export function matchesTarget(el: Element, target: string, mode: MatchMode): boolean {
  return nameCandidates(el).some((name) => (mode === 'exact' ? name === target : name.includes(target)));
}

interface VisibilityCheckable {
  checkVisibility?: (options?: Record<string, boolean>) => boolean;
}

function isVisible(el: Element): boolean {
  const checkable = el as unknown as VisibilityCheckable;
  if (typeof checkable.checkVisibility === 'function') {
    // 이전/신규 옵션명을 함께 전달 (모르는 키는 무시됨)
    const visible = checkable.checkVisibility({
      checkOpacity: true,
      checkVisibilityCSS: true,
      opacityProperty: true,
      visibilityProperty: true,
    });
    if (!visible) return false;
  }
  return el.getClientRects().length > 0;
}

function isDisabled(el: Element): boolean {
  if (el.matches(':disabled')) return true; // disabled 속성 + disabled fieldset 포함
  if (el.closest('[aria-disabled="true"]')) return true;
  return getComputedStyle(el).pointerEvents === 'none';
}

export function evaluateElement(el: Element): Exclude<ButtonState, 'unknown' | 'not_found'> {
  if (!el.isConnected || !isVisible(el)) return 'hidden';
  return isDisabled(el) ? 'disabled' : 'enabled';
}

export interface InspectResult {
  readonly state: Exclude<ButtonState, 'unknown'>;
  readonly matchCount: number;
}

/** 일치하는 요소가 여러 개면 가장 진행된 상태(enabled > disabled > hidden)를 대표값으로 사용 */
export function inspectDocument(doc: Document, buttonText: string, mode: MatchMode): InspectResult {
  const target = normalizeText(buttonText);
  if (!target) return { state: 'not_found', matchCount: 0 };

  let state: InspectResult['state'] = 'not_found';
  let matchCount = 0;
  for (const el of doc.querySelectorAll(CANDIDATE_SELECTOR)) {
    if (!matchesTarget(el, target, mode)) continue;
    matchCount += 1;
    const elementState = evaluateElement(el);
    if (STATE_PRIORITY[elementState] > STATE_PRIORITY[state]) state = elementState;
    if (state === 'enabled') break;
  }
  return { state, matchCount };
}
