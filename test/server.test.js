'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const WebSocket = require('../node_modules/ws');
const { createServer } = require('../server/server.js');
const crypto = require('crypto');

let srv, port;
const tmp = `/tmp/td/test-${Date.now()}.json`;

function ws(path = '/ws') {
  return new Promise((resolve, reject) => {
    const s = new WebSocket(`ws://localhost:${port}${path}`);
    s.msgs = []; s.q = [];
    s.on('open', () => resolve(s));
    s.on('message', (d) => {
      const m = JSON.parse(d);
      s.msgs.push(m);
      // 기다리는 모든 조건에 전달 (동시에 여러 waitFor를 걸어도 메시지를 놓치지 않음)
      s.q = s.q.filter((check) => !check(m));
    });
    s.on('error', reject);
  });
}
function waitFor(s, pred, ms = 5000) {
  const found = s.msgs.find((m) => { try { return pred(m); } catch { return false; } });
  if (found) return Promise.resolve(found);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    // 조건식이 예외를 던지면(예: 필드 없는 메시지) 해당 메시지는 불일치로 처리 → 수신 처리 루프가 끊기지 않게
    s.q.push((m) => { let ok = false; try { ok = pred(m); } catch { ok = false; } if (!ok) return false; clearTimeout(timer); resolve(m); return true; });
  });
}
const get = (path) => new Promise((res, rej) => http.get(`http://localhost:${port}${path}`, (r) => { let b = ''; r.on('data', (d) => b += d); r.on('end', () => res({ status: r.statusCode, body: b, headers: r.headers })); }).on('error', rej));

before(async () => { srv = await createServer({ port: 0, dataFile: tmp, cycleMs: 16000, log: false }); port = srv.port; });
after(async () => { await srv.close(); try { require('fs').unlinkSync(tmp); } catch {} });

describe('HTTP', () => {
  it('/healthz → 200', async () => {
    const r = await get('/healthz');
    assert.equal(r.status, 200);
    assert.equal(r.body, 'ok');
  });
  it('/status → JSON with online, nextRace', async () => {
    const r = await get('/status');
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    assert.equal(typeof j.online, 'number');
    assert.equal(typeof j.nextRace, 'number');
    assert.equal(r.headers['cache-control'], 'no-store');
  });
  it('/ → index.html', async () => {
    const r = await get('/');
    assert.equal(r.status, 200);
    assert.ok(r.body.includes('안경원숭이'));
  });
  it('보안 헤더 존재', async () => {
    const r = await get('/');
    assert.ok(r.headers['content-security-policy']);
    assert.ok(r.headers['x-content-type-options']);
  });
  it('404 → not found', async () => {
    const r = await get('/nope');
    assert.equal(r.status, 404);
  });
  it('경로 조작 차단 (/../)', async () => {
    const r = await get('/../package.json');
    assert.equal(r.status, 404);
  });
});

describe('WebSocket', () => {
  it('hello → welcome', async () => {
    const s = await ws();
    s.send(JSON.stringify({ t: 'hello', name: '유저A', g: 'm', seed: 100 }));
    const m = await waitFor(s, (m) => m.t === 'welcome');
    assert.equal(m.me.name, '유저A');
    assert.equal(m.me.coins, 1000);
    assert.ok(Array.isArray(m.bets));
    assert.ok(Array.isArray(m.rocks));
    assert.ok(m.race);
    s.close();
  });
  it('중복 닉네임 거부', async () => {
    const s1 = await ws(), s2 = await ws();
    s1.send(JSON.stringify({ t: 'hello', name: '닉겹침', g: 'f', seed: 1 }));
    await waitFor(s1, (m) => m.t === 'welcome');
    s2.send(JSON.stringify({ t: 'hello', name: '닉겹침', g: 'm', seed: 2 }));
    const err = await waitFor(s2, (m) => m.t === 'err');
    assert.ok(err.text.includes('닉네임'));
    s1.close(); s2.close();
  });
  it('chat → broadcast', async () => {
    const s1 = await ws(), s2 = await ws();
    s1.send(JSON.stringify({ t: 'hello', name: '채팅A', g: 'm', seed: 200 }));
    await waitFor(s1, (m) => m.t === 'welcome');
    s2.send(JSON.stringify({ t: 'hello', name: '채팅B', g: 'f', seed: 201 }));
    await waitFor(s2, (m) => m.t === 'welcome');
    s1.send(JSON.stringify({ t: 'chat', text: '안녕하세요!' }));
    const m = await waitFor(s2, (m) => m.t === 'chat');
    assert.equal(m.name, '채팅A');
    assert.equal(m.text, '안녕하세요!');
    s1.close(); s2.close();
  });
  it('chat 욕설 필터', async () => {
    const s = await ws();
    s.send(JSON.stringify({ t: 'hello', name: '필터유저', g: 'm', seed: 300 }));
    await waitFor(s, (m) => m.t === 'welcome');
    s.send(JSON.stringify({ t: 'chat', text: '시발놈아' }));
    const m = await waitFor(s, (m) => m.t === 'chat');
    assert.ok(!m.text.includes('시발'), '필터 적용됨');
    assert.ok(m.text.includes('**'), '마스킹됨');
    s.close();
  });
  it('chat 스팸 차단', async () => {
    const s = await ws();
    s.send(JSON.stringify({ t: 'hello', name: '스팸러', g: 'm', seed: 400 }));
    await waitFor(s, (m) => m.t === 'welcome');
    for (let i = 0; i < 6; i++) s.send(JSON.stringify({ t: 'chat', text: `msg${i}` }));
    await new Promise((r) => setTimeout(r, 300));
    const errs = s.msgs.filter((m) => m.t === 'err' && m.code === 'slow');
    assert.ok(errs.length > 0, '스팸 차단 에러 발생');
    s.close();
  });
  it('emote broadcast', async () => {
    const s1 = await ws(), s2 = await ws();
    s1.send(JSON.stringify({ t: 'hello', name: '이모트A', g: 'm', seed: 500 }));
    await waitFor(s1, (m) => m.t === 'welcome');
    s2.send(JSON.stringify({ t: 'hello', name: '이모트B', g: 'f', seed: 501 }));
    await waitFor(s2, (m) => m.t === 'welcome');
    s1.send(JSON.stringify({ t: 'emote', e: 'cheer' }));
    const m = await waitFor(s2, (m) => m.t === 'emote');
    assert.equal(m.e, 'cheer');
    s1.close(); s2.close();
  });
  it('이동 → snap', async () => {
    const s1 = await ws(), s2 = await ws();
    s1.send(JSON.stringify({ t: 'hello', name: '무버', g: 'm', seed: 600 }));
    const w1 = await waitFor(s1, (m) => m.t === 'welcome');
    s2.send(JSON.stringify({ t: 'hello', name: '관찰자', g: 'f', seed: 601 }));
    await waitFor(s2, (m) => m.t === 'welcome');
    // 스폰 위치에서 1px만 이동 (예산 초과 방지)
    s1.send(JSON.stringify({ t: 'move', x: Math.round((w1.x + 1) * 10) / 10, y: w1.y, d: 2, r: 0 }));
    await new Promise((r) => setTimeout(r, 200));
    s1.send(JSON.stringify({ t: 'move', x: Math.round((w1.x + 2) * 10) / 10, y: w1.y, d: 2, r: 0 }));
    const snap = await waitFor(s2, (m) => m.t === 'snap', 2000);
    assert.ok(snap.p.length > 0);
    s1.close(); s2.close();
  });
  it('ping → pong', async () => {
    const s = await ws();
    s.send(JSON.stringify({ t: 'hello', name: '핑유저', g: 'm', seed: 700 }));
    await waitFor(s, (m) => m.t === 'welcome');
    const c = Date.now();
    s.send(JSON.stringify({ t: 'ping', c }));
    const m = await waitFor(s, (m) => m.t === 'pong');
    assert.equal(m.c, c);
    assert.ok(typeof m.now === 'number');
    s.close();
  });
  it('잘못된 닉네임 거부', async () => {
    const s = await ws();
    s.send(JSON.stringify({ t: 'hello', name: 'a', g: 'm', seed: 1 })); // 1글자 → 거부
    const err = await waitFor(s, (m) => m.t === 'err');
    assert.ok(err.text.includes('닉네임'));
    s.close();
  });
  it('XSS 닉네임 거부', async () => {
    const s = await ws();
    s.send(JSON.stringify({ t: 'hello', name: '<script>', g: 'm', seed: 1 }));
    const err = await waitFor(s, (m) => m.t === 'err');
    assert.ok(err.text.includes('닉네임'));
    s.close();
  });
  it('토큰 재접속 → 코인 유지', async () => {
    const s1 = await ws();
    s1.send(JSON.stringify({ t: 'hello', name: '토큰유저', g: 'm', seed: 800 }));
    const w1 = await waitFor(s1, (m) => m.t === 'welcome');
    const token = w1.token;
    assert.ok(token);
    s1.close();
    await new Promise((r) => setTimeout(r, 200));
    const s2 = await ws();
    s2.send(JSON.stringify({ t: 'hello', name: '토큰유저', g: 'm', seed: 800, token }));
    const w2 = await waitFor(s2, (m) => m.t === 'welcome');
    assert.equal(w2.me.coins, 1000);
    assert.equal(w2.token, undefined); // 기존 토큰이라 새 토큰 안 줌
    s2.close();
  });
});

describe('파산 감옥', () => {
  const step = async (s, from, to) => {
    // 서버 이동 예산 안에서 조금씩 걸어감
    let [x, y] = from;
    while (Math.hypot(to[0] - x, to[1] - y) > 0.5) {
      const d = Math.hypot(to[0] - x, to[1] - y), k = Math.min(1, 2 / d); // 50px/s (걷기 속도 72px/s 이내)
      x += (to[0] - x) * k; y += (to[1] - y) * k;
      s.send(JSON.stringify({ t: 'move', x, y, d: 0, r: 0 }));
      await new Promise((r) => setTimeout(r, 40));
    }
    return [x, y];
  };
  it('파산 → 감옥 수감, 베팅·상점 막힘, 벼 베기 → 쌀 판매로 석방 + 지원금', async () => {
    const W = require('../shared/world.js'), CFG = W.CFG;
    const realRandom = Math.random; Math.random = () => 0.99; // 행운 탈출 없이 판매 경로만 검증
    try {
      const s = await ws();
      s.send(JSON.stringify({ t: 'hello', name: '벼베기', g: 'f', seed: 4242 }));
      await waitFor(s, (m) => m.t === 'welcome');
      const jailed = waitFor(s, (m) => m.t === 'me' && m.me.jail > 0);
      srv.bankrupt('벼베기');
      const j = await jailed;
      assert.ok(W.inRect(W.ZONES.jailIn, j.x, j.y));
      assert.equal(j.me.rice, 0);
      // 갇힌 동안 베팅·구매 거절
      s.send(JSON.stringify({ t: 'buy', item: W.ITEMS[0].id }));
      assert.equal((await waitFor(s, (m) => m.t === 'err')).code, 'jail');
      s.msgs.length = 0;
      // 너무 일찍 팔면 거절
      let pos = [j.x, j.y];
      const f = W.NPCS.find((n) => n.id === 'farmer');
      pos = await step(s, pos, [f.x + 8, f.y - 8]);
      s.send(JSON.stringify({ t: 'sell' }));
      assert.equal((await waitFor(s, (m) => m.t === 'err')).code, 'rice');
      s.msgs.length = 0;
      // 멀리 있는 벼는 못 벰
      s.send(JSON.stringify({ t: 'rice', id: W.RICE.length - 1 }));
      // 가까운 벼부터 RICE_NEED개 베기
      let got = 0;
      for (const r of W.RICE) {
        if (got >= CFG.RICE_NEED) break;
        pos = await step(s, pos, [r.x, r.y + 6]);
        await new Promise((res) => setTimeout(res, CFG.RICE_COOLDOWN_MS));
        const me = waitFor(s, (m) => m.t === 'me' && m.me.rice === got + 1);
        s.send(JSON.stringify({ t: 'rice', id: r.id }));
        await me; got++;
        // 같은 벼를 바로 또 베면 무시 (다시 익는 중)
        s.send(JSON.stringify({ t: 'rice', id: r.id }));
      }
      const prof = Object.values(srv.db.profiles).find((p) => p.name === '벼베기');
      assert.equal(prof.rice, CFG.RICE_NEED);
      pos = await step(s, pos, [f.x + 8, f.y - 8]);
      const freed = waitFor(s, (m) => m.t === 'freed');
      const after = waitFor(s, (m) => m.t === 'me' && !m.me.jail);
      s.send(JSON.stringify({ t: 'sell' }));
      assert.equal((await freed).why, 'sold');
      const a = await after;
      assert.equal(a.me.coins, CFG.BAILOUT);
      assert.ok(!W.inRect(W.ZONES.jail, a.x, a.y) && !W.blocked(a.x, a.y));
      s.close();
    } finally { Math.random = realRandom; }
  });
  it('벼를 베다 낮은 확률로 즉시 탈출', async () => {
    const W = require('../shared/world.js');
    const s = await ws();
    s.send(JSON.stringify({ t: 'hello', name: '행운아', g: 'm', seed: 99 }));
    await waitFor(s, (m) => m.t === 'welcome');
    const jailed = waitFor(s, (m) => m.t === 'me' && m.me.jail > 0);
    srv.bankrupt('행운아');
    const j = await jailed;
    // 앞 테스트가 베지 않은(익어 있는) 마지막 벼
    const r = W.RICE[W.RICE.length - 1];
    await step(s, [j.x, j.y], [r.x, r.y + 6]);
    const realRandom = Math.random; Math.random = () => 0.0;
    try {
      const freed = waitFor(s, (m) => m.t === 'freed');
      s.send(JSON.stringify({ t: 'rice', id: r.id }));
      assert.equal((await freed).why, 'lucky');
    } finally { Math.random = realRandom; }
    s.close();
  });
  it('시간이 지나면 자동 석방', async () => {
    const s2srv = await createServer({ port: 0, dataFile: tmp + '.j', cycleMs: 16000, jailMs: 300, log: false });
    try {
      const s = new WebSocket(`ws://127.0.0.1:${s2srv.port}/ws`);
      await new Promise((r) => s.once('open', r));
      const msgs = []; s.on('message', (d) => msgs.push(JSON.parse(d)));
      s.send(JSON.stringify({ t: 'hello', name: '기다림', g: 'm', seed: 5 }));
      await new Promise((r) => setTimeout(r, 200));
      s2srv.bankrupt('기다림');
      await new Promise((r) => setTimeout(r, 800));
      const f = msgs.find((m) => m.t === 'freed');
      assert.ok(f && f.why === 'time');
      s.close();
    } finally { await s2srv.close(); try { require('fs').unlinkSync(tmp + '.j'); } catch {} }
  });
});
