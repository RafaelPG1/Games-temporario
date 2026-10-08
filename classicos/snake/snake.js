/* ==========================================================================
classicos/snake/snake.js - Jogo da cobrinha em HTML5 Canvas + JavaScript puro.
Índice: 1 Configuração · 2 Áudio · 3 Estado · 4 Lógica (4b Pausa, contagem e salvamento) · 5 Efeitos
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
  countFrom: 3, countStep: 0.7, goFlash: 0.6,   // contagem 3·2·1 (s por número) e quanto tempo o "GO!" fica na tela
  saveVersion: 1,                              // formato do salvamento em snake_storage (snake:save)
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
const STATES = { READY: 'ready', PLAYING: 'playing', PAUSED: 'paused', COUNTDOWN: 'countdown', OVER: 'over' };
// Quatro formas de pausar: manual (botão/P/Esc), help (abrir "Como jogar"), auto (aba oculta) e restored (recarregou a página).
const PAUSE_COPY = {
  manual:   { title: 'Pausado', note: '' },
  help:     { title: 'Pausado', note: 'Pausa durante a ajuda' },
  auto:     { title: 'Pausado', note: 'Pausa ao sair da aba' },
  restored: { title: 'Partida retomada', note: 'Seu progresso foi recuperado' },
};
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const lerp = (a, b, t) => a + (b - a) * t;

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const c = (s) => Math.round(lerp((pa >> s) & 255, (pb >> s) & 255, t));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}
// Persistência: tudo passa por snake_storage.js (SnakeStorage), isolado do restante do projeto.

/* ===== 2. ÁUDIO (Web Audio API, sem arquivos externos) ===== */
const Sound = (() => {
  let ctx = null, master = null, unavailable = false, muted = SnakeStorage.isMuted();
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
    setMuted(v) { muted = Boolean(v); SnakeStorage.setMuted(muted); if (!muted) play(ensure); },
    eat() { play(() => { tone({ type: 'square', from: 440, to: 660, duration: 0.07, volume: 0.25 }); tone({ type: 'triangle', from: 660, to: 990, duration: 0.1, volume: 0.35, delay: 0.06 }); }); },
    record() { play(() => [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', from: f, duration: 0.12, volume: 0.35, delay: 0.1 * i }))); },
    hit() { play(() => { tone({ type: 'sawtooth', from: 300, to: 50, duration: 0.5, volume: 0.4 }); tone({ type: 'square', from: 120, to: 40, duration: 0.3, volume: 0.25 }); }); },
    click() { play(() => tone({ type: 'square', from: 520, to: 700, duration: 0.05, volume: 0.2 })); },
    count() { play(() => tone({ type: 'square', from: 440, duration: 0.08, volume: 0.22 })); },
    go() { play(() => { tone({ type: 'square', from: 660, duration: 0.1, volume: 0.25 }); tone({ type: 'triangle', from: 990, duration: 0.18, volume: 0.35, delay: 0.07 }); }); },
  };
})();

/* ===== 3. ESTADO ===== */
const game = {
  state: STATES.READY, time: 0, acc: 0, alpha: 1,
  snake: [], prev: [], dir: DIRS.right, queue: [],
  food: null, foodBorn: 0, score: 0, best: SnakeStorage.getBest(), newRecord: false,
  bulges: [], particles: [], floats: [], won: false,
  pauseReason: 'manual', countdown: null, goFlash: 0,   // pausa: motivo · contagem em curso ({ t, shown }) · tempo restante do "GO!"
};

const ui = {
  play: document.getElementById('play'), stage: document.getElementById('stage'), arena: document.getElementById('arena'), board: document.getElementById('board'),
  score: document.getElementById('score'), best: document.getElementById('best'), bestCard: document.getElementById('best-card'),
  pause: document.getElementById('pause-button'), mute: document.getElementById('mute-button'),
  resume: document.getElementById('resume-button'), restart: document.getElementById('restart-button'),
  helpButton: document.getElementById('help-button'), helpPopover: document.getElementById('help-popover'), helpClose: document.getElementById('help-close'),
  overTitle: document.getElementById('over-title'), overScore: document.getElementById('over-score'),
  badge: document.getElementById('record-badge'), toast: document.getElementById('toast'),
  restartPause: document.getElementById('restart-pause-button'), pauseTitle: document.getElementById('pause-title'), pauseNote: document.getElementById('pause-note'),
  count: document.getElementById('count-screen'), countNum: document.getElementById('count-num'),
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
  Object.assign(game, { dir: DIRS.right, queue: [], score: 0, newRecord: false, acc: 0, alpha: 1, won: false, bulges: [], particles: [], floats: [], countdown: null, goFlash: 0, pauseReason: 'manual' });
  placeFood();
  ui.board.classList.remove('hit', 'shake');
  ui.count.classList.remove('go');
  SnakeStorage.clearGame();               // tela inicial = nenhuma partida a recuperar
  updateScore(false);
  setState(STATES.READY);
}

function startGame() {
  if (game.state !== STATES.READY) return;
  Sound.unlock();
  placeFood();                            // a fruta é sorteada de novo no instante em que a partida começa (nada de "escolher" a posição com F5)
  setState(STATES.PLAYING);
  saveGame();
}

function turn(name) {
  const d = DIRS[name];
  const last = game.queue.length ? game.queue[game.queue.length - 1] : game.dir;
  if (d === last || (d.x === -last.x && d.y === -last.y)) return;   // repetida ou curva de 180°
  if (game.queue.length < CONFIG.queueMax) game.queue.push(d);
}

function steer(name) {   // antes de iniciar (toque ou Space) as direções não fazem nada
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
    game.best = game.score; SnakeStorage.setBest(game.best);
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
  game.goFlash = 0; ui.count.classList.remove('go');
  SnakeStorage.clearGame();               // partida encerrada: nada para retomar
  setState(STATES.OVER);
}

function restart() {   // da tela de fim de jogo: reinicia e já começa
  Sound.unlock(); Sound.click();
  resetRound();
  startGame();
}

function backToStart() {   // da tela de pausa: descarta a partida e volta à tela inicial
  Sound.unlock(); Sound.click();
  closeHelp();
  resetRound();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}

/* ===== 4b. PAUSA, CONTAGEM E SALVAMENTO =====
   Fluxo: PLAYING/COUNTDOWN --setPaused(true, motivo)--> PAUSED --setPaused(false)--> COUNTDOWN (3·2·1·GO!) --> PLAYING.
   Em PAUSED e COUNTDOWN o frame() não avança nada (tempo do jogo, passos, partículas), então tudo fica congelado. */
function setPaused(paused, reason = 'manual') {
  const live = game.state === STATES.PLAYING || game.state === STATES.COUNTDOWN;
  if (paused && live) {
    game.countdown = null;                       // contagem interrompida recomeça do 3
    game.goFlash = 0; ui.count.classList.remove('go');
    game.pauseReason = reason;
    setState(STATES.PAUSED);
    saveGame();
    Sound.click();
  } else if (!paused && game.state === STATES.PAUSED) {
    if (helpOpen) closeHelp();
    beginCountdown();
  }
}

function beginCountdown() {
  game.countdown = { t: 0, shown: 0 };
  setState(STATES.COUNTDOWN);
  showCount(0);
}

function showCount(i) {
  const go = i >= CONFIG.countFrom;
  game.countdown.shown = i;
  ui.countNum.textContent = go ? 'GO!' : String(CONFIG.countFrom - i);
  ui.countNum.classList.toggle('is-go', go);
  pop(ui.countNum, 'tick');
  if (go) Sound.go(); else Sound.count();
}

// Chamado pelo frame() só em COUNTDOWN: o relógio da contagem é o único que anda; o jogo em si segue parado.
function updateCountdown(dt) {
  const c = game.countdown;
  if (!c) return;
  c.t += dt;
  const i = Math.min(Math.floor(c.t / CONFIG.countStep), CONFIG.countFrom);
  if (i === c.shown) return;
  showCount(i);
  if (i < CONFIG.countFrom) return;
  game.countdown = null;                         // GO!: o jogo volta exatamente de onde parou
  game.goFlash = CONFIG.goFlash;
  ui.count.classList.add('go');
  setState(STATES.PLAYING);
  saveGame();
}

// Instantâneo completo: tudo que define "onde o jogador parou" (inclui tempo até o próximo passo e efeitos em andamento).
const dirName = (d) => Object.keys(DIRS).find((k) => DIRS[k] === d) || 'right';
function snapshot() {
  const cell = (c) => ({ x: c.x, y: c.y });
  return {
    v: CONFIG.saveVersion, savedAt: Date.now(),
    snake: game.snake.map(cell), prev: game.prev.map(cell), dir: dirName(game.dir), queue: game.queue.map(dirName),
    food: game.food ? cell(game.food) : null, foodBorn: game.foodBorn,
    score: game.score, newRecord: game.newRecord,
    acc: game.acc, alpha: game.alpha, time: game.time,                 // acc = ms já acumulados rumo ao próximo passo
    bulges: game.bulges.slice(), particles: game.particles.map((p) => ({ ...p })), floats: game.floats.map((f) => ({ ...f })),
  };
}

function saveGame() {
  if (game.state !== STATES.PLAYING && game.state !== STATES.PAUSED && game.state !== STATES.COUNTDOWN) return;
  SnakeStorage.saveGame(snapshot());
}

// Valida tudo antes de aplicar: salvamento corrompido ou adulterado é descartado (volta à tela inicial).
function restoreGame(s) {
  if (!s || typeof s !== 'object' || s.v !== CONFIG.saveVersion) return false;
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const isCell = (c) => Boolean(c) && Number.isInteger(c.x) && Number.isInteger(c.y) && c.x >= 0 && c.y >= 0 && c.x < COLS && c.y < ROWS;
  const dirOf = (n) => (typeof n === 'string' && Object.prototype.hasOwnProperty.call(DIRS, n) ? DIRS[n] : null);
  if (!Number.isInteger(s.score) || s.score < 0) return false;
  if (!Array.isArray(s.snake) || s.snake.length !== CONFIG.startLength + s.score || !s.snake.every(isCell)) return false;
  const taken = new Set();
  for (let i = 0; i < s.snake.length; i++) {
    const c = s.snake[i], k = c.y * COLS + c.x;
    if (taken.has(k)) return false;
    taken.add(k);
    if (i && Math.abs(c.x - s.snake[i - 1].x) + Math.abs(c.y - s.snake[i - 1].y) !== 1) return false;   // corpo contínuo
  }
  const dir = dirOf(s.dir);
  if (!dir || !isCell(s.food) || taken.has(s.food.y * COLS + s.food.x)) return false;
  if (s.snake[0].x + dir.x === s.snake[1].x && s.snake[0].y + dir.y === s.snake[1].y) return false;     // não vira 180°
  if (!Array.isArray(s.queue) || s.queue.length > CONFIG.queueMax) return false;
  const queue = s.queue.map(dirOf);
  if (queue.some((d) => !d)) return false;
  if (![s.acc, s.alpha, s.time, s.foodBorn].every(num) || s.acc < 0 || s.time < 0) return false;

  const list = (a) => (Array.isArray(a) ? a.slice(0, 200) : []);
  const particles = list(s.particles).filter((p) => p && [p.x, p.y, p.age, p.life].every(num)).map((p) => (p.ring
    ? { ring: true, x: p.x, y: p.y, age: p.age, life: p.life }
    : [p.vx, p.vy, p.r].every(num) && typeof p.color === 'string' && p.color.length < 40
      ? { x: p.x, y: p.y, vx: p.vx, vy: p.vy, age: p.age, life: p.life, r: p.r, color: p.color } : null)).filter(Boolean);
  const floats = list(s.floats).filter((f) => f && [f.x, f.y, f.t].every(num)).map((f) => ({ x: f.x, y: f.y, t: f.t }));
  const bulges = list(s.bulges).filter(num);
  const snake = s.snake.map((c) => ({ x: c.x, y: c.y }));
  const prev = Array.isArray(s.prev) && s.prev.length === snake.length && s.prev.every(isCell) ? s.prev.map((c) => ({ x: c.x, y: c.y })) : snake.map((c) => ({ ...c }));

  Object.assign(game, {
    snake, prev, dir, queue, food: { x: s.food.x, y: s.food.y }, foodBorn: Math.min(s.foodBorn, s.time),
    score: s.score, newRecord: Boolean(s.newRecord), time: s.time, won: false, bulges, particles, floats,
    countdown: null, goFlash: 0, pauseReason: 'restored',
  });
  game.acc = Math.min(s.acc, interval());
  game.alpha = Math.min(game.acc / interval(), 1);
  game.best = Math.max(game.best, game.score);
  ui.board.classList.remove('hit', 'shake');
  ui.count.classList.remove('go');
  updateScore(false);
  setState(STATES.PAUSED);                       // aguarda o jogador: "Continuar" (ou Space) dispara o 3·2·1·GO!
  return true;
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
  if (!dead && game.state === STATES.PLAYING && (game.time * 1000) % 1800 < 260) {   // língua (só com o jogo andando)
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
  b.toggle('is-paused', s === STATES.PAUSED); b.toggle('is-countdown', s === STATES.COUNTDOWN); b.toggle('is-over', s === STATES.OVER);
  ui.pause.disabled = s !== STATES.PLAYING && s !== STATES.COUNTDOWN;
  if (s === STATES.PAUSED) {
    const copy = PAUSE_COPY[game.pauseReason] || PAUSE_COPY.manual;
    ui.pauseTitle.textContent = copy.title;
    ui.pauseNote.textContent = copy.note; ui.pauseNote.hidden = !copy.note;
  }
  if (s === STATES.OVER) {
    ui.overTitle.textContent = game.won ? 'Arena completa!' : 'Fim de jogo';
    ui.overScore.textContent = String(game.score);
    ui.badge.hidden = !game.newRecord;
    ui.restart.focus({ preventScroll: true });
  }
  if (s === STATES.PAUSED && !helpOpen) ui.resume.focus({ preventScroll: true });
}

function pop(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
function updateScore(animate) { ui.score.textContent = String(game.score); if (animate) pop(ui.score, 'bump'); }
function updateBest(animate) { ui.best.textContent = String(game.best); if (animate && !reduceMotion) pop(ui.bestCard, 'glow'); }
function showToast(text) { ui.toast.textContent = text; pop(ui.toast, 'show'); }

function syncMute() {
  ui.mute.classList.toggle('is-muted', Sound.muted);
  ui.mute.setAttribute('aria-pressed', Sound.muted ? 'true' : 'false');
  ui.mute.setAttribute('aria-label', Sound.muted ? 'Ativar efeitos sonoros' : 'Silenciar efeitos sonoros');
  setTip(ui.mute, Sound.muted ? 'Ativar som' : 'Silenciar');
}
function toggleMute() { Sound.setMuted(!Sound.muted); syncMute(); Sound.click(); }

// Tooltips: o texto vem de data-tip (e a tecla de atalho de data-key); o JS cria o balão .tip e o posiciona dentro da tela.
// Atraso, aparecimento e desaparecimento são todos CSS (--tip-delay). Aqui só: clique esconde até o mouse sair (data-tip-off).
function setTip(btn, text, key = btn.dataset.key) {
  btn.dataset.tip = text;
  let tip = btn.querySelector(':scope > .tip');
  if (!tip) { tip = document.createElement('span'); tip.className = 'tip'; tip.setAttribute('aria-hidden', 'true'); btn.append(tip); }
  tip.textContent = text;
  if (key) { const k = document.createElement('kbd'); k.className = 'tip-key'; k.textContent = key; tip.append(k); }
}
function placeTip(btn) {
  const tip = btn.querySelector(':scope > .tip');
  if (!tip) return;
  const edge = 8, gap = 10, r = btn.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  const center = r.left + r.width / 2, left = center - w / 2, right = center + w / 2, vw = document.documentElement.clientWidth;
  const shift = left < edge ? edge - left : right > vw - edge ? vw - edge - right : 0;
  tip.style.setProperty('--tip-x', `${Math.round(shift)}px`);
  tip.style.setProperty('--tip-arrow', `${Math.round(Math.min(Math.max(w / 2 - shift, 12), w - 12))}px`);
  tip.dataset.side = window.innerHeight - r.bottom - gap - edge >= h ? 'bottom' : 'top';
}
function initTips() {
  document.querySelectorAll('[data-tip]').forEach((btn) => {
    setTip(btn, btn.dataset.tip);
    btn.addEventListener('pointerenter', () => placeTip(btn));
    btn.addEventListener('focus', () => placeTip(btn));
    btn.addEventListener('pointerdown', () => btn.setAttribute('data-tip-off', ''));
    btn.addEventListener('pointerleave', () => btn.removeAttribute('data-tip-off'));
    btn.addEventListener('pointercancel', () => btn.removeAttribute('data-tip-off'));
  });
}

// Ajuda "Como jogar": popover pequeno ancorado ao botão "?", fora do tabuleiro. Se abrir no meio da
// partida, o jogo pausa (o painel pode cobrir parte do campo); ao fechar, a pausa continua até "Continuar".
let helpOpen = false;
const HELP = { gap: 12, edge: 8, maxWidth: 260, minSide: 200, button: 40 };

function openHelp() {
  if (helpOpen) return;
  helpOpen = true;
  ui.helpPopover.hidden = false;
  ui.helpButton.setAttribute('aria-expanded', 'true');
  setPaused(true, 'help');                  // só tem efeito durante a partida (ou a contagem)
  placeHelp();
}

function closeHelp() {
  if (!helpOpen) return;
  helpOpen = false;
  ui.helpPopover.hidden = true;
  ui.helpButton.setAttribute('aria-expanded', 'false');
}

// Preferência: abrir ABAIXO do botão. Se não couber, abre acima; se ainda assim não couber
// (celular deitado), limita a altura e deixa o conteúdo rolar.
function placeHelp() {
  if (!helpOpen) return;
  const pop = ui.helpPopover;
  for (const v of ['max-height', 'overflow-y']) pop.style.removeProperty(v);
  const arena = ui.arena.getBoundingClientRect();
  const btn = ui.helpButton.getBoundingClientRect();
  const view = { top: 0, bottom: window.innerHeight };
  const width = Math.floor(Math.min(HELP.maxWidth, arena.width - HELP.edge * 2));
  const left = Math.max(arena.left + HELP.edge, Math.min(btn.left, arena.right - HELP.edge - width));
  pop.style.width = `${width}px`;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.setProperty('--arrow-x', `${Math.round(Math.min(Math.max(btn.left + btn.width / 2 - left, 16), width - 16))}px`);
  const height = pop.offsetHeight;
  const roomBelow = view.bottom - btn.bottom - HELP.gap - HELP.edge;
  const roomAbove = btn.top - view.top - HELP.gap - HELP.edge;
  let placement = 'below';
  // Com o botão ao lado do tabuleiro, abre sempre abaixo dele (rola se faltar altura); só inverte quando o botão está sob o tabuleiro.
  if (ui.stage.dataset.helpPos !== 'side' && height > roomBelow && roomAbove > roomBelow) placement = 'above';
  const room = placement === 'below' ? roomBelow : roomAbove;
  if (height > room) { pop.style.maxHeight = `${Math.max(96, Math.floor(room))}px`; pop.style.overflowY = 'auto'; }
  const finalHeight = pop.offsetHeight;
  pop.style.top = `${Math.round(placement === 'below' ? btn.bottom + HELP.gap : btn.top - HELP.gap - finalHeight)}px`;
  pop.dataset.placement = placement;
}

/* ===== 8. ENTRADA ===== */
function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (helpOpen && e.code === 'Escape') { e.preventDefault(); closeHelp(); ui.helpButton.focus({ preventScroll: true }); return; }
  Sound.unlock();
  const dir = KEYS[e.code];
  if (dir) { e.preventDefault(); steer(dir); }
  else if (e.code === 'KeyM' && !e.repeat) toggleMute();
  else if ((e.code === 'KeyP' || e.code === 'Escape') && !e.repeat) setPaused(game.state === STATES.PLAYING || game.state === STATES.COUNTDOWN);
  else if (e.code === 'Space' || e.code === 'Enter') {
    if (e.target.closest && e.target.closest('button')) return;   // deixa o botão focado agir
    e.preventDefault();
    if (game.state === STATES.READY) startGame();
    else if (game.state === STATES.PAUSED) setPaused(false);
    else if (game.state === STATES.OVER) restart();
  }
}

// Tocar/clicar no tabuleiro inicia a partida (sem botão "Jogar"); depois, cada arrasto acima do limite vira uma curva.
// Com a ajuda aberta, o primeiro toque fora dela só a fecha.
const swipe = new Map();
let helpClosedBy = null;
function onPointerDown(e) {
  if (helpClosedBy === e) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  Sound.unlock();
  e.preventDefault();
  if (game.state === STATES.READY) startGame();
  swipe.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { ui.board.setPointerCapture(e.pointerId); } catch (err) {}
}
function onPointerMove(e) {
  const s = swipe.get(e.pointerId);
  if (!s) return;
  const dx = e.clientX - s.x, dy = e.clientY - s.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < CONFIG.swipeDistance) return;
  steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  s.x = e.clientX; s.y = e.clientY;
}
function onPointerUp(e) {
  swipe.delete(e.pointerId);
}

/* ===== 9. REDIMENSIONAMENTO ===== */
function resize() {
  const m = CONFIG.margin;
  const aw = ui.play.clientWidth - m * 2, ah = ui.play.clientHeight - m * 2;
  // O botão "?" fica fora do tabuleiro: ao lado (reserva dos dois lados, para o jogo seguir centralizado)
  // ou, se faltar largura, logo abaixo. Escolhe o formato que permite o maior tabuleiro.
  const extra = (c) => HELP.button + HELP.gap + Math.ceil(c * 0.4);
  const fitCell = (pos) => {
    for (let c = CONFIG.maxCell; c > 8; c--) {
      const okW = pos === 'side' ? c * COLS + 2 * extra(c) <= aw : c * COLS <= aw;
      const okH = pos === 'side' ? c * ROWS <= ah : c * ROWS + extra(c) <= ah;
      if (okW && okH) return c;
    }
    return 8;
  };
  const side = fitCell('side'), below = fitCell('below');
  const helpPos = side >= below ? 'side' : 'below';
  const cell = helpPos === 'side' ? side : below;
  ui.stage.dataset.helpPos = helpPos;
  const dpr = window.devicePixelRatio || 1;
  ui.arena.style.setProperty('--cell', `${cell}px`);
  ui.arena.style.setProperty('--bw', `${cell * COLS}px`);
  canvas.width = Math.round(cell * COLS * dpr); canvas.height = Math.round(cell * ROWS * dpr);
  scale = canvas.width / COLS;
  render();
  placeHelp();     // reposiciona o painel de ajuda, se estiver aberto
}

/* ===== 10. LOOP E INICIALIZAÇÃO ===== */
let lastTime = null;
function frame(now) {
  requestAnimationFrame(frame);
  if (lastTime === null) lastTime = now;
  const dt = Math.min(Math.max((now - lastTime) / 1000, 0), 0.1);
  lastTime = now;
  if (game.state === STATES.COUNTDOWN) updateCountdown(dt);   // só o relógio da contagem anda; física e timers ficam parados
  else if (game.state !== STATES.PAUSED) {
    game.time += dt;
    if (game.goFlash > 0) { game.goFlash -= dt; if (game.goFlash <= 0) ui.count.classList.remove('go'); }
    if (game.state === STATES.PLAYING) {
      game.acc += dt * 1000;
      let stepped = false;
      while (game.state === STATES.PLAYING && game.acc >= interval()) { game.acc -= interval(); tick(); stepped = true; }
      game.alpha = game.state === STATES.PLAYING ? Math.min(game.acc / interval(), 1) : 1;
      if (stepped) saveGame();
    }
    updateEffects(dt);
  }
  render();
}

function init() {
  initTips();
  const saved = SnakeStorage.loadGame();
  if (!(saved && restoreGame(saved))) resetRound();   // sem salvamento válido: tela inicial (e descarta o lixo)
  updateBest(false);
  syncMute();
  document.addEventListener('keydown', onKeyDown, { passive: false });
  document.addEventListener('pointerdown', (e) => {
    if (helpOpen && !(e.target.closest && e.target.closest('#help-popover, #help-button'))) { closeHelp(); helpClosedBy = e; }
  }, true);
  ui.board.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) onPointerDown(e); });
  ui.board.addEventListener('pointermove', onPointerMove);
  ui.board.addEventListener('pointerup', onPointerUp);
  ui.board.addEventListener('pointercancel', onPointerUp);
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.querySelectorAll('.dir').forEach((btn) => btn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); Sound.unlock(); steer(btn.dataset.dir);
  }));
  ui.helpButton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (helpOpen) closeHelp(); else openHelp();
    if (e.detail > 0) ui.helpButton.blur();   // clique/toque: Espaço não deve acionar o botão depois
  });
  ui.helpClose.addEventListener('click', (e) => { e.stopPropagation(); closeHelp(); ui.helpButton.focus({ preventScroll: true }); });
  ui.mute.addEventListener('click', () => { toggleMute(); ui.mute.blur(); });
  ui.pause.addEventListener('click', () => { setPaused(true, 'manual'); ui.pause.blur(); });
  ui.resume.addEventListener('click', () => setPaused(false));
  ui.restartPause.addEventListener('click', backToStart);
  ui.restart.addEventListener('click', restart);
  // Pausa automática ao sair da aba/minimizar; ao voltar o jogo segue pausado até o jogador continuar.
  document.addEventListener('visibilitychange', () => { lastTime = null; if (document.hidden) { setPaused(true, 'auto'); saveGame(); } });
  // F5/fechar/trocar de página: grava o estado exato (tempo até o próximo passo incluso) para o init() recuperar.
  window.addEventListener('pagehide', saveGame);
  window.addEventListener('beforeunload', saveGame);
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(ui.play);
  resize();
  requestAnimationFrame(frame);
}

init();
window.__snake = { game, CONFIG };
})();