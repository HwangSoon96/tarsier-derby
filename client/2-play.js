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
    if (n) { if (dist(me, n) < 48) interact(n); else toast(`${n.name}에게 가까이 가서 E 를 누르세요.`); return; }
    if (e.button === 0 || e.button === 2) { G.holdUse = e.button === 0; use(); }
  });
  addEventListener('mouseup', () => { G.holdUse = false; });
  const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 1e9);
  function findTarget(p) {
    if (!p) return null;
    let best = null, bd = 1e9;
    for (const n of NPCS) { const d = Math.hypot(n.x - p.x, n.y + 4 - p.y); if (d < 36 && d < bd) { bd = d; best = { kind: 'npc', ref: n }; } }
    if (best) return best;
    if (p.jail > now()) return null;
    for (const r of G.rocks) { const d = Math.hypot(r.x - p.x, r.y - p.y); if (r.hp > 0 && d < 26 && d < bd) { bd = d; best = { kind: 'rock', ref: r }; } }
    return best;
  }
  function use() {
    const p = G.players.get(G.id);
    if (!p || p.act >= 0) return;
    const tgt = findTarget(p);
    if (tgt && tgt.kind === 'npc') { G.holdUse = false; return interact(tgt.ref); }
    if (p.jail > now()) return;
    if (tgt) { p.d = dirOf(tgt.ref.x - p.x, tgt.ref.y - p.y); p.target = tgt.ref; } else p.target = null;
    p.act = 0; p.hit = false; S.whoosh();
  }
  function interact(n) {
    if (n.act === 'bet') openBet();
    else if (n.act === 'shop') openShop();
    else toast(['R-2: 파산하면 30초간 여기서 반성하는 거다.', 'R-2: 우리 안에서도 채팅은 할 수 있지.', `R-2: 석방되면 보석금 ${CFG.BAILOUT}코인을 준다. 이번엔 신중하게!`][Math.floor(Math.random() * 3)]);
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
        if (r && r.hp > 0 && dist(p, r) < 30) { send({ t: 'mine', rock: r.id }); r.hitAt = performance.now(); chips(r.x, r.y - 6, 5, '#a0523a'); S.mine(); G.cam.shake = 0.1; }
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
      if (jailed) [p.x, p.y] = W.clampCage(p.x + dx * v, p.y + dy * v);
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
        if (p.eq.trail && (p.trailAcc += d) > 5) { p.trailAcc = 0; part(p.x + (Math.random() - 0.5) * 6, p.y - 4 - Math.random() * 6, p.eq.trail); }
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
    toast(`파산! ${Math.round(CFG.BANKRUPT_JAIL_MS / 1000)}초 동안 우리에 갇힙니다. 채팅은 할 수 있어요.`, 'bad');
    if (betOpen()) closeBet();
  }

  // ---------- 카메라 (정수 픽셀 고정 → 떨림 없음) ----------
  function setCam(mode) { if (G.cam.mode === mode && !G.cam.target) return; if (G.cam.target === mode) return; G.cam.target = mode; G.cam.fadeDir = 1; }
  function updateCam(dt) {
    const c = G.cam;
    if (c.target) {
      c.fade = clamp(c.fade + dt * 6 * c.fadeDir, 0, 1);
      if (c.fade >= 1 && c.fadeDir > 0) { c.mode = c.target; c.fadeDir = -1; resize(); }
      if (c.fade <= 0 && c.fadeDir < 0) c.target = null;
    }
    if (c.mode === 'race') { c.x = Math.round(RACE_AREA.x + RACE_AREA.w / 2 - VW / 2); c.y = Math.round(RACE_AREA.y + RACE_AREA.h / 2 - VH / 2); }
    else {
      const p = G.players.get(G.id);
      if (p) { c.x = Math.round(p.x) - (VW >> 1); c.y = Math.round(p.y) - 12 - (VH >> 1); }
      c.x = VW >= W.W ? Math.round((W.W - VW) / 2) : clamp(c.x, 0, W.W - VW);
      c.y = VH >= W.H ? Math.round((W.H - VH) / 2) : clamp(c.y, 0, W.H - VH);
    }
    if (c.shake > 0) c.shake -= dt;
  }
