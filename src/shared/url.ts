import { URL_MAX } from './constants';
import { err, ok } from './result';
import type { Result } from './types';

/** http는 로컬 테스트용 호스트에서만 허용. manifest의 optional_host_permissions와 일치해야 한다. */
const LOCAL_HTTP_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);

export function validateTargetUrl(input: unknown): Result<string> {
  if (typeof input !== 'string') return err('URL은 문자열이어야 합니다.');
  const trimmed = input.trim();
  if (!trimmed) return err('URL을 입력하세요.');
  if (trimmed.length > URL_MAX) return err(`URL이 너무 깁니다 (최대 ${URL_MAX}자).`);

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return err('올바른 URL 형식이 아닙니다. https:// 로 시작하는 전체 주소를 입력하세요.');
  }

  if (url.protocol === 'http:') {
    if (!LOCAL_HTTP_HOSTS.has(url.hostname)) {
      return err('http 주소는 로컬 테스트(localhost, 127.0.0.1)에서만 허용됩니다. https 주소를 사용하세요.');
    }
  } else if (url.protocol !== 'https:') {
    return err(`허용되지 않는 프로토콜입니다: ${url.protocol} (https만 허용)`);
  }
  if (!url.hostname) return err('호스트 이름이 없습니다.');
  if (url.username || url.password) return err('URL에 계정 정보(아이디/비밀번호)를 포함할 수 없습니다.');
  return ok(url.href);
}

/** 크롬 match pattern. 포트를 생략하면 모든 포트에 매칭된다. */
export function hostPermissionPattern(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname}/*`;
}

export function originOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function isSameOrigin(a: string | undefined | null, b: string | undefined | null): boolean {
  const oa = originOf(a);
  return oa !== null && oa === originOf(b);
}

/** 해시(#)를 제외하고 같은 문서 주소인지 비교 */
export function isSameDocumentUrl(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname === ub.pathname && ua.search === ub.search;
  } catch {
    return false;
  }
}
