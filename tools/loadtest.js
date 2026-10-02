#!/usr/bin/env node
// 부하 테스트: 서버를 별도 프로세스로 띄우고 봇 N명이 실제처럼 걷고(15Hz) 채팅·베팅·이모트를 보낸다.
// 측정: 서버 이벤트 루프 지연(p99/최대), 서버 CPU, 클라이언트 1명이 받는 초당 바이트·메시지, 접속 실패 수.
// 사용: node tools/loadtest.js [봇 수=100] [초=20]
'use strict';
const { fork } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const W = require('../shared/world.js');

if (process.argv[2] === '--server') {
  const { monitorEventLoopDelay } = require('perf_hooks');
  const { createServer } = require('../server/server.js');
  const h = monitorEventLoopDelay({ resolution: 10 }); h.enable();
  try { require('fs').unlinkSync('/tmp/td-load.json'); } catch (e) { /* 처음 실행 */ }
  createServer({ port: 0, dataFile: '/tmp/td-load.json', cycleMs: 40000, maxPerIp: 100000, maxConn: 100000, log: false, oddsSims: 1200 }).then((srv) => {
    process.send({ port: srv.port });
    let cpu = process.cpuUsage(), t = Date.now();
    process.on('message', (m) => {
      if (m !== 'stat') return;
      const c = process.cpuUsage(cpu), dt = Date.now() - t;
      process.send({ p99: h.percentile(99) / 1e6, max: h.max / 1e6, mean: h.mean / 1e6, cpu: (c.user + c.system) / 1000 / dt, rss: process.memoryUsage().rss / 1e6, sessions: srv.sessions.size });
      h.reset(); cpu = process.cpuUsage(); t = Date.now();
    });
  });
  return;
}

const N = +(process.argv[2] || 100), SEC = +(process.argv[3] || 20);
const srvProc = fork(__filename, ['--server'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
srvProc.once('message', async ({ port }) => {
  const bots = [];
  let failed = 0, kicked = 0; const closes = {};
  const z = W.ZONES.spawn;
  for (let i = 0; i < N; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const bot = { ws, x: 0, y: 0, d: 0, bytes: 0, msgs: 0, ok: false, race: null };
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name: 'bot' + i, g: i % 2 ? 'm' : 'f', seed: i * 7919 })));
    ws.on('message', (data) => {
      bot.bytes += data.length; bot.msgs++;
      const m = JSON.parse(data);
      if (m.t === 'welcome') { bot.ok = true; bot.x = m.x; bot.y = m.y; bot.race = m.race; }
      else if (m.t === 'race') bot.race = m.race;
      else if (m.t === 'fix') { bot.x = m.x; bot.y = m.y; }
    });
    ws.on('error', () => failed++);
    ws.on('close', (c) => { if (c === 4008) kicked++; closes[c] = (closes[c] || 0) + 1; });
    bots.push(bot);
    if (i % 50 === 49) await new Promise((r) => setTimeout(r, 50)); // 접속 폭주 완화
  }
  for (let k = 0; k < 100 && bots.filter((b) => b.ok).length < N - failed; k++) await new Promise((r) => setTimeout(r, 100));
  // 15Hz 이동 (스폰 구역 안에서 배회), 가끔 채팅·이모트·베팅
  const tick = setInterval(() => {
    for (const b of bots) {
      if (!b.ok || b.ws.readyState !== 1) continue;
      b.d = (b.d + (Math.random() < 0.1 ? 1 : 0)) % 8;
      const a = (b.d / 8) * Math.PI * 2, v = (W.CFG.WALK / 15) * 0.9;
      const nx = b.x + Math.sin(a) * v, ny = b.y + Math.cos(a) * v;
      if (nx > z.x && nx < z.x + z.w && ny > z.y && ny < z.y + z.h && !W.blocked(nx, ny)) { b.x = nx; b.y = ny; } else b.d = (b.d + 4) % 8;
      b.ws.send(JSON.stringify({ t: 'move', x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, d: b.d, r: 0 }));
      const r = Math.random();
      if (r < 0.004) b.ws.send(JSON.stringify({ t: 'chat', text: '가즈아 ' + Math.floor(Math.random() * 100) }));
      else if (r < 0.007) b.ws.send(JSON.stringify({ t: 'emote', e: W.EMOTES[Math.floor(Math.random() * 6)] }));
      else if (r < 0.009 && b.race && b.race.phase === 'betting') b.ws.send(JSON.stringify({ t: 'bet', race: b.race.id, type: 'win', key: Math.floor(Math.random() * 6), amount: 10 }));
    }
  }, 1000 / 15);
  const t0 = Date.now(), base = bots.map((b) => b.bytes);
  const stats = [];
  const poll = setInterval(() => srvProc.send('stat'), 5000);
  srvProc.on('message', (m) => stats.push(m));
  await new Promise((r) => setTimeout(r, SEC * 1000));
  clearInterval(tick); clearInterval(poll);
  srvProc.send('stat'); await new Promise((r) => setTimeout(r, 300));
  const dt = (Date.now() - t0) / 1000, ok = bots.filter((b) => b.ok && b.ws.readyState === 1).length;
  const kbps = bots.filter((b) => b.ok).map((b, i) => ((b.bytes - base[bots.indexOf(b)]) / dt / 1024));
  const avg = kbps.reduce((a, c) => a + c, 0) / Math.max(1, kbps.length);
  const worst = stats.reduce((a, s) => ({ p99: Math.max(a.p99, s.p99), max: Math.max(a.max, s.max), cpu: Math.max(a.cpu, s.cpu), rss: Math.max(a.rss, s.rss) }), { p99: 0, max: 0, cpu: 0, rss: 0 });
  console.log(JSON.stringify({ bots: N, connected: ok, failed, kicked, perClientKBps: +avg.toFixed(1), loopP99ms: +worst.p99.toFixed(1), loopMaxMs: +worst.max.toFixed(1), cpuCore: +worst.cpu.toFixed(2), rssMB: Math.round(worst.rss), closes, welcomed: bots.filter((b) => b.ok).length }));
  for (const b of bots) b.ws.terminate();
  srvProc.kill();
  process.exit(0);
});
