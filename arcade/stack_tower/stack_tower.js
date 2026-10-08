/* ==========================================================================
arcade/stack_tower/stack_tower.js - Jogo de empilhamento em HTML/CSS/JS puro.
Os blocos são elementos DOM; toda a aparência fica no CSS.
Índice: 1 Configuração · 2 Áudio · 3 Estado · 4 Blocos e efeitos · 5 Regras
· 5B Pausa, contagem e salvamento · 6 Atualização · 7 Interface · 8 Entrada · 9 Redimensionamento · 10 Loop
========================================================================== */
(() => {
'use strict';

/* ===== 1. CONFIGURAÇÃO (unidades do mundo 288 x 512 e segundos) ===== */
const CONFIG = {
  world: { width: 288, height: 512 },
  block: { height: 22, baseWidth: 164, maxWidth: 164 },
  groundY: 470,                         // topo do chão
  hover: 62,                            // distância entre o bloco móvel e o topo da torre
  gravity: 1500,                        // queda do bloco solto (px/s²)
  bounds: { min: 8, max: 280 },         // limites da área jogável
  speed: { start: 92, gain: 3.6, max: 300 },   // px/s: cresce a cada bloco colocado
  perfect: { tolerance: 3, regrowAfter: 3, regrow: 5 },
  camera: { followLine: 300, smooth: 5, nightAltitude: 1400 },
  debris: { gravity: 1300 },
  timing: { maxFrameTime: 1 / 30 },
  countdown: { step: 0.7, go: 0.5 },    // 3 · 2 · 1 (step s cada) e GO! (go s)
  save: { version: 1, everyMs: 300 },   // partida salva no máx. a cada 300 ms (e em todo evento importante)
  // howRoom = espaço lateral mínimo para o botão "Como jogar"; abaixo disso ele vai para uma faixa (howStrip, px) sob o palco
  view: { margin: 6, maxCssHeight: 1000, howRoom: 66, howStrip: 56 },
};
const { width: W, height: H } = CONFIG.world;
const BH = CONFIG.block.height;
const STATES = { READY: 'ready', PLAYING: 'playing', PAUSED: 'paused', COUNTDOWN: 'countdown', OVER: 'over' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const $ = (id) => document.getElementById(id);

const ui = {
  arena: $('arena'), stage: $('stage'), scene: $('scene'), tower: $('tower'), fx: $('fx'), guide: $('guide'), pad: $('pad'),
  score: $('score'), best: $('best'), toast: $('toast'), bestChip: document.querySelector('.best-chip'),
  mute: $('mute-button'), pause: $('pause-button'), resume: $('resume-button'), restart: $('restart-button'), reset: $('reset-button'),
  pauseTitle: $('pause-title'), pauseSub: $('pause-sub'), countNum: $('count-num'),
  overScore: $('over-score'), overBest: $('over-best'), badge: $('record-badge'),
  how: $('how-button'), howPop: $('how-popover'), howClose: $('how-close'),
};

// Persistência: stack_tower_storage.js (best, muted); dados antigos são recuperados uma vez, na primeira execução.
const store = window.StackTowerStorage;

/* ===== 2. ÁUDIO (Web Audio, sem arquivos externos) ===== */
const Sound = (() => {
  let ctx = null, master = null, noiseBuf = null, unavailable = false, muted = false, frozen = false;
  muted = store.get('muted', false) === true;

  function ensure() {
    if (unavailable) return null;
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) { unavailable = true; return null; }
      try { ctx = new Ctor(); master = ctx.createGain(); master.gain.value = 0.3; master.connect(ctx.destination); }
      catch (e) { unavailable = true; ctx = null; return null; }
    }
    if (ctx.state === 'suspended' && !frozen) { try { ctx.resume().catch(() => {}); } catch (e) {} }
    return ctx;
  }
  function tone(type, from, to, dur, vol, delay = 0) {
    if (muted || frozen) return;
    const c = ensure(); if (!c) return;
    const t0 = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(from, t0);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol, cutoff) {
    if (muted || frozen) return;
    const c = ensure(); if (!c) return;
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = c.currentTime, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = cutoff;
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t0); s.stop(t0 + dur + 0.02);
  }
  return {
    get muted() { return muted; },
    unlock() { if (!muted) ensure(); },
    // Pausa: suspende o áudio (sons já agendados param junto) e não agenda novos até descongelar
    freeze(on) {
      frozen = on;
      if (on) { if (ctx && ctx.state === 'running') { try { ctx.suspend().catch(() => {}); } catch (e) {} } }
      else if (ctx || !muted) ensure();
    },
    toggle() { muted = !muted; store.set('muted', muted); if (!muted) tone('triangle', 520, 780, 0.08, 0.3); return muted; },
    drop() { tone('sine', 420, 260, 0.1, 0.18); },
    place(level) { const f = 200 + Math.min(level, 30) * 9; tone('triangle', f, f * 0.8, 0.14, 0.5); noise(0.07, 0.25, 900); },
    perfect(combo) { const f = 520 + Math.min(combo, 8) * 60; tone('triangle', f, f, 0.12, 0.4); tone('triangle', f * 1.5, f * 1.5, 0.2, 0.4, 0.08); },
    cut() { noise(0.18, 0.3, 1400); },
    fail() { tone('sawtooth', 300, 70, 0.7, 0.4); noise(0.4, 0.4, 700); },
    record() { [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.18, 0.4, i * 0.1)); },
    click() { tone('square', 600, 600, 0.05, 0.2); },
    tick() { tone('sine', 520, 520, 0.09, 0.3); },
    go() { tone('triangle', 784, 1175, 0.28, 0.4); },
  };
})();

/* ===== 3. ESTADO ===== */
const game = {
  state: STATES.READY, score: 0, level: 0, combo: 0, best: 0, bestAtStart: 0, newRecord: false, toasted: false,
  top: null, active: null, blocks: [], debris: [], cam: 0, camTarget: 0, camShown: null, altShown: null, time: 0,
  pauseReason: null, count: null,   // motivo da pausa ('manual' | 'how' | 'auto' | 'reload') e progresso do 3-2-1
};
game.best = Number(store.get('best', 0)) || 0;

/* ===== 4. BLOCOS E EFEITOS ===== */
const hueOf = (i) => (205 + i * 9) % 360;
function setPos(el, x, y, rot) { el.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0)${rot ? ` rotate(${rot.toFixed(1)}deg)` : ''}`; }

function makeBlock(x, y, w, level, cls) {
  const el = document.createElement('div');
  el.className = `block ${cls || ''}`.trim();
  el.style.width = `${w}px`;
  el.style.setProperty('--h', hueOf(level));
  el.style.setProperty('--ox', x.toFixed(2));
  if (level > 0 && level % 5 === 0) el.classList.add('accent');
  setPos(el, x, y);
  ui.tower.appendChild(el);
  return el;
}

function spawnDebris(x, y, w, level, vx, vy = 0, vr = 90, accent = false) {
  if (w < 0.8) return;
  const el = makeBlock(x, y, w, level, 'debris');
  if (!accent) el.classList.remove('accent');
  game.debris.push({ el, x, y, w, level, accent, vx, vy, rot: 0, vr });
}

function fxEl(cls, text) {
  const el = document.createElement('div');
  el.className = cls; if (text) el.textContent = text;
  el.addEventListener('animationend', () => el.remove());
  ui.fx.appendChild(el);
  return el;
}
function pop(text, x, y, cls) { const el = fxEl(`pop ${cls || ''}`, text); el.style.left = `${x}px`; el.style.top = `${y}px`; }
function ring(x, y, w) { const el = fxEl('ring'); Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${BH}px` }); }
function retrigger(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

/* ===== 5. REGRAS ===== */
function speedFor(level) { const s = CONFIG.speed; return Math.min(s.max, s.start + s.gain * level); }

function clearTower() {
  ui.tower.textContent = ''; ui.fx.textContent = ''; game.blocks = []; game.debris = [];
}

function resetRound() {
  clearTower();
  const bw = CONFIG.block.baseWidth, bx = (W - bw) / 2, by = CONFIG.groundY - BH;
  const el = makeBlock(bx, by, bw, 0, 'base');
  game.top = { x: bx, w: bw, y: by, el };
  game.blocks.push({ el, x: bx, y: by, w: bw, level: 0 });
  game.score = 0; game.level = 0; game.combo = 0; game.cam = 0; game.camTarget = 0; game.newRecord = false; game.toasted = false;
  game.bestAtStart = game.best;
  spawnActive();
  syncHud();
}

function spawnActive() {
  const t = game.top, lvl = game.level + 1, w = t.w;
  const dir = game.level % 2 === 0 ? 1 : -1;
  const x = dir === 1 ? CONFIG.bounds.min : CONFIG.bounds.max - w;
  const y = t.y - BH - CONFIG.hover;
  const el = makeBlock(x, y, w, lvl, 'active');
  game.active = { x, y, w, dir, vy: 0, mode: 'move', el, level: lvl };
}

function dropBlock() {
  const a = game.active;
  if (game.state !== STATES.PLAYING || !a || a.mode !== 'move') return;
  a.mode = 'drop'; a.vy = 80;
  ui.guide.classList.remove('on');
  Sound.drop();
  persist(true);
}

function landBlock() {
  const a = game.active, t = game.top, landY = t.y - BH;
  const left = Math.max(a.x, t.x), right = Math.min(a.x + a.w, t.x + t.w), overlap = right - left;
  a.el.classList.remove('active');

  if (overlap <= 0.5) { missBlock(a, t); return; }

  const perfect = Math.abs(a.x - t.x) <= CONFIG.perfect.tolerance;
  let nx, nw;
  if (perfect) {
    game.combo++;
    nx = t.x; nw = t.w;
    if (game.combo >= CONFIG.perfect.regrowAfter && nw < CONFIG.block.maxWidth) {   // sequência perfeita devolve um pouco de largura
      const g = Math.min(CONFIG.perfect.regrow, CONFIG.block.maxWidth - nw);
      nx = clamp(nx - g / 2, 0, W - (nw + g)); nw += g;
    }
  } else {
    game.combo = 0;
    nx = left; nw = overlap;
    const cutL = t.x - a.x, cutR = (a.x + a.w) - (t.x + t.w);
    if (cutL > 0) spawnDebris(a.x, landY, cutL, a.level, -(18 + Math.random() * 22), 0, -(70 + Math.random() * 70));
    if (cutR > 0) spawnDebris(t.x + t.w, landY, cutR, a.level, 18 + Math.random() * 22, 0, 70 + Math.random() * 70);
    Sound.cut();
  }

  a.el.style.width = `${nw}px`; a.el.style.setProperty('--ox', nx.toFixed(2)); setPos(a.el, nx, landY);
  retrigger(a.el, 'land');
  game.top = { x: nx, w: nw, y: landY, el: a.el };
  game.blocks.push({ el: a.el, x: nx, y: landY, w: nw, level: a.level });
  game.level++;

  const gain = perfect ? 2 : 1;
  game.score += gain;
  Sound.place(game.level);
  if (perfect) {
    ring(nx, landY, nw); Sound.perfect(game.combo);
    pop(game.combo > 1 ? `PERFEITO x${game.combo}` : 'PERFEITO!', nx + nw / 2, landY - 4, 'perfect');
  } else {
    pop(`+${gain}`, nx + nw / 2, landY - 4);
  }
  if (game.score > game.best) { game.best = game.score; game.newRecord = true; saveBest(); }
  if (game.newRecord && game.bestAtStart > 0 && !game.toasted) { game.toasted = true; retrigger(ui.toast, 'show'); retrigger(ui.bestChip, 'pulse'); Sound.record(); }
  syncHud(); retrigger(ui.score, 'bump');

  game.camTarget = Math.max(0, CONFIG.camera.followLine - landY);
  while (game.blocks.length > 2 && game.blocks[0].y + game.camTarget > H + 80) game.blocks.shift().el.remove();
  spawnActive();
  persist(true);
}

function missBlock(a, t) {
  const away = (a.x + a.w / 2) < (t.x + t.w / 2) ? -1 : 1;
  game.debris.push({ el: a.el, x: a.x, y: a.y, w: a.w, vx: away * 40, vy: a.vy, rot: 0, vr: away * 160 });
  game.active = null;
  Sound.fail();
  endGame();
}

function saveBest() { store.set('best', game.best); }

function endGame() {
  game.state = STATES.OVER; game.combo = 0; game.pauseReason = null; game.count = null;
  store.clearRun();   // partida terminada: nada para continuar após F5
  ui.guide.classList.remove('on'); ui.pad.classList.remove('on');
  ui.overScore.textContent = game.score; ui.overBest.textContent = game.best;
  const rec = game.newRecord && game.score > 0;
  ui.badge.classList.toggle('show', rec);
  if (rec) setTimeout(() => { if (game.state === STATES.OVER) Sound.record(); }, 950);
  ui.scene.classList.remove('shake'); void ui.scene.offsetWidth; ui.scene.classList.add('shake');
  setStageState();
  game.lockUntil = performance.now() + 1100;
}

function startGame() {
  Sound.unlock();
  if (game.state !== STATES.READY) return;
  setHowOpen(false);
  game.state = STATES.PLAYING; setStageState(); Sound.click();
  persist(true);
}

function restartGame() {
  Sound.unlock();
  resetRound();
  game.state = STATES.PLAYING; setStageState(); Sound.click();
}
function tryRestart() { if (game.state === STATES.OVER && performance.now() >= (game.lockUntil || 0)) restartGame(); }

/* ===== 5B. PAUSA, CONTAGEM E SALVAMENTO ===== */
// Quatro formas de pausar, todas por pauseGame(motivo): botão/P/Esc ('manual'), aba oculta ('auto'),
// menu "Como jogar" ('how') e partida restaurada após F5 ('reload'). Pausado = nada se move (física, câmera,
// detritos, tempo), animações CSS e áudio ficam congelados. Para voltar: Continuar → contagem 3 · 2 · 1 · GO!
const PAUSE_COPY = {
  manual: ['Pausado', ''],
  how: ['Pausado', 'Menu Como jogar aberto'],
  auto: ['Pausado', 'Você saiu da aba'],
  reload: ['Partida retomada', 'Seu progresso foi restaurado'],
};

function pauseGame(reason = 'manual') {
  if (game.state !== STATES.PLAYING && game.state !== STATES.COUNTDOWN) return;
  game.state = STATES.PAUSED; game.pauseReason = reason; game.count = null; lastTime = null;
  ui.countNum.classList.remove('tick', 'go');
  Sound.freeze(true);
  const copy = PAUSE_COPY[reason] || PAUSE_COPY.manual;
  ui.pauseTitle.textContent = copy[0]; ui.pauseSub.textContent = copy[1];
  setStageState();
  persist(true);
}

// Retomar nunca volta direto ao jogo: passa sempre pela contagem
function resumeGame() {
  if (game.state !== STATES.PAUSED) return;
  Sound.unlock();
  setHowOpen(false, true);
  beginCountdown();
}

function beginCountdown() {
  game.state = STATES.COUNTDOWN; game.pauseReason = null; game.count = { t: 0, i: -1 }; lastTime = null;
  Sound.freeze(false);
  setStageState();
  tickCountdown(0);
}

// Avança pelo dt do loop (e não por setTimeout): se a aba fechar ou pausar no meio, a contagem para junto
function tickCountdown(dt) {
  const c = game.count, cd = CONFIG.countdown;
  if (!c) return;
  c.t += dt;
  if (c.t >= cd.step * 3 + cd.go) { finishCountdown(); return; }
  const i = Math.min(3, Math.floor(c.t / cd.step + 1e-9));
  if (i === c.i) return;
  c.i = i;
  const go = i === 3;
  ui.countNum.textContent = go ? 'GO!' : String(3 - i);
  ui.countNum.classList.toggle('go', go);
  retrigger(ui.countNum, 'tick');
  if (go) Sound.go(); else Sound.tick();
}

function finishCountdown() {
  game.count = null; game.state = STATES.PLAYING; lastTime = null;
  setStageState();
  persist(true);
}

// Reiniciar (tela de pausa): descarta a partida e volta à tela inicial
function quitToMenu() {
  if (game.state !== STATES.PAUSED) return;
  setHowOpen(false, true);
  store.clearRun();
  resetRound();
  game.state = STATES.READY; game.pauseReason = null; game.count = null; lastTime = null;
  ui.toast.classList.remove('show'); ui.bestChip.classList.remove('pulse');
  Sound.freeze(false); Sound.unlock(); Sound.click();
  setStageState();
}

// Salvamento: tudo o que define a partida (posições, velocidades, placar, câmera, tempo, blocos e detritos)
let lastSave = 0;
const r3 = (n) => Math.round(n * 1000) / 1000;
function snapshot() {
  const a = game.active;
  return {
    v: CONFIG.save.version, at: Date.now(),
    score: game.score, level: game.level, combo: game.combo, best: game.best, bestAtStart: game.bestAtStart,
    newRecord: game.newRecord, toasted: game.toasted, time: r3(game.time), cam: r3(game.cam), camTarget: r3(game.camTarget),
    blocks: game.blocks.map((b) => ({ x: r3(b.x), y: r3(b.y), w: r3(b.w), l: b.level })),
    active: a ? { x: r3(a.x), y: r3(a.y), w: r3(a.w), dir: a.dir, vy: r3(a.vy), mode: a.mode, l: a.level } : null,
    debris: game.debris.map((d) => ({ x: r3(d.x), y: r3(d.y), w: r3(d.w), l: d.level || 0, vx: r3(d.vx), vy: r3(d.vy), rot: r3(d.rot), vr: r3(d.vr), a: d.accent ? 1 : 0 })),
  };
}
function persist(force) {
  const s = game.state;
  if ((s !== STATES.PLAYING && s !== STATES.PAUSED && s !== STATES.COUNTDOWN) || !game.active) return;
  const now = performance.now();
  if (!force && now - lastSave < CONFIG.save.everyMs) return;
  lastSave = now;
  store.setRun(snapshot());
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isCount = (v) => Number.isInteger(v) && v >= 0 && v < 1e7;
function validBlock(b) { return !!b && isNum(b.x) && isNum(b.y) && isNum(b.w) && b.w > 0 && b.w <= 400 && isCount(b.l); }

// Reconstrói a partida salva (valida tudo antes de mexer em qualquer coisa); sempre entra pausada ('reload')
function restoreRun(run) {
  try {
    if (!run || run.v !== CONFIG.save.version) return false;
    const a = run.active;
    if (!Array.isArray(run.blocks) || run.blocks.length < 1 || run.blocks.length > 200 || !run.blocks.every(validBlock)) return false;
    if (!validBlock(a) || (a.mode !== 'move' && a.mode !== 'drop') || (a.dir !== 1 && a.dir !== -1) || !isNum(a.vy)) return false;
    if (![run.score, run.level, run.combo, run.bestAtStart].every(isCount) || !isNum(run.cam) || !isNum(run.camTarget) || !isNum(run.time)) return false;
    const debris = (Array.isArray(run.debris) ? run.debris : []).slice(0, 60)
      .filter((d) => validBlock(d) && [d.vx, d.vy, d.rot, d.vr].every(isNum));

    clearTower();
    run.blocks.forEach((b) => {
      const el = makeBlock(b.x, b.y, b.w, b.l, b.l === 0 ? 'base' : '');
      game.blocks.push({ el, x: b.x, y: b.y, w: b.w, level: b.l });
    });
    const t = game.blocks[game.blocks.length - 1];
    game.top = { x: t.x, w: t.w, y: t.y, el: t.el };
    game.active = { x: a.x, y: a.y, w: a.w, dir: a.dir, vy: a.vy, mode: a.mode, el: makeBlock(a.x, a.y, a.w, a.l, 'active'), level: a.l };
    debris.forEach((d) => {
      const el = makeBlock(d.x, d.y, d.w, d.l, 'debris');
      if (!d.a) el.classList.remove('accent');
      setPos(el, d.x, d.y, d.rot);
      game.debris.push({ el, x: d.x, y: d.y, w: d.w, level: d.l, accent: !!d.a, vx: d.vx, vy: d.vy, rot: d.rot, vr: d.vr });
    });
    game.score = run.score; game.level = run.level; game.combo = run.combo; game.bestAtStart = run.bestAtStart;
    game.best = Math.max(game.best, isCount(run.best) ? run.best : 0, run.score);
    game.newRecord = run.newRecord === true; game.toasted = run.toasted === true;
    game.time = run.time; game.cam = run.cam; game.camTarget = run.camTarget; game.camShown = null; game.altShown = null;
    game.state = STATES.PAUSED; game.pauseReason = 'reload';
    Sound.freeze(true);
    ui.pauseTitle.textContent = PAUSE_COPY.reload[0]; ui.pauseSub.textContent = PAUSE_COPY.reload[1];
    syncHud();
    return true;
  } catch (e) { return false; }
}

/* ===== 6. ATUALIZAÇÃO ===== */
function update(dt) {
  const st = game.state, a = game.active;
  if (st === STATES.PAUSED) return;
  if (st === STATES.COUNTDOWN) { tickCountdown(dt); return; }   // contagem: física, câmera, detritos e tempo parados
  game.time += dt;

  if (a && st === STATES.PLAYING) {   // antes de iniciar (READY) nada se move
    if (a.mode === 'move') {
      a.x += a.dir * speedFor(game.level) * dt;
      const min = CONFIG.bounds.min, max = CONFIG.bounds.max - a.w;
      if (a.x <= min) { a.x = min; a.dir = 1; } else if (a.x >= max) { a.x = max; a.dir = -1; }
    } else if (a.mode === 'drop') {
      a.vy += CONFIG.gravity * dt; a.y += a.vy * dt;
      const landY = game.top.y - BH;
      if (a.y >= landY) { a.y = landY; landBlock(); }
    }
  }

  for (let i = game.debris.length - 1; i >= 0; i--) {
    const d = game.debris[i];
    d.vy += CONFIG.debris.gravity * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.rot += d.vr * dt;
    setPos(d.el, d.x, d.y, d.rot);
    if (d.y + game.cam > H + 80) { d.el.remove(); game.debris.splice(i, 1); }
  }

  game.cam += (game.camTarget - game.cam) * (1 - Math.exp(-CONFIG.camera.smooth * dt));
  if (Math.abs(game.camTarget - game.cam) < 0.05) game.cam = game.camTarget;
}

function render() {
  const a = game.active;
  if (a) {
    setPos(a.el, a.x, a.y);
    if (a.mode === 'move') {
      Object.assign(ui.guide.style, { width: `${a.w}px`, height: `${Math.max(0, game.top.y - (a.y + BH))}px`, transform: `translate3d(${a.x.toFixed(2)}px,${a.y + BH}px,0)` });
      const playing = game.state !== STATES.READY && game.state !== STATES.OVER, t = game.top;   // pausado/contagem: guia e faixa continuam congelados na tela
      ui.guide.classList.toggle('on', playing);
      const l = Math.max(a.x, t.x), ov = Math.min(a.x + a.w, t.x + t.w) - l;
      ui.pad.classList.toggle('on', playing && ov > 0);
      ui.pad.classList.toggle('perfect', Math.abs(a.x - t.x) <= CONFIG.perfect.tolerance);
      if (ov > 0) Object.assign(ui.pad.style, { width: `${ov}px`, transform: `translate3d(${l.toFixed(2)}px,${t.y - 4}px,0)` });
    }
  }
  if (game.camShown !== game.cam) { ui.stage.style.setProperty('--cam', game.cam.toFixed(2)); game.camShown = game.cam; }
  const alt = clamp(game.cam / CONFIG.camera.nightAltitude, 0, 1);
  if (game.altShown !== alt) { ui.stage.style.setProperty('--alt', alt.toFixed(3)); game.altShown = alt; }
}

/* ===== 7. INTERFACE ===== */
function setStageState() {
  ['ready', 'playing', 'paused', 'countdown', 'over'].forEach((s) => ui.stage.classList.toggle(`is-${s}`, game.state === s));
  ui.stage.classList.toggle('is-frozen', game.state === STATES.PAUSED || game.state === STATES.COUNTDOWN);   // congela as animações CSS
}
function syncHud() { ui.score.textContent = game.score; ui.best.textContent = game.best; }
function syncMute() {
  const m = Sound.muted;
  ui.mute.classList.toggle('is-muted', m); ui.mute.setAttribute('aria-pressed', String(m));
  ui.mute.setAttribute('aria-label', m ? 'Ativar sons' : 'Silenciar sons');
  ui.mute.setAttribute('data-tip', m ? 'Ativar som · M' : 'Silenciar · M');
}

// Como jogar: popover pequeno ancorado ao botão "?", fora do palco (ao lado dele ou na faixa sob ele).
let howOpen = false;
// Abrir pausa a partida; fechar (se foi ele que pausou) retoma com a contagem. silent = sem mexer na pausa.
function setHowOpen(open, silent) {
  if (open === howOpen) return;
  howOpen = open;
  ui.howPop.hidden = !open;
  ui.how.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) { placeHowPopover(); if (!silent) pauseGame('how'); }
  else if (!silent && game.state === STATES.PAUSED && game.pauseReason === 'how') { Sound.unlock(); beginCountdown(); }
}

// Abaixo do botão; se não couber, acima; se não couber, ao lado. Sempre dentro da arena.
function placeHowPopover() {
  const pop = ui.howPop;
  const a = ui.arena.getBoundingClientRect(), b = ui.how.getBoundingClientRect();
  const pad = 8, gap = 12;
  pop.style.maxHeight = `${Math.max(120, a.height - pad * 2)}px`;
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const bx = b.left - a.left, by = b.top - a.top;
  let place = 'side', left, top, ax = 22, ay = 22;
  if (a.height - (by + b.height + gap) >= ph + pad) place = 'below';
  else if (by - gap >= ph + pad) place = 'above';
  if (place === 'side') {
    left = bx + b.width + gap;
    top = clamp(by, pad, a.height - ph - pad);
    if (left + pw > a.width - pad) left = Math.max(pad, a.width - pw - pad);
    ay = clamp(by + b.height / 2 - top, 16, ph - 16);
  } else {
    left = clamp(bx, pad, a.width - pw - pad);
    top = place === 'below' ? by + b.height + gap : by - gap - ph;
    ax = clamp(bx + b.width / 2 - left, 16, pw - 16);
  }
  pop.dataset.placement = place;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
  pop.style.setProperty('--arrow-x', `${Math.round(ax)}px`);
  pop.style.setProperty('--arrow-y', `${Math.round(ay)}px`);
}

/* ===== 8. ENTRADA ===== */
function onPointerDown(e) {
  if (howOpen && !(e.target.closest && e.target.closest('.how-popover, #how-button'))) { setHowOpen(false); return; }   // toque fora só fecha a ajuda
  if (e.target.closest && e.target.closest('button, a, .how-popover')) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault(); Sound.unlock();
  if (game.state === STATES.READY) startGame();
  else if (game.state === STATES.PLAYING) dropBlock();
}

function onKeyDown(e) {
  const k = e.key, onButton = e.target.closest && e.target.closest('button, a');
  if (k === 'Escape' && howOpen) { e.preventDefault(); setHowOpen(false); return; }
  if (k === ' ' || k === 'ArrowDown' || k === 'Enter' || k === 's' || k === 'S') {
    if (onButton && (k === ' ' || k === 'Enter')) return;      // deixa o botão focado agir sozinho
    e.preventDefault(); if (e.repeat) return;
    Sound.unlock();
    if (game.state === STATES.READY) startGame();
    else if (game.state === STATES.PLAYING) dropBlock();
    else if (game.state === STATES.OVER) tryRestart();
    else if (game.state === STATES.PAUSED && (k === 'Enter' || k === ' ')) resumeGame();
  } else if (k === 'p' || k === 'P' || k === 'Escape') {
    e.preventDefault(); if (e.repeat) return;
    if (game.state === STATES.PLAYING || game.state === STATES.COUNTDOWN) pauseGame('manual');
    else if (game.state === STATES.PAUSED) resumeGame();
  } else if (k === 'm' || k === 'M') {
    Sound.toggle(); syncMute();
  } else if ((k === 'r' || k === 'R') && game.state === STATES.OVER) {
    tryRestart();
  }
}

/* ===== 9. REDIMENSIONAMENTO ===== */
function resize() {
  const { margin, maxCssHeight, howRoom, howStrip } = CONFIG.view, ratio = W / H;
  const availW = Math.max(1, ui.arena.clientWidth - margin * 2);
  const baseH = ui.arena.clientHeight - (ui.arena.classList.contains('how-bottom') ? howStrip : 0);   // altura sem a faixa
  const fit = (h) => {
    let cssH = Math.min(Math.max(1, h - margin * 2), maxCssHeight), cssW = cssH * ratio;
    if (cssW > availW) { cssW = availW; cssH = cssW / ratio; }
    return [Math.floor(cssW), Math.floor(cssH)];
  };
  let [cssW, cssH] = fit(baseH);
  // "Como jogar" fica ao lado do palco; sem espaço lateral, vai para uma faixa sob o palco
  const bottom = (ui.arena.clientWidth - cssW) / 2 < howRoom;
  if (bottom) [cssW, cssH] = fit(baseH - howStrip);
  ui.arena.style.setProperty('--how-strip', `${howStrip}px`);
  ui.arena.classList.toggle('how-bottom', bottom);
  ui.arena.style.setProperty('--stage-w', `${cssW}px`);
  ui.stage.style.width = `${cssW}px`; ui.stage.style.height = `${cssH}px`;
  ui.stage.style.setProperty('--u', `${cssW / W}px`); ui.stage.style.setProperty('--s', String(cssW / W));
  if (howOpen) placeHowPopover();
}

/* ===== 10. LOOP E INICIALIZAÇÃO ===== */
let rafId = null, lastTime = null;
function step(dt) { update(dt); render(); if (game.state === STATES.PLAYING) persist(); }
function frame(now) {
  rafId = requestAnimationFrame(frame);
  if (lastTime === null) lastTime = now;
  const dt = Math.min(Math.max((now - lastTime) / 1000, 0), CONFIG.timing.maxFrameTime);
  lastTime = now;
  step(dt);
}

function init() {
  const run = store.getRun();
  if (!(run && restoreRun(run))) { if (run) store.clearRun(); resetRound(); }   // F5: volta pausada em "Partida retomada"
  syncMute(); setStageState();
  document.addEventListener('pointerdown', onPointerDown, { passive: false });
  document.addEventListener('keydown', onKeyDown, { passive: false });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', () => pauseGame('auto'));
  document.addEventListener('visibilitychange', () => { lastTime = null; if (document.hidden) { pauseGame('auto'); persist(true); } });
  window.addEventListener('pagehide', () => persist(true));
  window.addEventListener('beforeunload', () => persist(true));
  ui.mute.addEventListener('click', (e) => { e.stopPropagation(); Sound.toggle(); syncMute(); ui.mute.blur(); });
  ui.how.addEventListener('click', (e) => { e.stopPropagation(); setHowOpen(!howOpen); ui.how.blur(); });
  ui.howClose.addEventListener('click', (e) => { e.stopPropagation(); setHowOpen(false); ui.howClose.blur(); });
  ui.pause.addEventListener('click', (e) => { e.stopPropagation(); pauseGame('manual'); ui.pause.blur(); });
  ui.resume.addEventListener('click', (e) => { e.stopPropagation(); resumeGame(); });
  ui.reset.addEventListener('click', (e) => { e.stopPropagation(); quitToMenu(); });
  // Tooltips (data-tip): o CSS cuida do atraso; aqui só some na hora ao pressionar e volta quando o mouse sai e entra de novo
  document.querySelectorAll('[data-tip]').forEach((el) => {
    el.addEventListener('pointerdown', () => el.setAttribute('data-tip-off', ''));
    ['pointerenter', 'pointerleave', 'pointercancel'].forEach((t) => el.addEventListener(t, () => el.removeAttribute('data-tip-off')));
  });
  ui.restart.addEventListener('click', (e) => { e.stopPropagation(); tryRestart(); });
  ui.scene.addEventListener('animationend', (e) => { if (e.target === ui.scene) ui.scene.classList.remove('shake'); });
  window.addEventListener('resize', resize); window.addEventListener('orientationchange', resize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  resize();
  render();
  if (rafId === null) rafId = requestAnimationFrame(frame);
}

init();
window.__stackTower = { game, CONFIG, step, dropBlock, startGame, restartGame, pauseGame, resumeGame, quitToMenu };
})();