// 로컬 테스트 페이지 상태 머신. 실제 예매 로직/네트워크 요청은 없다.
(() => {
  'use strict';

  const STATES = ['before-open', 'disabled', 'disabled-aria', 'enabled', 'removed', 'renamed', 'next-screen'];
  const area = document.getElementById('booking-area');
  const notice = document.getElementById('state-notice');
  const current = document.getElementById('current-state');
  const clock = document.getElementById('server-clock');
  let autoOpenTimer = null;

  function el(tag, attrs = {}, text = '') {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
    if (text) node.textContent = text;
    return node;
  }

  function bookButton(extra = {}) {
    return el('button', { type: 'button', id: 'book-btn', class: 'book-btn', ...extra }, '예매하기');
  }

  function renderNextScreen() {
    const seats = el('div', { class: 'seats' });
    for (let i = 1; i <= 12; i += 1) seats.append(el('span', { class: 'seat' }, `${i}`));
    area.replaceChildren(el('h2', {}, '좌석 선택'), el('p', {}, '원하는 좌석을 선택하세요. (테스트 화면)'), seats);
  }

  const RENDERERS = {
    'before-open': () => {
      notice.textContent = '예매 오픈 전입니다.';
      area.replaceChildren(bookButton({ hidden: true }));
    },
    disabled: () => {
      notice.textContent = '곧 예매가 시작됩니다.';
      area.replaceChildren(bookButton({ disabled: true }));
    },
    'disabled-aria': () => {
      notice.textContent = '곧 예매가 시작됩니다. (aria-disabled 링크 버튼)';
      area.replaceChildren(
        el('a', { href: '#', role: 'button', id: 'book-btn', class: 'book-btn is-disabled', 'aria-disabled': 'true' }, '예매하기'),
      );
    },
    enabled: () => {
      notice.textContent = '예매가 시작되었습니다!';
      const button = bookButton();
      button.addEventListener('click', () => setTicketState('next-screen'));
      area.replaceChildren(button);
    },
    removed: () => {
      notice.textContent = '페이지 구조가 변경되었습니다. (감지 대상 요소 없음)';
      area.replaceChildren(el('div', { class: 'new-layout' }, '새 레이아웃 영역'));
    },
    renamed: () => {
      notice.textContent = '버튼 문구가 변경되었습니다.';
      area.replaceChildren(el('button', { type: 'button', class: 'book-btn' }, '티켓 구매'));
    },
    'next-screen': () => {
      notice.textContent = '';
      renderNextScreen();
    },
  };

  function setTicketState(state) {
    if (!STATES.includes(state)) throw new Error(`unknown state: ${state}`);
    RENDERERS[state]();
    current.textContent = state;
    document.body.dataset.state = state;
  }

  function scheduleAutoOpen(seconds) {
    if (autoOpenTimer) clearTimeout(autoOpenTimer);
    autoOpenTimer = setTimeout(() => setTicketState('enabled'), seconds * 1000);
    notice.textContent += ` (${seconds}초 뒤 자동 오픈)`;
  }

  // 실제 예매 사이트처럼 매초(여기선 100ms) 바뀌는 시계: MutationObserver 스로틀링 검증용 잡음
  setInterval(() => {
    clock.textContent = new Date().toLocaleTimeString('ko-KR', { hour12: false, timeZone: 'Asia/Seoul' });
  }, 100);

  document.querySelectorAll('[data-state]').forEach((button) => {
    button.addEventListener('click', () => setTicketState(button.dataset.state));
  });

  const params = new URLSearchParams(location.search);
  const initial = params.get('state');
  setTicketState(STATES.includes(initial) ? initial : 'before-open');
  const openIn = Number(params.get('openIn'));
  if (Number.isFinite(openIn) && openIn > 0) scheduleAutoOpen(Math.min(openIn, 3600));

  window.setTicketState = setTicketState;
})();
