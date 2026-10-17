// 입력 검증 폼 테스트: 고정 테스트 토큰(TEST42)은 서버가 test 모드로 떠 있을 때만 통과해야 한다.
import { spawn } from 'node:child_process';
import { test, expect } from './local-only.js';
import { actAndWaitForApi } from './network-helpers.js';
import { STRICT_PORT } from '../playwright.config.js';

const TEST_TOKEN = 'TEST42';

async function fillForm(page, { name, token }) {
  await page.getByTestId('name-input').fill(name);
  await page.getByTestId('token-input').fill(token);
}

test.describe('test 모드 서버', () => {
  test.beforeEach(async ({ page, request }) => {
    void request; // 서버 상태(시도 횟수) reset
    await page.goto('/verify.html');
    await expect(page.getByTestId('verify-mode')).toHaveText('test');
  });

  test('올바른 테스트 토큰 -> 200 + 성공 표시', async ({ page }) => {
    await fillForm(page, { name: '홍길동', token: TEST_TOKEN });
    const { response, body } = await actAndWaitForApi(page, 'POST', '/api/verify', () =>
      page.getByTestId('verify-submit').click(),
    );

    expect(response.status()).toBe(200);
    expect(body).toMatchObject({ verified: true, name: '홍길동', verificationId: expect.stringMatching(/^VF-/) });
    await expect(page.getByTestId('verify-status')).toHaveText('검증에 성공했습니다.');
    await expect(page.getByTestId('verify-result')).toHaveAttribute('data-verification-id', body.verificationId);
    await expect(page.getByTestId('token-input')).not.toHaveAttribute('aria-invalid');
  });

  test('틀린 토큰 -> 422 INVALID_TOKEN + 필드 오류 + 남은 시도 횟수', async ({ page }) => {
    await fillForm(page, { name: '홍길동', token: 'WRONG1' });
    const { response, body } = await actAndWaitForApi(page, 'POST', '/api/verify', () =>
      page.getByTestId('verify-submit').click(),
    );

    expect(response.status()).toBe(422);
    expect(body).toEqual({ error: 'INVALID_TOKEN', mode: 'test', remainingAttempts: 4 });
    await expect(page.getByTestId('token-input')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('token-error')).toHaveText('토큰이 올바르지 않습니다.');
    await expect(page.getByTestId('verify-status')).toContainText('남은 시도 4회');
    await expect(page.getByTestId('verify-result')).toBeHidden();
  });

  test('형식이 틀린 입력은 클라이언트에서 막고 서버 요청을 보내지 않는다', async ({ page }) => {
    const verifyRequests = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/verify') verifyRequests.push(r);
    });

    await fillForm(page, { name: '홍', token: 'test42' }); // 이름 1자, 소문자 토큰
    await page.getByTestId('verify-submit').click();

    await expect(page.getByTestId('name-error')).toHaveText('이름은 2~20자로 입력해 주세요.');
    await expect(page.getByTestId('token-error')).toHaveText('토큰은 대문자/숫자 6자리입니다.');
    await expect(page.getByTestId('name-input')).toHaveAttribute('aria-invalid', 'true');
    expect(verifyRequests).toHaveLength(0);
  });

  test('클라이언트 검증을 거치지 않은 요청도 서버가 다시 검증한다 (400)', async ({ request }) => {
    const res = await request.post('/api/verify', { data: { name: 'x', token: 'test42', sessionId: 'raw' } });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({
      error: 'VALIDATION_FAILED',
      fieldErrors: { name: 'NAME_LENGTH', token: 'TOKEN_FORMAT' },
    });
  });

  test('5회 실패 후에는 올바른 토큰도 429로 막힌다', async ({ page }) => {
    await fillForm(page, { name: '홍길동', token: 'WRONG1' });
    for (let remaining = 4; remaining >= 0; remaining--) {
      const { body } = await actAndWaitForApi(page, 'POST', '/api/verify', () =>
        page.getByTestId('verify-submit').click(),
      );
      expect(body.remainingAttempts).toBe(remaining);
    }

    await page.getByTestId('token-input').fill(TEST_TOKEN);
    const { response } = await actAndWaitForApi(page, 'POST', '/api/verify', () =>
      page.getByTestId('verify-submit').click(),
    );
    expect(response.status()).toBe(429);
    await expect(page.getByTestId('verify-status')).toHaveText('시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.');
  });
});

test.describe('strict 모드 서버 (운영과 같은 설정)', () => {
  test('테스트 토큰은 strict 모드에서 거부된다', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${STRICT_PORT}/verify.html`);
    await expect(page.getByTestId('verify-mode')).toHaveText('strict');

    await fillForm(page, { name: '홍길동', token: TEST_TOKEN });
    const { response, body } = await actAndWaitForApi(page, 'POST', '/api/verify', () =>
      page.getByTestId('verify-submit').click(),
    );
    expect(response.status()).toBe(422);
    expect(body).toMatchObject({ error: 'INVALID_TOKEN', mode: 'strict' });
    await expect(page.getByTestId('verify-result')).toBeHidden();
  });

  test('NODE_ENV=production 에서는 test 모드로 시작할 수 없다', async () => {
    const child = spawn(process.execPath, ['server.js'], {
      env: { ...process.env, NODE_ENV: 'production', VERIFY_MODE: 'test', PORT: '4399' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    const code = await new Promise((resolve) => child.on('exit', resolve));

    expect(code).toBe(1);
    expect(stderr).toContain('VERIFY_MODE=test');
  });
});
