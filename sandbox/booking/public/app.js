// 테스트 예매 페이지 UI. 모든 상호작용 요소에 data-testid를 부여해 테스트가 문구/스타일 변경에 흔들리지 않게 한다.
const $ = (id) => document.querySelector(`[data-testid="${id}"]`);
const sessionId = crypto.randomUUID();
const state = { selected: null, holdId: null };

const ERROR_TEXT = {
  SEAT_HELD: '다른 사용자가 이미 선점한 좌석입니다.',
  SEAT_SOLD: '이미 판매된 좌석입니다.',
  HOLD_EXPIRED: '선점 시간이 만료되었습니다.',
};

function setStatus(text, isError = false) {
  const el = $('status-message');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

async function renderSeats() {
  const { data } = await api('/api/seats');
  const grid = $('seat-grid');
  grid.replaceChildren(
    ...data.seats.map((seat) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'seat';
      btn.textContent = seat.id;
      btn.dataset.testid = `seat-${seat.id}`;
      btn.dataset.status = seat.status;
      btn.disabled = seat.status !== 'available' || state.holdId !== null;
      btn.setAttribute('aria-pressed', String(state.selected === seat.id));
      btn.addEventListener('click', () => selectSeat(seat.id));
      return btn;
    }),
  );
}

function selectSeat(id) {
  state.selected = id;
  $('selected-seat').textContent = id;
  $('hold-button').disabled = false;
  setStatus('');
  renderSeats();
}

$('hold-button').addEventListener('click', async () => {
  $('hold-button').disabled = true;
  setStatus('선점 요청 중...');
  const { status, data } = await api('/api/holds', { seatId: state.selected, sessionId });
  if (status === 201) {
    state.holdId = data.holdId;
    $('confirm-button').disabled = false;
    setStatus(`${data.seatId} 좌석을 선점했습니다. 확정해 주세요.`);
  } else {
    state.selected = null;
    $('selected-seat').textContent = '없음';
    setStatus(ERROR_TEXT[data.error] ?? `오류: ${data.error}`, true);
  }
  renderSeats();
});

$('confirm-button').addEventListener('click', async () => {
  $('confirm-button').disabled = true;
  setStatus('확정 요청 중...');
  const { status, data } = await api('/api/bookings', { holdId: state.holdId, sessionId });
  if (status === 201 || status === 200) {
    setStatus('예매가 완료되었습니다.');
    const result = $('booking-result');
    result.textContent = `예매번호 ${data.bookingId} / 좌석 ${data.seatId}`;
    result.dataset.bookingId = data.bookingId;
    result.hidden = false;
  } else {
    state.holdId = null;
    setStatus(ERROR_TEXT[data.error] ?? `오류: ${data.error}`, true);
  }
  renderSeats();
});

$('session-id').textContent = sessionId.slice(0, 8);
renderSeats();
