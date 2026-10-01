#!/usr/bin/env node
// client/1-core.js ~ 4-ui.js 를 합쳐서 public/game.js 로 출력
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const parts = ['1-core.js', '2-play.js', '3-render.js', '4-ui.js'];
const out = parts.map((f) => fs.readFileSync(path.join(root, 'client', f), 'utf8')).join('\n');
fs.writeFileSync(path.join(root, 'public', 'game.js'), out);
console.log(`public/game.js 생성 (${out.length} bytes)`);
