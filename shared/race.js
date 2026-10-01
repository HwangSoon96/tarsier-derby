// 공유 모듈: 결정적 경주 시뮬레이션 + 몬테카를로 배당 산정
(function (root) {
  'use strict';
  const W = typeof module !== 'undefined' && module.exports ? require('./world.js') : root.WORLD;
  const { STABLE, COND, CFG } = W;

  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // 출전표: 명단 12마리 중 6마리 + 컨디션
  function drawCard(seed) {
    const r = rng(seed), idx = STABLE.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    return idx.slice(0, CFG.RUNNERS).map((s, lane) => {
      const x = r(), cond = x < 0.1 ? 0 : x < 0.3 ? 1 : x < 0.7 ? 2 : x < 0.9 ? 3 : 4;
      return { stable: s, lane, num: lane + 1, cond };
    });
  }

  // 각 주법의 구간별 페이스 배율 (초반 <0.3, 중반, 종반 >0.7)
  const PACE = { front: [1.035, 1.0, 0.975], pace: [1.015, 1.0, 0.99], stalk: [0.99, 1.005, 1.005], closer: [0.97, 1.0, 1.03] };
  const BASE = 1 / 44; // 초당 진행도 (평균 약 44초)

  // 경주 시뮬레이션. record=true면 틱마다 진행도(0~10000 정수) 기록.
  function simulate(card, seed, record = true, hz = CFG.TICK_HZ) {
    const r = rng(seed), dt = 1 / hz, n = card.length;
    const st = card.map((c) => {
      const s = STABLE[c.stable], m = COND[c.cond].m;
      // 그날의 몸 상태(form): 경주마다 ±2.5% 속도 편차 → 능력치가 같아도 매번 결과가 달라짐
      return { s, m, form: 1 + (r() - 0.5) * 0.085, p: 0, sta: 1, noise: 0, ev: 0, evT: 0, evUsed: false, done: false };
    });
    const frames = record ? [] : null, events = [], order = [], times = new Array(n).fill(0);
    let tick = 0;
    const cap = 75 * hz;
    while (order.length < n && tick < cap) {
      let lead = 0;
      for (const x of st) if (!x.done && x.p > lead) lead = x.p;
      for (let i = 0; i < n; i++) {
        const x = st[i];
        if (x.done) continue;
        const ph = x.p < 0.3 ? 0 : x.p < 0.7 ? 1 : 2;
        let v = BASE * PACE[x.s.style][ph] * (0.94 + x.s.spd * 0.0008) * x.m * x.form;
        x.noise += ((r() - 0.5) * 0.7 - x.noise) * 0.025;       // 매끄러운 흔들림 (수 초 단위로 엎치락뒤치락)
        v *= 1 + x.noise;
        if (x.sta < 0.2) v *= 0.9 + x.sta * 0.5;                 // 지구력 고갈
        if (x.p > 0.72) v *= 1 + x.sta * 0.05 + (x.s.gut - 70) * 0.0008; // 막판 스퍼트: 남은 지구력 + 근성
        const gap = lead - x.p;
        if (gap > 0.004 && gap < 0.03) v *= 1.015;               // 슬립스트림
        if (!x.evUsed && x.p > 0.08 && x.p < 0.9) {               // 돌발 사건 (경주당 최대 1회)
          // 틱당 확률 = 경주당 확률 / 틱 수. 운(luck)이 높을수록 나쁜 사건이 드묾.
          const luck = 1.4 - x.s.luck / 100, q = r() * hz * 36;
          if (q < 0.05 * luck) { x.ev = 1; x.evT = 1.0; x.evUsed = true; events.push([tick, i, 'cricket']); }
          else if (q < 0.09 * luck) { x.ev = 2; x.evT = 0.8; x.evUsed = true; events.push([tick, i, 'stumble']); }
          else if (q < 0.13 * luck) { x.ev = 3; x.evT = 1.4; x.evUsed = true; events.push([tick, i, 'burst']); }
        }
        if (x.evT > 0) { x.evT -= dt; v *= x.ev === 1 ? 0.05 : x.ev === 2 ? 0.55 : 1.18; if (x.evT <= 0) x.ev = 0; }
        x.p += v * dt;
        const leading = x.p >= lead - 0.0005 ? 1.3 : 1; // 선두는 바람을 맞아 지구력 소모↑ (추입마에게 기회)
        x.sta = Math.max(0, x.sta - dt * (v / BASE) ** 2 * leading * (0.0085 + (100 - x.s.sta) * 0.00018));
        if (x.p >= 1) { x.p = 1; x.done = true; times[i] = (tick + 1) * dt - (x.p - 1) / v; order.push(i); }
      }
      if (record) for (const x of st) frames.push(Math.round(x.p * 10000));
      tick++;
    }
    for (let i = 0; i < n; i++) if (!st[i].done) { order.push(i); times[i] = cap * dt; }
    return { frames, n, hz, events, order, times: times.map((t) => Math.round(t * 1000) / 1000), ticks: tick };
  }

  // 몬테카를로 배당: 단승(1등), 연승(2등 안), 쌍승(1·2등 순서대로). 하우스 엣지 반영.
  function odds(card, seed, sims = 1200) {
    const n = card.length, win = new Array(n).fill(0), plc = new Array(n).fill(0), ex = {};
    for (let k = 0; k < sims; k++) {
      const res = simulate(card, (seed + k * 7919) >>> 0, false);
      const [a, b] = res.order;
      win[a]++; plc[a]++; plc[b]++;
      const key = a + '-' + b; ex[key] = (ex[key] || 0) + 1;
    }
    const e = 1 - CFG.HOUSE_EDGE, q = (x) => Math.round(x * 10) / 10;
    const pw = win.map((c) => (c + 0.5) / (sims + n * 0.5)), pp = plc.map((c) => (c + 0.5) / (sims + n * 0.5));
    const res = { win: pw.map((p) => q(Math.min(99, Math.max(1.1, e / p)))), place: pp.map((p) => q(Math.min(30, Math.max(1.05, (e * 2) / (2 * p))))), exacta: {}, prob: pw };
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) {
      const c = ex[i + '-' + j] || 0, harv = pw[i] * (pw[j] / (1 - pw[i]));  // 표본이 적으면 Harville 근사와 혼합
      const p = (c + harv * 20) / (sims + 20);
      res.exacta[i + '-' + j] = q(Math.min(300, Math.max(3, e / p)));
    }
    return res;
  }

  // 재생 시간표: 1·2위 차이가 0.25초 미만이면 결승 직전~직후를 슬로모션(0.35배)으로 보여준다.
  // 서버는 wall(재생 총 길이)로 정산 시각을 정하고, 클라이언트는 map()으로 벽시계→경주 시간을 변환한다.
  function playback(res, scale = 1) {
    const total = res.ticks / res.hz, t1 = res.times[res.order[0]], t2 = res.times[res.order[1]];
    const slow = scale === 1 && t2 - t1 < 0.25, sl = 0.35, a = Math.max(0, t1 - 1.4), b = Math.min(total, t1 + 0.4);
    const wall = slow ? a + (b - a) / sl + (total - b) : total / scale;
    const map = (w) => {
      if (w <= 0) return 0;
      if (!slow) return Math.min(total, w * scale);
      if (w < a) return w;
      if (w < a + (b - a) / sl) return a + (w - a) * sl;
      return Math.min(total, b + (w - a - (b - a) / sl));
    };
    return { total, wall, slow, slowFrom: a, map };
  }

  const API = { rng, drawCard, simulate, odds, playback, BASE, PACE };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.RACE = API;
})(this);
