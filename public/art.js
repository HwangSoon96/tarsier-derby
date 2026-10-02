// 절차적 픽셀 아트: 모든 스프라이트는 캔버스에 직접 그린 뒤 외곽선을 입혀 캐시한다.
(function () {
  'use strict';
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return [c, g]; };
  const R = (g, x, y, w, h, col) => { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), w, h); };
  const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16); const f = (v) => Math.max(0, Math.min(255, Math.round(v * k))); return '#' + ((f(n >> 16) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).padStart(6, '0'); };
  const mix = (a, b, t) => { const p = parseInt(a.slice(1), 16), q = parseInt(b.slice(1), 16); const c = (s) => Math.round(((p >> s) & 255) * (1 - t) + ((q >> s) & 255) * t); return '#' + ((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0'); };

  // 스타듀식 외곽선: 투명 이웃 픽셀에 원색을 어둡게 한 색을 칠한다 (1px 여백 추가)
  function outline(src, k = 0.35) {
    const w = src.width, h = src.height, [c, g] = mk(w + 2, h + 2);
    const d = src.getContext('2d').getImageData(0, 0, w, h).data, out = g.createImageData(w + 2, h + 2), o = out.data;
    const A = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[(y * w + x) * 4 + 3]);
    for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
      const i = ((y + 1) * (w + 2) + x + 1) * 4;
      if (A(x, y) >= 90) { const j = (y * w + x) * 4; o[i] = d[j]; o[i + 1] = d[j + 1]; o[i + 2] = d[j + 2]; o[i + 3] = d[j + 3]; continue; }
      let best = -1;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (A(x + dx, y + dy) >= 90) { const j = ((y + dy) * w + x + dx) * 4, l = d[j] + d[j + 1] + d[j + 2]; if (best < 0 || l < best) { best = l; o[i] = d[j] * k; o[i + 1] = d[j + 1] * k; o[i + 2] = d[j + 2] * k; o[i + 3] = 255; } }
      if (best < 0 && A(x, y) > 0) { const j = (y * w + x) * 4; o[i] = d[j]; o[i + 1] = d[j + 1]; o[i + 2] = d[j + 2]; o[i + 3] = d[j + 3]; }
    }
    g.putImageData(out, 0, 0);
    return c;
  }

  // ---------- 3x5 픽셀 글꼴 (전광판·등번호) ----------
  const GLYPH = {
    0: '###,#.#,#.#,#.#,###', 1: '.#.,##.,.#.,.#.,###', 2: '###,..#,###,#..,###', 3: '###,..#,.##,..#,###', 4: '#.#,#.#,###,..#,..#',
    5: '###,#..,###,..#,###', 6: '###,#..,###,#.#,###', 7: '###,..#,.#.,.#.,.#.', 8: '###,#.#,###,#.#,###', 9: '###,#.#,###,..#,###',
    A: '.#.,#.#,###,#.#,#.#', B: '##.,#.#,##.,#.#,##.', C: '.##,#..,#..,#..,.##', D: '##.,#.#,#.#,#.#,##.', E: '###,#..,##.,#..,###', F: '###,#..,##.,#..,#..',
    G: '.##,#..,#.#,#.#,.##', H: '#.#,#.#,###,#.#,#.#', I: '###,.#.,.#.,.#.,###', J: '..#,..#,..#,#.#,.#.', K: '#.#,#.#,##.,#.#,#.#', L: '#..,#..,#..,#..,###', M: '#.#,###,###,#.#,#.#',
    N: '##.,#.#,#.#,#.#,#.#', O: '.#.,#.#,#.#,#.#,.#.', P: '##.,#.#,##.,#..,#..', R: '##.,#.#,##.,#.#,#.#', S: '.##,#..,.#.,..#,##.', T: '###,.#.,.#.,.#.,.#.',
    U: '#.#,#.#,#.#,#.#,###', V: '#.#,#.#,#.#,#.#,.#.', W: '#.#,#.#,###,###,#.#', X: '#.#,#.#,.#.,#.#,#.#', Y: '#.#,#.#,.#.,.#.,.#.', ':': '...,.#.,...,.#.,...',
    '-': '...,...,###,...,...', '!': '.#.,.#.,.#.,...,.#.', '.': '...,...,...,...,.#.', ' ': '...,...,...,...,...', '/': '..#,..#,.#.,#..,#..'
  };
  function text(g, s, x, y, col) {
    g.fillStyle = col;
    let cx = Math.round(x);
    for (const ch of String(s).toUpperCase()) {
      const gl = GLYPH[ch] || GLYPH[' '], rows = gl.split(',');
      for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (rows[r][q] === '#') g.fillRect(cx + q, Math.round(y) + r, 1, 1);
      cx += 4;
    }
    return cx - x;
  }
  const textW = (s) => String(s).length * 4 - 1;

  // ---------- 사람 아바타 (8방향) ----------
  // dir: 0↓ 1↘ 2→ 3↗ 4↑ 5↖ 6← 7↙ / pose: front, fq(앞 3/4), side, bq(뒤 3/4), back
  const POSE = ['front', 'fq', 'side', 'bq', 'back', 'bq', 'side', 'fq'];
  const FLIP = [false, false, false, false, false, true, true, true];

  function person(g, ox, oy, L, dir, frame, opts = {}) {
    const pose = POSE[dir], fl = FLIP[dir] ? -1 : 1;
    // 미러 좌표: x는 기준점(ox)으로부터의 오프셋, 왼쪽 방향은 좌우 반전
    const P = (x, y, w, h, col) => R(g, fl > 0 ? ox + x : ox - x - w, oy + y, w, h, col);
    const skin = L.skin, skinD = shade(L.skin, 0.86), hair = L.hair, hairD = shade(L.hair, 0.72), hairL = shade(L.hair, 1.18);
    const shirt = L.shirt, shirtD = shade(L.shirt, 0.78), pants = L.pants, pantsD = shade(L.pants, 0.75), shoe = '#3a2a22';
    const seated = !!opts.seated, step = seated ? 0 : frame % 4;            // 0 접지, 1 교차, 2 접지(반대), 3 교차
    const bob = step === 1 || step === 3 ? -1 : 0;
    const ls = step === 0 ? 1 : step === 2 ? -1 : 0;                         // 다리 앞뒤
    // --- 다리 ---
    if (!seated) {
      if (pose === 'side') {
        P(-2 + ls, -6, 3, 4, pants); P(-1 - ls, -6, 3, 4, pantsD);
        P(-2 + ls * 2, -2, 4, 2, shoe); P(-1 - ls * 2, -2, 3, 2, shade(shoe, 0.8));
      } else {
        const a = pose === 'front' || pose === 'fq' ? 1 : -1;
        P(-4, -6, 3, 4 - (ls < 0 ? 1 : 0), pants); P(1, -6, 3, 4 - (ls > 0 ? 1 : 0), pants);
        P(-4, -2 - (ls < 0 ? 1 : 0), 3, 2, shoe); P(1, -2 - (ls > 0 ? 1 : 0), 3, 2, shoe);
        if (pose === 'fq' || pose === 'bq') P(1, -6, 3, 1, pantsD);
        if (a < 0) P(-4, -6, 7, 1, pantsD);
      }
    }
    const by = oy + bob;
    const Q = (x, y, w, h, col) => P(x, y + bob, w, h, col);
    // --- 몸통 ---
    if (pose === 'side') {
      Q(-3, -12, 6, 6, shirt); Q(-3, -12, 2, 6, shirtD); Q(-3, -7, 6, 1, pantsD);
    } else if (pose === 'fq' || pose === 'bq') {
      // 3/4: 몸을 비튼 만큼 폭이 좁고, 보는 쪽으로 1px 치우침. 먼 쪽은 그늘.
      Q(-4, -12, 9, 6, shirt); Q(-4, -7, 9, 1, pantsD); Q(-4, -12, 2, 5, shirtD);
      if (pose === 'fq') Q(1, -12, 2, 2, shirtD); else Q(-4, -12, 9, 1, shirtD);
    } else {
      Q(-5, -12, 10, 6, shirt); Q(-5, -7, 10, 1, pantsD);
      if (pose === 'front') { Q(-1, -12, 2, 2, shirtD); Q(-5, -12, 1, 5, shirtD); }
      else Q(-5, -12, 10, 1, shirtD);
    }
    // --- 팔 (도구 사용 중이면 팔은 도구 쪽에서 그림) ---
    const swing = seated ? 0 : ls;
    if (!opts.act) {
      if (pose === 'side') { Q(-1 - swing, -11, 2, 5, shirtD); Q(-1 - swing * 2, -7, 2, 2, skin); }
      else if (pose === 'fq' || pose === 'bq') {
        // 먼 팔은 몸 뒤로 거의 가려지고, 가까운 팔은 앞뒤로 흔들림
        Q(-5, -11 - (swing > 0 ? 1 : 0), 1, 4, shade(shirt, 0.62));
        Q(5, -11 + swing, 2, 4, shirtD); Q(5, -7 + swing, 2, 2, skin);
      } else {
        Q(-7, -11 - (swing > 0 ? 1 : 0), 2, 4, shirtD); Q(5, -11 - (swing < 0 ? 1 : 0), 2, 4, shirtD);
        Q(-7, -7 - (swing > 0 ? 1 : 0), 2, 2, skin); Q(5, -7 - (swing < 0 ? 1 : 0), 2, 2, skin);
      }
    } else if (pose !== 'side') { Q(-7, -11, 2, 4, shirtD); Q(-7, -7, 2, 2, skin); }
    // --- 머리 (12x11) ---
    const hy = -22;
    Q(-6, hy + 1, 12, 10, skin); Q(-5, hy, 10, 1, skin); Q(-5, hy + 11, 10, 1, skinD);
    if (pose === 'front') {
      Q(-6, hy + 5, 1, 3, skinD); Q(5, hy + 5, 1, 3, skinD);                       // 귀 그늘
      Q(-4, hy + 6, 2, 2, '#2a1d16'); Q(2, hy + 6, 2, 2, '#2a1d16'); Q(-4, hy + 6, 1, 1, '#fff'); Q(2, hy + 6, 1, 1, '#fff');
      Q(-5, hy + 8, 2, 1, '#f09a8a'); Q(3, hy + 8, 2, 1, '#f09a8a'); Q(-1, hy + 9, 2, 1, shade(skin, 0.7));
    } else if (pose === 'fq') {
      // 얼굴이 보는 쪽으로 돌아감: 눈·입이 오른쪽으로, 코끝이 윤곽 밖으로, 먼 쪽에 귀
      Q(-1, hy + 6, 2, 2, '#2a1d16'); Q(3, hy + 6, 2, 2, '#2a1d16'); Q(-1, hy + 6, 1, 1, '#fff'); Q(3, hy + 6, 1, 1, '#fff');
      Q(4, hy + 8, 2, 1, '#f09a8a'); Q(1, hy + 9, 2, 1, shade(skin, 0.7)); Q(6, hy + 7, 1, 2, skin);
      Q(-5, hy + 5, 2, 3, skinD);
    } else if (pose === 'side') {
      Q(2, hy + 6, 2, 2, '#2a1d16'); Q(2, hy + 6, 1, 1, '#fff'); Q(6, hy + 7, 1, 2, skin); Q(3, hy + 8, 2, 1, '#f09a8a');
      Q(-2, hy + 5, 2, 3, skinD);                                                      // 귀
    }
    // --- 머리카락 ---
    const st = L.style;
    if (pose === 'front' || pose === 'fq') {
      const k = pose === 'fq' ? 1 : 0;
      Q(-6, hy - 1, 12, 4, hair); Q(-5, hy - 2, 10, 1, hair); Q(-6, hy + 3, 3 - k, 2, hair); Q(3 + k, hy + 3, 3 - k, 2, hair);
      Q(-4 + k, hy - 1, 5, 1, hairL); Q(-2 + k, hy + 3, 3, 1, hairD);
      if (k) Q(-6, hy + 3, 2, 3, hair); // 먼 쪽 옆머리
      if (st === 'spiky') { Q(-5, hy - 4, 2, 2, hair); Q(-1, hy - 5, 2, 3, hair); Q(3, hy - 4, 2, 2, hair); }
      if (st === 'side') { Q(-6, hy + 3, 6, 2, hair); }
      if (st === 'buzz') { Q(-6, hy + 3, 12, 2, skin); Q(-6, hy + 1, 12, 2, hair); Q(-6, hy + 3, 1, 1, hair); Q(5, hy + 3, 1, 1, hair); }
      if (st === 'long') { Q(-7, hy + 1, 2, 12, hair); Q(5, hy + 1, 2, 12, hair); Q(-7, hy + 12, 2, 1, hairD); Q(5, hy + 12, 2, 1, hairD); }
      if (st === 'bob') { Q(-7, hy + 1, 2, 9, hair); Q(5, hy + 1, 2, 9, hair); }
      if (st === 'pony') { Q(6, hy + 2, 2, 6, hair); Q(7, hy + 7, 1, 3, hairD); Q(-7, hy + 2, 1, 4, hair); }
      if (st === 'buns') { Q(-8, hy - 2, 4, 4, hair); Q(4, hy - 2, 4, 4, hair); Q(-7, hy - 2, 2, 1, hairL); Q(5, hy - 2, 2, 1, hairL); }
    } else if (pose === 'side') {
      Q(-6, hy - 1, 11, 4, hair); Q(-5, hy - 2, 9, 1, hair); Q(-6, hy + 3, 5, 5, hair); Q(-6, hy + 8, 3, 2, hair); Q(-2, hy - 1, 4, 1, hairL);
      Q(3, hy + 3, 3, 1, hair);
      if (st === 'spiky') { Q(-4, hy - 4, 2, 2, hair); Q(0, hy - 5, 2, 3, hair); }
      if (st === 'buzz') { Q(-6, hy + 3, 3, 4, hair); }
      if (st === 'long') { Q(-7, hy + 1, 4, 13, hair); Q(-7, hy + 13, 4, 1, hairD); }
      if (st === 'bob') { Q(-7, hy + 1, 4, 10, hair); }
      if (st === 'pony') { Q(-9, hy + 2, 3, 3, hair); Q(-10, hy + 4, 3, 6, hair); Q(-10, hy + 9, 2, 2, hairD); }
      if (st === 'buns') { Q(-7, hy - 3, 4, 4, hair); Q(-6, hy - 3, 2, 1, hairL); }
    } else {
      // 뒤·뒤 3/4: 머리 대부분이 머리카락
      const k = pose === 'bq' ? 1 : 0;
      Q(-6, hy - 1, 12, 11 - (st === 'buzz' ? 3 : 0), hair); Q(-5, hy - 2, 10, 1, hair); Q(-4, hy, 6, 1, hairL); Q(-6, hy + 9, 12, 1, hairD);
      if (st === 'spiky') { Q(-5, hy - 4, 2, 2, hair); Q(-1, hy - 5, 2, 3, hair); Q(3, hy - 4, 2, 2, hair); }
      if (st === 'long') { Q(-7, hy + 1, 14, 13, hair); Q(-7, hy + 13, 14, 1, hairD); Q(-1, hy + 3, 1, 10, hairD); }
      if (st === 'bob') { Q(-7, hy + 1, 14, 10, hair); Q(-7, hy + 10, 14, 1, hairD); }
      if (st === 'pony') { Q(-2, hy + 5, 4, 3, hairD); Q(-1, hy + 8, 3, 6, hair); Q(-1, hy + 13, 2, 1, hairD); }
      if (st === 'buns') { Q(-8, hy - 2, 4, 4, hair); Q(4, hy - 2, 4, 4, hair); }
      // 뒤 3/4: 머리 모양과 상관없이 보는 쪽 볼·귀 윤곽이 드러남 (머리카락 위에 그림), 먼 쪽은 머리카락 그늘
      if (k) { Q(-6, hy + 1, 2, 8, hairD); Q(4, hy + 3, 2, 7, skin); Q(6, hy + 5, 1, 4, skin); Q(4, hy + 4, 1, 3, skinD); Q(5, hy + 8, 1, 1, '#f09a8a'); Q(4, hy + 10, 2, 1, skinD); }
    }
    return { headTop: by + hy - 2 };
  }

  // ---------- 모자 ----------
  function hat(g, ox, top, id, dir) {
    const pose = POSE[dir], fl = FLIP[dir] ? -1 : 1;
    const P = (x, y, w, h, col) => R(g, fl > 0 ? ox + x : ox - x - w, top + y, w, h, col);
    const side = pose === 'side';
    switch (id) {
      case 'h_straw': P(-9, 2, 18, 2, '#e8c46a'); P(-9, 3, 18, 1, '#c99a3f'); P(-5, -2, 10, 4, '#f0d080'); P(-5, 1, 10, 1, '#c0392b'); break;
      case 'h_cap': P(-6, -1, 12, 4, '#2f6fd8'); P(-5, -2, 10, 1, '#2f6fd8'); P(-1, -1, 3, 2, '#fff');
        if (side) P(4, 2, 5, 1, '#1d4fa8'); else if (pose === 'front' || pose === 'fq') P(-5, 3, 10, 1, '#1d4fa8'); break;
      case 'h_beanie': P(-6, -1, 12, 5, '#e05d5d'); P(-6, 3, 12, 2, '#f2f2f2'); P(-1, -3, 2, 2, '#f2f2f2'); P(-4, 0, 1, 3, '#c04848'); P(1, 0, 1, 3, '#c04848'); break;
      case 'h_top': P(-8, 3, 16, 2, '#22232a'); P(-5, -7, 10, 10, '#2c2d36'); P(-5, 0, 10, 2, '#c0392b'); P(-4, -7, 2, 7, '#44465a'); break;
      case 'h_helmet': g.globalAlpha = 0.45; P(-8, -1, 16, 16, '#bfe6ff'); g.globalAlpha = 1; P(-8, 14, 16, 2, '#e8e8f0'); P(-6, 0, 3, 1, '#ffffff'); P(-7, 1, 1, 3, '#ffffff'); P(6, 3, 2, 8, '#a8c8e0'); break;
      case 'h_antenna': P(-4, -5, 1, 6, '#7a7a8a'); P(3, -5, 1, 6, '#7a7a8a'); P(-5, -7, 3, 3, '#7cff6a'); P(2, -7, 3, 3, '#7cff6a'); P(-4, -7, 1, 1, '#d8ffd0'); P(3, -7, 1, 1, '#d8ffd0'); break;
      case 'h_crown': P(-5, -1, 10, 4, '#f2c230'); P(-5, -3, 2, 2, '#f2c230'); P(-1, -4, 2, 3, '#f2c230'); P(3, -3, 2, 2, '#f2c230'); P(-5, 2, 10, 1, '#c99a1a'); P(-1, 0, 2, 2, '#e0304a'); P(-4, 0, 1, 1, '#3b78d8'); P(3, 0, 1, 1, '#3b78d8'); break;
    }
  }

  // ---------- 곡괭이 (키프레임) ----------
  // t: 0~1. 준비(머리 뒤로 들기) → 빠른 내려찍기 → 임팩트 홀드 → 회수. 옆·대각선은 머리 위 호, 앞·뒤는 수직 내려찍기.
  const ease = (a, b, t, f) => a + (b - a) * f(Math.max(0, Math.min(1, t)));
  const eOut = (t) => 1 - (1 - t) ** 3, eIn = (t) => t * t * t;
  // 각도: 0 = 앞(오른쪽), -90 = 위, 90 = 아래. 머리 위 뒤쪽(-125°)까지 들었다가 몸 앞 바닥(70°)을 내려찍음.
  function swingAngle(t) {
    if (t < 0.36) return ease(-20, -125, t / 0.36, eOut);       // 들어올리기 (예비동작)
    if (t < 0.48) return -125;                                   // 정점 홀드
    if (t < 0.6) return ease(-125, 70, (t - 0.48) / 0.12, eIn);  // 내려찍기 (가속)
    if (t < 0.78) return 70;                                     // 임팩트 홀드 (히트스톱)
    return ease(70, 10, (t - 0.78) / 0.22, eOut);                // 회수
  }
  const IMPACT_T = 0.6;
  // 손은 어깨를 중심으로 호를 그리고, 도구는 손에서 같은 각도로 뻗는다. 팔(소매)도 함께 그려 손과 몸이 끊기지 않게.
  function pickaxe(g, ox, oy, dir, t, behindPass, sleeve, tool) {
    const pose = POSE[dir], fl = FLIP[dir] ? -1 : 1, deg = swingAngle(t), a = (deg * Math.PI) / 180;
    let sx, sy, hx, hy, vx, vy, behind;
    if (pose === 'front' || pose === 'back') {
      // 정면·뒷면: 화면 깊이 방향 스윙 → 손이 머리 위에서 허리 앞으로 수직 이동
      const k = (deg + 125) / 195;                    // 0 = 머리 위, 1 = 바닥
      sx = 4; sy = -11;
      hx = 5 - k * 2; hy = -21 + k * 13;
      const ta = (-115 + k * 205) * Math.PI / 180;     // 도구: 위·뒤 → 아래(카메라 쪽)
      vx = Math.cos(ta) * 0.35; vy = Math.sin(ta);
      behind = pose === 'back' ? true : k < 0.5;
    } else {
      const squash = pose === 'side' ? 1 : 0.72;
      sx = 0; sy = -11;
      hx = sx + Math.cos(a) * 5 * squash; hy = sy + Math.sin(a) * 5;
      vx = Math.cos(a) * squash; vy = Math.sin(a);
      behind = pose === 'bq' || deg < -95;
    }
    if (behindPass !== behind) return;
    const X = (x) => (fl > 0 ? ox + x : ox - x - 1);
    const n = Math.hypot(vx, vy); vx /= n; vy /= n;
    // 팔
    const arm = sleeve || '#c8774a';
    for (let i = 0; i <= 5; i++) { const t2 = i / 5; R(g, X(sx + (hx - sx) * t2), oy + sy + (hy - sy) * t2, 2, 2, arm); }
    // 손잡이 (1px, 정수 스냅)
    const len = tool === 'sickle' ? 8 : 12;
    for (let i = 1; i <= len; i++) R(g, X(Math.round(hx + vx * i)), oy + Math.round(hy + vy * i), 1, 1, i < 3 ? '#a8784a' : '#8a5a32');
    const tx = hx + vx * len, ty = hy + vy * len, px = -vy, py = vx;
    if (tool === 'sickle') {
      // 낫: 손잡이 끝에서 앞쪽으로 휘어 나가는 초승달 날
      for (let i = 0; i <= 8; i++) {
        const a2 = (i / 8) * Math.PI * 0.9, qx = tx + vx * Math.sin(a2) * 4 + px * (1 - Math.cos(a2)) * 4.5, qy = ty + vy * Math.sin(a2) * 4 + py * (1 - Math.cos(a2)) * 4.5;
        R(g, X(Math.round(qx)), oy + Math.round(qy), 1, 1, i > 5 ? '#ffffff' : '#c8ccd8');
      }
      R(g, X(Math.round(hx)) - (fl < 0 ? 1 : 0), oy + Math.round(hy) - 1, 2, 2, '#f1bf96');
      return;
    }
    // 곡괭이 머리: 손잡이 끝에서 수직으로 양쪽 뾰족
    for (let i = -5; i <= 5; i++) {
      const bend = Math.abs(i) * 0.25;              // 양끝이 손 쪽으로 살짝 휨
      const qx = Math.round(tx + px * i - vx * bend), qy = Math.round(ty + py * i - vy * bend);
      R(g, X(qx), oy + qy, 1, 1, Math.abs(i) >= 4 ? '#e8ecf4' : '#9aa2b8');
      if (Math.abs(i) < 4) R(g, X(Math.round(qx + vx)), oy + Math.round(qy + vy), 1, 1, '#6a7088');
    }
    R(g, X(Math.round(hx)) - (fl < 0 ? 1 : 0), oy + Math.round(hy) - 1, 2, 2, '#f1bf96');
  }

  // ---------- 안경원숭이 (경주마) ----------
  // 옆모습(오른쪽 향함). pose 0 웅크림, 1 도약, 2 체공, 3 착지, 4 서 있기
  const TS = { fur: '#e9b277', furD: '#c98a4a', furL: '#f6d3a3', muz: '#fbe6c2', tuft: '#7a5a32', glass: '#1c140f', lens: '#fff7e6', eye: '#1c140f' };
  function tarsier(g, ox, oy, jersey, num, pose, blink) {
    const P = (x, y, w, h, c) => R(g, ox + x, oy + y, w, h, c);
    const jD = shade(jersey, 0.75);
    // 꼬리 (가늘고 긴 꼬리 + 끝 술)
    const tw = [0, -1, 1, 0, 0][pose];
    for (const [x, y] of [[-6, -6], [-7, -6], [-8, -6], [-9, -7], [-10, -8], [-11, -9], [-11, -10], [-12, -11], [-12, -12]]) P(x, y + (y < -8 ? tw : 0), 1, 1, TS.furD);
    P(-14, -16 + tw, 3, 4, TS.tuft); P(-13, -17 + tw, 2, 1, TS.tuft); P(-13, -15 + tw, 1, 2, shade(TS.tuft, 1.35));
    // 뒷다리
    if (pose === 0) { P(-4, -4, 5, 3, TS.furD); P(-3, -1, 5, 1, TS.fur); }
    else if (pose === 1) { P(-5, -4, 3, 2, TS.furD); P(-7, -2, 3, 2, TS.furD); P(-9, -1, 3, 1, TS.fur); }
    else if (pose === 2) { P(-4, -5, 4, 3, TS.furD); P(-2, -3, 3, 1, TS.fur); }
    else if (pose === 3) { P(-1, -4, 3, 3, TS.furD); P(1, -1, 4, 1, TS.fur); }
    else { P(-3, -4, 2, 4, TS.furD); P(0, -4, 2, 4, TS.furD); P(-4, -1, 3, 1, TS.fur); P(0, -1, 3, 1, TS.fur); }
    // 몸통 (저지)
    P(-5, -10, 9, 6, jersey); P(-5, -10, 2, 6, jD); P(-5, -5, 9, 1, jD);
    P(-2, -9, 5, 4, mix(jersey, '#ffffff', 0.75));
    text(g, num, ox - 1, oy - 9, '#1c140f');
    // 앞팔
    if (pose === 1 || pose === 2) { P(3, -9, 3, 2, TS.fur); P(6, -9, 1, 1, TS.furL); } else { P(3, -8, 2, 3, TS.fur); P(4, -5, 2, 1, TS.furL); }
    // 머리 (13x12)
    const hy = -22;
    P(-5, hy + 1, 13, 10, TS.fur); P(-4, hy, 11, 1, TS.fur); P(-4, hy + 11, 11, 1, TS.furD);
    P(-7, hy + 2, 4, 5, TS.fur); P(-6, hy + 3, 2, 3, TS.furD);                      // 귀
    P(-1, hy - 3, 3, 3, TS.tuft); P(0, hy - 4, 2, 1, TS.tuft); P(2, hy - 2, 3, 2, TS.tuft); P(-3, hy - 1, 3, 2, TS.tuft); // 앞머리 술
    P(0, hy + 7, 9, 5, TS.muz); P(1, hy + 11, 6, 1, shade(TS.muz, 0.85));          // 주둥이
    P(7, hy + 7, 2, 1, '#2a1d16'); P(4, hy + 9, 1, 2, '#2a1d16');
    // 안경 (큰 사각 뿔테)
    P(-1, hy + 2, 5, 6, TS.glass); P(5, hy + 2, 5, 6, TS.glass); P(4, hy + 4, 1, 1, TS.glass);
    P(0, hy + 3, 3, 4, TS.lens); P(6, hy + 3, 3, 4, TS.lens);
    if (blink) { P(0, hy + 5, 3, 1, TS.eye); P(6, hy + 5, 3, 1, TS.eye); }
    else { P(1, hy + 4, 2, 2, TS.eye); P(7, hy + 4, 2, 2, TS.eye); P(1, hy + 4, 1, 1, '#fff'); P(7, hy + 4, 1, 1, '#fff'); }
  }
  // 정면 (시상대·패독)
  function tarsierFront(g, ox, oy, jersey, num, happy) {
    const P = (x, y, w, h, c) => R(g, ox + x, oy + y, w, h, c);
    const jD = shade(jersey, 0.75);
    P(-4, -4, 3, 4, TS.furD); P(1, -4, 3, 4, TS.furD); P(-5, -1, 4, 1, TS.fur); P(1, -1, 4, 1, TS.fur);
    P(-6, -10, 12, 6, jersey); P(-6, -5, 12, 1, jD); P(-3, -9, 6, 4, mix(jersey, '#ffffff', 0.75)); text(g, num, ox - 1, oy - 9, '#1c140f');
    if (happy) { P(-9, -16, 3, 7, TS.fur); P(6, -16, 3, 7, TS.fur); } else { P(-8, -9, 2, 4, TS.fur); P(6, -9, 2, 4, TS.fur); }
    const hy = -23;
    P(-7, hy + 1, 14, 11, TS.fur); P(-6, hy, 12, 1, TS.fur); P(-6, hy + 12, 12, 1, TS.furD);
    P(-10, hy + 3, 4, 5, TS.fur); P(6, hy + 3, 4, 5, TS.fur); P(-9, hy + 4, 2, 3, TS.furD); P(7, hy + 4, 2, 3, TS.furD);
    P(-1, hy - 3, 3, 3, TS.tuft); P(0, hy - 4, 2, 1, TS.tuft); P(-4, hy - 1, 8, 2, TS.tuft);
    P(-5, hy + 8, 10, 5, TS.muz); P(0, hy + 9, 1, 3, '#2a1d16');
    P(-7, hy + 3, 6, 6, TS.glass); P(1, hy + 3, 6, 6, TS.glass); P(-1, hy + 5, 2, 1, TS.glass);
    P(-6, hy + 4, 4, 4, TS.lens); P(2, hy + 4, 4, 4, TS.lens);
    if (happy) { P(-5, hy + 6, 2, 1, TS.eye); P(3, hy + 6, 2, 1, TS.eye); P(-6, hy + 5, 1, 1, TS.eye); P(5, hy + 5, 1, 1, TS.eye); }
    else { P(-5, hy + 5, 2, 2, TS.eye); P(3, hy + 5, 2, 2, TS.eye); P(-5, hy + 5, 1, 1, '#fff'); P(3, hy + 5, 1, 1, '#fff'); }
  }

  // ---------- 탈것 ----------
  // back: 사람 뒤에 그릴 부분, front: 사람 앞에 그릴 부분. 반환값 lift = 사람을 들어 올릴 높이
  const RIDE = {
    r_board: { lift: 4, seated: false },
    r_rover: { lift: 7, seated: true },
    r_cricket: { lift: 9, seated: true },
    r_ufo: { lift: 10, seated: true }
  };
  function ride(g, ox, oy, id, dir, t, part) {
    const fl = FLIP[dir] ? -1 : 1, side = POSE[dir] === 'side' || POSE[dir] === 'fq' || POSE[dir] === 'bq';
    const P = (x, y, w, h, c) => R(g, fl > 0 ? ox + x : ox - x - w, oy + y, w, h, c);
    if (id === 'r_board') {
      if (part !== 'back') return;
      const glow = (Math.floor(t * 8) % 2) ? '#7cf0ff' : '#40c8f0';
      P(-9, -3, 18, 3, '#3a3f58'); P(-9, -3, 18, 1, '#6a7090'); P(-7, 0, 4, 1, glow); P(3, 0, 4, 1, glow);
    } else if (id === 'r_rover') {
      if (part === 'back') { P(-10, -12, 20, 9, '#c8c8d0'); P(-10, -12, 20, 2, '#e8e8f0'); P(side ? -9 : -2, -18, 1, 6, '#888'); P(side ? -11 : -4, -20, 5, 3, '#e0e0e8'); }
      else { P(-11, -6, 22, 5, '#d8d8e0'); P(-11, -6, 22, 1, '#ffffff'); P(-9, -2, 5, 4, '#2a2a33'); P(4, -2, 5, 4, '#2a2a33'); P(-8, -1, 2, 2, '#666'); P(5, -1, 2, 2, '#666'); if (side) P(9, -5, 2, 2, '#ffe070'); }
    } else if (id === 'r_cricket') {
      const hop = Math.floor(t * 6) % 2;
      if (part === 'back') {
        P(-11, -10, 20, 7, '#4caf50'); P(-11, -10, 20, 2, '#7ed36a'); P(-12, -8, 3, 4, '#3d8f40');
        if (side) { P(8, -12, 6, 6, '#5cbf5a'); P(11, -11, 2, 2, '#1c140f'); P(12, -18, 1, 6, '#3d8f40'); P(13, -21, 1, 3, '#3d8f40'); }
        else { P(-3, -14, 6, 5, '#5cbf5a'); P(-2, -13, 1, 1, '#1c140f'); P(1, -13, 1, 1, '#1c140f'); }
      } else {
        P(-12, -4 - hop, 3, 4 + hop, '#3d8f40'); P(-14, -1, 4, 1, '#2f7a33'); P(5, -4, 2, 4, '#3d8f40'); P(-4, -4, 2, 4, '#3d8f40');
        P(-6, -9, 10, 2, '#8a5a32');
      }
    } else if (id === 'r_ufo') {
      const lights = Math.floor(t * 6) % 3;
      if (part === 'back') { g.globalAlpha = 0.28; g.fillStyle = '#bfe6ff'; g.beginPath(); g.ellipse(ox, oy - 8, 10, 14, 0, Math.PI, 0); g.fill(); g.globalAlpha = 1; }
      else {
        g.globalAlpha = 0.55; R(g, ox - 9, oy - 22, 2, 5, '#ffffff'); g.globalAlpha = 1;
        P(-14, -7, 28, 5, '#e8b830'); P(-12, -8, 24, 1, '#f6d060'); P(-10, -2, 20, 2, '#b88a20');
        for (let i = 0; i < 4; i++) P(-11 + i * 7, -5, 2, 2, i % 3 === lights ? '#ff5a5a' : '#fff4b0');
        g.globalAlpha = 0.25; P(-6, 0, 12, 4, '#a0ffb0'); g.globalAlpha = 1;
      }
    }
  }

  // ---------- 펫 ----------
  function pet(g, ox, oy, id, t, faceRight) {
    const fl = faceRight ? 1 : -1, P = (x, y, w, h, c) => R(g, fl > 0 ? ox + x : ox - x - w, oy + y, w, h, c);
    if (id === 'p_tars') {
      const hop = Math.max(0, Math.sin(t * 8)) * 2 | 0;
      P(-6, -6 - hop, 1, 1, TS.furD); P(-7, -7 - hop, 1, 2, TS.furD); P(-8, -9 - hop, 2, 2, TS.tuft);
      P(-3, -5 - hop, 6, 4, '#9c4fd8'); P(-2, -1 - hop, 2, 1, TS.furD); P(1, -1 - hop, 2, 1, TS.furD);
      P(-4, -12 - hop, 9, 8, TS.fur); P(-5, -11 - hop, 2, 3, TS.fur); P(-1, -14 - hop, 2, 2, TS.tuft);
      P(-1, -10 - hop, 3, 3, TS.glass); P(3, -10 - hop, 3, 3, TS.glass); P(0, -9 - hop, 1, 1, TS.lens); P(4, -9 - hop, 1, 1, TS.lens);
      P(0, -7 - hop, 5, 3, TS.muz);
      R(g, ox - 3, oy - 1, 7, 1, 'rgba(0,0,0,0.18)');
    } else if (id === 'p_drone') {
      const b = Math.round(Math.sin(t * 4) * 1.5), sp = Math.floor(t * 20) % 2;
      P(-5, -16 + b, 10, 4, '#5a6078'); P(-4, -16 + b, 8, 1, '#8890b0'); P(-1, -13 + b, 2, 2, Math.floor(t * 3) % 2 ? '#ff4040' : '#600');
      P(-7 + sp, -18 + b, 4, 1, '#c8ccd8'); P(4 - sp, -18 + b, 4, 1, '#c8ccd8'); P(-5, -17 + b, 1, 1, '#333'); P(4, -17 + b, 1, 1, '#333');
      R(g, ox - 3, oy - 1, 6, 2, 'rgba(0,0,0,0.18)');
    } else if (id === 'p_cricket') {
      const hop = Math.max(0, Math.sin(t * 7)) * 3 | 0;
      P(-4, -4 - hop, 7, 3, '#4caf50'); P(2, -5 - hop, 3, 3, '#5cbf5a'); P(3, -4 - hop, 1, 1, '#1c140f'); P(4, -8 - hop, 1, 3, '#3d8f40');
      P(-4, -1 - hop, 2, 1, '#3d8f40'); P(0, -1 - hop, 2, 1, '#3d8f40');
    }
  }

  // ---------- NPC ----------
  function npc(g, ox, oy, id, t) {
    const P = (x, y, w, h, c) => R(g, ox + x, oy + y, w, h, c);
    const blink = Math.floor(t * 0.7) % 7 === 0;
    if (id === 'bookie') {
      const b = Math.round(Math.sin(t * 2)) ;
      P(-6, -10, 12, 9, '#7a8098'); P(-6, -10, 12, 1, '#a0a8c0'); P(-2, -2, 4, 2, '#4a5068');
      P(-7, -24 + b, 14, 13, '#c8ccd8'); P(-7, -24 + b, 14, 2, '#e8ecf4'); P(-5, -21 + b, 10, 6, '#1c2a3a');
      P(-4, -19 + b, 3, 2, blink ? '#1c2a3a' : '#40e0ff'); P(1, -19 + b, 3, 2, blink ? '#1c2a3a' : '#40e0ff'); P(-2, -14 + b, 4, 1, '#8890a8');
      P(-1, -28 + b, 2, 4, '#7a8098'); P(-2, -30 + b, 4, 2, Math.floor(t * 2) % 2 ? '#ff5050' : '#ffd040');
      P(-10, -12, 3, 6, '#a0a8c0'); P(7, -16 + (Math.floor(t * 1.5) % 2) * 2, 3, 6, '#a0a8c0');
    } else if (id === 'shop') {
      const b = Math.round(Math.sin(t * 2.4));
      P(-4, -3, 3, 3, '#3d8f40'); P(1, -3, 3, 3, '#3d8f40');
      P(-6, -12, 12, 9, '#c06030'); P(-6, -12, 12, 1, '#e08050'); P(-1, -11, 2, 8, '#f0d080');
      P(-7, -24 + b, 14, 12, '#7ed36a'); P(-6, -25 + b, 12, 1, '#7ed36a'); P(-7, -14 + b, 14, 2, '#5cbf5a');
      P(-5, -21 + b, 4, 5, '#1c140f'); P(1, -21 + b, 4, 5, '#1c140f'); if (!blink) { P(-4, -20 + b, 1, 2, '#fff'); P(2, -20 + b, 1, 2, '#fff'); }
      P(-2, -15 + b, 4, 1, '#2f7a33'); P(-4, -29 + b, 1, 4, '#5cbf5a'); P(3, -29 + b, 1, 4, '#5cbf5a'); P(-5, -31 + b, 3, 2, '#ffe070'); P(2, -31 + b, 3, 2, '#ffe070');
    } else if (id === 'farmer') {
      const b = Math.round(Math.sin(t * 1.6));
      // 몸통(작업복) · 다리
      P(-4, -3, 3, 3, '#4a3a2a'); P(1, -3, 3, 3, '#4a3a2a');
      P(-5, -11, 10, 9, '#3f7a4a'); P(-5, -11, 10, 1, '#5a9a62'); P(-3, -10, 1, 6, '#2a5a34'); P(2, -10, 1, 6, '#2a5a34');
      // 로봇 머리: 둥근 금속 + 초록 눈
      P(-5, -20 + b, 10, 9, '#c8ccd8'); P(-5, -20 + b, 10, 1, '#e8ecf4'); P(-3, -17 + b, 6, 3, '#1c2a3a');
      P(-2, -16 + b, 1, 1, blink ? '#1c2a3a' : '#7cff6a'); P(1, -16 + b, 1, 1, blink ? '#1c2a3a' : '#7cff6a');
      // 밀짚모자
      P(-9, -21 + b, 18, 2, '#e8c46a'); P(-9, -20 + b, 18, 1, '#c99a3f'); P(-5, -25 + b, 10, 4, '#f0d080'); P(-5, -22 + b, 10, 1, '#c0392b');
      // 볏단 바구니
      P(5, -9, 6, 6, '#a8784a'); P(5, -9, 6, 1, '#c8986a'); P(6, -13, 1, 4, '#e8c860'); P(8, -14, 1, 5, '#f0d070'); P(10, -12, 1, 3, '#e8c860');
    }
  }

  // ---------- 정적 소품 (외곽선 적용해 캐시) ----------
  function prop(id) {
    let c, g;
    switch (id) {
      case 'dome': {
        [c, g] = mk(84, 52);
        g.fillStyle = '#d8dce8'; g.beginPath(); g.ellipse(42, 48, 40, 44, 0, Math.PI, 0); g.fill();
        g.fillStyle = 'rgba(150,210,255,0.55)'; g.beginPath(); g.ellipse(42, 48, 36, 40, 0, Math.PI, 0); g.fill();
        g.fillStyle = '#c8ccd8'; for (let i = 1; i < 5; i++) g.fillRect(6 + i * 15, 10, 1, 38);
        g.fillRect(4, 30, 76, 1); g.fillRect(14, 18, 56, 1);
        R(g, 18, 14, 4, 10, 'rgba(255,255,255,0.7)'); R(g, 16, 22, 3, 6, 'rgba(255,255,255,0.5)');
        R(g, 30, 34, 10, 8, '#4caf50'); R(g, 44, 36, 8, 6, '#5cbf5a'); R(g, 34, 30, 4, 4, '#7ed36a');
        R(g, 2, 46, 80, 6, '#8890a8'); R(g, 2, 46, 80, 1, '#b0b8d0'); R(g, 36, 38, 12, 14, '#5a6078'); R(g, 37, 40, 10, 12, '#3a4058');
        break;
      }
      case 'rocket': {
        [c, g] = mk(26, 72);
        R(g, 8, 6, 10, 52, '#eeeef4'); R(g, 8, 6, 3, 52, '#c8c8d4'); R(g, 10, 2, 6, 4, '#eeeef4'); R(g, 12, 0, 2, 2, '#d94a3a');
        R(g, 9, 4, 8, 3, '#d94a3a'); R(g, 10, 18, 6, 6, '#3b78d8'); R(g, 11, 19, 3, 3, '#a0d8ff');
        R(g, 2, 46, 6, 14, '#d94a3a'); R(g, 18, 46, 6, 14, '#d94a3a'); R(g, 8, 58, 10, 4, '#5a6078'); text(g, 'MD', 9, 30, '#d94a3a');
        R(g, 0, 62, 26, 10, '#8890a8'); R(g, 0, 62, 26, 1, '#b0b8d0');
        break;
      }
      case 'shop': {
        [c, g] = mk(96, 72);
        g.fillStyle = '#e0a060'; g.beginPath(); g.ellipse(48, 46, 44, 38, 0, Math.PI, 0); g.fill();
        g.fillStyle = '#f0b878'; g.beginPath(); g.ellipse(44, 46, 30, 30, 0, Math.PI, 0); g.fill();
        R(g, 4, 44, 88, 22, '#c88850'); R(g, 4, 44, 88, 2, '#e8b070');
        for (let i = 0; i < 8; i++) R(g, 6 + i * 11, 30, 11, 8, i % 2 ? '#f2f2f2' : '#3b78d8');
        R(g, 6, 38, 88, 2, '#2a5aa8');
        R(g, 38, 50, 20, 16, '#5a3420'); R(g, 40, 52, 16, 14, '#7a4a2a'); R(g, 53, 58, 2, 2, '#f2c230');
        R(g, 10, 50, 20, 10, '#a0d8ff'); R(g, 66, 50, 20, 10, '#a0d8ff'); R(g, 11, 51, 6, 3, '#fff'); R(g, 67, 51, 6, 3, '#fff');
        R(g, 28, 12, 40, 12, '#3a2a22'); text(g, 'SHOP', 40, 16, '#f2c230');
        R(g, 0, 66, 96, 6, '#8a6a4a');
        break;
      }
      case 'booth': {
        [c, g] = mk(80, 56);
        for (let i = 0; i < 8; i++) R(g, i * 10, 8, 10, 8, i % 2 ? '#f2f2f2' : '#d94a3a');
        R(g, 0, 16, 80, 2, '#a83228'); R(g, 4, 18, 2, 30, '#8a6a4a'); R(g, 74, 18, 2, 30, '#8a6a4a');
        R(g, 20, 0, 40, 8, '#1c1c24'); text(g, 'BET', 34, 2, '#ffd040');
        R(g, 2, 34, 76, 16, '#9a6a3f'); R(g, 2, 34, 76, 2, '#c08a55'); R(g, 2, 48, 76, 2, '#6a4422');
        R(g, 10, 38, 18, 8, '#1c1c24'); text(g, 'WIN', 12, 40, '#40ff80'); R(g, 52, 38, 18, 8, '#1c1c24'); text(g, 'ODD', 54, 40, '#ffd040');
        R(g, 0, 50, 80, 6, '#6a4a3a');
        break;
      }
      case 'stands': {
        [c, g] = mk(240, 34);
        for (let r = 0; r < 4; r++) { R(g, 0, r * 7, 240, 7, r % 2 ? '#8890a8' : '#9aa2b8'); R(g, 0, r * 7, 240, 1, '#c0c6d6'); }
        R(g, 0, 28, 240, 6, '#5a6078');
        for (let x = 0; x < 240; x += 40) R(g, x, 0, 2, 28, '#6a7088');
        break;
      }
      case 'jailSign': {
        // 감옥 간판: 기둥 두 개에 매단 빨간 JAIL 판
        [c, g] = mk(40, 22);
        R(g, 4, 8, 2, 14, '#3a3e50'); R(g, 34, 8, 2, 14, '#3a3e50');
        R(g, 0, 0, 40, 11, '#8a2a20'); R(g, 1, 1, 38, 9, '#d94a3a'); R(g, 1, 1, 38, 1, '#ff7a6a');
        text(g, 'JAIL', 12, 3, '#ffffff');
        break;
      }
      case 'dish': {
        [c, g] = mk(30, 36);
        R(g, 13, 16, 4, 18, '#8890a8'); R(g, 8, 32, 14, 4, '#5a6078');
        g.fillStyle = '#e8e8f0'; g.beginPath(); g.ellipse(15, 12, 13, 9, -0.4, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#c8ccd8'; g.beginPath(); g.ellipse(16, 13, 9, 6, -0.4, 0, Math.PI * 2); g.fill(); R(g, 15, 10, 2, 2, '#d94a3a');
        break;
      }
      case 'solar': {
        [c, g] = mk(34, 22);
        R(g, 15, 12, 4, 10, '#8890a8'); R(g, 0, 0, 34, 13, '#1d3f8a'); for (let x = 0; x < 34; x += 6) R(g, x, 0, 1, 13, '#4a7ad8'); R(g, 0, 6, 34, 1, '#4a7ad8'); R(g, 0, 0, 34, 1, '#7aa8ff');
        break;
      }
      case 'jumbo': {
        [c, g] = mk(128, 54);
        R(g, 20, 40, 4, 14, '#5a6078'); R(g, 104, 40, 4, 14, '#5a6078');
        R(g, 0, 0, 128, 42, '#2a2d38'); R(g, 0, 0, 128, 2, '#4a4f60'); R(g, 3, 3, 122, 36, '#08090c');
        break;
      }
      case 'flag': {
        [c, g] = mk(14, 30); R(g, 0, 0, 2, 30, '#c8ccd8'); R(g, 2, 1, 11, 7, '#d94a3a'); R(g, 2, 4, 11, 2, '#f2f2f2');
        break;
      }
      case 'finish': {
        [c, g] = mk(6, 34); R(g, 2, 6, 2, 28, '#e8e8f0'); R(g, 0, 0, 6, 8, '#1c1c24'); R(g, 1, 1, 2, 2, '#fff'); R(g, 3, 3, 2, 2, '#fff'); R(g, 1, 5, 2, 2, '#fff');
        break;
      }
      default: {
        // 바위: rock0~2 (크기), ore 광석
        const big = id === 'rock2', ore = id.startsWith('ore');
        [c, g] = mk(big ? 30 : 20, big ? 22 : 16);
        const w = c.width, h = c.height, base = ore ? '#8a6a58' : '#a0523a', dark = ore ? '#5e4a40' : '#7a3a28', lite = ore ? '#b0927e' : '#c06a4a';
        g.fillStyle = base; g.beginPath(); g.ellipse(w / 2, h * 0.62, w / 2 - 1, h * 0.38, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = lite; g.beginPath(); g.ellipse(w / 2 - 2, h * 0.5, w / 2 - 4, h * 0.25, 0, Math.PI, 0); g.fill();
        R(g, 2, h - 3, w - 4, 2, dark);
        if (ore) { const gem = id === 'ore2' ? ['#7cf0ff', '#d0faff'] : id === 'ore1' ? ['#f2c230', '#fff0a0'] : ['#c0c6d6', '#ffffff']; R(g, 5, 6, 3, 3, gem[0]); R(g, 11, 4, 2, 2, gem[0]); R(g, 13, 8, 3, 3, gem[0]); R(g, 5, 6, 1, 1, gem[1]); R(g, 13, 8, 1, 1, gem[1]); }
      }
    }
    return outline(c);
  }

  // ---------- 감정표현 아이콘 ----------
  function emoteIcon(id) {
    const [c, g] = mk(16, 16);
    const face = (bg) => { g.fillStyle = bg; g.beginPath(); g.arc(8, 8, 7, 0, Math.PI * 2); g.fill(); };
    if (id === 'cheer') { face('#f2c230'); R(g, 4, 5, 2, 2, '#2a1d16'); R(g, 10, 5, 2, 2, '#2a1d16'); R(g, 4, 9, 8, 3, '#7a2a12'); R(g, 5, 9, 6, 1, '#fff'); }
    if (id === 'cry') { face('#8ac0f0'); R(g, 4, 6, 3, 1, '#2a1d16'); R(g, 9, 6, 3, 1, '#2a1d16'); R(g, 4, 7, 1, 5, '#3b78d8'); R(g, 11, 7, 1, 5, '#3b78d8'); R(g, 6, 11, 4, 1, '#2a1d16'); }
    if (id === 'love') { R(g, 2, 3, 5, 5, '#e0304a'); R(g, 9, 3, 5, 5, '#e0304a'); R(g, 1, 4, 14, 5, '#e0304a'); R(g, 3, 9, 10, 2, '#e0304a'); R(g, 5, 11, 6, 2, '#e0304a'); R(g, 7, 13, 2, 1, '#e0304a'); R(g, 3, 4, 2, 2, '#ff9aa8'); }
    if (id === 'shock') { face('#f2c230'); R(g, 4, 4, 3, 3, '#fff'); R(g, 9, 4, 3, 3, '#fff'); R(g, 5, 5, 1, 1, '#2a1d16'); R(g, 10, 5, 1, 1, '#2a1d16'); R(g, 6, 9, 4, 4, '#2a1d16'); }
    return outline(c);
  }

  // ---------- 타이틀 로고: '화성간건호' ----------
  // 표지 스티커 스타일(남색+분홍 글자, 두꺼운 흰 테두리, 살짝 기울임)을 픽셀아트로 옮김.
  // 글자는 갈무리 비트맵 글꼴을 원래 크기로 그린 뒤 알파를 0/1로 자르고 굵게(오른쪽 1px) 만든다.
  function crispText(s, px, col, k = 1) {
    const [m, mg] = mk(px * s.length + 8, px * 2);
    mg.font = `bold ${px}px Galmuri11, monospace`; mg.textBaseline = 'top'; mg.fillStyle = '#fff'; mg.fillText(s, 2, Math.round(px / 3));
    const d = mg.getImageData(0, 0, m.width, m.height).data, on = (x, y) => d[(y * m.width + x) * 4 + 3] > 110;
    // 실제 잉크 영역만 잘라냄 (위·아래 여백과 잘림 방지)
    let x0 = m.width, x1 = -1, y0 = m.height, y1 = -1;
    for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (on(x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const [c, g] = mk((x1 - x0 + 1) * k, (y1 - y0 + 1) * k);
    g.fillStyle = col;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (on(x, y)) g.fillRect((x - x0) * k, (y - y0) * k, k, k);
    c.top = (y0 - Math.round(px / 3)) * k;
    return c;
  }
  // 캨버스 알파 실루엣을 r픽셀 두께로 키운 테두리(단색)
  function rim(src, r, col) {
    const [c, g] = mk(src.width + r * 2, src.height + r * 2), d = src.getContext('2d').getImageData(0, 0, src.width, src.height).data;
    g.fillStyle = col;
    for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) if (d[(y * src.width + x) * 4 + 3] > 0)
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r) g.fillRect(x + r + dx, y + r + dy, 1, 1);
    return c;
  }
  // 모자 쓴 원숭이 마스코트 (표지 캐릭터 참고, 26x24)
  function logoMascot() {
    const [c, g] = mk(28, 26), P = (x, y, w, h, col) => R(g, x, y, w, h, col);
    // 귀
    P(2, 12, 5, 6, '#a0652e'); P(3, 13, 3, 4, '#f2c9a0'); P(21, 12, 5, 6, '#a0652e'); P(22, 13, 3, 4, '#f2c9a0');
    // 머리
    P(6, 8, 16, 14, '#a0652e'); P(5, 10, 18, 10, '#a0652e'); P(7, 21, 14, 2, '#8a5424');
    // 얼굴
    P(8, 12, 12, 9, '#f2c9a0'); P(7, 14, 14, 6, '#f2c9a0'); P(9, 21, 10, 1, '#f2c9a0');
    // 눈 (반짝이는 큰 눈)
    P(9, 14, 3, 4, '#1c2a5e'); P(16, 14, 3, 4, '#1c2a5e'); P(9, 14, 1, 1, '#fff'); P(16, 14, 1, 1, '#fff'); P(11, 17, 1, 1, '#6a8ae8'); P(18, 17, 1, 1, '#6a8ae8');
    // 볼·입
    P(7, 18, 2, 2, '#ff8aa8'); P(19, 18, 2, 2, '#ff8aa8'); P(13, 19, 2, 2, '#d23a5a'); P(13, 19, 2, 1, '#7a1a2a');
    // 버킷햇
    P(8, 3, 12, 6, '#2f5fd8'); P(9, 2, 10, 1, '#2f5fd8'); P(3, 8, 22, 3, '#2a4fb8'); P(2, 10, 24, 1, '#1e3c96');
    P(10, 3, 3, 1, '#7aa2ff'); P(8, 7, 12, 1, '#1e3c96');
    return outline(c, 0.45);
  }
  function logo() {
    const NAVY = '#1c2a5e', PINK = '#ff5c8a';
    const PX = 12, a = crispText('화성간', PX, NAVY, 2), b = crispText('건호', PX, PINK, 2), q = crispText('?', PX, NAVY, 2);
    const sp = 3, tw = a.width + b.width + q.width + sp * 2, th = Math.max(a.height, b.height) + 2;
    const [word, wg] = mk(tw, th);
    // 표지처럼 묶음마다 살짝 오르내리는 바운스 (기준선은 글꼴 top 보정값)
    wg.drawImage(a, 0, 1 + a.top - Math.min(a.top, b.top)); wg.drawImage(b, a.width + sp, b.top - Math.min(a.top, b.top));
    wg.drawImage(q, a.width + b.width + sp * 2, th - q.height);
    // 획마다 아래쪽 가장자리 1px만 어둡게 (볼록한 두께감, 획이 뭉개지지 않게)
    const wd = wg.getImageData(0, 0, tw, th), pd = wd.data, A_ = (x, y) => (y < th ? pd[(y * tw + x) * 4 + 3] : 0);
    const sh = []; for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) if (A_(x, y) && !A_(x, y + 1)) sh.push(x, y);
    for (let i = 0; i < sh.length; i += 2) { const k = (sh[i + 1] * tw + sh[i]) * 4; pd[k] *= 0.62; pd[k + 1] *= 0.62; pd[k + 2] *= 0.7; }
    wg.putImageData(wd, 0, 0);
    const white = rim(word, 3, '#ffffff'), edge = rim(white, 1, '#14204a');
    const W = edge.width + 6, H = edge.height + 26;
    const [c, g] = mk(W, H);
    const ox = Math.round(W / 2), ty = H - edge.height - 3;
    // 뒷배경: 고리 달린 화성 (왼쪽), 별 반짝임
    const [pl, pg] = mk(34, 22), pcx = 17, pcy = 11;
    pg.fillStyle = '#c4532e'; pg.beginPath(); pg.arc(pcx, pcy, 9, 0, Math.PI * 2); pg.fill();
    pg.fillStyle = '#e8743a'; pg.beginPath(); pg.arc(pcx - 1, pcy - 1, 7.5, 0, Math.PI * 2); pg.fill();
    pg.fillStyle = '#f59a62'; pg.beginPath(); pg.arc(pcx - 3, pcy - 3, 4, 0, Math.PI * 2); pg.fill();
    R(pg, pcx - 5, pcy + 1, 3, 2, '#b04a26'); R(pg, pcx + 3, pcy - 4, 2, 2, '#b04a26'); R(pg, pcx + 1, pcy + 4, 3, 2, '#b04a26');
    const crisp = (src) => { const x = src.getContext('2d'), d = x.getImageData(0, 0, src.width, src.height); for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] > 100 ? 255 : 0; x.putImageData(d, 0, 0); return src; };
    crisp(pl);
    // 고리: 뒷부분은 행성 뒤로 숨기고 앞부분만 그린다
    R(pg, 1, pcy + 1, 32, 1, '#ffd8a8'); R(pg, 0, pcy + 2, 4, 1, '#ffd8a8'); R(pg, 30, pcy, 4, 1, '#ffd8a8');
    g.drawImage(outline(pl, 0.45), 4, 4);
    const star = (x, y, col) => { R(g, x, y - 1, 1, 3, col); R(g, x - 1, y, 3, 1, col); };
    star(46, 4, '#fff6c0'); star(W - 8, 9, '#fff6c0'); R(g, W - 22, 3, 1, 1, '#fff6c0'); R(g, 40, 14, 1, 1, '#fff6c0');
    // 물음표 (파랑·분홍) — 마스코트 양옆
    const qm = (x, y, col) => { const [q, qg] = mk(8, 12); const P = (a, b, w, h) => R(qg, a, b, w, h, col); P(2, 1, 4, 1); P(1, 2, 2, 2); P(5, 2, 2, 2); P(4, 4, 2, 1); P(3, 5, 2, 2); P(3, 8, 2, 2); g.drawImage(outline(q, 0.45), x, y); };
    qm(ox - 27, 6, '#2f5fd8'); qm(ox + 17, 2, '#ff5c8a');
    // 마스코트: 턱이 글자 뒤로 들어가 스티커 위로 고개를 내민 모습
    g.drawImage(logoMascot(), ox - 14, ty - 24);
    // 글자: 그림자 → 남색 외곽 → 흰 테두리 → 본문
    g.globalAlpha = 0.4; g.drawImage(rim(edge, 0, '#000'), 3, ty + 3); g.globalAlpha = 1;
    g.drawImage(edge, 3, ty); g.drawImage(white, 4, ty + 1); g.drawImage(word, 7, ty + 4);
    // 앞발: 스티커 가장자리를 잡고 있음
    for (const hx of [ox - 10, ox + 5]) { R(g, hx - 1, ty, 7, 5, '#5a3418'); R(g, hx, ty + 1, 5, 3, '#a0652e'); R(g, hx + 1, ty + 1, 3, 1, '#c08850'); R(g, hx + 1, ty + 3, 1, 1, '#5a3418'); R(g, hx + 3, ty + 3, 1, 1, '#5a3418'); }
    return c;
  }

  // 벼 한 포기 (16x20, 발 기준 (8,18)). stage 0=그루터기 1=새싹 2=푸른 벼 3=익은 벼(황금 이삭), sway=-1..1
  function rice(stage, sway) {
    const [c, g] = mk(16, 20), P = (x, y, w, h, col) => R(g, x, y, w, h, col);
    P(3, 17, 10, 2, '#5a3a22');
    if (stage === 0) { for (const x of [5, 7, 9, 11]) P(x, 15, 1, 2, '#b89a5a'); return outline(c, 0.4); }
    const hgt = stage === 1 ? 6 : 12, leaf = stage === 3 ? '#8aa83a' : '#4f9a3a', dark = stage === 3 ? '#6a8a2a' : '#3a7a2a';
    for (const [x, dx] of [[5, -1], [7, 0], [9, 0], [11, 1]]) for (let i = 0; i < hgt; i++) {
      const k = i / hgt, xx = Math.round(x + dx * k * 2 + sway * k * k * 2);
      P(xx, 16 - i, 1, 1, i % 3 ? leaf : dark);
    }
    if (stage === 3) for (const [x, dx] of [[7, 0], [9, 0], [5, -1], [11, 1]]) {
      const tx = Math.round(x + dx * 2 + sway * 2), ty = 4;
      P(tx, ty, 2, 2, '#f2c84a'); P(tx + (dx || 1), ty + 2, 2, 2, '#e8b830'); P(tx + (dx || 1) * 2, ty + 4, 1, 2, '#c99a1a'); P(tx, ty, 1, 1, '#fff0a0');
    }
    return outline(c, 0.4);
  }

  // ---------- 울타리 조각 ----------
  // 바닥의 두 점 (x0,y0)→(x1,y1) 사이 울타리를 그린 캔버스와 왼쪽 위 좌표. 조각마다 따로 y정렬해서 앞뒤가 맞는다.
  // style 'rail': 경마장 흰 나무 난간 (기둥 + 가로대 두 줄) / 'iron': 감옥 쇠창살 (촘촘한 세로 창살 + 위·가운데 철골)
  // first: 이 조각 시작점에 기둥을 세울지 (이어지는 조각끼리 기둥이 겹치지 않게)
  function fenceSeg(x0, y0, x1, y1, style, first, gate) {
    const H = style === 'rail' ? 9 : style === 'ironF' ? 18 : 24, pad = 3;
    const minX = Math.floor(Math.min(x0, x1)) - pad, maxX = Math.ceil(Math.max(x0, x1)) + pad;
    const minY = Math.floor(Math.min(y0, y1)) - H - pad, maxY = Math.ceil(Math.max(y0, y1)) + pad;
    const [c, g] = mk(maxX - minX + 1, maxY - minY + 1);
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0))), at = (t) => [Math.round(x0 + (x1 - x0) * t) - minX, Math.round(y0 + (y1 - y0) * t) - minY];
    const line = (h, col) => { for (let i = 0; i <= n; i++) { const [x, y] = at(i / n); R(g, x, y - h, 1, 1, col); } };
    if (style === 'rail') {
      line(-1, 'rgba(60,20,10,.35)');                               // 바닥 그림자
      line(H, '#f4f2ec'); line(H - 1, '#b8b0a4'); line(4, '#e8e4dc'); line(3, '#a8a094'); // 가로대 두 줄
      const post = (t) => { const [x, y] = at(t); R(g, x - 1, y - H - 1, 3, H + 2, '#6a5a50'); R(g, x, y - H, 1, H + 1, '#ffffff'); R(g, x + 1, y - H, 1, H + 1, '#cfc8bc'); R(g, x - 1, y, 3, 1, 'rgba(60,20,10,.4)'); };
      if (first) post(0); post(1);
    } else {
      line(-1, 'rgba(20,10,10,.4)');
      // 세로 창살 3px 간격: 어두운 테두리 + 밝은 면
      for (let i = 0; i <= n; i += 3) { const [x, y] = at(i / n); R(g, x, y - H, 1, H + 1, gate ? '#7a6a3a' : '#7a82a0'); R(g, x, y - H, 1, 1, '#d8dce8'); }
      for (let i = 1; i <= n; i += 3) { const [x, y] = at(i / n); R(g, x, y - H, 1, H + 1, 'rgba(30,32,44,.55)'); }
      line(H, '#4a4e62'); line(H - 1, '#9aa2b8'); line(H - 2, '#3a3e50');      // 위 철골
      line(Math.round(H / 2), '#5a6078'); line(Math.round(H / 2) - 1, '#8a92aa'); // 가운데 철골
      line(0, '#3a3e50');
      if (gate) { const [x, y] = at(0.5); R(g, x - 2, y - Math.round(H / 2) - 2, 4, 4, '#f2c230'); R(g, x - 1, y - Math.round(H / 2) - 1, 2, 1, '#8a6a10'); }
      const post = (t) => { const [x, y] = at(t); R(g, x - 2, y - H - 2, 4, H + 3, '#3a3e50'); R(g, x - 1, y - H - 1, 1, H + 1, '#8a92aa'); R(g, x - 2, y - H - 3, 4, 1, '#9aa2b8'); };
      if (first) post(0); post(1);
    }
    return { c, x: minX, y: minY };
  }

  window.ART = { fenceSeg, rice, logo, mk, R, shade, mix, outline, text, textW, person, hat, pickaxe, swingAngle, IMPACT_T, tarsier, tarsierFront, ride, RIDE, pet, npc, prop, emoteIcon, POSE, FLIP };
})();
