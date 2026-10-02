// 배당 계산(몬테카를로 1200회)은 수십~수백 ms가 걸려 메인 루프를 막으므로 별도 스레드에서 돌린다.
'use strict';
const { parentPort } = require('worker_threads');
const RACE = require('../shared/race.js');
parentPort.on('message', ({ id, card, seed, sims }) => parentPort.postMessage({ id, odds: RACE.odds(card, seed, sims) }));
