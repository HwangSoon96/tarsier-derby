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
      if (s.q.length) s.q.shift()(m);
    });
    s.on('error', reject);
  });
}
function waitFor(s, pred, ms = 5000) {
  const found = s.msgs.find(pred);
  if (found) return Promise.resolve(found);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    const check = (m) => { if (pred(m)) { clearTimeout(timer); resolve(m); } else s.q.push(check); };
    s.q.push(check);
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
