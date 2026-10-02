'use strict';
// 경제(베팅·정산·상점·채굴·저장) 정확성 + 보안(치트·폭주·위조·입력 검증) 테스트
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const WebSocket = require('../node_modules/ws');
const { createServer } = require('../server/server.js');
const W = require('../shared/world.js');
const { CFG, ITEMS, ROCKS } = W;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const tmpFile = () => `/tmp/td-hard-${process.pid}-${++seq}.json`;

// 메시지를 모두 모으고, 조건을 만족하는 메시지가 올 때까지 기다리는 클라이언트
function client(port, headers = {}) {
  return new Promise((resolve, reject) => {
    const s = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    s.msgs = []; s.waits = [];
    s.on('message', (d) => {
      const m = JSON.parse(d); s.msgs.push(m);
      s.waits = s.waits.filter((w) => { let ok = false; try { ok = w.pred(m); } catch { ok = false; } if (ok) w.done(m); return !ok; });
    });
    s.closed = new Promise((r) => s.on('close', (code) => r(code)));
    s.on('open', () => resolve(s));
    s.on('error', reject);
  });
}
function next(s, pred, ms = 6000) {
  return new Promise((resolve, reject) => {
    const at = new Error().stack.split('\n').slice(2, 5).map((l) => (l.match(/hardening\.test\.js:(\d+)/) || [])[1]).filter(Boolean).join('<');
    const t = setTimeout(() => reject(new Error(`timeout waiting @${at} open=${s.readyState} last=${JSON.stringify(s.msgs.filter((q) => q.t !== 'snap').slice(-3).map((q) => [q.t, q.code || q.text || '']))}`)), ms);
    s.waits.push({ pred, done: (m) => { clearTimeout(t); resolve(m); } });
  });
}
const send = (s, m) => s.send(typeof m === 'string' ? m : JSON.stringify(m));
async function join(port, name, extra = {}) {
  const s = await client(port);
  const w = next(s, (m) => m.t === 'welcome');
  send(s, { t: 'hello', name, g: 'm', seed: 1234 + seq, ...extra });
  s.welcome = await w;
  s.pos = [s.welcome.x, s.welcome.y];
  return s;
}
// 서버 이동 예산(걷기 72px/s) 안에서 조금씩 걸어가기
// 타이머가 밀려 이동이 몰리면 서버가 fix로 되돌리므로, fix를 받으면 서버 위치에서 다시 출발 (실제 클라이언트와 같은 동작)
async function walk(s, to) {
  let [x, y] = s.pos, seen = s.msgs.length;
  for (let guard = 0; guard < 3000 && Math.hypot(to[0] - x, to[1] - y) > 0.5; guard++) {
    const fix = s.msgs.slice(seen).reverse().find((q) => q.t === 'fix'); seen = s.msgs.length;
    if (fix) { x = fix.x; y = fix.y; await sleep(120); }
    const d = Math.hypot(to[0] - x, to[1] - y), k = Math.min(1, 2 / d);
    x += (to[0] - x) * k; y += (to[1] - y) * k;
    send(s, { t: 'move', x, y, d: 0, r: 0 });
    await sleep(40);
  }
  await sleep(150);
  const fix = s.msgs.slice(seen).reverse().find((q) => q.t === 'fix');
  s.pos = fix ? [fix.x, fix.y] : [x, y];
}
// 서버가 실제로 기억하는 내 세션
const sess = (srv, name) => [...srv.sessions.values()].find((q) => q.p && q.p.name === name);
// 응답이 없음을 확인 (무시되어야 하는 요청)
async function silent(s, pred, ms = 400) { const n = s.msgs.length; await sleep(ms); return !s.msgs.slice(n).some(pred); }
const raw = (port, method, path, headers = {}) => new Promise((res, rej) => {
  const r = http.request({ host: '127.0.0.1', port, method, path, headers }, (q) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => res({ status: q.statusCode, headers: q.headers, body: b })); });
  r.on('error', rej); r.end();
});
const upgradeStatus = (port, headers = {}, path = '/ws') => new Promise((resolve) => {
  const s = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
  s.on('open', () => { s.terminate(); resolve(101); });
  s.on('unexpected-response', (req, res) => { resolve(res.statusCode); req.destroy(); });
  s.on('error', () => resolve(-1));
});

// ======================================================================
describe('경제: 베팅 검증·정산 수학', () => {
  let srv, df;
  // 8초 주기: 베팅 0~3.2s, 마감, 경주, 정산
  before(async () => { df = tmpFile(); srv = await createServer({ port: 0, dataFile: df, cycleMs: 8000, log: false, oddsSims: 300 }); });
  after(async () => { await srv.close(); fs.rmSync(df, { force: true }); });

  // 베팅 가능한(배당 계산 끝난) 경주 시작을 기다림
  async function bettingRace(s) {
    for (let i = 0; i < 200; i++) {
      const r = srv.race;
      if (r && r.phase === 'betting' && r.odds && Date.now() - r.startAt < 1500) return r;
      await sleep(50);
    }
    throw new Error('no betting window');
  }

  it('잘못된 베팅은 모두 거절/무시되고 코인이 줄지 않음', async () => {
    const s = await join(srv.port, '검증러');
    const r = await bettingRace(s), coins = sess(srv, '검증러').p.coins;
    const bad = [
      [{ t: 'bet', race: r.id, type: 'win', key: 0, amount: 5 }, 'amount'],           // 최소 미만
      [{ t: 'bet', race: r.id, type: 'win', key: 0, amount: 10.5 }, 'amount'],        // 소수
      [{ t: 'bet', race: r.id, type: 'win', key: 0, amount: -100 }, 'amount'],        // 음수
      [{ t: 'bet', race: r.id, type: 'win', key: 0, amount: '100' }, 'amount'],       // 문자열
      [{ t: 'bet', race: r.id, type: 'win', key: 0, amount: coins + 1 }, 'funds'],    // 잔액 초과
      [{ t: 'bet', race: r.id + 1, type: 'win', key: 0, amount: 10 }, 'closed'],      // 다른 경주
      [{ t: 'bet', race: r.id - 1, type: 'win', key: 0, amount: 10 }, 'closed']       // 지난 경주
    ];
    for (const [m, code] of bad) { const e = next(s, (x) => x.t === 'err'); send(s, m); assert.equal((await e).code, code, JSON.stringify(m)); }
    // 형식이 틀린 키·종류는 응답 없이 무시
    for (const m of [
      { t: 'bet', race: r.id, type: 'win', key: 6, amount: 10 }, { t: 'bet', race: r.id, type: 'win', key: -1, amount: 10 },
      { t: 'bet', race: r.id, type: 'win', key: '0', amount: 10 }, { t: 'bet', race: r.id, type: 'exacta', key: [2, 2], amount: 10 },
      { t: 'bet', race: r.id, type: 'exacta', key: [0], amount: 10 }, { t: 'bet', race: r.id, type: 'exacta', key: '0-1', amount: 10 },
      { t: 'bet', race: r.id, type: 'trifecta', key: 0, amount: 10 }, { t: 'bet', race: r.id, type: '__proto__', key: 0, amount: 10 }
    ]) send(s, m);
    assert.ok(await silent(s, (x) => x.t === 'bet'));
    assert.equal(sess(srv, '검증러').p.coins, coins);
    assert.equal(srv.race.bets.filter((b) => b.h === sess(srv, '검증러').h).length, 0);
    s.close();
  });

  it('한 경주 베팅 횟수 제한 + 모두 취소 시 정확히 환불·배당판 원복', async () => {
    const s = await join(srv.port, '취소러');
    const r = await bettingRace(s), me = sess(srv, '취소러'), c0 = me.p.coins, pool0 = r.pool.slice();
    const all = next(s, (x) => x.t === 'bet' && x.bets.length === CFG.MAX_BETS_PER_RACE);
    for (let i = 0; i < CFG.MAX_BETS_PER_RACE; i++) send(s, { t: 'bet', race: r.id, type: i % 2 ? 'exacta' : 'win', key: i % 2 ? [0, 1] : 2, amount: 11 });
    await all;
    const e = next(s, (x) => x.t === 'err'); send(s, { t: 'bet', race: r.id, type: 'win', key: 0, amount: 10 });
    assert.equal((await e).code, 'limit');
    assert.equal(me.p.coins, c0 - 11 * CFG.MAX_BETS_PER_RACE);
    const c = next(s, (x) => x.t === 'bet' && x.bets.length === 0); send(s, { t: 'cancel' }); await c;
    assert.equal(me.p.coins, c0);
    r.pool.forEach((v, i) => assert.ok(Math.abs(v - pool0[i]) < 1e-9, `pool[${i}] ${v} != ${pool0[i]}`));
    s.close();
  });

  it('정산: 적중 시 floor(금액×배당), 미적중 0, 코인·통계가 정확히 맞음', async () => {
    const s = await join(srv.port, '정산러');
    const r = await bettingRace(s), me = sess(srv, '정산러'), c0 = me.p.coins;
    // 6마리 전부에 단승 + 1·2착 연승 몇 개 + 쌍승 → 반드시 일부 적중
    const bets = [0, 1, 2, 3, 4, 5].map((k) => ({ type: 'win', key: k, amount: 10 + k }));
    bets.push({ type: 'place', key: 0, amount: 13 }, { type: 'exacta', key: [1, 0], amount: 17 });
    // 베팅 구간(3.2초)이 짧으므로 한꺼번에 보내고 마지막 확인만 기다림
    const placed = bets.slice(0, CFG.MAX_BETS_PER_RACE), stake = placed.reduce((a, b) => a + b.amount, 0);
    const all = next(s, (x) => x.t === 'bet' && x.bets.length === placed.length);
    for (const b of placed) send(s, { t: 'bet', race: r.id, ...b });
    await all;
    assert.equal(me.p.coins, c0 - stake);
    // 마감 후에는 베팅·취소 불가
    while (srv.race.phase === 'betting') await sleep(50);
    const e1 = next(s, (x) => x.t === 'err'); send(s, { t: 'cancel' }); assert.equal((await e1).code, 'closed');
    const e2 = next(s, (x) => x.t === 'err'); send(s, { t: 'bet', race: r.id, type: 'win', key: 0, amount: 10 }); assert.equal((await e2).code, 'closed');
    const st = await next(s, (x) => x.t === 'settle' && x.id === r.id, 12000);
    if (!st.mine) throw new Error(`mine=null raceNow=${srv.race.id}/${srv.race.phase} r=${r.id} rbets=${r.bets.length} settled=${r.settled} same=${srv.race === r} msgs=${JSON.stringify(s.msgs.filter((q) => ['bet', 'race', 'phase', 'err', 'settle'].includes(q.t)).map((q) => [q.t, q.id || (q.race && q.race.id), q.phase || (q.race && q.race.phase), q.bets && q.bets.length, q.code]))}`);
    const [a, b2] = st.order;
    let expect = 0;
    for (const pb of st.mine.bets) {
      const hit = pb.type === 'win' ? pb.key === a : pb.type === 'place' ? pb.key === a || pb.key === b2 : pb.key === `${a}-${b2}`;
      assert.equal(pb.pay, hit ? Math.floor(pb.amount * pb.odds) : 0, JSON.stringify(pb));
      expect += pb.pay;
    }
    assert.ok(expect > 0, '단승 6마리 전부 걸었으니 반드시 하나는 적중');
    assert.equal(st.mine.stake, stake);
    assert.equal(st.me.coins, c0 - stake + expect);
    assert.equal(me.p.stats.wagered, stake);
    assert.equal(me.p.stats.returned, expect);
    s.close();
  });

  it('베팅 안 하고 지켜본 접속자는 관람 보너스를 받음', async () => {
    const s = await join(srv.port, '관람러');
    const id = srv.race.id + (srv.race.phase === 'betting' ? 0 : 1), c0 = sess(srv, '관람러').p.coins;
    const st = await next(s, (x) => x.t === 'settle' && x.id >= id, 16000);
    assert.equal(st.mine, null);
    assert.equal(st.me.coins, c0 + CFG.WATCH_BONUS);
    s.close();
  });
});

// ======================================================================
describe('경제: 상점·장착·채굴·저장', () => {
  let srv, df;
  before(async () => { df = tmpFile(); srv = await createServer({ port: 0, dataFile: df, cycleMs: 60000, log: false, oddsSims: 200 }); });
  after(async () => { await srv.close(); fs.rmSync(df, { force: true }); });

  it('구매: 가격만큼 차감·자동 장착, 중복 구매·없는 아이템·프로토타입 키 무시, 잔액 부족 거절', async () => {
    const s = await join(srv.port, '쇼핑러'), me = sess(srv, '쇼핑러');
    const cheap = ITEMS.filter((i) => i.price <= me.p.coins).sort((a, b) => a.price - b.price)[0];
    const c0 = me.p.coins;
    const ok = next(s, (x) => x.t === 'me' && x.me.owned.includes(cheap.id)); send(s, { t: 'buy', item: cheap.id }); await ok;
    assert.equal(me.p.coins, c0 - cheap.price);
    assert.equal(me.p.eq[cheap.slot], cheap.id);
    for (const item of [cheap.id, 'nope', '__proto__', 'constructor', 'toString', 123, null, { id: cheap.id }]) send(s, { t: 'buy', item });
    assert.ok(await silent(s, (x) => x.t === 'me'));
    assert.equal(me.p.coins, c0 - cheap.price);
    assert.equal(me.p.owned.length, 1);
    const pricey = ITEMS.filter((i) => i.price > me.p.coins)[0];
    const e = next(s, (x) => x.t === 'err'); send(s, { t: 'buy', item: pricey.id }); assert.equal((await e).code, 'funds');
    assert.ok(!me.p.owned.includes(pricey.id));
    s.close();
  });

  it('장착: 산 아이템만, 맞는 칸에만, null로 해제', async () => {
    const s = await join(srv.port, '장착러'), me = sess(srv, '장착러');
    const it0 = ITEMS.filter((i) => i.price <= me.p.coins)[0], other = ITEMS.find((i) => i.slot === it0.slot && i.id !== it0.id);
    const ok = next(s, (x) => x.t === 'me' && x.me.owned.includes(it0.id)); send(s, { t: 'buy', item: it0.id }); await ok;
    const wrongSlot = W.SLOTS.find((sl) => sl !== it0.slot);
    for (const m of [{ t: 'equip', slot: it0.slot, item: other.id }, { t: 'equip', slot: wrongSlot, item: it0.id }, { t: 'equip', slot: '__proto__', item: null }, { t: 'equip', slot: 'coins', item: null }]) send(s, m);
    assert.ok(await silent(s, (x) => x.t === 'me'));
    assert.equal(me.p.eq[it0.slot], it0.id);
    assert.equal(me.p.eq[wrongSlot], null);
    assert.ok(!Object.hasOwn(me.p.eq, 'coins'));
    const off = next(s, (x) => x.t === 'me' && x.me.eq[it0.slot] === null); send(s, { t: 'equip', slot: it0.slot, item: null }); await off;
    s.close();
  });

  it('채굴: 먼 바위·쿨다운 무시, 세 번 치면 범위 안의 코인 지급', async () => {
    const s = await join(srv.port, '광부');
    const me = sess(srv, '광부'), rock = ROCKS[0], c0 = me.p.coins;
    send(s, { t: 'mine', rock: rock.id }); // 멀리서
    for (const bad of [-1, 999, '0', null, 1.5]) send(s, { t: 'mine', rock: bad });
    assert.ok(await silent(s, (x) => x.t === 'rock'));
    // 걷기 검증은 '보안: 치트' 테스트에서 따로 하므로 여기선 서버 위치를 바위 앞에 직접 둔다
    me.x = rock.x + 4; me.y = rock.y + 14; s.pos = [me.x, me.y];
    assert.ok(Math.hypot(me.x - rock.x, me.y - rock.y) <= 30, `server pos ${me.x},${me.y}`);
    send(s, { t: 'mine', rock: rock.id }); send(s, { t: 'mine', rock: rock.id }); // 두 번째는 쿨다운으로 무시
    await sleep(CFG.MINE_COOLDOWN_MS + 250);
    send(s, { t: 'mine', rock: rock.id }); await sleep(CFG.MINE_COOLDOWN_MS + 250);
    const done = next(s, (x) => x.t === 'rock' && x.id === rock.id && x.hp === 0);
    send(s, { t: 'mine', rock: rock.id });
    const m = await done.catch((e) => { const live = sess(srv, '광부'); throw new Error(`${e.message} pos=${me.x},${me.y} same=${live === me} live=${live && [live.x, live.y]} bucket=${me.msgB.v.toFixed(1)} flood=${me.flood} sinceMine=${Date.now() - me.mineAt} rock=${JSON.stringify(s.msgs.filter((q) => q.t === 'rock' || q.t === 'fix').slice(-5))}`); });
    assert.ok(m.gem ? m.coins === CFG.GEM_REWARD : m.coins >= CFG.ROCK_REWARD[0] && m.coins <= CFG.ROCK_REWARD[1]);
    assert.equal(me.p.coins, c0 + m.coins);
    // 부서진 바위는 더 못 캠
    await sleep(CFG.MINE_COOLDOWN_MS + 250); send(s, { t: 'mine', rock: rock.id });
    assert.ok(await silent(s, (x) => x.t === 'rock'));
    s.close();
  });

  it('저장: 재시작 후 토큰으로 코인·아이템 복구, 파일에는 토큰 원문이 없음', async () => {
    const s = await join(srv.port, '저장러'), token = s.welcome.token;
    const me = sess(srv, '저장러'), it0 = ITEMS.filter((i) => i.price <= me.p.coins)[0];
    const ok = next(s, (x) => x.t === 'me' && x.me.owned.includes(it0.id)); send(s, { t: 'buy', item: it0.id }); await ok;
    const coins = me.p.coins;
    s.close(); await sleep(100);
    await srv.close();
    const file = fs.readFileSync(df, 'utf8');
    assert.ok(!file.includes(token), '토큰 원문이 저장되면 안 됨');
    srv = await createServer({ port: 0, dataFile: df, cycleMs: 60000, log: false, oddsSims: 200 });
    const s2 = await join(srv.port, '저장러', { token });
    assert.equal(s2.welcome.me.coins, coins);
    assert.ok(s2.welcome.me.owned.includes(it0.id));
    s2.close();
  });

  it('경주 도중 서버가 꺼지면 정산 못 한 베팅은 다음 실행 때 환불', async () => {
    await srv.close();
    srv = await createServer({ port: 0, dataFile: df, cycleMs: 60000, log: false, oddsSims: 200 });
    let r; for (let i = 0; i < 100 && !(srv.race && srv.race.odds); i++) await sleep(50); r = srv.race;
    if (r.phase !== 'betting') return; // 60초 주기 중 베팅 구간(앞 40%)이 아니면 건너뜀
    const s = await join(srv.port, '환불러'), token = s.welcome.token, c0 = s.welcome.me.coins;
    const b = next(s, (x) => x.t === 'bet'); send(s, { t: 'bet', race: r.id, type: 'win', key: 0, amount: 300 }); await b;
    assert.equal(sess(srv, '환불러').p.coins, c0 - 300);
    s.close(); await sleep(100);
    await srv.close();
    srv = await createServer({ port: 0, dataFile: df, cycleMs: 60000, log: false, oddsSims: 200 });
    const s2 = await join(srv.port, '환불러', { token });
    assert.equal(s2.welcome.me.coins, c0);
    s2.close();
  });
});

// ======================================================================
describe('보안: 치트·입력 검증', () => {
  let srv, df;
  before(async () => { df = tmpFile(); srv = await createServer({ port: 0, dataFile: df, cycleMs: 60000, log: false, oddsSims: 200 }); });
  after(async () => { await srv.close(); fs.rmSync(df, { force: true }); });

  it('순간이동·벽 통과·과속은 서버가 되돌림(fix)', async () => {
    const s = await join(srv.port, '치터'), me = sess(srv, '치터');
    const [x0, y0] = [me.x, me.y];
    // 순간이동
    let f = next(s, (x) => x.t === 'fix'); send(s, { t: 'move', x: x0 + 300, y: y0, d: 0, r: 0 }); await f;
    assert.deepEqual([me.x, me.y], [x0, y0]);
    // 과속: 달리기 최대 속도의 3배로 1초 이동 → 예산 소진 후 fix
    const fixes0 = s.msgs.filter((x) => x.t === 'fix').length;
    let x = x0;
    for (let i = 0; i < 20; i++) { x -= (CFG.WALK * CFG.MAX_SPEED_MULT * 3) / 20; send(s, { t: 'move', x, y: y0, d: 0, r: 1 }); await sleep(50); }
    await sleep(100);
    assert.ok(s.msgs.filter((q) => q.t === 'fix').length > fixes0, '과속 이동이 거절되지 않음');
    assert.ok(x0 - me.x < CFG.WALK * CFG.MAX_SPEED_MULT * 1.6, `서버 위치가 너무 멀리 감: ${x0 - me.x}`);
    // 벽(관중석) 안으로
    const stand = W.SOLIDS[W.SOLIDS.length - 1];
    f = next(s, (q) => q.t === 'fix');
    me.budget = 1e9; // 예산 문제와 분리해서 '막힌 칸' 판정만 확인
    send(s, { t: 'move', x: stand.x + stand.w / 2, y: stand.y + stand.h / 2, d: 0, r: 0 }); await f;
    assert.ok(!W.blocked(me.x, me.y));
    s.close();
  });

  it('벽시계가 뒤로 가도(시간 동기화) 입력이 막히지 않음', async () => {
    const s = await join(srv.port, '시계');
    const real = Date.now;
    try {
      const back = real() - 5000; Date.now = () => back + (performance.now() % 1e9) * 0; // 5초 과거로 고정
      for (let i = 0; i < 5; i++) { const p = next(s, (q) => q.t === 'pong'); send(s, { t: 'ping', c: i }); await p; }
      const c = next(s, (q) => q.t === 'chat'); send(s, { t: 'chat', text: '시계 테스트' }); await c;
    } finally { Date.now = real; }
    s.close();
  });

  it('잘못된 형식의 메시지는 서버를 죽이지 않고 무시됨', async () => {
    const s = await join(srv.port, '퍼저');
    const junk = ['', 'null', '[]', '123', '"str"', '{', '{"t":1}', '{"t":"__proto__"}', '{"t":"constructor"}', '{"t":"hasOwnProperty"}',
      '{"t":"move","x":"1","y":2,"d":0}', '{"t":"move","x":null,"y":2,"d":0}', '{"t":"move","x":1e308,"y":1e308,"d":0}', '{"t":"move","x":1,"y":2,"d":9}',
      '{"t":"move","x":1,"y":2,"d":1.5}', '{"t":"chat","text":{"a":1}}', '{"t":"chat","text":["x"]}', '{"t":"emote","e":"__proto__"}',
      '{"t":"rice","id":0}', '{"t":"sell"}', '{"t":"hello","name":"재입장"}', '{"__proto__":{"admin":true},"t":"move"}', JSON.stringify({ t: 'chat', text: 'a'.repeat(1500) })];
    for (const j of junk) send(s, j);
    s.send(Buffer.from([1, 2, 3]), { binary: true });
    await sleep(300);
    assert.equal(s.readyState, WebSocket.OPEN);
    assert.equal(({}).admin, undefined, '프로토타입 오염');
    const me = sess(srv, '퍼저');
    assert.ok(Number.isFinite(me.x) && Number.isFinite(me.y));
    assert.equal(me.p.name, '퍼저', 'hello 재전송으로 이름 변경 불가');
    // 긴 채팅은 잘림 (위에서 채팅을 여러 번 보냈으니 채팅 속도 제한(초당 1.2, 최대 3)이 다 찰 때까지 기다림)
    await sleep(3500);
    const c = next(s, (q) => q.t === 'chat'); send(s, { t: 'chat', text: '가'.repeat(500) });
    const cm = await c.catch((e) => { throw new Error(`${e.message} ${JSON.stringify(s.msgs.filter((q) => q.t !== 'snap').slice(-4)).slice(0, 400)}`); });
    assert.ok([...cm.text].length <= CFG.CHAT_MAX);
    // 이후에도 정상 응답
    const p = next(s, (q) => q.t === 'pong'); send(s, { t: 'ping', c: 1 }); await p;
    s.close();
  });

  it('입장 전(hello 전) 게임 요청은 무시, 10초 안에 hello 없으면 끊김은 별도', async () => {
    const s = await client(srv.port);
    for (const m of [{ t: 'bet', race: 0, type: 'win', key: 0, amount: 10 }, { t: 'buy', item: ITEMS[0].id }, { t: 'chat', text: 'hi' }, { t: 'move', x: 1, y: 1, d: 0 }]) send(s, m);
    assert.ok(await silent(s, () => true));
    s.close();
  });

  it('닉네임 검증: 짧음·특수문자·공백만·욕설·타입 거부, 제어문자·RTL은 지우고 긴 이름은 자름', async () => {
    for (const name of ['a', '<img>', '   ', '\u202E\u202E', '씨발놈', '관리자', '진짜운영자', 'Admin1', 'GM_kim', 'ADMIN', 'gm', 'kimGM', '운영자님', 123, null, ['배열'], { a: 1 }]) {
      const s = await client(srv.port);
      const e = next(s, (q) => q.t === 'err' || q.t === 'welcome');
      send(s, { t: 'hello', name, g: 'm', seed: 1 });
      assert.equal((await e).t, 'err', JSON.stringify(name));
      s.close();
    }
    for (const [name, want] of [['abcdefghijkl', 'abcdefghij'], ['\u202Eevil', 'evil'], ['a\u0000b\u200Bc', 'abc'], ['iPadMini', 'iPadMini'], ['Pigman', 'Pigman'], ['badmint', 'badmint'], ['시스터', '시스터']]) {
      const s = await client(srv.port);
      const e = next(s, (q) => q.t === 'err' || q.t === 'welcome');
      send(s, { t: 'hello', name, g: 'm', seed: 1 });
      const m = await e;
      assert.equal(m.t, 'welcome', JSON.stringify(name));
      assert.equal(m.me.name, want);
      s.close(); await sleep(30);
    }
    for (const bad of [{ g: 'x' }, { seed: -1 }, { seed: 2 ** 33 }, { seed: 1.5 }, { token: 'zz' }]) {
      const s = await client(srv.port);
      const e = next(s, (q) => q.t === 'err' || q.t === 'welcome');
      send(s, { t: 'hello', name: '정상이름', g: 'm', seed: 1, ...bad });
      const m = await e;
      if ('token' in bad) assert.equal(m.t, 'welcome'); // 이상한 토큰은 새 계정으로 처리 (남의 계정 접근 불가)
      else assert.equal(m.t, 'err', JSON.stringify(bad));
      s.close(); await sleep(30);
    }
  });

  it('남의 토큰을 모르면 같은 이름으로 들어갈 수 없고, 같은 토큰 재접속은 이전 창을 끊음', async () => {
    const a = await join(srv.port, '주인'), token = a.welcome.token;
    const thief = await client(srv.port);
    const e = next(thief, (q) => q.t === 'err'); send(thief, { t: 'hello', name: '주인', g: 'm', seed: 2, token: 'f'.repeat(64) });
    assert.equal((await e).code, 'taken');
    thief.close();
    const kicked = next(a, (q) => q.t === 'kicked');
    const b = await join(srv.port, '주인', { token });
    await kicked;
    assert.equal(await a.closed, 4001);
    assert.equal(b.readyState, WebSocket.OPEN);
    b.close();
  });

  it('채팅 HTML은 서버에서 그대로 문자열로 전달 (클라이언트는 textContent로만 표시)', async () => {
    const s = await join(srv.port, '태그러');
    const c = next(s, (q) => q.t === 'chat');
    send(s, { t: 'chat', text: '<img src=x onerror=alert(1)>' });
    assert.equal((await c).text, '<img src=x onerror=alert(1)>');
    s.close();
    // 클라이언트 코드에 HTML 주입 API가 없어야 함
    const src = ['1-core', '2-play', '3-render', '4-ui'].map((f) => fs.readFileSync(`${__dirname}/../client/${f}.js`, 'utf8')).join('\n');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(src));
  });
});

// ======================================================================
describe('보안: 접속 제한·폭주·HTTP', () => {
  let srv, df;
  before(async () => { df = tmpFile(); srv = await createServer({ port: 0, dataFile: df, cycleMs: 60000, log: false, oddsSims: 200, maxPerIp: 3, maxConn: 6, trustProxy: true }); });
  after(async () => { await srv.close(); fs.rmSync(df, { force: true }); });

  it('IP당 접속 제한, X-Forwarded-For 앞부분 위조로 우회 불가, 끊으면 다시 허용', async () => {
    const xff = (i) => ({ 'x-forwarded-for': `10.0.0.${i}, 203.0.113.7` }); // 앞은 클라이언트 마음대로, 끝은 프록시가 붙인 진짜 IP
    const socks = [];
    for (let i = 0; i < 3; i++) socks.push(await client(srv.port, xff(i)));
    assert.equal(await upgradeStatus(srv.port, xff(9)), 429);
    // 다른 실제 IP는 허용
    const other = await client(srv.port, { 'x-forwarded-for': '198.51.100.1' });
    socks[0].close(); await socks[0].closed; await sleep(50);
    const again = await client(srv.port, xff(10));
    for (const s of [...socks.slice(1), other, again]) s.close();
    await sleep(100);
  });

  it('전체 동시 접속 상한', async () => {
    const socks = [];
    for (let i = 0; i < 6; i++) socks.push(await client(srv.port, { 'x-forwarded-for': `198.51.100.${i + 10}` }));
    assert.equal(await upgradeStatus(srv.port, { 'x-forwarded-for': '198.51.100.99' }), 429);
    for (const s of socks) s.close();
    await sleep(100);
  });

  it('다른 사이트에서의 WebSocket 연결(CSWSH)·잘못된 경로 거절', async () => {
    assert.equal(await upgradeStatus(srv.port, { Origin: 'https://evil.example' }), 403);
    assert.equal(await upgradeStatus(srv.port, { Origin: 'not a url' }), 403);
    assert.equal(await upgradeStatus(srv.port, {}, '/other'), 404);
    assert.equal(await upgradeStatus(srv.port, { Origin: `http://127.0.0.1:${srv.port}` }), 101);
    await sleep(100);
  });

  it('메시지 폭주 → 연결 끊김(4008), 너무 큰 메시지 → 끊김(1009)', async () => {
    const a = await client(srv.port, { 'x-forwarded-for': '192.0.2.1' });
    for (let i = 0; i < 400; i++) send(a, { t: 'ping', c: i });
    assert.equal(await a.closed, 4008);
    const b = await client(srv.port, { 'x-forwarded-for': '192.0.2.2' });
    b.send('x'.repeat(5000));
    assert.equal(await b.closed, 1009);
  });

  it('HTTP: 허용 안 된 메서드 405, 경로 조작·숨김 파일 404, 보안 헤더(CSP 인라인 스크립트 금지)', async () => {
    for (const m of ['POST', 'PUT', 'DELETE']) assert.equal((await raw(srv.port, m, '/')).status, 405);
    for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fserver/server.js', '/server/server.js', '/data/players.json', '/.git/config', '/package.json', '/test/server.test.js', '//etc/passwd'])
      assert.equal((await raw(srv.port, 'GET', p)).status, 404, p);
    const r = await raw(srv.port, 'GET', '/');
    assert.equal(r.status, 200);
    const csp = r.headers['content-security-policy'];
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    // 파일 내용에 서버 소스·데이터 경로가 섞여 나가지 않음
    assert.ok(!/require\('fs'\)/.test(r.body));
  });
});
