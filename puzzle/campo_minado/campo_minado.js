'use strict';
/* Campo Minado · Arcádia. Fonte única de verdade: o objeto S. O DOM só reflete S (função render).
   Persistência: campo_minado_storage.js (CampoMinadoStorage), carregado antes deste arquivo. */
const LEVELS = {  // único lugar para ajustar tamanhos e quantidade de minas
  easy:   { rows: 9,  cols: 9,  mines: 10 },
  medium: { rows: 16, cols: 16, mines: 40 },
  hard:   { rows: 16, cols: 30, mines: 99 },
};
const DEFAULT_LEVEL = 'easy';
// Dimensionamento: COMFORT = menor célula aceitável só por falta de altura (rola na vertical); MIN_TOUCH = menor célula
// considerada boa para toque ao escolher layout/orientação; MIN_FIT = piso absoluto (abaixo disso o quadro rola por dentro).
const CELL_MAX = 44, COMFORT = 30, MIN_TOUCH = 26, MIN_FIT = 12, FLAG_TAP_GUARD_MS = 450;
const HELP_SIDE_ROOM = 68;   // folga (16) + botão (44) + margem (8)
const $ = (id) => document.getElementById(id);
const ui = {
  arena: $('arena'), wrap: $('game-wrap'), frame: document.querySelector('.frame'), game: $('game'), start: $('start'), startBest: $('start-best'), startBestValue: $('start-best-value'), field: $('field'), grid: $('grid'), mines: $('mines'), time: $('time'), status: $('status'),
  flagBtn: $('flag-button'), end: $('end'), endTitle: $('end-title'), endText: $('end-text'),
  levels: [...document.querySelectorAll('.levels button')],
  helpButton: $('help-button'), helpPopover: $('help-popover'), helpClose: $('help-close'),
};
const ICON_FLAG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2v12.5" stroke="#10131c" stroke-width="1.8" stroke-linecap="round"/><path d="M5 2.6l8 3.2-8 3.2z" fill="#ff3b30" stroke="#8f1410" stroke-width=".9" stroke-linejoin="round"/><path d="M2.5 14.5h6" stroke="#10131c" stroke-width="1.8" stroke-linecap="round"/></svg>';
const ICON_MINE = '<svg viewBox="0 0 16 16" aria-hidden="true"><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2"/></g><circle cx="8" cy="8" r="4.2" fill="currentColor"/><circle cx="6.7" cy="6.7" r="1.2" fill="#fff" opacity=".7"/></svg>';

const S = {
  level: DEFAULT_LEVEL, rows: 0, cols: 0, mines: 0,
  cells: [],              // { mine, adj, open, flag }
  els: [],                // elemento DOM de cada casa
  status: 'idle',         // idle (tela inicial, tudo parado) | ready (iniciado, sem minas ainda) | playing | won | lost
  transposed: false,      // só apresentação: tabuleiro largo é exibido girado (linhas × colunas) quando a tela é estreita
  opened: 0, flags: 0, hit: -1, t0: 0, elapsed: 0, flagMode: false, lastFlagAt: -1e9,
};

// Persistência própria do jogo (nível escolhido e melhor tempo por nível).
const store = CampoMinadoStorage;
const fmt = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const elapsedNow = () => (S.status === 'playing' ? performance.now() - S.t0 : S.elapsed);
const isOver = () => S.status === 'won' || S.status === 'lost';

/* Inteiro aleatório em [0, n) — usa crypto quando existe, para não ser previsível */
function rand(n) {
  if (window.crypto && window.crypto.getRandomValues) { const a = new Uint32Array(1); window.crypto.getRandomValues(a); return a[0] % n; }
  return Math.floor(Math.random() * n);
}
function neighbors(i) {
  const r = Math.floor(i / S.cols), c = i % S.cols, out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nr < S.rows && nc >= 0 && nc < S.cols) out.push(nr * S.cols + nc);
  }
  return out;
}

/* Minas só são sorteadas no primeiro clique: a casa clicada (e, se couber, sua vizinhança) nunca recebe mina */
function placeMines(safe) {
  const total = S.rows * S.cols, around = new Set([safe, ...neighbors(safe)]);
  const wide = total - around.size >= S.mines, pool = [];
  for (let i = 0; i < total; i++) if (wide ? !around.has(i) : i !== safe) pool.push(i);
  for (let k = 0; k < S.mines; k++) {           // Fisher-Yates parcial
    const j = k + rand(pool.length - k);
    [pool[k], pool[j]] = [pool[j], pool[k]];
    S.cells[pool[k]].mine = true;
  }
  S.cells.forEach((c, i) => { c.adj = neighbors(i).filter((n) => S.cells[n].mine).length; });
}

/* ===== Ações ===== */
function reveal(i) {
  if (isOver() || S.status === 'idle') return;
  const cell = S.cells[i];
  if (!cell || cell.open || cell.flag) return;
  if (S.status === 'ready') { placeMines(i); S.status = 'playing'; S.t0 = performance.now(); }
  if (cell.mine) { lose(i); return; }
  cell.open = true; S.opened++;
  const queue = [i];                              // fila (sem recursão): regiões grandes não estouram a pilha
  while (queue.length) {
    const k = queue.pop();
    if (S.cells[k].adj !== 0) continue;
    for (const n of neighbors(k)) {
      const m = S.cells[n];
      if (!m.open && !m.flag && !m.mine) { m.open = true; S.opened++; queue.push(n); }
    }
  }
  if (S.opened === S.rows * S.cols - S.mines) win();
  render(); saveGame();
}
function toggleFlag(i) {
  if (isOver() || S.status === 'idle') return;
  const cell = S.cells[i];
  if (!cell || cell.open) return;
  cell.flag = !cell.flag; S.flags += cell.flag ? 1 : -1;
  render(); saveGame();
}
function lose(i) {
  S.elapsed = elapsedNow(); S.status = 'lost'; S.hit = i;
  ui.endTitle.textContent = 'Você perdeu'; ui.endText.textContent = `Era uma mina. Tempo: ${fmt(S.elapsed)}`;
  showEnd('is-lost'); render(); store.clearGame();
}
function win() {
  S.elapsed = elapsedNow(); S.status = 'won';
  S.cells.forEach((c) => { if (c.mine && !c.flag) c.flag = true; }); S.flags = S.mines;
  const rec = store.setBestTime(S.level, S.elapsed);
  ui.endTitle.textContent = rec.isRecord ? 'Novo recorde!' : 'Você venceu!';
  ui.endText.textContent = `Todas as casas seguras reveladas em ${fmt(S.elapsed)}` + (rec.isRecord ? '' : ` · Melhor: ${fmt(rec.best)}`);
  showEnd('is-won'); store.clearGame();
}
function showEnd(cls) {
  ui.end.className = `end ${cls}`; ui.end.hidden = false;
  window.setTimeout(() => { if (!ui.end.hidden) $('again-button').focus({ preventScroll: true }); }, 0);
}

/* ===== Partida salva (sobrevive ao F5) =====
   Guarda nível, minas, casas abertas, bandeiras e tempo decorrido; some ao vencer/perder ou ao começar outro jogo. */
function saveGame() {
  if (S.status !== 'ready' && S.status !== 'playing') { store.clearGame(); return; }
  const at = (key) => { const out = []; S.cells.forEach((c, i) => { if (c[key]) out.push(i); }); return out; };
  store.setGame({ v: 1, level: S.level, elapsed: Math.floor(elapsedNow()), mines: at('mine'), open: at('open'), flags: at('flag') });
}
/* Aplica a partida salva sobre um jogo novo; devolve false (e descarta) se o dado estiver inválido ou inconsistente */
function restoreGame() {
  const d = store.getGame();
  if (!d || d.v !== 1 || !LEVELS[d.level]) { store.clearGame(); return false; }
  const L = LEVELS[d.level], total = L.rows * L.cols;
  const list = (a) => (Array.isArray(a) && a.every((n) => Number.isInteger(n) && n >= 0 && n < total) && new Set(a).size === a.length ? a : null);
  const mines = list(d.mines), open = list(d.open), flags = list(d.flags);
  const elapsed = Number(d.elapsed);
  const ok = mines && open && flags && Number.isFinite(elapsed) && elapsed >= 0
    && (mines.length === 0 ? open.length === 0 : mines.length === L.mines)
    && !open.some((i) => mines.includes(i) || flags.includes(i)) && open.length < total - L.mines;
  if (!ok) { store.clearGame(); return false; }
  newGame(d.level, false);
  mines.forEach((i) => { S.cells[i].mine = true; });
  if (mines.length) S.cells.forEach((c, i) => { c.adj = neighbors(i).filter((n) => S.cells[n].mine).length; });
  open.forEach((i) => { S.cells[i].open = true; });
  flags.forEach((i) => { S.cells[i].flag = true; });
  S.opened = open.length; S.flags = flags.length;
  if (mines.length) { S.status = 'playing'; S.elapsed = elapsed; S.t0 = performance.now() - elapsed; } else S.status = 'ready';
  render();
  return true;
}

/* ===== Montagem ===== */
/* idle = mostra a tela inicial (jogo parado). Trocar de nível/reiniciar na tela inicial mantém a tela inicial. */
function newGame(level, idle = S.status === 'idle') {
  if (!LEVELS[level]) level = DEFAULT_LEVEL;
  const L = LEVELS[level];
  Object.assign(S, {
    level, rows: L.rows, cols: L.cols, mines: L.mines, status: idle ? 'idle' : 'ready', opened: 0, flags: 0, hit: -1, t0: 0, elapsed: 0,
    cells: Array.from({ length: L.rows * L.cols }, () => ({ mine: false, adj: 0, open: false, flag: false })),
  });
  ui.end.hidden = true;
  ui.grid.textContent = ''; S.transposed = false;
  const frag = document.createDocumentFragment();
  S.els = S.cells.map((_, i) => {
    const el = document.createElement('div');
    el.className = 'cell'; el.dataset.i = i; el.setAttribute('role', 'gridcell');
    frag.appendChild(el); return el;
  });
  ui.grid.appendChild(frag);
  store.setLevel(level); store.clearGame();
  const best = store.getBestTime(level);
  ui.startBest.hidden = best === null; ui.startBestValue.textContent = best === null ? '' : fmt(best);
  sizeBoard(); render();
}
function startGame() {
  if (S.status !== 'idle') return;
  S.status = 'ready'; closeHelp(); render();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}

/* ===== Renderização ===== */
function render() {
  const lost = S.status === 'lost';
  S.cells.forEach((c, i) => {
    let key = 'c', cls = 'cell', html = '';
    if (c.open) { key = `o${c.adj}`; cls += ` open${c.adj ? ` n${c.adj}` : ''}`; html = c.adj || ''; }
    else if (lost && c.mine && !c.flag) { const boom = i === S.hit; key = boom ? 'b' : 'm'; cls += boom ? ' mine boom' : ' mine'; html = ICON_MINE; }
    else if (c.flag) { const wrong = lost && !c.mine; key = wrong ? 'w' : 'f'; cls += wrong ? ' flag wrong' : ' flag'; html = ICON_FLAG; }
    const el = S.els[i];
    if (el._k !== key) { el._k = key; el.className = cls; el.innerHTML = html; }
  });
  ui.mines.textContent = S.mines - S.flags;       // pode ficar negativo de propósito
  ui.time.textContent = fmt(elapsedNow());
  ui.levels.forEach((el) => { const on = el.dataset.level === S.level; el.setAttribute('aria-checked', on); el.tabIndex = on ? 0 : -1; });
  ui.flagBtn.setAttribute('aria-pressed', S.flagMode);
  ui.game.classList.toggle('is-flag-mode', S.flagMode); ui.game.classList.toggle('is-over', isOver());
  ui.game.classList.toggle('is-idle', S.status === 'idle'); ui.start.hidden = S.status !== 'idle';
  ui.status.textContent = {
    idle: 'Toque no tabuleiro ou pressione Space para iniciar.',
    ready: 'Clique em uma casa para começar. O primeiro clique é sempre seguro.',
    playing: S.flagMode ? 'Modo bandeira: toque numa casa fechada para marcar ou desmarcar.' : 'Revele as casas seguras. Botão direito (ou modo bandeira) marca minas.',
    won: `Vitória em ${fmt(S.elapsed)}.`, lost: 'Derrota: você revelou uma mina.',
  }[S.status];
}
/* Dimensionamento responsivo. A largura é o limite rígido (o tabuleiro nunca passa da largura útil); a altura só
   reduz as casas até o conforto mínimo (depois disso a página rola na vertical). Tudo é medido no DOM, sem valores
   fixos de viewport, então vale para qualquer zoom/tamanho. Tabuleiro largo em tela estreita é exibido girado. */
const px = (v) => parseFloat(v) || 0;
const boxX = (el) => { const s = getComputedStyle(el); return px(s.paddingLeft) + px(s.paddingRight) + px(s.borderLeftWidth) + px(s.borderRightWidth); };
function fitCell(avail, n) {                    // maior célula que cabe em n colunas na largura avail
  const f = Math.floor((avail - (n - 1) * 2) / n);
  return f >= MIN_TOUCH ? f : Math.floor((avail - (n - 1)) / n);   // casas pequenas usam fresta de 1px
}
function orderGrid() {                          // ordem dos elementos no DOM; S.els continua indexado pela casa lógica
  const frag = document.createDocumentFragment(), { rows, cols } = S;
  if (!S.transposed) for (let i = 0; i < rows * cols; i++) frag.appendChild(S.els[i]);
  else for (let dr = 0; dr < cols; dr++) for (let dc = 0; dc < rows; dc++) frag.appendChild(S.els[dc * cols + dr]);
  ui.grid.appendChild(frag);
}
function applyCell(size, dcols, chrome) {
  const small = size < MIN_TOUCH, st = ui.wrap.style;
  st.setProperty('--cell', `${size}px`); st.setProperty('--cols', dcols); st.setProperty('--chrome', `${chrome}px`);
  st.setProperty('--gap', small ? '1px' : '2px'); st.setProperty('--bevel', small ? '1px' : '2px');
  st.setProperty('--fs', size < 28 ? '.62' : '.54');
}
function sizeBoard() {
  const cs = getComputedStyle(ui.arena);
  const arenaW = ui.arena.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight);
  const arenaH = ui.arena.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom);
  const chrome = Math.ceil(boxX(ui.game) + boxX(ui.frame));
  // Candidatos em ordem de preferência: (natural, botão ao lado) > (natural, botão sob o jogo) > (girado, ao lado) > (girado, sob)
  const opts = [];
  for (const tr of (S.cols > S.rows ? [false, true] : [false])) for (const strip of [false, true]) {
    const n = tr ? S.rows : S.cols;
    opts.push({ tr, strip, n, fit: fitCell(arenaW - (strip ? 0 : 2 * HELP_SIDE_ROOM) - chrome, n) });
  }
  const pick = opts.find((o) => o.fit >= MIN_TOUCH) || opts.reduce((a, b) => (b.fit > a.fit ? b : a));
  if (pick.tr !== S.transposed) { S.transposed = pick.tr; orderGrid(); S.els.forEach((el) => { el._k = null; }); render(); }
  ui.arena.classList.toggle('help-bottom', pick.strip);
  const dcols = pick.n, drows = pick.tr ? S.cols : S.rows;
  applyCell(Math.max(MIN_FIT, Math.min(pick.fit, CELL_MAX)), dcols, chrome);    // medida provisória para ler a altura dos demais elementos
  const other = ui.game.offsetHeight - ui.grid.offsetHeight + (pick.strip ? 56 : 0);
  const heightFit = Math.floor((arenaH - other - (drows - 1)) / drows);
  let size = Math.max(MIN_FIT, Math.min(pick.fit, Math.max(Math.min(CELL_MAX, heightFit), COMFORT)));
  applyCell(size, dcols, chrome);
  // Verificação: se mesmo assim o quadro rolar na horizontal (arredondamento/zoom), encolhe 1px até caber
  for (let g = 0; g < 8 && size > MIN_FIT && ui.field.scrollWidth > ui.field.clientWidth; g++) applyCell(--size, dcols, chrome);
  placeHelp();
}

/* ===== Ajuda "Como jogar": popover ancorado ao botão "?", fora do tabuleiro; abre para baixo quando há espaço ===== */
const HELP = { gap: 12, edge: 8, width: 264 };
let helpOpen = false;
function openHelp() {
  if (helpOpen) return;
  helpOpen = true; ui.helpPopover.hidden = false; ui.helpButton.setAttribute('aria-expanded', 'true'); placeHelp();
}
function closeHelp() {
  if (!helpOpen) return;
  helpOpen = false; ui.helpPopover.hidden = true; ui.helpButton.setAttribute('aria-expanded', 'false');
}
function placeHelp() {
  if (!helpOpen) return;
  const pop = ui.helpPopover, btn = ui.helpButton.getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const width = Math.min(HELP.width, vw - HELP.edge * 2);
  const left = Math.max(HELP.edge, Math.min(btn.left, vw - HELP.edge - width));
  pop.style.width = `${width}px`; pop.style.left = `${Math.round(left)}px`; pop.style.maxHeight = 'none';
  const natural = pop.offsetHeight;
  const roomBelow = vh - btn.bottom - HELP.gap - HELP.edge, roomAbove = btn.top - HELP.gap - HELP.edge;
  const strip = ui.arena.classList.contains('help-bottom');
  const below = !strip && (natural <= roomBelow || roomBelow >= roomAbove);
  pop.dataset.placement = below ? 'below' : 'above';
  pop.style.maxHeight = `${Math.max(120, Math.floor(below ? roomBelow : roomAbove))}px`;
  pop.style.top = below ? `${Math.round(btn.bottom + HELP.gap)}px` : 'auto';
  pop.style.bottom = below ? 'auto' : `${Math.round(vh - btn.top + HELP.gap)}px`;
  pop.style.setProperty('--arrow-x', `${Math.round(Math.min(Math.max(btn.left + btn.width / 2 - left, 16), width - 16))}px`);
}

/* ===== Entradas ===== */
const cellIndex = (e) => { const t = e.target.closest && e.target.closest('.cell'); return t ? Number(t.dataset.i) : -1; };
function setFlagMode(on) { S.flagMode = on; render(); }
function init() {
  // Partida salva (F5): retoma direto. Sem partida salva, começa na tela inicial, tudo parado.
  if (!restoreGame()) newGame(LEVELS[store.getLevel()] ? store.getLevel() : DEFAULT_LEVEL, true);
  ui.grid.addEventListener('click', (e) => {
    const i = cellIndex(e); if (i < 0) return;
    if (performance.now() - S.lastFlagAt < FLAG_TAP_GUARD_MS) return;   // evita contar duas vezes o mesmo gesto
    if (S.flagMode) toggleFlag(i); else reveal(i);
  });
  ui.field.addEventListener('contextmenu', (e) => {                      // botão direito (ou toque longo) = bandeira
    e.preventDefault();
    const i = cellIndex(e); if (i < 0) return;
    S.lastFlagAt = performance.now(); toggleFlag(i);
  });
  ui.start.addEventListener('click', startGame);
  ui.helpButton.addEventListener('click', (e) => {
    if (helpOpen) closeHelp(); else openHelp();
    if (e.detail > 0) ui.helpButton.blur();   // clique/toque: Space não deve acionar o botão depois
  });
  ui.helpClose.addEventListener('click', () => { closeHelp(); ui.helpButton.focus({ preventScroll: true }); });
  document.addEventListener('pointerdown', (e) => { if (helpOpen && !(e.target.closest && e.target.closest('.help, .help-popover'))) closeHelp(); });
  ui.arena.addEventListener('scroll', placeHelp, { passive: true });
  ui.levels.forEach((el) => el.addEventListener('click', () => newGame(el.dataset.level)));
  $('new-button').addEventListener('click', () => newGame(S.level));
  $('again-button').addEventListener('click', () => newGame(S.level));
  $('view-button').addEventListener('click', () => { ui.end.hidden = true; });
  ui.flagBtn.addEventListener('click', () => setFlagMode(!S.flagMode));
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const inHelp = e.target.closest && e.target.closest('.help, .help-popover');
    if (e.code === 'Escape') { if (helpOpen) closeHelp(); else ui.end.hidden = true; }
    else if (e.code === 'Space' && S.status === 'idle' && !inHelp) { e.preventDefault(); startGame(); }
    else if (e.code === 'KeyR') newGame(S.level);
    else if (e.code === 'KeyF') setFlagMode(!S.flagMode);
  });
  window.addEventListener('resize', sizeBoard);
  if (window.ResizeObserver) { let raf = 0; new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(sizeBoard); }).observe(ui.arena); }
  window.addEventListener('orientationchange', sizeBoard);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', sizeBoard);
  setInterval(() => { if (S.status === 'playing') ui.time.textContent = fmt(elapsedNow()); }, 250);
  window.addEventListener('pagehide', saveGame);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });
  if (S.status === 'idle') ui.start.focus({ preventScroll: true });
}
init();
window.__campo = { S, LEVELS, newGame, startGame, reveal, toggleFlag, neighbors, sizeBoard, saveGame, restoreGame };