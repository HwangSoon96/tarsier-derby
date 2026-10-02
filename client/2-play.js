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
    if (n) { if (dist(me, n) < 48) interact(n); else toast(`${n.name}에게 가까이 가서 E 키를 눌러 주세요.`); return; }
    if (e.button === 0 || e.button === 2) { G.holdUse = e.button === 0; use(); }
  });
  addEventListener('mouseup', () => { G.holdUse = false; });
  const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 1e9);
  function findTarget(p) {
    if (!p) return null;
    let best = null, bd = 1e9;
    // 감옥 안: 농부 간수와 익은 벼만 상호작용 (다른 NPC·바위는 창살 밖)
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
      else if (rice < CFG.RICE_NEED) toast(`벼리: 쌀이 ${CFG.RICE_NEED - rice}개 더 필요해요. 익은 벼를 E 키로 베어 주세요!`);
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
    toast(`파산해서 감옥에 갇혔어요! 익은 벼를 E 키로 베어 쌀 ${CFG.RICE_NEED}개를 간수 벼리에게 팔면 풀려나요. 벨 때마다 ${Math.round(CFG.ESCAPE_CHANCE * 100)}% 확률로 바로 탈출!`, 'bad');
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
  const TOUCH = 'ontouchstart' in window || matchMedia('(pointer:coarse)').matches;
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
    // 프롬프트 텍스트 → 액션 버튼 라벨 동기화
    const syncActBtn = () => { const it = G.interact; ab.textContent = !it ? 'E' : it.kind === 'rice' ? '🌾' : it.kind === 'rock' ? '⛏' : it.ref.act === 'bet' ? '💰' : it.ref.act === 'shop' ? '🛒' : it.ref.act === 'rice' ? '🌾' : 'E'; requestAnimationFrame(syncActBtn); };
    syncActBtn();

    // 채팅 토글
    $('chat-toggle').addEventListener('click', () => { const el = $('chat-in'); if (el === document.activeElement) { sendChat(); } else { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } });

    // 캔버스 터치 기본 동작 차단 (줌·스크롤 방지)
    document.getElementById('view').addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  }
