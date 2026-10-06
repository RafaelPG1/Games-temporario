/* ==========================================================================
classicos/snake/snake.js - Jogo da cobrinha em HTML5 Canvas + JavaScript puro.
Índice: 1 Configuração · 2 Áudio · 3 Estado · 4 Lógica · 5 Efeitos
· 6 Renderização · 7 Interface · 8 Entrada · 9 Redimensionamento · 10 Loop
========================================================================== */
(() => {
'use strict';

/* ===== 1. CONFIGURAÇÃO (unidades = células da grade) ===== */
const CONFIG = {
  cols: 16, rows: 20, startLength: 3, startX: 5,
  tickStart: 150, tickMin: 80, tickStep: 3,   // ms por passo: acelera 3 ms por comida, até 80 ms
  queueMax: 2, swipeDistance: 16, maxCell: 44, margin: 14,
  bodyWidth: 0.78, bulgeSpeed: 14,
  volume: 0.3,
};
const COLORS = {
  head: '#d4ff7e', headEdge: '#4fae5a', bodyHead: '#b8f56a', bodyTail: '#2c9f72', outline: 'rgba(5,20,14,.55)',
  dead: '#8a6b78', deadTail: '#4d4350', berry: '#ff4f7b', leaf: '#7ee08a',
};
const { cols: COLS, rows: ROWS } = CONFIG;
const DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const KEYS = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};
const STATES = { READY: 'ready', PLAYING: 'playing', PAUSED: 'paused', OVER: 'over' };
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const lerp = (a, b, t) => a + (b - a) * t;

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const c = (s) => Math.round(lerp((pa >> s) & 255, (pb >> s) & 255, t));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}
// Persistência: game_storage (registro "snake"). Chaves antigas migradas uma vez, sem sobrescrever dados novos.
const store = GameStorage.game('snake');
store.migrate([{ from: 'snake:best', to: 'best', type: 'int' }, { from: 'snake:muted', to: 'muted', type: 'bool01' }]);

/* ===== 2. ÁUDIO (Web Audio API, sem arquivos externos) ===== */
const Sound = (() => {
  let ctx = null, master = null, unavailable = false, muted = store.get('muted', false) === true;
  function ensure() {
    if (unavailable) return null;
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) { unavailable = true; return null; }
      try {
        ctx = new Ctor(); master = ctx.createGain();
        master.gain.value = CONFIG.volume; master.connect(ctx.destination);
      } catch (e) { unavailable = true; ctx = null; return null; }
    }
    if (ctx.state === 'suspended') { try { ctx.resume().catch(() => {}); } catch (e) {} }
    return ctx;
  }
  function tone({ type = 'square', from, to = from, duration = 0.1, volume = 0.4, delay = 0 }) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + delay, osc = c.createOscillator(), gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain); gain.connect(master);
    osc.start(t0); osc.stop(t0 + duration + 0.02);
  }
  const play = (fn) => { if (muted) return; try { fn(); } catch (e) { /* áudio nunca quebra o jogo */ } };
  return {
    get muted() { return muted; },
    unlock() { if (!muted) play(ensure); },
    setMuted(v) { muted = Boolean(v); store.set('muted', muted); if (!muted) play(ensure); },
    eat() { play(() => { tone({ type: 'square', from: 440, to: 660, duration: 0.07, volume: 0.25 }); tone({ type: 'triangle', from: 660, to: 990, duration: 0.1, volume: 0.35, delay: 0.06 }); }); },
    record() { play(() => [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', from: f, duration: 0.12, volume: 0.35, delay: 0.1 * i }))); },
    hit() { play(() => { tone({ type: 'sawtooth', from: 300, to: 50, duration: 0.5, volume: 0.4 }); tone({ type: 'square', from: 120, to: 40, duration: 0.3, volume: 0.25 }); }); },
    click() { play(() => tone({ type: 'square', from: 520, to: 700, duration: 0.05, volume: 0.2 })); },
  };
})();

/* ===== 3. ESTADO ===== */
const game = {
  state: STATES.READY, time: 0, acc: 0, alpha: 1,
  snake: [], prev: [], dir: DIRS.right, queue: [],
  food: null, foodBorn: 0, score: 0, best: Number(store.get('best', 0)) || 0, newRecord: false,
  bulges: [], particles: [], floats: [], won: false,
};

const ui = {
  play: document.getElementById('play'), arena: document.getElementById('arena'), board: document.getElementById('board'),
  score: document.getElementById('score'), best: document.getElementById('best'), bestCard: document.getElementById('best-card'),
  pause: document.getElementById('pause-button'), mute: document.getElementById('mute-button'),
  resume: document.getElementById('resume-button'), start: document.getElementById('start-button'), restart: document.getElementById('restart-button'),
  overTitle: document.getElementById('over-title'), overScore: document.getElementById('over-score'),
  badge: document.getElementById('record-badge'), toast: document.getElementById('toast'),
};
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
let scale = 1;   // pixels do canvas por célula

/* ===== 4. LÓGICA ===== */
function interval() { return Math.max(CONFIG.tickMin, CONFIG.tickStart - game.score * CONFIG.tickStep); }

function placeFood() {
  const taken = new Set(game.snake.map((s) => s.y * COLS + s.x));
  const free = [];
  for (let i = 0; i < COLS * ROWS; i++) if (!taken.has(i)) free.push(i);
  if (!free.length) { game.food = null; return false; }
  const i = free[Math.floor(Math.random() * free.length)];
  game.food = { x: i % COLS, y: Math.floor(i / COLS) };
  game.foodBorn = game.time;
  return true;
}

function resetRound() {
  const y = Math.floor(ROWS / 2);
  game.snake = Array.from({ length: CONFIG.startLength }, (_, i) => ({ x: CONFIG.startX - i, y }));
  game.prev = game.snake.map((s) => ({ ...s }));
  Object.assign(game, { dir: DIRS.right, queue: [], score: 0, newRecord: false, acc: 0, alpha: 1, won: false, bulges: [], particles: [], floats: [] });
  placeFood();
  ui.board.classList.remove('hit', 'shake');
  updateScore(false);
  setState(STATES.READY);
}

function startGame() {
  if (game.state !== STATES.READY) return;
  Sound.unlock();
  setState(STATES.PLAYING);
}

function turn(name) {
  const d = DIRS[name];
  const last = game.queue.length ? game.queue[game.queue.length - 1] : game.dir;
  if (d === last || (d.x === -last.x && d.y === -last.y)) return;   // repetida ou curva de 180°
  if (game.queue.length < CONFIG.queueMax) game.queue.push(d);
}

function steer(name) {
  if (game.state === STATES.READY) startGame();
  if (game.state === STATES.PLAYING) turn(name);
}

function tick() {
  if (game.queue.length) game.dir = game.queue.shift();
  const old = game.snake, head = old[0];
  const nx = head.x + game.dir.x, ny = head.y + game.dir.y;
  if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return endRound('wall');
  const eating = game.food && nx === game.food.x && ny === game.food.y;
  const solid = eating ? old : old.slice(0, -1);   // a ponta da cauda libera a célula ao andar
  if (solid.some((s) => s.x === nx && s.y === ny)) return endRound('self');
  game.prev = old.map((s) => ({ ...s }));
  game.snake = [{ x: nx, y: ny }, ...old];
  if (eating) game.prev.push({ ...old[old.length - 1] });
  else game.snake.pop();
  if (eating) eat();
}

function eat() {
  const f = game.food;
  game.score++;
  Sound.eat();
  burst(f.x + 0.5, f.y + 0.5, 12, [COLORS.berry, COLORS.leaf, '#fff']);
  if (!reduceMotion) {
    game.bulges.push(game.time);
    game.floats.push({ x: f.x + 0.5, y: f.y + 0.2, t: 0 });
  }
  updateScore(true);
  if (game.score > game.best) {
    const first = !game.newRecord && game.best > 0;
    game.best = game.score; store.set('best', game.best);
    updateBest(true);
    if (first) { game.newRecord = true; showToast('Novo recorde!'); Sound.record(); }
    else if (game.best > 0) game.newRecord = true;
  }
  if (!placeFood()) endRound('win');
}

function endRound(reason) {
  game.won = reason === 'win';
  game.prev = game.snake.map((s) => ({ ...s }));
  game.alpha = 1;
  const h = game.snake[0];
  burst(h.x + 0.5, h.y + 0.5, 24, [COLORS.bodyHead, COLORS.berry, '#fff']);
  if (!game.won) {
    Sound.hit();
    ui.board.classList.remove('shake', 'hit'); void ui.board.offsetWidth;
    if (!reduceMotion) ui.board.classList.add('shake');
    ui.board.classList.add('hit');
  } else Sound.record();
  setState(STATES.OVER);
}

function setPaused(paused) {
  if (paused && game.state === STATES.PLAYING) { setState(STATES.PAUSED); Sound.click(); }
  else if (!paused && game.state === STATES.PAUSED) { setState(STATES.PLAYING); Sound.click(); }
}

function restart() {
  Sound.unlock(); Sound.click();
  resetRound();
  startGame();
}

/* ===== 5. EFEITOS ===== */
function burst(x, y, n, colors) {
  if (reduceMotion) return;
  game.particles.push({ ring: true, x, y, age: 0, life: 0.45 });
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3;
    game.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, age: 0, life: 0.4 + Math.random() * 0.3, r: 0.06 + Math.random() * 0.08, color: colors[i % colors.length] });
  }
}

function updateEffects(dt) {
  for (const p of game.particles) { p.age += dt; if (!p.ring) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; } }
  game.particles = game.particles.filter((p) => p.age < p.life);
  for (const f of game.floats) f.t += dt;
  game.floats = game.floats.filter((f) => f.t < 0.8);
  game.bulges = game.bulges.filter((b) => (game.time - b) * CONFIG.bulgeSpeed < game.snake.length + 3);
}

/* ===== 6. RENDERIZAÇÃO ===== */
function drawFood() {
  const f = game.food;
  if (!f) return;
  const age = game.time - game.foodBorn;
  const pop = age < 0.3 ? 1 + 2.2 * Math.pow(age / 0.3 - 1, 3) + 1.2 * Math.pow(age / 0.3 - 1, 2) : 1;   // surge com leve ressalto
  const r = 0.34 * Math.max(pop, 0) * (1 + 0.05 * Math.sin(game.time * 5));
  const cx = f.x + 0.5, cy = f.y + 0.56;
  ctx.save();
  ctx.shadowColor = 'rgba(255,79,123,.75)'; ctx.shadowBlur = scale * 0.7;
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#ff9bb0'); g.addColorStop(0.55, '#ff3d6e'); g.addColorStop(1, '#c01848');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.beginPath(); ctx.ellipse(cx - r * 0.38, cy - r * 0.4, r * 0.2, r * 0.12, -0.7, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#5b3a1e'; ctx.lineWidth = 0.05 * 1; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.9); ctx.lineTo(cx + r * 0.1, cy - r * 1.35); ctx.stroke();
  ctx.fillStyle = COLORS.leaf;
  ctx.beginPath(); ctx.ellipse(cx + r * 0.5, cy - r * 1.25, r * 0.5, r * 0.22, -0.5, 0, Math.PI * 2); ctx.fill();
}

function bulgeAt(i) {
  let b = 0;
  for (const t of game.bulges) { const d = i - (game.time - t) * CONFIG.bulgeSpeed; b += 0.32 * Math.exp(-d * d / 1.6); }
  return b;
}

function drawSnake() {
  const dead = game.state === STATES.OVER && !game.won;
  const n = game.snake.length, a = game.alpha;
  const pts = game.snake.map((c, i) => {
    const p = game.prev[i] || c;
    return { x: lerp(p.x, c.x, a) + 0.5, y: lerp(p.y, c.y, a) + 0.5 };
  });
  const widths = pts.map((_, i) => CONFIG.bodyWidth * (1 - 0.38 * (n > 1 ? i / (n - 1) : 0)) * (1 + bulgeAt(i)));
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const pass of [0, 1, 2]) {            // 0 contorno, 1 cor, 2 brilho
    for (let i = n - 1; i > 0; i--) {
      const t = i / (n - 1);
      const o = pass === 2 ? -0.12 * widths[i] : 0;   // brilho levemente acima do eixo
      ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y + o); ctx.lineTo(pts[i - 1].x, pts[i - 1].y + o);
      if (pass === 0) { ctx.strokeStyle = COLORS.outline; ctx.lineWidth = widths[i] + 0.12; }
      else if (pass === 1) { ctx.strokeStyle = dead ? mix(COLORS.dead, COLORS.deadTail, t) : mix(COLORS.bodyHead, COLORS.bodyTail, t); ctx.lineWidth = widths[i]; }
      else { ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = widths[i] * 0.3; }
      ctx.stroke();
    }
  }
  ctx.fillStyle = 'rgba(0,40,25,.22)';       // manchas nas costas
  for (let i = 2; i < n; i += 2) { ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, widths[i] * 0.2, 0, Math.PI * 2); ctx.fill(); }
  drawHead(pts[0], dead);
}

function drawHead(p, dead) {
  const d = game.dir, r = CONFIG.bodyWidth * 0.62 * (1 + bulgeAt(0) * 0.5);
  const px = -d.y, py = d.x;                  // perpendicular
  if (!dead && game.state !== STATES.PAUSED && (game.time * 1000) % 1800 < 260) {   // língua
    const bx = p.x + d.x * r * 0.9, by = p.y + d.y * r * 0.9;
    ctx.strokeStyle = COLORS.berry; ctx.lineWidth = 0.07; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + d.x * 0.35, by + d.y * 0.35);
    ctx.moveTo(bx + d.x * 0.35, by + d.y * 0.35); ctx.lineTo(bx + d.x * 0.5 + px * 0.1, by + d.y * 0.5 + py * 0.1);
    ctx.moveTo(bx + d.x * 0.35, by + d.y * 0.35); ctx.lineTo(bx + d.x * 0.5 - px * 0.1, by + d.y * 0.5 - py * 0.1);
    ctx.stroke();
  }
  ctx.fillStyle = COLORS.outline; ctx.beginPath(); ctx.arc(p.x, p.y, r + 0.06, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = dead ? COLORS.dead : COLORS.head; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
  for (const side of [-1, 1]) {
    const ex = p.x + d.x * r * 0.35 + px * side * r * 0.5, ey = p.y + d.y * r * 0.35 + py * side * r * 0.5;
    if (dead) {                               // olhos em X
      ctx.strokeStyle = '#2a1520'; ctx.lineWidth = 0.06; ctx.lineCap = 'round'; ctx.beginPath();
      ctx.moveTo(ex - 0.07, ey - 0.07); ctx.lineTo(ex + 0.07, ey + 0.07); ctx.moveTo(ex + 0.07, ey - 0.07); ctx.lineTo(ex - 0.07, ey + 0.07); ctx.stroke();
    } else {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, ey, r * 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1b2a22'; ctx.beginPath(); ctx.arc(ex + d.x * r * 0.1, ey + d.y * r * 0.1, r * 0.15, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawEffects() {
  for (const p of game.particles) {
    const k = 1 - p.age / p.life;
    if (p.ring) {
      ctx.strokeStyle = `rgba(255,255,255,${0.6 * k})`; ctx.lineWidth = 0.07;
      ctx.beginPath(); ctx.arc(p.x, p.y, 0.3 + (p.age / p.life) * 1.1, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.globalAlpha = k; ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.5 + k), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    }
  }
  ctx.font = '800 0.8px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const f of game.floats) {
    const k = f.t / 0.8;
    ctx.globalAlpha = 1 - k * k; ctx.lineWidth = 0.14; ctx.strokeStyle = '#07140f'; ctx.fillStyle = '#fff';
    ctx.strokeText('+1', f.x, f.y - k * 1.1); ctx.fillText('+1', f.x, f.y - k * 1.1); ctx.globalAlpha = 1;
  }
}

function render() {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, COLS, ROWS);
  drawFood(); drawSnake(); drawEffects();
}

/* ===== 7. INTERFACE ===== */
function setState(s) {
  game.state = s;
  const b = ui.board.classList;
  b.toggle('is-ready', s === STATES.READY); b.toggle('is-playing', s === STATES.PLAYING);
  b.toggle('is-paused', s === STATES.PAUSED); b.toggle('is-over', s === STATES.OVER);
  ui.pause.disabled = s !== STATES.PLAYING;
  if (s === STATES.OVER) {
    ui.overTitle.textContent = game.won ? 'Arena completa!' : 'Fim de jogo';
    ui.overScore.textContent = String(game.score);
    ui.badge.hidden = !game.newRecord;
    ui.restart.focus({ preventScroll: true });
  }
  if (s === STATES.PAUSED) ui.resume.focus({ preventScroll: true });
}

function pop(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
function updateScore(animate) { ui.score.textContent = String(game.score); if (animate) pop(ui.score, 'bump'); }
function updateBest(animate) { ui.best.textContent = String(game.best); if (animate && !reduceMotion) pop(ui.bestCard, 'glow'); }
function showToast(text) { ui.toast.textContent = text; pop(ui.toast, 'show'); }

function syncMute() {
  ui.mute.classList.toggle('is-muted', Sound.muted);
  ui.mute.setAttribute('aria-pressed', Sound.muted ? 'true' : 'false');
  ui.mute.setAttribute('aria-label', Sound.muted ? 'Ativar efeitos sonoros' : 'Silenciar efeitos sonoros');
}
function toggleMute() { Sound.setMuted(!Sound.muted); syncMute(); Sound.click(); }

/* ===== 8. ENTRADA ===== */
function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  Sound.unlock();
  const dir = KEYS[e.code];
  if (dir) { e.preventDefault(); steer(dir); }
  else if (e.code === 'KeyM' && !e.repeat) toggleMute();
  else if ((e.code === 'KeyP' || e.code === 'Escape') && !e.repeat) setPaused(game.state === STATES.PLAYING);
  else if (e.code === 'Space' || e.code === 'Enter') {
    if (e.target.closest && e.target.closest('button')) return;   // deixa o botão focado agir
    e.preventDefault();
    if (game.state === STATES.READY) startGame();
    else if (game.state === STATES.PAUSED) setPaused(false);
    else if (game.state === STATES.OVER) restart();
  }
}

// Deslizar no tabuleiro: cada arrasto acima do limite vira uma curva; toque simples inicia a partida.
const swipe = new Map();
function onPointerDown(e) {
  Sound.unlock();
  e.preventDefault();
  swipe.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: false });
  try { ui.board.setPointerCapture(e.pointerId); } catch (err) {}
}
function onPointerMove(e) {
  const s = swipe.get(e.pointerId);
  if (!s) return;
  const dx = e.clientX - s.x, dy = e.clientY - s.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < CONFIG.swipeDistance) return;
  s.moved = true;
  steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  s.x = e.clientX; s.y = e.clientY;
}
function onPointerUp(e) {
  const s = swipe.get(e.pointerId);
  swipe.delete(e.pointerId);
  if (s && !s.moved && game.state === STATES.READY && e.type === 'pointerup') startGame();
}

/* ===== 9. REDIMENSIONAMENTO ===== */
function resize() {
  const m = CONFIG.margin;
  const aw = ui.play.clientWidth - m * 2, ah = ui.play.clientHeight - m * 2;
  const cell = Math.max(8, Math.min(CONFIG.maxCell, Math.floor(Math.min(aw / COLS, ah / ROWS))));
  const dpr = window.devicePixelRatio || 1;
  ui.arena.style.setProperty('--cell', `${cell}px`);
  ui.arena.style.setProperty('--bw', `${cell * COLS}px`);
  canvas.width = Math.round(cell * COLS * dpr); canvas.height = Math.round(cell * ROWS * dpr);
  scale = canvas.width / COLS;
  render();
}

/* ===== 10. LOOP E INICIALIZAÇÃO ===== */
let lastTime = null;
function frame(now) {
  requestAnimationFrame(frame);
  if (lastTime === null) lastTime = now;
  const dt = Math.min(Math.max((now - lastTime) / 1000, 0), 0.1);
  lastTime = now;
  if (game.state !== STATES.PAUSED) {
    game.time += dt;
    if (game.state === STATES.PLAYING) {
      game.acc += dt * 1000;
      while (game.state === STATES.PLAYING && game.acc >= interval()) { game.acc -= interval(); tick(); }
      game.alpha = game.state === STATES.PLAYING ? Math.min(game.acc / interval(), 1) : 1;
    }
    updateEffects(dt);
  }
  render();
}

function init() {
  resetRound();
  updateBest(false);
  syncMute();
  document.addEventListener('keydown', onKeyDown, { passive: false });
  ui.board.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) onPointerDown(e); });
  ui.board.addEventListener('pointermove', onPointerMove);
  ui.board.addEventListener('pointerup', onPointerUp);
  ui.board.addEventListener('pointercancel', onPointerUp);
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.querySelectorAll('.dir').forEach((btn) => btn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); Sound.unlock(); steer(btn.dataset.dir);
  }));
  ui.mute.addEventListener('click', () => { toggleMute(); ui.mute.blur(); });
  ui.pause.addEventListener('click', () => { setPaused(true); ui.pause.blur(); });
  ui.resume.addEventListener('click', () => setPaused(false));
  ui.start.addEventListener('click', () => { Sound.unlock(); if (game.state === STATES.READY) startGame(); ui.start.blur(); });
  ui.restart.addEventListener('click', restart);
  window.addEventListener('blur', () => setPaused(true));
  document.addEventListener('visibilitychange', () => { lastTime = null; if (document.hidden) setPaused(true); });
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(ui.play);
  resize();
  requestAnimationFrame(frame);
}

init();
window.__snake = { game, CONFIG };
})();