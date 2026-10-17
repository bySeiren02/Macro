// 입력 검증 폼. 클라이언트 검증은 빠른 피드백용이고, 최종 판정은 서버 응답으로 한다.
const $ = (id) => document.querySelector(`[data-testid="${id}"]`);
const sessionId = crypto.randomUUID();

const MESSAGES = {
  NAME_LENGTH: '이름은 2~20자로 입력해 주세요.',
  TOKEN_FORMAT: '토큰은 대문자/숫자 6자리입니다.',
  INVALID_TOKEN: '토큰이 올바르지 않습니다.',
  TOO_MANY_ATTEMPTS: '시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.',
};

function setFieldError(field, code) {
  const input = $(`${field}-input`);
  $(`${field}-error`).textContent = code ? MESSAGES[code] : '';
  if (code) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

function setStatus(text, isError = false) {
  const el = $('verify-status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function validateLocally() {
  const name = $('name-input');
  const token = $('token-input');
  setFieldError('name', name.validity.valid ? null : 'NAME_LENGTH');
  setFieldError('token', token.validity.valid ? null : 'TOKEN_FORMAT');
  return name.validity.valid && token.validity.valid;
}

$('verify-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('verify-result').hidden = true;
  if (!validateLocally()) {
    setStatus('입력값을 확인해 주세요.', true);
    return; // 서버 요청을 보내지 않는다
  }
  const submit = $('verify-submit');
  submit.disabled = true;
  setStatus('검증 중...');
  try {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: $('name-input').value, token: $('token-input').value, sessionId }),
    });
    const data = await res.json();
    if (res.status === 200 && data.verified) {
      setStatus('검증에 성공했습니다.');
      const result = $('verify-result');
      result.textContent = `검증번호 ${data.verificationId}`;
      result.dataset.verificationId = data.verificationId;
      result.hidden = false;
    } else if (data.fieldErrors) {
      setFieldError('name', data.fieldErrors.name ?? null);
      setFieldError('token', data.fieldErrors.token ?? null);
      setStatus('입력값을 확인해 주세요.', true);
    } else {
      const suffix = typeof data.remainingAttempts === 'number' ? ` (남은 시도 ${data.remainingAttempts}회)` : '';
      setStatus((MESSAGES[data.error] ?? `오류: ${data.error}`) + suffix, true);
      if (data.error === 'INVALID_TOKEN') setFieldError('token', 'INVALID_TOKEN');
    }
  } finally {
    submit.disabled = false;
  }
});

fetch('/api/verify/config')
  .then((r) => r.json())
  .then((c) => ($('verify-mode').textContent = c.mode));
