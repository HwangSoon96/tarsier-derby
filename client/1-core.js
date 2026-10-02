// 화성간건호 클라이언트 (빌드 시 client/*.js 를 public/game.js 로 합침)
(function () {
  'use strict';
  const W = window.WORLD, RACE = window.RACE, A = window.ART, AU = window.AUDIO, S = AU.SFX;
  const { CFG, TRACK, ZONES, NPCS, ROCKS, RICE, ITEM, ITEMS, SLOTS, STABLE, STYLE_KO, COND, EMOTES } = W;
  const $ = (id) => document.getElementById(id);
  // DOM 헬퍼: 사용자 문자열은 항상 텍스트 노드로만 넣는다 (XSS 차단)
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
    for (const k of kids) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return e;
  }
  const fmt = (n) => Math.floor(n).toLocaleString('ko-KR');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  // ---------- 상태 ----------
  const G = {
    mode: 'title', id: 0, me: null, players: new Map(), race: null, practice: null, prevRace: null, prevUntil: 0,
    rocks: ROCKS.map((r) => ({ ...r, hp: CFG.ROCK_HP, hitAt: 0, deadAt: 0, bornAt: 0 })),
    rice: RICE.map((r) => ({ ...r, at: 0, cutAt: 0 })), // at: 다시 익는 서버 시각
    board: [], myBets: [], offset: 0, rtt: 0, connected: false, wantConn: false, token: localStorage.getItem('td-token'),
    keys: new Set(), cam: { mode: 'race', x: 0, y: 0, fade: 0, fadeDir: 0, target: null, shake: 0 }, watch: true,
    parts: [], pops: [], t: 0, interact: null, lastNet: 0, betType: 'win', pick: [], amount: +(localStorage.getItem('td-amt') || 100), holdUse: false, coinShow: 0
  };
  const now = () => Date.now() + G.offset; // 서버 시계
  // 터치 기기 여부: 안내 문구를 'E 키' 대신 화면 버튼 이름으로 바꾸는 데 씀
  const TOUCH = 'ontouchstart' in window || matchMedia('(pointer:coarse)').matches;
  const KEY_E = TOUCH ? '행동 버튼' : 'E 키';

  // ---------- 캔버스 ----------
  const view = $('view'), vx = view.getContext('2d');
  const [buf, bx] = A.mk(16, 16);
  let gp = 4, dpr = 1, VW = 0, VH = 0, labelPx = 12;
  const RACE_AREA = { x: 210, y: 190, w: 540, h: 310 };
  function resize() {
    dpr = window.devicePixelRatio || 1;
    view.width = Math.round(innerWidth * dpr); view.height = Math.round(innerHeight * dpr);
    const race = G.cam.mode === 'race';
    // 경주 화면: 정수 배율이 2 이상이면 정수, 그보다 작은 화면에서는 소수 배율로 트랙 전체를 꽉 채움(정지 카메라라 픽셀 흔들림 없음).
    // 맵(1024x768)보다 넓게 보이지 않도록 하한을 둔다 → 화면 가장자리에 빈 띠가 생기지 않음.
    const fit = Math.min(view.width / RACE_AREA.w, view.height / RACE_AREA.h), floor = Math.max(view.width / W.W, view.height / W.H);
    gp = race ? Math.max(floor, fit >= 2 ? Math.floor(fit) : Math.floor(fit * 10) / 10)
      : Math.max(2, Math.round(view.height / 200));
    VW = Math.ceil(view.width / gp) + 1; VH = Math.ceil(view.height / gp) + 1;
    buf.width = VW; buf.height = VH; bx.imageSmoothingEnabled = false; vx.imageSmoothingEnabled = false;
    labelPx = Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')) * dpr);
  }
  addEventListener('resize', resize);

  // ---------- 스프라이트 캐시 ----------
  const cache = new Map();
  const cached = (key, make) => { let c = cache.get(key); if (!c) { if (cache.size > 8000) cache.clear(); c = make(); cache.set(key, c); } return c; };
  const PROPS = {};
  for (const k of ['dome', 'rocket', 'shop', 'barsBack', 'barsFront', 'dish', 'solar', 'jumbo', 'flag', 'finish', 'rock0', 'rock2', 'ore0', 'ore1', 'ore2']) PROPS[k] = A.prop(k);
  function standsSprite(w) {
    const [c, g] = A.mk(w, 30);
    for (let r = 0; r < 4; r++) { A.R(g, 0, r * 6, w, 6, r % 2 ? '#7a8098' : '#8a90a8'); A.R(g, 0, r * 6, w, 1, '#b0b6c8'); }
    A.R(g, 0, 24, w, 6, '#4a5068'); for (let x = 0; x < w; x += 26) A.R(g, x, 0, 2, 24, '#5a6078');
    return A.outline(c);
  }
  function boothSprites() {
    const [a, g] = A.mk(80, 34);
    for (let i = 0; i < 8; i++) A.R(g, i * 10, 10, 10, 7, i % 2 ? '#f2f2f2' : '#d94a3a');
    A.R(g, 0, 17, 80, 2, '#a83228'); A.R(g, 4, 19, 2, 15, '#8a6a4a'); A.R(g, 74, 19, 2, 15, '#8a6a4a');
    A.R(g, 22, 0, 36, 10, '#1c1c24'); A.text(g, 'BET', 34, 3, '#ffd040');
    const [b, q] = A.mk(80, 18);
    A.R(q, 2, 0, 76, 14, '#9a6a3f'); A.R(q, 2, 0, 76, 2, '#c08a55'); A.R(q, 2, 12, 76, 2, '#6a4422');
    A.R(q, 10, 3, 18, 8, '#1c1c24'); A.text(q, 'WIN', 12, 5, '#40ff80'); A.R(q, 52, 3, 18, 8, '#1c1c24'); A.text(q, 'ODD', 54, 5, '#ffd040');
    return [A.outline(a), A.outline(b)];
  }
  PROPS.standL = standsSprite(130); PROPS.standR = PROPS.standL;
  [PROPS.awning, PROPS.counter] = boothSprites();
  const LOOKC = new Map();
  const lookOf = (p) => { const k = p.seed + p.g; let l = LOOKC.get(k); if (!l) { l = W.look(p.seed, p.g); LOOKC.set(k, l); } return l; };
  // 사람: 52x60 캔버스, 발 기준점 (26,52), 외곽선 +1
  function personSprite(p, dir, frame, act) {
    const hat = p.eq && p.eq.hat, rd = p.eq && p.eq.ride, seated = !!(rd && A.RIDE[rd] && A.RIDE[rd].seated);
    return cached(`p${p.seed}${p.g}|${dir}|${frame}|${act}|${hat}|${seated}`, () => {
      const [c, g] = A.mk(52, 60), L = lookOf(p), t = act >= 0 ? act / 11 : 0, sleeve = A.shade(L.shirt, 0.8);
      if (act >= 0) A.pickaxe(g, 26, 52, dir, t, true, sleeve);
      const r = A.person(g, 26, 52, L, dir, frame, { act: act >= 0, seated });
      if (hat) A.hat(g, 26, r.headTop, hat, dir);
      if (act >= 0) A.pickaxe(g, 26, 52, dir, t, false, sleeve);
      return A.outline(c);
    });
  }
  const rideSprite = (id, dir, part, f) => cached(`r${id}|${dir}|${part}|${f}`, () => { const [c, g] = A.mk(40, 44); A.ride(g, 20, 40, id, dir, f / 6, part); return A.outline(c); });
  const runnerSprite = (color, num, pose, blink, flip) => cached(`t${color}|${num}|${pose}|${blink}|${flip}`, () => {
    const [c, g] = A.mk(32, 30);
    if (flip) { g.translate(32, 0); g.scale(-1, 1); }
    A.tarsier(g, 16, 28, color, flip ? '' : num, pose, blink);
    if (flip) { g.setTransform(1, 0, 0, 1, 0, 0); A.text(g, num, 32 - 16 - 3, 19, '#1c140f'); }
    return A.outline(c);
  });
  // 감옥에 갇힌 사람: 셔츠 색 유니폼을 입은 안경원숭이 + 손에 든 작은 낫. 40x34, 발 기준 (20,30).
  // act 0~11 = 낫질 진행(위로 들었다가 앞으로 내리침), -1 = 낫을 등에 멘 상태
  const jailSprite = (color, pose, blink, flip, act) => cached(`j${color}|${pose}|${blink}|${flip}|${act}`, () => {
    const [c, g] = A.mk(40, 34);
    if (flip) { g.translate(40, 0); g.scale(-1, 1); }
    A.tarsier(g, 20, 30, color, '', pose, blink);
    const t = act >= 0 ? act / 11 : -1;
    // 낫 손잡이 각도: 대기 -60°(어깨 위), 들기 -130°, 내리침 +40°
    const deg = t < 0 ? -60 : t < 0.45 ? -60 - (t / 0.45) * 70 : t < 0.6 ? -130 + ((t - 0.45) / 0.15) * 170 : 40 - ((t - 0.6) / 0.4) * 100;
    const a = (deg * Math.PI) / 180, hx = 25, hy = 20, vx = Math.cos(a), vy = Math.sin(a);
    for (let i = 0; i <= 6; i++) A.R(g, Math.round(hx + vx * i), Math.round(hy + vy * i), 1, 1, '#8a5a32');
    const ex = hx + vx * 6, ey = hy + vy * 6;
    for (let i = 0; i <= 6; i++) { const b = (i / 6) * Math.PI * 0.85; A.R(g, Math.round(ex + vx * Math.sin(b) * 3 - vy * (1 - Math.cos(b)) * 4), Math.round(ey + vy * Math.sin(b) * 3 + vx * (1 - Math.cos(b)) * 4), 1, 1, i > 3 ? '#ffffff' : '#c8ccd8'); }
    A.R(g, hx - 1, hy - 1, 2, 2, '#c08850');
    return A.outline(c);
  });
  const riceSprite = (stage, sway) => cached(`rice${stage}|${sway}`, () => A.rice(stage, sway));
  const portrait = (color, num, happy) => cached(`f${color}|${num}|${happy}`, () => { const [c, g] = A.mk(28, 30); A.tarsierFront(g, 14, 28, color, num, happy); return A.outline(c); });
  const petSprite = (id, f, right) => cached(`q${id}|${f}|${right}`, () => { const [c, g] = A.mk(24, 24); A.pet(g, 12, 22, id, f * 0.0982, right); return A.outline(c); });
  const npcSprite = (id, f) => cached(`n${id}|${f}`, () => { const [c, g] = A.mk(28, 36); A.npc(g, 14, 34, id, f / 4); return A.outline(c); });
  const EMO = {};
  for (const e of ['cheer', 'cry', 'love', 'shock']) EMO[e] = A.emoteIcon(e);
  for (const e of ['thumbs', 'nope']) { const im = new Image(); im.src = `img/emo-${e}.png`; EMO[e] = im; }

  // ---------- 지형 굽기 (부팅 시 한 번) ----------
  const [ground, gg] = A.mk(W.W, W.H);
  function hash(x, y) { let n = (x * 374761393 + y * 668265263) ^ 0x5bd1e995; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
  function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v); }
  const fbm = (x, y) => vnoise(x / 48, y / 48) * 0.6 + vnoise(x / 16, y / 16) * 0.28 + vnoise(x / 6, y / 6) * 0.12;
  const PATHS = [[[480, 520], [480, 430]], [[480, 520], [272, 500], [272, 476]], [[272, 500], [150, 470], [144, 380]], [[144, 380], [120, 270]], [[480, 520], [700, 500], [790, 470]], [[700, 500], [760, 420], [860, 330]], [[480, 520], [480, 600]]];
  function segDist(px, py, ax, ay, bx2, by) { const dx = bx2 - ax, dy = by - ay, t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1); return Math.hypot(px - ax - dx * t, py - ay - dy * t); }
  function bake() {
    const img = gg.createImageData(W.W, W.H), d = img.data;
    const REG = [[150, 62, 38], [170, 76, 46], [186, 90, 54], [200, 108, 66]];
    const segs = []; for (const p of PATHS) for (let i = 0; i < p.length - 1; i++) segs.push([...p[i], ...p[i + 1]]);
    const pz = ZONES.jail;
    for (let y = 0; y < W.H; y++) for (let x = 0; x < W.W; x++) {
      const i = (y * W.W + x) * 4, sd = W.stadiumDist(x, y);
      const n = fbm(x & ~1, y & ~1);
      let c = REG[n < 0.38 ? 0 : n < 0.5 ? 1 : n < 0.63 ? 2 : 3];
      let pd = 99; if (y > 250 || x < 260 || x > 700) for (const s of segs) pd = Math.min(pd, segDist(x, y, s[0], s[1], s[2], s[3]));
      if (pd < 9 + vnoise(x / 5, y / 5) * 3) c = pd < 7 ? [214, 132, 86] : [204, 120, 76];
      if (x >= pz.x && x < pz.x + pz.w && y >= pz.y + 4 && y < pz.y + pz.h + 4) {
        // 물 댄 논: 진흙 바닥 위 얕은 물 + 잔물결, 벼 포기 자리는 젖은 흙
        const wv = vnoise(x / 9, y / 4), dry = RICE.some((r) => Math.abs(x - r.x) < 7 && y > r.y - 3 && y < r.y + 3);
        c = dry ? [92, 64, 40] : wv > 0.62 ? [118, 150, 150] : wv > 0.4 ? [92, 124, 120] : [80, 106, 98];
        if (!dry && (y + Math.floor(vnoise(x / 14, y / 30) * 6)) % 7 === 0 && wv > 0.45) c = [150, 182, 176];
      }
      if (sd < TRACK.inner - 1) {
        c = Math.floor((x + y) / 12) & 1 ? [92, 168, 72] : [84, 156, 66];
        if (sd > TRACK.inner - 4) c = [64, 128, 52];
        else if (hash(x, y) < 0.03) c = [110, 186, 84];
      } else if (sd < TRACK.outer + 3) {
        const along = Math.abs(x - TRACK.cx) <= TRACK.half ? x : TRACK.half + Math.atan2(y - TRACK.cy, x - TRACK.cx) * 60;
        if (Math.abs(sd - TRACK.inner) < 1.5 || Math.abs(sd - TRACK.outer) < 1.5) c = (((Math.round(along) % 10) + 10) % 10 < 2) ? [150, 150, 165] : [240, 240, 246];
        else if (sd > TRACK.outer + 1.5) c = [120, 50, 30];
        else {
          const tn = vnoise(x / 3, y / 3);
          c = tn < 0.45 ? [176, 98, 58] : tn < 0.7 ? [188, 110, 66] : [198, 122, 76];
          for (let l = 1; l < TRACK.lanes; l++) if (Math.abs(sd - (TRACK.r0 + l * TRACK.lane)) < 0.5 && ((Math.round(along) % 6) + 6) % 6 < 3) c = [214, 150, 112];
          if (y > TRACK.cy && Math.abs(x - TRACK.cx) <= 1) c = ((x + (y >> 1)) & 1) ? [240, 240, 246] : [30, 30, 36];
        }
      }
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
    gg.putImageData(img, 0, 0);
    for (let k = 0; k < 60; k++) {
      const x = hash(k, 1) * W.W, y = hash(k, 2) * W.H, r = 3 + hash(k, 3) * 9;
      if (W.stadiumDist(x, y) < TRACK.outer + r + 8 || W.blocked(x, y) || Object.values(ZONES).some((z) => W.inRect({ x: z.x - r, y: z.y - r, w: z.w + 2 * r, h: z.h + 2 * r }, x, y))) continue;
      gg.fillStyle = 'rgba(90,30,16,0.35)'; gg.beginPath(); gg.ellipse(Math.round(x), Math.round(y), Math.round(r), Math.round(r * 0.6), 0, 0, Math.PI * 2); gg.fill();
      gg.fillStyle = 'rgba(230,150,100,0.35)'; gg.fillRect(Math.round(x - r * 0.6), Math.round(y + r * 0.45), Math.round(r * 1.2), 1);
    }
    for (let k = 0; k < 900; k++) {
      const x = Math.floor(hash(k, 7) * W.W), y = Math.floor(hash(k, 8) * W.H);
      if (W.stadiumDist(x, y) < TRACK.outer + 4) continue;
      A.R(gg, x, y, 1 + (k % 3 === 0), 1, k % 2 ? '#7a3420' : '#e8a070');
    }
  }

  // ---------- 정적 소품 배치 ----------
  const STATIC = [];
  const prop = (k, fx, fy, sortY) => STATIC.push({ k, x: fx - (PROPS[k].width >> 1), y: fy - PROPS[k].height + 1, sy: sortY ?? fy });
  prop('dome', 360, 92); prop('dome', 480, 96); prop('dome', 602, 92); prop('rocket', 713, 96);
  prop('dish', 268, 70); prop('solar', 664, 150); prop('solar', 300, 150); prop('dish', 940, 360);
  prop('shop', 144, 366); prop('awning', 272, 441); prop('counter', 272, 470);
  prop('standL', 395, 474); prop('standR', 565, 474);
  // 감옥 쇠창살: 뒤쪽(위·좌우 변)은 안의 사람보다 뒤, 앞쪽(아래 변)은 맨 앞
  STATIC.push({ k: 'barsBack', x: ZONES.jail.x, y: ZONES.jail.y - 2, sy: ZONES.jail.y + 8 });
  STATIC.push({ k: 'barsFront', x: ZONES.jail.x, y: ZONES.jail.y - 2, sy: ZONES.jail.y + ZONES.jail.h + 6 });
  prop('jumbo', 480, 340); prop('finish', 480, 349);
  for (const [x, y] of [[214, 196], [746, 196], [214, 404], [746, 404]]) prop('flag', x, y);
  const ROCK_SPR = ['rock0', 'ore0', 'rock2', 'ore1', 'rock0', 'ore2', 'rock2'];
  const CROWD = [];
  for (const x0 of [330, 500]) for (let r = 0; r < 4; r++) for (let x = 4; x < 126; x += 5) if (hash(x + x0, r) < 0.8) CROWD.push({ x: x0 + x, y: 448 + r * 6, c: ['#d94a3a', '#3b78d8', '#e8b830', '#4caf50', '#f2f2f2', '#9c4fd8', '#f07a2a'][Math.floor(hash(x, r + 9) * 7)], s: ['#f1bf96', '#c58556', '#e0a57a', '#9a633c'][Math.floor(hash(x, r + 3) * 4)], ph: hash(x, r + 5) * 6 });

  // ---------- 네트워크 ----------
  let ws = null, retry = 0;
  function connect() {
    G.wantConn = true;
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.onopen = () => { retry = 0; G.connected = true; sendHello(); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } onMsg(m); };
    ws.onclose = (e) => {
      G.connected = false; ws = null;
      if (G.mode === 'title') { $('nick-err').textContent = '서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.'; $('enter').disabled = false; G.wantConn = false; return; }
      if (e.code === 4001 || !G.wantConn) return;
      overlay('서버와 다시 연결하는 중…');
      setTimeout(connect, Math.min(8000, 500 * 2 ** retry++));
    };
  }
  const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  function sendHello() { send({ t: 'hello', name: T.name, g: T.g, seed: T.seed, token: G.token || undefined }); }
  setInterval(() => send({ t: 'ping', c: Date.now() }), 4000);

  function onMsg(m) {
    switch (m.t) {
      case 'welcome': return onWelcome(m);
      case 'snap': for (const [id, x, y, d, run] of m.p) { const p = G.players.get(id); if (p && id !== G.id) pushSnap(p, m.now, x, y, d, run); } return;
      case 'join': addPlayer(m.p); sysChat(`${m.p.name} 님이 들어왔어요.`); return;
      case 'leave': { const p = G.players.get(m.id); if (p) { G.players.delete(m.id); sysChat(`${p.name} 님이 나갔어요.`); } return; }
      case 'eq': { const p = G.players.get(m.id); if (p) p.eq = m.eq; return; }
      case 'race': setRace(m.race); return;
      case 'phase': return onPhase(m);
      case 'pool': if (G.race && G.race.id === m.id) { G.race.pool = m.pool; if (betOpen()) renderRunners(); } return;
      case 'bet': G.me = m.me; G.myBets = m.bets; S.bet(); renderMyBets(); renderSlip(); renderBet(); $('place').disabled = false; return;
      case 'settle': return onSettle(m);
      case 'me': {
        const was = G.me && G.me.jail, bought = G.me && m.me.owned.length > G.me.owned.length;
        G.me = m.me;
        const p = G.players.get(G.id);
        if (p) { p.jail = m.me.jail; p.eq = m.me.eq; if (m.x != null) { p.x = m.x; p.y = m.y; } }
        if (bought) { S.buy(); toast('구매 완료! 바로 장착했어요.', 'big'); }
        if (!was && m.me.jail) onJailed();
        if (shopOpen()) renderShop();
        return;
      }
      case 'rock': return onRock(m);
      case 'chat': { const p = G.players.get(m.id); if (p) { p.bubble = m.text; p.bubbleUntil = performance.now() + 5500; } addChat(m.name, m.text, m.id === G.id); if (m.id !== G.id) S.chat(); return; }
      case 'emote': { const p = G.players.get(m.id); if (p) { p.emote = m.e; p.emoteAt = performance.now(); } return; }
      case 'jail': {
        const p = G.players.get(m.id);
        if (p) { p.jail = m.until; p.x = m.x; p.y = m.y; p.buf = []; p.act = -1; }
        if (p && m.id !== G.id) sysChat(m.until ? `${p.name} 님이 파산해서 감옥에 갇혔어요!` : m.why === 'lucky' ? `${p.name} 님이 벼를 베다가 창살 틈으로 탈출했어요!` : m.why === 'sold' ? `${p.name} 님이 쌀을 팔고 감옥에서 나왔어요.` : `${p.name} 님이 감옥에서 풀려났어요.`);
        return;
      }
      case 'freed':
        S.free(); G.holdUse = false;
        toast(m.why === 'lucky' ? `대박! 벼를 베다가 창살 틈으로 탈출했어요! 재기 지원금 +${CFG.BAILOUT}` : m.why === 'sold' ? `쌀을 팔고 풀려났어요! 재기 지원금 +${CFG.BAILOUT}` : `시간이 다 돼서 풀려났어요. 재기 지원금 +${CFG.BAILOUT}`, 'big');
        if (m.why === 'lucky') { const p = G.players.get(G.id); if (p) for (let i = 0; i < 24; i++) burst(p.x, p.y - 12, 'conf'); }
        return;
      case 'rice': { const r = G.rice[m.id]; if (r) { r.at = m.at; r.cutAt = performance.now(); if (m.by !== G.id) straw(r.x, r.y); } return; }
      case 'toast': toast(m.text, m.kind); sysChat(m.text); return;
      case 'board': G.board = m.board; renderBoard(); return;
      case 'fix': { const p = G.players.get(G.id); if (p) { p.x = m.x; p.y = m.y; } return; }
      case 'pong': { const rtt = Date.now() - m.c, off = m.now - (m.c + rtt / 2); G.rtt = rtt; G.offset = G.offset * 0.8 + off * 0.2; return; }
      case 'err': S.deny(); if (G.mode === 'title') { $('nick-err').textContent = m.text; $('enter').disabled = false; } else toast(m.text, 'bad'); $('place').disabled = false; return;
      case 'kicked': G.wantConn = false; overlay(m.text); return;
    }
  }
  function onWelcome(m) {
    G.id = m.id; G.me = m.me; G.offset = m.now - Date.now(); G.board = m.board;
    if (m.token) { G.token = m.token; localStorage.setItem('td-token', m.token); }
    localStorage.setItem('td-name', T.name); localStorage.setItem('td-g', T.g); localStorage.setItem('td-seed', String(T.seed));
    G.players.clear();
    for (const p of m.players) addPlayer(p);
    addPlayer({ id: m.id, name: m.me.name, g: m.me.gender, seed: m.me.seed, eq: m.me.eq, x: m.x, y: m.y, d: 0, jail: m.me.jail });
    for (const [id, hp] of m.rocks) G.rocks[id].hp = hp;
    if (m.rice) m.rice.forEach((at, i) => { G.rice[i].at = at; });
    G.race = null; setRace(m.race);
    G.myBets = m.bets || [];
    overlay(null);
    if (G.mode === 'title') enterPlay();
    renderBoard(); renderMyBets();
  }
  function addPlayer(p) {
    G.players.set(p.id, { id: p.id, name: p.name, g: p.g, seed: p.seed, eq: p.eq || {}, x: p.x, y: p.y, d: p.d || 0, walk: 0, mv: false, run: false, buf: [], jail: p.jail || 0, act: -1, petX: p.x - 10, petY: p.y, petR: true, trailAcc: 0, dustAcc: 0, speed: 0 });
  }
  // 서버는 10Hz로, 움직인 사람만 보낸다. 간격이 벌어졌다면 그동안 멈춰 있었던 것이므로 직전 위치에 '정지' 지점을 끼워
  // 다시 걷기 시작할 때 이전 정지 위치에서 미끄러지듯 출발하지 않게 한다. 멀리서 시야에 새로 들어온 사람은 순간이동.
  function pushSnap(p, t, x, y, d, run) {
    const b = p.buf, last = b[b.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) > 60) b.length = 0;
    else if (last && t - last.t > 160) b.push({ t: t - 100, x: last.x, y: last.y, d: last.d, run: 0 });
    b.push({ t, x, y, d, run });
    if (b.length > 24) b.splice(0, b.length - 24);
  }
  // 원격 플레이어: 200ms 과거 시점(10Hz 스냅샷 2개분)을 스냅샷 사이 보간 (Source 엔진 방식)
  function interp(p, dt) {
    const rt = now() - 200, b = p.buf;
    if (!b.length) return;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].t > rt) i--;
    const a = b[i - 1], c = b[i];
    let x, y, s;
    if (!a || rt >= c.t) { x = c.x; y = c.y; s = c; } else if (rt <= a.t) { x = a.x; y = a.y; s = a; } else { const k = (rt - a.t) / (c.t - a.t); x = lerp(a.x, c.x, k); y = lerp(a.y, c.y, k); s = a; }
    const moved = Math.hypot(x - p.x, y - p.y);
    p.x = x; p.y = y; p.d = s.d; p.run = !!s.run; p.mv = moved > 0.02;
    p.walk += moved / (p.run ? 26 : 22);
    p.speed = moved / Math.max(dt, 0.001);
  }

  // ---------- 경주 재생 ----------
  function setRace(r) {
    if (!r) return;
    const prev = G.race;
    G.race = { ...r, rep: r.frames ? makeReplay(r) : null };
    if (prev && prev.rep && prev.id !== r.id) { G.prevRace = prev; G.prevUntil = performance.now() + 5000; }
    if (!prev || prev.id !== r.id) { G.myBets = []; G.pick = []; }
    if (betOpen()) renderBet();
    renderMyBets(); renderRaceBox(true);
  }
  function makeReplay(r) {
    const n = r.runners.length, res = { frames: r.frames, ticks: r.frames.length / n, hz: r.hz, times: r.times, order: r.order };
    const pb = RACE.playback(res, r.scale || 1);
    const per = r.runners.map((_, l) => (4 * TRACK.half + 2 * Math.PI * (TRACK.r0 + TRACK.lane * l + TRACK.lane / 2)) * TRACK.laps);
    return { ...res, n, pb, goAt: r.goAt, per, events: r.events || [], said: new Set(), lastLead: -1, finished: false };
  }
  function progressAt(rep, t, i) {
    const f = t * rep.hz, k = Math.floor(f), a = Math.min(k, rep.ticks - 1), b = Math.min(k + 1, rep.ticks - 1);
    let p = lerp(rep.frames[a * rep.n + i] / 10000, rep.frames[b * rep.n + i] / 10000, f - k);
    if (p >= 1 && rep.times[i]) p = 1 + 0.025 * (1 - Math.exp(-Math.max(0, t - rep.times[i]) / 1.4)); // 결승 후 감속
    return p;
  }
  const raceTime = (rep) => rep.pb.map((now() - rep.goAt) / 1000);
  function runnersView() {
    const r = G.mode === 'title' ? G.practice : G.prevRace && performance.now() < G.prevUntil && !(G.race && G.race.rep && now() >= G.race.rep.goAt) ? G.prevRace : G.race;
    if (!r || !r.runners) return null;
    const rep = r.rep, started = !!(rep && now() >= rep.goAt), t = started ? raceTime(rep) : 0, out = [];
    for (let i = 0; i < r.runners.length; i++) {
      const p = started ? progressAt(rep, t, i) : 0, pos = W.lanePos(i, p);
      let pose = 4, hop = 0;
      if (started) {
        const spd = (p - progressAt(rep, Math.max(0, t - 0.1), i)) / 0.1;
        if (spd > 0.004) {
          const ph = ((p * rep.per[i]) / 13) % 1;
          pose = ph < 0.15 ? 0 : ph < 0.3 ? 1 : ph < 0.8 ? 2 : 3;
          hop = ph >= 0.15 && ph < 0.85 ? Math.round(Math.sin(((ph - 0.15) / 0.7) * Math.PI) * clamp(spd * 160, 1.5, 4)) : 0;
        }
      }
      out.push({ i, p, x: pos.x, y: pos.y, pose, hop, flip: pos.dx < -0.3, r: r.runners[i] });
    }
    return { r, rep, t, started, list: out };
  }
  function onPhase(m) {
    if (!G.race || G.race.id !== m.id) return;
    G.race.phase = m.phase;
    if (m.phase === 'closed') { Object.assign(G.race, m, { phase: 'closed' }); G.race.rep = makeReplay(G.race); toast('베팅 마감! 곧 출발합니다.'); }
    if (m.phase === 'race') { S.horn(); if (G.watch && nearTrack() && !(G.me && G.me.jail)) setCam('race'); }
    if (betOpen()) { renderSlip(); renderRunners(); }
    renderRaceBox(true);
  }
  function onSettle(m) {
    G.me = m.me;
    const r = G.race, rep = r && r.rep, w = r ? r.runners[m.order[0]] : null;
    G.myBets = []; renderMyBets();
    const show = () => {
      if (m.mine) { openResult(m); const up = m.mine.pay > m.mine.stake; (up ? S.win : S.lose)(); if (up) coinFountain(Math.min(80, 10 + Math.floor((m.mine.pay - m.mine.stake) / 50))); }
      else if (w) toast(`${w.num}번 ${w.name} 우승! 관람 보너스 +${CFG.WATCH_BONUS} 코인`);
      if (G.cam.mode === 'race') setTimeout(() => setCam('follow'), 2500);
    };
    setTimeout(show, rep ? Math.max(0, rep.goAt + rep.pb.wall * 1000 + 600 - now()) : 0);
  }
  const nearTrack = () => { const p = G.players.get(G.id); return p && Math.abs(p.x - TRACK.cx) < 340 && Math.abs(p.y - TRACK.cy) < 240; };
  function commentary(v) {
    if (!v || !v.started || !v.rep || v.r !== G.race || G.mode !== 'play') return;
    const rep = v.rep, t = v.t, say = (k, s) => { if (rep.said.has(k)) return; rep.said.add(k); ticker(s); };
    const byP = v.list.slice().sort((a, b) => b.p - a.p), lead = byP[0];
    if (t > 0.2) say('go', '출발했습니다!');
    for (const [tick, i, kind] of rep.events) if (tick / rep.hz <= t) { const n = v.r.runners[i]; say('e' + tick + '-' + i, kind === 'cricket' ? `${n.num}번 ${n.name}, 귀뚜라미를 보고 멈춰 섰습니다!` : kind === 'stumble' ? `${n.num}번 ${n.name}, 발이 꼬였습니다! 속도가 떨어집니다!` : `${n.num}번 ${n.name}, 안경을 고쳐 쓰고 무섭게 치고 나갑니다!`); }
    // 선두 교체 중계는 4초에 한 번만 (같은 말 반복 방지)
    if (lead.p < 0.95 && lead.i !== rep.lastLead && t > 3 && t - (rep.leadAt || 0) > 4) { if (rep.lastLead >= 0) say('l' + Math.floor(t), `${lead.r.num}번 ${lead.r.name}, 선두로 올라섭니다!`); rep.lastLead = lead.i; rep.leadAt = t; }
    if (lead.p > 0.5) say('lap', '마지막 바퀴! 승부는 지금부터입니다!');
    if (lead.p > 0.76) say('fs', `마지막 직선! 선두는 ${lead.r.num}번 ${lead.r.name}, ${byP[1].r.num}번이 바짝 뒤쫓습니다!`);
    if (rep.pb.slow && t > rep.pb.slowFrom) say('photo', '대접전! 사진 판정까지 갈 수도 있습니다!');
    const w = rep.order[0];
    if (t >= rep.times[w]) { const n = v.r.runners[w]; say('win', `${n.num}번 ${n.name}, 1착으로 결승선 통과!`); if (!rep.finished) { rep.finished = true; S.finish(); confetti(); } }
  }
