'use strict';
/* Slide Puzzle · Arcádia. Fonte única de verdade: o objeto S. O DOM só reflete S (função render). */
const LEVELS = {
  easy:   { n: 3, steps: 120, minDist: 12 },
  medium: { n: 4, steps: 240, minDist: 24 },
  hard:   { n: 5, steps: 400, minDist: 44 },
};
const START_GUARD_MS = 450;
const W = 288, H = 512, MARGIN = 6, MAX_CSS_HEIGHT = 1000;
const $ = (id) => document.getElementById(id);
const ui = {
  arena: $('arena'), stage: $('stage'), grid: $('grid'), moves: $('moves'), time: $('time'), best: $('best'),
  status: $('status'), mute: $('mute-button'), pause: $('pause-button'), confirmText: $('confirm-text'),
  levels: [...document.querySelectorAll('.levels button')],
  frame: $('frame'), helpButton: $('help-button'), helpPopover: $('help-popover'), helpClose: $('help-close'),
};

const S = {
  level: 'medium', n: 4, board: [], initial: [], moves: 0,
  status: 'ready',            // ready (aguardando o toque inicial) | playing | paused | won
  elapsed: 0, t0: 0, readyAt: 0, pending: null, resumeAfter: false, muted: false, isRecord: false, tiles: new Map(),
};

/* ===== Armazenamento (nunca pode quebrar o jogo) ===== */
// Persistência: tudo passa por slide_puzzle_storage.js (SlidePuzzleStorage): level, muted e melhor resultado por dificuldade.
const loadBest = (level) => SlidePuzzleStorage.getBest(level);
const isBetter = (a, b) => !b || a.moves < b.moves || (a.moves === b.moves && a.time < b.time);

/* ===== Áudio (Web Audio, sem arquivos externos) ===== */
const Sound = (() => {
  let ctx = null, master = null, off = false;
  S.muted = SlidePuzzleStorage.isMuted();
  function ensure() {
    if (off) return null;
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) { off = true; return null; }
      try { ctx = new C(); master = ctx.createGain(); master.gain.value = 0.25; master.connect(ctx.destination); }
      catch (e) { off = true; ctx = null; return null; }
    }
    if (ctx.state === 'suspended') { try { ctx.resume().catch(() => {}); } catch (e) {} }
    return ctx;
  }
  function tone(from, to, dur, type = 'triangle', vol = 0.5, delay = 0) {
    if (S.muted) return;
    try {
      const c = ensure(); if (!c) return;
      const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(from, t);
      if (to !== from) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* áudio nunca quebra o jogo */ }
  }
  return {
    unlock() { if (!S.muted) { try { ensure(); } catch (e) {} } },
    move() { tone(330, 460, 0.07); },
    blocked() { tone(150, 120, 0.09, 'square', 0.18); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.16, 'square', 0.3, i * 0.11)); },
  };
})();

/* ===== Lógica do tabuleiro ===== */
const solvedBoard = (n) => Array.from({ length: n * n }, (_, i) => (i === n * n - 1 ? 0 : i + 1));
function isSolved(b) { return b.every((v, i) => v === (i === b.length - 1 ? 0 : i + 1)); }
function distance(b, n) {
  let d = 0;
  b.forEach((v, i) => { if (v) { const t = v - 1; d += Math.abs(Math.floor(i / n) - Math.floor(t / n)) + Math.abs((i % n) - (t % n)); } });
  return d;
}
function neighbors(e, n) {
  const r = Math.floor(e / n), c = e % n, out = [];
  if (r > 0) out.push(e - n); if (r < n - 1) out.push(e + n);
  if (c > 0) out.push(e - 1); if (c < n - 1) out.push(e + 1);
  return out;
}
/* Parte do estado resolvido e aplica movimentos válidos aleatórios (sempre solucionável) */
function shuffled(level, avoid = []) { // avoid: configurações (arrays) que não podem se repetir
  const { n, steps, minDist } = LEVELS[level];
  const same = (b) => avoid.some((a) => a && a.length === b.length && a.every((v, i) => v === b[i]));
  for (let attempt = 0; attempt < 100; attempt++) {
    const b = solvedBoard(n); let e = b.length - 1, prev = -1;
    for (let s = 0; s < steps; s++) {
      let opts = neighbors(e, n);
      if (opts.length > 1) opts = opts.filter((i) => i !== prev);
      const t = opts[Math.floor(Math.random() * opts.length)];
      b[e] = b[t]; b[t] = 0; prev = e; e = t;
    }
    if (!isSolved(b) && distance(b, n) >= minDist && !same(b)) return b;
  }
  const b = solvedBoard(n); b[b.length - 1] = b[b.length - 2]; b[b.length - 2] = 0; return b; // reserva: um movimento
}

/* ===== Tempo ===== */
const elapsedNow = () => (S.status === 'playing' ? S.elapsed + performance.now() - S.t0 : S.elapsed);
const fmt = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function pauseTimer() { if (S.status === 'playing') { S.elapsed = elapsedNow(); S.status = 'paused'; } }
function resumeTimer() { if (S.status === 'paused') { S.t0 = performance.now(); S.status = 'playing'; } }

/* ===== Ações ===== */
function moveAt(i) {
  if (S.status !== 'playing' || S.pending) return false;
  const e = S.board.indexOf(0);
  if (!neighbors(e, S.n).includes(i)) { Sound.blocked(); return false; }
  S.board[e] = S.board[i]; S.board[i] = 0; S.moves++;
  if (isSolved(S.board)) win(); else Sound.move();
  render();
  return true;
}
/* Toque inicial: começa a partida e o cronômetro; nenhuma peça é movida */
function beginPlay() {
  if (S.status !== 'ready' || S.pending || performance.now() - S.readyAt < START_GUARD_MS) return; // ignora toque duplo logo após reiniciar
  // Cada início gera uma configuração nova (diferente da exibida); recarregar a página não ajuda a escolher o tabuleiro
  S.board = shuffled(S.level, [S.board, S.initial]); S.initial = S.board.slice(); S.moves = 0;
  S.status = 'playing'; S.elapsed = 0; S.t0 = performance.now();
  Sound.unlock(); render();
}
function win() {
  S.elapsed = elapsedNow(); S.status = 'won';
  const result = { moves: S.moves, time: Math.round(S.elapsed) };
  S.isRecord = isBetter(result, loadBest(S.level));
  if (S.isRecord) SlidePuzzleStorage.setBest(S.level, result);
  $('won-moves').textContent = S.moves; $('won-time').textContent = fmt(S.elapsed);
  $('won-record').hidden = !S.isRecord;
  Sound.win();
}
function buildBoard() {
  S.tiles.clear(); ui.grid.textContent = ''; ui.grid.style.setProperty('--n', S.n);
  for (let i = 0; i < S.n * S.n; i++) {
    const s = document.createElement('div'); s.className = 'cell slot';
    s.style.setProperty('--r', Math.floor(i / S.n)); s.style.setProperty('--c', i % S.n);
    s.innerHTML = '<span class="face"></span>'; ui.grid.appendChild(s);
  }
  for (let v = 1; v < S.n * S.n; v++) {
    const t = document.createElement('button'); t.type = 'button'; t.className = 'cell tile'; t.dataset.v = v;
    t.tabIndex = -1; t.setAttribute('aria-label', `Peça ${v}`); t.innerHTML = `<span class="face">${v}</span>`;
    ui.grid.appendChild(t); S.tiles.set(v, t);
  }
}
/* Reiniciar: volta à configuração inicial da partida atual (S.initial, guardada em beginPlay) e já começa a contar */
function restartGame() {
  if (!S.initial.length || S.status === 'ready') return;
  S.board = S.initial.slice(); S.moves = 0; S.elapsed = 0; S.t0 = performance.now();
  S.status = 'playing'; S.pending = null; S.resumeAfter = false; S.isRecord = false;
  render();
}
function startGame(level) {
  if (!LEVELS[level]) level = 'medium';
  const resize = level !== S.level || !S.tiles.size;
  S.level = level; S.n = LEVELS[level].n; S.pending = null; S.resumeAfter = false;
  S.initial = shuffled(level, [S.board, S.initial]);
  S.board = S.initial.slice(); S.moves = 0; S.elapsed = 0; S.status = 'ready'; S.isRecord = false; S.readyAt = performance.now();
  if (resize) buildBoard();
  SlidePuzzleStorage.setLevel(level);
  render();
}
/* Pede confirmação quando há progresso a perder */
function ask(text, action) {
  if (S.moves === 0 || S.status === 'won') { action(); return; }
  S.resumeAfter = S.status === 'playing'; pauseTimer();
  S.pending = action; ui.confirmText.textContent = text; render();
}
function answer(yes) {
  const action = S.pending; S.pending = null;
  if (yes && action) action(); else if (S.resumeAfter) resumeTimer();
  S.resumeAfter = false; render();
}
function togglePause(wantPause) {
  if (S.pending) return;
  if (wantPause && S.status === 'playing') pauseTimer();
  else if (!wantPause && S.status === 'paused') resumeTimer();
  render();
}

/* ===== Renderização ===== */
function render() {
  const { n, board } = S, e = board.indexOf(0), near = new Set(neighbors(e, n)), live = S.status === 'playing';
  board.forEach((v, i) => {
    if (!v) return;
    const t = S.tiles.get(v); if (!t) return;
    t.style.setProperty('--r', Math.floor(i / n)); t.style.setProperty('--c', i % n);
    const can = live && !S.pending && near.has(i);
    t.classList.toggle('can-move', can); t.classList.toggle('is-home', v === i + 1); // v pertence à posição v - 1
  });
  ui.moves.textContent = S.moves; ui.time.textContent = fmt(elapsedNow());
  const b = loadBest(S.level); ui.best.textContent = b ? `${b.moves} · ${fmt(b.time)}` : '—';
  ui.levels.forEach((el) => { const on = el.dataset.level === S.level; el.setAttribute('aria-checked', on); el.tabIndex = on ? 0 : -1; });
  ui.status.textContent = S.status === 'ready' ? 'O tempo começa quando você tocar no tabuleiro ou apertar Space' : `Ordene de 1 a ${n * n - 1}, com o espaço no canto`;
  const c = ui.stage.classList;
  c.toggle('is-ready', S.status === 'ready'); c.toggle('is-playing', S.status === 'playing');
  c.toggle('is-paused', S.status === 'paused' && !S.pending); c.toggle('is-confirm', Boolean(S.pending)); c.toggle('is-won', S.status === 'won');
  $('reset-button').disabled = S.status === 'ready'; // ainda não há partida iniciada para restaurar
  ui.mute.classList.toggle('is-muted', S.muted); ui.mute.setAttribute('aria-pressed', S.muted);
  ui.mute.setAttribute('aria-label', S.muted ? 'Ativar efeitos sonoros' : 'Silenciar efeitos sonoros');
}
function toggleMute() { S.muted = !S.muted; SlidePuzzleStorage.setMuted(S.muted); if (!S.muted) Sound.unlock(); render(); }
/* O botão "?" fica fora do jogo: ao lado (reserva dos dois lados, para o jogo seguir centralizado) ou, se faltar
   largura, logo abaixo. Escolhe o formato que permite o maior jogo. */
const HELP = { gap: 12, edge: 8, maxWidth: 270, button: 40, side: 18 };
function resizeStage() {
  const aw = Math.max(1, ui.arena.clientWidth - MARGIN * 2), ah = Math.max(1, ui.arena.clientHeight - MARGIN * 2), help = HELP.button + HELP.side;
  let best = { cw: 0, pos: 'side' };
  for (const pos of ['side', 'below']) {
    const w = Math.max(1, aw - (pos === 'side' ? help * 2 : 0)), h = Math.max(1, ah - (pos === 'below' ? help : 0));
    let cw = Math.min(h, MAX_CSS_HEIGHT) * (W / H);
    if (cw > w) cw = w;
    cw = Math.floor(cw);
    if (cw > best.cw) best = { cw, pos };
  }
  const cw = best.cw, ch = Math.floor(cw / (W / H));
  ui.frame.dataset.helpPos = best.pos;
  ui.stage.style.width = `${cw}px`; ui.stage.style.height = `${ch}px`; ui.stage.style.setProperty('--u', `${cw / W}px`);
  placeHelp();     // reposiciona o painel de ajuda, se estiver aberto
}

/* ===== Ajuda "Como jogar": popover ancorado ABAIXO do botão "?", fora da área do jogo =====
   Se abrir no meio da partida, o jogo pausa (o tempo não corre); ao fechar, a pausa continua até "Continuar". */
let helpOpen = false;
function openHelp() {
  if (helpOpen) return;
  helpOpen = true;
  ui.helpPopover.hidden = false;
  ui.helpButton.setAttribute('aria-expanded', 'true');
  togglePause(true);                        // só tem efeito durante a partida
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
  if (ui.frame.dataset.helpPos !== 'side' && height > roomBelow && roomAbove > roomBelow) placement = 'above';
  const room = placement === 'below' ? roomBelow : roomAbove;
  if (height > room) { pop.style.maxHeight = `${Math.max(96, Math.floor(room))}px`; pop.style.overflowY = 'auto'; }
  const finalHeight = pop.offsetHeight;
  pop.style.top = `${Math.round(placement === 'below' ? btn.bottom + HELP.gap : btn.top - HELP.gap - finalHeight)}px`;
  pop.dataset.placement = placement;
}

/* ===== Entradas ===== */
/* Teclado: Space inicia a partida; M som; P/Esc pausa. As peças se movem apenas por clique/toque. */
function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (helpOpen && e.code === 'Escape') { e.preventDefault(); closeHelp(); ui.helpButton.focus({ preventScroll: true }); return; }
  if (e.repeat) return;
  if (e.code === 'Space') {
    if (e.target.closest && e.target.closest('#help-button, #help-close')) return;   // deixa o botão focado agir
    e.preventDefault();
    if (S.status === 'ready') beginPlay();
  }
  else if (e.code === 'KeyM') toggleMute();
  else if (e.code === 'KeyP') { togglePause(S.status === 'playing'); }
  else if (e.code === 'Escape') { if (S.pending) answer(false); else togglePause(S.status === 'playing'); }
}
function init() {
  const saved = SlidePuzzleStorage.getLevel();
  S.level = '';  // força a construção inicial do tabuleiro
  startGame(LEVELS[saved] ? saved : 'medium');
  S.readyAt = -START_GUARD_MS; // a proteção contra toque duplo vale só depois de reiniciar/novo jogo, não ao abrir a página
  resizeStage();
  ui.grid.addEventListener('click', (e) => {
    const t = e.target.closest('.tile'); if (!t || e.detail === 0) return; // detail 0 = clique gerado por teclado
    Sound.unlock(); moveAt(S.board.indexOf(Number(t.dataset.v))); t.blur();
  });
  $('start-button').addEventListener('click', () => {
    beginPlay();
  });
  ui.levels.forEach((el) => el.addEventListener('click', () => {
    const lv = el.dataset.level; if (lv === S.level) return;
    ask('Trocar a dificuldade encerra a partida atual. Continuar?', () => startGame(lv));
  }));
  $('new-button').addEventListener('click', () => ask('Iniciar um novo jogo encerra a partida atual. Continuar?', () => startGame(S.level)));
  $('reset-button').addEventListener('click', () => ask('Reiniciar volta o tabuleiro à ordem inicial e zera movimentos e tempo. Continuar?', restartGame));
  $('again-button').addEventListener('click', () => startGame(S.level));
  $('resume-button').addEventListener('click', () => togglePause(false));
  $('confirm-yes').addEventListener('click', () => answer(true));
  $('confirm-no').addEventListener('click', () => answer(false));
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
  // Depois de um clique/toque, o botão solta o foco: assim Space inicia a partida em vez de reacionar o botão.
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b && e.detail > 0) b.blur(); });
  ui.pause.addEventListener('click', () => { togglePause(true); ui.pause.blur(); });
  ui.mute.addEventListener('click', () => { toggleMute(); ui.mute.blur(); });
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('pointerdown', () => Sound.unlock());
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', () => togglePause(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) togglePause(true); });
  window.addEventListener('resize', resizeStage);
  window.addEventListener('orientationchange', resizeStage);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resizeStage);
  setInterval(() => { if (S.status === 'playing') ui.time.textContent = fmt(elapsedNow()); }, 250);
}
init();

window.__slide = { S, shuffled, isSolved, moveAt, startGame, neighbors, beginPlay };