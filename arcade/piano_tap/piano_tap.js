/* ==========================================================================
arcade/piano_tap/piano_tap.js - Jogo de reflexos com teclas de piano em HTML5 Canvas + JavaScript puro.
Índice: 1 Configuração · 2 Áudio · 3 Estado · 4 Lógica · 5 Efeitos
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
};
const COLORS = {
  seam: '#c4c8da', violet: '#9d8cff', violetSoft: '#e9e6ff', berry: '#ff4f7b', gold: '#ffc857', ink: '#120f2a',
};
const { cols: COLS, rowHeight: ROW_H } = CONFIG;
const VIEW_H = CONFIG.viewRows * ROW_H;
const KEYS = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
const STATES = { READY: 'ready', PLAYING: 'playing', PAUSED: 'paused', OVER: 'over' };
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
    click() { play(() => tone({ type: 'triangle', from: 520, to: 700, duration: 0.06, volume: 0.25 })); },
  };
})();

/* ===== 3. ESTADO ===== */
// Cada fileira tem um índice fixo n; sua posição é rowTop = offset - n * ROW_H. Uma única variável (offset)
// move o tabuleiro inteiro, então as fileiras nunca se desalinham entre si nem trocam de coluna.
const game = {
  state: STATES.READY, time: 0, offset: 0, speed: 0,
  rows: [], nextN: 0, history: [],
  score: 0, startBest: 0, best: PianoTapStorage.getBest(), newRecord: false,
  noteIndex: 0, particles: [], floats: [],
  wrong: null, missRow: null, endReason: '', overAt: 0,
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
};
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
let sx = 1, sy = 1;   // pixels do canvas por unidade (horizontal e vertical)

/* ===== 4. LÓGICA ===== */
const rowTop = (r) => game.offset - r.n * ROW_H;

// Velocidade-alvo depende só da pontuação e tem teto. A velocidade real a segue suavemente (sem saltos).
function targetSpeed() { return Math.min(CONFIG.speedMax, CONFIG.speedStart + game.score * CONFIG.speedStep); }

// Sorteio ponderado: colunas usadas recentemente pesam menos, repetir a última pesa menos ainda
// e três iguais seguidas é proibido. Equilibrado, porém imprevisível.
function pickColumn() {
  const h = game.history, last = h.length ? h[h.length - 1] : -1;
  const twice = h.length >= 2 && h[h.length - 1] === h[h.length - 2];
  const weights = [];
  let total = 0;
  for (let c = 0; c < COLS; c++) {
    let w = 1 / (1 + 0.7 * h.filter((x) => x === c).length);
    if (c === last) w = twice ? 0 : w * 0.4;
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
  const n = game.nextN++;
  const black = n < CONFIG.leadBlank ? -1 : pickColumn();
  if (black >= 0) { game.history.push(black); if (game.history.length > CONFIG.historySize) game.history.shift(); }
  game.rows.push({ n, black, hit: false, hitAt: 0 });
}

// Mantém fileiras suficientes para cobrir o tabuleiro até acima do topo.
function fillRows() {
  while (!game.rows.length || rowTop(game.rows[game.rows.length - 1]) > -ROW_H) pushRow();
}

function resetRound() {
  Object.assign(game, {
    offset: VIEW_H - ROW_H, speed: CONFIG.speedStart, rows: [], nextN: 0, history: [],
    score: 0, startBest: game.best, newRecord: false, noteIndex: 0,
    particles: [], floats: [], wrong: null, missRow: null, endReason: '',
  });
  fillRows();
  ui.board.classList.remove('hit', 'shake');
  updateScore(false);
  setState(STATES.READY);
}

function startGame() {
  if (game.state !== STATES.READY) return;
  Sound.unlock();
  setState(STATES.PLAYING);
}

// Um passo de simulação (dt pequeno e fixo no máximo): mover, repor fileiras, detectar tecla perdida, descartar antigas.
function step(dt) {
  game.speed += (targetSpeed() - game.speed) * Math.min(1, dt * CONFIG.speedEase);
  game.offset += game.speed * dt;
  fillRows();
  for (const r of game.rows) {
    if (r.black >= 0 && !r.hit && rowTop(r) + ROW_H >= VIEW_H) { endRound('miss', r); return; }
  }
  while (game.rows.length && rowTop(game.rows[0]) > VIEW_H + ROW_H) game.rows.shift();
}

// Todo toque (mouse, toque ou teclado) chega aqui já resolvido para uma fileira e uma coluna reais.
function registerTap(row, col) {
  if (game.state !== STATES.PLAYING) return;
  if (row.black === col) { if (!row.hit) hitRow(row); return; }   // tecla preta já acertada: ignora
  endRound('white', { row, col });
}

function hitRow(row) {
  row.hit = true; row.hitAt = game.time;
  game.score++;
  Sound.note(MELODY[game.noteIndex++ % MELODY.length]);
  const cx = row.black + 0.5, cy = rowTop(row) + ROW_H / 2;
  burst(cx, cy, 10, [COLORS.violet, '#c7bdff', COLORS.gold]);
  if (!reduceMotion) game.floats.push({ x: cx, y: cy, t: 0 });
  updateScore(true);
  if (game.startBest > 0 && game.score > game.startBest) {
    const first = !game.newRecord;
    game.newRecord = true;
    if (first) { showToast('Novo recorde!'); Sound.record(); }
  }
  if (game.score > game.best) { game.best = game.score; PianoTapStorage.setBest(game.best); updateBest(true); }
}

function endRound(reason, info) {
  if (game.state !== STATES.PLAYING) return;   // nunca registra a derrota duas vezes
  game.endReason = reason;
  let cx, cy;
  if (reason === 'miss') {
    const over = rowTop(info) + ROW_H - VIEW_H;
    if (over > 0) game.offset -= over;         // recua o excesso: a tecla perdida fica inteira à vista
    game.missRow = info; cx = info.black + 0.5; cy = rowTop(info) + ROW_H / 2;
  } else {
    game.wrong = info; cx = info.col + 0.5; cy = rowTop(info.row) + ROW_H / 2;
  }
  burst(cx, cy, 20, [COLORS.berry, '#ff9bb0', COLORS.gold]);
  Sound.hit();
  ui.board.classList.remove('shake', 'hit'); void ui.board.offsetWidth;
  if (!reduceMotion) ui.board.classList.add('shake');
  ui.board.classList.add('hit');
  game.overAt = performance.now();
  setState(STATES.OVER);
}

function setPaused(paused) {
  if (paused && game.state === STATES.PLAYING) { setState(STATES.PAUSED); Sound.click(); }
  else if (!paused && game.state === STATES.PAUSED) { setState(STATES.PLAYING); Sound.click(); }
}

function restart() {
  // Pequena trava após a derrota para um toque acidental de jogo rápido não reiniciar a partida.
  if (game.state === STATES.OVER && performance.now() - game.overAt < CONFIG.restartLock) return;
  Sound.unlock(); Sound.click();
  resetRound();
  startGame();
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
}

/* ===== 6. RENDERIZAÇÃO ===== */
// As teclas são pré-desenhadas em sprites (refeitos no redimensionamento): desenhar cada quadro é só drawImage.
const sprites = {};
function rr(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function makeSprite(top, mid, bot, gloss) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sx)); c.height = Math.max(1, Math.round(ROW_H * sy));
  const g = c.getContext('2d'), w = c.width, h = c.height;
  g.fillStyle = COLORS.seam; g.fillRect(0, 0, w, h);                // fresta entre as teclas
  const i = w * 0.035, x = i, y = i, kw = w - i * 2, kh = h - i * 2, r = w * 0.07;
  const grad = g.createLinearGradient(0, y, 0, y + kh);
  grad.addColorStop(0, top); grad.addColorStop(0.7, mid); grad.addColorStop(1, bot);
  g.fillStyle = grad; rr(g, x, y, kw, kh, r); g.fill();
  g.save(); rr(g, x, y, kw, kh, r); g.clip();
  g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(x, y + kh * 0.93, kw, kh * 0.07);          // borda frontal
  g.fillStyle = `rgba(255,255,255,${gloss})`; g.fillRect(x, y, kw, kh * 0.05);          // brilho superior
  g.fillStyle = `rgba(255,255,255,${gloss * 0.5})`; g.fillRect(x, y, kw * 0.05, kh);    // brilho lateral
  g.restore();
  return c;
}
function buildSprites() {
  sprites.white = makeSprite('#ffffff', '#f1f2f9', '#dcdfec', 0.9);
  sprites.black = makeSprite('#34364d', '#15161f', '#06070c', 0.12);
  sprites.done = makeSprite('#f6f3ff', '#e2ddff', '#c9c1ff', 0.7);
}

function keyRect(c, y, scale) {
  const i = 0.035, w = (1 - i * 2) * scale, h = (ROW_H - i * 2) * scale;
  return { x: c + 0.5 - w / 2, y: y + ROW_H / 2 - h / 2, w, h, r: 0.07 };
}

function drawHit(c, y, row) {
  ctx.drawImage(sprites.done, c, y, 1, ROW_H);
  const t = Math.min((game.time - row.hitAt) / 0.3, 1);
  if (t >= 1) return;
  const k = keyRect(c, y, 1 - 0.06 * (1 - t));          // a tecla "afunda" e volta
  ctx.globalAlpha = 1 - t; ctx.fillStyle = mix('#7d68ff', '#c9c1ff', t);
  rr(ctx, k.x, k.y, k.w, k.h, k.r); ctx.fill(); ctx.globalAlpha = 1;
}

function drawMarked(c, y, base, alpha) {                  // sobreposição vermelha de erro
  ctx.drawImage(base, c, y, 1, ROW_H);
  const k = keyRect(c, y, 1);
  ctx.fillStyle = `rgba(255,79,123,${alpha})`; rr(ctx, k.x, k.y, k.w, k.h, k.r); ctx.fill();
}

function drawRow(r, y) {
  const wrong = game.wrong && game.wrong.row === r ? game.wrong.col : -1;
  for (let c = 0; c < COLS; c++) {
    if (r.black === c) {
      if (r.hit) drawHit(c, y, r);
      else if (r === game.missRow) drawMarked(c, y, sprites.black, 0.55 + 0.25 * Math.sin(game.time * 10));
      else ctx.drawImage(sprites.black, c, y, 1, ROW_H);
    } else if (c === wrong) {
      drawMarked(c, y, sprites.white, 0.9);
      const cx = c + 0.5, cy = y + ROW_H / 2, d = 0.2;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.09; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx - d, cy - d); ctx.lineTo(cx + d, cy + d); ctx.moveTo(cx + d, cy - d); ctx.lineTo(cx - d, cy + d); ctx.stroke();
    } else ctx.drawImage(sprites.white, c, y, 1, ROW_H);
  }
}

function drawEffects() {
  for (const p of game.particles) {
    const k = 1 - p.age / p.life;
    if (p.ring) {
      ctx.strokeStyle = `rgba(157,140,255,${0.7 * k})`; ctx.lineWidth = 0.06;
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
  if (!sprites.white) return;
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  ctx.clearRect(0, 0, COLS, VIEW_H);
  for (const r of game.rows) {
    const y = rowTop(r);
    if (y >= VIEW_H || y + ROW_H <= 0) continue;
    drawRow(r, y);
  }
  const g = ctx.createLinearGradient(0, VIEW_H - 0.7, 0, VIEW_H);   // faixa de perigo no limite inferior
  g.addColorStop(0, 'rgba(255,79,123,0)'); g.addColorStop(1, 'rgba(255,79,123,.24)');
  ctx.fillStyle = g; ctx.fillRect(0, VIEW_H - 0.7, COLS, 0.7);
  drawEffects();
}

/* ===== 7. INTERFACE ===== */
function setState(s) {
  game.state = s;
  const b = ui.board.classList;
  b.toggle('is-ready', s === STATES.READY); b.toggle('is-playing', s === STATES.PLAYING);
  b.toggle('is-paused', s === STATES.PAUSED); b.toggle('is-over', s === STATES.OVER);
  ui.pause.disabled = s !== STATES.PLAYING;
  if (s === STATES.OVER) {
    ui.overReason.textContent = game.endReason === 'white' ? 'Você tocou numa tecla branca.' : 'Uma tecla preta escapou.';
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
}
function toggleMute() { Sound.setMuted(!Sound.muted); syncMute(); Sound.click(); }

/* Ajuda "Como jogar": popover ancorado ABAIXO do botão "?", fora da área do jogo.
   Se abrir no meio da partida, o jogo pausa; ao fechar, a pausa continua até "Continuar". */
const HELP = { gap: 12, edge: 8, maxWidth: 270, button: 40, side: 18 };
let helpOpen = false;
function openHelp() {
  if (helpOpen) return;
  helpOpen = true;
  ui.helpPopover.hidden = false;
  ui.helpButton.setAttribute('aria-expanded', 'true');
  setPaused(true);                          // só tem efeito durante a partida
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
  Sound.unlock();
  if (game.state !== STATES.PLAYING) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  const rect = ui.board.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width * COLS, y = (e.clientY - rect.top) / rect.height * VIEW_H;
  if (x < 0 || x >= COLS || y < 0 || y >= VIEW_H) return;
  const row = game.rows.find((r) => { const t = rowTop(r); return y >= t && y < t + ROW_H; });
  if (row) registerTap(row, Math.floor(x));
}

// Teclado: a coluna escolhida é aplicada à fileira preta mais baixa ainda não acertada.
function keyTap(col) {
  if (game.state !== STATES.PLAYING) return;
  const next = game.rows.find((r) => r.black >= 0 && !r.hit);
  if (next) registerTap(next, col);
}

function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (helpOpen && e.code === 'Escape') { e.preventDefault(); closeHelp(); ui.helpButton.focus({ preventScroll: true }); return; }
  Sound.unlock();
  if (e.code in KEYS) { e.preventDefault(); if (!e.repeat) keyTap(KEYS[e.code]); }
  else if (e.code === 'KeyM' && !e.repeat) toggleMute();
  else if ((e.code === 'KeyP' || e.code === 'Escape') && !e.repeat) setPaused(game.state === STATES.PLAYING);
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
let lastTime = null;
function frame(now) {
  requestAnimationFrame(frame);
  if (lastTime === null) lastTime = now;
  const dt = Math.min(Math.max((now - lastTime) / 1000, 0), CONFIG.maxFrame);
  lastTime = now;
  if (game.state !== STATES.PAUSED) {
    game.time += dt;
    let left = dt;
    while (left > 0 && game.state === STATES.PLAYING) { const s = Math.min(left, CONFIG.maxStep); step(s); left -= s; }
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
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  ui.mute.addEventListener('click', () => { toggleMute(); ui.mute.blur(); });
  ui.pause.addEventListener('click', () => { setPaused(true); ui.pause.blur(); });
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
window.__pianoTap = { game, CONFIG, step, registerTap, keyTap, rowTop };
})();