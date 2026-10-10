/* ==========================================================================
puzzle/memory_match/memory_match.js - Jogo da Memória em JavaScript puro.
Índice: 1 Configuração · 2 Símbolos · 3 Áudio · 4 Estado · 5 Lógica · 6 Pausa e contagem
· 7 Persistência · 8 Interface · 9 Entrada · 10 Redimensionamento

Fases (g.phase): ready (tela inicial) · playing · paused · countdown (3-2-1-GO!) · over (vitória).
Só em "playing" o jogo aceita jogadas, o cronômetro corre e as tarefas agendadas (after) avançam.
========================================================================== */
(() => {
'use strict';

/* ===== 1. CONFIGURAÇÃO ===== */
const CONFIG = {
  pairs: 10, gap: 10, maxCard: 128, minCard: 44, margin: 4,
  matchPoints: 100, streakBonus: 25, missPenalty: 10,   // acerto, bônus por sequência, erro
  flipMs: 420,                                          // duração do giro da carta (vai para o CSS como --flip)
  mismatchDelay: 600, finishDelay: 500, volume: 0.3,    // erro: tempo que as duas cartas ficam à mostra antes de fechar
  countMs: 800, goMs: 600,                              // contagem regressiva: duração de cada número e do "GO!"
  saveEveryMs: 1000,                                    // salva a partida a cada 1 s de jogo
};
const COUNTDOWN = ['3', '2', '1', 'GO!'];

/* ===== 2. SÍMBOLOS (SVG próprio, viewBox 48; cor = currentColor via --c) ===== */
const SYMBOLS = [
  { name: 'Sol', hue: '#f0a500', svg: '<circle cx="24" cy="24" r="9" fill="currentColor"/><g stroke="currentColor" stroke-width="3.5" stroke-linecap="round"><path d="M24 4v6M24 38v6M4 24h6M38 24h6M10 10l4 4M34 34l4 4M38 10l-4 4M14 34l-4 4"/></g>' },
  { name: 'Lua', hue: '#4f5fd0', svg: '<path d="M32 6a18 18 0 1 0 10 28A15 15 0 0 1 32 6z" fill="currentColor"/>' },
  { name: 'Estrela', hue: '#e4572e', svg: '<path d="M24 4l6 13 14 2-10 10 3 14-13-7-13 7 3-14L4 19l14-2z" fill="currentColor"/>' },
  { name: 'Folha', hue: '#3a9d5d', svg: '<path d="M8 40C6 18 20 6 42 6c0 22-12 36-30 34z" fill="currentColor"/><path d="M10 38C20 26 28 20 36 14" stroke="#fffaf0" stroke-width="2.5" fill="none" stroke-linecap="round"/>' },
  { name: 'Gota', hue: '#2f9bd8', svg: '<path d="M24 4C16 16 10 23 10 31a14 14 0 0 0 28 0c0-8-6-15-14-27z" fill="currentColor"/><path d="M17 31a7 7 0 0 0 7 7" stroke="#fffaf0" stroke-width="2.5" fill="none" stroke-linecap="round"/>' },
  { name: 'Raio', hue: '#8a4fd6', svg: '<path d="M28 3L10 27h11l-3 18 20-26H27z" fill="currentColor"/>' },
  { name: 'Coração', hue: '#e0457b', svg: '<path d="M24 42C6 30 4 18 10 11c5-5 12-3 14 3 2-6 9-8 14-3 6 7 4 19-14 31z" fill="currentColor"/>' },
  { name: 'Gema', hue: '#17a8a0', svg: '<path d="M24 3l17 21-17 21L7 24z" fill="currentColor"/><path d="M7 24h34M24 3l-6 21 6 21 6-21z" stroke="#fffaf0" stroke-width="2" fill="none" stroke-linejoin="round" opacity=".7"/>' },
  { name: 'Nuvem', hue: '#6f869e', svg: '<g fill="currentColor"><circle cx="15" cy="28" r="9"/><circle cx="26" cy="21" r="11"/><circle cx="35" cy="29" r="8"/><rect x="10" y="28" width="30" height="9" rx="4.5"/></g>' },
  { name: 'Chave', hue: '#a8642a', svg: '<circle cx="15" cy="15" r="9" fill="none" stroke="currentColor" stroke-width="5"/><path d="M21 21l20 20M31 31l5-5M37 37l5-5" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>' },
];

// Persistência: tudo passa por memory_match_storage.js (MemoryMatchStorage), isolado do restante do projeto.
const Store = MemoryMatchStorage;

/* ===== 3. ÁUDIO ===== */
const Sound = (() => {
  let ctx = null, master = null, off = false, muted = Store.isMuted();
  function ensure() {
    if (off) return null;
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) { off = true; return null; }
      try { ctx = new C(); master = ctx.createGain(); master.gain.value = CONFIG.volume; master.connect(ctx.destination); } catch (e) { off = true; ctx = null; return null; }
    }
    if (ctx.state === 'suspended') { try { ctx.resume().catch(() => {}); } catch (e) {} }
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
  const play = (fn) => { if (muted) return; try { fn(); } catch (e) {} };
  return {
    get muted() { return muted; },
    unlock() { play(ensure); },
    setMuted(v) { muted = Boolean(v); Store.setMuted(muted); play(ensure); },
    flip() { play(() => tone('triangle', 420, 560, 0.06, 0.25)); },
    match() { play(() => { tone('triangle', 600, 600, 0.1, 0.3); tone('triangle', 900, 900, 0.16, 0.3, 0.09); }); },
    miss() { play(() => tone('sawtooth', 220, 130, 0.22, 0.2)); },
    win() { play(() => [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.16, 0.32, i * 0.11))); },
    count() { play(() => tone('triangle', 520, 520, 0.09, 0.25)); },
    go() { play(() => tone('triangle', 780, 1040, 0.2, 0.3)); },
  };
})();

/* ===== 4. ESTADO ===== */
const g = {
  cards: [], first: null, busy: false, phase: 'ready', pauseReason: null,
  matched: 0, attempts: 0, score: 0, streak: 0, elapsed: 0,
  best: Store.getBest(), record: false, round: 0,
};
const $ = (id) => document.getElementById(id);
const ui = {
  play: $('play'), arena: $('arena'), panel: $('game-panel'), body: $('game-body'), hud: $('hud'), boardWrap: document.querySelector('.board-wrap'),
  board: $('board'), toast: $('toast'), score: $('score'), best: $('best'), bestCard: $('best-card'),
  time: $('time'), attempts: $('attempts'), pairs: $('pairs'), bar: $('bar'),
  mute: $('mute-button'), helpButton: $('help-button'), controls: $('controls'),
  screens: { start: $('screen-start'), pause: $('screen-pause'), count: $('screen-count'), win: $('screen-win'), help: $('screen-help') },
  startBest: $('start-best'), resumedChip: $('resumed-chip'), pauseNote: $('pause-note'),
  pauseScore: $('pause-score'), pauseAttempts: $('pause-attempts'), pauseTime: $('pause-time'),
  countNum: $('count-num'), tip: $('tip'), tipText: $('tip-text'), tipKey: $('tip-key'),
  winScore: $('win-score'), winAttempts: $('win-attempts'), winTime: $('win-time'), badge: $('record-badge'),
};
const LANDSCAPE = window.matchMedia('(max-height: 500px) and (orientation: landscape)');
const fmtTime = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/* ===== 5. LÓGICA ===== */
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Tarefas agendadas contam o tempo de JOGO (g.elapsed), não o relógio real: com o jogo pausado ou em
// contagem regressiva nada dispara, e o fechamento de um par errado só acontece depois que o jogo volta.
const tasks = [];
const after = (ms, fn) => { tasks.push({ at: g.elapsed + ms, fn }); };

// startNow = false: a partida fica parada na tela inicial até o jogador tocar/clicar ou apertar Space.
function newGame(startNow = false) {
  g.round++;
  tasks.length = 0;
  cancelCountdown();
  helpOpen = false; ui.helpButton.setAttribute('aria-expanded', 'false');
  Object.assign(g, { first: null, busy: false, matched: 0, attempts: 0, score: 0, streak: 0, elapsed: 0, record: false, pauseReason: null });
  const ids = shuffle(Array.from({ length: CONFIG.pairs }, (_, i) => i).flatMap((i) => [i, i]));
  g.cards = ids.map((id, index) => ({ id, index, flipped: false, matched: false }));
  buildBoard(false);
  g.phase = startNow ? 'playing' : 'ready';
  lastScore = 0; lastSec = -1;
  renderHud(false); renderPause(); syncScreens(); save();
}

function startGame() {
  if (g.phase !== 'ready') return;
  Sound.unlock();
  g.phase = 'playing';
  syncScreens(); save();
}

function restart() { Sound.unlock(); newGame(true); resize(); }

const cardLabel = (c) => c.matched ? `Carta ${c.index + 1}, ${SYMBOLS[c.id].name}, par encontrado`
  : c.flipped ? `Carta ${c.index + 1}, ${SYMBOLS[c.id].name}` : `Carta ${c.index + 1}, virada para baixo`;

function buildBoard(settled) {
  ui.board.innerHTML = g.cards.map((c) => `<button class="card${settled ? ' settled' : ''}" type="button" data-i="${c.index}" style="--c:${SYMBOLS[c.id].hue}">` +
    `<span class="face face-back"></span><span class="face front"><svg viewBox="0 0 48 48" aria-hidden="true">${SYMBOLS[c.id].svg}</svg></span></button>`).join('');
  g.cards.forEach(paintCard);
  lock(false);
}

function paintCard(c) {
  const el = ui.board.children[c.index];
  el.classList.toggle('is-flipped', c.flipped);
  el.classList.toggle('matched', c.matched);
  el.disabled = c.matched;
  el.setAttribute('aria-label', cardLabel(c));
}
function setFlipped(c, on) { c.flipped = on; paintCard(c); }
function lock(on) { g.busy = on; ui.board.classList.toggle('is-locked', on); }   // trava a interação (e o hover) durante a comparação

function pick(i) {
  const c = g.cards[i];
  // sem jogada fora de "playing" (pausa, contagem, início, fim), sem 3ª carta, sem repetir carta, sem carta de par já feito
  if (!c || g.phase !== 'playing' || g.busy || c.flipped || c.matched) return;
  Sound.flip();
  setFlipped(c, true);
  if (!g.first) { g.first = c; save(); return; }
  const a = g.first, b = c;
  g.first = null;
  lock(true);
  g.attempts++;
  if (a.id === b.id) {
    g.streak++;
    g.score += CONFIG.matchPoints + CONFIG.streakBonus * (g.streak - 1);
    g.matched++;
    a.matched = b.matched = true; paintCard(a); paintCard(b);
    Sound.match();
    if (g.streak > 1) showToast(`Sequência x${g.streak}!`);
    renderHud(true);
    if (g.matched === CONFIG.pairs) after(CONFIG.flipMs + CONFIG.finishDelay, () => finish(false));   // segue travado até a vitória
    else lock(false);
  } else {
    g.streak = 0;
    g.score = Math.max(0, g.score - CONFIG.missPenalty);
    Sound.miss();
    for (const m of [a, b]) { const el = ui.board.children[m.index]; el.classList.remove('wrong'); void el.offsetWidth; el.classList.add('wrong'); }
    after(CONFIG.flipMs + CONFIG.mismatchDelay, () => {   // giro de abertura + tempo à mostra (só corre com o jogo em andamento)
      for (const m of [a, b]) { setFlipped(m, false); ui.board.children[m.index].classList.remove('wrong'); }
      save();
      after(CONFIG.flipMs, () => lock(false));   // segue travado até as cartas terminarem de fechar
    });
    renderHud(false);
  }
  save();
}

function finish(silent) {
  tasks.length = 0;
  g.phase = 'over'; g.first = null; lock(false);
  g.record = g.score > g.best;
  if (g.record) { g.best = g.score; Store.setBest(g.best); }
  fillWin();
  renderHud(false);
  syncScreens();
  if (g.record) pop(ui.bestCard, 'glow');
  if (!silent) Sound.win();
  save();
}

function fillWin() {
  ui.winScore.textContent = String(g.score);
  ui.winAttempts.textContent = String(g.attempts);
  ui.winTime.textContent = fmtTime(g.elapsed);
  ui.badge.hidden = !g.record;
}

/* ===== 6. PAUSA E CONTAGEM REGRESSIVA ===== */
let countTimer = 0, helpOpen = false;
const PAUSE_NOTE = { manual: 'Partida em pausa.', help: 'Partida em pausa.', hidden: 'Pausada ao sair da aba.', returned: 'Pausada ao sair da aba.', restored: 'Seu progresso foi recuperado.' };

// reason: manual | help | hidden (saiu da aba) | returned (voltou à aba) | restored (recarregou a página)
function pauseGame(reason) {
  if (g.phase === 'countdown') cancelCountdown();
  else if (g.phase !== 'playing') return;
  g.phase = 'paused'; g.pauseReason = reason;
  ui.toast.classList.remove('show');
  renderPause(); syncScreens(); save();
}

function renderPause() {
  ui.pauseNote.textContent = PAUSE_NOTE[g.pauseReason] || PAUSE_NOTE.manual;
  ui.resumedChip.hidden = !(g.pauseReason === 'restored' || g.pauseReason === 'returned');
  ui.pauseScore.textContent = String(g.score);
  ui.pauseAttempts.textContent = String(g.attempts);
  ui.pauseTime.textContent = fmtTime(g.elapsed);
}

// Continuar: nunca volta direto ao jogo. 3 → 2 → 1 → GO!, e só então "playing". Pausar/reiniciar cancela.
function startCountdown() {
  if (g.phase !== 'paused' || helpOpen) return;
  Sound.unlock();
  g.phase = 'countdown'; g.pauseReason = null;
  syncScreens();
  let i = 0;
  const step = () => {
    if (g.phase !== 'countdown') return;
    const last = i === COUNTDOWN.length - 1;
    ui.countNum.textContent = COUNTDOWN[i];
    ui.countNum.classList.toggle('is-go', last);
    pop(ui.countNum, 'tick');
    if (last) Sound.go(); else Sound.count();
    countTimer = setTimeout(() => {
      countTimer = 0;
      if (g.phase !== 'countdown') return;
      if (last) { g.phase = 'playing'; syncScreens(); save(); }
      else { i++; step(); }
    }, last ? CONFIG.goMs : CONFIG.countMs);
  };
  step();
}
function cancelCountdown() { clearTimeout(countTimer); countTimer = 0; }

// Ajuda: pausa a partida (se estiver rodando) e NÃO retoma ao fechar; o jogador volta pela tela de pausa.
function openHelp() {
  if (helpOpen) return;
  if (g.phase === 'playing' || g.phase === 'countdown') pauseGame('help');
  helpOpen = true;
  ui.helpButton.setAttribute('aria-expanded', 'true');
  syncScreens();
}
function closeHelp() {
  if (!helpOpen) return;
  helpOpen = false;
  ui.helpButton.setAttribute('aria-expanded', 'false');
  syncScreens();
}

// Relógio do jogo: o cronômetro e as tarefas só avançam em "playing".
let lastFrame = 0, lastSec = -1, saveAcc = 0;
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(Math.max(now - lastFrame, 0), 250);
  lastFrame = now;
  if (g.phase !== 'playing') return;
  g.elapsed += dt;
  for (let i = 0; i < tasks.length;) {
    if (tasks[i].at <= g.elapsed) tasks.splice(i, 1)[0].fn(); else i++;
  }
  const sec = Math.floor(g.elapsed / 1000);
  if (sec !== lastSec) { lastSec = sec; ui.time.textContent = fmtTime(g.elapsed); }
  saveAcc += dt;
  if (saveAcc >= CONFIG.saveEveryMs) { saveAcc = 0; save(); }
}

/* ===== 7. PERSISTÊNCIA (partida) ===== */
function save() {
  Store.saveGame({
    phase: g.phase === 'countdown' ? 'paused' : g.phase,
    cards: g.cards.map((c) => ({ id: c.id, flipped: c.flipped, matched: c.matched })),   // ordem atual das cartas
    attempts: g.attempts, score: g.score, streak: g.streak, elapsed: Math.floor(g.elapsed), record: g.record,
  });
}

// Valida o que veio do disco: qualquer incoerência descarta a partida salva (o recorde não é afetado).
function normalizeSaved(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.cards) || s.cards.length !== CONFIG.pairs * 2) return null;
  const seen = new Array(CONFIG.pairs).fill(0), done = new Array(CONFIG.pairs).fill(0), cards = [];
  for (const c of s.cards) {
    if (!c || !Number.isInteger(c.id) || c.id < 0 || c.id >= CONFIG.pairs) return null;
    seen[c.id]++;
    if (c.matched === true) done[c.id]++;
    cards.push({ id: c.id, flipped: c.flipped === true, matched: c.matched === true });
  }
  if (seen.some((n) => n !== 2) || done.some((n) => n !== 0 && n !== 2)) return null;
  if (!['ready', 'playing', 'paused', 'over'].includes(s.phase)) return null;
  const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
  const attempts = num(s.attempts), score = num(s.score), streak = num(s.streak), elapsed = num(s.elapsed);
  if ([attempts, score, streak, elapsed].includes(null)) return null;
  const matched = done.filter((n) => n === 2).length;
  if (s.phase === 'over' && matched !== CONFIG.pairs) return null;
  if (s.phase === 'ready' && (matched || attempts || elapsed || cards.some((c) => c.flipped))) return null;
  return { phase: s.phase, cards, attempts, score, streak, elapsed, matched, record: s.record === true };
}

// Recupera a partida SEM embaralhar. Partida em andamento volta sempre pausada, esperando o jogador.
function restoreGame() {
  const s = normalizeSaved(Store.loadGame());
  if (!s) { Store.clearGame(); return false; }
  g.round++;
  g.cards = s.cards.map((c, index) => ({ id: c.id, index, flipped: c.flipped || c.matched, matched: c.matched }));
  const open = g.cards.filter((c) => c.flipped && !c.matched);
  g.first = open.length === 1 ? open[0] : null;           // 1 carta aberta: a jogada continua dela
  if (open.length !== 1) open.forEach((c) => { c.flipped = false; });   // 2 abertas = erro que ia fechar; fecha agora
  Object.assign(g, { busy: false, matched: s.matched, attempts: s.attempts, score: s.score, streak: s.streak, elapsed: s.elapsed, record: s.record, pauseReason: null });
  buildBoard(true);
  lastScore = g.score; lastSec = -1;
  if (s.phase === 'ready') g.phase = 'ready';
  else if (s.phase === 'over') { g.phase = 'over'; fillWin(); }
  else { g.phase = 'paused'; g.pauseReason = 'restored'; }
  renderHud(false); renderPause(); syncScreens();
  if (s.phase !== 'over' && s.matched === CONFIG.pairs) finish(true);   // recarregou durante o intervalo até a vitória
  return true;
}

/* ===== 8. INTERFACE ===== */
function pop(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
let lastScore = 0;
function renderHud(animate) {
  ui.score.textContent = String(g.score);
  if (animate && g.score > lastScore) pop(ui.score, 'bump');
  lastScore = g.score;
  ui.best.textContent = String(g.best);
  document.querySelectorAll('[data-best]').forEach((el) => { el.textContent = String(g.best); });
  ui.startBest.hidden = g.best <= 0;
  ui.attempts.textContent = String(g.attempts);
  ui.time.textContent = fmtTime(g.elapsed);
  ui.pairs.textContent = `${g.matched}/${CONFIG.pairs}`;
  ui.bar.style.setProperty('--p', `${(g.matched / CONFIG.pairs) * 100}%`);
}
function showToast(t) { ui.toast.textContent = t; pop(ui.toast, 'show'); }
function syncMute() {
  ui.mute.classList.toggle('is-muted', Sound.muted);
  ui.mute.setAttribute('aria-pressed', Sound.muted ? 'true' : 'false');
  ui.mute.setAttribute('aria-label', Sound.muted ? 'Ativar efeitos sonoros' : 'Silenciar efeitos sonoros');
  ui.mute.dataset.tip = Sound.muted ? 'Ligar o som' : 'Desligar o som';
  hideTip();
}

// Uma única camada de tela visível por vez; a ajuda fica por cima da tela da fase atual.
// O conteúdo do jogo (#game-body) fica inerte (sem clique, sem foco) sempre que há uma tela aberta.
let screenKey = null;
function syncScreens() {
  const under = { ready: 'start', paused: 'pause', countdown: 'count', over: 'win' }[g.phase] || '';
  const top = helpOpen ? 'help' : under;
  for (const [name, el] of Object.entries(ui.screens)) {
    el.classList.toggle('is-open', name === under || (name === 'help' && helpOpen));
    el.inert = name !== top;
  }
  ui.body.inert = g.phase !== 'playing' || helpOpen;
  hideTip();
  if (top !== screenKey) {
    const first = screenKey === null;
    screenKey = top;
    if (!first) focusPrimary(top);
  }
}
function focusPrimary(name) {
  const el = ui.screens[name] && ui.screens[name].querySelector('[data-primary]');
  if (el) el.focus({ preventScroll: true });
  else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}

/* ===== TOOLTIP DOS CONTROLES (único sistema; sem `title` nativo) =====
   Mouse: espera --tip-delay (0,3 s) e esconde ao sair/clicar. Teclado: focus-visible mostra na hora.
   Toque: segurar o botão (~0,45 s) mostra a dica sem acionar o botão. Posição: abaixo do botão se couber, senão acima. */
const TIP = { gap: 10, edge: 8, longPressMs: 450, touchHideMs: 1600 };
let tipBtn = null, tipTimer = 0, tipHideTimer = 0, longPressed = false;
const tipDelay = () => {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--tip-delay').trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? (/ms$/.test(v) ? n : n * 1000) : 300;
};
function showTip(btn) {
  clearTimeout(tipTimer); clearTimeout(tipHideTimer);
  if (!btn.dataset.tip || btn.closest('[inert]')) return;
  if (tipBtn && tipBtn !== btn) tipBtn.removeAttribute('aria-describedby');
  tipBtn = btn;
  ui.tipText.textContent = btn.dataset.tip;
  ui.tipKey.textContent = btn.dataset.key || '';
  ui.tipKey.hidden = !btn.dataset.key;
  btn.setAttribute('aria-describedby', 'tip');
  const tip = ui.tip, r = btn.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  tip.style.left = '0px'; tip.style.top = '0px';
  const w = tip.offsetWidth, h = tip.offsetHeight;
  const left = Math.round(Math.max(TIP.edge, Math.min(r.left + r.width / 2 - w / 2, vw - TIP.edge - w)));
  const below = vh - r.bottom - TIP.gap - TIP.edge >= h;       // abaixo não cobre as cartas; se não couber na tela, vai para cima
  tip.dataset.placement = below ? 'below' : 'above';
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.round(below ? r.bottom + TIP.gap : r.top - TIP.gap - h)}px`;
  tip.style.setProperty('--arrow-x', `${Math.round(Math.min(Math.max(r.left + r.width / 2 - left, 14), w - 14))}px`);
  tip.classList.add('is-on');
}
function hideTip() {
  clearTimeout(tipTimer); clearTimeout(tipHideTimer);
  ui.tip.classList.remove('is-on');
  if (tipBtn) { tipBtn.removeAttribute('aria-describedby'); tipBtn = null; }
}
document.querySelectorAll('.tool[data-tip]').forEach((btn) => {
  btn.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'touch') return;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => showTip(btn), tipDelay());      // mouse: atraso de --tip-delay
  });
  btn.addEventListener('pointerleave', hideTip);                 // saiu: some na hora
  btn.addEventListener('pointerdown', (e) => {
    hideTip();                                                   // clique/toque: some na hora
    if (e.pointerType !== 'touch') return;
    longPressed = false;
    tipTimer = setTimeout(() => { longPressed = true; showTip(btn); }, TIP.longPressMs);
  });
  const endPress = () => {
    clearTimeout(tipTimer);
    if (longPressed) tipHideTimer = setTimeout(hideTip, TIP.touchHideMs);
  };
  btn.addEventListener('pointerup', endPress);
  btn.addEventListener('pointercancel', endPress);
  btn.addEventListener('focus', () => { if (btn.matches(':focus-visible')) showTip(btn); });   // teclado: na hora
  btn.addEventListener('blur', hideTip);
  btn.addEventListener('click', hideTip);
});
// Segurar no toque só mostra a dica: o clique que vem depois do long-press não aciona o botão.
ui.controls.addEventListener('click', (e) => {
  if (!longPressed) return;
  longPressed = false; e.preventDefault(); e.stopPropagation();
}, true);
window.addEventListener('resize', hideTip);

/* ===== 9. ENTRADA ===== */
const ACTIONS = {
  start: startGame, resume: startCountdown, restart, help: openHelp, 'help-close': closeHelp,
  pause: () => pauseGame('manual'),
  mute: () => { Sound.setMuted(!Sound.muted); syncMute(); },
};
ui.board.addEventListener('click', (e) => {
  const el = e.target.closest('.card');
  if (el) { Sound.unlock(); pick(Number(el.dataset.i)); }
});
ui.panel.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (t) {
    const fn = ACTIONS[t.dataset.action];
    if (fn) fn();
    if (e.detail > 0 && document.activeElement === t) t.blur();   // clique/toque: Space não deve acionar o botão depois
  } else if (e.target.closest('#screen-start') && !helpOpen) startGame();   // toque em qualquer ponto da tela inicial
});
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Escape') {
    hideTip();
    if (helpOpen) { e.preventDefault(); closeHelp(); }
    else if (g.phase === 'playing' || g.phase === 'countdown') pauseGame('manual');
    return;
  }
  if (e.repeat) return;
  if (e.code === 'KeyM') { ACTIONS.mute(); return; }
  if (helpOpen) return;                       // com a ajuda aberta, só Esc e M
  if (e.code === 'KeyR') restart();
  else if (e.code === 'KeyP') { if (g.phase === 'paused') startCountdown(); else pauseGame('manual'); }
  else if (e.code === 'Space') {
    if (e.target.closest && e.target.closest('button')) return;   // deixa o botão focado agir
    e.preventDefault();
    if (g.phase === 'ready') startGame(); else if (g.phase === 'paused') startCountdown();
  }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

// Saiu da aba / minimizou: pausa e salva. Voltou: continua pausada, com o aviso "Partida retomada" e espera o jogador.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pauseGame('hidden'); save(); }
  else if (g.phase === 'paused') {
    g.pauseReason = helpOpen ? g.pauseReason : 'returned';
    renderPause();
    if (!helpOpen) focusPrimary('pause');
  }
});
window.addEventListener('pagehide', save);
window.addEventListener('beforeunload', save);

/* ===== 10. REDIMENSIONAMENTO: escolhe 4 ou 5 colunas (a que der cartas maiores) descontando o espaço
   que HUD e controles ocupam no container. Celular deitado: HUD e controles à esquerda, cartas à direita. ===== */
function resize() {
  const gap = CONFIG.gap, total = CONFIG.pairs * 2;
  const aw = ui.play.clientWidth - CONFIG.margin * 2, ah = ui.play.clientHeight - CONFIG.margin * 2;
  const pad = parseFloat(getComputedStyle(ui.panel).paddingLeft) || 0;
  let ow, oh;
  if (LANDSCAPE.matches) {
    ow = pad * 2 + ui.hud.offsetWidth + (parseFloat(getComputedStyle(ui.body).columnGap) || 0);
    oh = pad * 2;
  } else {
    ow = pad * 2;
    oh = ui.panel.offsetHeight - ui.boardWrap.offsetHeight;   // padding + HUD + controles + espaçamentos
  }
  let best = { cw: 0, cols: 4 };
  for (const cols of [4, 5]) {
    const rows = Math.ceil(total / cols);
    const cw = Math.min((aw - ow - gap * (cols - 1)) / cols, ((ah - oh - gap * (rows - 1)) / rows) * 0.75, CONFIG.maxCard);
    if (cw > best.cw + 0.01) best = { cw, cols };
  }
  ui.arena.style.setProperty('--cw', `${Math.max(CONFIG.minCard, Math.floor(best.cw))}px`);
  ui.arena.style.setProperty('--cols', String(best.cols));
  ui.arena.style.setProperty('--gap', `${gap}px`);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(ui.play);

ui.arena.style.setProperty('--flip', `${CONFIG.flipMs}ms`);
document.querySelectorAll('[data-pairs]').forEach((el) => { el.textContent = String(CONFIG.pairs); });
if (!restoreGame()) newGame(false);
syncMute();
resize();
resize();   // 2ª passada: a 1ª já aplicou --cols/--cw e o HUD pode ter mudado de altura
lastFrame = performance.now();
requestAnimationFrame(tick);
window.__memory = { g, CONFIG };
})();