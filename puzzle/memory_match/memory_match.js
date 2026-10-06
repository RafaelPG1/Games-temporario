/* ==========================================================================
puzzle/memory_match/memory_match.js - Jogo da Memória em JavaScript puro.
Índice: 1 Configuração · 2 Símbolos · 3 Áudio · 4 Estado · 5 Lógica
· 6 Interface · 7 Entrada · 8 Redimensionamento
========================================================================== */
(() => {
'use strict';

/* ===== 1. CONFIGURAÇÃO ===== */
const CONFIG = {
  pairs: 10, gap: 10, maxCard: 120, margin: 8,
  matchPoints: 100, streakBonus: 25, missPenalty: 10,   // acerto, bônus por sequência, erro
  flipMs: 420,                                          // duração do giro da carta (vai para o CSS como --flip)
  mismatchDelay: 600, volume: 0.3,                      // erro: tempo que as duas cartas ficam à mostra (depois do giro) antes de fechar
};

/* ===== 2. SÍMBOLOS (SVG próprio, viewBox 48; cor = currentColor via --c) ===== */
const SYMBOLS = [
  { hue: '#f2a900', svg: '<circle cx="24" cy="24" r="9" fill="currentColor"/><g stroke="currentColor" stroke-width="3.5" stroke-linecap="round"><path d="M24 4v6M24 38v6M4 24h6M38 24h6M10 10l4 4M34 34l4 4M38 10l-4 4M14 34l-4 4"/></g>' },
  { hue: '#5b6bd6', svg: '<path d="M32 6a18 18 0 1 0 10 28A15 15 0 0 1 32 6z" fill="currentColor"/>' },
  { hue: '#e8a400', svg: '<path d="M24 4l6 13 14 2-10 10 3 14-13-7-13 7 3-14L4 19l14-2z" fill="currentColor"/>' },
  { hue: '#3a9d5d', svg: '<path d="M8 40C6 18 20 6 42 6c0 22-12 36-30 34z" fill="currentColor"/><path d="M10 38C20 26 28 20 36 14" stroke="#fffaf0" stroke-width="2.5" fill="none" stroke-linecap="round"/>' },
  { hue: '#2f9bd8', svg: '<path d="M24 4C16 16 10 23 10 31a14 14 0 0 0 28 0c0-8-6-15-14-27z" fill="currentColor"/><path d="M17 31a7 7 0 0 0 7 7" stroke="#fffaf0" stroke-width="2.5" fill="none" stroke-linecap="round"/>' },
  { hue: '#e4572e', svg: '<path d="M28 3L10 27h11l-3 18 20-26H27z" fill="currentColor"/>' },
  { hue: '#e0457b', svg: '<path d="M24 42C6 30 4 18 10 11c5-5 12-3 14 3 2-6 9-8 14-3 6 7 4 19-14 31z" fill="currentColor"/>' },
  { hue: '#17a8a0', svg: '<path d="M24 3l17 21-17 21L7 24z" fill="currentColor"/><path d="M7 24h34M24 3l-6 21 6 21 6-21z" stroke="#fffaf0" stroke-width="2" fill="none" stroke-linejoin="round" opacity=".7"/>' },
  { hue: '#7a8fa6', svg: '<g fill="currentColor"><circle cx="15" cy="28" r="9"/><circle cx="26" cy="21" r="11"/><circle cx="35" cy="29" r="8"/><rect x="10" y="28" width="30" height="9" rx="4.5"/></g>' },
  { hue: '#9a5bd6', svg: '<circle cx="15" cy="15" r="9" fill="none" stroke="currentColor" stroke-width="5"/><path d="M21 21l20 20M31 31l5-5M37 37l5-5" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>' },
];

// Persistência: tudo passa por memory_match_storage.js (MemoryMatchStorage), isolado do restante do projeto.

/* ===== 3. ÁUDIO ===== */
const Sound = (() => {
  let ctx = null, master = null, off = false, muted = MemoryMatchStorage.isMuted();
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
    setMuted(v) { muted = Boolean(v); MemoryMatchStorage.setMuted(muted); play(ensure); },
    flip() { play(() => tone('triangle', 420, 560, 0.06, 0.25)); },
    match() { play(() => { tone('triangle', 600, 600, 0.1, 0.3); tone('triangle', 900, 900, 0.16, 0.3, 0.09); }); },
    miss() { play(() => tone('sawtooth', 220, 130, 0.22, 0.2)); },
    win() { play(() => [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.16, 0.32, i * 0.11))); },
  };
})();

/* ===== 4. ESTADO ===== */
const g = { cards: [], first: null, second: null, busy: false, started: false, matched: 0, attempts: 0, score: 0, streak: 0, best: MemoryMatchStorage.getBest(), over: false, round: 0 };
const $ = (id) => document.getElementById(id);
const ui = {
  play: $('play'), arena: $('arena'), stage: $('stage'), panel: $('game-panel'), hud: $('hud'), start: $('start-screen'), board: $('board'), score: $('score'), best: $('best'), bestCard: $('best-card'),
  attempts: $('attempts'), pairs: $('pairs'), bar: $('bar'), mute: $('mute-button'), reset: $('reset-button'),
  win: $('win'), winScore: $('win-score'), winAttempts: $('win-attempts'), badge: $('record-badge'), again: $('again-button'), toast: $('toast'),
  helpButton: $('help-button'), helpPopover: $('help-popover'), helpClose: $('help-close'),
};

/* ===== 5. LÓGICA ===== */
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// startNow = false: a partida fica parada na tela "Toque para iniciar" até o jogador tocar/clicar ou apertar Space.
function newGame(startNow = false) {
  g.round++;
  Object.assign(g, { first: null, second: null, busy: false, started: startNow, matched: 0, attempts: 0, score: 0, streak: 0, over: false });
  const ids = shuffle(Array.from({ length: CONFIG.pairs }, (_, i) => i).flatMap((i) => [i, i]));
  g.cards = ids.map((id, index) => ({ id, index, flipped: false, matched: false }));
  ui.board.innerHTML = g.cards.map((c) => `<button class="card" type="button" data-i="${c.index}" style="--c:${SYMBOLS[c.id].hue}" aria-label="Carta ${c.index + 1}, virada para baixo">` +
    `<span class="face face-back"></span><span class="face front"><svg viewBox="0 0 48 48" aria-hidden="true">${SYMBOLS[c.id].svg}</svg></span></button>`).join('');
  ui.win.classList.remove('is-open');
  ui.board.classList.remove('is-locked');
  syncStart();
  renderHud(false);
}

function syncStart() {
  ui.panel.classList.toggle('is-ready', !g.started);
  ui.board.inert = !g.started;     // parado: as cartas não recebem clique nem foco
}

function startGame() {
  if (g.started) return;
  Sound.unlock();
  g.started = true;
  syncStart();
}

function setFlipped(c, on) {
  c.flipped = on;
  const el = ui.board.children[c.index];
  el.classList.toggle('is-flipped', on);
  el.setAttribute('aria-label', on ? `Carta ${c.index + 1}, símbolo ${c.id + 1}` : `Carta ${c.index + 1}, virada para baixo`);
}

function lock(on) { g.busy = on; ui.board.classList.toggle('is-locked', on); }   // trava a interação (e o hover) durante a comparação

function pick(i) {
  const c = g.cards[i];
  if (!c || !g.started || g.busy || g.over || c.flipped || c.matched) return;   // sem repetir carta, sem 3ª carta, sem agir durante a comparação
  Sound.flip();
  setFlipped(c, true);
  if (!g.first) { g.first = c; return; }
  g.second = c;
  lock(true);
  g.attempts++;
  const [a, b] = [g.first, g.second], round = g.round;
  if (a.id === b.id) {
    g.streak++;
    g.score += CONFIG.matchPoints + CONFIG.streakBonus * (g.streak - 1);
    g.matched++;
    for (const m of [a, b]) { m.matched = true; ui.board.children[m.index].classList.add('matched'); ui.board.children[m.index].disabled = true; }
    Sound.match();
    if (g.streak > 1) showToast(`Sequência x${g.streak}!`);
    g.first = g.second = null; lock(false);
    renderHud(true);
    if (g.matched === CONFIG.pairs) setTimeout(() => round === g.round && finish(), CONFIG.flipMs + 500);   // espera o giro da última carta
  } else {
    g.streak = 0;
    g.score = Math.max(0, g.score - CONFIG.missPenalty);
    Sound.miss();
    for (const m of [a, b]) { const el = ui.board.children[m.index]; el.classList.remove('wrong'); void el.offsetWidth; el.classList.add('wrong'); }
    setTimeout(() => {
      if (round !== g.round) return;
      for (const m of [a, b]) { setFlipped(m, false); ui.board.children[m.index].classList.remove('wrong'); }
      g.first = g.second = null; lock(false);
    }, CONFIG.flipMs + CONFIG.mismatchDelay);   // giro de abertura + tempo à mostra
    renderHud(false);
  }
}

function finish() {
  g.over = true;
  const record = g.score > g.best;
  if (record) { g.best = g.score; MemoryMatchStorage.setBest(g.best); }
  ui.winScore.textContent = String(g.score);
  ui.winAttempts.textContent = String(g.attempts);
  ui.badge.hidden = !record;
  ui.win.classList.add('is-open');
  renderHud(false);
  if (record) pop(ui.bestCard, 'glow');
  Sound.win();
  ui.again.focus({ preventScroll: true });
}

/* ===== 6. INTERFACE ===== */
function pop(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
let lastScore = 0;
function renderHud(animate) {
  ui.score.textContent = String(g.score);
  if (animate && g.score > lastScore) pop(ui.score, 'bump');
  lastScore = g.score;
  ui.best.textContent = String(g.best);
  ui.attempts.textContent = String(g.attempts);
  ui.pairs.textContent = `${g.matched}/${CONFIG.pairs}`;
  ui.bar.style.setProperty('--p', `${(g.matched / CONFIG.pairs) * 100}%`);
}
function showToast(t) { ui.toast.textContent = t; pop(ui.toast, 'show'); }
function syncMute() {
  ui.mute.classList.toggle('is-muted', Sound.muted);
  ui.mute.setAttribute('aria-pressed', Sound.muted ? 'true' : 'false');
  ui.mute.setAttribute('aria-label', Sound.muted ? 'Ativar efeitos sonoros' : 'Silenciar efeitos sonoros');
}
function restart() { Sound.unlock(); lastScore = 0; newGame(true); resize(); }

// Ajuda "Como jogar": popover ancorado ABAIXO do botão "?", fora do container do jogo.
// Não há cronômetro, então abrir a ajuda não precisa pausar nada.
let helpOpen = false;
const HELP = { gap: 12, edge: 8, maxWidth: 260, button: 40, side: 16 };

function openHelp() {
  if (helpOpen) return;
  helpOpen = true;
  ui.helpPopover.hidden = false;
  ui.helpButton.setAttribute('aria-expanded', 'true');
  placeHelp();
}

function closeHelp() {
  if (!helpOpen) return;
  helpOpen = false;
  ui.helpPopover.hidden = true;
  ui.helpButton.setAttribute('aria-expanded', 'false');
}

// Abre sempre ABAIXO do botão (com rolagem interna se faltar altura). Só inverte para cima quando o
// botão está sob o container (celular), onde pode não sobrar espaço embaixo.
function placeHelp() {
  if (!helpOpen) return;
  const pop = ui.helpPopover;
  for (const v of ['max-height', 'overflow-y']) pop.style.removeProperty(v);
  const arena = ui.arena.getBoundingClientRect();
  const btn = ui.helpButton.getBoundingClientRect();
  const width = Math.floor(Math.min(HELP.maxWidth, arena.width - HELP.edge * 2));
  const left = Math.max(arena.left + HELP.edge, Math.min(btn.left, arena.right - HELP.edge - width));
  pop.style.width = `${width}px`;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.setProperty('--arrow-x', `${Math.round(Math.min(Math.max(btn.left + btn.width / 2 - left, 16), width - 16))}px`);
  const height = pop.offsetHeight;
  const roomBelow = window.innerHeight - btn.bottom - HELP.gap - HELP.edge;
  const roomAbove = btn.top - HELP.gap - HELP.edge;
  let placement = 'below';
  if (ui.stage.dataset.helpPos !== 'side' && height > roomBelow && roomAbove > roomBelow) placement = 'above';
  const room = placement === 'below' ? roomBelow : roomAbove;
  if (height > room) { pop.style.maxHeight = `${Math.max(96, Math.floor(room))}px`; pop.style.overflowY = 'auto'; }
  const finalHeight = pop.offsetHeight;
  pop.style.top = `${Math.round(placement === 'below' ? btn.bottom + HELP.gap : btn.top - HELP.gap - finalHeight)}px`;
  pop.dataset.placement = placement;
}

/* ===== 7. ENTRADA ===== */
ui.board.addEventListener('click', (e) => {
  const el = e.target.closest('.card');
  if (el) { Sound.unlock(); pick(Number(el.dataset.i)); }
});
ui.start.addEventListener('click', startGame);
ui.mute.addEventListener('click', () => { Sound.setMuted(!Sound.muted); syncMute(); ui.mute.blur(); });
ui.reset.addEventListener('click', () => { restart(); ui.reset.blur(); });
ui.again.addEventListener('click', restart);
ui.helpButton.addEventListener('click', (e) => {
  e.stopPropagation();
  if (helpOpen) closeHelp(); else openHelp();
  if (e.detail > 0) ui.helpButton.blur();   // clique/toque: Espaço não deve acionar o botão depois
});
ui.helpClose.addEventListener('click', (e) => { e.stopPropagation(); closeHelp(); ui.helpButton.focus({ preventScroll: true }); });
// Um toque fora do popover só o fecha.
document.addEventListener('pointerdown', (e) => {
  if (helpOpen && !(e.target.closest && e.target.closest('#help-popover, #help-button'))) closeHelp();
}, true);
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (helpOpen && e.code === 'Escape') { e.preventDefault(); closeHelp(); ui.helpButton.focus({ preventScroll: true }); return; }
  if (e.repeat) return;
  if (e.code === 'Space') {
    if (e.target.closest && e.target.closest('button:not(#start-screen)')) return;   // deixa o botão focado agir
    e.preventDefault();
    if (!g.started) startGame();
  } else if (e.code === 'KeyR') restart();
  else if (e.code === 'KeyM') { Sound.setMuted(!Sound.muted); syncMute(); }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

/* ===== 8. REDIMENSIONAMENTO: escolhe 4 ou 5 colunas e o lado do botão "?" (ao lado ou abaixo do container),
   a combinação que der cartas maiores ===== */
function resize() {
  const aw = ui.play.clientWidth - CONFIG.margin * 2, ah = ui.play.clientHeight - CONFIG.margin * 2, gap = CONFIG.gap, total = CONFIG.pairs * 2;
  const cs = getComputedStyle(ui.panel), pad = parseFloat(cs.paddingLeft) || 0, inner = parseFloat(cs.columnGap) || 0;
  const row = cs.flexDirection === 'row';          // celular deitado: placar à esquerda, cartas à direita
  const hudW = ui.hud.offsetWidth, hudH = ui.hud.offsetHeight;
  const ow = pad * 2 + (row ? hudW + inner : 0);   // largura/altura do container além do tabuleiro
  const oh = pad * 2 + (row ? 0 : hudH + inner);
  const help = HELP.button + HELP.side;            // espaço do botão "?"
  let best = { cw: 0, cols: 4, pos: 'side' };
  for (const pos of ['side', 'below']) {
    for (const cols of [4, 5]) {
      const rows = Math.ceil(total / cols);
      const availW = aw - ow - (pos === 'side' ? help * 2 : 0);   // reserva dos dois lados: o container fica centralizado
      const availH = ah - oh - (pos === 'below' ? help : 0);
      const cw = Math.min((availW - gap * (cols - 1)) / cols, ((availH - gap * (rows - 1)) / rows) * 0.75, CONFIG.maxCard);
      if (cw > best.cw + 0.01) best = { cw, cols, pos };
    }
  }
  ui.stage.dataset.helpPos = best.pos;
  ui.arena.style.setProperty('--cw', `${Math.max(40, Math.floor(best.cw))}px`);
  ui.arena.style.setProperty('--cols', String(best.cols));
  ui.arena.style.setProperty('--gap', `${gap}px`);
  placeHelp();     // reposiciona o painel de ajuda, se estiver aberto
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(ui.play);

ui.arena.style.setProperty('--flip', `${CONFIG.flipMs}ms`);
newGame(false);
syncMute();
resize();
window.__memory = { g, CONFIG };
})();