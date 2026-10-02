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
