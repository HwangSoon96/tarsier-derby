  // ---------- 렌더 ----------
  function render() {
    // 카메라 실수 좌표 → 정수 부분으로 버퍼에 그리고, 소수 부분(fx, fy)은 화면에 옮길 때 밀어서 부드럽게 스크롤
    const c = G.cam, sh = c.shake > 0;
    const cx = c.x + (sh ? (Math.random() - 0.5) * 3 : 0), cy = c.y + (sh ? (Math.random() - 0.5) * 3 : 0);
    const ox = Math.floor(cx), oy = Math.floor(cy), fx = cx - ox, fy = cy - oy;
    bx.fillStyle = '#5a2414'; bx.fillRect(0, 0, VW, VH);
    bx.drawImage(ground, -ox, -oy);
    const list = [], tms = performance.now(), sec = tms / 1000;
    for (const s of STATIC) { const im = s.img || PROPS[s.k]; if (s.x - ox < VW && s.x + im.width - ox > 0 && s.y - oy < VH && s.y + im.height - oy > 0) list.push([s.sy, 0, s]); }
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
    bx.drawImage(s.img || PROPS[s.k], s.x - ox, s.y - oy);
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
