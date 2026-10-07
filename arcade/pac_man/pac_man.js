'use strict';
/* Pac-Man · Arcádia. O mapa (MAP) é a fonte de verdade de movimento, colisão, coleta e IA. O estado fica em G; o canvas só o desenha. */
const MAP = [
  '###################',
  '#........#........#',
  '#o##.###.#.###.##o#',
  '#.................#',
  '#.##.#.#####.#.##.#',
  '#....#...#...#....#',
  '####.### # ###.####',
  '   #.#   B   #.#   ',
  '####.# ##-## #.####',
  '    .  #123#  .    ',
  '####.# ##### #.####',
  '   #.#       #.#   ',
  '####.# ##### #.####',
  '#........#........#',
  '#.##.###.#.###.##.#',
  '#o.#.....P.....#.o#',
  '##.#.#.#####.#.#.##',
  '#....#...#...#....#',
  '#.######.#.######.#',
  '#.................#',
  '###################',
];
const COLS = 19, ROWS = 21, T = 16, CW = COLS * T, CH = ROWS * T;
const W = 288, H = 512, MARGIN = 6, MAX_CSS_HEIGHT = 1000;
// Persistência: pacman_storage.js (recorde, fase mais alta e som), exclusivo do Pac-Man.
const store = PacmanStorage;
const HOW_STRIP = 56, HOW_SIDE_MIN = 68; // faixa do botão "?" sob o palco / espaço lateral mínimo para ele ficar ao lado
const HOME = { c: 9, r: 9 }, EXIT = { c: 9, r: 7 };
const DIRS = { up: { x: 0, y: -1 }, left: { x: -1, y: 0 }, down: { x: 0, y: 1 }, right: { x: 1, y: 0 } };
const DLIST = [DIRS.up, DIRS.left, DIRS.down, DIRS.right]; // ordem de desempate clássica
const GHOSTS = {
  blinky: { color: '#ff3b30', corner: { c: 17, r: 0 }, rel: 0 },
  pinky:  { color: '#ff8fd0', corner: { c: 1, r: 0 }, rel: 1.2 },
  inky:   { color: '#2de2e6', corner: { c: 17, r: 20 }, rel: 4 },
  clyde:  { color: '#ffa630', corner: { c: 1, r: 20 }, rel: 7 },
};
const SCHEDULE = [[7, 'scatter'], [20, 'chase'], [7, 'scatter'], [20, 'chase'], [5, 'scatter'], [20, 'chase'], [5, 'scatter'], [Infinity, 'chase']];
const READY_S = 1.8, DYING_S = 1.5, CLEAR_S = 2.2, HIT_R = 0.7;
const $ = (id) => document.getElementById(id);
const ui = {
  arena: $('arena'), stage: $('stage'), canvas: $('canvas'), score: $('score'), lives: $('lives'), level: $('level'), best: $('best'),
  mute: $('mute-button'), pause: $('pause-button'), startScreen: document.querySelector('.screen-start'),
};
const how = { btn: $('how-button'), pop: $('how-popover'), close: $('how-close') };
const ctx = ui.canvas.getContext('2d');


/* ===== Mapa: parsing, validação e alcançabilidade ===== */
const wrapC = (c) => ((c % COLS) + COLS) % COLS;
const Maze = (() => {
  const wall = [], door = [], dots = [];
  let pac = null; const ghostAt = {};
  for (let r = 0; r < ROWS; r++) {
    wall.push([]); door.push([]); dots.push([]);
    for (let c = 0; c < COLS; c++) {
      const ch = MAP[r][c];
      wall[r][c] = ch === '#'; door[r][c] = ch === '-'; dots[r][c] = ch === '.' ? 1 : ch === 'o' ? 2 : 0;
      if (ch === 'P') pac = { c, r };
      if (ch === 'B') ghostAt.blinky = { c, r };
      if (ch === '1') ghostAt.inky = { c, r };
      if (ch === '2') ghostAt.pinky = { c, r };
      if (ch === '3') ghostAt.clyde = { c, r };
    }
  }
  const void_ = wall.map((row) => row.map(() => false));
  const open = (c, r, allowDoor) => r >= 0 && r < ROWS && !wall[r][wrapC(c)] && (allowDoor || !door[r][wrapC(c)]);
  // Tudo que não é alcançável a partir do Pac-Man vira vazio sólido: nenhuma bolinha fica inacessível
  const seen = wall.map((row) => row.map(() => false)), q = [[pac.c, pac.r]]; seen[pac.r][pac.c] = true;
  while (q.length) {
    const [c, r] = q.shift();
    for (const d of DLIST) {
      const nc = wrapC(c + d.x), nr = r + d.y;
      if (open(nc, nr, true) && !seen[nr][nc]) { seen[nr][nc] = true; q.push([nc, nr]); }
    }
  }
  let total = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!wall[r][c] && !seen[r][c]) { wall[r][c] = true; void_[r][c] = true; door[r][c] = false; dots[r][c] = 0; }
    if (dots[r][c]) total++;
  }
  return { wall, door, dots, void_, open, pac, ghostAt, total };
})();

/* BFS a partir do alvo: mapa de distâncias (portas liberadas) para fantasmas que voltam à base ou saem dela */
function bfsFrom(tc, tr) {
  const dist = Array.from({ length: ROWS }, () => new Array(COLS).fill(-1)), q = [[tc, tr]]; dist[tr][tc] = 0;
  for (let i = 0; i < q.length; i++) {
    const [c, r] = q[i];
    for (const d of DLIST) {
      const nc = wrapC(c + d.x), nr = r + d.y;
      if (Maze.open(nc, nr, true) && dist[nr][nc] < 0) { dist[nr][nc] = dist[r][c] + 1; q.push([nc, nr]); }
    }
  }
  return dist;
}

/* ===== Estado do jogo ===== */
const G = {
  state: 'title',   // title | ready | play | dying | clear | over
  paused: false, score: 0, lives: 3, level: 1, best: 0, bestAtStart: 0, newRecord: false,
  dots: [], left: 0, mode: 'scatter', modeIdx: 0, modeT: 0, fright: 0, chain: 0,
  t: 0, stateT: 0, P: null, ghosts: [], fx: [], pops: [], muted: false, eatAlt: 0,
};
G.best = store.getBest();
G.bestLevel = store.getBestLevel();   // estatística: fase mais alta alcançada em uma partida
G.muted = store.getMuted();

/* ===== Áudio (Web Audio, sem arquivos externos) ===== */
const Sound = (() => {
  let ac = null, master = null, off = false, lastChomp = 0;
  function ensure() {
    if (off) return null;
    if (!ac) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) { off = true; return null; }
      try { ac = new C(); master = ac.createGain(); master.gain.value = 0.22; master.connect(ac.destination); }
      catch (e) { off = true; ac = null; return null; }
    }
    if (ac.state === 'suspended') { try { ac.resume().catch(() => {}); } catch (e) {} }
    return ac;
  }
  function tone(from, to, dur, type = 'square', vol = 0.35, delay = 0) {
    if (G.muted) return;
    try {
      const c = ensure(); if (!c) return;
      const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(from, t);
      if (to !== from) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* áudio nunca quebra o jogo */ }
  }
  return {
    unlock() { if (!G.muted) { try { ensure(); } catch (e) {} } },
    chomp() { // limitado a ~9 por segundo, alternando dois tons
      const n = performance.now(); if (n - lastChomp < 110) return; lastChomp = n;
      G.eatAlt ^= 1; tone(G.eatAlt ? 330 : 247, G.eatAlt ? 247 : 330, 0.08, 'triangle', 0.3);
    },
    power() { tone(200, 700, 0.3, 'sawtooth', 0.25); },
    ghost() { tone(400, 1200, 0.25, 'square', 0.3); },
    death() { for (let i = 0; i < 6; i++) tone(700 - i * 90, 400 - i * 55, 0.2, 'triangle', 0.35, i * 0.19); },
    start() { [392, 523, 659, 784].forEach((f, i) => tone(f, f, 0.13, 'square', 0.25, i * 0.12)); },
    clear() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, f, 0.14, 'square', 0.28, i * 0.11)); },
  };
})();

/* ===== Movimento contínuo em grade (unidades = tiles; centro do tile = inteiro) ===== */
const isC = (v) => Math.abs(v - Math.round(v)) < 1e-9;
const cellC = (x) => wrapC(Math.round(x));
function advance(a, dist, decide) {
  for (let guard = 0; dist > 1e-9 && guard < 24; guard++) {
    if (isC(a.x) && isC(a.y)) { a.x = Math.round(a.x); a.y = Math.round(a.y); decide(a); }
    const d = a.dir; if (!d) return;
    const tx = d.x ? (d.x > 0 ? Math.floor(a.x + 1e-9) + 1 : Math.ceil(a.x - 1e-9) - 1) : a.x;
    const ty = d.y ? (d.y > 0 ? Math.floor(a.y + 1e-9) + 1 : Math.ceil(a.y - 1e-9) - 1) : a.y;
    const gap = Math.abs(tx - a.x) + Math.abs(ty - a.y), s = Math.min(dist, gap);
    if (s >= gap - 1e-9) { a.x = tx; a.y = ty; } else { a.x += d.x * s; a.y += d.y * s; }
    if (a.x <= -0.5) a.x += COLS; else if (a.x >= COLS - 0.5) a.x -= COLS; // túnel lateral
    dist -= s;
  }
}
const canPac = (c, r) => Maze.open(c, r, false);
function pacDecide(a) {
  const c = cellC(a.x), r = a.y;
  if (a.want && canPac(c + a.want.x, r + a.want.y)) a.dir = a.want;
  else if (!(a.dir && canPac(c + a.dir.x, r + a.dir.y))) a.dir = null;
  if (a.dir) a.face = a.dir;
}
const opposite = (a, b) => a && b && a.x === -b.x && a.y === -b.y;
function setWant(d) {
  const P = G.P; if (!P) return;
  P.want = d;
  if (P.dir && opposite(P.dir, d)) { P.dir = d; P.face = d; } // inversão imediata no corredor
}

/* ===== Fantasmas ===== */
function pacCell() { return { c: cellC(G.P.x), r: Math.round(G.P.y) }; }
function ghostTarget(g) {
  if (G.mode === 'scatter') return g.corner;
  const p = pacCell(), f = G.P.face || DIRS.left;
  if (g.id === 'blinky') return p;
  if (g.id === 'pinky') return { c: p.c + f.x * 4, r: p.r + f.y * 4 };
  if (g.id === 'inky') {
    const b = G.ghosts.find((x) => x.id === 'blinky'), pv = { c: p.c + f.x * 2, r: p.r + f.y * 2 };
    return { c: 2 * pv.c - cellC(b.x), r: 2 * pv.r - Math.round(b.y) };
  }
  const dx = cellC(g.x) - p.c, dy = Math.round(g.y) - p.r; // clyde: persegue de longe, foge de perto
  return dx * dx + dy * dy > 64 ? p : g.corner;
}
function bfsStep(g, tc, tr) {
  const dist = bfsFrom(tc, tr), c = cellC(g.x), r = g.y; let best = null, bd = 1e9;
  for (const d of DLIST) {
    const nc = wrapC(c + d.x), nr = r + d.y;
    if (Maze.open(nc, nr, true) && dist[nr][nc] >= 0 && dist[nr][nc] < bd) { bd = dist[nr][nc]; best = d; }
  }
  return best;
}
function ghostDecide(g) {
  const c = cellC(g.x), r = g.y;
  if (g.state === 'eaten' && c === HOME.c && r === HOME.r) { g.state = 'leaving'; g.fright = false; }
  if (g.state === 'leaving' && c === EXIT.c && r === EXIT.r) { g.state = 'normal'; g.dir = DIRS.left; return; }
  if (g.state === 'eaten') { g.dir = bfsStep(g, HOME.c, HOME.r); return; }
  if (g.state === 'leaving') { g.dir = bfsStep(g, EXIT.c, EXIT.r); return; }
  let opts = DLIST.filter((d) => Maze.open(c + d.x, r + d.y, false) && !opposite(d, g.dir));
  if (!opts.length) opts = DLIST.filter((d) => Maze.open(c + d.x, r + d.y, false)); // beco: só pode voltar
  if (!opts.length) { g.dir = null; return; }
  if (g.fright) { g.dir = opts[Math.floor(Math.random() * opts.length)]; return; }
  const t = ghostTarget(g); let best = opts[0], bd = 1e9;
  for (const d of opts) { const dx = c + d.x - t.c, dy = r + d.y - t.r, v = dx * dx + dy * dy; if (v < bd) { bd = v; best = d; } }
  g.dir = best;
}
function ghostSpeed(g) {
  const L = G.level - 1;
  if (g.state === 'eaten') return 13;
  if (g.state === 'leaving' || g.state === 'house') return 4.5;
  if (g.fright) return 3.6;
  if (g.y === 9 && (g.x < 3.5 || g.x > COLS - 4.5)) return 3.6; // túnel é lento para os fantasmas
  let v = Math.min(7.2, 6 + 0.28 * L);
  if (g.id === 'blinky' && G.left <= 20) v += 0.4; // Blinky acelera nas últimas bolinhas
  return v;
}
const pacSpeed = () => 7.4;

/* ===== Fases ===== */
function resetActors() {
  const s = Maze.pac;
  G.P = { x: s.c, y: s.r, dir: null, want: null, face: DIRS.left, anim: 0, moving: false };
  const k = Math.max(0.4, 1 - 0.1 * (G.level - 1));
  G.ghosts = Object.keys(GHOSTS).map((id, i) => {
    const p = Maze.ghostAt[id], blinky = id === 'blinky';
    return { id, color: GHOSTS[id].color, corner: GHOSTS[id].corner, x: p.c, y: p.r, dir: blinky ? DIRS.left : null,
             state: blinky ? 'normal' : 'house', fright: false, rel: GHOSTS[id].rel * k, bob: i * 1.7 };
  });
  G.fright = 0; G.chain = 0; G.mode = 'scatter'; G.modeIdx = 0; G.modeT = 0;
}
function loadLevel() {
  G.dots = Maze.dots.map((row) => row.slice()); G.left = Maze.total;
  resetActors();
}
function setState(s) { G.state = s; G.stateT = 0; renderClasses(); }
function startReady() { setState('ready'); Sound.start(); }
function newGame() {
  if (G.state !== 'title' && G.state !== 'over') return;
  G.score = 0; G.lives = 3; G.level = 1; G.bestAtStart = G.best; G.newRecord = false; G.paused = false;
  G.fx.length = 0; G.pops.length = 0; closeHelp(); loadLevel(); hud(); Sound.unlock(); startReady();
}
function nextLevel() { G.level++; if (G.level > G.bestLevel) { G.bestLevel = G.level; store.setBestLevel(G.bestLevel); } loadLevel(); hud(); startReady(); }
function gameOver() {
  G.newRecord = G.score > G.bestAtStart && G.score > 0;
  $('over-score').textContent = G.score; $('over-level').textContent = G.level; $('over-record').hidden = !G.newRecord;
  setState('over');
}

/* ===== Regras ===== */
function addScore(n) {
  G.score += n;
  if (G.score > G.best) { G.best = G.score; store.setBest(G.best); }
  hud();
}
function burst(c, r, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, v = 20 + Math.random() * 40;
    G.fx.push({ x: c * T + T / 2, y: r * T + T / 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.35 + Math.random() * 0.25, color });
  }
}
function startFright() {
  G.fright = Math.max(2, 7 - 0.8 * (G.level - 1)); G.chain = 0; // novo power pellet renova a duração
  for (const g of G.ghosts) if (g.state !== 'eaten') {
    if (!g.fright && g.state === 'normal' && g.dir) g.dir = { x: -g.dir.x, y: -g.dir.y };
    g.fright = true;
  }
  Sound.power();
}
function endFright() { G.fright = 0; for (const g of G.ghosts) g.fright = false; }
function eatAt() {
  const c = cellC(G.P.x), r = Math.round(G.P.y), v = G.dots[r] && G.dots[r][c];
  if (!v) return;
  G.dots[r][c] = 0; G.left--; // cada item só pontua uma vez: é removido do mapa na hora
  if (v === 1) { addScore(10); Sound.chomp(); burst(c, r, '#ffe9b8', 2); }
  else { addScore(50); startFright(); burst(c, r, '#ffffff', 10); }
}
function dist2(a, b) { let dx = Math.abs(a.x - b.x); dx = Math.min(dx, COLS - dx); const dy = a.y - b.y; return Math.hypot(dx, dy); }
function collisions() {
  if (G.state !== 'play') return; // sem colisões duplicadas durante transições
  for (const g of G.ghosts) {
    if (g.state === 'eaten' || g.state === 'house') continue;
    if (dist2(G.P, g) >= HIT_R) continue;
    if (g.fright) {
      const pts = 200 * 2 ** Math.min(G.chain, 3); G.chain++;
      g.state = 'eaten'; g.fright = false; g.dir = null; // ignorado até voltar à base
      addScore(pts); Sound.ghost(); burst(g.x, g.y, g.color, 12);
      G.pops.push({ x: g.x * T + T / 2, y: g.y * T, text: String(pts), t: 0 });
    } else { // uma única derrota por colisão: o estado muda e a checagem para
      G.lives--; hud(); G.P.dir = null; Sound.death(); setState('dying'); return;
    }
  }
}
function updatePlay(dt) {
  const P = G.P;
  if (G.fright > 0) { G.fright -= dt; if (G.fright <= 0) endFright(); }
  else { // o cronograma de modos só corre sem vulnerabilidade
    G.modeT += dt;
    const lv = G.level - 1, [len, mode] = SCHEDULE[G.modeIdx], dur = mode === 'scatter' ? len * Math.max(0.4, 1 - 0.15 * lv) : len * (1 + 0.1 * lv);
    if (G.modeT >= dur && G.modeIdx < SCHEDULE.length - 1) {
      G.modeIdx++; G.modeT = 0; G.mode = SCHEDULE[G.modeIdx][1];
      for (const g of G.ghosts) if (g.state === 'normal' && g.dir) g.dir = { x: -g.dir.x, y: -g.dir.y };
    }
  }
  const px = P.x, py = P.y;
  advance(P, pacSpeed() * dt, pacDecide);
  P.moving = P.x !== px || P.y !== py; if (P.moving) P.anim += dt;
  eatAt();
  for (const g of G.ghosts) {
    if (g.state === 'house') { g.rel -= dt; if (g.rel <= 0) { g.state = 'leaving'; g.dir = null; } continue; }
    advance(g, ghostSpeed(g) * dt, ghostDecide);
  }
  collisions();
  if (G.state === 'play' && G.left <= 0) { Sound.clear(); setState('clear'); }
}
function update(dt) {
  if (G.state !== 'title') G.t += dt; // parado na tela inicial: pellets e fantasmas não animam
  for (const f of G.fx) { f.t += dt; f.x += f.vx * dt; f.y += f.vy * dt; }
  G.fx = G.fx.filter((f) => f.t < f.life);
  for (const p of G.pops) p.t += dt;
  G.pops = G.pops.filter((p) => p.t < 1);
  if (G.state === 'ready') { G.stateT += dt; if (G.stateT >= READY_S) setState('play'); }
  else if (G.state === 'play') updatePlay(dt);
  else if (G.state === 'dying') { G.stateT += dt; if (G.stateT >= DYING_S) { if (G.lives <= 0) gameOver(); else { resetActors(); startReady(); } } }
  else if (G.state === 'clear') { G.stateT += dt; if (G.stateT >= CLEAR_S) nextLevel(); }
}
function togglePause(want) {
  if (G.state === 'title' || G.state === 'over') return;
  G.paused = want === undefined ? !G.paused : want; renderClasses();
}

/* ===== Interface (HUD e classes) ===== */
function hud() {
  ui.score.textContent = G.score; ui.level.textContent = G.level; ui.best.textContent = G.best; $('title-best').textContent = G.best; $('title-level').textContent = G.bestLevel;
  const n = Math.max(0, G.lives);
  if (ui.lives.childElementCount !== n) {
    ui.lives.textContent = '';
    for (let i = 0; i < n; i++) { const s = document.createElement('i'); s.className = 'life'; ui.lives.appendChild(s); }
  }
  ui.lives.setAttribute('aria-label', `${n} vidas`);
}
function renderClasses() {
  const c = ui.stage.classList, s = G.state;
  c.toggle('is-title', s === 'title'); c.toggle('is-over', s === 'over'); c.toggle('is-playing', s !== 'title' && s !== 'over');
  c.toggle('is-paused', G.paused && s !== 'title' && s !== 'over'); c.toggle('is-power', G.fright > 0 && s === 'play');
  const paused = G.paused && s !== 'title' && s !== 'over';
  ui.pause.setAttribute('aria-label', paused ? 'Continuar' : 'Pausar'); ui.pause.title = paused ? 'Continuar (Espaço)' : 'Pausar (Espaço)';
  ui.mute.classList.toggle('is-muted', G.muted); ui.mute.setAttribute('aria-pressed', G.muted);
  ui.mute.setAttribute('aria-label', G.muted ? 'Ativar efeitos sonoros' : 'Silenciar efeitos sonoros');
}
function toggleMute() { G.muted = !G.muted; store.setMuted(G.muted); if (!G.muted) Sound.unlock(); renderClasses(); }

/* ===== Renderização ===== */
let K = 1, maze = null;
function buildMazeLayer() {
  maze = document.createElement('canvas'); maze.width = ui.canvas.width; maze.height = ui.canvas.height;
  const m = maze.getContext('2d'); m.scale(K, K);
  const { wall, door, void_ } = Maze;
  m.fillStyle = '#04072a';
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (wall[r][c] && !void_[r][c]) m.fillRect(c * T, r * T, T, T);
  m.strokeStyle = '#3d63ff'; m.lineWidth = 2; m.lineCap = 'round'; m.shadowColor = '#2f56ff'; m.shadowBlur = 6 * K;
  m.beginPath();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!wall[r][c] || void_[r][c]) continue;
    const x = c * T, y = r * T, free = (cc, rr) => rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && !wall[rr][cc];
    if (free(c, r - 1)) { m.moveTo(x, y); m.lineTo(x + T, y); }
    if (free(c, r + 1)) { m.moveTo(x, y + T); m.lineTo(x + T, y + T); }
    if (free(c - 1, r)) { m.moveTo(x, y); m.lineTo(x, y + T); }
    if (free(c + 1, r)) { m.moveTo(x + T, y); m.lineTo(x + T, y + T); }
  }
  m.stroke(); m.shadowBlur = 0; m.fillStyle = '#ff8fd0';
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (door[r][c]) m.fillRect(c * T, r * T + T / 2 - 1.5, T, 3);
}
function drawPac() {
  const P = G.P, x = P.x * T + T / 2, y = P.y * T + T / 2, f = P.face || DIRS.left, ang = Math.atan2(f.y, f.x);
  let mouth;
  if (G.state === 'dying') {
    const t = Math.min(1, Math.max(0, (G.stateT - 0.3) / (DYING_S - 0.4)));
    if (t >= 1) return;
    mouth = 0.2 + t * (Math.PI - 0.2); return pacShape(x, y, -Math.PI / 2, mouth);
  }
  mouth = P.moving ? 0.04 + 0.34 * Math.abs(Math.sin(P.anim * 14)) : 0.3;
  pacShape(x, y, ang, mouth);
}
function pacShape(x, y, ang, mouth) {
  ctx.fillStyle = '#ffd21f'; ctx.shadowColor = 'rgba(255,210,31,.7)'; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, 6.8, ang + mouth, ang - mouth + Math.PI * 2); ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
}
function drawGhost(g) {
  const x = g.x * T + T / 2, r = 6.6, y = g.y * T + T / 2 + (g.state === 'house' ? Math.sin(G.t * 6 + g.bob) * 2 : 0);
  const flash = g.fright && G.fright < 2 && Math.floor(G.t * 6) % 2 === 0;
  if (g.state !== 'eaten') {
    ctx.fillStyle = g.fright ? (flash ? '#f4f4ff' : '#2438ff') : g.color;
    ctx.beginPath(); ctx.arc(x, y - 1, r, Math.PI, 0); ctx.lineTo(x + r, y + r);
    const w = (2 * r) / 3, ph = Math.floor(G.t * 8) % 2;
    for (let i = 0; i < 3; i++) { const x1 = x + r - i * w; ctx.lineTo(x1 - w / 2, y + r - ((i + ph) % 2 ? 2.4 : 0)); ctx.lineTo(x1 - w, y + r); }
    ctx.closePath(); ctx.fill();
  }
  if (g.fright && g.state !== 'eaten') {
    ctx.fillStyle = flash ? '#e02b2b' : '#ffe9b8'; ctx.fillRect(x - 3.8, y - 3, 2, 2); ctx.fillRect(x + 1.8, y - 3, 2, 2);
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 4, y + 3);
    for (let i = 1; i <= 4; i++) ctx.lineTo(x - 4 + i * 2, y + (i % 2 ? 1.6 : 3)); ctx.stroke(); return;
  }
  const d = g.dir || DIRS.left; ctx.fillStyle = '#fff';
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(x + s * 2.8, y - 2, 2.2, 2.8, 0, 0, 6.283); ctx.fill(); }
  ctx.fillStyle = '#1b2cff';
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(x + s * 2.8 + d.x * 1.2, y - 2 + d.y * 1.4, 1.2, 0, 6.283); ctx.fill(); }
}
function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
  if (!maze) return;
  ctx.drawImage(maze, 0, 0); ctx.setTransform(K, 0, 0, K, 0, 0);
  if (G.state === 'clear' && Math.floor(G.stateT * 5) % 2 === 0) { ctx.fillStyle = 'rgba(160,190,255,.22)'; ctx.fillRect(0, 0, CW, CH); }
  const pulse = 0.5 + 0.5 * Math.sin(G.t * 8);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const v = G.dots[r][c]; if (!v) continue;
    const x = c * T + T / 2, y = r * T + T / 2;
    if (v === 1) { ctx.fillStyle = '#ffe9c4'; ctx.beginPath(); ctx.arc(x, y, 1.7, 0, 6.283); ctx.fill(); }
    else { ctx.fillStyle = '#fff'; ctx.shadowColor = '#9fb4ff'; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(x, y, 3.8 + pulse * 1.3, 0, 6.283); ctx.fill(); ctx.shadowBlur = 0; }
  }
  if (G.state !== 'dying' || G.stateT < 0.3) if (G.state !== 'clear' || G.stateT < 0.4) G.ghosts.forEach(drawGhost);
  drawPac();
  for (const f of G.fx) { ctx.globalAlpha = 1 - f.t / f.life; ctx.fillStyle = f.color; ctx.fillRect(f.x - 1, f.y - 1, 2, 2); }
  ctx.globalAlpha = 1; ctx.textAlign = 'center'; ctx.font = "bold 8px 'Arial Black', Arial, sans-serif";
  for (const p of G.pops) { ctx.globalAlpha = 1 - p.t; ctx.fillStyle = '#4ee8ff'; ctx.fillText(p.text, p.x, p.y - p.t * 14); }
  ctx.globalAlpha = 1; ctx.font = "bold 11px 'Arial Black', Arial, sans-serif";
  if (G.state === 'ready') { ctx.fillStyle = '#ffd21f'; ctx.fillText('PRONTO!', CW / 2, 11 * T + 11); }
  if (G.state === 'clear') { ctx.fillStyle = '#ffd21f'; ctx.fillText('FASE COMPLETA', CW / 2, 11 * T + 11); }
  if (ui.stage.classList.contains('is-power') !== (G.fright > 0 && G.state === 'play')) renderClasses();
}
function fitStage(w, h) {
  let ch = Math.min(h, MAX_CSS_HEIGHT), cw = ch * (W / H);
  if (cw > w) { cw = w; ch = cw / (W / H); }
  return [Math.floor(cw), Math.floor(ch)];
}
function resizeStage() {
  const aw = ui.arena.clientWidth, ah = ui.arena.clientHeight, w = Math.max(1, aw - MARGIN * 2);
  let [cw, ch] = fitStage(w, Math.max(1, ah - MARGIN * 2));
  const side = (aw - cw) / 2 >= HOW_SIDE_MIN; // há espaço ao lado do palco para o botão "?"? Senão ele vai para uma faixa sob o palco
  if (!side) [cw, ch] = fitStage(w, Math.max(1, ah - HOW_STRIP - MARGIN * 2));
  ui.arena.classList.toggle('how-bottom', !side);
  ui.arena.style.setProperty('--stage-w', `${cw}px`); ui.arena.style.setProperty('--how-strip', `${HOW_STRIP}px`);
  ui.stage.style.width = `${cw}px`; ui.stage.style.height = `${ch}px`; ui.stage.style.setProperty('--u', `${cw / W}px`);
  const dpr = Math.min(window.devicePixelRatio || 1, 3), px = Math.max(1, Math.round(ui.canvas.clientWidth * dpr));
  if (ui.canvas.width !== px || !maze) {
    ui.canvas.width = px; ui.canvas.height = Math.round((px * CH) / CW); K = ui.canvas.width / CW; buildMazeLayer();
  }
  positionHelp();
}

/* ===== Como jogar: popover ancorado ao botão "?" (fora do palco), abrindo para baixo ===== */
const helpOpen = () => !how.pop.hidden;
function positionHelp() {
  if (!helpOpen()) return;
  const a = ui.arena.getBoundingClientRect(), b = how.btn.getBoundingClientRect(), edge = 8, gap = 12;
  const pw = Math.min(252, a.width - edge * 2), bx = b.left - a.left, by = b.top - a.top;
  how.pop.style.width = `${pw}px`; how.pop.style.maxHeight = '';
  const ph = how.pop.offsetHeight, below = a.height - (by + b.height + gap) - edge, above = by - gap - edge;
  const place = below >= ph || below >= above ? 'below' : 'above'; // sempre para baixo; só vira para cima se não couber (botão na faixa inferior)
  const room = Math.max(120, place === 'below' ? below : above), h = Math.min(ph, room);
  const left = Math.min(Math.max(bx + b.width - pw, edge), a.width - pw - edge);
  how.pop.style.maxHeight = `${room}px`; how.pop.style.left = `${left}px`;
  how.pop.style.top = `${place === 'below' ? by + b.height + gap : by - gap - h}px`;
  how.pop.dataset.placement = place;
  how.pop.style.setProperty('--arrow-x', `${Math.min(Math.max(bx + b.width / 2 - left, 18), pw - 18)}px`);
}
function openHelp() {
  how.pop.hidden = false; how.btn.setAttribute('aria-expanded', 'true'); positionHelp();
  if (G.state !== 'title' && G.state !== 'over' && !G.paused) togglePause(true); // lendo a ajuda, o jogo não corre
}
function closeHelp() { how.pop.hidden = true; how.btn.setAttribute('aria-expanded', 'false'); }

/* ===== Laço do jogo: um único requestAnimationFrame, com passo baseado no tempo real ===== */
let raf = 0, last = 0;
function frame(ts) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.033, Math.max(0, (ts - last) / 1000) || 0); last = ts;
  if (!G.paused) update(dt);
  draw();
}
function startLoop() { if (!raf) raf = requestAnimationFrame(frame); }

/* ===== Entradas ===== */
const KEYS = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (KEYS[e.code]) { e.preventDefault(); if (!G.paused) setWant(DIRS[KEYS[e.code]]); return; }
  if (e.repeat) return;
  if (e.code === 'Escape' && helpOpen()) { closeHelp(); return; }
  if (e.code === 'Space') { e.preventDefault(); if (G.state === 'title' || G.state === 'over') newGame(); else togglePause(); }
  else if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  else if (e.code === 'KeyM') toggleMute();
}
function init() {
  hud(); loadLevel(); renderClasses(); resizeStage();
  document.querySelectorAll('.pad-btn').forEach((b) => b.addEventListener('pointerdown', (e) => {
    e.preventDefault(); Sound.unlock(); if (!G.paused) setWant(DIRS[b.dataset.dir]);
  }));
  // Deslizar no labirinto também muda a direção
  let sx = 0, sy = 0, swiping = false;
  ui.canvas.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; swiping = true; Sound.unlock(); });
  ui.canvas.addEventListener('pointermove', (e) => {
    if (!swiping) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 16) return;
    if (!G.paused) setWant(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? DIRS.right : DIRS.left) : (dy > 0 ? DIRS.down : DIRS.up));
    sx = e.clientX; sy = e.clientY;
  });
  const endSwipe = () => { swiping = false; };
  ui.canvas.addEventListener('pointerup', endSwipe); ui.canvas.addEventListener('pointercancel', endSwipe);
  // Tela inicial: o primeiro toque/clique em qualquer ponto do palco inicia (Space já inicia pelo teclado)
  let helpDismissTap = false; // o toque que só fecha a ajuda não deve iniciar a partida
  document.addEventListener('pointerdown', (e) => {
    helpDismissTap = false;
    if (!helpOpen() || how.pop.contains(e.target) || how.btn.contains(e.target)) return;
    closeHelp(); helpDismissTap = true;
  });
  ui.startScreen.addEventListener('click', () => { if (helpDismissTap) { helpDismissTap = false; return; } newGame(); });
  how.btn.addEventListener('click', () => { if (helpOpen()) closeHelp(); else openHelp(); });
  how.close.addEventListener('click', () => { closeHelp(); how.btn.focus({ preventScroll: true }); });
  $('again-button').addEventListener('click', () => { newGame(); $('again-button').blur(); });
  $('resume-button').addEventListener('click', () => { togglePause(false); $('resume-button').blur(); });
  ui.pause.addEventListener('click', () => { togglePause(); ui.pause.blur(); }); // alterna: o mesmo botão pausa e continua
  ui.mute.addEventListener('click', () => { toggleMute(); ui.mute.blur(); });
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('pointerdown', () => Sound.unlock());
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', () => togglePause(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) togglePause(true); });
  window.addEventListener('resize', resizeStage);
  window.addEventListener('orientationchange', resizeStage);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resizeStage);
  startLoop();
}
init();
window.__pac = { G, Maze, MAP, DIRS, update, advance, setWant, newGame, togglePause, collisions, eatAt, startFright, ghostDecide, startLoop, nextLevel, pacDecide };