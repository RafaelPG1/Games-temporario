/* ==========================================================================
casual/solitario/solitario.js - Solitário Klondike em JavaScript puro.
Índice: 1 Configuração · 2 Baralho · 3 Áudio · 4 Estado · 5 Regras · 6 Jogadas
· 7 Compra (uma carta por vez) · 8 Desfazer · 9 Fim de jogo · 10 Renderização
· 11 Entrada (toque, mouse, teclado) · 12 Pausa, recuperação e inicialização
========================================================================== */
(() => {
'use strict';

/* ===== 1. CONFIGURAÇÃO ===== */
const CONFIG = {
  maxCard: 112, gap: 10, margin: 10,
  downFrac: .12, upFrac: .3, minFactor: .62,        // espaçamento vertical (fração da altura da carta)
  moveMs: 240, autoMs: 110, winDelay: 1500,
  dragThreshold: 6, dragThresholdTouch: 8, doubleTapMs: 320,
  points: { wasteToTableau: 5, toFoundation: 10, flip: 5, foundationToTableau: -15 },
  drawMs: 300, drawStagger: 120,                      // animação de compra
  countMs: 800, goMs: 650,                            // contagem 3 → 2 → 1 → GO!
  volume: .3, undoLimit: 400, undoSave: 30,           // undoSave = jogadas desfazíveis guardadas na partida salva
};

// Persistência própria em solitario_storage.js: best (recorde), muted e game (partida em andamento).
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
    tick() { play(() => tone('triangle', 520, 520, 0.09, 0.2)); },
    go() { play(() => { tone('triangle', 780, 780, 0.09, 0.24); tone('triangle', 1170, 1170, 0.16, 0.24, 0.08); }); },
    win() { play(() => [523, 659, 784, 1047, 1319].forEach((f, i) => tone('triangle', f, f, 0.18, 0.3, i * 0.11))); },
  };
})();

/* ===== 4. ESTADO ===== */
// piles guardam ids; a verdade do jogo está aqui e a tela é desenhada a partir dele
const G = {
  order: [],                 // distribuição inicial (para reiniciar a mesma partida)
  tableau: [[], [], [], [], [], [], []], found: [[], [], [], []], stock: [], waste: [],   // waste: no máximo 1 carta
  score: 0, moves: 0, time: 0, started: false, over: false, busy: false,
  sel: null, undo: [], best: SAVED.best || 0, begun: false, token: 0, autoTimer: 0,
  paused: false,             // pausa manual, automática ou recuperada (continua true durante a contagem)
  counting: 0,               // id da contagem 3-2-1-GO em andamento (0 = nenhuma)
  auto: false,               // fim automático em andamento (para retomar após a pausa)
};
const $ = (id) => document.getElementById(id);
const ui = {
  arena: $('arena'), play: $('play'), field: $('field'), live: $('live'),
  time: $('time'), moves: $('moves'), score: $('score'),
  undo: $('undo-button'), restart: $('restart-button'), newBtn: $('new-button'), mute: $('mute-button'),
  game: $('game'), gameBody: $('game-body'), start: $('start-screen'), startBest: $('start-best'), startBtn: $('start-button'), startHelp: $('start-help'),
  pauseBtn: $('pause-button'), helpBtn: $('help-button'),
  pauseScreen: $('pause-screen'), pauseTitle: $('pause-title'), pauseSub: $('pause-sub'), pauseContinue: $('pause-continue'), pauseRestart: $('pause-restart'), pauseHelp: $('pause-help'),
  pScore: $('p-score'), pTime: $('p-time'), pMoves: $('p-moves'), countdown: $('countdown'), countNum: $('count-num'),
  dlgNew: $('dlg-new'), newStart: $('new-start'), newCancel: $('new-cancel'), dlgHelp: $('dlg-help'), helpClose: $('help-close'),
  dlgRestart: $('dlg-restart'), restartText: $('restart-text'), restartOk: $('restart-ok'), restartCancel: $('restart-cancel'),
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

function startGame(order) {
  G.token++; clearTimeout(G.autoTimer); cancelCountdown(); cancelDrag();
  G.order = order.slice();
  G.tableau = [[], [], [], [], [], [], []]; G.found = [[], [], [], []]; G.stock = []; G.waste = [];
  G.score = 0; G.moves = 0; G.time = 0; G.started = false; G.over = false; G.busy = false; G.sel = null; G.undo = []; dests = [];
  G.paused = false; G.auto = false;
  cards.forEach((c) => { c.up = false; });
  let k = 0;
  for (let col = 0; col < 7; col++) for (let row = 0; row <= col; row++) { const c = cards[order[k++]]; G.tableau[col].push(c.id); c.up = row === col; }
  G.stock = order.slice(k);                // 24 cartas fechadas; o topo é o último item
  ui.field.classList.remove('celebrate');
  cards.forEach((c) => { c.el.style.animationDelay = ''; c.placed = false; });
  closeDlg(ui.dlgWin);
  render(true);
  syncBegin(); schedulePersist();
  say('Nova partida.');
}

function removeFromSource(s) {
  if (s.type === 'tableau') return G.tableau[s.col].splice(s.idx);
  if (s.type === 'waste') return [G.waste.pop()];
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

// quando só restam cartas viradas e nenhuma no monte/descarte, o resto é automático (pausa interrompe e retoma)
function autoStep(token) {
  if (token !== G.token || G.over || G.paused) return;
  for (let col = 0; col < 7; col++) {
    const p = G.tableau[col];
    if (p.length && canFoundation(cards[p[p.length - 1]])) {
      performMove({ type: 'tableau', col, idx: p.length - 1 }, { type: 'found', f: cards[p[p.length - 1]].suit });
      if (!G.over) G.autoTimer = setTimeout(() => autoStep(token), reduceMotion() ? 20 : CONFIG.autoMs);
      return;
    }
  }
  G.busy = false; G.auto = false;
}
function maybeAutoFinish() {
  if (G.over || G.busy || G.paused || G.stock.length || G.waste.length) return;
  if (G.tableau.some((p) => p.some((id) => !cards[id].up))) return;
  G.busy = true; G.auto = true;
  G.autoTimer = setTimeout(() => autoStep(G.token), 250);
}

/* ===== 7. COMPRA (UMA CARTA POR VEZ) ===== */
// Só existe uma carta comprada na área de compra. Enquanto ela tiver destino válido, o monte fica bloqueado.
// Se ela não servir em lugar nenhum, comprar a devolve (virada) ao fim do monte e compra a próxima.
const wasteHasPlay = () => G.waste.length === 1 && computeDests({ type: 'waste', idx: 0 }).length > 0;

function draw() {
  if (G.busy || G.over || G.paused) return false;
  const back = G.waste.length > 0;
  if (back && wasteHasPlay()) { say('Use a carta comprada antes de comprar outra.'); return false; }
  if (!G.stock.length) { say(back ? 'Não há outras cartas para comprar.' : 'Monte vazio.'); return false; }
  pushUndo();
  const map = {};
  if (back) { const rid = G.waste.pop(); cards[rid].up = false; G.stock.unshift(rid); map[rid] = { d: 0, dur: CONFIG.drawMs }; }
  const id = G.stock.pop(); cards[id].up = true; G.waste.push(id);
  map[id] = { d: back ? CONFIG.drawStagger : 0, dur: CONFIG.drawMs };
  G.moves++; G.started = true; G.sel = null; dests = [];
  Sound.draw(); say(`Comprou ${label(cards[id])}.`);
  animateMove(map, (back ? CONFIG.drawStagger : 0) + CONFIG.drawMs);
  return true;
}

/* ===== 8. DESFAZER ===== */
function snapshot() {
  return { t: G.tableau.map((p) => p.slice()), f: G.found.map((p) => p.slice()), s: G.stock.slice(), w: G.waste.slice(),
    score: G.score, moves: G.moves, up: cards.map((c) => c.up) };
}
function pushUndo() { G.undo.push(snapshot()); if (G.undo.length > CONFIG.undoLimit) G.undo.shift(); }
function undo() {
  if (G.busy || G.over || G.paused || !G.undo.length) { Sound.nope(); return false; }
  const s = G.undo.pop();
  G.tableau = s.t; G.found = s.f; G.stock = s.s; G.waste = s.w; G.score = s.score; G.moves = s.moves;
  cards.forEach((c, i) => { c.up = s.up[i]; });
  G.sel = null; dests = [];
  Sound.place(); say('Jogada desfeita.');
  render();
  return true;
}

/* ===== 9. FIM DE JOGO, TEMPO E PLACAR ===== */
function win() {
  G.over = true; G.busy = false; G.auto = false; G.sel = null; dests = []; clearTimeout(G.autoTimer);
  clearTimeout(pTimer); store.clearGame();                // partida terminada não é recuperada; o recorde fica
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
setInterval(() => {
  if (G.started && !G.over && !G.paused && !document.hidden && !dialogOpen()) { G.time++;   // parado também atrás de um aviso aberto
     renderHud(); if (G.time % 5 === 0) schedulePersist(); }
}, 1000);

function renderHud(animate) {
  ui.time.textContent = fmtTime(G.time);
  ui.moves.textContent = String(G.moves);
  const was = ui.score.textContent;
  ui.score.textContent = String(G.score);
  if (animate && was !== String(G.score)) pop(ui.score, 'bump');
  ui.undo.disabled = !G.undo.length || G.over || G.busy;
  ui.pauseBtn.disabled = G.over;
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
  slots.stock = mk('slot-stock', '', { 'data-slot': 'stock', 'aria-label': 'Monte de compra' });
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
  G.waste.forEach((id, i) => { LOC[id] = { type: 'waste', idx: i }; setCard(cards[id], M.colX(1), M.topY, 30 + i); });
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
  const locked = wasteHasPlay();
  cards.forEach((c) => {
    const el = c.el, loc = LOC[c.id], src = loc && loc.type !== 'stock' ? loc : null;
    const top = loc && ((loc.type === 'stock' && loc.idx === G.stock.length - 1) || isMovableSource(loc));
    el.classList.toggle('up', c.up);
    el.classList.toggle('selected', selIds.has(c.id));
    el.classList.toggle('dest', destCards.has(c.id));
    el.classList.toggle('locked', locked && loc && loc.type === 'stock');
    el.classList.toggle('grab', Boolean(src && isMovableSource(src)));   // só estas capturam o gesto de toque (touch-action: none)
    el.tabIndex = top ? 0 : -1;
    el.setAttribute('aria-label', c.up ? label(c) + (selIds.has(c.id) ? ', selecionada' : '') : (loc && loc.type === 'stock' ? 'Monte de compra' : 'Carta virada para baixo'));
    el.setAttribute('aria-hidden', c.up || (loc && loc.type === 'stock' && loc.idx === G.stock.length - 1) ? 'false' : 'true');
    if (!src) el.dataset.zone = 'stock'; else delete el.dataset.zone;
  });
  slots.stock.classList.toggle('locked', locked);
  slots.stock.tabIndex = G.stock.length ? -1 : 0;
  slots.stock.setAttribute('aria-label', G.stock.length ? 'Monte de compra' : 'Monte vazio');
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
let lastTap = null, suppressUntil = 0;

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
  if (loc.type === 'stock') { clearSel(); if (!draw()) shake([cards[id].el]); return; }
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
  if (Date.now() < suppressUntil || G.paused) return;
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

/* arrastar e soltar: Pointer Events para mouse, caneta e toque. No toque, só as cartas movíveis
   (classe .grab, touch-action: none) capturam o gesto; o resto da mesa continua rolando normalmente. */
let pending = null, drag = null;
const slop = (t) => (t === 'touch' ? CONFIG.dragThresholdTouch : CONFIG.dragThreshold);

ui.field.addEventListener('pointerdown', (e) => {
  if (G.busy || G.over || G.paused || !e.isPrimary || pending || drag) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const el = e.target.closest('.card');
  if (!el) return;
  const loc = LOC[Number(el.dataset.id)];
  if (loc && loc.type !== 'stock' && isMovableSource(loc)) pending = { loc, x: e.clientX, y: e.clientY, id: e.pointerId, type: e.pointerType };
});
document.addEventListener('pointermove', (e) => {
  if (!pending || e.pointerId !== pending.id) return;
  if (!drag) {
    if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) <= slop(pending.type)) return;
    const src = { type: pending.loc.type, col: pending.loc.col, f: pending.loc.f, idx: pending.loc.idx };
    G.sel = src; dests = computeDests(src); render();
    const group = sourceCards(src).map((id) => cards[id]);
    group.forEach((c) => c.el.classList.add('dragging'));
    drag = { src, group, x: pending.x, y: pending.y, dx: 0, dy: 0 };
    try { ui.field.setPointerCapture(pending.id); } catch (err) { /* sem captura: os eventos seguem no document */ }
    lastTap = null;
  }
  drag.dx = e.clientX - drag.x; drag.dy = e.clientY - drag.y;
  drag.group.forEach((c) => { c.el.style.transform = `translate(${c.x + drag.dx}px,${c.y + drag.dy}px)`; });
});
// impede a rolagem da página enquanto uma carta está sendo arrastada (navegadores sem touch-action completo)
ui.field.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });

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
function releaseCapture() { if (pending) { try { ui.field.releasePointerCapture(pending.id); } catch (err) { /* ignora */ } } }
function endDrag(e) {
  if (!pending || (e && e.pointerId !== pending.id)) return;
  if (!drag) { pending = null; return; }
  const { src, group } = drag, first = group[0], cancelled = Boolean(e && e.type === 'pointercancel');
  const dst = cancelled ? null : dropTarget(first.x + M.cw / 2 + drag.dx, first.y + M.ch / 2 + drag.dy);
  group.forEach((c) => c.el.classList.remove('dragging'));
  releaseCapture(); pending = null; drag = null;
  suppressUntil = Date.now() + 400;                 // o click gerado ao soltar não pode virar toque
  if (dst && canMove(src, dst)) { performMove(src, dst); return; }
  group.forEach((c) => { c.el.style.transform = `translate(${c.x}px,${c.y}px)`; });   // volta para o lugar
  G.sel = null; dests = []; render();
  if (dst) { shake(group.map((c) => c.el)); say('Movimento inválido.'); }
}
// cancela um arrasto em andamento (pausa, nova partida, aba escondida)
function cancelDrag() {
  if (!drag) { pending = null; return; }
  const { group } = drag;
  group.forEach((c) => { c.el.classList.remove('dragging'); c.el.style.transform = `translate(${c.x}px,${c.y}px)`; });
  releaseCapture(); pending = null; drag = null; G.sel = null; dests = [];
  render();
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

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
  if (!hasProgress()) { newNow(); return; }
  if (G.counting) pauseGame('pause');                  // só a contagem precisa ser interrompida; nada de tela de pausa junto do aviso
  openDlg(ui.dlgNew); ui.newStart.focus({ preventScroll: true });
}
// Reiniciar faz SEMPRE o mesmo caminho (pergunta e confirma), com 0 jogada ou com mil, antes ou depois de começar.
// Fora da pausa recomeça a mesma distribuição na mesa; com a partida pausada (manual, recuperada ou na contagem)
// descarta tudo e volta à tela inicial, sem começar outra.
let restartTarget = 'play';
function askRestart() {
  const fromPause = G.begun && G.paused;
  restartTarget = fromPause ? 'start' : 'play';
  ui.restartText.textContent = fromPause ? 'O progresso desta partida será descartado e você volta à tela inicial.' : 'As mesmas cartas voltam à posição inicial e o placar é zerado.';
  if (G.counting) pauseGame('pause');                    // só a contagem precisa ser interrompida; a tela de pausa NÃO abre junto do aviso
  openDlg(ui.dlgRestart); ui.restartOk.focus({ preventScroll: true });
}
function restartNow() { Sound.unlock(); startGame(G.order); say('Partida reiniciada.'); }
function backToStart() {
  Sound.unlock();
  cancelCountdown(); cancelDrag(); clearTimeout(G.autoTimer); clearTimeout(pTimer);
  G.begun = false;                       // antes de reiniciar: nada é regravado
  startGame(G.order);                    // mesma distribuição, placar zerado, sem pausa nem contagem pendentes
  store.clearGame(); setKind('pause'); syncBegin();
  ui.startBtn.focus({ preventScroll: true });
  say('Partida descartada. Toque para iniciar.');
}
function newNow() { Sound.unlock(); startGame(shuffle(freshDeck())); }

ui.undo.addEventListener('click', () => { undo(); ui.undo.blur(); });
ui.restart.addEventListener('click', () => { askRestart(); ui.restart.blur(); });
ui.newBtn.addEventListener('click', () => { askNew(); ui.newBtn.blur(); });
ui.mute.addEventListener('click', () => { toggleMute(); ui.mute.blur(); });
ui.pauseBtn.addEventListener('click', () => { pauseGame('pause'); });
ui.helpBtn.addEventListener('click', () => { openHelp(); ui.helpBtn.blur(); });

document.addEventListener('keydown', (e) => {
  if (dialogOpen() || e.altKey || e.repeat) return;
  const onBtn = e.target && e.target.closest && e.target.closest('button');
  const go = (e.code === 'Space' || e.code === 'Enter') && !onBtn;       // com um botão focado, o próprio botão responde
  if (!G.begun) { if (go) { e.preventDefault(); begin(); } else if (e.code === 'KeyR') askRestart(); return; }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !G.paused) { e.preventDefault(); undo(); return; }
  if (e.ctrlKey || e.metaKey) return;
  if (e.code === 'KeyM') { toggleMute(); return; }
  if (G.counting) { if (e.code === 'KeyP' || e.code === 'Escape') { e.preventDefault(); pauseGame('pause'); } return; }   // nada avança na contagem
  if (G.paused) {
    if (go || e.code === 'KeyP') { e.preventDefault(); resumeGame(); }
    else if (e.code === 'KeyR') askRestart();
    else if (e.code === 'KeyN') askNew();
    return;
  }
  switch (e.code) {
    case 'KeyP': pauseGame('pause'); break;
    case 'KeyU': undo(); break;
    case 'KeyN': askNew(); break;
    case 'KeyR': askRestart(); break;
    case 'KeyD': clearSel(); draw(); break;
    case 'Escape': if (G.sel) clearSel(); else pauseGame('pause'); break;
    case 'KeyF': {
      const a = document.activeElement, id = G.sel ? sourceCards(G.sel)[0] : a && a.classList && a.classList.contains('card') ? Number(a.dataset.id) : null;
      if (id !== null && LOC[id]) { const loc = LOC[id]; G.sel = null; dests = []; if (!autoFoundation(loc)) { render(); shake([cards[id].el]); } }
      break;
    }
    default:
  }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

/* ===== Tooltips (um único elemento reaproveitado: não duplica, não sobrepõe e fica dentro da tela) ===== */
// O texto vem de data-tip ("Pausar (P)"): o nome vira o rótulo e o que está entre parênteses vira a tecla.
// A espera do hover é só CSS (--tip-delay); aqui ficam o posicionamento e os gatilhos de mostrar/esconder.
const tip = $('tip'), tipText = tip.querySelector('.tip-text'), tipKey = tip.querySelector('.tip-key');
let tipFor = null, tipDismissed = null, tipHover = null;
const tipOf = (n) => (n && n.closest ? n.closest('[data-tip]') : null);
function tipHide() { tip.classList.remove('on', 'by-focus'); tipFor = null; }
function tipPlace(el) {
  const r = el.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight, m = 8;
  tip.style.left = '0px'; tip.style.top = '0px';
  const w = tip.offsetWidth, h = tip.offsetHeight, cx = r.left + r.width / 2;
  const left = Math.max(m, Math.min(cx - w / 2, vw - w - m));
  let top = r.bottom + 10, up = false;
  if (top + h > vh - m && r.top - 10 - h >= m) { top = r.top - 10 - h; up = true; }       // sem espaço embaixo: abre para cima
  tip.style.left = `${left}px`; tip.style.top = `${Math.max(m, top)}px`;
  tip.style.setProperty('--ax', `${Math.max(14, Math.min(cx - left, w - 14))}px`);         // a seta continua apontando para o botão
  tip.classList.toggle('up', up);
}
function tipShow(el, byFocus) {
  if (tipDismissed === el) return;
  if (tipFor !== el) {
    const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(el.dataset.tip);
    tipText.textContent = m ? m[1] : el.dataset.tip;
    tipKey.textContent = m ? m[2] : ''; tipKey.hidden = !m;
    tip.classList.remove('on'); void tip.offsetWidth;                                       // trocar de botão reinicia a espera
    tipFor = el; tipPlace(el);
  }
  tip.classList.toggle('by-focus', byFocus);
  tip.classList.add('on');
}
const focusTip = () => { const a = document.activeElement; return a && a === tipFor && a.matches(':focus-visible'); };
document.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  let el = tipOf(e.target);
  if (!el) {                                                                                // botão desabilitado pode não receber o evento: confere pela posição
    const bar = e.target.closest && e.target.closest('.tools');
    if (bar) el = [...bar.querySelectorAll('[data-tip]')].find((b) => { const r = b.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; }) || null;
  }
  if (el === tipHover) return;
  tipHover = el; tipDismissed = null;
  if (el) tipShow(el, false); else if (!focusTip()) tipHide();
});
document.addEventListener('pointerout', (e) => { if (!e.relatedTarget && e.pointerType !== 'touch') { tipHover = null; tipDismissed = null; if (!focusTip()) tipHide(); } });
// clicar ou ativar (mouse, toque, Enter/Espaço) esconde na hora e só volta depois que o mouse sair e entrar de novo
document.addEventListener('pointerdown', (e) => { const el = tipOf(e.target) || tipHover; if (el) tipDismissed = el; tipHide(); }, true);
document.addEventListener('click', (e) => { const el = tipOf(e.target); if (el) tipDismissed = el; tipHide(); }, true);
document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {                                                              // 1º Esc só fecha o tooltip visível (não pausa o jogo)
    const seen = getComputedStyle(tip).visibility === 'visible'; tipHide();
    if (seen) e.stopPropagation();
    return;
  }
  if (e.code === 'Enter' || e.code === 'Space') { const el = tipOf(e.target); if (el) tipDismissed = el; tipHide(); }
}, true);
document.addEventListener('focusin', (e) => {
  const el = tipOf(e.target);
  if (!el) { if (tip.classList.contains('by-focus')) tipHide(); return; }
  if (el.matches(':focus-visible')) { tipDismissed = null; tipShow(el, true); }              // teclado: aparece sem espera
});
document.addEventListener('focusout', (e) => { if (tipOf(e.target) === tipFor) tipHide(); if (tipDismissed === tipOf(e.target)) tipDismissed = null; });
window.addEventListener('blur', tipHide); window.addEventListener('resize', tipHide); window.addEventListener('scroll', tipHide, true);
document.addEventListener('visibilitychange', tipHide);

/* ===== 12. PAUSA, RECUPERAÇÃO E INICIALIZAÇÃO ===== */
// Fases: tela inicial (!begun) → jogando → pausado (G.paused) → contagem (G.counting) → jogando.
// "pause" = pausa pedida pelo jogador; "recover" = partida recuperada (F5) ou aba escondida.
function syncBegin() {
  const wait = G.begun && G.paused;
  ui.game.classList.toggle('is-ready', !G.begun);
  ui.game.classList.toggle('is-paused', wait && !G.counting);
  ui.game.classList.toggle('is-counting', wait && G.counting > 0);
  ui.gameBody.inert = !G.begun || G.paused;
  ui.startBest.hidden = !G.best; ui.startBest.textContent = G.best ? `Recorde: ${G.best} pontos` : '';
}
function begin() {
  if (G.begun) return;
  G.begun = true; Sound.unlock(); syncBegin(); schedulePersist();
}
function setKind(kind) {
  const rec = kind === 'recover';
  ui.pauseScreen.dataset.kind = kind;
  ui.pauseTitle.textContent = rec ? 'Partida retomada' : 'Pausado';
  ui.pauseSub.textContent = rec ? 'Seu progresso foi recuperado. Continue de onde parou.' : 'Partida salva.';
}
function fillPause() { ui.pScore.textContent = String(G.score); ui.pTime.textContent = fmtTime(G.time); ui.pMoves.textContent = String(G.moves); }

// Congela tudo: relógio, arrasto, fim automático e contagem. Salva a partida na hora.
function pauseGame(kind) {
  if (!G.begun || G.over) return false;
  const was = G.paused;
  tipHide(); cancelCountdown(); cancelDrag(); clearTimeout(G.autoTimer);
  G.paused = true;
  if (!was || kind === 'recover') setKind(kind);
  fillPause(); persist(); syncBegin();
  if (!was) say(kind === 'recover' ? 'Partida retomada. Toque para continuar.' : 'Partida pausada.');
  if (!dialogOpen()) ui.pauseContinue.focus({ preventScroll: true });
  return true;
}

let cdTimer = 0, cdSeq = 0;
function cancelCountdown() { clearTimeout(cdTimer); if (G.counting) { G.counting = 0; ui.countNum.textContent = ''; } }
function resumeGame() {
  if (!G.begun || !G.paused || G.counting || G.over) return;
  Sound.unlock();
  const id = ++cdSeq, steps = ['3', '2', '1', 'GO!'];
  let i = 0;
  G.counting = id; syncBegin();
  const finish = () => {
    if (G.counting !== id) return;
    G.counting = 0; G.paused = false; ui.countNum.textContent = '';
    syncBegin(); ui.pauseContinue.blur(); persist();
    if (G.auto) G.autoTimer = setTimeout(() => autoStep(G.token), 200); else maybeAutoFinish();
  };
  const show = () => {
    if (G.counting !== id) return;
    const go = i === steps.length - 1;
    ui.countNum.textContent = steps[i]; ui.countNum.classList.toggle('go', go);
    ui.countNum.classList.remove('tick'); void ui.countNum.offsetWidth; ui.countNum.classList.add('tick');
    if (go) Sound.go(); else Sound.tick();
    cdTimer = setTimeout(go ? finish : () => { i++; show(); }, go ? CONFIG.goMs : CONFIG.countMs);
  };
  show();
}

/* partida salva (solitario_storage.js): gravada com pequeno atraso a cada mudança e na hora ao pausar/sair */
let pTimer = 0;
function packGame() {
  return { order: G.order.slice(), t: G.tableau.map((p) => p.slice()), f: G.found.map((p) => p.slice()), s: G.stock.slice(), w: G.waste.slice(),
    score: G.score, moves: G.moves, time: G.time, started: G.started, up: cards.map((c) => c.up), undo: G.undo.slice(-CONFIG.undoSave) };
}
function persist() { clearTimeout(pTimer); if (G.begun && !G.over) store.saveGame(packGame()); }
function schedulePersist() { clearTimeout(pTimer); pTimer = setTimeout(persist, 300); }
function restore(g) {
  G.token++; clearTimeout(G.autoTimer);
  G.order = g.order.slice(); G.tableau = g.t.map((p) => p.slice()); G.found = g.f.map((p) => p.slice());
  G.stock = g.s.slice(); G.waste = g.w.slice();
  G.score = g.score; G.moves = g.moves; G.time = g.time; G.started = g.started; G.over = false; G.busy = false; G.auto = false; G.sel = null; dests = [];
  G.undo = g.undo.map((u) => ({ t: u.t.map((p) => p.slice()), f: u.f.map((p) => p.slice()), s: u.s.slice(), w: u.w.slice(), score: u.score, moves: u.moves, up: u.up.slice() }));
  cards.forEach((c, i) => { c.up = g.up[i]; c.placed = false; c.el.style.animationDelay = ''; });
  ui.field.classList.remove('celebrate');
  render(true);
  return integrity();
}
window.addEventListener('pagehide', persist);
document.addEventListener('visibilitychange', () => { if (document.hidden && G.begun && !G.over) pauseGame('recover'); });

/* ajuda: abrir congela a partida; fechar NÃO retoma (o jogador continua pela tela de pausa) */
function openHelp() {
  if (G.begun && !G.paused && !G.over) pauseGame('pause');
  openDlg(ui.dlgHelp); ui.helpClose.focus({ preventScroll: true });
}
ui.dlgHelp.addEventListener('close', () => { if (G.begun && G.paused && !G.counting) ui.pauseContinue.focus({ preventScroll: true }); });

ui.start.addEventListener('click', (e) => { if (!e.target.closest('#start-help')) begin(); });
ui.startHelp.addEventListener('click', () => { openHelp(); });
ui.pauseContinue.addEventListener('click', () => { resumeGame(); });
ui.pauseRestart.addEventListener('click', () => { askRestart(); });
ui.pauseHelp.addEventListener('click', () => { openHelp(); });
ui.pauseScreen.addEventListener('click', (e) => { if (!e.target.closest('button') && ui.pauseScreen.dataset.kind === 'recover') resumeGame(); });
document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('.overlay .btn-link, .overlay .btn-ghost'); if (b && e.detail) b.blur(); });

function openDlg(d) { tipHide(); if (d.open) return; if (d.showModal) { try { d.showModal(); return; } catch (e) { /* cai no atributo */ } } d.setAttribute('open', ''); }
function closeDlg(d) { if (!d.open) return; if (d.close) d.close(); else d.removeAttribute('open'); }

ui.newCancel.addEventListener('click', () => closeDlg(ui.dlgNew));
ui.newStart.addEventListener('click', () => { closeDlg(ui.dlgNew); newNow(); });
ui.restartCancel.addEventListener('click', () => closeDlg(ui.dlgRestart));
ui.restartOk.addEventListener('click', () => { closeDlg(ui.dlgRestart); if (restartTarget === 'start') backToStart(); else restartNow(); });
ui.helpClose.addEventListener('click', () => closeDlg(ui.dlgHelp));
ui.winClose.addEventListener('click', () => closeDlg(ui.dlgWin));
ui.winAgain.addEventListener('click', () => { closeDlg(ui.dlgWin); newNow(); });
[ui.dlgNew, ui.dlgRestart, ui.dlgWin, ui.dlgHelp].forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) closeDlg(d); }));

window.addEventListener('resize', () => render());
window.addEventListener('orientationchange', () => render());
if (window.ResizeObserver) new ResizeObserver(() => render()).observe(ui.play);

buildSlots();
buildCards();
syncMute();
startGame(shuffle(freshDeck()));
if (SAVED.game) {                                          // F5 / volta à página: partida recuperada, pausada
  let ok = false;
  try { ok = restore(SAVED.game); } catch (err) { ok = false; }
  if (ok) { G.begun = true; G.paused = true; setKind('recover'); fillPause(); say('Partida retomada. Toque para continuar.'); }
  else { store.clearGame(); startGame(shuffle(freshDeck())); }
}
syncBegin();
if (G.paused) ui.pauseContinue.focus({ preventScroll: true });
window.__solitaire = { begin, askRestart, backToStart, G, cards, CONFIG, SUITS, startGame, draw, undo, performMove, canMove, canTableau, canFoundation, isMovableSource, sourceCards, sequenceOk, integrity, shuffle, freshDeck, computeDests, autoFoundation, tapCard, render, restartNow, pauseGame, resumeGame, persist, packGame, wasteHasPlay, dropTarget: (x, y) => dropTarget(x, y) };
})();