// 안경원숭이 더비: 권위 서버 (HTTP 정적 + WebSocket). 돈·베팅·경주·감옥 판정은 모두 서버가 한다.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const W = require('../shared/world.js');
const RACE = require('../shared/race.js');
const { CFG, ITEM, SLOTS, EMOTES, STABLE, ROCKS } = W;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8' };
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()', 'Cross-Origin-Opener-Policy': 'same-origin'
};
const BANNED = ['시발', '씨발', '병신', '좆', '개새', '니애미', '느금'];

// 부팅 시 정적 파일을 메모리에 올림 → 요청 경로로 디스크에 접근하지 않음(경로 조작 원천 차단)
function loadStatic(root) {
  const files = new Map();
  const add = (url, file) => { const body = fs.readFileSync(file); files.set(url, { body, type: MIME[path.extname(file)] || 'application/octet-stream', etag: '"' + crypto.createHash('sha1').update(body).digest('base64').slice(0, 16) + '"' }); };
  const walk = (dir, base) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f, base + e.name + '/'); else if (MIME[path.extname(e.name)]) add(base + e.name, f); } };
  walk(path.join(root, 'public'), '/');
  walk(path.join(root, 'shared'), '/shared/');
  files.set('/', files.get('/index.html'));
  return files;
}

function createServer(opts = {}) {
  const o = {
    port: opts.port ?? (+process.env.PORT || 8080), host: opts.host ?? process.env.HOST ?? '0.0.0.0',
    dataFile: opts.dataFile ?? process.env.DATA_FILE ?? path.join(__dirname, '..', 'data', 'players.json'),
    cycleMs: opts.cycleMs ?? (+process.env.CYCLE_MS || CFG.CYCLE_MS),
    jailMs: opts.jailMs ?? (+process.env.JAIL_MS || CFG.BANKRUPT_JAIL_MS),
    maxPerIp: opts.maxPerIp ?? (+process.env.MAX_PER_IP || 8), maxConn: opts.maxConn ?? (+process.env.MAX_CONN || 300),
    trustProxy: opts.trustProxy ?? process.env.TRUST_PROXY === '1',
    origins: (opts.origins ?? process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    oddsSims: opts.oddsSims ?? 1200, log: opts.log ?? true
  };
  const log = (...a) => o.log && console.log(new Date().toISOString(), ...a);
  const PH = W.phases(o.cycleMs);
  const files = loadStatic(path.join(__dirname, '..'));

  // ---------- 영속 데이터 ----------
  let db = { profiles: {} }, dirty = false;
  try {
    const raw = JSON.parse(fs.readFileSync(o.dataFile, 'utf8'));
    if (raw && typeof raw.profiles === 'object') for (const [k, p] of Object.entries(raw.profiles)) if (/^[0-9a-f]{64}$/.test(k) && p && typeof p.name === 'string' && Number.isSafeInteger(p.coins)) db.profiles[k] = p;
  } catch (e) { if (e.code !== 'ENOENT') log('데이터 파일 손상, 새로 시작:', e.message); }
  const markDirty = () => { dirty = true; };
  function persist() {
    if (!dirty) return;
    dirty = false;
    fs.mkdirSync(path.dirname(o.dataFile), { recursive: true });
    const tmp = o.dataFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, o.dataFile);
  }
  const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

  // ---------- 세션 ----------
  const sessions = new Map(); // id → session
  const byToken = new Map();  // tokenHash → session
  const ipCount = new Map();
  let nextId = 1;
  const send = (s, m) => { if (s.ws.readyState === 1) s.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); };
  const broadcast = (m, except) => { const j = JSON.stringify(m); for (const s of sessions.values()) if (s.p && s !== except) send(s, j); };
  const pub = (s) => ({ id: s.id, name: s.p.name, g: s.p.gender, seed: s.p.seed, eq: s.p.eq, x: s.x, y: s.y, d: s.dir, jail: s.p.jail > Date.now() ? s.p.jail : 0 });
  const me = (p) => ({ name: p.name, gender: p.gender, seed: p.seed, coins: p.coins, owned: p.owned, eq: p.eq, stats: p.stats, jail: p.jail > Date.now() ? p.jail : 0 });

  // ---------- 경주 ----------
  const cycleOf = (t) => ({ id: Math.floor(t / o.cycleMs), at: t % o.cycleMs, start: t - (t % o.cycleMs) });
  let race = null, nextOdds = null;
  function makeRace(id, startAt) {
    const seed = crypto.randomInt(2 ** 31);
    const card = RACE.drawCard(seed);
    return { id, startAt, card, odds: null, oddsSeed: crypto.randomInt(2 ** 31), bets: [], pool: new Array(card.length).fill(0), phase: 'betting', result: null, settled: false, poolDirty: false };
  }
  function computeOdds(r) { r.odds = RACE.odds(r.card, r.oddsSeed, o.oddsSims); }
  function raceView(r, full) {
    const v = {
      id: r.id, phase: r.phase, startAt: r.startAt, betEnd: r.startAt + PH.betEnd, closeEnd: r.startAt + PH.closeEnd, raceEnd: r.startAt + PH.raceEnd, next: r.startAt + o.cycleMs,
      runners: r.card.map((c) => { const s = STABLE[c.stable]; return { num: c.num, stable: c.stable, name: s.name, color: s.color, style: s.style, spd: s.spd, sta: s.sta, gut: s.gut, luck: s.luck, cond: c.cond }; }),
      odds: r.odds ? { win: r.odds.win, place: r.odds.place, exacta: r.odds.exacta } : null, pool: r.pool
    };
    if (full && r.result && r.phase !== 'betting') Object.assign(v, replayView(r));
    return v;
  }
  function replayView(r) {
    const s = r.result;
    return { frames: s.frames, hz: s.hz, events: s.events, order: s.order, times: s.times, goAt: r.startAt + PH.closeEnd, scale: s.scale };
  }

  function tickRace(now) {
    const c = cycleOf(now);
    if (!race || race.id !== c.id) {
      if (race && !race.settled && race.result) settle(race);
      race = nextOdds && nextOdds.id === c.id ? nextOdds : makeRace(c.id, c.start);
      nextOdds = null;
      if (!race.odds) computeOdds(race);
      // 재시작 등으로 이미 마감 시각이 지났다면 이번 판은 베팅 없이 건너뜀
      race.phase = c.at < PH.betEnd ? 'betting' : 'void';
      broadcast({ t: 'race', race: raceView(race, false) });
      log('경주', race.id, race.phase);
      return;
    }
    if (race.phase === 'void') return;
    if (race.phase === 'betting' && c.at >= PH.betEnd) {
      race.phase = 'closed';
      // 마감 후에 결과 시드를 뽑는다 → 베팅 중에는 서버조차 결과를 모름
      const res = RACE.simulate(race.card, crypto.randomInt(2 ** 31), true);
      const window = PH.raceEnd - PH.closeEnd - 2500;
      res.scale = Math.max(1, (res.ticks / res.hz) * 1000 / window); // 짧은 테스트 주기에서는 재생 가속
      const pb = RACE.playback(res, res.scale);
      // 정산은 화면에서 결승선을 통과한 직후(재생 길이 + 1.5초), 단 경주 구간 끝을 넘지 않음
      race.settleAt = Math.min(race.startAt + PH.raceEnd, race.startAt + PH.closeEnd + pb.wall * 1000 + 1500);
      race.result = res;
      broadcast({ t: 'phase', phase: 'closed', id: race.id, ...replayView(race) });
    } else if (race.phase === 'closed' && c.at >= PH.closeEnd) {
      race.phase = 'race';
      broadcast({ t: 'phase', phase: 'race', id: race.id });
    } else if (race.phase === 'race' && now >= race.settleAt) {
      race.phase = 'result';
      settle(race);
      broadcast({ t: 'phase', phase: 'result', id: race.id });
      nextOdds = makeRace(race.id + 1, race.startAt + o.cycleMs);
      setImmediate(() => { if (nextOdds && !nextOdds.odds) computeOdds(nextOdds); });
    }
    if (race.poolDirty && race.phase === 'betting' && now - (race.poolAt || 0) > 1000) { race.poolDirty = false; race.poolAt = now; broadcast({ t: 'pool', id: race.id, pool: race.pool }); }
  }

  function settle(r) {
    if (r.settled || !r.result) return;
    r.settled = true;
    const [a, b] = r.result.order, per = new Map();
    for (const bet of r.bets) {
      const p = db.profiles[bet.h];
      if (!p) continue;
      const hit = bet.type === 'win' ? bet.key === a : bet.type === 'place' ? bet.key === a || bet.key === b : bet.key === a + '-' + b;
      const pay = hit ? Math.floor(bet.amount * bet.odds) : 0;
      p.coins += pay;
      p.stats.wagered += bet.amount; p.stats.returned += pay;
      if (hit) { p.stats.hits++; p.stats.best = Math.max(p.stats.best, pay); }
      const e = per.get(bet.h) || { bets: [], pay: 0, stake: 0 };
      e.bets.push({ type: bet.type, key: bet.key, amount: bet.amount, odds: bet.odds, pay }); e.pay += pay; e.stake += bet.amount;
      per.set(bet.h, e);
    }
    let bigWin = null;
    for (const s of sessions.values()) {
      if (!s.p) continue;
      const e = per.get(s.h);
      if (!e && s.p.jail < Date.now()) { s.p.coins += CFG.WATCH_BONUS; } // 관람 보너스 (온라인 중인 사람만)
      if (e && e.pay - e.stake > 0 && (!bigWin || e.pay - e.stake > bigWin.net)) bigWin = { name: s.p.name, net: e.pay - e.stake };
      send(s, { t: 'settle', id: r.id, order: r.result.order, mine: e || null, me: me(s.p) });
    }
    if (bigWin && bigWin.net >= 1000) broadcast({ t: 'toast', kind: 'big', text: `${bigWin.name} 님이 ${bigWin.net.toLocaleString()} 코인을 땄어요!` });
    for (const h of per.keys()) checkBankrupt(db.profiles[h]);
    markDirty();
    log('정산', r.id, '1위', STABLE[r.card[a].stable].name, '베팅', r.bets.length);
  }

  function hasOpenBets(h) { return race && !race.settled && race.bets.some((b) => b.h === h); }
  function checkBankrupt(p) {
    if (!p || p.jail > Date.now() || p.coins >= CFG.MIN_BET || hasOpenBets(p.h)) return;
    p.jail = Date.now() + o.jailMs; p.stats.bankrupt++;
    markDirty();
    const s = byToken.get(p.h);
    if (s) { [s.x, s.y] = W.clampCage(W.ZONES.cageIn.x + 44, W.ZONES.cageIn.y + 40); s.moved = true; send(s, { t: 'me', me: me(p), x: s.x, y: s.y }); broadcast({ t: 'jail', id: s.id, until: p.jail, x: s.x, y: s.y }); }
  }
  function tickJail(now) {
    for (const s of sessions.values()) {
      const p = s.p;
      if (!p || !p.jail || p.jail > now) continue;
      p.jail = 0; p.coins += CFG.BAILOUT; markDirty();
      s.x = W.ZONES.cage.x - 12; s.y = W.ZONES.cage.y + 70; s.moved = true;
      send(s, { t: 'me', me: me(p), x: s.x, y: s.y });
      broadcast({ t: 'jail', id: s.id, until: 0, x: s.x, y: s.y });
    }
  }

  // ---------- 광석 ----------
  const rocks = ROCKS.map((r) => ({ id: r.id, hp: CFG.ROCK_HP, at: 0 }));
  function tickRocks(now) {
    for (const r of rocks) if (r.hp <= 0 && now >= r.at) { r.hp = CFG.ROCK_HP; broadcast({ t: 'rock', id: r.id, hp: r.hp }); }
  }

  // ---------- 메시지 처리 ----------
  const bucket = (rate, burst) => ({ rate, burst, v: burst, t: Date.now() });
  const take = (b, n = 1) => { const t = Date.now(); b.v = Math.min(b.burst, b.v + ((t - b.t) / 1000) * b.rate); b.t = t; if (b.v < n) return false; b.v -= n; return true; };
  const isInt = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  function cleanText(s, max) {
    if (typeof s !== 'string') return '';
    s = s.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '').replace(/\s+/g, ' ').trim();
    return [...s].slice(0, max).join('');
  }
  const filterBad = (s) => BANNED.reduce((t, w) => t.split(w).join('*'.repeat([...w].length)), s);

  function onHello(s, m) {
    const name = cleanText(m.name, CFG.NAME_MAX);
    if ([...name].length < CFG.NAME_MIN || !W.NAME_RE.test(name) || BANNED.some((w) => name.includes(w))) return send(s, { t: 'err', code: 'name', text: '닉네임은 2~10자 한글·영문·숫자·_- 만 가능해요.' });
    if (m.g !== 'm' && m.g !== 'f') return send(s, { t: 'err', code: 'bad', text: '성별을 선택해 주세요.' });
    if (!isInt(m.seed, 0, 0xffffffff)) return send(s, { t: 'err', code: 'bad', text: '아바타 정보가 올바르지 않아요.' });
    let token = typeof m.token === 'string' && /^[0-9a-f]{64}$/.test(m.token) ? m.token : null;
    let fresh = false;
    if (!token) { token = crypto.randomBytes(32).toString('hex'); fresh = true; }
    const h = hashToken(token), lower = name.toLowerCase(), week = Date.now() - 7 * 864e5;
    for (const [k, p] of Object.entries(db.profiles)) if (k !== h && p.name.toLowerCase() === lower && (p.seen > week || byToken.has(k))) return send(s, { t: 'err', code: 'taken', text: '이미 사용 중인 닉네임이에요.' });
    let p = db.profiles[h];
    if (!p) {
      if (!fresh && !m.token) return;
      p = db.profiles[h] = { h, name, gender: m.g, seed: m.seed, coins: CFG.START_COINS, owned: [], eq: { hat: null, trail: null, ride: null, pet: null }, stats: { wagered: 0, returned: 0, hits: 0, best: 0, bankrupt: 0, mined: 0 }, jail: 0, seen: Date.now(), created: Date.now() };
      evictOld();
    } else { p.name = name; p.gender = m.g; p.seed = m.seed; }
    p.seen = Date.now(); p.h = h;
    const old = byToken.get(h);
    if (old && old !== s) { send(old, { t: 'kicked', text: '다른 창에서 같은 계정으로 접속해서 연결이 끊겼어요.' }); old.ws.close(4001, 'dup'); dropSession(old); }
    s.p = p; s.h = h; byToken.set(h, s);
    if (p.jail > Date.now()) [s.x, s.y] = W.clampCage(W.ZONES.cageIn.x + 44, W.ZONES.cageIn.y + 40);
    else { const z = W.ZONES.spawn; s.x = z.x + 8 + Math.random() * (z.w - 16); s.y = z.y + 8 + Math.random() * (z.h - 16); }
    s.lastMove = Date.now(); s.budget = 0;
    markDirty();
    send(s, {
      t: 'welcome', id: s.id, token: fresh ? token : undefined, me: me(p), x: s.x, y: s.y, now: Date.now(),
      players: [...sessions.values()].filter((q) => q.p && q !== s).map(pub),
      race: race ? raceView(race, true) : null, bets: myBets(h), rocks: rocks.map((r) => [r.id, r.hp]), cycleMs: o.cycleMs, phases: PH, board: board()
    });
    broadcast({ t: 'join', p: pub(s) }, s);
    log('접속', name, sessions.size);
  }
  function evictOld() {
    const keys = Object.keys(db.profiles);
    if (keys.length <= 5000) return;
    keys.sort((a, b) => db.profiles[a].seen - db.profiles[b].seen);
    for (const k of keys.slice(0, keys.length - 5000)) if (!byToken.has(k)) delete db.profiles[k];
  }

  function onMove(s, m) {
    if (!num(m.x) || !num(m.y) || !isInt(m.d, 0, 7)) return;
    const now = Date.now(), dt = Math.min(0.5, (now - s.lastMove) / 1000);
    s.lastMove = now;
    const ride = s.p.eq.ride && ITEM[s.p.eq.ride] ? ITEM[s.p.eq.ride].speed : 1;
    const vmax = CFG.WALK * Math.min(CFG.MAX_SPEED_MULT, ride * (m.r ? CFG.RUN_MULT : 1));
    // 지터 허용 예산: 이동 가능 거리 + 0.25초분 여유를 누적·소진
    s.budget = Math.min(vmax * 0.6, s.budget + vmax * dt + 2);
    let x = Math.round(m.x * 10) / 10, y = Math.round(m.y * 10) / 10;
    const dist = Math.hypot(x - s.x, y - s.y);
    const jailed = s.p.jail > now;
    let ok = dist <= s.budget;
    if (ok && jailed) [x, y] = W.clampCage(x, y);
    else if (ok) { const mx = (x + s.x) / 2, my = (y + s.y) / 2; ok = !W.blocked(x, y) && !W.blocked(mx, my); }
    if (!ok) { s.bad = (s.bad || 0) + 1; return send(s, { t: 'fix', x: s.x, y: s.y }); }
    s.budget -= dist;
    if (x !== s.x || y !== s.y || s.dir !== m.d || s.run !== !!m.r) s.moved = true;
    s.x = x; s.y = y; s.dir = m.d; s.run = !!m.r; s.mv = dist > 0.05;
  }

  function onMine(s, m) {
    if (!isInt(m.rock, 0, rocks.length - 1) || s.p.jail > Date.now()) return;
    const now = Date.now(), r = rocks[m.rock], k = ROCKS[m.rock];
    if (now - (s.mineAt || 0) < CFG.MINE_COOLDOWN_MS || r.hp <= 0) return;
    if (Math.hypot(k.x - s.x, k.y - s.y) > 30) return;
    s.mineAt = now; r.hp--;
    if (r.hp > 0) return broadcast({ t: 'rock', id: r.id, hp: r.hp, by: s.id });
    const gem = Math.random() < CFG.GEM_CHANCE;
    const coins = gem ? CFG.GEM_REWARD : crypto.randomInt(CFG.ROCK_REWARD[0], CFG.ROCK_REWARD[1] + 1);
    r.at = now + CFG.ROCK_RESPAWN_MS;
    s.p.coins += coins; s.p.stats.mined += coins; markDirty();
    broadcast({ t: 'rock', id: r.id, hp: 0, by: s.id, coins, gem });
    send(s, { t: 'me', me: me(s.p) });
  }

  function onBet(s, m) {
    const now = Date.now();
    if (!race || race.phase !== 'betting' || !race.odds || m.race !== race.id) return send(s, { t: 'err', code: 'closed', text: '지금은 베팅할 수 없어요.' });
    if (s.p.jail > now) return send(s, { t: 'err', code: 'jail', text: '감옥에서는 베팅할 수 없어요.' });
    const n = race.card.length;
    let key, odds;
    if (m.type === 'win' || m.type === 'place') { if (!isInt(m.key, 0, n - 1)) return; key = m.key; odds = race.odds[m.type][key]; }
    else if (m.type === 'exacta') { if (!Array.isArray(m.key) || m.key.length !== 2 || !isInt(m.key[0], 0, n - 1) || !isInt(m.key[1], 0, n - 1) || m.key[0] === m.key[1]) return; key = m.key[0] + '-' + m.key[1]; odds = race.odds.exacta[key]; }
    else return;
    if (!isInt(m.amount, CFG.MIN_BET, 1e12)) return send(s, { t: 'err', code: 'amount', text: `최소 ${CFG.MIN_BET} 코인부터 베팅할 수 있어요.` });
    if (m.amount > s.p.coins) return send(s, { t: 'err', code: 'funds', text: '코인이 부족해요.' });
    if (race.bets.filter((b) => b.h === s.h).length >= CFG.MAX_BETS_PER_RACE) return send(s, { t: 'err', code: 'limit', text: `한 경주에는 최대 ${CFG.MAX_BETS_PER_RACE}번까지 베팅할 수 있어요.` });
    s.p.coins -= m.amount; markDirty();
    race.bets.push({ h: s.h, type: m.type, key, amount: m.amount, odds });
    if (m.type === 'exacta') { race.pool[m.key[0]] += m.amount / 2; race.pool[m.key[1]] += m.amount / 2; } else race.pool[key] += m.amount;
    race.poolDirty = true;
    send(s, { t: 'bet', ok: true, me: me(s.p), bets: myBets(s.h) });
  }
  const myBets = (h) => (race ? race.bets.filter((b) => b.h === h).map((b) => ({ type: b.type, key: b.key, amount: b.amount, odds: b.odds })) : []);
  function onCancel(s) {
    if (!race || race.phase !== 'betting') return send(s, { t: 'err', code: 'closed', text: '마감 후에는 취소할 수 없어요.' });
    let refund = 0;
    race.bets = race.bets.filter((b) => { if (b.h !== s.h) return true; refund += b.amount; if (typeof b.key === 'number') race.pool[b.key] -= b.amount; else { const [i, j] = b.key.split('-'); race.pool[+i] -= b.amount / 2; race.pool[+j] -= b.amount / 2; } return false; });
    s.p.coins += refund; race.poolDirty = true; markDirty();
    send(s, { t: 'bet', ok: true, me: me(s.p), bets: [] });
  }
  function onBuy(s, m) {
    if (typeof m.item !== 'string' || !Object.hasOwn(ITEM, m.item)) return;
    const it = ITEM[m.item], p = s.p;
    if (p.jail > Date.now()) return send(s, { t: 'err', code: 'jail', text: '감옥에서는 살 수 없어요.' });
    if (p.owned.includes(it.id)) return;
    if (p.coins < it.price) return send(s, { t: 'err', code: 'funds', text: '코인이 부족해요.' });
    p.coins -= it.price; p.owned.push(it.id); p.eq[it.slot] = it.id; markDirty();
    send(s, { t: 'me', me: me(p) });
    broadcast({ t: 'eq', id: s.id, eq: p.eq });
    checkBankrupt(p);
  }
  function onEquip(s, m) {
    if (!SLOTS.includes(m.slot)) return;
    if (m.item !== null && (typeof m.item !== 'string' || !s.p.owned.includes(m.item) || ITEM[m.item].slot !== m.slot)) return;
    s.p.eq[m.slot] = m.item; markDirty();
    send(s, { t: 'me', me: me(s.p) });
    broadcast({ t: 'eq', id: s.id, eq: s.p.eq });
  }
  function onChat(s, m) {
    if (!take(s.chatB)) return send(s, { t: 'err', code: 'slow', text: '조금 천천히 말해 주세요.' });
    const text = filterBad(cleanText(m.text, CFG.CHAT_MAX));
    if (!text) return;
    const now = Date.now();
    if (text === s.lastChat && now - s.lastChatAt < 5000) return;
    s.lastChat = text; s.lastChatAt = now;
    broadcast({ t: 'chat', id: s.id, name: s.p.name, text });
  }
  function onEmote(s, m) {
    if (!EMOTES.includes(m.e) || !take(s.emoB)) return;
    broadcast({ t: 'emote', id: s.id, e: m.e });
  }

  const HANDLERS = { move: onMove, mine: onMine, bet: onBet, cancel: onCancel, buy: onBuy, equip: onEquip, chat: onChat, emote: onEmote };
  function onMessage(s, raw) {
    if (!take(s.msgB)) { if (++s.flood > 20) s.ws.close(4008, 'flood'); return; }
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') return;
    if (m.t === 'ping') return send(s, { t: 'pong', c: num(m.c) ? m.c : 0, now: Date.now() });
    if (m.t === 'hello') { if (!s.p) onHello(s, m); return; }
    if (!s.p || !Object.hasOwn(HANDLERS, m.t)) return;
    HANDLERS[m.t](s, m);
  }

  function board() {
    const week = Date.now() - 7 * 864e5;
    return Object.values(db.profiles).filter((p) => p.seen > week).sort((a, b) => b.coins - a.coins).slice(0, 10).map((p) => ({ name: p.name, coins: p.coins, best: p.stats.best }));
  }

  // ---------- 틱 ----------
  let tickN = 0;
  function tick() {
    const now = Date.now();
    tickRace(now); tickJail(now); tickRocks(now);
    const moved = [];
    for (const s of sessions.values()) if (s.p && s.moved) { s.moved = false; moved.push([s.id, s.x, s.y, s.dir, s.mv ? 1 : 0, s.run ? 1 : 0]); }
    if (moved.length) broadcast({ t: 'snap', p: moved, now });
    if (++tickN % 600 === 0) broadcast({ t: 'board', board: board() });
    if (tickN % 200 === 0) persist();
  }

  // ---------- HTTP ----------
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD', ...SECURITY_HEADERS }); return res.end(); }
    const url = (req.url || '/').split('?')[0];
    if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS }); return res.end('ok'); }
    if (url === '/status') {
      const body = JSON.stringify({ online: sessions.size, nextRace: race ? race.startAt + o.cycleMs : Date.now() + o.cycleMs });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY_HEADERS }); return res.end(body);
    }
    const f = files.get(url);
    if (!f) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS }); return res.end('not found'); }
    if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, { ETag: f.etag, ...SECURITY_HEADERS }); return res.end(); }
    res.writeHead(200, { 'Content-Type': f.type, 'Content-Length': f.body.length, ETag: f.etag, 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
    res.end(req.method === 'HEAD' ? undefined : f.body);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
  const clientIp = (req) => (o.trustProxy && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress) || '?';
  server.on('upgrade', (req, socket, head) => {
    const reject = (code) => { socket.write(`HTTP/1.1 ${code} Rejected\r\nConnection: close\r\n\r\n`); socket.destroy(); };
    if ((req.url || '').split('?')[0] !== '/ws') return reject(404);
    // CSWSH 방지: 브라우저 Origin이 접속한 호스트(또는 허용 목록)와 같아야 함
    const origin = req.headers.origin;
    if (origin) {
      let host;
      try { host = new URL(origin).host; } catch (e) { return reject(403); }
      if (host !== req.headers.host && !o.origins.includes(origin)) return reject(403);
    }
    const ip = clientIp(req);
    if (sessions.size >= o.maxConn || (ipCount.get(ip) || 0) >= o.maxPerIp) return reject(429);
    wss.handleUpgrade(req, socket, head, (ws) => {
      ipCount.set(ip, (ipCount.get(ip) || 0) + 1);
      const s = { id: nextId++, ws, ip, p: null, h: null, x: 0, y: 0, dir: 0, run: false, mv: false, moved: false, alive: true, flood: 0, msgB: bucket(40, 80), chatB: bucket(1.2, 3), emoB: bucket(1.5, 3) };
      sessions.set(s.id, s);
      const helloTimer = setTimeout(() => { if (!s.p) ws.close(4000, 'no hello'); }, 10000);
      ws.on('message', (data, isBinary) => { if (!isBinary) onMessage(s, data.toString()); });
      ws.on('pong', () => { s.alive = true; });
      ws.on('close', () => { clearTimeout(helloTimer); dropSession(s); });
      ws.on('error', () => {});
    });
  });
  function dropSession(s) {
    if (!sessions.has(s.id)) return;
    sessions.delete(s.id);
    const n = (ipCount.get(s.ip) || 1) - 1; if (n > 0) ipCount.set(s.ip, n); else ipCount.delete(s.ip);
    if (s.h && byToken.get(s.h) === s) byToken.delete(s.h);
    if (s.p) { s.p.seen = Date.now(); markDirty(); broadcast({ t: 'leave', id: s.id }); }
  }
  const heartbeat = setInterval(() => { for (const s of sessions.values()) { if (!s.alive) { s.ws.terminate(); continue; } s.alive = false; try { s.ws.ping(); } catch (e) { /* 이미 닫힘 */ } } }, 15000);
  const loop = setInterval(tick, 1000 / CFG.TICK_HZ);

  tickRace(Date.now());
  return new Promise((resolve) => server.listen(o.port, o.host, () => {
    log(`서버 시작 http://localhost:${server.address().port} (주기 ${o.cycleMs / 1000}s)`);
    resolve({
      port: server.address().port, sessions, db, get race() { return race; },
      close: () => new Promise((r) => { clearInterval(loop); clearInterval(heartbeat); dirty = true; persist(); for (const s of sessions.values()) s.ws.terminate(); wss.close(); server.close(() => r()); })
    });
  }));
}

module.exports = { createServer };
if (require.main === module) {
  createServer().then((srv) => {
    const stop = () => srv.close().then(() => process.exit(0));
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
  });
}
