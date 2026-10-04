'use strict';
/* Campo Minado · Arcádia. Fonte única de verdade: o objeto S. O DOM só reflete S (função render). */
const LEVELS = {  // único lugar para ajustar tamanhos e quantidade de minas
  easy:   { rows: 9,  cols: 9,  mines: 10 },
  medium: { rows: 16, cols: 16, mines: 40 },
  hard:   { rows: 16, cols: 30, mines: 99 },
};
const DEFAULT_LEVEL = 'easy';
const CELL_MIN = 30, CELL_MAX = 44, FLAG_TAP_GUARD_MS = 450;
const STORE_LEVEL = 'campo_minado:level';
const $ = (id) => document.getElementById(id);
const ui = {
  arena: $('arena'), game: $('game'), field: $('field'), grid: $('grid'), mines: $('mines'), time: $('time'), status: $('status'),
  flagBtn: $('flag-button'), end: $('end'), endTitle: $('end-title'), endText: $('end-text'),
  levels: [...document.querySelectorAll('.levels button')],
};
const ICON_FLAG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2v12.5" stroke="#eceef5" stroke-width="1.7" stroke-linecap="round"/><path d="M5 2.6l8 3.2-8 3.2z" fill="#ffc857"/><path d="M2.5 14.5h6" stroke="#eceef5" stroke-width="1.7" stroke-linecap="round"/></svg>';
const ICON_MINE = '<svg viewBox="0 0 16 16" aria-hidden="true"><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2"/></g><circle cx="8" cy="8" r="4.2" fill="currentColor"/><circle cx="6.7" cy="6.7" r="1.2" fill="#fff" opacity=".7"/></svg>';

const S = {
  level: DEFAULT_LEVEL, rows: 0, cols: 0, mines: 0,
  cells: [],              // { mine, adj, open, flag }
  els: [],                // elemento DOM de cada casa
  status: 'ready',        // ready (sem minas ainda) | playing | won | lost
  opened: 0, flags: 0, hit: -1, t0: 0, elapsed: 0, flagMode: false, lastFlagAt: -1e9,
};

const store = {
  get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* sem armazenamento */ } },
};
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
  if (isOver()) return;
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
  render();
}
function toggleFlag(i) {
  if (isOver()) return;
  const cell = S.cells[i];
  if (!cell || cell.open) return;
  cell.flag = !cell.flag; S.flags += cell.flag ? 1 : -1;
  render();
}
function lose(i) {
  S.elapsed = elapsedNow(); S.status = 'lost'; S.hit = i;
  ui.endTitle.textContent = 'Você perdeu'; ui.endText.textContent = `Era uma mina. Tempo: ${fmt(S.elapsed)}`;
  showEnd('is-lost'); render();
}
function win() {
  S.elapsed = elapsedNow(); S.status = 'won';
  S.cells.forEach((c) => { if (c.mine && !c.flag) c.flag = true; }); S.flags = S.mines;
  ui.endTitle.textContent = 'Você venceu!'; ui.endText.textContent = `Todas as casas seguras reveladas em ${fmt(S.elapsed)}`;
  showEnd('is-won');
}
function showEnd(cls) {
  ui.end.className = `end ${cls}`; ui.end.hidden = false;
  window.setTimeout(() => { if (!ui.end.hidden) $('again-button').focus({ preventScroll: true }); }, 0);
}

/* ===== Montagem ===== */
function newGame(level) {
  if (!LEVELS[level]) level = DEFAULT_LEVEL;
  const L = LEVELS[level];
  Object.assign(S, {
    level, rows: L.rows, cols: L.cols, mines: L.mines, status: 'ready', opened: 0, flags: 0, hit: -1, t0: 0, elapsed: 0,
    cells: Array.from({ length: L.rows * L.cols }, () => ({ mine: false, adj: 0, open: false, flag: false })),
  });
  ui.end.hidden = true;
  ui.grid.textContent = ''; ui.grid.style.setProperty('--cols', S.cols);
  const frag = document.createDocumentFragment();
  S.els = S.cells.map((_, i) => {
    const el = document.createElement('div');
    el.className = 'cell'; el.dataset.i = i; el.setAttribute('role', 'gridcell');
    frag.appendChild(el); return el;
  });
  ui.grid.appendChild(frag);
  store.set(STORE_LEVEL, level);
  sizeBoard(); render();
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
  ui.status.textContent = {
    ready: 'Clique em uma casa para começar. O primeiro clique é sempre seguro.',
    playing: S.flagMode ? 'Modo bandeira: toque numa casa fechada para marcar ou desmarcar.' : 'Revele as casas seguras. Botão direito (ou modo bandeira) marca minas.',
    won: `Vitória em ${fmt(S.elapsed)}.`, lost: 'Derrota: você revelou uma mina.',
  }[S.status];
}
/* Casas grandes o bastante para o toque; se o tabuleiro não couber, ele rola dentro do próprio quadro */
function sizeBoard() {
  const w = ui.arena.clientWidth - 2 * 20 - 20, h = ui.arena.clientHeight - 270;
  const size = Math.max(CELL_MIN, Math.min(CELL_MAX, Math.floor(w / S.cols), Math.floor(h / S.rows)));
  ui.game.style.setProperty('--cell', `${size}px`); ui.game.style.setProperty('--cols', S.cols);
}

/* ===== Entradas ===== */
const cellIndex = (e) => { const t = e.target.closest && e.target.closest('.cell'); return t ? Number(t.dataset.i) : -1; };
function setFlagMode(on) { S.flagMode = on; render(); }
function init() {
  newGame(LEVELS[store.get(STORE_LEVEL)] ? store.get(STORE_LEVEL) : DEFAULT_LEVEL);
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
  ui.levels.forEach((el) => el.addEventListener('click', () => newGame(el.dataset.level)));
  $('new-button').addEventListener('click', () => newGame(S.level));
  $('again-button').addEventListener('click', () => newGame(S.level));
  $('view-button').addEventListener('click', () => { ui.end.hidden = true; });
  ui.flagBtn.addEventListener('click', () => setFlagMode(!S.flagMode));
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.code === 'KeyR') newGame(S.level);
    else if (e.code === 'KeyF') setFlagMode(!S.flagMode);
    else if (e.code === 'Escape') ui.end.hidden = true;
  });
  window.addEventListener('resize', sizeBoard);
  window.addEventListener('orientationchange', sizeBoard);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', sizeBoard);
  setInterval(() => { if (S.status === 'playing') ui.time.textContent = fmt(elapsedNow()); }, 250);
}
init();
window.__campo = { S, LEVELS, newGame, reveal, toggleFlag, neighbors };