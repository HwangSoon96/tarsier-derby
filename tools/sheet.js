const A = ART, Z = 4, c = document.getElementById('c'); c.width = 1600; c.height = 2400;
const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.scale(Z, Z);
const put = (cv, X, Y) => x.drawImage(cv, X, Y);
const looks = [WORLD.look(1, 'm'), WORLD.look(7, 'f'), WORLD.look(99, 'f'), WORLD.look(5, 'm')];
looks[0].style = 'spiky'; looks[1].style = 'long'; looks[2].style = 'pony'; looks[3].style = 'short';
// 8방향 x 4프레임, 아바타 2종
looks.slice(0, 2).forEach((L, li) => { for (let d = 0; d < 8; d++) for (let f = 0; f < 4; f++) { const [cv, g] = A.mk(28, 34); A.person(g, 14, 32, L, d, f, {}); put(A.outline(cv), 4 + d * 46 + f * 0, 4 + li * 40 + f * 0); if (f === 0) {} } });
// 걷기 프레임 (방향 2 → 4프레임), 스타일 4종 정면
for (let f = 0; f < 4; f++) { const [cv, g] = A.mk(28, 34); A.person(g, 14, 32, looks[2], 2, f, {}); put(A.outline(cv), 4 + f * 30, 84); }
for (let f = 0; f < 4; f++) { const [cv, g] = A.mk(28, 34); A.person(g, 14, 32, looks[3], 0, f, {}); put(A.outline(cv), 130 + f * 30, 84); }
// 곡괭이 스윙: 방향 0,1,2,3,4 x 8 단계
[0, 2, 1, 4, 6].forEach((d, di) => { for (let k = 0; k < 8; k++) { const t = [0, 0.2, 0.36, 0.5, 0.54, 0.6, 0.7, 0.9][k]; const [cv, g] = A.mk(44, 44); A.pickaxe(g, 22, 40, d, t, true, looks[0].shirt); A.person(g, 22, 40, looks[0], d, 0, { act: true }); A.pickaxe(g, 22, 40, d, t, false, looks[0].shirt); put(A.outline(cv), 4 + k * 46, 124 + di * 44); } });
// 모자
['h_straw', 'h_cap', 'h_beanie', 'h_top', 'h_helmet', 'h_antenna', 'h_crown'].forEach((h, i) => { for (const [k, d] of [[0, 0], [1, 2]]) { const [cv, g] = A.mk(30, 40); const r = A.person(g, 15, 38, looks[3], d, 0, {}); A.hat(g, 15, r.headTop, h, d); put(A.outline(cv), 4 + i * 54 + k * 26, 348); } });
// 탈것
['r_board', 'r_rover', 'r_cricket', 'r_ufo'].forEach((rd, i) => { for (const [k, d] of [[0, 0], [1, 2]]) { const [cv, g] = A.mk(40, 46); const lift = A.RIDE[rd].lift; A.ride(g, 20, 44, rd, d, 0, 'back'); A.person(g, 20, 44 - lift, looks[1], d, 0, { seated: A.RIDE[rd].seated }); A.ride(g, 20, 44, rd, d, 0, 'front'); put(A.outline(cv), 4 + i * 90 + k * 42, 392); } });
// 안경원숭이 5포즈 + 정면
const J = ['#d94a3a', '#3b78d8', '#e8b830', '#4caf50', '#9c4fd8', '#f07a2a'];
for (let p = 0; p < 5; p++) { const [cv, g] = A.mk(30, 30); A.tarsier(g, 16, 28, J[p], p + 1, p, false); put(A.outline(cv), 4 + p * 34, 444); }
for (let i = 0; i < 2; i++) { const [cv, g] = A.mk(30, 32); A.tarsierFront(g, 15, 30, J[i + 2], i + 3, i === 1); put(A.outline(cv), 180 + i * 34, 442); }
// NPC + 펫 + 이모트
['bookie', 'shop', 'guard'].forEach((n, i) => { const [cv, g] = A.mk(26, 34); A.npc(g, 13, 32, n, 0.3); put(A.outline(cv), 260 + i * 30, 442); });
['p_tars', 'p_drone', 'p_cricket'].forEach((n, i) => { const [cv, g] = A.mk(24, 24); A.pet(g, 12, 22, n, 0.2, true); put(A.outline(cv), 4 + i * 28, 480); });
['cheer', 'cry', 'love', 'shock'].forEach((n, i) => put(A.emoteIcon(n), 100 + i * 20, 484));
// 소품
let px = 0; ['dome', 'rocket', 'shop', 'booth', 'cage', 'dish', 'solar', 'rock0', 'rock2', 'ore0', 'ore1', 'ore2', 'flag', 'finish'].forEach((n) => { const cv = A.prop(n); put(cv, 4 + px, 510 - 0); px += cv.width + 4; });
A.text(x, 'MARS DERBY 0123456789 WIN', 200, 486, '#ffffff');
document.title = 'done';
