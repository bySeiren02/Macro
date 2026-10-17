// 동시성 제어 실험실: 여러 워커 스레드가 "같은 DB 파일"의 같은 좌석을 동시에 선점하고, 전략별로 승자가 몇 명인지 센다.
// 워커마다 별도 DB 연결을 쓰므로 프로세스 여러 개(서버 인스턴스 여러 대)가 DB 하나를 공유하는 상황과 같다.
// 사용법: node experiments/race-lab.mjs [--workers 8] [--rounds 20] [--gap 5] [--only atomic]
import { Worker, isMainThread, workerData, parentPort } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

// 읽기와 쓰기 사이의 간격(ms). 실제 서비스의 검증 로직, 외부 호출, 네트워크 지연을 흉내 낸다.
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * 전략: (db, workerId, gapMs) => true(선점 성공) | false(실패)
 * 모든 전략의 목표는 같다. "AVAILABLE인 좌석 A1을 HELD로 바꾸고 holder에 내 id를 기록"
 */
const STRATEGIES = {
  // 1) 확인 후 쓰기 (check-then-act). 읽은 값이 쓰는 시점에도 유효하다고 가정 -> 경쟁 상태
  naive(db, me, gap) {
    const seat = db.prepare(`SELECT status FROM seats WHERE id = 'A1'`).get();
    if (seat.status !== 'AVAILABLE') return false;
    sleepSync(gap);
    db.prepare(`UPDATE seats SET status = 'HELD', holder = ? WHERE id = 'A1'`).run(me);
    return true;
  },

  // 2) 원자적 조건부 갱신. 확인과 쓰기를 한 문장으로 합친다. DB가 행 단위로 직렬화해 준다.
  atomic(db, me, gap) {
    sleepSync(gap); // 간격이 어디 있든 판정은 UPDATE 한 문장 안에서 일어나므로 영향 없음
    const { changes } = db
      .prepare(`UPDATE seats SET status = 'HELD', holder = ? WHERE id = 'A1' AND status = 'AVAILABLE'`)
      .run(me);
    return changes === 1;
  },

  // 3) 낙관적 락. 읽을 때 version을 기억하고, 쓸 때 version이 그대로인지 조건으로 건다.
  //    충돌이 드문 경우 락 대기 없이 빠르다. 충돌 시 재시도(여기서는 즉시 실패) 정책이 필요하다.
  optimistic(db, me, gap) {
    const seat = db.prepare(`SELECT status, version FROM seats WHERE id = 'A1'`).get();
    if (seat.status !== 'AVAILABLE') return false;
    sleepSync(gap);
    const { changes } = db
      .prepare(`UPDATE seats SET status = 'HELD', holder = ?, version = version + 1 WHERE id = 'A1' AND version = ?`)
      .run(me, seat.version);
    return changes === 1;
  },

  // 4) 비관적 락 (트랜잭션). 읽기 전에 쓰기 락을 먼저 잡는다.
  //    SQLite의 BEGIN IMMEDIATE ~= PostgreSQL/MySQL의 SELECT ... FOR UPDATE.
  //    락을 잡은 동안 다른 트랜잭션은 대기(busy_timeout)하므로 확인-쓰기 사이 간격이 있어도 안전하다.
  pessimistic(db, me, gap) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const seat = db.prepare(`SELECT status FROM seats WHERE id = 'A1'`).get();
      if (seat.status !== 'AVAILABLE') {
        db.exec('ROLLBACK');
        return false;
      }
      sleepSync(gap);
      db.prepare(`UPDATE seats SET status = 'HELD', holder = ? WHERE id = 'A1'`).run(me);
      db.exec('COMMIT');
      return true;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },

  // 5) 유니크 제약. "좌석당 활성 선점은 1건" 이라는 규칙을 스키마에 맡긴다. 애플리케이션 버그가 있어도 DB가 막는다.
  unique(db, me, gap) {
    sleepSync(gap);
    try {
      db.prepare(`INSERT INTO holds (seat_id, holder) VALUES ('A1', ?)`).run(me);
      return true;
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return false;
      throw err;
    }
  },
};

function openDb(file) {
  const db = new DatabaseSync(file);
  // 락 대기 시간을 가장 먼저 설정해야 연결 직후의 쿼리도 "database is locked" 대신 대기한다
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

function resetDb(file) {
  const db = openDb(file);
  db.exec('PRAGMA journal_mode = WAL;'); // DB 파일 속성이라 초기화 때 한 번만 설정
  db.exec(`
    DROP TABLE IF EXISTS seats; DROP TABLE IF EXISTS holds;
    CREATE TABLE seats (id TEXT PRIMARY KEY, status TEXT NOT NULL, holder INTEGER, version INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE holds (seat_id TEXT NOT NULL UNIQUE, holder INTEGER NOT NULL);
    INSERT INTO seats (id, status) VALUES ('A1', 'AVAILABLE');
  `);
  db.close();
}

/** 라운드 종료 후 DB 상태가 승자 기록과 일치하는지 (불변식) */
function finalHolders(file, strategy) {
  const db = openDb(file);
  const rows =
    strategy === 'unique'
      ? db.prepare(`SELECT holder FROM holds WHERE seat_id = 'A1'`).all()
      : db.prepare(`SELECT holder FROM seats WHERE id = 'A1' AND status = 'HELD'`).all();
  db.close();
  return rows.map((r) => r.holder);
}

// ---------------- 워커 ----------------
if (!isMainThread) {
  const { file, strategy, id, gap, barrier } = workerData;
  const db = openDb(file);
  const gate = new Int32Array(barrier);
  // 출발선: 모든 워커가 준비될 때까지 대기 후 동시에 출발
  Atomics.add(gate, 1, 1);
  Atomics.wait(gate, 0, 0);
  let won = false;
  let error = null;
  try {
    won = STRATEGIES[strategy](db, id, gap);
  } catch (err) {
    error = err.message;
  }
  db.close();
  parentPort.postMessage({ id, won, error });
}

// ---------------- 메인 ----------------
async function runRound(file, strategy, workers, gap) {
  resetDb(file);
  const barrier = new SharedArrayBuffer(8); // [0]=출발 신호, [1]=준비된 워커 수
  const gate = new Int32Array(barrier);
  const results = [];
  const done = Array.from({ length: workers }, (_, id) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { file, strategy, id, gap, barrier } });
    return new Promise((resolve, reject) => {
      w.once('message', (m) => results.push(m));
      w.once('error', reject);
      w.once('exit', resolve);
    });
  });
  while (Atomics.load(gate, 1) < workers) await new Promise((r) => setTimeout(r, 1));
  Atomics.store(gate, 0, 1);
  Atomics.notify(gate, 0);
  await Promise.all(done);

  const winners = results.filter((r) => r.won).map((r) => r.id);
  const errors = results.filter((r) => r.error).map((r) => r.error);
  const holders = finalHolders(file, strategy);
  // 승자가 여럿이면, DB에 남은 holder는 마지막에 쓴 1명뿐이고 나머지는 "성공 응답을 받았지만 좌석이 없는" 사용자 (lost update)
  const lostUpdates = winners.filter((w) => !holders.includes(w)).length;
  return { winners: winners.length, lostUpdates, errors };
}

if (isMainThread) {
  const { values } = parseArgs({
    options: {
      workers: { type: 'string', default: '8' },
      rounds: { type: 'string', default: '20' },
      gap: { type: 'string', default: '5' },
      only: { type: 'string' },
    },
  });
  const workers = Number(values.workers);
  const rounds = Number(values.rounds);
  const gap = Number(values.gap);
  const names = values.only ? values.only.split(',') : Object.keys(STRATEGIES);

  const dir = mkdtempSync(path.join(tmpdir(), 'race-lab-'));
  const file = path.join(dir, 'lab.db');
  console.log(`workers=${workers} rounds=${rounds} gap=${gap}ms  db=${file}\n`);

  const summary = [];
  let violated = false;
  for (const strategy of names) {
    if (!STRATEGIES[strategy]) throw new Error(`알 수 없는 전략: ${strategy}`);
    let overbooked = 0;
    let maxWinners = 0;
    let lost = 0;
    let errors = 0;
    const started = performance.now();
    for (let i = 0; i < rounds; i++) {
      const r = await runRound(file, strategy, workers, gap);
      if (r.winners !== 1) overbooked++;
      maxWinners = Math.max(maxWinners, r.winners);
      lost += r.lostUpdates;
      errors += r.errors.length;
    }
    const ok = overbooked === 0 && errors === 0;
    if (!ok && strategy !== 'naive') violated = true;
    summary.push({
      전략: strategy,
      '불변식(승자=1) 위반 라운드': `${overbooked}/${rounds}`,
      '최대 승자 수': maxWinners,
      'lost update': lost,
      오류: errors,
      'ms/라운드': Math.round((performance.now() - started) / rounds),
      판정: ok ? 'SAFE' : 'UNSAFE',
    });
  }
  console.table(summary);
  rmSync(dir, { recursive: true, force: true });
  // naive는 실패가 "기대값"이다. 나머지 전략이 깨지면 종료 코드 1
  process.exitCode = violated ? 1 : 0;
}
