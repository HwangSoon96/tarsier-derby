// WebAudio 합성 효과음·음악 (외부 파일 없음). 첫 사용자 입력 이후에만 시작.
(function () {
  'use strict';
  let ac = null, master = null, sfxBus = null, musicBus = null, crowd = null, crowdGain = null;
  let muted = localStorage.getItem('td-mute') === '1';
  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ac.destination);
    sfxBus = ac.createGain(); sfxBus.gain.value = 0.55; sfxBus.connect(master);
    musicBus = ac.createGain(); musicBus.gain.value = 0.16; musicBus.connect(master);
    // 관중 소리: 대역 통과 필터를 거친 반복 노이즈
    const len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { b = b * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = b * 6 * (0.7 + 0.3 * Math.sin(i / 900)); }
    crowd = ac.createBufferSource(); crowd.buffer = buf; crowd.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.6;
    crowdGain = ac.createGain(); crowdGain.gain.value = 0;
    crowd.connect(bp); bp.connect(crowdGain); crowdGain.connect(master); crowd.start();
  }
  function tone(f, dur, type = 'square', vol = 0.05, when = 0, slide = 0) {
    if (!ac) return;
    const t = ac.currentTime + when, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol = 0.08, freq = 1200, when = 0) {
    if (!ac) return;
    const t = ac.currentTime + when, n = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t);
  }
  const SFX = {
    ui: () => tone(660, 0.05, 'square', 0.03),
    hover: () => tone(880, 0.025, 'sine', 0.015),
    coin: () => { tone(988, 0.07, 'square', 0.04); tone(1319, 0.14, 'square', 0.04, 0.06); },
    bet: () => { tone(523, 0.06, 'square', 0.04); tone(784, 0.1, 'square', 0.04, 0.05); noise(0.05, 0.04, 3000, 0.02); },
    deny: () => { tone(220, 0.12, 'square', 0.04); tone(165, 0.16, 'square', 0.04, 0.08); },
    beep: (hi) => tone(hi ? 1046 : 784, hi ? 0.4 : 0.12, 'square', 0.05),
    horn: () => { for (const f of [392, 494, 587]) tone(f, 0.7, 'sawtooth', 0.035); },
    finish: () => { noise(0.9, 0.12, 900); tone(1568, 0.5, 'triangle', 0.05, 0.05); },
    win: () => { [523, 659, 784, 1046, 1319].forEach((f, i) => tone(f, 0.16, 'square', 0.045, i * 0.07)); },
    lose: () => { [392, 370, 349, 311].forEach((f, i) => tone(f, 0.22, 'triangle', 0.05, i * 0.16)); },
    jail: () => { noise(0.25, 0.15, 400); tone(110, 0.5, 'sawtooth', 0.05, 0.05, -40); tone(82, 0.6, 'square', 0.04, 0.2); },
    free: () => { tone(523, 0.1, 'square', 0.04); tone(784, 0.18, 'square', 0.04, 0.1); },
    mine: () => { tone(1800, 0.04, 'square', 0.03); noise(0.08, 0.1, 2400); },
    whoosh: () => noise(0.12, 0.05, 1600),
    crumble: () => { noise(0.3, 0.14, 500); tone(140, 0.2, 'triangle', 0.05, 0, -60); },
    buy: () => { [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.1, 'square', 0.04, i * 0.05)); },
    chat: () => tone(1200, 0.03, 'sine', 0.02),
    pop: () => tone(700, 0.05, 'square', 0.03, 0, 300),
    hop: (pan) => tone(180 + Math.random() * 60, 0.03, 'triangle', 0.012 * pan)
  };
  // 배경 음악: 느긋한 C장조 루프, 경주 중엔 줄임
  const PROG = [[48, 55, 64], [45, 52, 60], [41, 48, 57], [43, 50, 59]];
  const MEL = [76, 79, 81, 79, 76, 74, 72, 74, 76, 72, 69, 72, 74, 76, 74, 71];
  let musicOn = true, step = 0, nextAt = 0, duck = 1;
  const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
  function musicTick() {
    if (!ac || !musicOn || muted) return;
    const spb = 60 / 92 / 2;
    if (nextAt < ac.currentTime) nextAt = ac.currentTime + 0.05;
    while (nextAt < ac.currentTime + 0.2) {
      const bar = Math.floor(step / 8) % 4, ch = PROG[bar], t = nextAt - ac.currentTime, v = 0.35 * duck;
      if (step % 8 === 0) for (const n of ch) mtoneM(mtof(n), spb * 7.5, 'triangle', 0.14 * v, t);
      if (step % 2 === 0) mtoneM(mtof(ch[0] - 12), spb * 1.6, 'triangle', 0.22 * v, t);
      if (step % 2 === 1 && Math.random() < 0.85) mtoneM(mtof(MEL[(step >> 1) % 16]), spb * 1.4, 'square', 0.05 * v, t);
      step++; nextAt += spb;
    }
  }
  function mtoneM(f, dur, type, vol, when) {
    const t = ac.currentTime + when, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + dur + 0.05);
  }
  function setCrowd(level) { if (crowdGain) crowdGain.gain.setTargetAtTime(muted ? 0 : level * 0.5, ac.currentTime, 0.4); }
  function setMuted(m) { muted = m; localStorage.setItem('td-mute', m ? '1' : '0'); if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ac.currentTime, 0.05); }
  window.AUDIO = { init, SFX, musicTick, setCrowd, setMuted, get muted() { return muted; }, set duck(v) { duck = v; } };
})();
