/* ==========================================================================
arcade/stack_tower/stack_tower.js - Jogo de empilhamento em HTML/CSS/JS puro.
Os blocos são elementos DOM; toda a aparência fica no CSS.
Índice: 1 Configuração · 2 Áudio · 3 Estado · 4 Blocos e efeitos · 5 Regras
· 6 Atualização · 7 Interface · 8 Entrada · 9 Redimensionamento · 10 Loop
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
  // howRoom = espaço lateral mínimo para o botão "Como jogar"; abaixo disso ele vai para uma faixa (howStrip, px) sob o palco
  view: { margin: 6, maxCssHeight: 1000, howRoom: 66, howStrip: 56 },
};
const { width: W, height: H } = CONFIG.world;
const BH = CONFIG.block.height;
const STATES = { READY: 'ready', PLAYING: 'playing', PAUSED: 'paused', OVER: 'over' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const $ = (id) => document.getElementById(id);

const ui = {
  arena: $('arena'), stage: $('stage'), scene: $('scene'), tower: $('tower'), fx: $('fx'), guide: $('guide'), pad: $('pad'),
  score: $('score'), best: $('best'), toast: $('toast'), bestChip: document.querySelector('.best-chip'),
  mute: $('mute-button'), pause: $('pause-button'), resume: $('resume-button'), restart: $('restart-button'),
  overScore: $('over-score'), overBest: $('over-best'), badge: $('record-badge'),
  how: $('how-button'), howPop: $('how-popover'), howClose: $('how-close'),
};

// Persistência: stack_tower_storage.js (best, muted); dados antigos são recuperados uma vez, na primeira execução.
const store = window.StackTowerStorage;

/* ===== 2. ÁUDIO (Web Audio, sem arquivos externos) ===== */
const Sound = (() => {
  let ctx = null, master = null, noiseBuf = null, unavailable = false, muted = false;
  muted = store.get('muted', false) === true;

  function ensure() {
    if (unavailable) return null;
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) { unavailable = true; return null; }
      try { ctx = new Ctor(); master = ctx.createGain(); master.gain.value = 0.3; master.connect(ctx.destination); }
      catch (e) { unavailable = true; ctx = null; return null; }
    }
    if (ctx.state === 'suspended') { try { ctx.resume().catch(() => {}); } catch (e) {} }
    return ctx;
  }
  function tone(type, from, to, dur, vol, delay = 0) {
    if (muted) return;
    const c = ensure(); if (!c) return;
    const t0 = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(from, t0);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol, cutoff) {
    if (muted) return;
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
    toggle() { muted = !muted; store.set('muted', muted); if (!muted) tone('triangle', 520, 780, 0.08, 0.3); return muted; },
    drop() { tone('sine', 420, 260, 0.1, 0.18); },
    place(level) { const f = 200 + Math.min(level, 30) * 9; tone('triangle', f, f * 0.8, 0.14, 0.5); noise(0.07, 0.25, 900); },
    perfect(combo) { const f = 520 + Math.min(combo, 8) * 60; tone('triangle', f, f, 0.12, 0.4); tone('triangle', f * 1.5, f * 1.5, 0.2, 0.4, 0.08); },
    cut() { noise(0.18, 0.3, 1400); },
    fail() { tone('sawtooth', 300, 70, 0.7, 0.4); noise(0.4, 0.4, 700); },
    record() { [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.18, 0.4, i * 0.1)); },
    click() { tone('square', 600, 600, 0.05, 0.2); },
  };
})();

/* ===== 3. ESTADO ===== */
const game = {
  state: STATES.READY, score: 0, level: 0, combo: 0, best: 0, bestAtStart: 0, newRecord: false, toasted: false,
  top: null, active: null, blocks: [], debris: [], cam: 0, camTarget: 0, camShown: null, altShown: null, time: 0,
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
  game.debris.push({ el, x, y, w, vx, vy, rot: 0, vr });
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
  game.blocks.push({ el, y: by });
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
  game.blocks.push({ el: a.el, y: landY });
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
  game.state = STATES.OVER; game.combo = 0;
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
}

function restartGame() {
  Sound.unlock();
  resetRound();
  game.state = STATES.PLAYING; setStageState(); Sound.click();
}
function tryRestart() { if (game.state === STATES.OVER && performance.now() >= (game.lockUntil || 0)) restartGame(); }

function setPaused(p) {
  if (p && game.state === STATES.PLAYING) { game.state = STATES.PAUSED; setStageState(); }
  else if (!p && game.state === STATES.PAUSED) { game.state = STATES.PLAYING; lastTime = null; setStageState(); }
}

/* ===== 6. ATUALIZAÇÃO ===== */
function update(dt) {
  const st = game.state, a = game.active;
  if (st === STATES.PAUSED) return;
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
      const playing = game.state === STATES.PLAYING, t = game.top;
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
  ['ready', 'playing', 'paused', 'over'].forEach((s) => ui.stage.classList.toggle(`is-${s}`, game.state === s));
}
function syncHud() { ui.score.textContent = game.score; ui.best.textContent = game.best; }
function syncMute() {
  const m = Sound.muted;
  ui.mute.classList.toggle('is-muted', m); ui.mute.setAttribute('aria-pressed', String(m));
  ui.mute.setAttribute('aria-label', m ? 'Ativar sons' : 'Silenciar sons');
}

// Como jogar: popover pequeno ancorado ao botão "?", fora do palco (ao lado dele ou na faixa sob ele).
let howOpen = false;
function setHowOpen(open) {
  if (open === howOpen) return;
  howOpen = open;
  ui.howPop.hidden = !open;
  ui.how.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) placeHowPopover();
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
    else if (game.state === STATES.PAUSED && k === 'Enter') setPaused(false);
  } else if (k === 'p' || k === 'P' || k === 'Escape') {
    e.preventDefault(); if (e.repeat) return; setPaused(game.state === STATES.PLAYING);
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
function step(dt) { update(dt); render(); }
function frame(now) {
  rafId = requestAnimationFrame(frame);
  if (lastTime === null) lastTime = now;
  const dt = Math.min(Math.max((now - lastTime) / 1000, 0), CONFIG.timing.maxFrameTime);
  lastTime = now;
  step(dt);
}

function init() {
  resetRound(); syncMute(); setStageState();
  document.addEventListener('pointerdown', onPointerDown, { passive: false });
  document.addEventListener('keydown', onKeyDown, { passive: false });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', () => setPaused(true));
  document.addEventListener('visibilitychange', () => { lastTime = null; if (document.hidden) setPaused(true); });
  ui.mute.addEventListener('click', (e) => { e.stopPropagation(); Sound.toggle(); syncMute(); ui.mute.blur(); });
  ui.how.addEventListener('click', (e) => { e.stopPropagation(); setHowOpen(!howOpen); ui.how.blur(); });
  ui.howClose.addEventListener('click', (e) => { e.stopPropagation(); setHowOpen(false); ui.howClose.blur(); });
  ui.pause.addEventListener('click', (e) => { e.stopPropagation(); setPaused(true); ui.pause.blur(); });
  ui.resume.addEventListener('click', (e) => { e.stopPropagation(); setPaused(false); });
  ui.restart.addEventListener('click', (e) => { e.stopPropagation(); tryRestart(); });
  ui.scene.addEventListener('animationend', (e) => { if (e.target === ui.scene) ui.scene.classList.remove('shake'); });
  window.addEventListener('resize', resize); window.addEventListener('orientationchange', resize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  resize();
  render();
  if (rafId === null) rafId = requestAnimationFrame(frame);
}

init();
window.__stackTower = { game, CONFIG, step, dropBlock, startGame, restartGame, setPaused };
})();