/* ==========================================================================
arcade/piano_tap/piano_tap.js - Jogo de reflexos com teclas de piano em HTML5 Canvas + JavaScript puro.
Índice: 1 Configuração · 2 Áudio · 3 Estado · 4 Lógica (4b Pausa, contagem e salvamento) · 5 Efeitos
· 6 Renderização · 7 Interface · 8 Entrada · 9 Redimensionamento · 10 Loop
Unidades do mundo: 1 = largura de uma coluna. O tabuleiro tem 4 x 6 unidades.
========================================================================== */
(() => {
'use strict';

/* ===== 1. CONFIGURAÇÃO ===== */
const CONFIG = {
  cols: 4, viewRows: 4, rowHeight: 1.5,         // 4 fileiras visíveis, cada uma com 1,5 unidade de altura
  leadBlank: 2,                                  // fileiras brancas iniciais (a 1ª preta chega com folga)
  speedStart: 2.4, speedMax: 8.4, speedStep: 0.07, speedEase: 3,   // unidades/s; +0,07 por ponto até o teto
  maxStep: 0.02, maxFrame: 0.1,                  // passo fixo máximo da simulação e limite de dt por quadro (s)
  historySize: 6, maxCol: 100, minCol: 24, margin: 14, restartLock: 500,
  volume: 0.3,
  countFrom: 3, countStep: 0.7, goFlash: 0.6,   // contagem 3·2·1 (s por número) e quanto tempo o "GO!" fica na tela
  holdFrom: 5, holdChance: 0.2, holdLongFrom: 30, holdLongChance: 0.3, holdsOnDesktop: true,   // tecla longa (segurar): a partir de N pontos; len 2 (padrão) ou 3 (rara)
  doubleFrom: 25, doubleChance: 0.22,          // duas teclas na mesma fileira: SÓ em telas de toque, a partir de N pontos
  gapChance: 0.32, gapMax: 2,                  // variedade: chance de uma fileira vir VAZIA e máximo de vazias seguidas
  saveVersion: 2, saveEvery: 250,              // formato do salvamento (piano_tap:save) e intervalo mínimo entre gravações em jogo (ms)
};
const COLORS = {
  neon: '#a99cff', violet: '#9d8cff', violetSoft: '#e9e6ff', berry: '#ff4f7b', gold: '#ffc857', ink: '#120f2a',
};
const { cols: COLS, rowHeight: ROW_H } = CONFIG;
const VIEW_H = CONFIG.viewRows * ROW_H;
const KEYS = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
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
// Persistência: tudo passa por piano_tap_storage.js (PianoTapStorage): recorde (best) e som (muted).

/* ===== 2. ÁUDIO (Web Audio API, sem arquivos externos) ===== */
// Cada acerto toca a próxima nota de uma melodia conhecida (Ode à Alegria, domínio público).
const NOTE = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0 };
const MELODY = 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4 D4 D4 E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4 C4 C4'
  .split(' ').map((n) => NOTE[n]);

const Sound = (() => {
  let ctx = null, master = null, unavailable = false, muted = PianoTapStorage.isMuted();
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
  function tone({ type = 'sine', from, to = from, duration = 0.1, volume = 0.4, delay = 0 }) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + delay, osc = c.createOscillator(), gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain); gain.connect(master);
    osc.start(t0); osc.stop(t0 + duration + 0.02);
  }
  const play = (fn) => { if (muted) return; try { fn(); } catch (e) { /* áudio nunca quebra o jogo */ } };
  return {
    get muted() { return muted; },
    unlock() { if (!muted) play(ensure); },
    setMuted(v) { muted = Boolean(v); PianoTapStorage.setMuted(muted); if (!muted) play(ensure); },
    note(freq) {
      play(() => {
        tone({ type: 'sine', from: freq, duration: 0.6, volume: 0.5 });
        tone({ type: 'triangle', from: freq * 2, duration: 0.3, volume: 0.14 });
        tone({ type: 'sine', from: freq * 3, duration: 0.15, volume: 0.05 });
      });
    },
    record() { play(() => [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', from: f, duration: 0.14, volume: 0.35, delay: 0.1 * i }))); },
    hit() { play(() => { tone({ type: 'sawtooth', from: 220, to: 45, duration: 0.5, volume: 0.35 }); tone({ type: 'square', from: 110, to: 38, duration: 0.3, volume: 0.22 }); }); },
    hold() { play(() => tone({ type: 'triangle', from: 880, duration: 0.12, volume: 0.22 })); },
    click() { play(() => tone({ type: 'triangle', from: 520, to: 700, duration: 0.06, volume: 0.25 })); },
    count() { play(() => tone({ type: 'triangle', from: 440, duration: 0.09, volume: 0.25 })); },
    go() { play(() => { tone({ type: 'triangle', from: 659, duration: 0.1, volume: 0.28 }); tone({ type: 'sine', from: 988, duration: 0.2, volume: 0.35, delay: 0.07 }); }); },
  };
})();

/* ===== 3. ESTADO ===== */
// Cada fileira tem um índice fixo n; sua posição é rowTop = offset - n * ROW_H. Uma única variável (offset)
// move o tabuleiro inteiro, então as fileiras nunca se desalinham entre si nem trocam de coluna.
let sawTouch = false;   // vira true no primeiro toque de dedo: vale a partir da próxima partida
const coarseQuery = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
const detectTouch = () => sawTouch || Boolean(coarseQuery && coarseQuery.matches);

const game = {
  state: STATES.READY, time: 0, offset: 0, speed: 0,
  rows: [], nextN: 0, history: [],
  score: 0, startBest: 0, best: PianoTapStorage.getBest(), newRecord: false,
  noteIndex: 0, particles: [], floats: [], glows: [], holds: new Map(), touchMode: false,
  wrong: null, missRow: null, missTile: null, endReason: '', overAt: 0,
  pauseReason: 'manual', countdown: null, goFlash: 0,   // pausa: motivo · contagem em curso ({ t, shown }) · tempo restante do "GO!"
};

const ui = {
  play: document.getElementById('play'), arena: document.getElementById('arena'), board: document.getElementById('board'),
  score: document.getElementById('score'), best: document.getElementById('best'), bestCard: document.getElementById('best-card'),
  pause: document.getElementById('pause-button'), mute: document.getElementById('mute-button'),
  start: document.getElementById('start-button'), resume: document.getElementById('resume-button'), restart: document.getElementById('restart-button'),
  overTitle: document.getElementById('over-title'), overReason: document.getElementById('over-reason'),
  overScore: document.getElementById('over-score'), overBest: document.getElementById('over-best'),
  badge: document.getElementById('record-badge'), toast: document.getElementById('toast'),
  frame: document.getElementById('frame'), helpButton: document.getElementById('help-button'),
  helpPopover: document.getElementById('help-popover'), helpClose: document.getElementById('help-close'),
  restartPause: document.getElementById('restart-pause-button'), pauseTitle: document.getElementById('pause-title'), pauseNote: document.getElementById('pause-note'),
  count: document.getElementById('count-screen'), countNum: document.getElementById('count-num'),
};
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
let sx = 1, sy = 1;   // pixels do canvas por unidade (horizontal e vertical)

/* ===== 4. LÓGICA ===== */
// Uma fileira ocupa r.len casas de altura (1 = tecla normal; 2 ou 3 = tecla LONGA, de segurar) e tem 0, 1 ou 2 teclas (r.tiles).
// Cada tecla tem estado s: 0 = esperando · 1 = sendo segurada · 2 = cumprida. A posição vem de uma só variável (offset).
const rowTop = (r) => game.offset - (r.n + r.len - 1) * ROW_H;
const rowBottom = (r) => rowTop(r) + r.len * ROW_H;
const holdNeed = (r) => r.len * ROW_H - INS * 2;   // quanto a tecla longa precisa andar, desde o toque, para encher por completo
const unfinished = (r) => r.tiles.some((t) => t.s === 0);

// Velocidade-alvo depende só da pontuação e tem teto. A velocidade real a segue suavemente (sem saltos).
function targetSpeed() { return Math.min(CONFIG.speedMax, CONFIG.speedStart + game.score * CONFIG.speedStep); }

// Sorteio ponderado: colunas usadas recentemente pesam menos, repetir a última pesa menos ainda
// e três iguais seguidas é proibido. Equilibrado, porém imprevisível.
function pickColumn(skip = -1) {
  const h = game.history, last = h.length ? h[h.length - 1] : -1;
  const twice = h.length >= 2 && h[h.length - 1] === h[h.length - 2];
  const weights = [];
  let total = 0;
  for (let c = 0; c < COLS; c++) {
    let w = 1 / (1 + 0.7 * h.filter((x) => x === c).length);
    if (c === last) w = twice ? 0 : w * 0.4;
    if (c === skip) w = 0;
    weights.push(w); total += w;
  }
  let r = Math.random() * total, fallback = 0;
  for (let c = 0; c < COLS; c++) {
    if (weights[c] <= 0) continue;
    fallback = c; r -= weights[c];
    if (r <= 0) return c;
  }
  return fallback;
}

function pushRow() {
  const n = game.nextN;
  if (n < CONFIG.leadBlank) { game.rows.push({ n, len: 1, tiles: [] }); game.nextN = n + 1; return; }
  let trailing = 0;                                     // fileiras vazias seguidas no topo da pilha
  for (let i = game.rows.length - 1; i >= 0 && !game.rows[i].tiles.length; i--) trailing++;
  if (trailing < CONFIG.gapMax && Math.random() < CONFIG.gapChance) { game.rows.push({ n, len: 1, tiles: [] }); game.nextN = n + 1; return; }
  const hold = (CONFIG.holdsOnDesktop || game.touchMode) && game.score >= CONFIG.holdFrom && Math.random() < CONFIG.holdChance;
  const len = !hold ? 1 : (game.score >= CONFIG.holdLongFrom && Math.random() < CONFIG.holdLongChance ? 3 : 2);
  const two = game.touchMode && game.score >= CONFIG.doubleFrom && Math.random() < CONFIG.doubleChance;   // dupla: só no toque
  const cols = [pickColumn()];
  if (two) cols.push(pickColumn(cols[0]));
  cols.sort((a, b) => a - b);
  for (const c of cols) game.history.push(c);
  while (game.history.length > CONFIG.historySize) game.history.shift();
  game.rows.push({ n, len, tiles: cols.map((c) => ({ c, s: 0, hitAt: 0 })) });
  game.nextN = n + len;
}

// Mantém fileiras suficientes para cobrir o tabuleiro até acima do topo.
function fillRows() {
  while (!game.rows.length || rowTop(game.rows[game.rows.length - 1]) > -ROW_H) pushRow();
}

function resetRound() {
  Object.assign(game, {
    offset: VIEW_H - ROW_H, speed: CONFIG.speedStart, rows: [], nextN: 0, history: [],
    score: 0, startBest: game.best, newRecord: false, noteIndex: 0,
    particles: [], floats: [], glows: [], holds: new Map(), touchMode: detectTouch(),
    wrong: null, missRow: null, missTile: null, endReason: '', countdown: null, goFlash: 0, pauseReason: 'manual',
  });
  fillRows();
  ui.board.classList.remove('hit', 'shake');
  ui.count.classList.remove('go');
  PianoTapStorage.clearGame();            // tela inicial = nenhuma partida a recuperar
  updateScore(false);
  setState(STATES.READY);
}

function startGame() {
  if (game.state !== STATES.READY) return;
  Sound.unlock();
  setState(STATES.PLAYING);
  saveGame();
}

// Um passo de simulação (dt pequeno e fixo no máximo): mover, repor fileiras, detectar tecla perdida, fechar teclas longas, descartar antigas.
function step(dt) {
  game.speed += (targetSpeed() - game.speed) * Math.min(1, dt * CONFIG.speedEase);
  game.offset += game.speed * dt;
  fillRows();
  for (const r of game.rows) {
    for (const t of r.tiles) {
      if (t.s === 0 && rowBottom(r) >= VIEW_H) { endRound('miss', { row: r, tile: t }); return; }
      if (t.s === 1 && game.offset - t.o0 >= holdNeed(r)) completeHold(r, t);
    }
  }
  while (game.rows.length && rowTop(game.rows[0]) > VIEW_H + ROW_H) game.rows.shift();
}

// Centro (em unidades) da casa tocada por engano: no toque vem do ponto exato; no teclado, da casa mais baixa da fileira.
function wrongSlotY(row, y) {
  const top = rowTop(row);
  const k = y === null ? row.len - 1 : Math.max(0, Math.min(row.len - 1, Math.floor((y - top) / ROW_H)));
  return top + k * ROW_H + ROW_H / 2;
}

// Todo toque (mouse, dedo ou teclado) chega aqui já resolvido para uma fileira e uma coluna reais.
// id identifica quem tocou (ponteiro ou tecla): é ele que precisa continuar apertado numa tecla longa.
function registerTap(row, col, id = 'tap', y = null) {
  if (game.state !== STATES.PLAYING) return;
  const t = row.tiles.find((x) => x.c === col);
  if (t) { if (t.s === 0) hitTile(row, t, id); return; }   // tecla já acertada (ou sendo segurada): ignora
  endRound('white', { col, cy: wrongSlotY(row, y) });
}

function hitTile(row, t, id) {
  t.hitAt = game.time;
  t.s = row.len > 1 ? 1 : 2;
  if (t.s === 1) { t.o0 = game.offset; game.holds.set(id, { row, tile: t }); }   // o brilho começa a encher AGORA
  game.score++;
  Sound.note(MELODY[game.noteIndex++ % MELODY.length]);
  const cx = t.c + 0.5, cy = rowBottom(row) - ROW_H / 2;
  burst(cx, cy, 10, [COLORS.violet, '#c7bdff', COLORS.gold]);
  game.glows.push({ c: t.c, y: cy, age: 0, life: 0.4 });
  if (!reduceMotion) game.floats.push({ x: cx, y: cy, t: 0 });
  updateScore(true);
  if (game.startBest > 0 && game.score > game.startBest) {
    const first = !game.newRecord;
    game.newRecord = true;
    if (first) { showToast('Novo recorde!'); Sound.record(); }
  }
  if (game.score > game.best) { game.best = game.score; PianoTapStorage.setBest(game.best); updateBest(true); }
}

// O brilho encheu a tecla toda: segurou até o fim.
function completeHold(row, t) {
  t.s = 2;
  for (const [id, h] of game.holds) if (h.tile === t) game.holds.delete(id);
  const cy = Math.min(rowBottom(row) - ROW_H / 2, VIEW_H - 0.5);
  burst(t.c + 0.5, cy, 8, [COLORS.gold, '#fff', COLORS.violet]);
  game.glows.push({ c: t.c, y: cy, age: 0, life: 0.4 });
  Sound.hold();
}

// Soltou o dedo/tecla: se a tecla longa ainda não estava cumprida, a partida acaba.
function releaseInput(id) {
  const h = game.holds.get(id);
  if (!h) return;
  game.holds.delete(id);
  if (game.state === STATES.PLAYING && h.tile.s === 1) endRound('release', h);
}

// Pausa/reinício: ninguém está mais segurando nada, então as teclas longas em andamento contam como cumpridas.
function releaseAllHolds() {
  for (const r of game.rows) for (const t of r.tiles) if (t.s === 1) t.s = 2;
  game.holds.clear();
}

function endRound(reason, info) {
  if (game.state !== STATES.PLAYING) return;   // nunca registra a derrota duas vezes
  game.endReason = reason;
  game.holds.clear();
  let cx, cy;
  if (reason === 'white') {
    game.wrong = info; cx = info.col + 0.5; cy = info.cy;
  } else {                                      // 'miss' (tecla escapou) ou 'release' (soltou a longa cedo)
    if (reason === 'miss') {
      const over = rowBottom(info.row) - VIEW_H;
      if (over > 0) game.offset -= over;        // recua o excesso: a tecla perdida fica inteira à vista
    }
    game.missRow = info.row; game.missTile = info.tile;
    cx = info.tile.c + 0.5; cy = rowBottom(info.row) - ROW_H / 2;
  }
  burst(cx, cy, 20, [COLORS.berry, '#ff9bb0', COLORS.gold]);
  Sound.hit();
  ui.board.classList.remove('shake', 'hit'); void ui.board.offsetWidth;
  if (!reduceMotion) ui.board.classList.add('shake');
  ui.board.classList.add('hit');
  game.overAt = performance.now();
  game.goFlash = 0; ui.count.classList.remove('go');
  PianoTapStorage.clearGame();            // partida encerrada: nada para retomar
  setState(STATES.OVER);
}

function restart() {
  // Pequena trava após a derrota para um toque acidental de jogo rápido não reiniciar a partida.
  if (game.state === STATES.OVER && performance.now() - game.overAt < CONFIG.restartLock) return;
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
   Em PAUSED e COUNTDOWN o frame() não avança nada (tempo do jogo, simulação, partículas), então tudo fica congelado. */
function setPaused(paused, reason = 'manual') {
  const live = game.state === STATES.PLAYING || game.state === STATES.COUNTDOWN;
  if (paused && live) {
    releaseAllHolds();
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

// Instantâneo completo: tudo que define "onde o jogador parou" (posição, velocidade, fileiras, histórico do sorteio, nota da melodia, efeitos).
function snapshot() {
  return {
    v: CONFIG.saveVersion, savedAt: Date.now(),
    offset: game.offset, speed: game.speed, time: game.time, nextN: game.nextN,
    touchMode: game.touchMode,
    rows: game.rows.map((r) => ({ n: r.n, len: r.len, tiles: r.tiles.map((t) => ({ c: t.c, s: t.s === 1 ? 2 : t.s, hitAt: t.hitAt })) })),
    history: game.history.slice(),
    score: game.score, startBest: game.startBest, newRecord: game.newRecord, noteIndex: game.noteIndex,
    particles: game.particles.map((p) => ({ ...p })), floats: game.floats.map((f) => ({ ...f })),
  };
}

function saveGame() {
  if (game.state !== STATES.PLAYING && game.state !== STATES.PAUSED && game.state !== STATES.COUNTDOWN) return;
  PianoTapStorage.saveGame(snapshot());
}

// Valida tudo antes de aplicar: salvamento corrompido ou adulterado é descartado (volta à tela inicial).
function restoreGame(s) {
  if (!s || typeof s !== 'object' || s.v !== CONFIG.saveVersion) return false;
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const nat = (v) => Number.isInteger(v) && v >= 0;
  if (![s.offset, s.speed, s.time].every(num) || s.time < 0 || s.speed < 0 || s.speed > CONFIG.speedMax * 2) return false;
  if (![s.score, s.startBest, s.noteIndex].every(nat) || !Number.isInteger(s.nextN)) return false;
  if (!Array.isArray(s.rows) || !s.rows.length || s.rows.length > 60) return false;
  const rows = [];
  for (let i = 0; i < s.rows.length; i++) {
    const r = s.rows[i];
    if (!r || !Number.isInteger(r.n) || !Number.isInteger(r.len) || r.len < 1 || r.len > 3 || !Array.isArray(r.tiles) || r.tiles.length > 2) return false;
    if (i && r.n !== s.rows[i - 1].n + s.rows[i - 1].len) return false;   // fileiras consecutivas
    const seen = new Set(), tiles = [];
    for (const t of r.tiles) {
      if (!t || !Number.isInteger(t.c) || t.c < 0 || t.c >= COLS || seen.has(t.c) || (t.s !== 0 && t.s !== 2) || !num(t.hitAt)) return false;
      seen.add(t.c); tiles.push({ c: t.c, s: t.s, hitAt: Math.min(t.hitAt, s.time) });
    }
    rows.push({ n: r.n, len: r.len, tiles });
  }
  const last = rows[rows.length - 1];
  if (s.nextN !== last.n + last.len) return false;
  const top = (r) => s.offset - (r.n + r.len - 1) * ROW_H, bottom = (r) => top(r) + r.len * ROW_H;
  if (bottom(rows[0]) < VIEW_H - 1e-6) return false;                    // o fundo do tabuleiro precisa estar coberto
  if (rows.some((r) => r.tiles.some((t) => t.s === 0) && bottom(r) >= VIEW_H)) return false;   // tecla perdida já teria encerrado a partida
  if (!Array.isArray(s.history) || s.history.length > CONFIG.historySize || !s.history.every((c) => Number.isInteger(c) && c >= 0 && c < COLS)) return false;

  const list = (a) => (Array.isArray(a) ? a.slice(0, 200) : []);
  const particles = list(s.particles).filter((p) => p && [p.x, p.y, p.age, p.life].every(num)).map((p) => (p.ring
    ? { ring: true, x: p.x, y: p.y, age: p.age, life: p.life }
    : [p.vx, p.vy, p.r].every(num) && typeof p.color === 'string' && p.color.length < 40
      ? { x: p.x, y: p.y, vx: p.vx, vy: p.vy, age: p.age, life: p.life, r: p.r, color: p.color } : null)).filter(Boolean);
  const floats = list(s.floats).filter((f) => f && [f.x, f.y, f.t].every(num)).map((f) => ({ x: f.x, y: f.y, t: f.t }));

  Object.assign(game, {
    offset: s.offset, speed: s.speed, time: s.time, nextN: s.nextN, rows, history: s.history.slice(),
    score: s.score, startBest: s.startBest, newRecord: Boolean(s.newRecord), noteIndex: s.noteIndex, particles, floats,
    touchMode: Boolean(s.touchMode), glows: [], holds: new Map(),
    wrong: null, missRow: null, missTile: null, endReason: '', countdown: null, goFlash: 0, pauseReason: 'restored',
  });
  fillRows();
  game.best = Math.max(game.best, game.score);
  ui.board.classList.remove('hit', 'shake');
  ui.count.classList.remove('go');
  updateScore(false);
  setState(STATES.PAUSED);                       // aguarda o jogador: "Continuar" (ou Space) dispara o 3·2·1·GO!
  return true;
}

/* ===== 5. EFEITOS (animam com o tempo do jogo; param na pausa e são limpos no reinício) ===== */
function burst(x, y, n, colors) {
  if (reduceMotion) return;
  game.particles.push({ ring: true, x, y, age: 0, life: 0.4 });
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 1.2 + Math.random() * 2.6;
    game.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, age: 0, life: 0.3 + Math.random() * 0.3, r: 0.05 + Math.random() * 0.06, color: colors[i % colors.length] });
  }
}

function updateEffects(dt) {
  for (const p of game.particles) { p.age += dt; if (!p.ring) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.93; p.vy *= 0.93; } }
  game.particles = game.particles.filter((p) => p.age < p.life);
  for (const f of game.floats) f.t += dt;
  game.floats = game.floats.filter((f) => f.t < 0.7);
  for (const gl of game.glows) gl.age += dt;
  game.glows = game.glows.filter((gl) => gl.age < gl.life);
}

/* ===== 6. RENDERIZAÇÃO ===== */
// Fundo e teclas são pré-desenhados em sprites (refeitos no redimensionamento): desenhar cada quadro é só drawImage.
// Visual: pistas sobre um gradiente violeta (como o resto do jogo); teclas escuras arredondadas com contorno neon.
const sprites = { bg: null, tile: {} };
const INS = 0.07, RAD = 0.15;   // recuo da tecla dentro da casa e raio dos cantos, em largura de coluna
function rr(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

function buildBackground() {
  const c = makeCanvas(canvas.width, canvas.height), g = c.getContext('2d'), w = c.width, h = c.height;
  const base = g.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, '#1a1448'); base.addColorStop(0.55, '#2c2370'); base.addColorStop(1, '#3d2a86');
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  let glow = g.createRadialGradient(w * 0.5, 0, 0, w * 0.5, 0, h * 0.7);            // brilho violeta no topo
  glow.addColorStop(0, 'rgba(157,140,255,.30)'); glow.addColorStop(1, 'rgba(157,140,255,0)');
  g.fillStyle = glow; g.fillRect(0, 0, w, h);
  glow = g.createRadialGradient(w * 0.5, h, 0, w * 0.5, h, h * 0.45);               // calor rosado no fim (zona de perigo)
  glow.addColorStop(0, 'rgba(255,79,123,.22)'); glow.addColorStop(1, 'rgba(255,79,123,0)');
  g.fillStyle = glow; g.fillRect(0, 0, w, h);
  const band = (x0, bw, a) => {                                                      // faixas diagonais bem tênues
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0 + bw, 0); g.lineTo(x0 + bw - h * 0.55, h); g.lineTo(x0 - h * 0.55, h); g.closePath(); g.fill();
  };
  band(w * 1.05, w * 0.45, 0.035); band(w * 0.6, w * 0.2, 0.025); band(w * 1.55, w * 0.3, 0.02);
  g.fillStyle = 'rgba(255,255,255,.1)';                                              // divisórias das pistas
  const line = Math.max(1, Math.round(w * 0.004));
  for (let k = 1; k < COLS; k++) g.fillRect(Math.round(k * w / COLS) - Math.floor(line / 2), 0, line, h);
  return c;
}

// Tecla escura com contorno neon. done = versão "já tocada": vidro translúcido, só o contorno.
function makeTile(len, done) {
  const c = makeCanvas(sx, len * ROW_H * sy), g = c.getContext('2d'), w = c.width, h = c.height;
  const ins = w * INS, x = ins, y = ins, kw = w - ins * 2, kh = h - ins * 2, r = w * RAD;
  if (done) {
    g.fillStyle = 'rgba(157,140,255,.14)'; rr(g, x, y, kw, kh, r); g.fill();
    g.lineWidth = Math.max(1, w * 0.014); g.strokeStyle = 'rgba(201,191,255,.45)'; rr(g, x, y, kw, kh, r); g.stroke();
    return c;
  }
  g.save();
  g.shadowColor = 'rgba(157,140,255,.85)'; g.shadowBlur = ins * 0.8;
  const body = g.createLinearGradient(0, y, 0, y + kh);
  body.addColorStop(0, '#0f0a26'); body.addColorStop(0.6, '#17104a'); body.addColorStop(1, '#2a1d8c');
  g.fillStyle = body; rr(g, x, y, kw, kh, r); g.fill();
  g.lineWidth = Math.max(1.5, w * 0.024); g.strokeStyle = COLORS.neon; rr(g, x, y, kw, kh, r); g.stroke();
  g.restore();
  g.save(); rr(g, x, y, kw, kh, r); g.clip();                                        // brilho de vidro no topo
  const sheen = g.createLinearGradient(0, y, 0, y + Math.min(kh, w * 0.9));
  sheen.addColorStop(0, 'rgba(255,255,255,.14)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sheen; g.fillRect(x, y, kw, kh);
  g.restore();
  if (len > 1) {                                                                     // tecla longa: linha no meio e anel no fim
    const lx = w / 2, top = y + kh * 0.1, ring = y + kh - w * 0.3;
    g.strokeStyle = 'rgba(233,230,255,.8)'; g.lineWidth = Math.max(2, w * 0.02); g.lineCap = 'round';
    g.beginPath(); g.moveTo(lx, top); g.lineTo(lx, ring - w * 0.12); g.stroke();
    g.beginPath(); g.arc(lx, ring, w * 0.11, 0, Math.PI * 2); g.stroke();
  }
  return c;
}
function buildSprites() {
  sprites.bg = buildBackground();
  sprites.tile = {};
  for (let len = 1; len <= 3; len++) sprites.tile[len] = { idle: makeTile(len, false), done: makeTile(len, true) };
}

function tileRect(c, y, len, scale = 1) {
  const w = (1 - INS * 2) * scale, h = (len * ROW_H - INS * 2) * scale;
  return { x: c + 0.5 - w / 2, y: y + len * ROW_H / 2 - h / 2, w, h, r: RAD };
}

function drawDone(r, y, t) {
  ctx.drawImage(sprites.tile[r.len].done, t.c, y, 1, r.len * ROW_H);
  const k = Math.min((game.time - t.hitAt) / 0.3, 1);
  if (k >= 1) return;
  const q = tileRect(t.c, y, r.len, 1 - 0.05 * (1 - k));                             // a tecla "afunda" e volta
  ctx.globalAlpha = 0.9 * (1 - k); ctx.fillStyle = mix('#c9bfff', '#7d68ff', k);
  rr(ctx, q.x, q.y, q.w, q.h, q.r); ctx.fill(); ctx.globalAlpha = 1;
}

// Tecla longa sendo segurada: o brilho sobe a partir do fundo da tecla desde o instante do toque (d = quanto ela já andou)
// e enche por completo quando d chega à altura da tecla; o contorno claro pulsa enquanto segura.
function drawHolding(r, y, t) {
  const q = tileRect(t.c, y, r.len), d = Math.max(0, Math.min(game.offset - t.o0, q.h)), bottom = q.y + q.h;
  ctx.save(); rr(ctx, q.x, q.y, q.w, q.h, q.r); ctx.clip();
  if (d > 0) {
    const g = ctx.createLinearGradient(0, bottom - d, 0, bottom);
    g.addColorStop(0, '#e9e6ff'); g.addColorStop(1, '#8f7cff');
    ctx.globalAlpha = 0.92; ctx.fillStyle = g; ctx.fillRect(q.x, bottom - d, q.w, d); ctx.globalAlpha = 1;
  }
  ctx.restore();
  ctx.strokeStyle = '#e9e6ff'; ctx.lineWidth = 0.045 + 0.015 * Math.sin(game.time * 14);
  rr(ctx, q.x, q.y, q.w, q.h, q.r); ctx.stroke();
}

function drawRow(r, y) {
  for (const t of r.tiles) {
    if (t.s === 2) { drawDone(r, y, t); continue; }
    ctx.drawImage(sprites.tile[r.len].idle, t.c, y, 1, r.len * ROW_H);
    if (t.s === 1) drawHolding(r, y, t);
    if (t === game.missTile) {                                                       // sobreposição vermelha de erro
      const q = tileRect(t.c, y, r.len);
      ctx.fillStyle = `rgba(255,79,123,${0.55 + 0.25 * Math.sin(game.time * 10)})`; rr(ctx, q.x, q.y, q.w, q.h, q.r); ctx.fill();
    }
  }
}

function drawWrong() {
  if (!game.wrong) return;
  const w = game.wrong, q = tileRect(w.col, w.cy - ROW_H / 2, 1);
  ctx.fillStyle = 'rgba(255,79,123,.92)'; rr(ctx, q.x, q.y, q.w, q.h, q.r); ctx.fill();
  const cx = w.col + 0.5, cy = w.cy, d = 0.2;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.09; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx - d, cy - d); ctx.lineTo(cx + d, cy + d); ctx.moveTo(cx + d, cy - d); ctx.lineTo(cx - d, cy + d); ctx.stroke();
}

function drawEffects() {
  for (const p of game.particles) {
    const k = 1 - p.age / p.life;
    if (p.ring) {
      ctx.strokeStyle = `rgba(169,156,255,${0.8 * k})`; ctx.lineWidth = 0.06;
      ctx.beginPath(); ctx.arc(p.x, p.y, 0.25 + (p.age / p.life) * 0.9, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.globalAlpha = k; ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.5 + k), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    }
  }
  ctx.font = '800 0.5px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const f of game.floats) {
    const k = f.t / 0.7;
    ctx.globalAlpha = 1 - k * k; ctx.lineWidth = 0.12; ctx.strokeStyle = COLORS.ink; ctx.fillStyle = '#fff';
    ctx.strokeText('+1', f.x, f.y - k * 0.8); ctx.fillText('+1', f.x, f.y - k * 0.8); ctx.globalAlpha = 1;
  }
}

function render() {
  if (!sprites.bg) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(sprites.bg, 0, 0);
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  for (const gl of game.glows) {                                                     // a pista acende onde a tecla foi tocada
    const k = 1 - gl.age / gl.life, g = ctx.createLinearGradient(0, gl.y - 1.8, 0, gl.y + 0.7);
    g.addColorStop(0, 'rgba(169,156,255,0)'); g.addColorStop(0.75, `rgba(169,156,255,${0.3 * k})`); g.addColorStop(1, 'rgba(169,156,255,0)');
    ctx.fillStyle = g; ctx.fillRect(gl.c, gl.y - 1.8, 1, 2.5);
  }
  for (const r of game.rows) {
    const y = rowTop(r);
    if (y >= VIEW_H || y + r.len * ROW_H <= 0) continue;
    drawRow(r, y);
  }
  const g = ctx.createLinearGradient(0, VIEW_H - 0.7, 0, VIEW_H);   // faixa de perigo no limite inferior
  g.addColorStop(0, 'rgba(255,79,123,0)'); g.addColorStop(1, 'rgba(255,79,123,.3)');
  ctx.fillStyle = g; ctx.fillRect(0, VIEW_H - 0.7, COLS, 0.7);
  drawWrong();
  drawEffects();
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
    ui.overReason.textContent = game.endReason === 'white' ? 'Você tocou fora das teclas.' : game.endReason === 'release' ? 'Você soltou a tecla longa antes da hora.' : 'Uma tecla escapou.';
    ui.overScore.textContent = String(game.score);
    ui.overBest.textContent = String(game.best);
    ui.badge.hidden = !game.newRecord;
    ui.restart.focus({ preventScroll: true });
  }
  if (s === STATES.PAUSED) ui.resume.focus({ preventScroll: true });
}

function pop(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
function updateScore(animate) { ui.score.textContent = String(game.score); if (animate && !reduceMotion) pop(ui.score, 'bump'); }
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

/* Ajuda "Como jogar": popover ancorado ABAIXO do botão "?", fora da área do jogo.
   Se abrir no meio da partida, o jogo pausa; ao fechar, a pausa continua até "Continuar". */
const HELP = { gap: 12, edge: 8, maxWidth: 270, button: 40, side: 18 };
let helpOpen = false;
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
// Abre sempre ABAIXO do botão (com rolagem interna se faltar altura). Só inverte para cima quando o botão
// está sob o jogo (celular), onde pode não sobrar espaço embaixo.
function placeHelp() {
  if (!helpOpen) return;
  const pop = ui.helpPopover;
  for (const v of ['max-height', 'overflow-y']) pop.style.removeProperty(v);
  const arena = ui.arena.getBoundingClientRect(), btn = ui.helpButton.getBoundingClientRect();
  const width = Math.floor(Math.min(HELP.maxWidth, arena.width - HELP.edge * 2));
  const left = Math.max(arena.left + HELP.edge, Math.min(btn.left, arena.right - HELP.edge - width));
  pop.style.width = `${width}px`;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.setProperty('--arrow-x', `${Math.round(Math.min(Math.max(btn.left + btn.width / 2 - left, 16), width - 16))}px`);
  const height = pop.offsetHeight;
  const roomBelow = window.innerHeight - btn.bottom - HELP.gap - HELP.edge;
  const roomAbove = btn.top - HELP.gap - HELP.edge;
  let placement = 'below';
  if (ui.frame.dataset.helpPos !== 'side' && height > roomBelow && roomAbove > roomBelow) placement = 'above';
  const room = placement === 'below' ? roomBelow : roomAbove;
  if (height > room) { pop.style.maxHeight = `${Math.max(96, Math.floor(room))}px`; pop.style.overflowY = 'auto'; }
  const finalHeight = pop.offsetHeight;
  pop.style.top = `${Math.round(placement === 'below' ? btn.bottom + HELP.gap : btn.top - HELP.gap - finalHeight)}px`;
  pop.dataset.placement = placement;
}

/* ===== 8. ENTRADA ===== */
// Mouse e toque usam apenas Pointer Events (pointerdown), nunca click: não há comando duplicado.
// O ponto tocado é convertido em coluna + fileira com as mesmas coordenadas usadas no desenho.
function onPointerDown(e) {
  if (e.pointerType === 'touch') sawTouch = true;
  Sound.unlock();
  if (game.state !== STATES.PLAYING) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  const rect = ui.board.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width * COLS, y = (e.clientY - rect.top) / rect.height * VIEW_H;
  if (x < 0 || x >= COLS || y < 0 || y >= VIEW_H) return;
  const row = game.rows.find((r) => { const t = rowTop(r); return y >= t && y < t + r.len * ROW_H; });
  if (row) registerTap(row, Math.floor(x), 'p' + e.pointerId, y);
}

// Teclado: a coluna escolhida é aplicada à fileira escura mais baixa ainda não acertada. Em tecla longa, segure a tecla.
function keyTap(col, id = 'k') {
  if (game.state !== STATES.PLAYING) return;
  const next = game.rows.find(unfinished);
  if (next) registerTap(next, col, id, null);
}

function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (helpOpen && e.code === 'Escape') { e.preventDefault(); closeHelp(); ui.helpButton.focus({ preventScroll: true }); return; }
  Sound.unlock();
  if (e.code in KEYS) { e.preventDefault(); if (!e.repeat) keyTap(KEYS[e.code], 'k' + e.code); }
  else if (e.code === 'KeyM' && !e.repeat) toggleMute();
  else if ((e.code === 'KeyP' || e.code === 'Escape') && !e.repeat) setPaused(game.state === STATES.PLAYING || game.state === STATES.COUNTDOWN);
  else if (e.code === 'Space' || e.code === 'Enter') {
    if (e.target.closest && e.target.closest('button')) return;   // deixa o botão focado agir (início, continuar, jogar de novo, "?")
    e.preventDefault();
    if (game.state === STATES.READY) startGame();
    else if (game.state === STATES.PAUSED) setPaused(false);
    else if (game.state === STATES.OVER) restart();
  }
}

/* ===== 9. REDIMENSIONAMENTO ===== */
// O botão "?" fica fora do jogo: ao lado (reserva dos dois lados, para o jogo seguir centralizado) ou, se faltar
// largura, logo abaixo. Escolhe o formato que permite o maior tabuleiro.
function resize() {
  const m = CONFIG.margin, help = HELP.button + HELP.side;
  const pw = ui.play.clientWidth - m * 2, ph = ui.play.clientHeight - m * 2;
  let best = null;
  for (const pos of ['side', 'below']) {
    const aw = pw - (pos === 'side' ? help * 2 : 0), ah = ph - (pos === 'below' ? help : 0);
    const col = Math.max(CONFIG.minCol, Math.min(CONFIG.maxCol, Math.floor(Math.min(aw / COLS, ah / VIEW_H))));   // coluna em px inteiros
    if (!best || col > best.col) best = { col, pos };
  }
  const col = best.col;
  const dpr = window.devicePixelRatio || 1;
  ui.frame.dataset.helpPos = best.pos;
  ui.arena.style.setProperty('--col', `${col}px`);
  ui.arena.style.setProperty('--bw', `${col * COLS}px`);
  canvas.width = Math.round(col * COLS * dpr); canvas.height = Math.round(col * VIEW_H * dpr);
  sx = canvas.width / COLS; sy = canvas.height / VIEW_H;
  buildSprites();
  render();
  placeHelp();     // reposiciona o painel de ajuda, se estiver aberto
}

/* ===== 10. LOOP E INICIALIZAÇÃO ===== */
// Um único requestAnimationFrame para a vida toda da página. O movimento usa o tempo real (dt) dividido em
// passos de no máximo 20 ms, então a velocidade não depende da taxa de quadros.
let lastTime = null, lastSaveAt = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (lastTime === null) lastTime = now;
  const dt = Math.min(Math.max((now - lastTime) / 1000, 0), CONFIG.maxFrame);
  lastTime = now;
  if (game.state === STATES.COUNTDOWN) updateCountdown(dt);   // só o relógio da contagem anda; física e timers ficam parados
  else if (game.state !== STATES.PAUSED) {
    game.time += dt;
    if (game.goFlash > 0) { game.goFlash -= dt; if (game.goFlash <= 0) ui.count.classList.remove('go'); }
    let left = dt;
    while (left > 0 && game.state === STATES.PLAYING) { const s = Math.min(left, CONFIG.maxStep); step(s); left -= s; }
    updateEffects(dt);
    if (game.state === STATES.PLAYING && now - lastSaveAt >= CONFIG.saveEvery) { lastSaveAt = now; saveGame(); }
  }
  render();
}

function init() {
  initTips();
  const saved = PianoTapStorage.loadGame();
  if (!(saved && restoreGame(saved))) resetRound();   // sem salvamento válido: tela inicial (e descarta o lixo)
  updateBest(false);
  syncMute();
  document.addEventListener('keydown', onKeyDown, { passive: false });
  document.addEventListener('keyup', (e) => { if (e.code in KEYS) releaseInput('k' + e.code); });
  // Soltar o dedo/mouse: encerra a tecla longa que ele segurava (se ainda não estava cumprida).
  document.addEventListener('pointerup', (e) => releaseInput('p' + e.pointerId));
  document.addEventListener('pointercancel', (e) => releaseInput('p' + e.pointerId));
  ui.board.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) onPointerDown(e); });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  ui.mute.addEventListener('click', () => { toggleMute(); ui.mute.blur(); });
  ui.pause.addEventListener('click', () => { setPaused(true, 'manual'); ui.pause.blur(); });
  ui.start.addEventListener('click', startGame);
  ui.helpButton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (helpOpen) closeHelp(); else openHelp();
    if (e.detail > 0) ui.helpButton.blur();   // clique/toque: Space não deve acionar o botão depois
  });
  ui.helpClose.addEventListener('click', (e) => { e.stopPropagation(); closeHelp(); ui.helpButton.focus({ preventScroll: true }); });
  // Um toque fora do popover só o fecha.
  document.addEventListener('pointerdown', (e) => {
    if (helpOpen && !(e.target.closest && e.target.closest('#help-popover, #help-button'))) closeHelp();
  }, true);
  ui.resume.addEventListener('click', () => setPaused(false));
  ui.restartPause.addEventListener('click', backToStart);
  ui.restart.addEventListener('click', restart);
  // Pausa automática ao sair da aba/minimizar; ao voltar o jogo segue pausado até o jogador continuar.
  document.addEventListener('visibilitychange', () => { lastTime = null; if (document.hidden) { setPaused(true, 'auto'); saveGame(); } });
  // F5/fechar/trocar de página: grava o estado exato para o init() recuperar.
  window.addEventListener('pagehide', saveGame);
  window.addEventListener('beforeunload', saveGame);
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(ui.play);
  resize();
  requestAnimationFrame(frame);
}

init();
window.__pianoTap = { game, CONFIG, step, registerTap, keyTap, rowTop, rowBottom, releaseInput };
})();