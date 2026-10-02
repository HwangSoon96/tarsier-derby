'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const W = require('../shared/world.js');
const RACE = require('../shared/race.js');

describe('world', () => {
  it('stadiumDist: 트랙 중심은 0', () => {
    assert.equal(W.stadiumDist(W.TRACK.cx, W.TRACK.cy), 0);
  });
  it('lanePos: p=0 → 아래 직선 출발점', () => {
    const p = W.lanePos(0, 0);
    assert.ok(p.y > W.TRACK.cy, 'y는 중심 아래');
    assert.ok(Math.abs(p.dx - 1) < 0.01, '오른쪽 진행');
  });
  it('lanePos: p=1 → 결승 통과', () => {
    const p = W.lanePos(0, 1);
    assert.ok(p.x > W.TRACK.cx - 10, '결승선 근처');
  });
  it('blocked: 스폰 영역은 통과 가능', () => {
    const z = W.ZONES.spawn;
    assert.equal(W.blocked(z.x + z.w / 2, z.y + z.h / 2), false);
  });
  it('blocked: 부스 안쪽은 통과 불가', () => {
    assert.equal(W.blocked(270, 455), true);
  });
  it('blocked: 관중석 왼쪽은 통과 불가', () => {
    assert.equal(W.blocked(400, 460), true);
  });
  it('blocked: 관중석 사이 통로는 통과 가능', () => {
    assert.equal(W.blocked(480, 460), false);
  });
  it('clampJail: 감옥 밖으로 나갈 수 없음', () => {
    for (const [px, py] of [[0, 0], [2000, 2000], [0, 450], [860, 9999]]) {
      const [x, y] = W.clampJail(px, py), z = W.ZONES.jailIn;
      assert.ok(x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h, `${px},${py} → ${x},${y}`);
    }
  });
  it('감옥: 벼·간수는 안쪽, 쇠창살은 막힘, 석방 위치는 밖이고 걸을 수 있음', () => {
    const z = W.ZONES.jailIn, f = W.NPCS.find((n) => n.id === 'farmer');
    for (const r of W.RICE) assert.ok(W.inRect(z, r.x, r.y), `rice ${r.id}`);
    assert.ok(W.inRect(z, f.x, f.y - 1));
    assert.ok(W.blocked(W.ZONES.jail.x + 2, 450) && W.blocked(860, W.ZONES.jail.y + 4));
    assert.ok(!W.blocked(W.ZONES.jail.x - 10, W.ZONES.jail.y + W.ZONES.jail.h - 14));
    for (const k of W.ROCKS) assert.ok(!W.inRect(W.ZONES.jail, k.x, k.y));
  });
  it('look: 같은 시드 → 같은 외형', () => {
    const a = W.look(12345, 'm'), b = W.look(12345, 'm');
    assert.deepEqual(a, b);
  });
  it('look: 다른 시드 → 다른 외형', () => {
    const a = W.look(1, 'm'), b = W.look(99999, 'm');
    assert.notDeepEqual(a, b);
  });
  it('phases: 단계 경계가 순서대로', () => {
    const ph = W.phases(300000);
    assert.ok(ph.betEnd < ph.closeEnd);
    assert.ok(ph.closeEnd < ph.raceEnd);
    assert.ok(ph.raceEnd <= ph.cycle);
  });
  it('phases: 짧은 주기에서도 유효', () => {
    const ph = W.phases(12000);
    assert.ok(ph.betEnd > 0);
    assert.ok(ph.betEnd < ph.closeEnd);
  });
  it('ITEMS: 모든 아이템 ID가 ITEM 맵에 존재', () => {
    for (const it of W.ITEMS) assert.ok(W.ITEM[it.id], `${it.id} missing`);
  });
  it('NAME_RE: 한글 이름 통과', () => assert.ok(W.NAME_RE.test('테스터123')));
  it('NAME_RE: 특수문자 차단', () => assert.ok(!W.NAME_RE.test('a<script>')));
});

describe('collision: 벽 따라 미끄러지기', () => {
  // 한 프레임(60fps) 걷기 거리로 n번 이동하며 프레임당 이동 거리 기록
  const walk = (x, y, dx, dy, n = 120) => { const st = []; for (let i = 0; i < n; i++) { const [a, b] = W.move(x, y, dx, dy); assert.ok(!W.blocked(a, b), `벽 안으로 들어감 ${a},${b}`); st.push(Math.hypot(a - x, b - y)); x = a; y = b; } return { x, y, st: st.slice(5) }; };
  const F = 1.2; // 72px/s ÷ 60fps
  it('경마장 곡선 울타리에 비스듬히 밀어도 멈추지 않고 거의 제 속도로 돌아감', () => {
    const r = walk(W.TRACK.cx + W.TRACK.half + W.FENCE_R + 6, W.TRACK.cy + 30, -F * 0.707, -F * 0.707);
    assert.ok(Math.min(...r.st) > F * 0.5, `걸림: 최소 ${Math.min(...r.st)}`);
    const avg = r.st.reduce((a, b) => a + b) / r.st.length;
    assert.ok(avg > F * 0.75, `느림: 평균 ${avg}`); // 미는 방향 중 벽과 나란한 성분만큼 (곡선이라 각도가 바뀜)
  });
  it('곡선 울타리를 정면(위)으로 밀면 옆으로 흘러 나감 (예전엔 완전히 멈춤)', () => {
    const r = walk(W.TRACK.cx + W.TRACK.half + 40, W.TRACK.cy + W.FENCE_R + 30, 0, -F);
    assert.ok(r.st.filter((v) => v < 0.05).length < 50, '멈춤');
  });
  it('직사각형 모서리를 스치면 둥글게 돌아 나감', () => {
    const shop = W.SOLIDS[0], r = walk(shop.x - 6, shop.y + shop.h + 20, 0.25, -F, 120);
    assert.ok(r.y < shop.y, `모서리에 걸림 (${r.x.toFixed(1)}, ${r.y.toFixed(1)})`);
    assert.ok(Math.min(...r.st) > 0.3);
  });
  it('벽을 정면으로 밀면 떨림 없이 멈춤, 뚫지 않음', () => {
    const J = W.ZONES.jail, r = walk(J.x - 8, J.y + 50, F * 3, 0, 60);
    assert.ok(r.x < J.x, '창살 통과');
    assert.ok(r.st.slice(20).every((v) => v < 0.01), '벽 앞에서 떨림');
  });
  it('서버 경로 검사: 미끄러진 이동은 통과, 벽 너머 순간이동은 차단', () => {
    let x = W.TRACK.cx + W.TRACK.half + W.FENCE_R + 6, y = W.TRACK.cy + 30;
    for (let i = 0; i < 60; i++) { const [a, b] = W.move(x, y, -F * 4, -F * 4); assert.ok(W.pathClear(x, y, Math.round(a * 10) / 10, Math.round(b * 10) / 10), `정상 이동 거부 ${x},${y}→${a},${b}`); x = Math.round(a * 10) / 10; y = Math.round(b * 10) / 10; }
    const J = W.ZONES.jail;
    assert.equal(W.pathClear(J.x - 8, J.y + 50, J.x + 14, J.y + 50), false);
    assert.equal(W.pathClear(480, W.TRACK.cy + W.FENCE_R + 12, 480, W.TRACK.cy + W.FENCE_R - 12), false);
  });
});

describe('race', () => {
  it('drawCard: 6마리, 중복 없는 마구간', () => {
    const c = RACE.drawCard(42);
    assert.equal(c.length, 6);
    const stables = new Set(c.map((x) => x.stable));
    assert.equal(stables.size, 6, '마구간 중복 없음');
  });
  it('drawCard: 다른 시드 → 다른 카드', () => {
    const a = RACE.drawCard(1), b = RACE.drawCard(9999);
    assert.notDeepEqual(a.map((x) => x.stable), b.map((x) => x.stable));
  });
  it('simulate: 모든 주자 결승', () => {
    const c = RACE.drawCard(7), r = RACE.simulate(c, 77, true);
    assert.equal(r.order.length, 6);
    assert.ok(r.ticks > 0);
    assert.ok(r.frames.length > 0);
    for (const t of r.times) assert.ok(t > 0, 'times > 0');
  });
  it('simulate: 1착은 가장 빠른 시간', () => {
    const c = RACE.drawCard(11), r = RACE.simulate(c, 111, true);
    assert.ok(r.times[r.order[0]] <= r.times[r.order[1]]);
  });
  it('simulate: record=false면 frames=null', () => {
    const c = RACE.drawCard(3), r = RACE.simulate(c, 33, false);
    assert.equal(r.frames, null);
    assert.equal(r.order.length, 6);
  });
  it('odds: 단승 배당 합 > 1', () => {
    const c = RACE.drawCard(5), o = RACE.odds(c, 55, 200);
    assert.ok(o.win.length === 6);
    const inv = o.win.reduce((s, x) => s + 1 / x, 0);
    assert.ok(inv > 1, '하우스 엣지 반영');
  });
  it('odds: 연승 배당 < 단승', () => {
    const c = RACE.drawCard(8), o = RACE.odds(c, 88, 200);
    for (let i = 0; i < 6; i++) assert.ok(o.place[i] <= o.win[i], `place[${i}] <= win[${i}]`);
  });
  it('playback: total > 0, wall > 0', () => {
    const c = RACE.drawCard(9), r = RACE.simulate(c, 99, true);
    const pb = RACE.playback(r, 1);
    assert.ok(pb.total > 0);
    assert.ok(pb.wall > 0);
    assert.ok(pb.wall >= pb.total, 'wall >= total (슬로모 가능)');
    assert.equal(typeof pb.map, 'function');
    assert.ok(pb.map(0) === 0);
    assert.ok(pb.map(pb.wall) >= pb.total - 0.01);
  });
  it('playback: scale>1이면 빨라짐', () => {
    const c = RACE.drawCard(4), r = RACE.simulate(c, 44, true);
    const p1 = RACE.playback(r, 1), p2 = RACE.playback(r, 2);
    assert.ok(p2.wall < p1.wall, '2배속이면 wall 더 짧음');
  });
});
