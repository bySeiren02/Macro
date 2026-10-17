// 네트워크 검증/디버깅 헬퍼 (학습용).

/** 메서드 + 경로로 응답을 고르는 predicate. URL 전체 문자열 비교보다 쿼리/호스트 변화에 덜 깨진다. */
export function api(method, pathname) {
  return (response) =>
    response.request().method() === method && new URL(response.url()).pathname === pathname;
}

/**
 * 클릭(또는 임의 동작)과 그 동작이 일으키는 응답을 동기화한다.
 * 핵심: waitForResponse를 "동작 전에" 등록해야 한다. 클릭 후에 등록하면 이미 지나간 응답을 놓칠 수 있다.
 * @returns {Promise<{ response: import('@playwright/test').Response, body: any }>}
 */
export async function actAndWaitForApi(page, method, pathname, action) {
  const [response] = await Promise.all([page.waitForResponse(api(method, pathname)), action()]);
  const body = await response.json();
  return { response, body };
}

/**
 * /api/ 요청과 응답을 시간순으로 기록한다. 테스트가 실패하면 기록을 리포트에 첨부해서 원인을 추적할 수 있다.
 * page.on('response')는 관찰만 한다. 요청을 바꾸거나 막지 않는다.
 */
export function recordApiTraffic(page) {
  const entries = [];
  const started = Date.now();
  page.on('request', (request) => {
    if (!new URL(request.url()).pathname.startsWith('/api/')) return;
    entries.push({
      t: Date.now() - started,
      type: 'request',
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: request.postDataJSON?.() ?? null,
    });
  });
  page.on('response', async (response) => {
    if (!new URL(response.url()).pathname.startsWith('/api/')) return;
    const entry = {
      t: Date.now() - started,
      type: 'response',
      method: response.request().method(),
      path: new URL(response.url()).pathname,
      status: response.status(),
      body: null,
    };
    entries.push(entry);
    try {
      entry.body = await response.json();
    } catch {
      entry.body = '(JSON 아님 또는 페이지 종료로 본문 읽기 실패)';
    }
  });
  page.on('requestfailed', (request) => {
    entries.push({ t: Date.now() - started, type: 'failed', path: request.url(), error: request.failure()?.errorText });
  });
  return entries;
}
