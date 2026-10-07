/* ==========================================================================
casual/solitario/solitario.js - Solitário Klondike em JavaScript puro.
Índice: 1 Configuração · 2 Baralho · 3 Áudio · 4 Estado · 5 Regras · 6 Jogadas
· 7 Compra e reciclagem · 8 Desfazer · 9 Fim de jogo · 10 Renderização
· 11 Entrada · 12 Diálogos e inicialização
========================================================================== */
(() => {
'use strict';

/* ===== 1. CONFIGURAÇÃO ===== */
const CONFIG = {
  maxCard: 112, gap: 10, margin: 10,
  downFrac: .12, upFrac: .3, minFactor: .62,        // espaçamento vertical (fração da altura da carta)
  moveMs: 240, autoMs: 110, winDelay: 1500,
  dragThreshold: 6, doubleTapMs: 320,
  points: { wasteToTableau: 5, toFoundation: 10, flip: 5, foundationToTableau: -15, recycle1: -100, recycle3: -20 },
  drawMs: 300, drawStagger: 120, recycleMs: 280, recycleStagger: 28, recycleMaxDelay: 420,   // animação de compra e reciclagem
  volume: .3, undoLimit: 400,
};

// Persistência própria em solitario_storage.js: best (recorde), mode (1 ou 3 cartas) e muted.
const store = SolitarioStorage, SAVED = store.load();
const reduceMotion = () => Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/* ===== 2. BARALHO ===== */
const SUITS = [
  { key: 'h', name: 'Copas', red: true }, { key: 'd', name: 'Ouros', red: true },
  { key: 'c', name: 'Paus', red: false }, { key: 's', name: 'Espadas', red: false },
];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RANK_NAMES = ['Ás', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Valete', 'Dama', 'Rei'];
// posições dos naipes (x, y em % da área central) para as cartas de 2 a 10
const L = 28, C = 50, R = 72;
const PIPS = {
  2: [[C, 4], [C, 96]], 3: [[C, 4], [C, 50], [C, 96]],
  4: [[L, 4], [R, 4], [L, 96], [R, 96]], 5: [[L, 4], [R, 4], [C, 50], [L, 96], [R, 96]],
  6: [[L, 4], [R, 4], [L, 50], [R, 50], [L, 96], [R, 96]], 7: [[L, 4], [R, 4], [C, 27], [L, 50], [R, 50], [L, 96], [R, 96]],
  8: [[L, 4], [R, 4], [C, 27], [L, 50], [R, 50], [C, 73], [L, 96], [R, 96]],
  9: [[L, 4], [R, 4], [L, 35], [R, 35], [C, 50], [L, 65], [R, 65], [L, 96], [R, 96]],
  10: [[L, 4], [R, 4], [C, 21], [L, 35], [R, 35], [L, 65], [R, 65], [C, 79], [L, 96], [R, 96]],
};

// carta = { id (0-51), suit (0-3), rank (1-13), up, el }; id = naipe * 13 + (valor - 1)
const cards = Array.from({ length: 52 }, (_, id) => ({ id, suit: Math.floor(id / 13), rank: (id % 13) + 1, up: false, el: null, x: 0, y: 0, z: 1, placed: false }));
const isRed = (c) => SUITS[c.suit].red;
const label = (c) => `${RANK_NAMES[c.rank - 1]} de ${SUITS[c.suit].name}`;

function rnd(n) {
  const cr = window.crypto;
  if (cr && cr.getRandomValues) { const b = new Uint32Array(1); cr.getRandomValues(b); return b[0] % n; }
  return Math.floor(Math.random() * n);
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const freshDeck = () => Array.from({ length: 52 }, (_, i) => i);

/* ===== 3. ÁUDIO ===== */
const Sound = (() => {
  let ctx = null, master = null, off = false, muted = SAVED.muted === true;
  function ensure() {
    if (off) return null;
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) { off = true; return null; }
      try { ctx = new C(); master = ctx.createGain(); master.gain.value = CONFIG.volume; master.connect(ctx.destination); } catch (e) { off = true; ctx = null; return null; }
    }
    if (ctx.state === 'suspended') { try { ctx.resume().catch(() => {}); } catch (e) { /* ignora */ } }
    return ctx;
  }
  function tone(type, from, to, dur, vol, delay = 0) {
    const c = ensure(); if (!c) return;
    const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(from, t);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  const play = (fn) => { if (muted) return; try { fn(); } catch (e) { /* ignora */ } };
  return {
    get muted() { return muted; },
    unlock() { play(ensure); },
    setMuted(v) { muted = Boolean(v); store.save('muted', muted); play(ensure); },
    draw() { play(() => tone('triangle', 380, 520, 0.05, 0.22)); },
    place() { play(() => tone('triangle', 300, 240, 0.07, 0.25)); },
    found() { play(() => { tone('triangle', 620, 620, 0.08, 0.28); tone('triangle', 930, 930, 0.12, 0.28, 0.07); }); },
    nope() { play(() => tone('sawtooth', 200, 140, 0.16, 0.16)); },
    win() { play(() => [523, 659, 784, 1047, 1319].forEach((f, i) => tone('triangle', f, f, 0.18, 0.3, i * 0.11))); },
  };
})();

/* ===== 4. ESTADO ===== */
// piles guardam ids; a verdade do jogo está aqui e a tela é desenhada a partir dele
const G = {
  order: [],                 // distribuição inicial (para reiniciar a mesma partida)
  tableau: [[], [], [], [], [], [], []], found: [[], [], [], []], stock: [], waste: [], fan: 0,
  mode: 1, score: 0, moves: 0, time: 0, started: false, over: false, busy: false,
  sel: null, undo: [], best: SAVED.best || 0, begun: false, token: 0, autoTimer: 0,
};
const $ = (id) => document.getElementById(id);
const ui = {
  arena: $('arena'), play: $('play'), field: $('field'), live: $('live'),
  time: $('time'), moves: $('moves'), score: $('score'),
  undo: $('undo-button'), restart: $('restart-button'), newBtn: $('new-button'), mute: $('mute-button'),
  game: $('game'), gameBody: $('game-body'), start: $('start-screen'), startBest: $('start-best'), help: $('help-button'), pop: $('help-pop'),
  dlgNew: $('dlg-new'), newWarn: $('new-warn'), newStart: $('new-start'), newCancel: $('new-cancel'),
  dlgRestart: $('dlg-restart'), restartOk: $('restart-ok'), restartCancel: $('restart-cancel'),
  dlgWin: $('dlg-win'), winScore: $('win-score'), winTime: $('win-time'), winMoves: $('win-moves'), badge: $('record-badge'), winAgain: $('win-again'), winClose: $('win-close'),
};
const slots = { stock: null, waste: null, found: [], tableau: [] };
let LOC = {};          // id -> { type, col|f, idx }, refeito a cada render
let M = null;          // medidas do layout atual
let dests = [];        // destinos válidos da seleção atual
const say = (t) => { ui.live.textContent = ''; ui.live.textContent = t; };

/* ===== 5. REGRAS (validação) ===== */
function sequenceOk(col, idx) {
  const p = G.tableau[col];
  for (let i = idx; i < p.length; i++) {
    const c = cards[p[i]];
    if (!c.up) return false;
    if (i > idx) { const prev = cards[p[i - 1]]; if (c.rank !== prev.rank - 1 || isRed(c) === isRed(prev)) return false; }
  }
  return idx < p.length;
}
function canTableau(card, col) {
  const p = G.tableau[col];
  if (!p.length) return card.rank === 13;
  const top = cards[p[p.length - 1]];
  return top.up && top.rank === card.rank + 1 && isRed(top) !== isRed(card);
}
const canFoundation = (card) => G.found[card.suit].length === card.rank - 1;

function isMovableSource(s) {
  if (!s) return false;
  if (s.type === 'tableau') return Boolean(G.tableau[s.col]) && sequenceOk(s.col, s.idx);
  if (s.type === 'waste') return s.idx === G.waste.length - 1 && G.waste.length > 0;
  if (s.type === 'found') return s.idx === G.found[s.f].length - 1 && G.found[s.f].length > 0;
  return false;
}
function sourceCards(s) {
  if (s.type === 'tableau') return G.tableau[s.col].slice(s.idx);
  if (s.type === 'waste') return G.waste.slice(-1);
  return G.found[s.f].slice(-1);
}
function canMove(s, d) {
  if (!isMovableSource(s) || !d) return false;
  const ids = sourceCards(s), first = cards[ids[0]];
  if (d.type === 'tableau') return !(s.type === 'tableau' && s.col === d.col) && canTableau(first, d.col);
  if (d.type === 'found') return ids.length === 1 && s.type !== 'found' && first.suit === d.f && canFoundation(first);
  return false;
}
function computeDests(s) {
  const out = [];
  if (!isMovableSource(s)) return out;
  for (let f = 0; f < 4; f++) if (canMove(s, { type: 'found', f })) out.push({ type: 'found', f });
  for (let col = 0; col < 7; col++) if (canMove(s, { type: 'tableau', col })) out.push({ type: 'tableau', col });
  return out;
}

/* ===== 6. JOGADAS ===== */
function allIds() { return [...G.stock, ...G.waste, ...G.found.flat(), ...G.tableau.flat()]; }
function integrity() { const a = allIds(); return a.length === 52 && new Set(a).size === 52; }
const addScore = (n) => { G.score = Math.max(0, G.score + n); };

function startGame(order, mode) {
  G.token++; clearTimeout(G.autoTimer);
  G.order = order.slice(); G.mode = mode;
  G.tableau = [[], [], [], [], [], [], []]; G.found = [[], [], [], []]; G.stock = []; G.waste = []; G.fan = 0;
  G.score = 0; G.moves = 0; G.time = 0; G.started = false; G.over = false; G.busy = false; G.sel = null; G.undo = []; dests = [];
  cards.forEach((c) => { c.up = false; });
  let k = 0;
  for (let col = 0; col < 7; col++) for (let row = 0; row <= col; row++) { const c = cards[order[k++]]; G.tableau[col].push(c.id); c.up = row === col; }
  G.stock = order.slice(k);                // 24 cartas fechadas; o topo é o último item
  ui.field.classList.remove('celebrate');
  cards.forEach((c) => { c.el.style.animationDelay = ''; c.placed = false; });
  closeDlg(ui.dlgWin);
  render(true);
  say(`Nova partida, compra de ${mode === 3 ? 'três cartas' : 'uma carta'}.`);
}

function removeFromSource(s) {
  if (s.type === 'tableau') return G.tableau[s.col].splice(s.idx);
  if (s.type === 'waste') { if (G.fan > 0) G.fan--; return [G.waste.pop()]; }
  return [G.found[s.f].pop()];
}

function performMove(s, d) {
  pushUndo();
  const ids = removeFromSource(s);
  let pts = 0;
  if (d.type === 'found') { G.found[d.f].push(ids[0]); pts += CONFIG.points.toFoundation; }
  else {
    G.tableau[d.col].push(...ids);
    if (s.type === 'waste') pts += CONFIG.points.wasteToTableau;
    if (s.type === 'found') pts += CONFIG.points.foundationToTableau;
  }
  if (s.type === 'tableau') {                                   // revela a carta que ficou no topo
    const p = G.tableau[s.col];
    if (p.length) { const t = cards[p[p.length - 1]]; if (!t.up) { t.up = true; pts += CONFIG.points.flip; } }
  }
  addScore(pts); G.moves++; G.started = true; G.sel = null; dests = [];
  if (d.type === 'found') Sound.found(); else Sound.place();
  say(`${label(cards[ids[0]])} movida.`);
  afterMove();
}

function afterMove() {
  render();
  if (G.found.every((f) => f.length === 13)) { win(); return; }
  maybeAutoFinish();
}

function autoFoundation(s) {
  if (G.busy || G.over || !isMovableSource(s)) return false;
  const ids = sourceCards(s);
  if (ids.length !== 1 || s.type === 'found') return false;
  const c = cards[ids[0]], d = { type: 'found', f: c.suit };
  if (!canMove(s, d)) return false;
  performMove(s, d);
  return true;
}

// quando só restam cartas viradas e nenhuma no monte/descarte, o resto é automático
function maybeAutoFinish() {
  if (G.over || G.busy || G.stock.length || G.waste.length) return;
  if (G.tableau.some((p) => p.some((id) => !cards[id].up))) return;
  G.busy = true;
  const token = G.token;
  const step = () => {
    if (token !== G.token || G.over) return;
    for (let col = 0; col < 7; col++) {
      const p = G.tableau[col];
      if (p.length && canFoundation(cards[p[p.length - 1]])) {
        performMove({ type: 'tableau', col, idx: p.length - 1 }, { type: 'found', f: cards[p[p.length - 1]].suit });
        if (!G.over) G.autoTimer = setTimeout(step, reduceMotion() ? 20 : CONFIG.autoMs);
        return;
      }
    }
    G.busy = false;
  };
  G.autoTimer = setTimeout(step, 250);
}

/* ===== 7. COMPRA E RECICLAGEM ===== */
function draw() {
  if (G.busy || G.over) return false;
  if (G.stock.length) {
    pushUndo();
    const n = Math.min(G.mode, G.stock.length), drawn = [];
    for (let i = 0; i < n; i++) { const id = G.stock.pop(); cards[id].up = true; G.waste.push(id); drawn.push(id); }
    G.fan = n;
    G.moves++; G.started = true; G.sel = null; dests = [];
    Sound.draw(); say(`Comprou ${n === 1 ? 'uma carta' : n + ' cartas'}.`);
    const map = {};
    drawn.forEach((id, k) => { map[id] = { d: k * CONFIG.drawStagger, dur: CONFIG.drawMs }; });   // uma por vez, na ordem real
    animateMove(map, (n - 1) * CONFIG.drawStagger + CONFIG.drawMs);
    return true;
  }
  if (G.waste.length) {                       // recicla: a primeira carta descartada volta a ser a primeira a sair
    pushUndo();
    const old = G.waste.slice();
    G.stock = old.slice().reverse();
    G.stock.forEach((id) => { cards[id].up = false; });
    G.waste = []; G.fan = 0;
    addScore(G.mode === 3 ? CONFIG.points.recycle3 : CONFIG.points.recycle1);
    G.moves++; G.started = true; G.sel = null; dests = [];
    Sound.draw(); say('Descarte reciclado.');
    const map = {}; let last = 0;
    old.slice().reverse().forEach((id, k) => {          // do topo do descarte para baixo
      const d = Math.min(k * CONFIG.recycleStagger, CONFIG.recycleMaxDelay); map[id] = { d, dur: CONFIG.recycleMs }; last = d;
    });
    animateMove(map, last + CONFIG.recycleMs);
    return true;
  }
  return false;
}

/* ===== 8. DESFAZER ===== */
function snapshot() {
  return { t: G.tableau.map((p) => p.slice()), f: G.found.map((p) => p.slice()), s: G.stock.slice(), w: G.waste.slice(), fan: G.fan,
    score: G.score, moves: G.moves, up: cards.map((c) => c.up) };
}
function pushUndo() { G.undo.push(snapshot()); if (G.undo.length > CONFIG.undoLimit) G.undo.shift(); }
function undo() {
  if (G.busy || G.over || !G.undo.length) { Sound.nope(); return false; }
  const s = G.undo.pop();
  G.tableau = s.t; G.found = s.f; G.stock = s.s; G.waste = s.w; G.fan = s.fan; G.score = s.score; G.moves = s.moves;
  cards.forEach((c, i) => { c.up = s.up[i]; });
  G.sel = null; dests = [];
  Sound.place(); say('Jogada desfeita.');
  render();
  return true;
}

/* ===== 9. FIM DE JOGO, TEMPO E PLACAR ===== */
function win() {
  G.over = true; G.busy = false; G.sel = null; dests = []; clearTimeout(G.autoTimer);
  const record = G.score > G.best;
  if (record) { G.best = G.score; store.save('best', G.best); }
  render();
  Sound.win(); say('Vitória! Todas as cartas estão nas fundações.');
  const token = G.token;
  if (!reduceMotion()) {
    ui.field.classList.add('celebrate');
    cards.forEach((c, i) => { c.el.style.animationDelay = `${(i % 13) * 45 + Math.floor(i / 13) * 20}ms`; });
  }
  setTimeout(() => {
    if (token !== G.token) return;
    ui.winScore.textContent = String(G.score);
    ui.winTime.textContent = fmtTime(G.time);
    ui.winMoves.textContent = String(G.moves);
    ui.badge.hidden = !record;
    openDlg(ui.dlgWin);
    ui.winAgain.focus({ preventScroll: true });
  }, reduceMotion() ? 400 : CONFIG.winDelay);
}
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
setInterval(() => { if (G.started && !G.over && !document.hidden) { G.time++; renderHud(); } }, 1000);

function renderHud(animate) {
  ui.time.textContent = fmtTime(G.time);
  ui.moves.textContent = String(G.moves);
  const was = ui.score.textContent;
  ui.score.textContent = String(G.score);
  if (animate && was !== String(G.score)) pop(ui.score, 'bump');
  ui.undo.disabled = !G.undo.length || G.over || G.busy;
}
function pop(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

/* ===== 10. RENDERIZAÇÃO ===== */
const sym = (k, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><use href="#s-${k}"/></svg>`;

function buildCards() {
  const frag = document.createDocumentFragment();
  cards.forEach((c) => {
    const k = SUITS[c.suit].key, r = RANKS[c.rank - 1];
    let mid;
    if (c.rank === 1) mid = `<span class="mid ace">${sym(k)}</span>`;
    else if (c.rank > 10) mid = `<span class="mid court">${sym(k)}<b class="letter">${r}</b>${sym(k, 'end')}</span>`;
    else mid = `<span class="mid">${PIPS[c.rank].map(([x, y]) => sym(k, `pip${y > 50 ? ' inv' : ''}`).replace('<svg ', `<svg style="left:${x}%;top:${y}%" `)).join('')}</span>`;
    const corner = (cls) => `<span class="corner ${cls}"><b${r === '10' ? ' class="ten"' : ''}>${r}</b>${sym(k)}</span>`;
    const el = document.createElement('button');
    el.type = 'button'; el.className = `card ${isRed(c) ? 'red' : 'blk'}`; el.dataset.id = String(c.id);
    el.innerHTML = `<span class="face verso"></span><span class="face front">${corner('tl')}${corner('br')}${mid}</span>`;
    c.el = el; frag.appendChild(el);
  });
  ui.field.appendChild(frag);
}

function buildSlots() {
  const mk = (cls, html, attrs) => {
    const el = document.createElement('button');
    el.type = 'button'; el.className = `slot ${cls}`; el.innerHTML = html;
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    ui.field.appendChild(el); return el;
  };
  const recycle = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  slots.stock = mk('slot-stock', recycle, { 'data-slot': 'stock', 'aria-label': 'Monte de compra' });
  slots.waste = mk('slot-waste', '', { 'data-slot': 'waste', 'aria-label': 'Descarte vazio', tabindex: '-1' });
  for (let f = 0; f < 4; f++) slots.found.push(mk('slot-found', sym(SUITS[f].key), { 'data-slot': 'found', 'data-f': String(f), 'aria-label': `Fundação de ${SUITS[f].name}` }));
  for (let col = 0; col < 7; col++) slots.tableau.push(mk('slot-col', '', { 'data-slot': 'tableau', 'data-col': String(col), 'aria-label': `Coluna ${col + 1} vazia` }));
}

function metrics() {
  const W = ui.play.clientWidth || 360, H = ui.play.clientHeight || 640;
  const small = W < 480, gap = small ? 4 : W < 760 ? 8 : CONFIG.gap, margin = small ? 4 : CONFIG.margin;
  let cw = Math.min((W - margin * 2 - gap * 6) / 7, CONFIG.maxCard, (H - margin * 2 - gap * 2) / (1.4 * 2.6));
  cw = Math.max(30, Math.floor(cw));
  const ch = Math.round(cw * 1.4), x0 = Math.floor((W - (cw * 7 + gap * 6)) / 2);
  return { W, H, gap, margin, cw, ch, x0, colX: (i) => x0 + i * (cw + gap), topY: margin, tabY: margin + ch + Math.max(gap, Math.round(ch * .12)) };
}

let animMap = null;     // id -> { d: atraso, dur: duração } só durante o render de uma compra/reciclagem
function setCard(c, x, y, z) {
  const el = c.el, a = animMap && animMap[c.id] && !reduceMotion() ? animMap[c.id] : null;
  const moved = !c.placed || c.x !== x || c.y !== y;
  if (a) {
    // espera no lugar de origem (com o z antigo) até a sua vez; só então voa e vira
    el.style.setProperty('--d', `${a.d}ms`); el.style.setProperty('--dur', `${a.dur}ms`);
    el.style.setProperty('--z', String(c.z));
    clearTimeout(c.ft); clearTimeout(c.fs);
    if (a.d) c.fs = setTimeout(() => el.classList.add('flying'), a.d); else el.classList.add('flying');
    c.ft = setTimeout(() => {
      el.classList.remove('flying'); el.style.setProperty('--z', String(z));
      el.style.setProperty('--d', '0ms'); el.style.removeProperty('--dur');
    }, a.d + a.dur + 40);
    el.style.transform = `translate(${x}px,${y}px)`;
    c.x = x; c.y = y; c.z = z; c.placed = true;
    return;
  }
  if (moved) {
    clearTimeout(c.fs);
    el.style.setProperty('--d', '0ms'); el.style.removeProperty('--dur');
    if (c.placed && !reduceMotion()) {
      el.classList.add('flying'); clearTimeout(c.ft);
      c.ft = setTimeout(() => el.classList.remove('flying'), CONFIG.moveMs + 40);
    }
    el.style.transform = `translate(${x}px,${y}px)`;
    c.x = x; c.y = y;
  }
  c.placed = true; c.z = z;
  el.style.setProperty('--z', String(z));
}
// renderiza o estado já atualizado animando as cartas indicadas; bloqueia a entrada até terminar
function animateMove(map, total) {
  if (reduceMotion()) { afterMove(); return; }
  G.busy = true; animMap = map;
  const token = G.token;
  try { afterMove(); } finally { animMap = null; }
  setTimeout(() => { if (token === G.token) { G.busy = false; renderHud(); } }, total + 60);
}
const setSlot = (el, x, y) => { el.style.transform = `translate(${x}px,${y}px)`; };

function render(instant) {
  M = metrics();
  ui.field.style.setProperty('--cw', `${M.cw}px`);
  ui.field.style.setProperty('--ch', `${M.ch}px`);
  if (instant) cards.forEach((c) => { c.placed = false; c.el.style.transition = 'none'; });
  LOC = {};

  setSlot(slots.stock, M.colX(0), M.topY); setSlot(slots.waste, M.colX(1), M.topY);
  slots.found.forEach((el, f) => setSlot(el, M.colX(3 + f), M.topY));

  G.stock.forEach((id, i) => { LOC[id] = { type: 'stock', idx: i }; setCard(cards[id], M.colX(0), M.topY, 1 + i); });
  const vis = G.mode === 3 ? Math.max(1, Math.min(G.fan, G.waste.length)) : 1, wn = G.waste.length, fan = Math.round(M.cw * .24);
  G.waste.forEach((id, i) => {
    LOC[id] = { type: 'waste', idx: i };
    const k = Math.max(0, i - (wn - vis));
    setCard(cards[id], M.colX(1) + k * fan, M.topY, 30 + i);
  });
  G.found.forEach((p, f) => p.forEach((id, i) => { LOC[id] = { type: 'found', f, idx: i }; setCard(cards[id], M.colX(3 + f), M.topY, 60 + i); }));

  const avail = M.H - M.tabY - M.margin, dO = M.ch * CONFIG.downFrac, uO = M.ch * CONFIG.upFrac;
  let bottom = M.tabY + M.ch;
  G.tableau.forEach((p, col) => {
    let need = 0;
    p.forEach((id, i) => { if (i < p.length - 1) need += cards[id].up ? uO : dO; });
    const f = need + M.ch > avail && need > 0 ? Math.max(CONFIG.minFactor, (avail - M.ch) / need) : 1;
    let y = M.tabY;
    p.forEach((id, i) => {
      LOC[id] = { type: 'tableau', col, idx: i };
      setCard(cards[id], M.colX(col), Math.round(y), 100 + i);
      y += (cards[id].up ? uO : dO) * f;
    });
    if (p.length) bottom = Math.max(bottom, Math.round(y - (cards[p[p.length - 1]].up ? uO : dO) * f) + M.ch);
    setSlot(slots.tableau[col], M.colX(col), M.tabY);
  });
  ui.field.style.height = `${Math.max(M.H, bottom + M.margin)}px`;

  ui.field.classList.toggle('picking', Boolean(G.sel && dests.length));
  // seleção e destinos
  const selIds = new Set(G.sel ? sourceCards(G.sel) : []);
  const destCards = new Set(), destSlots = new Set();
  dests.forEach((d) => {
    const pile = d.type === 'found' ? G.found[d.f] : G.tableau[d.col];
    if (pile.length) destCards.add(pile[pile.length - 1]); else destSlots.add(d.type === 'found' ? slots.found[d.f] : slots.tableau[d.col]);
  });
  cards.forEach((c) => {
    const el = c.el, loc = LOC[c.id], src = loc && loc.type !== 'stock' ? loc : null;
    const top = loc && ((loc.type === 'stock' && loc.idx === G.stock.length - 1) || isMovableSource(loc));
    el.classList.toggle('up', c.up);
    el.classList.toggle('selected', selIds.has(c.id));
    el.classList.toggle('dest', destCards.has(c.id));
    el.tabIndex = top ? 0 : -1;
    el.setAttribute('aria-label', c.up ? label(c) + (selIds.has(c.id) ? ', selecionada' : '') : (loc && loc.type === 'stock' ? 'Monte de compra' : 'Carta virada para baixo'));
    el.setAttribute('aria-hidden', c.up || (loc && loc.type === 'stock' && loc.idx === G.stock.length - 1) ? 'false' : 'true');
    if (!src) el.dataset.zone = 'stock'; else delete el.dataset.zone;
  });
  slots.stock.classList.toggle('can-recycle', !G.stock.length && G.waste.length > 0);
  slots.stock.tabIndex = G.stock.length ? -1 : 0;
  slots.stock.setAttribute('aria-label', G.stock.length ? 'Monte de compra' : G.waste.length ? 'Reciclar descarte' : 'Monte vazio');
  slots.found.forEach((el, f) => { el.classList.toggle('dest', destSlots.has(el)); el.tabIndex = G.found[f].length ? -1 : 0; });
  slots.tableau.forEach((el, col) => {
    el.classList.toggle('dest', destSlots.has(el));
    el.tabIndex = G.tableau[col].length ? -1 : 0;
    el.style.visibility = G.tableau[col].length ? 'hidden' : 'visible';
  });
  if (instant) { void ui.field.offsetWidth; cards.forEach((c) => { c.el.style.transition = ''; }); }
  renderHud(true);
}

/* ===== 11. ENTRADA ===== */
let lastTap = null, suppressClick = false;

function shake(els) {
  Sound.nope();
  els.forEach((el) => { el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope'); setTimeout(() => el.classList.remove('nope'), 340); });
}
const shakeSel = () => { if (G.sel) shake(sourceCards(G.sel).map((id) => cards[id].el)); };

function select(loc) {
  G.sel = { type: loc.type, col: loc.col, f: loc.f, idx: loc.idx };
  dests = computeDests(G.sel);
  render();
  say(`${label(cards[sourceCards(G.sel)[0]])} selecionada. ${dests.length ? 'Escolha o destino destacado.' : 'Sem destino válido.'}`);
}
function clearSel() { if (G.sel) { G.sel = null; dests = []; render(); } }
const destFromLoc = (loc) => (loc.type === 'tableau' ? { type: 'tableau', col: loc.col } : loc.type === 'found' ? { type: 'found', f: loc.f } : null);
const sameSrc = (a, b) => a && b && a.type === b.type && a.col === b.col && a.f === b.f && a.idx === b.idx;

function tryDest(d) {
  if (!G.sel) return false;
  if (canMove(G.sel, d)) { performMove(G.sel, d); lastTap = null; return true; }
  shakeSel(); say('Movimento inválido.');
  return false;
}

function tapCard(id) {
  if (G.busy || G.over) return;
  const loc = LOC[id], now = Date.now();
  if (!loc) return;
  if (loc.type === 'stock') { clearSel(); draw(); return; }
  if (lastTap && lastTap.id === id && now - lastTap.t < CONFIG.doubleTapMs) {      // toque duplo: vai para a fundação
    lastTap = null; G.sel = null; dests = [];
    if (!autoFoundation(loc)) { render(); shake([cards[id].el]); say('Essa carta ainda não pode ir para a fundação.'); }
    return;
  }
  lastTap = { id, t: now };
  if (G.sel) {
    if (sameSrc(G.sel, loc)) { clearSel(); return; }
    const d = destFromLoc(loc);
    if (d && canMove(G.sel, d)) { tryDest(d); return; }
    if (isMovableSource(loc)) { select(loc); return; }
    shakeSel(); say('Movimento inválido.');
    return;
  }
  if (isMovableSource(loc)) select(loc);
  else if (!cards[id].up) { Sound.nope(); }
}

ui.field.addEventListener('click', (e) => {
  if (suppressClick) return;
  Sound.unlock();
  const cardEl = e.target.closest('.card'), slotEl = e.target.closest('.slot');
  if (cardEl) { tapCard(Number(cardEl.dataset.id)); return; }
  if (slotEl) {
    if (G.busy || G.over) return;
    const kind = slotEl.dataset.slot;
    if (kind === 'stock') { clearSel(); if (!draw()) shake([slotEl]); }
    else if (kind === 'found') { if (G.sel) { if (!tryDest({ type: 'found', f: Number(slotEl.dataset.f) })) shake([slotEl]); } }
    else if (kind === 'tableau') { if (G.sel) { if (!tryDest({ type: 'tableau', col: Number(slotEl.dataset.col) })) shake([slotEl]); } }
    return;
  }
  clearSel();                                      // toque no feltro vazio cancela a seleção
});

/* arrastar e soltar (mouse e caneta; no toque vale tocar-origem, tocar-destino) */
let pending = null, drag = null;
ui.field.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch' || e.button !== 0 || G.busy || G.over) return;
  const el = e.target.closest('.card');
  if (!el) return;
  const loc = LOC[Number(el.dataset.id)];
  if (loc && loc.type !== 'stock' && isMovableSource(loc)) pending = { loc, x: e.clientX, y: e.clientY };
});
document.addEventListener('pointermove', (e) => {
  if (pending && !drag && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > CONFIG.dragThreshold) {
    const src = { type: pending.loc.type, col: pending.loc.col, f: pending.loc.f, idx: pending.loc.idx };
    G.sel = src; dests = computeDests(src); render();
    const group = sourceCards(src).map((id) => cards[id]);
    group.forEach((c) => c.el.classList.add('dragging'));
    drag = { src, group, x: pending.x, y: pending.y, moved: true };
    lastTap = null;
  }
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.group.forEach((c) => { c.el.style.transform = `translate(${c.x + dx}px,${c.y + dy}px)`; });
    drag.dx = dx; drag.dy = dy;
  }
});
function dropTarget(cx, cy) {
  const near = (from, to) => {
    let best = null, bd = M.cw * .75;
    for (let i = from; i < to; i++) { const d = Math.abs(cx - (M.colX(i) + M.cw / 2)); if (d < bd) { bd = d; best = i; } }
    return best;
  };
  if (cy < M.tabY - M.gap / 2) { const i = near(3, 7); return i === null ? null : { type: 'found', f: i - 3 }; }
  const i = near(0, 7);
  return i === null ? null : { type: 'tableau', col: i };
}
function endDrag() {
  if (pending && !drag) { pending = null; return; }
  if (!drag) return;
  const { src, group } = drag, first = group[0];
  const dst = dropTarget(first.x + M.cw / 2 + (drag.dx || 0), first.y + M.ch / 2 + (drag.dy || 0));
  group.forEach((c) => c.el.classList.remove('dragging'));
  pending = null; drag = null;
  suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
  if (dst && canMove(src, dst)) { performMove(src, dst); return; }
  group.forEach((c) => { c.el.style.transform = `translate(${c.x}px,${c.y}px)`; });   // volta para o lugar
  G.sel = null; dests = []; render();
  if (dst) { shake(group.map((c) => c.el)); say('Movimento inválido.'); }
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

/* tela inicial e ajuda: a mesa fica parada (inert) até o primeiro toque/SPACE */
function setHelp(on) { ui.pop.hidden = !on; ui.help.setAttribute('aria-expanded', on ? 'true' : 'false'); }
function syncBegin() {
  ui.game.classList.toggle('is-ready', !G.begun); ui.gameBody.inert = !G.begun;
  document.querySelectorAll('[data-start-mode]').forEach((el) => el.setAttribute('aria-checked', String(Number(el.dataset.startMode) === G.mode)));
  ui.startBest.hidden = !G.best; ui.startBest.textContent = G.best ? `Recorde: ${G.best} pontos` : '';
}
function begin() {
  if (G.begun || !ui.pop.hidden) return;   // com a ajuda aberta, o toque só fecha a ajuda
  G.begun = true; Sound.unlock(); syncBegin();
}
function setStartMode(m) { if (G.begun || m === G.mode || G.moves) return; G.mode = m; store.save('mode', m); syncBegin(); render(); say(`Compra de ${m === 3 ? 'três cartas' : 'uma carta'}.`); }
ui.start.addEventListener('click', (e) => { if (!e.target.closest('.start-modes')) begin(); });
document.querySelectorAll('[data-start-mode]').forEach((el) => el.addEventListener('click', () => setStartMode(Number(el.dataset.startMode))));
ui.help.addEventListener('click', () => setHelp(ui.pop.hidden));
document.addEventListener('click', (e) => {
  if (!ui.pop.hidden && !e.target.closest('.help')) setHelp(false);
  const b = e.target.closest && e.target.closest('.help-button, .start-modes button'); if (b && e.detail) b.blur();   // clique/toque não deixa foco preso: SPACE continua iniciando
});

/* botões e teclado */
const dialogOpen = () => Boolean(document.querySelector('dialog[open]'));
function syncMute() {
  ui.mute.classList.toggle('is-muted', Sound.muted);
  ui.mute.setAttribute('aria-pressed', Sound.muted ? 'true' : 'false');
  ui.mute.setAttribute('aria-label', Sound.muted ? 'Ativar efeitos sonoros' : 'Silenciar efeitos sonoros');
}
function toggleMute() { Sound.setMuted(!Sound.muted); syncMute(); }
const hasProgress = () => G.moves > 0 && !G.over;

function askNew() {
  ui.newWarn.hidden = !hasProgress();
  const r = document.querySelector(`input[name="mode"][value="${store.load().mode === 3 ? 3 : 1}"]`);
  if (r) r.checked = true;
  openDlg(ui.dlgNew); ui.newStart.focus({ preventScroll: true });
}
function askRestart() { if (hasProgress()) { openDlg(ui.dlgRestart); ui.restartOk.focus({ preventScroll: true }); } else restartNow(); }
function restartNow() { Sound.unlock(); startGame(G.order, G.mode); }

ui.undo.addEventListener('click', () => { undo(); ui.undo.blur(); });
ui.restart.addEventListener('click', () => { askRestart(); ui.restart.blur(); });
ui.newBtn.addEventListener('click', () => { askNew(); ui.newBtn.blur(); });
ui.mute.addEventListener('click', () => { toggleMute(); ui.mute.blur(); });

document.addEventListener('keydown', (e) => {
  if (dialogOpen() || e.altKey || e.repeat) return;
  if (e.code === 'Escape' && !ui.pop.hidden) { setHelp(false); ui.help.blur(); return; }
  const onBtn = e.target && e.target.closest && e.target.closest('button');
  if (!G.begun) { if ((e.code === 'Space' || e.code === 'Enter') && !onBtn) { e.preventDefault(); begin(); } return; }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); undo(); return; }
  if (e.ctrlKey || e.metaKey) return;
  switch (e.code) {
    case 'KeyU': undo(); break;
    case 'KeyN': askNew(); break;
    case 'KeyR': askRestart(); break;
    case 'KeyM': toggleMute(); break;
    case 'KeyD': clearSel(); draw(); break;
    case 'Escape': clearSel(); break;
    case 'KeyF': {
      const a = document.activeElement, id = G.sel ? sourceCards(G.sel)[0] : a && a.classList && a.classList.contains('card') ? Number(a.dataset.id) : null;
      if (id !== null && LOC[id]) { const loc = LOC[id]; G.sel = null; dests = []; if (!autoFoundation(loc)) { render(); shake([cards[id].el]); } }
      break;
    }
    default:
  }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

/* ===== 12. DIÁLOGOS E INICIALIZAÇÃO ===== */
function openDlg(d) { if (d.open) return; if (d.showModal) { try { d.showModal(); return; } catch (e) { /* cai no atributo */ } } d.setAttribute('open', ''); }
function closeDlg(d) { if (!d.open) return; if (d.close) d.close(); else d.removeAttribute('open'); }

ui.newCancel.addEventListener('click', () => closeDlg(ui.dlgNew));
ui.newStart.addEventListener('click', () => {
  const r = document.querySelector('input[name="mode"]:checked'), mode = r && r.value === '3' ? 3 : 1;
  store.save('mode', mode); closeDlg(ui.dlgNew); Sound.unlock();
  startGame(shuffle(freshDeck()), mode);
});
ui.restartCancel.addEventListener('click', () => closeDlg(ui.dlgRestart));
ui.restartOk.addEventListener('click', () => { closeDlg(ui.dlgRestart); restartNow(); });
ui.winClose.addEventListener('click', () => closeDlg(ui.dlgWin));
ui.winAgain.addEventListener('click', () => { closeDlg(ui.dlgWin); Sound.unlock(); startGame(shuffle(freshDeck()), G.mode); });
[ui.dlgNew, ui.dlgRestart, ui.dlgWin].forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) closeDlg(d); }));

window.addEventListener('resize', () => render());
window.addEventListener('orientationchange', () => render());
if (window.ResizeObserver) new ResizeObserver(() => render()).observe(ui.play);

buildSlots();
buildCards();
syncMute();
startGame(shuffle(freshDeck()), SAVED.mode === 3 ? 3 : 1);
syncBegin();
window.__solitaire = { begin, G, cards, CONFIG, SUITS, startGame, draw, undo, performMove, canMove, canTableau, canFoundation, isMovableSource, sourceCards, sequenceOk, integrity, shuffle, freshDeck, computeDests, autoFoundation, tapCard, render, restartNow, dropTarget: (x, y) => dropTarget(x, y) };
})();