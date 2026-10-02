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
  // 주자 목록: 경주·탭이 바뀔 때만 행을 새로 만들고, 그 외(배당·지분 갱신, 선택)는 글자·클래스만 바꾼다.
  // 매번 다시 만들면 폰에서 초상화 외곽선 계산(GPU 읽기)이 반복돼 탭이 늦게 먹고, 누르는 도중 행이 바뀌어 탭이 사라진다.
  const copyCanvas = (src) => { const [c, g] = A.mk(src.width, src.height); g.drawImage(src, 0, 0); return c; };
  function renderRunners() {
    const el = $('runners'), r = G.race;
    if (!r || !r.runners) { el.replaceChildren(); el._key = null; return; }
    const closed = r.phase !== 'betting';
    $('bet-title').textContent = `경주 #${r.id % 1000} 베팅`; $('bet-count').textContent = ` · 마감 ${mmss(r.betEnd - now())}`;
    $('slip-closed').classList.toggle('hidden', !closed);
    const key = r.id + '|' + G.betType;
    if (el._key !== key) {
      el._key = key; el._rows = [];
      el.replaceChildren(...r.runners.map((q, i) => {
        const cond = COND.find((c) => c.k === q.cond) || COND[2];
        const statBar = (val, col) => h('i', null, h('b', { style: `width:${val}%;background:${col}` }));
        const odds = h('div', { class: 'odds' }), share = h('div', { class: 'share' }), badge = h('span', { class: 'badge hidden' });
        const row = h('div', { class: 'rn', onclick: () => pickRunner(i) },
          badge,
          h('div', { class: 'num', style: `background:${q.color}` }, String(q.num)),
          copyCanvas(portrait(q.color, q.num, false)),
          h('div', null,
            h('div', { class: 'nm' }, q.name),
            h('div', { class: 'meta' + (cond.k === 'best' || cond.k === 'good' ? ' cond-good' : cond.k === 'bad' || cond.k === 'worst' ? ' cond-bad' : '') }, `${STYLE_KO[q.style]} · 컨디션 ${cond.ko}`),
            h('div', { class: 'stats' }, statBar(q.spd, '#ff6a5a'), statBar(q.sta, '#3b78d8'), statBar(q.gut, '#e8b830'), statBar(q.luck, '#4caf50'))),
          h('div', null, odds, share));
        el._rows.push({ row, odds, share, badge });
        return row;
      }));
    }
    const totalPool = Math.max(1, r.pool.reduce((a, b) => a + b, 0));
    el._rows.forEach(({ row, odds, share, badge }, i) => {
      const sel = G.pick.includes(i), pickN = G.pick.indexOf(i), ex = G.betType === 'exacta';
      const oVal = r.odds && !ex ? r.odds[G.betType][i] : null;
      row.classList.toggle('sel', sel);
      const ot = oVal != null ? oVal.toFixed(2) : ex && sel ? `${pickN + 1}착` : '–';
      if (odds.textContent !== ot) odds.textContent = ot;
      const st = `${(r.pool[i] / totalPool * 100).toFixed(0)}%`;
      if (share.textContent !== st) share.textContent = st;
      badge.classList.toggle('hidden', !(sel && ex)); badge.textContent = sel && ex ? `${pickN + 1}착` : '';
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
    if (closed) { $('place').disabled = true; sp.textContent = ''; $('payout').textContent = ''; return; }
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
  window.__TD = { G, send, now, runnersView, h, addChat, sysChat, toast, personSprite, view: () => ({ VW, VH, gp }),
    state: () => { const p = G.players.get(G.id); return p && G.me ? { x: p.x, y: p.y, jail: G.me.jail > now(), rice: G.me.rice || 0, coins: G.me.coins, riceList: G.rice.map((r) => ({ x: r.x, y: r.y, ready: r.at <= now() })) } : null; } };
})();
