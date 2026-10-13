'use strict';
/* Campo Minado · Arcádia. Fonte única de verdade: o objeto S. O DOM só reflete S (função render).
   Persistência: campo_minado_storage.js (CampoMinadoStorage), carregado antes deste arquivo.
   Fluxo: tela inicial (escolha da dificuldade + Jogar) -> partida. Jogo único, sem fim (modo Infinito). */
const store = CampoMinadoStorage;
const DIFFICULTIES = Object.freeze({   // único lugar para ajustar o balanceamento
  easy:   Object.freeze({ rows: 9,  cols: 9,  mines: 10 }),
  medium: Object.freeze({ rows: 16, cols: 16, mines: 40 }),
  hard:   Object.freeze({ rows: 16, cols: 30, mines: 99 }),   // 16 linhas × 30 colunas
});
const NAMES = Object.freeze({ easy: 'Fácil', medium: 'Médio', hard: 'Difícil' });
const DEFAULT_LEVEL = 'easy';
// Dimensionamento: COMFORT = menor célula aceitável só por falta de altura (rola na vertical); MIN_TOUCH = menor célula
// considerada boa para toque ao escolher layout/orientação; MIN_FIT = piso absoluto (abaixo disso o quadro rola por dentro).
const CELL_MAX = 44, COMFORT = 30, MIN_TOUCH = 26, MIN_FIT = 12, FLAG_TAP_GUARD_MS = 450;
const COUNTDOWN = ['3', '2', '1', 'GO!'], COUNT_MS = 800, GO_MS = 600, SAVE_EVERY_MS = 1000;   // contagem regressiva ao continuar; salvar a cada 1 s de jogo
const CASCADE_MIN = 6;                       // abrir tantas casas de uma vez toca o som de "cascata"
const $ = (id) => document.getElementById(id);
const ui = {
  arena: $('arena'), wrap: $('game-wrap'), frame: document.querySelector('.frame'), game: $('game'), body: $('game-body'), tools: document.querySelector('.tools'),
  topbar: document.querySelector('.topbar'), field: $('field'), grid: $('grid'), mines: $('mines'), time: $('time'), status: $('status'),
  modeLabel: $('mode-label'), modeValue: $('mode-value'),
  flagBtn: $('flag-button'), pauseBtn: $('pause-button'), muteBtn: $('mute-button'), helpButton: $('help-button'),
  screens: { home: $('screen-home'), pause: $('screen-pause'), count: $('screen-count'), confirm: $('screen-confirm'), end: $('screen-end') },
  homeInfo: $('home-info'), levelGroup: document.querySelector('#screen-home .levels'),
  endTitle: $('end-title'), endText: $('end-text'),
  chip: $('resumed-chip'), pauseNote: $('pause-note'), pauseTime: $('pause-time'), pauseMines: $('pause-mines'), countNum: $('count-num'),
  help: $('help-modal'), helpBody: $('help-body'),
  tip: $('tip'), tipText: $('tip-text'), tipKey: $('tip-key'),
  levels: [...document.querySelectorAll('#screen-home [data-level]')],   // dificuldades (tela inicial)
};
const ICON_FLAG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2v12.5" stroke="#10131c" stroke-width="1.8" stroke-linecap="round"/><path d="M5 2.6l8 3.2-8 3.2z" fill="#ff3b30" stroke="#8f1410" stroke-width=".9" stroke-linejoin="round"/><path d="M2.5 14.5h6" stroke="#10131c" stroke-width="1.8" stroke-linecap="round"/></svg>';
const ICON_MINE = '<svg viewBox="0 0 16 16" aria-hidden="true"><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2"/></g><circle cx="8" cy="8" r="4.2" fill="currentColor"/><circle cx="6.7" cy="6.7" r="1.2" fill="#fff" opacity=".7"/></svg>';

const S = {
  level: DEFAULT_LEVEL, rows: 0, cols: 0, mines: 0,   // level: easy | medium | hard
  cells: [],              // { mine, adj, open, flag }
  els: [],                // elemento DOM de cada casa
  status: 'home',         // home (tela inicial: dificuldade + Jogar) | ready (sem minas ainda) | playing | won | lost
  hold: null,             // null | 'paused' | 'countdown': pausa por cima de ready/playing (tempo e jogadas congelados)
  pauseReason: null,      // manual | help | hidden (saiu da aba) | returned (voltou à aba) | restored (recarregou a página)
  confirm: false,         // confirmação "voltar à tela inicial" aberta (por cima da pausa)
  endOpen: false,         // tela de vitória/derrota aberta
  transposed: false,      // só apresentação: tabuleiro largo é exibido girado (linhas × colunas) quando a tela é estreita
  muted: false,
  opened: 0, flags: 0, hit: -1, t0: 0, elapsed: 0, flagMode: false, lastFlagAt: -1e9,
};
const AWAY = ['home'];                      // telas fora da partida
const isAway = () => AWAY.includes(S.status);
const fmt = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const elapsedNow = () => (S.status === 'playing' && !S.hold ? performance.now() - S.t0 : S.elapsed);
const isOver = () => S.status === 'won' || S.status === 'lost';

/* ===== Áudio (Web Audio, sem arquivos externos). Nunca quebra o jogo; respeita S.muted ===== */
const Sound = (() => {
  let ctx = null, master = null, off = false, noiseBuf = null;
  function ensure() {
    if (off) return null;
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) { off = true; return null; }
      try { ctx = new C(); master = ctx.createGain(); master.gain.value = 0.25; master.connect(ctx.destination); }
      catch (e) { off = true; ctx = null; return null; }
    }
    if (ctx.state === 'suspended') { try { ctx.resume().catch(() => {}); } catch (e) { /* ignora */ } }
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
  function noise(dur, vol, cutoff) {   // ruído com filtro descendo: base da explosão
    if (S.muted) return;
    try {
      const c = ensure(); if (!c) return;
      if (!noiseBuf) { noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      const t = c.currentTime, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      src.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.setValueAtTime(cutoff, t); f.frequency.exponentialRampToValueAtTime(80, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + dur + 0.02);
    } catch (e) { /* áudio nunca quebra o jogo */ }
  }
  return {
    unlock() { if (!S.muted) { try { ensure(); } catch (e) { /* ignora */ } } },
    click() { tone(430, 520, 0.05, 'triangle', 0.3); },                       // menus, escolhas
    back() { tone(520, 380, 0.06, 'triangle', 0.3); },
    reveal(n = 0) { tone(380 + n * 45, 520 + n * 45, 0.06, 'triangle', 0.35); },   // casa aberta: mais aguda quanto maior o número
    cascade() { tone(260, 780, 0.22, 'sine', 0.4); tone(390, 1170, 0.22, 'sine', 0.15, 0.03); },
    flag(on) { if (on) tone(760, 980, 0.07, 'square', 0.2); else tone(560, 380, 0.07, 'square', 0.2); },
    blocked() { tone(150, 120, 0.09, 'square', 0.18); },                       // casa marcada
    flagMode(on) { tone(on ? 620 : 480, on ? 820 : 420, 0.06, 'triangle', 0.3); },
    pause() { tone(500, 330, 0.1, 'triangle', 0.3); },
    tick() { tone(440, 440, 0.09, 'triangle', 0.35); },
    go() { tone(660, 990, 0.2, 'square', 0.3); },
    boom() { noise(0.6, 0.9, 1800); tone(180, 40, 0.5, 'sawtooth', 0.5); },
    win(record) { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.16, 'square', 0.3, i * 0.11)); if (record) tone(1319, 1319, 0.3, 'square', 0.3, 0.55); },
  };
})();
S.muted = store.isMuted();

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

/* ===== Ações da partida ===== */
function reveal(i) {
  if (isOver() || isAway() || S.hold) return;
  const cell = S.cells[i];
  if (!cell || cell.open) return;
  if (cell.flag) { Sound.blocked(); return; }
  if (S.status === 'ready') { placeMines(i); S.status = 'playing'; S.t0 = performance.now(); }
  if (cell.mine) { lose(i); return; }
  const before = S.opened;
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
  else if (S.opened - before >= CASCADE_MIN) Sound.cascade();
  else Sound.reveal(cell.adj);
  render(); saveGame();
}
function toggleFlag(i) {
  if (isOver() || isAway() || S.hold) return;
  const cell = S.cells[i];
  if (!cell || cell.open) return;
  cell.flag = !cell.flag; S.flags += cell.flag ? 1 : -1;
  Sound.flag(cell.flag);
  render(); saveGame();
}
function lose(i) {
  S.elapsed = elapsedNow(); S.status = 'lost'; S.hit = i;
  ui.endTitle.textContent = 'Você perdeu'; ui.endText.textContent = `Era uma mina. Tempo: ${fmt(S.elapsed)}`;
  Sound.boom();
  showEnd('is-lost'); render(); store.clearGame();
}
function win() {
  S.elapsed = elapsedNow(); S.status = 'won';
  S.cells.forEach((c) => { if (c.mine && !c.flag) c.flag = true; }); S.flags = S.mines;
  const rec = store.setBestTime(S.level, S.elapsed);
  ui.endTitle.textContent = rec.isRecord ? 'Novo recorde!' : 'Você venceu!';
  ui.endText.textContent = `Todas as casas seguras reveladas em ${fmt(S.elapsed)}`
    + (rec.isRecord || rec.best === null ? '' : ` · Melhor: ${fmt(rec.best)}`);
  Sound.win(rec.isRecord);
  showEnd('is-won'); store.clearGame();
}
function showEnd(cls) {
  const e = ui.screens.end;
  e.classList.remove('is-won', 'is-lost'); e.classList.add(cls); S.endOpen = true;   // render() abre a tela e foca o botão
}

/* ===== Partida salva (sobrevive ao F5) =====
   Guarda o nível, minas, casas abertas, bandeiras e tempo decorrido; some ao vencer/perder ou ao voltar à tela inicial. */
function saveGame() {
  if (S.status !== 'ready' && S.status !== 'playing') { store.clearGame(); return; }
  const at = (key) => { const out = []; S.cells.forEach((c, i) => { if (c[key]) out.push(i); }); return out; };
  store.setGame({ v: 3, level: S.level, elapsed: Math.floor(elapsedNow()), mines: at('mine'), open: at('open'), flags: at('flag'), flagMode: S.flagMode });
}
/* Aplica a partida salva sobre um tabuleiro novo (sem sortear minas de novo); devolve false (e descarta) se o dado estiver inválido ou inconsistente.
   Salvamentos antigos do modo Infinito (v1/v2) continuam valendo; os do extinto modo Fases (mode: 'levels') são descartados. */
function restoreGame() {
  const d = store.getGame();
  if (!d || (d.v !== 1 && d.v !== 2 && d.v !== 3) || d.mode === 'levels' || !DIFFICULTIES[d.level]) { store.clearGame(); return false; }
  const L = DIFFICULTIES[d.level], total = L.rows * L.cols;
  const list = (a) => (Array.isArray(a) && a.every((n) => Number.isInteger(n) && n >= 0 && n < total) && new Set(a).size === a.length ? a : null);
  const mines = list(d.mines), open = list(d.open), flags = list(d.flags);
  const elapsed = Number(d.elapsed);
  const ok = mines && open && flags && Number.isFinite(elapsed) && elapsed >= 0
    && (mines.length === 0 ? open.length === 0 : mines.length === L.mines)
    && !open.some((i) => mines.includes(i) || flags.includes(i)) && open.length < total - L.mines;
  if (!ok) { store.clearGame(); return false; }
  S.level = d.level;
  build(L);
  mines.forEach((i) => { S.cells[i].mine = true; });
  if (mines.length) S.cells.forEach((c, i) => { c.adj = neighbors(i).filter((n) => S.cells[n].mine).length; });
  open.forEach((i) => { S.cells[i].open = true; });
  flags.forEach((i) => { S.cells[i].flag = true; });
  S.opened = open.length; S.flags = flags.length;
  if (mines.length) { S.status = 'playing'; S.elapsed = elapsed; S.t0 = performance.now() - elapsed; } else S.status = 'ready';
  S.flagMode = d.flagMode === true;
  S.hold = 'paused'; S.pauseReason = 'restored';   // volta SEMPRE pausada, esperando o jogador
  render(); saveGame();
  return true;
}

/* ===== Montagem e navegação ===== */
/* Monta o tabuleiro vazio (sem mexer em modo/status). Nas telas fora da partida usa o tamanho Fácil, para o container ter sempre o mesmo porte. */
function build(cfg) {
  Object.assign(S, {
    rows: cfg.rows, cols: cfg.cols, mines: cfg.mines, opened: 0, flags: 0, hit: -1, t0: 0, elapsed: 0,
    cells: Array.from({ length: cfg.rows * cfg.cols }, () => ({ mine: false, adj: 0, open: false, flag: false })),
  });
  cancelCountdown(); S.hold = null; S.pauseReason = null; S.endOpen = false; S.confirm = false;
  ui.grid.textContent = ''; S.transposed = false;
  const frag = document.createDocumentFragment();
  S.els = S.cells.map((_, i) => {
    const el = document.createElement('div');
    el.className = 'cell'; el.dataset.i = i; el.setAttribute('role', 'gridcell');
    frag.appendChild(el); return el;
  });
  ui.grid.appendChild(frag);
  sizeBoard();
}
/* Novo tabuleiro na dificuldade atual, pronto para o primeiro clique (também é o "Novo jogo"). Sem confirmação e sem passar pela tela inicial. */
function startRound() {
  build(DIFFICULTIES[S.level]);
  S.status = 'ready'; render(); saveGame();
}
function newGame() { if (!isAway()) startRound(); }
function beginGame() { if (S.status !== 'home') return; store.setLevel(S.level); startRound(); }
function chooseLevel(level) {                 // só na tela inicial: escolhe a dificuldade; o tabuleiro é montado ao tocar em Jogar
  if (S.status !== 'home' || !DIFFICULTIES[level]) return;
  S.level = level; store.setLevel(level); Sound.click(); render();
}
function goHome() { S.status = 'home'; build(DIFFICULTIES.easy); store.clearGame(); render(); }   // sair da partida apaga a partida salva
/* "Voltar para a tela inicial" a partir da pausa/fim: com jogo em andamento pede confirmação; senão volta direto. */
function leaveGame() {
  if (S.status === 'playing' && (S.opened > 0 || S.flags > 0)) { S.confirm = true; render(); return; }
  goHome();
}
function answerConfirm(yes) { S.confirm = false; if (yes) goHome(); else render(); }
function toggleMute() {
  if (isAway()) return;                       // o controle de som só existe durante a partida
  S.muted = store.setMuted(!S.muted);
  if (!S.muted) { Sound.unlock(); Sound.click(); }
  render();
}

/* ===== Renderização ===== */
const PAUSE_NOTE = { manual: 'Partida em pausa.', help: 'Partida em pausa.', hidden: 'Pausada ao sair da aba.', returned: 'Pausada ao sair da aba.', restored: 'Seu progresso foi recuperado.' };
function pop(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

// Uma única camada visível por vez. O conteúdo do jogo fica inerte quando há tela aberta.
let screenKey = null;
function syncScreens() {
  const under = S.status === 'home' ? 'home'
    : S.confirm ? 'confirm' : S.hold === 'countdown' ? 'count' : S.hold === 'paused' ? 'pause' : (isOver() && S.endOpen) ? 'end' : '';
  for (const [name, el] of Object.entries(ui.screens)) {
    el.classList.toggle('is-open', name === under);
    el.inert = name !== under;
  }
  ui.body.inert = under !== '';
  if (under !== screenKey) { const first = screenKey === null; screenKey = under; hideTip(); if (!first) focusPrimary(under); }
}
function focusPrimary(name) {
  const scr = ui.screens[name];
  const el = scr && [...scr.querySelectorAll('[data-primary]')].find((b) => !b.hidden);
  if (el) el.focus({ preventScroll: true });
  else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}


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
  ui.modeLabel.textContent = 'Nível'; ui.modeValue.textContent = NAMES[S.level];
  ui.levels.forEach((el) => { const on = el.dataset.level === S.level; el.setAttribute('aria-checked', on); el.tabIndex = on ? 0 : -1; });
  ui.flagBtn.setAttribute('aria-pressed', S.flagMode);
  ui.game.classList.toggle('is-flag-mode', S.flagMode); ui.game.classList.toggle('is-over', isOver()); ui.game.classList.toggle('is-away', isAway());
  const canPause = (S.status === 'ready' || S.status === 'playing') && !S.hold, reopen = isOver() && !S.endOpen;   // fim de jogo: o botão reabre o menu final
  ui.pauseBtn.disabled = !(canPause || reopen);
  ui.pauseBtn.dataset.tip = reopen ? 'Abrir o menu da partida' : 'Pausar a partida';
  ui.pauseBtn.setAttribute('aria-label', reopen ? 'Abrir menu da partida' : 'Pausar partida');
  ui.pauseTime.textContent = fmt(elapsedNow()); ui.pauseMines.textContent = String(S.mines - S.flags);
  ui.pauseNote.textContent = PAUSE_NOTE[S.pauseReason] || PAUSE_NOTE.manual;
  ui.chip.hidden = !(S.pauseReason === 'restored' || S.pauseReason === 'returned');
  ui.muteBtn.classList.toggle('is-muted', S.muted); ui.muteBtn.setAttribute('aria-pressed', S.muted);
  ui.muteBtn.setAttribute('aria-label', S.muted ? 'Ativar efeitos sonoros' : 'Silenciar efeitos sonoros');
  ui.muteBtn.dataset.tip = S.muted ? 'Ativar efeitos' : 'Silenciar efeitos';
  ui.status.textContent = isAway() ? '' : S.hold ? 'Partida pausada.' : {
    ready: 'Clique em uma casa para começar. O primeiro clique é sempre seguro.',
    playing: S.flagMode ? 'Modo bandeira: toque numa casa fechada para marcar ou desmarcar.' : 'Revele as casas seguras. Botão direito (ou modo bandeira) marca minas.',
    won: `Vitória em ${fmt(S.elapsed)}.`, lost: 'Derrota: você revelou uma mina.',
  }[S.status];
  if (isAway()) {
    const best = store.getBestTime(S.level);
    ui.homeInfo.textContent = best === null ? 'Partidas sem fim' : `Melhor tempo (${NAMES[S.level]}): ${fmt(best)}`;
  }
  syncScreens();
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
  if (!S.rows) return;
  const cs = getComputedStyle(ui.arena);
  const arenaW = ui.arena.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight);
  const arenaH = ui.arena.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom);
  const chrome = Math.ceil(boxX(ui.game) + boxX(ui.frame));
  // Candidatos em ordem de preferência: natural > girado (só tabuleiro largo)
  const opts = [];
  for (const tr of (S.cols > S.rows ? [false, true] : [false])) {
    const n = tr ? S.rows : S.cols;
    opts.push({ tr, n, fit: fitCell(arenaW - chrome, n) });
  }
  const pick = opts.find((o) => o.fit >= MIN_TOUCH) || opts.reduce((a, b) => (b.fit > a.fit ? b : a));
  if (pick.tr !== S.transposed) { S.transposed = pick.tr; orderGrid(); S.els.forEach((el) => { el._k = null; }); render(); }
  const dcols = pick.n, drows = pick.tr ? S.cols : S.rows;
  applyCell(Math.max(MIN_FIT, Math.min(pick.fit, CELL_MAX)), dcols, chrome);    // medida provisória para ler a altura dos demais elementos
  const other = ui.game.offsetHeight - ui.grid.offsetHeight;
  const heightFit = Math.floor((arenaH - other - (drows - 1)) / drows);
  let size = Math.max(MIN_FIT, Math.min(pick.fit, Math.max(Math.min(CELL_MAX, heightFit), COMFORT)));
  applyCell(size, dcols, chrome);
  // Verificação: se mesmo assim o quadro rolar na horizontal (arredondamento/zoom), encolhe 1px até caber
  for (let g = 0; g < 8 && size > MIN_FIT && ui.field.scrollWidth > ui.field.clientWidth; g++) applyCell(--size, dcols, chrome);
}

/* ===== Pausa e contagem regressiva =====
   Pausar congela o tempo e bloqueia jogadas. Continuar nunca volta direto ao jogo: 3 → 2 → 1 → GO!, e só então libera. */
let countTimer = 0, helpOpen = false, helpFrom = null;
function pauseGame(reason) {
  if (S.hold === 'countdown') cancelCountdown();
  else if (S.hold || (S.status !== 'playing' && S.status !== 'ready')) return;
  if (S.status === 'playing' && !S.hold) S.elapsed = performance.now() - S.t0;
  S.hold = 'paused'; S.pauseReason = reason;
  if (reason === 'manual') Sound.pause();
  render(); saveGame();
}
function startCountdown() {
  if (S.hold !== 'paused' || helpOpen || S.confirm) return;
  S.hold = 'countdown'; S.pauseReason = null; render();
  let i = 0;
  const step = () => {
    if (S.hold !== 'countdown') return;
    const last = i === COUNTDOWN.length - 1;
    ui.countNum.textContent = COUNTDOWN[i]; ui.countNum.classList.toggle('is-go', last); pop(ui.countNum, 'tick');
    if (last) Sound.go(); else Sound.tick();
    countTimer = window.setTimeout(() => {
      countTimer = 0;
      if (S.hold !== 'countdown') return;
      if (!last) { i++; step(); return; }
      S.hold = null;
      if (S.status === 'playing') S.t0 = performance.now() - S.elapsed;   // o relógio recomeça de onde parou
      render(); saveGame();
    }, last ? GO_MS : COUNT_MS);
  };
  step();
}
function cancelCountdown() { clearTimeout(countTimer); countTimer = 0; }
function onPauseButton() {
  if (isOver()) { S.endOpen = true; render(); return; }
  pauseGame('manual');
}

/* ===== Ajuda "Como jogar": MODAL sobreposto à tela atual. Abrir pausa a partida (se houver uma rodando) e fechar NÃO retoma.
   Enquanto aberto, o resto da página fica inerte; só o corpo do modal rola. ===== */
function syncHelp() {
  ui.help.classList.toggle('is-open', helpOpen); ui.help.inert = !helpOpen;
  ui.arena.inert = helpOpen; ui.topbar.inert = helpOpen;
  ui.helpButton.setAttribute('aria-expanded', helpOpen);
  hideTip();
}
function openHelp() {
  if (helpOpen) return;
  if (S.hold === 'countdown' || (!S.hold && (S.status === 'playing' || S.status === 'ready'))) pauseGame('help');
  helpFrom = document.activeElement; helpOpen = true; ui.helpBody.scrollTop = 0; Sound.click(); syncHelp();
  const b = ui.help.querySelector('.modal-foot [data-primary]'); if (b) b.focus({ preventScroll: true });
}
function closeHelp() {
  if (!helpOpen) return;
  helpOpen = false; syncHelp();
  if (helpFrom && helpFrom.isConnected && !helpFrom.closest('[inert]') && helpFrom !== document.body) helpFrom.focus({ preventScroll: true });
  helpFrom = null;
}

/* ===== Tooltip dos controles (um único #tip; sem `title` nativo) =====
   Mouse: espera --tip-delay (0,3 s); sair/clicar esconde na hora. Teclado (focus-visible): mostra na hora.
   Toque (só nos controles): segurar o botão (~0,45 s) mostra a dica sem acionar o botão. Abaixo do botão se couber; senão, acima. */
const TIP = { gap: 10, edge: 8, longPressMs: 450, touchHideMs: 1600 };
let tipBtn = null, tipTimer = 0, tipHideTimer = 0, longPressed = false;
const tipDelay = () => {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--tip-delay').trim(), n = parseFloat(v);
  return Number.isFinite(n) ? (/ms$/.test(v) ? n : n * 1000) : 300;
};
function showTip(btn) {
  clearTimeout(tipTimer); clearTimeout(tipHideTimer);
  if (!btn.dataset.tip || btn.disabled || btn.closest('[inert]')) return;
  if (tipBtn && tipBtn !== btn) tipBtn.removeAttribute('aria-describedby');
  tipBtn = btn;
  ui.tipText.textContent = btn.dataset.tip;
  ui.tipKey.textContent = btn.dataset.key || ''; ui.tipKey.hidden = !btn.dataset.key;
  btn.setAttribute('aria-describedby', 'tip');
  const tip = ui.tip, r = btn.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  tip.style.left = '0px'; tip.style.top = '0px';
  const w = tip.offsetWidth, h = tip.offsetHeight;
  const left = Math.round(Math.max(TIP.edge, Math.min(r.left + r.width / 2 - w / 2, vw - TIP.edge - w)));
  const below = vh - r.bottom - TIP.gap - TIP.edge >= h;
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
function bindTip(btn, touch = true) {
  btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'touch') return; clearTimeout(tipTimer); tipTimer = setTimeout(() => showTip(btn), tipDelay()); });
  btn.addEventListener('pointerleave', hideTip);
  btn.addEventListener('pointerdown', (e) => {
    hideTip();
    if (!touch || e.pointerType !== 'touch') return;
    longPressed = false;
    tipTimer = setTimeout(() => { longPressed = true; showTip(btn); }, TIP.longPressMs);
  });
  const endPress = () => { clearTimeout(tipTimer); if (longPressed) tipHideTimer = setTimeout(hideTip, TIP.touchHideMs); };
  btn.addEventListener('pointerup', endPress); btn.addEventListener('pointercancel', endPress);
  btn.addEventListener('focus', () => { if (btn.matches(':focus-visible')) showTip(btn); });
  btn.addEventListener('blur', hideTip); btn.addEventListener('click', hideTip);
}
function initTips() {
  document.querySelectorAll('.tools [data-tip]').forEach((btn) => bindTip(btn));
  // Segurar no toque só mostra a dica: o clique que vem depois do long-press não aciona o botão.
  ui.tools.addEventListener('click', (e) => { if (!longPressed) return; longPressed = false; e.preventDefault(); e.stopPropagation(); }, true);
  window.addEventListener('resize', hideTip);
}

/* ===== Entradas ===== */
const cellIndex = (e) => { const t = e.target.closest && e.target.closest('.cell'); return t ? Number(t.dataset.i) : -1; };
function setFlagMode(on) { S.flagMode = on; Sound.flagMode(on); render(); }
function init() {
  const saved = store.getLevel();
  S.level = DIFFICULTIES[saved] ? saved : DEFAULT_LEVEL;
  document.querySelectorAll('.mini').forEach((m) => { const n = Number(m.dataset.n); m.style.setProperty('--n', n); m.innerHTML = '<i></i>'.repeat(n * n); });   // miniatura n×n (a última peça é a mina)
  initTips();
  // Partida salva (F5): volta PAUSADA, esperando o jogador. Sem partida salva, começa na tela inicial, tudo parado.
  S.status = 'home'; build(DIFFICULTIES.easy);
  if (!restoreGame()) { S.status = 'home'; render(); }
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
  const ACTIONS = {
    start: () => { Sound.click(); beginGame(); }, resume: startCountdown, new: newGame, home: () => { Sound.back(); leaveGame(); },
    'confirm-yes': () => answerConfirm(true), 'confirm-no': () => answerConfirm(false),
    help: openHelp, mute: toggleMute, pause: onPauseButton, flag: () => setFlagMode(!S.flagMode),
    view: () => { S.endOpen = false; render(); },
  };
  ui.game.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const fn = ACTIONS[t.dataset.action]; if (fn) fn();
    if (e.detail > 0 && document.activeElement === t) t.blur();   // clique/toque: Space não deve acionar o botão depois
  });
  ui.help.addEventListener('click', (e) => { if (e.target.closest('[data-action="help-close"]')) closeHelp(); });
  ui.levels.forEach((el) => el.addEventListener('click', (e) => {      // dificuldade: só escolhe; o tabuleiro é montado ao tocar em Jogar
    chooseLevel(el.dataset.level);
    if (e.detail > 0) el.blur();                                       // clique: Space depois inicia o jogo, não reaciona o nível
  }));
  ui.levelGroup.addEventListener('keydown', (e) => {                   // setas movem a seleção (radiogroup com tabindex móvel)
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!step || S.status !== 'home') return;
    e.preventDefault();
    const next = ui.levels[(ui.levels.findIndex((el) => el.dataset.level === S.level) + step + ui.levels.length) % ui.levels.length];
    chooseLevel(next.dataset.level); next.focus({ preventScroll: true });
  });
  document.addEventListener('pointerdown', () => Sound.unlock());
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Escape') {
      hideTip();
      if (helpOpen) closeHelp();
      else if (S.confirm) answerConfirm(false);
      else if (S.hold === 'countdown' || (!S.hold && (S.status === 'playing' || S.status === 'ready'))) pauseGame('manual');
      else if (S.endOpen) { S.endOpen = false; render(); }
      return;
    }
    if (e.repeat || helpOpen) return;                  // com a ajuda aberta, só Esc
    if (e.code === 'Space') {
      if (e.target.closest && e.target.closest('button')) return;   // deixa o botão focado agir
      e.preventDefault();
      if (S.status === 'home') { Sound.click(); beginGame(); } else if (S.hold === 'paused' && !S.confirm) startCountdown();
    }
    else if (isAway() || S.confirm) return;            // M, R, F e P só valem durante a partida
    else if (e.code === 'KeyM') toggleMute();
    else if (e.code === 'KeyR') newGame();
    else if (e.code === 'KeyF') setFlagMode(!S.flagMode);
    else if (e.code === 'KeyP') { if (S.hold === 'paused') startCountdown(); else pauseGame('manual'); }
  });
  window.addEventListener('resize', sizeBoard);
  if (window.ResizeObserver) { let raf = 0; new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(sizeBoard); }).observe(ui.arena); }
  window.addEventListener('orientationchange', sizeBoard);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', sizeBoard);
  let ticks = 0;
  setInterval(() => {
    if (S.status !== 'playing' || S.hold) return;
    ui.time.textContent = fmt(elapsedNow());
    if (++ticks * 250 >= SAVE_EVERY_MS) { ticks = 0; saveGame(); }
  }, 250);
  window.addEventListener('pagehide', saveGame);
  window.addEventListener('beforeunload', saveGame);
  // Saiu da aba / minimizou: pausa e salva. Voltou: continua pausada, com "Partida retomada", esperando o jogador.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pauseGame('hidden'); saveGame(); }
    else if (S.hold === 'paused' && !helpOpen && !S.confirm) { S.pauseReason = 'returned'; render(); focusPrimary('pause'); }
  });
}
init();
window.__campo = { S, DIFFICULTIES, beginGame, chooseLevel, startRound, goHome, reveal, toggleFlag, neighbors, sizeBoard, saveGame, restoreGame, pauseGame, startCountdown };