'use strict';
// 실제 브라우저(Playwright Chromium) 종단 간 테스트: 사람이 하는 그대로 화면을 눌러 보고 결과를 확인한다.
// 실행: npm run e2e   (스크린샷: /tmp/td-e2e/*.png)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { chromium, devices } = require('@playwright/test');
const { createServer } = require('../server/server.js');
const W = require('../shared/world.js');

const OUT = '/tmp/td-e2e';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let srv, browser, base, df;
const errors = [];

before(async () => {
  df = `${OUT}/data-${process.pid}.json`;
  srv = await createServer({ port: 0, dataFile: df, cycleMs: 45000, jailMs: 40000, log: false, oddsSims: 300 });
  base = `http://127.0.0.1:${srv.port}`;
  browser = await chromium.launch();
});
after(async () => { await browser.close(); await srv.close(); fs.rmSync(df, { force: true }); });

async function page(opts = { viewport: { width: 1280, height: 720 } }) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss(); }); // alert()이 뜨면 XSS
  await p.goto(base);
  return p;
}
async function enter(p, name) {
  await p.fill('#nick', name);
  await p.click('#enter');
  await p.waitForFunction(() => !document.getElementById('hud').classList.contains('hidden'), null, { timeout: 8000 });
  await sleep(400);
}
const state = (p) => p.evaluate(() => window.__TD.state());
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
// 요소가 화면 안에 완전히 들어와 있고 서로 겹치지 않는지
async function boxes(p, sels) {
  return p.evaluate((sels) => sels.map((s) => { const e = document.querySelector(s); if (!e || e.offsetParent === null && getComputedStyle(e).position !== 'fixed') return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { s, x: r.x, y: r.y, w: r.width, h: r.height } : null; }).filter(Boolean), sels);
}
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function assertLayout(list, vw, vh, label) {
  for (const b of list) assert.ok(b.x >= -1 && b.y >= -1 && b.x + b.w <= vw + 1 && b.y + b.h <= vh + 1, `${label}: ${b.s} 화면 밖 ${JSON.stringify(b)}`);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert.ok(!overlap(list[i], list[j]), `${label}: ${list[i].s} ↔ ${list[j].s} 겹침`);
}

test('타이틀: 로고·입력 검증·입장', async () => {
  const p = await page();
  await p.waitForFunction(() => document.getElementById('logo').width > 0);
  await shot(p, '01-title');
  // 잘못된 닉네임
  await p.fill('#nick', 'a'); await p.click('#enter');
  await p.waitForFunction(() => document.getElementById('nick-err').textContent.length > 0);
  assert.match(await p.textContent('#nick-err'), /2~10자/);
  await p.fill('#nick', '관리자'); await p.click('#enter');
  await p.waitForFunction(() => /운영자/.test(document.getElementById('nick-err').textContent));
  await enter(p, '첫손님');
  assert.equal((await state(p)).coins, W.CFG.START_COINS);
  await shot(p, '02-play');
  await p.context().close();
});

test('채팅: 두 사람 실시간, HTML·스크립트가 실행되지 않고 글자로만 보임, 긴 문장 줄바꿈', async () => {
  const a = await page(), b = await page();
  await enter(a, '말하는이'); await enter(b, '듣는이');
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  await a.keyboard.press('Enter'); await a.keyboard.type(evil); await a.keyboard.press('Enter');
  await b.waitForFunction((t) => [...document.querySelectorAll('#chat-log div')].some((d) => d.textContent.includes(t)), evil.slice(0, 20));
  assert.equal(await b.evaluate(() => document.querySelectorAll('#chat-log img, #chat-log script').length), 0);
  const long = '이건 아주 긴 채팅 메시지인데 화면 밖으로 삐져나가지 않고 단어 단위로 예쁘게 줄이 바뀌어야 해요 정말로요';
  await a.waitForTimeout(1200);
  await a.keyboard.press('Enter'); await a.keyboard.type(long); await a.keyboard.press('Enter');
  await b.waitForFunction((t) => [...document.querySelectorAll('#chat-log div')].some((d) => d.textContent.includes(t)), long.slice(0, 10));
  const over = await b.evaluate(() => { const log = document.getElementById('chat-log'); return [...log.children].some((d) => d.scrollWidth > log.clientWidth + 1); });
  assert.ok(!over, '채팅 줄이 가로로 넘침');
  await sleep(300); await shot(b, '03-chat');
  assert.deepEqual(errors.filter((e) => e.startsWith('dialog')), []);
  await a.context().close(); await b.context().close();
});

test('베팅: 서랍 열기 → 주자 선택 → 금액 → 베팅 → 코인 차감 → 모두 취소 → 환불', async () => {
  const p = await page();
  await enter(p, '베팅왕');
  // 베팅 가능한 구간까지 기다림
  // 경주가 정산되면 관람 보너스(+5)가 들어오므로, 코인 비교는 각 동작 직전 값 기준
  // 베팅 마감까지 10초 이상 남았을 때 시작 (중간에 마감되면 버튼이 사라지는 것은 정상 동작)
  await p.waitForFunction(() => { const T = window.__TD, r = T.G.race; return r && r.phase === 'betting' && r.odds && r.betEnd - T.now() > 10000; }, null, { timeout: 70000 });
  const c0 = (await state(p)).coins;
  await p.keyboard.press('KeyB');
  await p.waitForSelector('#bet:not(.hidden) .rn');
  // 배당 갱신·선택 때 행을 새로 만들지 않음 (누르는 도중 행이 바뀌면 탭이 사라짐)
  const row0 = await p.evaluateHandle(() => document.querySelector('#runners .rn'));
  await p.click('#runners .rn >> nth=1');
  await p.evaluate(() => { const T = window.__TD; T.G.race.pool = T.G.race.pool.map((v) => v + 100); });
  await p.click('#runners .rn >> nth=2');
  assert.ok(await p.evaluate((r) => r.isConnected && document.querySelectorAll('#runners .rn')[2].classList.contains('sel'), row0), '주자 행이 다시 만들어짐');
  await p.fill('#amt', '150');
  await shot(p, '04-bet');
  await p.click('#place');
  await p.waitForFunction(() => window.__TD.G.myBets.length === 1);
  assert.equal((await state(p)).coins, c0 - 150);
  assert.match(await p.textContent('#mybets'), /150/);
  await p.click('#cancel-all');
  await p.waitForFunction(() => window.__TD.G.myBets.length === 0);
  assert.equal((await state(p)).coins, c0);
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => document.getElementById('bet').classList.contains('hidden'));
  await p.context().close();
});

test('상점: 두 번 눌러 구매 → 장착 표시 → 다시 눌러 해제, 비싼 건 안내', async () => {
  const p = await page();
  await enter(p, '멋쟁이');
  await p.keyboard.press('KeyI');
  await p.waitForSelector('#modal:not(.hidden) .item');
  const first = p.locator('.item').first();
  await first.click();
  assert.equal(await first.locator('.price').textContent(), '한 번 더 누르면 구매');
  await first.click();
  await p.waitForFunction(() => window.__TD.G.me.owned.length === 1);
  await p.waitForSelector('.item.eq');
  await shot(p, '05-shop');
  await p.locator('.item.eq').first().click();
  await p.waitForFunction(() => Object.values(window.__TD.G.me.eq).every((v) => v === null));
  await p.locator('.item').last().click(); // 가장 비싼 것
  await p.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('부족')));
  await p.keyboard.press('Escape');
  await p.context().close();
});

test('이동: 키보드로 걸으면 서버 위치도 따라오고, 화면은 계단 없이 부드럽게', async () => {
  const p = await page();
  await enter(p, '산책러');
  // 입장 직후 중계 카메라 → 따라가기 카메라로 바뀌는 페이드가 끝난 뒤부터 측정 (중계 화면은 원래 고정)
  await p.waitForFunction(() => { const c = window.__TD.G.cam; return c.mode === 'follow' && !c.target && c.fade === 0; }, null, { timeout: 8000 });
  await p.evaluate(() => { window.__TD.G.watch = false; });
  const s0 = await state(p);
  await p.evaluate(() => { const T = window.__TD; window.__log = []; let n = 0; const f = () => { const me = T.G.players.get(T.G.id), c = T.G.cam; if (c.mode === 'follow' && !c.target && c.fade === 0 && n > 10) window.__log.push([me.x - c.x, me.y - c.y]); if (++n < 70) requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await p.keyboard.down('KeyD'); await sleep(1200); await p.keyboard.up('KeyD');
  const s1 = await state(p);
  assert.ok(s1.x - s0.x > 40, `거의 안 움직임 ${s0.x}→${s1.x}`);
  await sleep(400);
  const me = [...srv.sessions.values()].find((q) => q.p && q.p.name === '산책러');
  assert.ok(Math.abs(me.x - s1.x) < 3, `서버 위치 불일치 ${me.x} vs ${s1.x}`);
  const log = await p.evaluate(() => window.__log);
  assert.ok(log.length > 30, `측정 프레임 부족 ${log.length}`);
  const spread = Math.max(...log.map((l) => l[0])) - Math.min(...log.map((l) => l[0]));
  assert.ok(spread < 0.01, `걷는 동안 캐릭터가 화면에서 흔들림: ${spread}`);
  // 몸이 걷는 방향을 봄 (0↓ 1↘ 2→ 3↗ 4↑ 5↖ 6← 7↙)
  const myDir = () => p.evaluate(() => window.__TD.G.players.get(window.__TD.G.id).d);
  assert.equal(await myDir(), 2, '오른쪽으로 걸었는데 몸이 오른쪽을 안 봄');
  for (const [keys, want] of [[['KeyA'], 6], [['KeyS', 'KeyD'], 1], [['KeyW', 'KeyD'], 3], [['KeyW', 'KeyA'], 5], [['KeyS', 'KeyA'], 7], [['KeyW'], 4], [['KeyS'], 0]]) {
    for (const k of keys) await p.keyboard.down(k); await sleep(200); for (const k of keys) await p.keyboard.up(k);
    assert.equal(await myDir(), want, keys.join('+'));
  }
  await p.context().close();
});

test('파산 → 감옥(안경원숭이) → 벼 베기 → 쌀 판매 → 석방, 갇힌 동안 베팅 막힘', async () => {
  const p = await page();
  await enter(p, '파산왕');
  srv.bankrupt('파산왕');
  await p.waitForFunction(() => window.__TD.state().jail);
  await sleep(500); await shot(p, '06-jail');
  await p.keyboard.press('KeyB');
  await p.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('감옥')));
  const go = async (tx, ty) => {
    for (let n = 0; n < 40; n++) {
      const s = await state(p), dx = tx - s.x, dy = ty - s.y;
      if (Math.hypot(dx, dy) < 6) return;
      const keys = []; if (dx > 3) keys.push('KeyD'); if (dx < -3) keys.push('KeyA'); if (dy > 3) keys.push('KeyS'); if (dy < -3) keys.push('KeyW');
      for (const k of keys) await p.keyboard.down(k);
      await sleep(Math.min(250, Math.hypot(dx, dy) * 8));
      for (const k of keys) await p.keyboard.up(k);
    }
  };
  for (let n = 0; n < 60 && (await state(p)).jail && (await state(p)).rice < W.CFG.RICE_NEED; n++) {
    const s = await state(p), r = s.riceList.filter((q) => q.ready).sort((a, b) => Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y))[0];
    if (!r) { await sleep(300); continue; }
    await go(r.x, r.y + 8);
    await p.keyboard.press('KeyE'); await sleep(650);
  }
  const s = await state(p);
  if (s.jail) {
    assert.equal(s.rice, W.CFG.RICE_NEED);
    const f = W.NPCS.find((n) => n.id === 'farmer');
    await go(f.x + 10, f.y - 6);
    await p.keyboard.press('KeyE');
  }
  await p.waitForFunction(() => !window.__TD.state().jail, null, { timeout: 5000 });
  assert.equal((await state(p)).coins, W.CFG.BAILOUT);
  await p.context().close();
});

test('새로고침해도 같은 계정(코인 유지), 같은 계정 두 창 → 이전 창 끊김 안내', async () => {
  const p = await page();
  await enter(p, '기억해줘');
  const me = [...srv.sessions.values()].find((q) => q.p && q.p.name === '기억해줘');
  me.p.coins = 4321;
  await p.reload();
  await enter(p, '기억해줘');
  assert.equal((await state(p)).coins, 4321);
  // 같은 브라우저 저장소를 쓰는 두 번째 창
  const p2 = await p.context().newPage();
  await p2.goto(base);
  await enter(p2, '기억해줘');
  await p.waitForFunction(() => /다른 창/.test(document.body.textContent), null, { timeout: 5000 });
  await p.context().close();
});

for (const [name, dev] of [['iPhone 13', devices['iPhone 13']], ['Galaxy S9+', devices['Galaxy S9+']], ['iPad Mini', devices['iPad Mini']]]) {
  test(`모바일 ${name}: 타이틀·입장·조이스틱 이동·액션 버튼·베팅 바텀시트·겹침 없음`, async () => {
    const p = await page({ ...dev });
    const { width: vw, height: vh } = dev.viewport;
    await p.waitForFunction(() => document.getElementById('logo').width > 0);
    const t = await boxes(p, ['#logo', '.tcard', '#online']);
    assertLayout(t, vw, vh, `${name} 타이틀`);
    await enter(p, '폰' + name.replace(/\W/g, '').slice(0, 8));
    await shot(p, `07-mobile-${name.replace(/\W/g, '')}`);
    assert.ok(await p.isVisible('#act-btn'));
    assert.ok(await p.isVisible('#joy-zone'));
    const hud = await boxes(p, ['#me-box', '#race-box', '#bar', '#act-btn', '#chat-toggle', '#chat']);
    assert.equal(await p.textContent('#act-btn'), '행동');
    // 채팅 버튼 → 입력칸 열림 → 입력 → 보내기 → 닫힘
    await p.tap('#chat-toggle');
    await p.waitForSelector('#chat.open #chat-in:focus');
    await p.keyboard.type('폰에서 안녕');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => !document.getElementById('chat').classList.contains('open') && /폰에서 안녕/.test(document.getElementById('chat-log').textContent));
    assertLayout(hud, vw, vh, `${name} 게임 화면`);
    // 조이스틱: 왼쪽 아래를 누르고 오른쪽으로 끌기
    const z = await p.locator('#joy-zone').boundingBox();
    const cx = z.x + z.width / 2, cy = z.y + z.height * 0.7, s0 = await state(p);
    const cdp = await p.context().newCDPSession(p);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    await touch('touchStart', cx, cy);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', cx + i * 6, cy); await sleep(30); }
    await sleep(900);
    await touch('touchEnd');
    const s1 = await state(p);
    assert.ok(s1.x - s0.x > 30, `조이스틱으로 안 움직임 ${s0.x}→${s1.x}`);
    assert.equal(await p.evaluate(() => window.__TD.G.players.get(window.__TD.G.id).d), 2, '오른쪽으로 밀었는데 몸이 오른쪽을 안 봄');
    await sleep(300);
    const s2 = await state(p);
    assert.ok(Math.abs(s2.x - s1.x) < 2, '손을 뗐는데 계속 움직임');
    // 대각선(왼쪽 위 30°): 키 4방향이 아니라 끈 각도대로 이동
    await touch('touchStart', cx, cy);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', cx - i * 6 * Math.cos(Math.PI / 6), cy - i * 6 * Math.sin(Math.PI / 6)); await sleep(30); }
    await sleep(800);
    await touch('touchEnd');
    const s3 = await state(p), ang = Math.atan2(-(s3.y - s2.y), -(s3.x - s2.x)) * 180 / Math.PI;
    assert.ok(Math.abs(ang - 30) < 8, `조이스틱 각도대로 안 감: ${ang.toFixed(1)}° (기대 30°)`);
    assert.equal(await p.evaluate(() => window.__TD.G.players.get(window.__TD.G.id).d), 5, '왼쪽 위로 밀었는데 왼쪽 위 포즈가 아님');
    // 멀리서 보는 시점: 짧은 변에 맵이 200px 이상 보임
    const shortWorld = await p.evaluate(() => Math.min(window.__TD.view().VW, window.__TD.view().VH));
    assert.ok(shortWorld >= 300, `너무 가까운 시점: 짧은 변 ${shortWorld}px`);
    // 메뉴 바의 '베팅' → 바텀시트, 화면 안에 들어옴
    await p.tap('#bar [data-act="bet"]');
    await p.waitForSelector('#bet:not(.hidden)');
    await sleep(300);
    const sheet = await boxes(p, ['#bet']);
    assertLayout(sheet, vw, vh, `${name} 베팅 시트`);
    assert.ok(sheet[0].y + sheet[0].h >= vh - 2, '바텀시트가 화면 아래에 붙어 있지 않음');
    await shot(p, `08-mobile-bet-${name.replace(/\W/g, '')}`);
    // 터치 기기에서는 키보드 안내가 보이지 않음
    assert.doesNotMatch(await p.textContent('#bet'), /숫자 키|B 키/);
    await p.tap('#bet .x');
    await p.waitForFunction(() => document.getElementById('bet').classList.contains('hidden'));
    await p.tap('#bar [data-act="help"]');
    await p.waitForSelector('#modal:not(.hidden)');
    const help = await p.textContent('#modal');
    assert.match(help, /행동 버튼/);
    assert.doesNotMatch(help, /E 키|WASD|농부/);
    // 가로 스크롤·확대가 생기지 않음
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await p.context().close();
  });
}

test('데스크톱 여러 해상도: HUD가 화면 안에 있고 서로 안 겹침', async () => {
  for (const [w, h] of [[1024, 600], [1280, 720], [1366, 768], [1920, 1080]]) {
    const p = await page({ viewport: { width: w, height: h } });
    await enter(p, `해상도${w}`);
    const list = await boxes(p, ['#me-box', '#race-box', '#board-box', '#bar', '#chat']);
    assertLayout(list, w, h, `${w}x${h}`);
    await p.context().close();
  }
});

test('전체 시나리오 동안 브라우저 오류 없음', () => {
  assert.deepEqual(errors, []);
});
