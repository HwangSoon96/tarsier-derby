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

  // ---------- 입력 ----------
  const typing = () => !!document.activeElement && document.activeElement.tagName === 'INPUT';
  const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  addEventListener('keydown', (e) => {
    AU.init();
    if (G.mode !== 'play') return;
    if (e.code === 'Escape') { if (!$('modal').classList.contains('hidden')) closeModal(); else if (betOpen()) closeBet(); else if (typing()) document.activeElement.blur(); return; }
    if (typing()) {
      if (e.code === 'Enter' && document.activeElement.id === 'chat-in') { sendChat(); e.preventDefault(); }
      if (e.code === 'Enter' && document.activeElement.id === 'amt') { placeBet(); e.preventDefault(); }
      return;
    }
    if (e.code === 'Enter' || e.code === 'Slash') { $('chat-in').focus(); e.preventDefault(); return; }
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    G.keys.add(e.code);
    if (e.repeat) return;
    const d = e.code.startsWith('Digit') ? +e.code.slice(5) : 0;
    if (d >= 1 && d <= 6) { if (betOpen()) pickRunner(d - 1); else emote(EMOTES[d - 1]); return; }
    switch (e.code) {
      case 'KeyB': betOpen() ? closeBet() : openBet(); break;
      case 'KeyI': openShop(); break;
      case 'KeyL': case 'Tab': openBoard(); break;
      case 'KeyH': openHelp(); break;
      case 'KeyM': toggleMute(); break;
      case 'KeyV': toggleWatch(); break;
      case 'KeyE': case 'Space': use(); break;
    }
    if (MOVE_KEYS.includes(e.code) && G.cam.mode === 'race' && !G.cam.target) { G.watch = false; setCam('follow'); }
  });
  addEventListener('keyup', (e) => G.keys.delete(e.code));
  addEventListener('blur', () => { G.keys.clear(); G.holdUse = false; });
  view.addEventListener('contextmenu', (e) => e.preventDefault());
  view.addEventListener('mousedown', (e) => {
    AU.init();
    if (G.mode !== 'play') return;
    if (typing()) document.activeElement.blur();
    const wx = G.cam.x + (e.clientX * dpr) / gp, wy = G.cam.y + (e.clientY * dpr) / gp, me = G.players.get(G.id);
    const n = NPCS.find((q) => Math.abs(q.x - wx) < 12 && wy > q.y - 34 && wy < q.y + 4);
    if (n) { if (dist(me, n) < 48) interact(n); else toast(`${n.name}에게 가까이 가서 ${KEY_E}를 눌러 주세요.`); return; }
    if (e.button === 0 || e.button === 2) { G.holdUse = e.button === 0; use(); }
  });
  addEventListener('mouseup', () => { G.holdUse = false; });
  const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 1e9);
  function findTarget(p) {
    if (!p) return null;
    let best = null, bd = 1e9;
    // 감옥 안: 간수 로봇와 익은 벼만 상호작용 (다른 NPC·바위는 창살 밖)
    if (p.jail > now()) {
      const f = NPCS.find((n) => n.id === 'farmer'), fd = Math.hypot(f.x - p.x, f.y - p.y);
      if (fd < 34) { bd = fd; best = { kind: 'npc', ref: f }; }
      for (const r of G.rice) { const d = Math.hypot(r.x - p.x, r.y - p.y); if (r.at <= now() && d < 22 && d < bd) { bd = d; best = { kind: 'rice', ref: r }; } }
      return best;
    }
    for (const n of NPCS) { const d = Math.hypot(n.x - p.x, n.y + 4 - p.y); if (d < 36 && d < bd) { bd = d; best = { kind: 'npc', ref: n }; } }
    if (best) return best;
    for (const r of G.rocks) { const d = Math.hypot(r.x - p.x, r.y - p.y); if (r.hp > 0 && d < 26 && d < bd) { bd = d; best = { kind: 'rock', ref: r }; } }
    return best;
  }
  function use() {
    const p = G.players.get(G.id);
    if (!p || p.act >= 0) return;
    const tgt = findTarget(p);
    if (tgt && tgt.kind === 'npc') { G.holdUse = false; return interact(tgt.ref); }
    if (p.jail > now() && !tgt) return;
    if (tgt) { p.d = dirOf(tgt.ref.x - p.x, tgt.ref.y - p.y); p.target = tgt.ref; p.tkind = tgt.kind; } else p.target = null;
    p.act = 0; p.hit = false; S.whoosh();
  }
  function interact(n) {
    if (n.act === 'bet') openBet();
    else if (n.act === 'shop') openShop();
    else if (n.act === 'rice') {
      const rice = G.me ? G.me.rice || 0 : 0;
      if (!(G.me && G.me.jail > now())) toast(`벼리: 파산하면 감옥에서 벼를 베게 될 거예요. 쌀 ${CFG.RICE_NEED}개를 가져오면 내보내 드려요.`);
      else if (rice < CFG.RICE_NEED) toast(`벼리: 쌀이 ${CFG.RICE_NEED - rice}개 더 필요해요. 익은 벼를 ${KEY_E}으로 베어 주세요!`);
      else send({ t: 'sell' });
    }
  }
  const dirOf = (dx, dy) => ((Math.round((Math.atan2(dy, dx) * 180 / Math.PI - 90) / 45) % 8) + 8) % 8;
  function emote(e) { if (!e) return; send({ t: 'emote', e }); S.pop(); }
  function sendChat() { const el = $('chat-in'), v = el.value.trim(); if (v) send({ t: 'chat', text: v }); el.value = ''; el.blur(); }

  // ---------- 갱신 ----------
  function updateMe(dt) {
    const p = G.players.get(G.id);
    if (!p) return;
    const jailed = p.jail > now();
    if (p.act >= 0) {
      const prev = p.act;
      p.act += dt / 0.55;
      if (prev < A.IMPACT_T && p.act >= A.IMPACT_T && !p.hit) {
        p.hit = true;
        const r = p.target;
        if (r && p.tkind === 'rice') { if (r.at <= now() && dist(p, r) < 26) { send({ t: 'rice', id: r.id }); r.at = now() + CFG.RICE_REGROW_MS; r.cutAt = performance.now(); straw(r.x, r.y); S.mine(); } }
        else if (r && r.hp > 0 && dist(p, r) < 30) { send({ t: 'mine', rock: r.id }); r.hitAt = performance.now(); chips(r.x, r.y - 6, 5, '#a0523a'); S.mine(); G.cam.shake = 0.1; }
      }
      if (p.act >= 1) { p.act = -1; if (G.holdUse || G.keys.has('KeyE') || G.keys.has('Space')) use(); }
    }
    let dx = 0, dy = 0;
    if (!typing() && $('modal').classList.contains('hidden')) {
      const k = G.keys;
      if (k.has('KeyA') || k.has('ArrowLeft')) dx--; if (k.has('KeyD') || k.has('ArrowRight')) dx++;
      if (k.has('KeyW') || k.has('ArrowUp')) dy--; if (k.has('KeyS') || k.has('ArrowDown')) dy++;
    }
    const run = !!(dx || dy) && (G.keys.has('ShiftLeft') || G.keys.has('ShiftRight'));
    if (dx || dy) {
      const n = Math.hypot(dx, dy); dx /= n; dy /= n; // 대각선 속도 정규화
      const ride = p.eq.ride && ITEM[p.eq.ride] ? ITEM[p.eq.ride].speed : 1;
      const v = CFG.WALK * ride * (run ? CFG.RUN_MULT : 1) * (p.act >= 0 ? 0.35 : 1) * dt, ox = p.x, oy = p.y;
      if (jailed) [p.x, p.y] = W.clampJail(p.x + dx * v, p.y + dy * v);
      else { if (!W.blocked(p.x + dx * v, p.y)) p.x += dx * v; if (!W.blocked(p.x, p.y + dy * v)) p.y += dy * v; }
      if (p.act < 0) p.d = dirOf(dx, dy);
      const moved = Math.hypot(p.x - ox, p.y - oy);
      p.walk += moved / (run ? 26 : 22); p.mv = moved > 0.01; p.run = run; p.speed = moved / dt;
    } else { p.mv = false; p.run = false; p.speed = 0; }
    const t = performance.now();
    if ((p.mv || p.d !== p.sentD || p.wasMv) && t - G.lastNet > 66) {
      send({ t: 'move', x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, d: p.d, r: p.run ? 1 : 0 });
      G.lastNet = t; p.sentD = p.d; p.wasMv = p.mv;
    }
    G.interact = findTarget(p);
  }
  function updateAvatars(dt) {
    for (const p of G.players.values()) {
      if (p.id !== G.id) interp(p, dt);
      if (p.eq.pet) {
        const tx = p.x + (p.d >= 1 && p.d <= 3 ? -14 : p.d >= 5 ? 14 : -10), ty = p.y + (p.d === 4 ? 8 : 2), k = 1 - Math.exp(-dt * 5), ox = p.petX;
        p.petX += (tx - p.petX) * k; p.petY += (ty - p.petY) * k;
        if (Math.abs(p.petX - ox) > 0.05) p.petR = p.petX > ox;
      }
      const d = (p.speed || 0) * dt;
      if (d > 0.02) {
        if (p.run && !p.eq.ride && (p.dustAcc += d) > 9) { p.dustAcc = 0; part(p.x + (Math.random() - 0.5) * 4, p.y - 1, 'dust'); }
        if (p.eq.trail && !(p.jail > now()) && (p.trailAcc += d) > 5) { p.trailAcc = 0; part(p.x + (Math.random() - 0.5) * 6, p.y - 4 - Math.random() * 6, p.eq.trail); }
      }
    }
  }

  // ---------- 파티클 ----------
  function part(x, y, kind, o = {}) {
    if (G.parts.length > 700) G.parts.shift();
    const q = { x, y, vx: (Math.random() - 0.5) * 10, vy: -4 - Math.random() * 8, life: 0.7, age: 0, kind, ...o };
    if (kind === 'dust') { q.vy = -3; q.life = 0.45; q.vx = (Math.random() - 0.5) * 8; }
    if (kind === 't_dust') { q.kind = 'dust'; q.life = 0.8; }
    if (kind === 't_fire') { q.vy = -18; q.life = 0.5; }
    if (kind === 't_rainbow') { q.vx = 0; q.vy = 0; q.life = 0.9; q.hue = (G.t * 300) % 360; }
    G.parts.push(q);
  }
  function chips(x, y, n, col) { for (let i = 0; i < n; i++) part(x, y, 'chip', { vx: (Math.random() - 0.5) * 70, vy: -40 - Math.random() * 50, life: 0.55, col }); }
  function confetti() { for (let i = 0; i < 120; i++) part(TRACK.cx + (Math.random() - 0.5) * 360, RACE_AREA.y + 40 + Math.random() * 40, 'conf', { vx: (Math.random() - 0.5) * 40, vy: -60 - Math.random() * 60, life: 2.4, col: ['#ff5a5a', '#ffd040', '#6ad06a', '#3b78d8', '#e05d9a', '#fff'][i % 6] }); }
  // 벼 벤 자리: 볏짚 조각 + 금빛 낟알
  function straw(x, y) { for (let i = 0; i < 7; i++) part(x + (Math.random() - 0.5) * 8, y - 6, 'chip', { vx: (Math.random() - 0.5) * 60, vy: -30 - Math.random() * 40, life: 0.6, col: i % 3 ? '#d8b850' : '#8aa83a' }); }
  function burst(x, y) { part(x, y, 'conf', { vx: (Math.random() - 0.5) * 120, vy: -80 - Math.random() * 60, life: 1.4, col: ['#ff5a5a', '#ffd040', '#6ad06a', '#3b78d8', '#fff'][Math.floor(Math.random() * 5)] }); }
  function coinFountain(n) { const p = G.players.get(G.id); if (!p) return; for (let i = 0; i < n; i++) setTimeout(() => part(p.x, p.y - 20, 'coin', { vx: (Math.random() - 0.5) * 70, vy: -90 - Math.random() * 50, life: 1.3 }), i * 25); }
  function updateParts(dt) {
    for (const q of G.parts) {
      q.age += dt; q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.kind === 'chip' || q.kind === 'coin') q.vy += 260 * dt;
      else if (q.kind === 'conf') { q.vy += 70 * dt; q.vx *= 0.99; }
      else q.vx *= 0.92;
    }
    G.parts = G.parts.filter((q) => q.age < q.life);
    for (const p of G.pops) p.age += dt;
    G.pops = G.pops.filter((p) => p.age < 1.3);
  }
  function drawParts(ox, oy) {
    for (const q of G.parts) {
      const x = Math.round(q.x - ox), y = Math.round(q.y - oy), k = q.age / q.life;
      if (x < -8 || y < -8 || x > VW + 8 || y > VH + 8) continue;
      switch (q.kind) {
        case 'dust': bx.globalAlpha = 0.55 * (1 - k); A.R(bx, x, y, k < 0.5 ? 2 : 3, k < 0.5 ? 2 : 3, '#e8b088'); break;
        case 't_heart': bx.globalAlpha = 1 - k; A.R(bx, x, y, 2, 1, '#ff6a8a'); A.R(bx, x + 3, y, 2, 1, '#ff6a8a'); A.R(bx, x, y + 1, 5, 1, '#ff6a8a'); A.R(bx, x + 1, y + 2, 3, 1, '#ff6a8a'); A.R(bx, x + 2, y + 3, 1, 1, '#ff6a8a'); break;
        case 't_spark': { bx.globalAlpha = 1 - k; const s = (Math.floor(q.age * 12) % 2) ? 1 : 2; A.R(bx, x - s, y, 2 * s + 1, 1, '#fff6a0'); A.R(bx, x, y - s, 1, 2 * s + 1, '#fff6a0'); break; }
        case 't_fire': bx.globalAlpha = 1 - k; A.R(bx, x, y, k < 0.4 ? 2 : 1, k < 0.4 ? 2 : 1, k < 0.3 ? '#fff0a0' : k < 0.6 ? '#ffb030' : '#e0402a'); break;
        case 't_rainbow': bx.globalAlpha = 0.85 * (1 - k); A.R(bx, x, y, 3, 3, `hsl(${q.hue},90%,62%)`); break;
        case 'chip': bx.globalAlpha = 1 - k * k; A.R(bx, x, y, 2, 2, q.col); break;
        case 'conf': bx.globalAlpha = Math.min(1, (1 - k) * 3); A.R(bx, x, y, 2, (Math.floor(q.age * 10) % 2) + 1, q.col); break;
        case 'coin': bx.globalAlpha = 1 - k * k; A.R(bx, x - 1, y - 1, 3, 3, '#f2c230'); A.R(bx, x - 1, y - 1, 1, 1, '#fff6a0'); break;
      }
    }
    bx.globalAlpha = 1;
  }
  function onRock(m) {
    const r = G.rocks[m.id];
    if (!r) return;
    const was = r.hp;
    r.hp = m.hp;
    if (m.hp > 0 && was <= 0) { r.bornAt = performance.now(); return; }
    if (m.by !== G.id && m.hp < was) { r.hitAt = performance.now(); chips(r.x, r.y - 6, 4, '#a0523a'); }
    if (m.hp === 0) {
      r.deadAt = performance.now(); chips(r.x, r.y - 6, 14, m.gem ? '#7cf0ff' : '#a0523a'); S.crumble();
      for (let i = 0; i < 6; i++) part(r.x + (Math.random() - 0.5) * 12, r.y - 2, 'dust');
      if (m.by === G.id) { G.pops.push({ x: r.x, y: r.y - 22, text: (m.gem ? '보석! +' : '+') + m.coins, gem: m.gem, age: 0 }); S.coin(); }
    }
  }
  function onJailed() {
    S.jail(); setCam('follow');
    const p = G.players.get(G.id); if (p) p.act = -1;
    toast(`파산해서 감옥에 갇혔어요! 익은 벼를 ${KEY_E}${TOUCH ? '으' : ''}로 베어 쌀 ${CFG.RICE_NEED}개를 간수 벼리에게 팔면 풀려나요. 벨 때마다 ${Math.round(CFG.ESCAPE_CHANCE * 100)}% 확률로 바로 탈출!`, 'bad');
    if (betOpen()) closeBet();
  }

  // ---------- 카메라 ----------
  // 따라가기: 실수 좌표로 정확히 추적. 그리기는 정수 픽셀 버퍼에 하고, 소수 부분은 화면에 옮길 때 기기 픽셀 단위로 밀어
  // 세상이 1px 계단 없이 부드럽게 흐르고 내 캐릭터는 화면 한가운데에 고정된다.
  function setCam(mode) { if (G.cam.mode === mode && !G.cam.target) return; if (G.cam.target === mode) return; G.cam.target = mode; G.cam.fadeDir = 1; }
  function updateCam(dt) {
    const c = G.cam;
    if (c.target) {
      c.fade = clamp(c.fade + dt * 6 * c.fadeDir, 0, 1);
      if (c.fade >= 1 && c.fadeDir > 0) { c.mode = c.target; c.fadeDir = -1; resize(); }
      if (c.fade <= 0 && c.fadeDir < 0) c.target = null;
    }
    if (c.mode === 'race') {
      c.x = clamp(Math.round(RACE_AREA.x + RACE_AREA.w / 2 - VW / 2), 0, Math.max(0, W.W - VW));
      c.y = clamp(Math.round(RACE_AREA.y + RACE_AREA.h / 2 - VH / 2), 0, Math.max(0, W.H - VH));
    }
    else {
      const p = G.players.get(G.id);
      if (p) { c.x = p.x - (VW - 1) / 2; c.y = p.y - 12 - (VH - 1) / 2; }
      c.x = VW - 1 >= W.W ? (W.W - VW + 1) / 2 : clamp(c.x, 0, W.W - VW + 1);
      c.y = VH - 1 >= W.H ? (W.H - VH + 1) / 2 : clamp(c.y, 0, W.H - VH + 1);
    }
    if (c.shake > 0) c.shake -= dt;
  }

  // ---------- 모바일 터치: 가상 조이스틱 + 액션 버튼 ----------
  // 터치 기기(coarse pointer)에서만 표시. 조이스틱은 왼쪽 절반, 액션 버튼은 오른쪽 하단.
  if (TOUCH) {
    $('touch').classList.remove('hidden');
    const jz = $('joy-zone'), jc = $('joy'), jx = jc.getContext('2d');
    jc.width = 140; jc.height = 140; jx.imageSmoothingEnabled = false;
    let joyId = null, baseX = 0, baseY = 0;
    const drawJoy = (dx, dy) => {
      jx.clearRect(0, 0, 140, 140);
      // 바깥 링
      jx.beginPath(); jx.arc(70, 70, 54, 0, Math.PI * 2);
      jx.lineWidth = 3; jx.strokeStyle = 'rgba(255,248,236,.25)'; jx.stroke();
      jx.fillStyle = 'rgba(26,16,12,.18)'; jx.fill();
      // 안쪽 손잡이: 놓으면 가운데, 밀면 이동
      const r = Math.min(36, Math.hypot(dx, dy)), a = Math.atan2(dy, dx);
      const tx = 70 + Math.cos(a) * r, ty = 70 + Math.sin(a) * r;
      jx.beginPath(); jx.arc(tx, ty, 20, 0, Math.PI * 2);
      jx.fillStyle = 'rgba(232,116,58,.55)'; jx.fill();
      jx.lineWidth = 2; jx.strokeStyle = 'rgba(255,255,255,.35)'; jx.stroke();
    };
    drawJoy(0, 0);
    jz.addEventListener('touchstart', (e) => {
      e.preventDefault(); AU.init();
      const t = e.changedTouches[0]; joyId = t.identifier;
      baseX = t.clientX; baseY = t.clientY;
      // 조이스틱 캔버스를 터치 위치 근처에 이동
      jc.style.left = baseX + 'px'; jc.style.bottom = ''; jc.style.top = (baseY - 70) + 'px';
      jc.style.transform = 'none'; jc.classList.add('on');
      drawJoy(0, 0);
    }, { passive: false });
    const joyMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== joyId) continue;
        const dx = t.clientX - baseX, dy = t.clientY - baseY;
        drawJoy(dx, dy);
        // 터치 이동량 → 키 시뮬레이션(임계값 12px)
        G.keys.delete('ArrowLeft'); G.keys.delete('ArrowRight'); G.keys.delete('ArrowUp'); G.keys.delete('ArrowDown'); G.keys.delete('ShiftLeft');
        if (Math.hypot(dx, dy) > 12) {
          // 8방향 매핑: 22.5° 구간마다 키 조합
          if (dx < -10) G.keys.add('ArrowLeft');
          if (dx > 10) G.keys.add('ArrowRight');
          if (dy < -10) G.keys.add('ArrowUp');
          if (dy > 10) G.keys.add('ArrowDown');
          if (Math.hypot(dx, dy) > 50) G.keys.add('ShiftLeft');
        }
      }
    };
    jz.addEventListener('touchmove', (e) => { e.preventDefault(); joyMove(e); }, { passive: false });
    const joyEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== joyId) continue;
        joyId = null; jc.classList.remove('on');
        G.keys.delete('ArrowLeft'); G.keys.delete('ArrowRight'); G.keys.delete('ArrowUp'); G.keys.delete('ArrowDown'); G.keys.delete('ShiftLeft');
      }
    };
    jz.addEventListener('touchend', joyEnd); jz.addEventListener('touchcancel', joyEnd);

    // 액션 버튼: E 키 역할 (누르면 상호작용 / 채굴 / 벼 베기, 꾹 누르면 반복)
    const ab = $('act-btn');
    let actInterval = null;
    ab.addEventListener('touchstart', (e) => { e.preventDefault(); AU.init(); G.keys.add('KeyE'); use(); actInterval = setInterval(() => { if (G.keys.has('KeyE')) use(); }, 600); }, { passive: false });
    const actEnd = () => { G.keys.delete('KeyE'); clearInterval(actInterval); };
    ab.addEventListener('touchend', actEnd); ab.addEventListener('touchcancel', actEnd);
    // 액션 버튼 라벨: 지금 할 수 있는 동작을 짧은 동사로 (픽셀 글꼴에 없는 이모지는 쓰지 않음). 바뀔 때만 DOM 갱신.
    const syncActBtn = () => {
      const it = G.interact;
      const label = !it ? '행동' : it.kind === 'rice' ? '베기' : it.kind === 'rock' ? '캐기' : it.ref.act === 'bet' ? '베팅' : it.ref.act === 'shop' ? '상점' : it.ref.act === 'rice' ? '팔기' : '대화';
      if (ab.textContent !== label) { ab.textContent = label; ab.classList.toggle('ctx', !!it); }
      requestAnimationFrame(syncActBtn);
    };
    syncActBtn();

    // 채팅 토글
    // 채팅: 버튼을 누르면 입력칸이 열리고 키보드가 올라옴. 키보드의 '보내기'(Enter)로 전송, 칸 밖을 누르면 닫힘.
    const chat = $('chat'), cin = $('chat-in');
    cin.placeholder = '메시지 입력'; cin.enterKeyHint = 'send';
    $('chat-toggle').addEventListener('click', () => { if (chat.classList.contains('open')) { sendChat(); chat.classList.remove('open'); } else { chat.classList.add('open'); cin.focus(); } });
    // 채팅 버튼을 눌러 보낼 때도 입력칸 blur가 먼저 일어나므로, 닫기는 클릭 처리 뒤로 미룸
    cin.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== cin) chat.classList.remove('open'); }, 200));

    // 캔버스 터치 기본 동작 차단 (줌·스크롤 방지)
    document.getElementById('view').addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  }

  // ---------- 렌더 ----------
  function render() {
    // 카메라 실수 좌표 → 정수 부분으로 버퍼에 그리고, 소수 부분(fx, fy)은 화면에 옮길 때 밀어서 부드럽게 스크롤
    const c = G.cam, sh = c.shake > 0;
    const cx = c.x + (sh ? (Math.random() - 0.5) * 3 : 0), cy = c.y + (sh ? (Math.random() - 0.5) * 3 : 0);
    const ox = Math.floor(cx), oy = Math.floor(cy), fx = cx - ox, fy = cy - oy;
    bx.fillStyle = '#5a2414'; bx.fillRect(0, 0, VW, VH);
    bx.drawImage(ground, -ox, -oy);
    const list = [], tms = performance.now(), sec = tms / 1000;
    for (const s of STATIC) if (s.x - ox < VW && s.x + PROPS[s.k].width - ox > 0 && s.y - oy < VH && s.y + PROPS[s.k].height - oy > 0) list.push([s.sy, 0, s]);
    for (const r of G.rocks) if (Math.abs(r.x - ox - VW / 2) < VW / 2 + 20 && Math.abs(r.y - oy - VH / 2) < VH / 2 + 30) list.push([r.y, 1, r]);
    for (const n of NPCS) list.push([n.y, 2, n]);
    for (const p of G.players.values()) if (Math.abs(p.x - ox - VW / 2) < VW / 2 + 30 && Math.abs(p.y - oy - VH / 2) < VH / 2 + 60) { list.push([p.y, 3, p]); if (p.eq.pet && !(p.jail > now())) list.push([p.petY, 4, p]); }
    const pz = ZONES.jail;
    if (pz.x - ox < VW && pz.x + pz.w - ox > 0 && pz.y - oy < VH && pz.y + pz.h - oy > 0) for (const r of G.rice) list.push([r.y, 6, r]);
    const rv = runnersView();
    if (rv) for (const q of rv.list) list.push([q.y, 5, q]);
    list.sort((a, b) => a[0] - b[0]);
    for (const [, k, o] of list) {
      if (k === 0) drawStatic(o, ox, oy, sec, rv);
      else if (k === 1) drawRock(o, ox, oy, tms);
      else if (k === 2) bx.drawImage(npcSprite(o.id, Math.floor(sec * 4) % 8), Math.round(o.x - 15 - ox), Math.round(o.y - 35 - oy));
      else if (k === 3) drawPlayer(o, ox, oy, sec);
      else if (k === 4) bx.drawImage(petSprite(o.eq.pet, Math.floor(sec * 8) % 8, o.petR), Math.round(o.petX - 13 - ox), Math.round(o.petY - 23 - oy));
      else if (k === 6) drawRice(o, ox, oy, tms);
      else drawRunner(o, ox, oy, rv, sec);
    }
    drawParts(ox, oy);
    vx.drawImage(buf, -fx * gp, -fy * gp, VW * gp, VH * gp);
    drawScreen(cx, cy, rv, tms);
    commentary(rv);
  }
  function drawStatic(s, ox, oy, sec, rv) {
    bx.drawImage(PROPS[s.k], s.x - ox, s.y - oy);
    if (s.k === 'standL' || s.k === 'standR') drawCrowd(s, ox, oy, sec, rv);
    else if (s.k === 'jumbo') drawJumbo(s.x - ox + 4, s.y - oy + 4, rv);
    else if (s.k === 'rocket' && Math.floor(sec * 2) % 2) A.R(bx, s.x - ox + 13, s.y - oy + 1, 2, 1, '#ff5050');
  }
  function drawCrowd(s, ox, oy, sec, rv) {
    const ph = G.mode === 'title' ? 'race' : G.race ? G.race.phase : 'betting';
    let ex = ph === 'race' ? 0.6 : ph === 'result' ? 0.8 : 0.15;
    if (rv && rv.started && rv.list.some((q) => q.p > 0.76 && q.p < 1)) ex = 1;
    for (const q of CROWD) {
      if (q.x < s.x || q.x > s.x + PROPS[s.k].width) continue;
      const b = (Math.max(0, Math.sin(sec * (4 + ex * 8) + q.ph)) * ex * 2.5) | 0, x = q.x - ox, y = q.y - oy - b;
      A.R(bx, x, y + 1, 3, 3, q.c); A.R(bx, x, y - 1, 3, 2, q.s);
      if (ex > 0.5 && b > 1) { A.R(bx, x - 1, y - 2, 1, 2, q.s); A.R(bx, x + 3, y - 2, 1, 2, q.s); }
    }
  }
  // 전광판: 3x5 LED 글꼴
  function drawJumbo(x, y, rv) {
    const r = G.mode === 'title' ? null : G.race, line = (s, yy, col) => A.text(bx, s, x + Math.round((120 - A.textW(s)) / 2), y + yy, col);
    const chips = (arr, yy) => arr.forEach((q, k) => { A.R(bx, x + 4 + k * 19, y + yy, 17, 9, q.color); A.text(bx, q.num, x + 11 + k * 19, y + yy + 2, '#111'); });
    if (!r) { line('MARS DERBY', 3, '#ffd040'); line('PRACTICE', 11, '#40ff80'); if (rv) chips(rv.list.slice().sort((a, b) => b.p - a.p).map((q) => q.r), 22); }
    else if (r.phase === 'betting') { line(`RACE ${r.id % 1000}`, 2, '#ffd040'); line(`BET ${mmss(r.betEnd - now())}`, 10, '#40ff80'); chips(r.runners, 20); if (r.odds) r.runners.forEach((q, k) => A.text(bx, Math.min(99, Math.round(r.odds.win[k])), x + 7 + k * 19, y + 30, '#ffd040')); }
    else if (r.phase === 'closed') { line('GATE CLOSED', 4, '#ff6a5a'); const s = Math.ceil((r.closeEnd - now()) / 1000); line(s <= 3 && s > 0 ? String(s) : 'READY', 16, '#ffffff'); }
    else if (r.phase === 'race' && rv && rv.r === r) {
      const lead = rv.list.reduce((a, b) => (b.p > a.p ? b : a));
      line(lead.p > 0.76 && lead.p < 1 ? 'FINAL STRETCH' : lead.p < 0.5 ? 'LAP 1/2' : lead.p < 1 ? 'LAP 2/2' : 'FINISH', 3, '#ffd040');
      chips(rv.list.slice().sort((a, b) => b.p - a.p).map((q) => q.r), 13);
      line(`${Math.max(0, rv.t).toFixed(1)}`, 26, '#40ff80');
    } else if ((r.phase === 'result' || r.phase === 'race') && r.order) {
      const w = r.runners[r.order[0]];
      line('WINNER', 3, Math.floor(performance.now() / 300) % 2 ? '#ffd040' : '#ffffff');
      A.R(bx, x + 50, y + 11, 20, 12, w.color); A.text(bx, w.num, x + 59, y + 14, '#111');
      line(`NEXT ${mmss(r.next - now())}`, 27, '#40ff80');
    } else { line('MARS DERBY', 6, '#ffd040'); line(`NEXT ${mmss(r.next - now())}`, 18, '#40ff80'); }
    bx.fillStyle = 'rgba(0,0,0,0.22)'; for (let yy = 1; yy < 36; yy += 2) bx.fillRect(x, y + yy, 120, 1);
  }
  function drawRock(r, ox, oy, tms) {
    const x = Math.round(r.x - ox), y = Math.round(r.y - oy);
    if (r.hp <= 0) { A.R(bx, x - 5, y - 2, 3, 2, '#7a3a28'); A.R(bx, x + 1, y - 1, 4, 2, '#8a4a30'); A.R(bx, x - 1, y - 3, 2, 1, '#9a5a3a'); return; }
    const spr = PROPS[ROCK_SPR[r.id % ROCK_SPR.length]], shake = tms - r.hitAt < 140 ? ((Math.floor(tms / 35) % 2) ? 1 : -1) : 0;
    const grow = tms - r.bornAt < 300 ? (tms - r.bornAt) / 300 : 1;
    if (grow < 1) { const w = Math.max(1, Math.round(spr.width * grow)), hh = Math.max(1, Math.round(spr.height * grow)); bx.drawImage(spr, x - (w >> 1), y - hh + 2, w, hh); return; }
    bx.drawImage(spr, x - (spr.width >> 1) + shake, y - spr.height + 2);
    if (r.hp < CFG.ROCK_HP) { A.R(bx, x - 2 + shake, y - spr.height + 6, 1, 3, '#3a1a10'); if (r.hp < 2) A.R(bx, x + 2 + shake, y - spr.height + 8, 3, 1, '#3a1a10'); }
    if (G.interact && G.interact.ref === r) { bx.globalAlpha = 0.5 + 0.3 * Math.sin(tms / 160); A.R(bx, x - 6, y + 2, 12, 1, '#fff6c0'); bx.globalAlpha = 1; }
  }
  // 벼: 익은 정도에 따라 그루터기 → 새싹 → 푸른 벼 → 황금 이삭. 익은 벼는 바람에 살랑, 막 벤 벼는 잠깐 흔들림.
  function drawRice(r, ox, oy, tms) {
    const x = Math.round(r.x - ox), y = Math.round(r.y - oy), left = r.at - now();
    const stage = left <= 0 ? 3 : left > CFG.RICE_REGROW_MS * 0.66 ? 0 : left > CFG.RICE_REGROW_MS * 0.33 ? 1 : 2;
    const sway = stage === 3 ? Math.round(Math.sin(tms / 700 + r.x * 0.15)) : tms - r.cutAt < 250 ? (Math.floor(tms / 60) % 2 ? 1 : -1) : 0;
    bx.drawImage(riceSprite(stage, sway), x - 8, y - 18);
    if (G.interact && G.interact.ref === r) { bx.globalAlpha = 0.5 + 0.3 * Math.sin(tms / 160); A.R(bx, x - 6, y + 2, 12, 1, '#fff6c0'); bx.globalAlpha = 1; }
  }
  function drawPlayer(p, ox, oy, sec) {
    const x = Math.round(p.x - ox), y = Math.round(p.y - oy), rd = p.eq.ride, R0 = rd && A.RIDE[rd];
    if (p.jail > now()) {
      // 감옥에서는 누구나 안경원숭이로 변신 (셔츠 색 유니폼). 걸을 땐 깡충, 서 있으면 앉은 자세.
      if (p.d >= 5 && p.d <= 7) p.faceL = true; else if (p.d >= 1 && p.d <= 3) p.faceL = false;
      const act = p.act >= 0 ? Math.min(11, Math.floor(p.act * 12)) : -1;
      const pose = act >= 0 ? (act < 6 ? 1 : 3) : p.mv ? Math.floor(p.walk * 0.5) % 4 : 4;
      const hop = p.mv && act < 0 ? [0, 2, 3, 1][Math.floor(p.walk * 0.5) % 4] : 0;
      const blink = Math.floor(sec * 1.1 + p.id * 0.7) % 8 === 0;
      bx.fillStyle = 'rgba(40,10,0,0.28)'; bx.fillRect(x - 5, y - 1, 10, 2);
      bx.drawImage(jailSprite(lookOf(p).shirt, pose, blink, !!p.faceL, act), x - 21, y - 31 - hop);
      p.lift = -7;
      return;
    }
    const frame = p.mv ? Math.floor(p.walk * 4) % 4 : 0, act = p.act >= 0 ? Math.min(11, Math.floor(p.act * 12)) : -1;
    let lift = 0;
    bx.fillStyle = 'rgba(40,10,0,0.28)'; bx.fillRect(x - 5, y - 1, 10, 2);
    if (R0) {
      const f = rd === 'r_ufo' ? Math.floor(sec * 6) % 6 : rd === 'r_board' ? Math.floor(sec * 8) % 2 : rd === 'r_cricket' ? (p.mv ? Math.floor(sec * 6) % 2 : 0) : 0;
      const bob = rd === 'r_board' || rd === 'r_ufo' ? Math.round(Math.sin(sec * 3)) : 0;
      lift = R0.lift - bob;
      bx.drawImage(rideSprite(rd, p.d, 'back', f), x - 21, y - 41 - bob);
      bx.drawImage(personSprite(p, p.d, R0.seated ? 0 : frame, act), x - 27, y - 53 - lift);
      bx.drawImage(rideSprite(rd, p.d, 'front', f), x - 21, y - 41 - bob);
    } else bx.drawImage(personSprite(p, p.d, frame, act), x - 27, y - 53);
    p.lift = lift;
  }
  function drawRunner(q, ox, oy, rv, sec) {
    const x = Math.round(q.x - ox), y = Math.round(q.y - oy), r = rv.r;
    const blink = Math.floor(sec * 1.3 + q.i * 0.37) % 9 === 0;
    let hop = q.hop;
    if (!rv.started) hop = Math.floor(sec * 2 + q.i) % 5 === 0 ? 1 : 0; // 출발 대기: 가끔 들썩
    bx.fillStyle = 'rgba(40,10,0,0.3)'; bx.fillRect(x - 5, y - 1, 10, 2);
    // 출발 게이트 (대기 중엔 닫힘, 출발 후 0.4초 동안 위로 열림)
    const gateT = rv.rep ? (now() - rv.rep.goAt) / 400 : -1;
    if (r !== G.prevRace && gateT < 1 && (r.phase !== 'result')) {
      const g0 = W.lanePos(q.i, 0), gx = Math.round(g0.x - ox) + 6, gy = Math.round(g0.y - oy), up = gateT > 0 ? Math.round(gateT * 10) : 0;
      A.R(bx, gx, gy - 14, 2, 14, '#e8e8f0'); A.R(bx, gx - 14, gy - 15, 16, 2, '#c8ccd8');
      bx.globalAlpha = gateT > 0 ? 1 - gateT : 1; A.R(bx, gx + 2, gy - 12 - up, 2, 10, '#d94a3a'); bx.globalAlpha = 1;
    }
    bx.drawImage(runnerSprite(q.r.color, q.r.num, q.pose, blink, q.flip), x - 17, y - 29 - hop);
    if (rv.started && rv.rep && G.mode === 'play') {
      for (const [tick, i, kind] of rv.rep.events) if (i === q.i && rv.t * rv.rep.hz >= tick && rv.t * rv.rep.hz < tick + rv.rep.hz * 1.2) {
        if (kind === 'burst') { A.R(bx, x - (q.flip ? -10 : 16), y - 12 - hop, 6, 1, '#fff6c0'); A.R(bx, x - (q.flip ? -12 : 18), y - 8 - hop, 5, 1, '#fff6c0'); }
        else { A.R(bx, x - 2, y - 38, 5, 8, '#fff'); A.R(bx, x - 1, y - 37, 3, 1, '#111'); A.R(bx, x, y - 36, 1, 3, kind === 'cricket' ? '#4caf50' : '#d94a3a'); A.R(bx, x, y - 32, 1, 1, '#d94a3a'); }
      }
    }
  }
  // 화면 좌표 위 텍스트 (이름표·말풍선·팝업·PIP) — 버퍼 해상도와 무관하게 선명
  function drawScreen(ox, oy, rv, tms) {
    const fs = labelPx, sx = (wx) => Math.round((wx - ox) * gp), sy = (wy) => Math.round((wy - oy) * gp), bufX = Math.floor(ox), bufY = Math.floor(oy);
    vx.textAlign = 'center'; vx.textBaseline = 'bottom'; vx.lineJoin = 'round';
    if (G.mode === 'play') for (const p of G.players.values()) {
      const top = sy(p.y - 31 - (p.lift || 0) - (p.jail > now() ? 0 : p.eq.hat === 'h_top' ? 6 : p.eq.hat ? 3 : 0)), X = sx(p.x);
      if (X < -200 || X > view.width + 200 || top < -100 || top > view.height + 100) continue;
      const jailed = p.jail > now();
      vx.font = `bold ${fs}px Galmuri11, monospace`;
      const label = jailed ? `${p.name} · 감옥 ${Math.ceil((p.jail - now()) / 1000)}초` : p.name;
      vx.lineWidth = Math.max(2, fs / 4); vx.strokeStyle = 'rgba(20,8,4,0.9)'; vx.strokeText(label, X, top);
      vx.fillStyle = jailed ? '#ff8a7a' : p.id === G.id ? '#ffd860' : '#ffffff'; vx.fillText(label, X, top);
      let by = top - fs - 4;
      if (p.bubble && tms < p.bubbleUntil) {
        vx.font = `${fs}px Galmuri11, monospace`;
        const lines = wrap(p.bubble, fs * 11).slice(0, 3), lh = fs + 2, w = Math.max(...lines.map((l) => vx.measureText(l).width)) + fs, hh = lines.length * lh + fs * 0.6;
        const a = Math.min(1, (p.bubbleUntil - tms) / 400);
        vx.globalAlpha = a;
        const bx0 = Math.round(X - w / 2), by0 = Math.round(by - hh);
        vx.fillStyle = '#1a0e08'; vx.fillRect(bx0 - 2, by0 - 2, w + 4, hh + 4); vx.fillRect(X - 4, by0 + hh, 8, 6);
        vx.fillStyle = '#fff8ec'; vx.fillRect(bx0, by0, w, hh); vx.fillRect(X - 2, by0 + hh, 4, 4);
        vx.fillStyle = '#2a1a12'; lines.forEach((l, i) => vx.fillText(l, X, by0 + fs * 0.3 + (i + 1) * lh));
        vx.globalAlpha = 1; by = by0 - 8;
      }
      if (p.emote && tms - p.emoteAt < 2200) {
        const age = (tms - p.emoteAt) / 1000, k = age < 0.18 ? age / 0.18 * 1.2 : age < 0.3 ? 1.2 - (age - 0.18) / 0.12 * 0.2 : 1;
        const im = EMO[p.emote], size = Math.round(18 * gp * k / (im.width > 20 ? 1 : 1)), fade = Math.min(1, (2.2 - age) / 0.3);
        vx.globalAlpha = fade; vx.imageSmoothingEnabled = im.width > 20;
        vx.drawImage(im, X - size / 2, by - size, size, size * (im.height / im.width || 1));
        vx.imageSmoothingEnabled = false; vx.globalAlpha = 1;
      }
    }
    vx.font = `bold ${Math.round(fs * 1.15)}px Galmuri11, monospace`;
    for (const p of G.pops) { const k = p.age / 1.3; vx.globalAlpha = 1 - k * k; vx.lineWidth = 4; vx.strokeStyle = '#1a0e08'; const yy = sy(p.y - k * 14); vx.strokeText(p.text, sx(p.x), yy); vx.fillStyle = p.gem ? '#7cf0ff' : '#ffd860'; vx.fillText(p.text, sx(p.x), yy); }
    vx.globalAlpha = 1;
    // 상호작용 안내
    const pr = $('prompt'), it = G.mode === 'play' && G.interact;
    if (it) {
      const o = it.ref, X = sx(o.x) / dpr, Y = sy(o.y - (it.kind === 'npc' ? 40 : 22)) / dpr;
      pr.style.transform = `translate(${Math.round(X)}px, ${Math.round(Y)}px) translate(-50%, -100%)`;
      const sell = G.me && (G.me.rice || 0) >= CFG.RICE_NEED;
      const txt = it.kind === 'rice' ? '벼 베기' : it.kind === 'npc' ? (o.act === 'bet' ? '베팅하기' : o.act === 'shop' ? '상점 둘러보기' : o.act === 'rice' ? (G.me && G.me.jail > now() ? (sell ? '쌀 팔고 나가기' : `쌀 ${G.me.rice || 0}/${CFG.RICE_NEED}`) : '말 걸기') : '말 걸기') : '캐기';
      if (pr._t !== txt) { pr.replaceChildren(h('b', null, 'E'), ' ' + txt); pr._t = txt; }
      pr.classList.remove('hidden');
    } else pr.classList.add('hidden');
    // 중계 PIP: 선두 근접 화면
    if (G.cam.mode === 'race' && rv && rv.started && G.mode === 'play' && view.width > 900) {
      const lead = rv.list.reduce((a, b) => (b.p < 1.001 && b.p > a.p ? b : a), rv.list[0]);
      const sw = 92, shh = 52, sx0 = clamp(Math.round(lead.x - bufX - sw / 2), 0, VW - sw), sy0 = clamp(Math.round(lead.y - bufY - shh + 10), 0, VH - shh);
      const k = gp * 2, dw = sw * k, dh = shh * k, dx = view.width - dw - 16 * dpr, dy = view.height - dh - 70 * dpr;
      vx.fillStyle = '#120c0a'; vx.fillRect(dx - 4 * dpr, dy - 4 * dpr, dw + 8 * dpr, dh + 8 * dpr);
      vx.drawImage(buf, sx0, sy0, sw, shh, dx, dy, dw, dh);
      vx.font = `bold ${fs}px Galmuri11, monospace`; vx.textAlign = 'left'; vx.textBaseline = 'top';
      vx.fillStyle = Math.floor(tms / 500) % 2 ? '#ff4040' : '#a01010'; vx.fillRect(dx + 8 * dpr, dy + 8 * dpr, fs * 0.6, fs * 0.6);
      vx.fillStyle = '#fff'; vx.fillText(`LIVE · ${lead.r.num}번 ${lead.r.name} 선두`, dx + 8 * dpr + fs, dy + 4 * dpr);
    }
    // 수감 중 붉은 기운, 화면 전환 페이드
    if (G.me && G.me.jail > now() && G.mode === 'play') { vx.fillStyle = 'rgba(120,0,0,0.12)'; vx.fillRect(0, 0, view.width, view.height); }
    if (G.cam.fade > 0) { vx.fillStyle = `rgba(10,5,4,${G.cam.fade})`; vx.fillRect(0, 0, view.width, view.height); }
  }
  // 말풍선 줄바꿈: 실제 글자 폭(maxW px) 기준, 가능하면 띄어쓰기에서 끊고 긴 단어만 글자 단위로 자름
  function wrap(s, maxW) {
    const out = []; let cur = '';
    const fits = (t) => vx.measureText(t).width <= maxW;
    for (const word of s.split(' ')) {
      const next = cur ? cur + ' ' + word : word;
      if (fits(next)) { cur = next; continue; }
      if (cur) out.push(cur);
      cur = '';
      for (const ch of word) { if (fits(cur + ch)) cur += ch; else { out.push(cur); cur = ch; } }
    }
    if (cur) out.push(cur);
    return out;
  }

  // ---------- 오버레이·토스트·티커·채팅 ----------
  function overlay(msg) {
    const el = $('overlay');
    if (!msg) { el.classList.add('hidden'); return; }
    $('overlay-text').textContent = msg; el.classList.remove('hidden');
  }
  const TOAST_LIFE = 4500;
  function toast(text, kind) {
    const el = h('div', { class: 'toast' + (kind ? ' ' + kind : '') }, text);
    const box = $('toasts'); box.appendChild(el); el.offsetHeight;
    while (box.children.length > 3) box.firstChild.remove(); // 한 번에 최대 3개만
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 420); }, TOAST_LIFE);
  }
  function ticker(text) {
    const el = $('ticker'), d = h('div', { class: 'tick' }, text);
    el.appendChild(d); d.offsetHeight;
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 400); }, 6000);
  }
  function sysChat(text) { addChat(null, text, false); }
  function addChat(name, text, mine) {
    const log = $('chat-log'), atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    const line = name ? h('div', null, h('b', { class: mine ? 'my' : '' }, name + ': '), text) : h('div', { class: 'sys' }, text);
    // 오래된 줄에 old 클래스 추가 (포커스 시 보임)
    for (const ch of log.children) if (log.children.length > 6 && Array.from(log.children).indexOf(ch) < log.children.length - 6) ch.classList.add('old');
    log.appendChild(line);
    if (log.childNodes.length > 120) log.removeChild(log.firstChild);
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  // ---------- HUD 업데이트 ----------
  let hudTimer = 0;
  function updateHud(dt) {
    hudTimer -= dt; if (hudTimer > 0) return; hudTimer = 0.25;
    if (!G.me) return;
    const showCoins = Math.round(G.coinShow + (G.me.coins - G.coinShow) * 0.18);
    G.coinShow = showCoins; $('coins').textContent = fmt(showCoins);
    const jailed = G.me.jail > now();
    $('jail-t').textContent = jailed ? ` · 감옥 쌀 ${G.me.rice || 0}/${CFG.RICE_NEED} · ${Math.ceil((G.me.jail - now()) / 1000)}초` : '';
    $('me-box').classList.toggle('jailed', jailed);
    renderRaceBox();
  }
  function renderRaceBox(force) {
    const r = G.race, bar = $('race-bar'); if (!r) { bar.className = ''; return; }
    const e1 = $('race-line1'), e2 = $('race-line2');
    bar.className = 'on';
    if (r.phase === 'betting') {
      e1.textContent = `경주 #${r.id % 1000}`; e2.textContent = `마감 ${mmss(r.betEnd - now())}`;
      const pct = Math.max(0, 100 * (r.betEnd - now()) / (r.betEnd - r.startAt)); bar.style.width = pct.toFixed(1) + '%';
      // 러너 마커
      if (r.runners) { bar.replaceChildren(); r.runners.forEach((q, i) => { const m = h('i', { style: `left:${(r.pool[i] / Math.max(1, r.pool.reduce((a,b)=>a+b,0))) * 100}%;background:${q.color}` }, q.num); bar.appendChild(m); }); }
    } else if (r.phase === 'closed') { e1.textContent = `경주 #${r.id % 1000}`; e2.textContent = '곧 출발합니다'; bar.style.width = '100%'; bar.replaceChildren(); }
    else if (r.phase === 'race') { e1.textContent = '경주 진행 중!'; e2.textContent = ''; bar.style.width = '100%'; bar.replaceChildren(); }
    else if (r.phase === 'result') { e1.textContent = '경주 종료'; e2.textContent = `다음 경주까지 ${mmss(r.next - now())}`; bar.style.width = '0%'; bar.replaceChildren(); }
    else { e1.textContent = `경주 #${r.id % 1000}`; e2.textContent = `다음 경주까지 ${mmss(r.next - now())}`; bar.style.width = '0%'; bar.replaceChildren(); }
  }
  function renderBoard() {
    const ol = $('board-list'); ol.replaceChildren();
    for (const p of G.board) {
      const li = h('li', { class: G.me && p.name === G.me.name ? 'me' : '' }, h('span', null, p.name), h('span', null, fmt(p.coins)));
      ol.appendChild(li);
    }
    const count = G.players.size; $('online-n').textContent = `(${count}명 접속)`;
  }
  function renderMyBets() {
    const el = $('mybets'), list = $('mybets-list');
    if (!G.myBets.length) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden'); list.replaceChildren();
    for (const b of G.myBets) list.appendChild(h('div', null, `${betLabel(b)} · ${fmt(b.amount)} × ${b.odds.toFixed(2)}`));
  }
  const betLabel = (b) => {
    const r = G.race;
    if (!r || !r.runners) return `${b.type} ${b.key}`;
    if (b.type === 'win') return `단승 ${r.runners[b.key].num}번`;
    if (b.type === 'place') return `연승 ${r.runners[b.key].num}번`;
    const [a, c] = String(b.key).split('-'); return `쌍승 ${r.runners[+a].num}→${r.runners[+c].num}`;
  };

  // ---------- 베팅 ----------
  const betOpen = () => !$('bet').classList.contains('hidden') && !$('bet').classList.contains('closing');
  function openBet() {
    if (!G.race || G.race.phase === 'void') return toast('지금은 베팅할 수 없어요. 다음 경주를 기다려 주세요.');
    if (G.me && G.me.jail > now()) return toast('감옥에 갇혀 있는 동안에는 베팅할 수 없어요.');
    showEl($('bet')); G.betType = 'win'; G.pick = [];
    setBetTab('win'); renderRunners(); renderSlip(); S.ui();
  }
  // 닫힘 애니메이션이 끝난 뒤 숨김. 그 사이 다시 열면 취소.
  function hideAnimated(el) {
    if (el.classList.contains('hidden') || el.classList.contains('closing')) return;
    el.classList.add('closing');
    el._hideT = setTimeout(() => { el.classList.remove('closing'); el.classList.add('hidden'); }, 160);
  }
  function showEl(el) { clearTimeout(el._hideT); el.classList.remove('closing', 'hidden'); }
  function closeBet() { hideAnimated($('bet')); S.ui(); }
  function setBetTab(type) {
    G.betType = type; G.pick = [];
    for (const b of $('bet-tabs').children) b.classList.toggle('on', b.dataset.type === type);
    renderRunners(); renderSlip();
  }
  $('bet-tabs').addEventListener('click', (e) => { if (e.target.dataset.type) setBetTab(e.target.dataset.type); });
  function renderRunners() {
    const el = $('runners'); el.replaceChildren();
    const r = G.race; if (!r || !r.runners) return;
    const closed = r.phase !== 'betting';
    $('bet-title').textContent = `경주 #${r.id % 1000} 베팅`; $('bet-count').textContent = ` · 마감 ${mmss(r.betEnd - now())}`;
    $('slip-closed').classList.toggle('hidden', !closed);
    const totalPool = Math.max(1, r.pool.reduce((a, b) => a + b, 0));
    r.runners.forEach((q, i) => {
      const cond = COND.find((c) => c.k === q.cond) || COND[2];
      const sel = G.pick.includes(i), pickN = G.pick.indexOf(i);
      const oVal = r.odds ? (G.betType === 'exacta' ? null : r.odds[G.betType][i]) : null;
      // 초상화 캠버스
      const [pc, pg] = A.mk(28, 30); A.tarsierFront(pg, 14, 28, q.color, q.num, false);
      const pcOut = A.outline(pc);
      // 능력치 바
      const statBar = (label, val, col) => {
        const bar = h('i'); const inner = h('b', { style: `width:${val}%;background:${col}` }); bar.appendChild(inner);
        return bar;
      };
      const statsEl = h('div', { class: 'stats' }, statBar('SPD', q.spd, '#ff6a5a'), statBar('STA', q.sta, '#3b78d8'), statBar('GUT', q.gut, '#e8b830'), statBar('LCK', q.luck, '#4caf50'));
      const row = h('div', { class: 'rn' + (sel ? ' sel' : ''), onclick: () => pickRunner(i) },
        h('div', { class: 'num', style: `background:${q.color}` }, String(q.num)),
        pcOut,
        h('div', null,
          h('div', { class: 'nm' }, q.name),
          h('div', { class: 'meta' + (cond.k === 'best' || cond.k === 'good' ? ' cond-good' : cond.k === 'bad' || cond.k === 'worst' ? ' cond-bad' : '') }, `${STYLE_KO[q.style]} · 컨디션 ${cond.ko}`),
          statsEl
        ),
        h('div', null,
          h('div', { class: 'odds' }, oVal != null ? oVal.toFixed(2) : (G.betType === 'exacta' && sel ? `${pickN + 1}착` : '–')),
          h('div', { class: 'share' }, `${(r.pool[i] / totalPool * 100).toFixed(0)}%`)
        )
      );
      if (sel && G.betType === 'exacta') row.insertBefore(h('span', { class: 'badge' }, `${pickN + 1}착`), row.firstChild);
      el.appendChild(row);
    });
  }
  function pickRunner(i) {
    if (G.betType === 'exacta') {
      if (G.pick.includes(i)) G.pick = G.pick.filter((k) => k !== i);
      else { G.pick.push(i); if (G.pick.length > 2) G.pick.shift(); }
    } else { G.pick = G.pick[0] === i ? [] : [i]; }
    S.hover(); renderRunners(); renderSlip();
  }
  function renderSlip() {
    const r = G.race, closed = !r || r.phase !== 'betting', sp = $('slip-pick');
    if (closed) { $('place').disabled = true; return; }
    const ready = G.betType === 'exacta' ? G.pick.length === 2 : G.pick.length === 1;
    if (!ready) {
      sp.textContent = G.betType === 'exacta' ? `1착과 2착을 순서대로 골라 주세요 (${G.pick.length}/2)` : (TOUCH ? '응원할 안경원숭이를 골라 주세요' : '응원할 안경원숭이를 골라 주세요 (숫자 키 1~6)');
      $('payout').textContent = ''; $('place').disabled = true; return;
    }
    const odds = G.betType === 'exacta' ? (r.odds ? (r.odds.exacta[G.pick[0] + '-' + G.pick[1]] || 0) : 0) : r.odds ? r.odds[G.betType][G.pick[0]] : 0;
    const amt = Math.max(0, +$('amt').value || 0);
    sp.textContent = G.betType === 'exacta' ? `쌍승 ${r.runners[G.pick[0]].num}→${r.runners[G.pick[1]].num} × ${odds.toFixed(2)}` : `${G.betType === 'win' ? '단승' : '연승'} ${r.runners[G.pick[0]].num}번 × ${odds.toFixed(2)}`;
    $('payout').textContent = amt > 0 ? `적중 시 ${fmt(Math.floor(amt * odds))} 코인` : '';
    $('place').disabled = !amt || amt < CFG.MIN_BET || !G.me || amt > G.me.coins;
  }
  function renderBet() { renderRunners(); renderSlip(); }
  function placeBet() {
    if ($('place').disabled) return;
    const r = G.race; if (!r) return;
    const amt = +$('amt').value; if (!amt || amt < CFG.MIN_BET) return;
    const key = G.betType === 'exacta' ? [G.pick[0], G.pick[1]] : G.pick[0];
    send({ t: 'bet', race: r.id, type: G.betType, key, amount: amt });
    $('place').disabled = true; // 서버 응답 올 때까지 비활성
    localStorage.setItem('td-amt', String(amt));
  }
  $('place').addEventListener('click', placeBet);
  $('cancel-all').addEventListener('click', () => send({ t: 'cancel' }));
  $('amt').addEventListener('input', () => renderSlip());
  $('amt').value = G.amount;
  for (const b of document.querySelectorAll('[data-add]')) b.addEventListener('click', () => {
    const v = b.dataset.add, el = $('amt');
    if (v === 'all') el.value = G.me ? G.me.coins : 0;
    else if (v === 'half') el.value = G.me ? Math.floor(G.me.coins / 2) : 0;
    else if (v === '0') el.value = CFG.MIN_BET;
    else el.value = (+el.value || 0) + +v;
    renderSlip(); S.hover();
  });

  // ---------- 상점 ----------
  const shopOpen = () => !$('modal').classList.contains('hidden') && $('modal')._mode === 'shop';
  function openShop() {
    $('modal')._mode = 'shop'; renderShop(); showEl($('modal')); S.ui();
  }
  function renderShop() {
    const body = $('modal-body'), p = G.me; if (!p) return; body.replaceChildren();
    body.appendChild(h('h2', null, '화성 잡화상'));
    for (const slot of SLOTS) {
      body.appendChild(h('h3', null, slot === 'hat' ? '모자' : slot === 'trail' ? '발자취' : slot === 'ride' ? '탈것' : '펫'));
      const grid = h('div', { class: 'grid' });
      for (const it of ITEMS.filter((x) => x.slot === slot)) {
        const owned = p.owned.includes(it.id), eq = p.eq[slot] === it.id;
        // 아이템 미리보기 캠버스
        const [ic, ig] = A.mk(40, 44);
        if (slot === 'hat') { const L = lookOf({ seed: p.seed, g: p.gender }); A.person(ig, 20, 40, L, 0, 0, {}); A.hat(ig, 20, A.person(ig, 20, 40, L, 0, 0, {}).headTop, it.id, 0); }
        else if (slot === 'pet') A.pet(ig, 20, 40, it.id, 0, true);
        else if (slot === 'ride') A.ride(ig, 20, 40, it.id, 0, 0, 'front');
        else {
          // 발자취 미리보기: 걸어간 자리에 남는 픽셀 점들 (이모지 대신 실제 색)
          const col = { t_dust: ['#d8b890', '#b8936a'], t_heart: ['#ff6a8a', '#ffb0c0'], t_spark: ['#fff6a0', '#ffffff'], t_fire: ['#ff7a2a', '#ffd040'], t_rainbow: ['#ff5a5a', '#ffd040', '#6ad06a', '#3b78d8', '#b05ad8'] }[it.id] || ['#fff'];
          for (let i = 0; i < 7; i++) { const x = 6 + i * 4, y = 32 - Math.round(Math.sin(i * 0.9) * 4) - i * 2; A.R(ig, x, y, i % 2 ? 2 : 3, i % 2 ? 2 : 3, col[i % col.length]); }
          A.R(ig, 33, 12, 4, 4, '#3a2a20'); A.R(ig, 34, 13, 2, 2, '#f1bf96');
        }
        const card = h('div', {
          class: 'item' + (eq ? ' eq' : owned ? ' own' : ''),
          onclick: () => {
            if (!owned && p.coins < it.price) return toast('코인이 부족해요.');
            if (owned) send({ t: 'equip', slot, item: eq ? null : it.id });
            else { if (!card._confirm) { card._confirm = true; card.querySelector('.price').textContent = '한 번 더 누르면 구매'; setTimeout(() => { card._confirm = false; if ($('modal')._mode === 'shop') renderShop(); }, 2500); return; } send({ t: 'buy', item: it.id }); }
          }
        },
          A.outline(ic),
          h('div', null, it.name),
          it.speed ? h('small', null, `이동 속도 ×${it.speed}`) : null,
          h('div', { class: 'price' }, owned ? (eq ? '장착 중' : '장착하기') : fmt(it.price))
        );
        grid.appendChild(card);
      }
      body.appendChild(grid);
    }
  }

  // ---------- 모달 (순위·도움말·결과) ----------
  function closeModal() { hideAnimated($('modal')); S.ui(); }
  for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => { const t = b.dataset.close; if (t === 'bet') closeBet(); else closeModal(); });
  function openBoard() {
    $('modal')._mode = 'board'; const body = $('modal-body'); body.replaceChildren();
    body.appendChild(h('h2', null, '부자 순위'));
    const ol = h('ol', { class: 'big-board' });
    for (const p of G.board) {
      ol.appendChild(h('li', { class: G.me && p.name === G.me.name ? 'me' : '' },
        h('span', null, p.name), h('span', null, `${fmt(p.coins)} 코인`), p.best ? h('small', null, `최고 당첨 ${fmt(p.best)}`) : null
      ));
    }
    body.appendChild(ol); showEl($('modal')); S.ui();
  }
  function openHelp() {
    $('modal')._mode = 'help'; const body = $('modal-body'); body.replaceChildren();
    body.appendChild(h('h2', null, '화성간건호 · 도움말'));
    const sec = (t) => body.appendChild(h('h3', null, t));
    sec('베팅');
    body.appendChild(h('p', null, TOUCH ? '경주는 5분마다 열려요. 베팅 로봇 BET-9 앞에서 행동 버튼을 누르거나 오른쪽 위 베팅 버튼으로 베팅 창을 열 수 있어요.' : '경주는 5분마다 열려요. 베팅 로봇 BET-9 앞에서 E 키를 누르거나 B 키로 베팅 창을 열 수 있어요.'));
    body.appendChild(h('p', null, '단승은 1착, 연승은 2착 이내, 쌍승은 1착과 2착을 순서대로 맞히는 베팅이에요.'));
    sec('광석 채굴');
    body.appendChild(h('p', null, (TOUCH ? '맵 양쪽의 바위 앞에서 행동 버튼을 누르면 캘 수 있어요.' : '맵 양쪽의 바위는 E 키, 스페이스바, 클릭으로 캘 수 있어요.') + ' 세 번 내리치면 코인을 얻고, 4% 확률로 보석이 나와요.'));
    sec('상점');
    body.appendChild(h('p', null, (TOUCH ? '잡화상 쿠쿠에게 가거나 오른쪽 위 상점 버튼을 눌러' : '잡화상 쿠쿠에게 가거나 I 키를 눌러') + ' 모자, 발자취, 탈것, 펫을 살 수 있어요.'));
    sec('파산');
    body.appendChild(h('p', null, `코인이 ${CFG.MIN_BET}개보다 적어지면 파산해서 감옥에 갇혀 안경원숭이로 변해요.`));
    body.appendChild(h('p', null, `익은 벼를 ${KEY_E}${TOUCH ? '으' : ''}로 베어 쌀 ${CFG.RICE_NEED}개를 모아 간수 로봇 벼리에게 팔면 풀려나요. 벨 때마다 ${Math.round(CFG.ESCAPE_CHANCE * 100)}% 확률로 바로 탈출할 수도 있어요.`));
    body.appendChild(h('p', null, `아무것도 안 해도 ${Math.round(CFG.BANKRUPT_JAIL_MS / 1000)}초 뒤엔 풀려나요. 나올 때 재기 지원금 ${CFG.BAILOUT} 코인을 받아요.`));
    if (TOUCH) { sec('조작'); body.appendChild(h('p', null, '왼쪽 화면 어디든 누른 채 끌면 이동, 멀리 끌면 달리기 · 오른쪽 아래 행동 버튼: 상호작용(꾹 누르면 반복) · 채팅 버튼: 채팅')); }
    else sec('단축키');
    if (!TOUCH) body.appendChild(h('p', null, 'WASD/방향키: 이동 · Shift: 달리기 · E/스페이스: 상호작용 · B: 베팅 · I: 상점 · L: 순위 · V: 중계 · H: 도움말 · M: 음소거 · 1~6: 이모트 · Enter: 채팅'));
    showEl($('modal')); S.ui();
  }
  function openResult(m) {
    $('modal')._mode = 'result'; const body = $('modal-body'); body.replaceChildren();
    const r = G.race; if (!r || !r.runners) return;
    body.appendChild(h('h2', null, '경주 결과'));
    // 포디움
    const podium = h('div', { class: 'podium' });
    for (let k = 0; k < Math.min(3, m.order.length); k++) {
      const q = r.runners[m.order[k]], medal = ['1착', '2착', '3착'][k];
      const [c, g] = A.mk(28, 30); A.tarsierFront(g, 14, 28, q.color, q.num, k === 0);
      podium.appendChild(h('div', { class: k === 0 ? 'p1' : '' }, h('div', null, medal), A.outline(c), h('b', null, `${q.num}번 ${q.name}`)));
    }
    body.appendChild(podium);
    // 내 성적
    if (m.mine) {
      body.appendChild(h('h3', null, '내 베팅'));
      for (const b of m.mine.bets) body.appendChild(h('div', { class: b.pay > 0 ? 'win' : '' }, `${betLabel(b)} · ${fmt(b.amount)} → ${b.pay > 0 ? '+' + fmt(b.pay) : '미적중'}`));
      const net = m.mine.pay - m.mine.stake;
      body.appendChild(h('div', { class: 'net' + (net >= 0 ? ' plus' : ' minus') }, `순이익: ${net >= 0 ? '+' : ''}${fmt(net)} 코인`));
    }
    showEl($('modal'));
  }

  // ---------- 바 버튼 ----------
  for (const b of $('bar').querySelectorAll('[data-act]')) b.addEventListener('click', () => {
    AU.init();
    switch (b.dataset.act) {
      case 'bet': betOpen() ? closeBet() : openBet(); break;
      case 'shop': openShop(); break;
      case 'board': openBoard(); break;
      case 'watch': toggleWatch(); break;
      case 'help': openHelp(); break;
      case 'mute': toggleMute(); break;
    }
  });
  function toggleMute() { AU.setMuted(!AU.muted); $('mute-btn').classList.toggle('off', AU.muted); S.ui(); }
  function toggleWatch() { G.watch = !G.watch; if (G.watch && G.race && G.race.phase === 'race') setCam('race'); else setCam('follow'); toast(G.watch ? '경주 자동 중계를 켰어요.' : '경주 자동 중계를 껐어요.'); }

  // 이모트 바
  const emoteBar = $('emotes');
  for (const e of EMOTES) {
    const btn = h('button', { class: 'emo-btn', onclick: () => emote(e) });
    const src = EMO[e];
    if (src instanceof HTMLCanvasElement) {
      const copy = document.createElement('canvas'); copy.width = src.width; copy.height = src.height;
      copy.getContext('2d').drawImage(src, 0, 0); btn.appendChild(copy);
    } else if (src instanceof HTMLImageElement) {
      const im = new Image(); im.src = src.src; btn.appendChild(im);
    } else btn.textContent = e;
    emoteBar.appendChild(btn);
  }

  // ---------- 타이틀 ----------
  const T = { name: localStorage.getItem('td-name') || '', g: localStorage.getItem('td-g') || 'm', seed: +(localStorage.getItem('td-seed') || crypto.getRandomValues(new Uint32Array(1))[0]) };
  $('nick').value = T.name;
  for (const b of $('gender').querySelectorAll('button[data-g]')) {
    b.classList.toggle('on', b.dataset.g === T.g);
    b.addEventListener('click', () => { T.g = b.dataset.g; for (const x of $('gender').querySelectorAll('button[data-g]')) x.classList.toggle('on', x.dataset.g === T.g); drawAvatar(); });
  }
  $('reroll').addEventListener('click', () => { T.seed = crypto.getRandomValues(new Uint32Array(1))[0]; drawAvatar(); S.hover(); });
  // 로고: 글꼴이 로드된 뒤 한 번 그리고, 화면 크기에 맞는 정수 배율로만 키운다 (픽셀 뭉개짐 방지)
  let LOGO = null;
  function sizeLogo() {
    if (!LOGO) return;
    const el = $('logo'), k = Math.max(2, Math.min(6, Math.floor(Math.min(innerWidth * 0.62 / LOGO.width, innerHeight * 0.3 / LOGO.height))));
    el.width = LOGO.width; el.height = LOGO.height; el.getContext('2d').drawImage(LOGO, 0, 0);
    el.style.width = LOGO.width * k + 'px'; el.style.height = LOGO.height * k + 'px';
  }
  document.fonts.load('bold 12px Galmuri11').then(() => { LOGO = A.logo(); sizeLogo(); });
  addEventListener('resize', sizeLogo);
  const avCtx = $('avatar').getContext('2d');
  let avDir = 0;
  function drawAvatar() {
    const L = W.look(T.seed, T.g), [c, g] = A.mk(28, 32);
    A.person(g, 14, 30, L, avDir, 0, {}); avCtx.clearRect(0, 0, 40, 44); avCtx.drawImage(A.outline(c), 6, 6, 28, 32);
  }
  setInterval(() => { avDir = (avDir + 1) % 8; drawAvatar(); }, 600);
  drawAvatar();
  function titlePractice() {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
    const card = RACE.drawCard(seed);
    const res = RACE.simulate(card, seed + 1, true);
    const pb = RACE.playback(res, 1);
    const runners = card.map((c) => { const s = STABLE[c.stable]; return { num: c.num, stable: c.stable, name: s.name, color: s.color, style: s.style }; });
    G.practice = { runners, rep: { frames: res.frames, ticks: res.ticks, hz: res.hz, times: res.times, order: res.order, pb, goAt: now() + 3000, per: runners.map((_, l) => (4 * TRACK.half + 2 * Math.PI * (TRACK.r0 + TRACK.lane * l + TRACK.lane / 2)) * TRACK.laps), n: runners.length, events: res.events || [], said: new Set(), lastLead: -1, finished: false } };
  }
  function checkPractice() {
    if (G.mode !== 'title' || !G.practice || !G.practice.rep) return;
    const t = raceTime(G.practice.rep);
    if (t > G.practice.rep.pb.total + 4) titlePractice();
  }

  $('enter').addEventListener('click', doEnter);
  $('nick').addEventListener('keydown', (e) => { if (e.code === 'Enter') doEnter(); });
  function doEnter() {
    T.name = $('nick').value.trim();
    if (!T.name || [...T.name].length < CFG.NAME_MIN || !W.NAME_RE.test(T.name)) { $('nick-err').textContent = '닉네임은 2~10자 한글·영문·숫자·_- 만 가능해요.'; return; }
    $('nick-err').textContent = ''; $('enter').disabled = true;
    connect();
  }

  function enterPlay() {
    G.mode = 'play'; G.coinShow = G.me.coins;
    $('title').classList.add('hidden'); $('hud').classList.remove('hidden');
    setCam('follow'); resize(); bake();
    $('coins').textContent = fmt(G.me.coins);
    if (G.me.jail > now()) toast(`아직 감옥이에요. 쌀 ${G.me.rice || 0}/${CFG.RICE_NEED} · ${Math.ceil((G.me.jail - now()) / 1000)}초 남았어요.`, 'bad');
    S.ui();
    AU.setCrowd(0.15);
  }

  // ---------- 메인 루프 ----------
  let lastT = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastT) / 1000); lastT = ts; G.t = ts / 1000;
    if (G.mode === 'play') {
      updateMe(dt); updateAvatars(dt); updateParts(dt); updateCam(dt); updateHud(dt);
      AU.musicTick(dt);
      const ph = G.race ? G.race.phase : 'betting';
      AU.setCrowd(ph === 'race' ? 0.55 : ph === 'result' ? 0.7 : 0.12);
      render();
    } else if (G.mode === 'title') {
      checkPractice(); updateParts(dt); updateCam(dt);
      render(); // 타이틀 배경도 관중석·전광판·결승선까지 실제 경기장 그대로
    }
    // 카운트다운 비프
    if (G.mode === 'play' && G.race && G.race.phase === 'closed') {
      const sec = Math.ceil((G.race.closeEnd - now()) / 1000);
      if (sec >= 1 && sec <= 3 && G.race._beep !== sec) { G.race._beep = sec; S.beep(sec === 1); }
    }
  }

  // ---------- 부팅 ----------
  G.cam.mode = 'race'; resize(); bake(); titlePractice();
  // /status 로 접속자 수 가져오기
  fetch('/status').then((r) => r.ok ? r.json() : null).then((d) => { if (d) $('online').textContent = `지금 ${d.online}명 접속 중 · 다음 경주까지 ${mmss(d.nextRace - Date.now())}`; }).catch(() => {});
  requestAnimationFrame(frame);

  // 테스트 훅
  // 자동화 테스트용 조회 훅 (읽기 전용 요약)
  window.__TD = { G, send, now, runnersView, h, addChat, sysChat, toast,
    state: () => { const p = G.players.get(G.id); return p && G.me ? { x: p.x, y: p.y, jail: G.me.jail > now(), rice: G.me.rice || 0, coins: G.me.coins, riceList: G.rice.map((r) => ({ x: r.x, y: r.y, ready: r.at <= now() })) } : null; } };
})();
