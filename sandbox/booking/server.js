// 로컬 전용 테스트 예매 서버. 학습 포인트: 좌석 단위 락으로 "확인 후 쓰기" 경쟁 상태(race condition) 방지.
// 사용법: npm start  (PORT 기본 4300, 항상 127.0.0.1에만 바인딩)
import express from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT ?? 4300);
const HOLD_TTL_MS = Number(process.env.HOLD_TTL_MS ?? 60_000);
// 실제 DB 왕복을 흉내 내는 지연. 이 지연 때문에 락이 없으면 중복 예매가 발생한다.
const DB_DELAY_MS = Number(process.env.DB_DELAY_MS ?? 30);
// 학습용: UNSAFE=1 이면 락 없이 처리해서 경쟁 상태를 직접 재현할 수 있다.
const UNSAFE = process.env.UNSAFE === '1';

// 입력 검증 모드. 기본값은 strict(안전한 기본값). test 모드에서만 고정 테스트 토큰을 허용한다.
// 테스트 우회는 "서버 설정"으로만 켜진다. 클라이언트가 우회를 요청할 방법은 없다.
const VERIFY_MODE = process.env.VERIFY_MODE ?? 'strict';
const TEST_TOKEN = 'TEST42';
const MAX_VERIFY_ATTEMPTS = 5;
if (!['strict', 'test'].includes(VERIFY_MODE)) {
  console.error(`VERIFY_MODE는 strict 또는 test 여야 합니다: ${VERIFY_MODE}`);
  process.exit(1);
}
if (VERIFY_MODE === 'test' && process.env.NODE_ENV === 'production') {
  console.error('NODE_ENV=production 에서는 VERIFY_MODE=test 로 시작할 수 없습니다.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 상태 (메모리) ----
const SEAT_IDS = ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'B5'];
let seats;   // seatId -> { status: 'available' | 'held' | 'sold', holdId?, sessionId? }
let holds;   // holdId -> { seatId, sessionId, expiresAt }
let bookings; // bookingId -> { seatId, sessionId, holdId }
let bookingByHold; // holdId -> bookingId (확정 요청 멱등성)
let verifyAttempts; // sessionId -> 실패 횟수

// API 응답의 비즈니스 상태값. 내부 status와 분리해서 클라이언트/테스트가 이 값으로 판단하게 한다.
const STATE = { available: 'AVAILABLE', held: 'HELD', sold: 'CONFIRMED' };
const stateOf = (seatId) => STATE[seats.get(seatId).status];

function resetState() {
  seats = new Map(SEAT_IDS.map((id) => [id, { status: 'available' }]));
  holds = new Map();
  bookings = new Map();
  bookingByHold = new Map();
  verifyAttempts = new Map();
}
resetState();

// ---- 좌석 단위 비동기 락 (promise chain) ----
// 같은 좌석에 대한 요청은 줄을 서서 하나씩, 다른 좌석은 병렬로 처리된다.
const locks = new Map();
async function withSeatLock(seatId, fn) {
  if (UNSAFE) return fn();
  const prev = locks.get(seatId) ?? Promise.resolve();
  let release;
  const current = new Promise((r) => (release = r));
  const tail = prev.then(() => current);
  locks.set(seatId, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(seatId) === tail) locks.delete(seatId);
  }
}

function expireHold(seatId) {
  const seat = seats.get(seatId);
  if (seat?.status !== 'held') return;
  const hold = holds.get(seat.holdId);
  if (!hold || hold.expiresAt <= Date.now()) {
    holds.delete(seat.holdId);
    seats.set(seatId, { status: 'available' });
  }
}

// ---- HTTP ----
const app = express();
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')));

app.get('/api/seats', (_req, res) => {
  for (const id of SEAT_IDS) expireHold(id);
  res.json({ seats: SEAT_IDS.map((id) => ({ id, status: seats.get(id).status, state: stateOf(id) })) });
});

// 좌석 선점: 확인(available?) -> 지연(DB) -> 쓰기(held). 락이 이 구간을 원자적으로 만든다.
app.post('/api/holds', async (req, res) => {
  const { seatId, sessionId } = req.body ?? {};
  if (!seats.has(seatId) || typeof sessionId !== 'string' || !sessionId) {
    return res.status(400).json({ error: 'INVALID_REQUEST' });
  }
  const result = await withSeatLock(seatId, async () => {
    expireHold(seatId);
    const seat = seats.get(seatId);
    if (seat.status !== 'available') {
      return { code: 409, body: { error: seat.status === 'sold' ? 'SEAT_SOLD' : 'SEAT_HELD', seatId, state: stateOf(seatId) } };
    }
    await sleep(DB_DELAY_MS);
    const holdId = randomUUID();
    const expiresAt = Date.now() + HOLD_TTL_MS;
    holds.set(holdId, { seatId, sessionId, expiresAt });
    seats.set(seatId, { status: 'held', holdId, sessionId });
    return { code: 201, body: { holdId, seatId, expiresAt, state: stateOf(seatId) } };
  });
  res.status(result.code).json(result.body);
});

// 예매 확정: 같은 holdId로 여러 번 요청해도 예매는 1건만 생성된다(멱등).
app.post('/api/bookings', async (req, res) => {
  const { holdId, sessionId } = req.body ?? {};
  const hold = holds.get(holdId);
  const existing = bookingByHold.get(holdId);
  if (existing) return res.status(200).json({ bookingId: existing, seatId: bookings.get(existing).seatId, state: 'CONFIRMED', replay: true });
  if (!hold) return res.status(404).json({ error: 'HOLD_NOT_FOUND' });
  if (hold.sessionId !== sessionId) return res.status(403).json({ error: 'NOT_YOUR_HOLD' });

  const result = await withSeatLock(hold.seatId, async () => {
    const again = bookingByHold.get(holdId);
    if (again) return { code: 200, body: { bookingId: again, seatId: hold.seatId, state: 'CONFIRMED', replay: true } };
    if (hold.expiresAt <= Date.now()) {
      expireHold(hold.seatId);
      return { code: 410, body: { error: 'HOLD_EXPIRED', seatId: hold.seatId, state: stateOf(hold.seatId) } };
    }
    await sleep(DB_DELAY_MS);
    const bookingId = `BK-${randomUUID().slice(0, 8).toUpperCase()}`;
    bookings.set(bookingId, { seatId: hold.seatId, sessionId, holdId });
    bookingByHold.set(holdId, bookingId);
    holds.delete(holdId);
    seats.set(hold.seatId, { status: 'sold' });
    return { code: 201, body: { bookingId, seatId: hold.seatId, state: stateOf(hold.seatId) } };
  });
  res.status(result.code).json(result.body);
});

// 입력 폼 검증. 클라이언트 검증은 UX용이고, 판정은 항상 서버가 다시 한다.
app.get('/api/verify/config', (_req, res) => res.json({ mode: VERIFY_MODE }));

app.post('/api/verify', (req, res) => {
  const { name, token, sessionId } = req.body ?? {};
  if (typeof sessionId !== 'string' || !sessionId) return res.status(400).json({ error: 'INVALID_REQUEST' });

  const failures = verifyAttempts.get(sessionId) ?? 0;
  if (failures >= MAX_VERIFY_ATTEMPTS) return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS' });

  const fieldErrors = {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 20) fieldErrors.name = 'NAME_LENGTH';
  if (typeof token !== 'string' || !/^[A-Z0-9]{6}$/.test(token)) fieldErrors.token = 'TOKEN_FORMAT';
  if (Object.keys(fieldErrors).length) return res.status(400).json({ error: 'VALIDATION_FAILED', fieldErrors });

  // strict 모드: 실제 운영이라면 외부 검증 서비스에 위임할 자리. 로컬 모의 환경에서는 항상 거부한다.
  const accepted = VERIFY_MODE === 'test' && token === TEST_TOKEN;
  if (!accepted) {
    verifyAttempts.set(sessionId, failures + 1);
    return res.status(422).json({
      error: 'INVALID_TOKEN',
      mode: VERIFY_MODE,
      remainingAttempts: MAX_VERIFY_ATTEMPTS - failures - 1,
    });
  }
  verifyAttempts.delete(sessionId);
  res.status(200).json({ verified: true, verificationId: `VF-${randomUUID().slice(0, 8).toUpperCase()}`, name: name.trim() });
});

// 테스트 격리용 초기화 (로컬 서버라서 허용)
app.post('/api/reset', (_req, res) => {
  resetState();
  res.json({ ok: true });
});

app.listen(PORT, HOST, () => {
  console.log(`booking sandbox: http://${HOST}:${PORT}  (lock: ${UNSAFE ? 'OFF (UNSAFE)' : 'ON'}, verify: ${VERIFY_MODE})`);
});
