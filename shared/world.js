// 공유 모듈 (서버·클라이언트 공용): 화성 맵, 트랙 기하, 아이템 카탈로그, 경주마(안경원숭이) 명단, 경제 상수
(function (root) {
  'use strict';

  // ---------- 맵 ----------
  const T = 16, MW = 64, MH = 48, W = MW * T, H = MH * T; // 1024 x 768 px
  const TRACK = { cx: 480, cy: 300, half: 150, r0: 50, lane: 7, lanes: 6, laps: 2 };
  TRACK.inner = TRACK.r0 - 5;                              // 안쪽 레일
  TRACK.outer = TRACK.r0 + TRACK.lane * TRACK.lanes + 3;   // 바깥 레일 (92)

  // 레일까지 포함한 경기장 영역 안쪽인가 (스타디움 모양의 부호거리)
  function stadiumDist(x, y) {
    const dx = Math.max(Math.abs(x - TRACK.cx) - TRACK.half, 0), dy = y - TRACK.cy;
    return Math.hypot(dx, dy);
  }

  // 레인 l(0~5), 진행도 p(0~1, 전체 경주) → 좌표·진행 방향. 반시계 방향, 출발/결승 = 아래 직선 중앙.
  function lanePos(l, p) {
    const r = TRACK.r0 + TRACK.lane * l + TRACK.lane / 2, L = TRACK.half, cx = TRACK.cx, cy = TRACK.cy;
    const segs = [L, Math.PI * r, 2 * L, Math.PI * r, L], per = 4 * L + 2 * Math.PI * r;
    const d0 = (((p * TRACK.laps) % 1) + 1) % 1 * per;
    let d = d0;
    if (d < segs[0]) return { x: cx + d, y: cy + r, dx: 1, dy: 0 };
    d -= segs[0];
    if (d < segs[1]) { const a = Math.PI / 2 - d / r; return { x: cx + L + Math.cos(a) * r, y: cy + Math.sin(a) * r, dx: Math.sin(a), dy: -Math.cos(a) }; }
    d -= segs[1];
    if (d < segs[2]) return { x: cx + L - d, y: cy - r, dx: -1, dy: 0 };
    d -= segs[2];
    if (d < segs[3]) { const a = -Math.PI / 2 - d / r; return { x: cx - L + Math.cos(a) * r, y: cy + Math.sin(a) * r, dx: Math.sin(a), dy: -Math.cos(a) }; }
    d -= segs[3];
    return { x: cx - L + d, y: cy + r, dx: 1, dy: 0 };
  }

  const R = (x, y, w, h) => ({ x, y, w, h });
  const ZONES = {
    spawn: R(430, 500, 100, 40),
    stand: R(300, 404, 360, 34),       // 레일 앞 관람 구역 (걸어 다닐 수 있음)
    bookie: R(232, 420, 80, 50),
    shop: R(96, 300, 96, 80),
    jail: R(784, 392, 160, 112),      // 파산자 감옥 (쇠창살 바깥 테두리, 안쪽 바닥은 벼밭)
    jailIn: R(792, 404, 144, 92),     // 갇힌 사람이 움직일 수 있는 안쪽
    mineW: R(48, 80, 150, 180),
    mineE: R(780, 96, 190, 220),
    north: R(300, 16, 360, 150)
  };
  const NPCS = [
    { id: 'bookie', name: '베팅 로봇 BET-9', x: 272, y: 450, act: 'bet' },
    { id: 'shop', name: '화성 잡화상 쿠쿠', x: 144, y: 372, act: 'shop' },
    { id: 'farmer', name: '간수 로봇 벼리', x: 812, y: 492, act: 'rice' }
  ];
  // 이동 불가 직사각형 (건물·우리 벽·장식물)
  const SOLIDS = [
    R(100, 302, 88, 60),            // 상점 돔
    R(232, 440, 80, 30),            // 베팅 부스 (로봇 + 카운터)
    R(784, 392, 160, 10), R(784, 496, 160, 10), R(784, 392, 8, 114), R(936, 392, 8, 114), // 감옥 쇠창살
    R(318, 40, 84, 50), R(430, 30, 100, 64), R(560, 44, 84, 46),                         // 북쪽 거주 돔
    R(700, 30, 26, 64),             // 로켓
    R(330, 444, 130, 30), R(500, 444, 130, 30) // 관중석 좌·우 (가운데는 통로)
  ];
  const ROCKS = [
    [70, 110], [120, 96], [170, 130], [86, 170], [150, 200], [64, 236], [182, 248],
    [800, 120], [860, 108], [930, 140], [820, 190], [900, 210], [950, 260], [840, 280], [910, 300]
  ].map(([x, y], i) => ({ id: i, x, y }));

  // 감옥 안 벼밭의 벼 (4x3). 베면 그루터기만 남고 RICE_REGROW_MS 뒤 다시 익는다.
  const RICE = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) RICE.push({ id: RICE.length, x: 852 + c * 22, y: 424 + r * 24 });

  const inRect = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  // 발 위치(x,y) 기준 이동 가능 여부. 히트박스 폭 8, 높이 4.
  function blocked(x, y) {
    const hw = 4, hh = 3;
    if (x - hw < 8 || y - hh < 8 || x + hw > W - 8 || y > H - 8) return true;
    if (stadiumDist(x, y) < TRACK.outer + 4) return true;
    for (const s of SOLIDS) if (x + hw > s.x && x - hw < s.x + s.w && y > s.y && y - hh < s.y + s.h) return true;
    for (const k of ROCKS) if (Math.abs(x - k.x) < 8 && y > k.y - 4 && y - hh < k.y + 2) return true;
    return false;
  }
  const clampJail = (x, y) => { const c = ZONES.jailIn; return [Math.min(Math.max(x, c.x + 4), c.x + c.w - 4), Math.min(Math.max(y, c.y + 4), c.y + c.h)]; };

  // ---------- 아이템 ----------
  const ITEMS = [
    { id: 'h_straw', slot: 'hat', name: '밀짚모자', price: 300 },
    { id: 'h_cap', slot: 'hat', name: '경마장 캡모자', price: 450 },
    { id: 'h_beanie', slot: 'hat', name: '털모자', price: 600 },
    { id: 'h_top', slot: 'hat', name: '신사 실크햇', price: 1200 },
    { id: 'h_helmet', slot: 'hat', name: '우주 헬멧', price: 2500 },
    { id: 'h_antenna', slot: 'hat', name: '외계인 더듬이', price: 3500 },
    { id: 'h_crown', slot: 'hat', name: '황금 왕관', price: 9000 },
    { id: 't_dust', slot: 'trail', name: '먼지 발자취', price: 500 },
    { id: 't_heart', slot: 'trail', name: '하트 발자취', price: 1500 },
    { id: 't_spark', slot: 'trail', name: '반짝이 발자취', price: 2000 },
    { id: 't_fire', slot: 'trail', name: '불꽃 발자취', price: 4000 },
    { id: 't_rainbow', slot: 'trail', name: '무지개 발자취', price: 7000 },
    { id: 'r_board', slot: 'ride', name: '호버보드', price: 3000, speed: 1.12 },
    { id: 'r_rover', slot: 'ride', name: '미니 로버', price: 6000, speed: 1.2 },
    { id: 'r_cricket', slot: 'ride', name: '왕귀뚜라미', price: 8000, speed: 1.22 },
    { id: 'r_ufo', slot: 'ride', name: '황금 UFO', price: 20000, speed: 1.3 },
    { id: 'p_tars', slot: 'pet', name: '아기 안경원숭이', price: 2500 },
    { id: 'p_drone', slot: 'pet', name: '관측 드론', price: 4000 },
    { id: 'p_cricket', slot: 'pet', name: '애완 귀뚜라미', price: 1200 }
  ];
  const ITEM = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
  const SLOTS = ['hat', 'trail', 'ride', 'pet'];
  const EMOTES = ['thumbs', 'nope', 'cheer', 'cry', 'love', 'shock'];

  // ---------- 경주 안경원숭이 명단 (각자 고정 능력치) ----------
  // spd 최고속도, sta 지구력, gut 근성(막판 스퍼트), luck 사건 회피. style: 도주/선행/선입/추입
  const STABLE = [
    { name: '안경도사', color: '#d94a3a', spd: 86, sta: 72, gut: 70, luck: 60, style: 'front' },
    { name: '돋보기', color: '#3b78d8', spd: 74, sta: 90, gut: 64, luck: 70, style: 'pace' },
    { name: '뿔테왕자', color: '#e8b830', spd: 80, sta: 66, gut: 88, luck: 55, style: 'closer' },
    { name: '렌즈닦이', color: '#4caf50', spd: 70, sta: 78, gut: 76, luck: 85, style: 'stalk' },
    { name: '근시대장', color: '#9c4fd8', spd: 90, sta: 58, gut: 62, luck: 50, style: 'front' },
    { name: '귀뚜라미킬러', color: '#f07a2a', spd: 76, sta: 74, gut: 80, luck: 40, style: 'stalk' },
    { name: '왕눈이', color: '#20b2c8', spd: 72, sta: 82, gut: 86, luck: 66, style: 'closer' },
    { name: '도수폭발', color: '#e05d9a', spd: 84, sta: 64, gut: 74, luck: 62, style: 'pace' },
    { name: '밤도깨비', color: '#555c6e', spd: 78, sta: 86, gut: 58, luck: 74, style: 'pace' },
    { name: '꼬리털', color: '#8b5a2b', spd: 68, sta: 92, gut: 82, luck: 78, style: 'closer' },
    { name: '화성특급', color: '#c0392b', spd: 92, sta: 54, gut: 66, luck: 45, style: 'front' },
    { name: '느긋한팀장', color: '#7a9a3a', spd: 64, sta: 88, gut: 92, luck: 90, style: 'stalk' }
  ];
  const STYLE_KO = { front: '도주', pace: '선행', stalk: '선입', closer: '추입' };
  const COND = [{ k: 'best', ko: '최상', m: 1.025 }, { k: 'good', ko: '좋음', m: 1.01 }, { k: 'norm', ko: '보통', m: 1 }, { k: 'bad', ko: '나쁨', m: 0.99 }, { k: 'worst', ko: '최악', m: 0.975 }];

  // ---------- 경제·주기 ----------
  const CFG = {
    START_COINS: 1000, MIN_BET: 10, MAX_BETS_PER_RACE: 20, HOUSE_EDGE: 0.1,
    // 파산 감옥: 안쪽 벼밭에서 벼를 베어 쌀을 RICE_NEED개 모아 간수 로봇에게 팔면 석방, 벨 때마다 ESCAPE_CHANCE 확률로 즉시 탈출.
    // 아무것도 안 해도 BANKRUPT_JAIL_MS 뒤엔 풀려남. 석방되면 재기 지원금 BAILOUT.
    BANKRUPT_JAIL_MS: 45000, BAILOUT: 300, RICE_NEED: 5, ESCAPE_CHANCE: 0.05, RICE_REGROW_MS: 5000, RICE_COOLDOWN_MS: 450,
    CYCLE_MS: 300000, RACE_MS: 60000, RESULT_MS: 15000, CLOSE_MS: 15000,
    RUNNERS: 6, TICK_HZ: 20,
    WALK: 72, RUN_MULT: 1.65, MAX_SPEED_MULT: 1.65 * 1.3,
    ROCK_HP: 3, ROCK_RESPAWN_MS: 45000, ROCK_REWARD: [6, 14], GEM_CHANCE: 0.04, GEM_REWARD: 80, MINE_COOLDOWN_MS: 380,
    WATCH_BONUS: 5,
    NAME_MIN: 2, NAME_MAX: 10, CHAT_MAX: 80
  };
  const NAME_RE = /^[0-9A-Za-z가-힣_\-]+$/;
  // 사이클 안 단계 경계(ms): betting → closed → race → result
  function phases(cycle) {
    const race = Math.min(CFG.RACE_MS, cycle * 0.4), result = Math.min(CFG.RESULT_MS, cycle * 0.12), close = Math.min(CFG.CLOSE_MS, cycle * 0.08);
    const betEnd = cycle - race - result - close;
    return { betEnd, closeEnd: betEnd + close, raceEnd: betEnd + close + race, cycle };
  }

  // ---------- 아바타 (시드 → 외형) ----------
  const LOOK = {
    skin: ['#f7d0ad', '#f1bf96', '#e0a57a', '#c58556', '#9a633c', '#6e4428'],
    hair: ['#2a1d16', '#5a3420', '#8a4a22', '#c27c3a', '#e2c070', '#d8d8d8', '#c0392b', '#3b5bd8', '#e88ab8', '#2f8f6a'],
    shirt: ['#d94a3a', '#3b78d8', '#4caf50', '#e8b830', '#9c4fd8', '#f07a2a', '#20b2c8', '#e05d9a', '#f2f2f2', '#33363f'],
    pants: ['#3a4a6b', '#2b2b33', '#6b4a2b', '#4a5a3a', '#7a2a3a', '#2a5a7a'],
    mStyle: ['short', 'spiky', 'side', 'buzz'],
    fStyle: ['long', 'pony', 'bob', 'buns']
  };
  function look(seed, gender) {
    let a = seed >>> 0;
    const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    return { gender, skin: pick(LOOK.skin), hair: pick(LOOK.hair), shirt: pick(LOOK.shirt), pants: pick(LOOK.pants), style: pick(gender === 'f' ? LOOK.fStyle : LOOK.mStyle) };
  }

  const API = { T, MW, MH, W, H, TRACK, ZONES, NPCS, SOLIDS, ROCKS, RICE, ITEMS, ITEM, SLOTS, EMOTES, STABLE, STYLE_KO, COND, CFG, NAME_RE, LOOK, stadiumDist, lanePos, blocked, clampJail, inRect, phases, look };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.WORLD = API;
})(this);
