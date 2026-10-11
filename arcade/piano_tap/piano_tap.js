/* ==========================================================================
arcade/piano_tap/piano_tap.js - Jogo de reflexos com teclas de piano em HTML5 Canvas + JavaScript puro.
Índice: 1 Configuração · 2 Áudio · 3 Estado · 4 Lógica (4b Pausa, contagem e salvamento) · 5 Efeitos
· 6 Renderização · 7 Interface (7b Estrelas, progresso, acertos e menu) · 8 Entrada · 9 Redimensionamento · 10 Loop
Unidades do mundo: 1 = largura de uma coluna. O tabuleiro tem 4 x 6 unidades.
Arquivos: piano_tap_storage.js (persistência) · piano_tap_levels.js (fases, estrelas e pontuação) · este arquivo (jogo e interface).
Fluxo: HOME (Toque para iniciar) -> MODE (Fases ou Infinito) -> MENU (escolha da fase, só em Fases) -> partida.
Dois modos: 'level' (fases 1..30, com meta, barra de progresso e estrelas) e 'infinite' (sem fim).
========================================================================== */
(() => {
'use strict';

/* ===== 1. CONFIGURAÇÃO ===== */
const CONFIG = {
  cols: 4, viewRows: 4, rowHeight: 1.5,         // 4 fileiras visíveis, cada uma com 1,5 unidade de altura
  leadBlank: 2,                                  // fileiras brancas iniciais (a 1ª preta chega com folga)
  speedEase: 3,                                  // suavidade com que a velocidade real segue a velocidade-alvo (a curva vem de piano_tap_levels.js)
  maxStep: 0.02, maxFrame: 0.1,                  // passo fixo máximo da simulação e limite de dt por quadro (s)
  historySize: 6, maxCol: 100, minCol: 24, margin: 14, restartLock: 500,
  volume: 0.3,
  countFrom: 3, countStep: 0.7, goFlash: 0.6,   // contagem 3·2·1 (s por número) e quanto tempo o "GO!" fica na tela
  holdsOnDesktop: true,                          // tecla longa (segurar) também no teclado/mouse (chances e fases vêm de piano_tap_levels.js)
  holdMinMs: 0,                                  // tecla longa: 0 = soltar cedo nunca encerra a partida (>0 = ms mínimos segurando)
  // (sem fileiras vazias no meio: leadBlank é só a folga inicial)
  winDelay: 0.6,                                 // pausa (s) entre tocar a última tecla da fase e mostrar a tela de fase concluída
  saveVersion: 3, saveEvery: 250,              // formato do salvamento (piano_tap:save) e intervalo mínimo entre gravações em jogo (ms)
};
const COLORS = {
  neon: '#a99cff', violet: '#9d8cff', violetSoft: '#e9e6ff', berry: '#ff4f7b', gold: '#ffc857', ink: '#120f2a',
};
const { cols: COLS, rowHeight: ROW_H } = CONFIG;
const VIEW_H = CONFIG.viewRows * ROW_H;
const KEYS = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
const STATES = { HOME: 'home', MODE: 'mode', MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', COUNTDOWN: 'countdown', OVER: 'over' };
const Levels = PianoTapLevels;
const STAR_PATH = 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.2 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z';
const starSvg = (cls) => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${STAR_PATH}"/></svg>`;
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
    star() { play(() => [784, 1175, 1568].forEach((f, i) => tone({ type: 'triangle', from: f, duration: 0.16, volume: 0.3, delay: 0.07 * i }))); },
    win() { play(() => [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ type: 'triangle', from: f, duration: 0.22, volume: 0.35, delay: 0.1 * i }))); },
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
  state: STATES.HOME, time: 0, offset: 0, speed: 0,
  mode: 'infinite', level: 0, cfg: Levels.infinite(), progress: PianoTapStorage.getLevels(),   // modo ('level' | 'infinite') · fase · parâmetros da partida · estrelas e recordes salvos
  done: 0, spawned: 0, stars: 0, finishLeft: null,   // teclas tocadas · teclas geradas · estrelas conquistadas · contagem até a tela de vitória
  rows: [], nextN: 0, history: [],
  score: 0, startBest: 0, best: PianoTapStorage.getBest(), newRecord: false,
  noteIndex: 0, combo: 0, particles: [], glows: [], holds: new Map(), touchMode: false,
  wrong: null, missRow: null, missTile: null, endReason: '', overAt: 0,
  pauseReason: 'manual', countdown: null, goFlash: 0,   // pausa: motivo · contagem em curso ({ t, shown }) · tempo restante do "GO!"
};

const ui = {
  play: document.getElementById('play'), arena: document.getElementById('arena'), board: document.getElementById('board'),
  scoreLive: document.getElementById('score-live'), combo: document.getElementById('combo'),
  pauseScore: document.getElementById('pause-score'), pauseBest: document.getElementById('pause-best'),
  pauseScoreRow: document.getElementById('pause-score-row'), pauseBestRow: document.getElementById('pause-best-row'),
  overFinal: document.getElementById('over-final'), overBestRow: document.getElementById('over-best-row'),
  pause: document.getElementById('pause-button'), mute: document.getElementById('mute-button'),
  start: document.getElementById('start-button'), resume: document.getElementById('resume-button'), restart: document.getElementById('restart-button'),
  overTitle: document.getElementById('over-title'), overReason: document.getElementById('over-reason'),
  overScore: document.getElementById('over-score'), overBest: document.getElementById('over-best'),
  badge: document.getElementById('record-badge'), toast: document.getElementById('toast'),
  frame: document.getElementById('frame'), helpButton: document.getElementById('help-button'),
  helpPopover: document.getElementById('help-popover'), helpClose: document.getElementById('help-close'),
  restartPause: document.getElementById('restart-pause-button'), pauseTitle: document.getElementById('pause-title'), pauseNote: document.getElementById('pause-note'),
  count: document.getElementById('count-screen'), countNum: document.getElementById('count-num'),
  modeLabel: document.getElementById('mode-label'), rating: document.getElementById('rating'),
  progressFill: document.getElementById('progress-fill'), progressRail: document.querySelector('#progress .progress-rail'),
    overScreen: document.getElementById('over-screen'), overStars: document.getElementById('over-stars'), replay: document.getElementById('replay-button'),
  menuOver: document.getElementById('menu-over-button'), menuPause: document.getElementById('menu-pause-button'),
  menuGrid: document.getElementById('menu-grid'), menuPrev: document.getElementById('menu-prev'), menuNext: document.getElementById('menu-next'),
  menuPage: document.getElementById('menu-page'), menuBack: document.getElementById('menu-back'),
  modeBack: document.getElementById('mode-back'), modeLevels: document.getElementById('mode-levels'), modeInfinite: document.getElementById('mode-infinite'),
  modeLevelsInfo: document.getElementById('mode-levels-info'), modeInfInfo: document.getElementById('mode-inf-info'),
  homePause: document.getElementById('home-pause-button'), homeOver: document.getElementById('home-over-button'),
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

// Velocidade-alvo depende só de quantas teclas já foram tocadas (curva da fase ou do modo infinito, em piano_tap_levels.js).
// A velocidade real a segue suavemente (sem saltos).
function targetSpeed() { return game.cfg.speedAt(game.done); }

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

function pushBlank(n) { game.rows.push({ n, len: 1, tiles: [] }); game.nextN = n + 1; }

// Gera a próxima fileira. Numa fase, depois de gerar a meta inteira (cfg.goal), só saem fileiras vazias.
function pushRow() {
  const n = game.nextN, cfg = game.cfg, left = cfg.goal - game.spawned;
  if (left <= 0 || n < CONFIG.leadBlank) return pushBlank(n);
  // Toda fileira depois das fileiras brancas iniciais (leadBlank) tem exatamente 1 tecla: sem espaços vazios no meio.
  // Regra: 1 tecla por fileira. (Duplas só existiriam no CELULAR/infinito se cfg.doubleChance > 0; hoje é 0 em piano_tap_levels.js.)
  const two = game.mode === 'infinite' && game.touchMode && game.spawned >= cfg.doubleFrom && Math.random() < cfg.doubleChance;
  const hold = !two && (CONFIG.holdsOnDesktop || game.touchMode) && game.spawned >= cfg.holdFrom && Math.random() < cfg.holdChance;
  const len = !hold ? 1 : (game.spawned >= cfg.holdLongFrom && Math.random() < cfg.holdLongChance ? 3 : 2);
  const cols = [pickColumn()];
  if (two) cols.push(pickColumn(cols[0]));
  cols.sort((a, b) => a - b);
  for (const c of cols) game.history.push(c);
  while (game.history.length > CONFIG.historySize) game.history.shift();
  game.rows.push({ n, len, tiles: cols.map((c) => ({ c, s: 0, hitAt: 0 })) });
  game.nextN = n + len;
  game.spawned += cols.length;
}

// Mantém fileiras suficientes para cobrir o tabuleiro até acima do topo.
function fillRows() {
  while (!game.rows.length || rowTop(game.rows[game.rows.length - 1]) > -ROW_H) pushRow();
}

// Recorde mostrado no placar: da fase (salvo em game.progress) ou do modo infinito.
const bestFor = (mode, level) => (mode === 'level' ? game.progress.scores[level - 1] || 0 : PianoTapStorage.getBest());
// Dificuldade por dispositivo: no teclado/mouse (sem toque) o jogo é um pouco mais lento e com mais respiros.
const cfgFor = (mode, level, touch = detectTouch()) => (mode === 'level' ? Levels.get(level, !touch) : Levels.infinite(!touch));

// Prepara uma partida nova (da fase/modo indicados; sem argumentos repete a atual). Quem chama decide o que vem depois (startGame).
function resetRound(mode = game.mode, level = game.level) {
  const lv = mode === 'level' ? Math.max(1, Math.min(Levels.COUNT, level || 1)) : 0;
  const touch = detectTouch(), cfg = cfgFor(mode, lv, touch), best = bestFor(mode, lv);
  Object.assign(game, {
    mode, level: lv, cfg, best, done: 0, spawned: 0, stars: 0, finishLeft: null,
    offset: VIEW_H - ROW_H, speed: cfg.speedAt(0), rows: [], nextN: 0, history: [],
    score: 0, startBest: best, newRecord: false, noteIndex: 0, combo: 0,
    particles: [], glows: [], holds: new Map(), touchMode: touch,
    wrong: null, missRow: null, missTile: null, endReason: '', countdown: null, goFlash: 0, pauseReason: 'manual',
  });
  fillRows();
  ui.board.classList.remove('hit', 'shake');
  ui.count.classList.remove('go');
  PianoTapStorage.clearGame();            // partida nova = nenhuma partida antiga a recuperar
  updateScore(false);
  syncRunUI();
}

function startGame() {
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
  // Fase: meta cumprida (e nenhuma tecla longa ainda sendo segurada) => fase concluída, após uma pequena pausa.
  if (game.mode === 'level' && game.done >= game.cfg.goal && !game.rows.some((r) => r.tiles.some((t) => t.s === 1))) {
    if (game.finishLeft === null) game.finishLeft = CONFIG.winDelay;
    game.finishLeft -= dt;
    if (game.finishLeft <= 0) winRound();
  }
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

// Soma pontos, atualiza o placar e trata o recorde (usado pelo toque e pelos extras da tecla longa).
function gainPoints(n) {
  game.score += n;
  updateScore(true);
  if (game.mode === 'infinite' && game.startBest > 0 && game.score > game.startBest) {   // "recorde" só existe no modo infinito
    const first = !game.newRecord;
    game.newRecord = true;
    if (first) { showToast('Novo recorde!'); Sound.record(); }
  }
  if (game.score > game.best) {
    game.best = game.score;
    if (game.mode === 'infinite') PianoTapStorage.setBest(game.best);   // nas fases o recorde é gravado ao conquistar estrela / terminar (commitLevel)
  }
}

function hitTile(row, t, id) {
  t.hitAt = game.time;
  t.s = row.len > 1 ? 1 : 2;
  if (t.s === 1) { t.o0 = game.offset; t.pressMs = performance.now(); game.holds.set(id, { row, tile: t }); }   // o brilho começa a encher AGORA
  // Avaliação: quanto mais baixa (mais perto da linha vermelha) a borda de baixo da tecla na hora do toque, mais pontos.
  const rating = Levels.rate(rowBottom(row) / VIEW_H), pts = Levels.points(rating);
  Sound.note(MELODY[game.noteIndex++ % MELODY.length]);
  const cx = t.c + 0.5, cy = rowBottom(row) - ROW_H / 2;
  burst(cx, cy, rating === 'perfect' ? 14 : 10, [COLORS.violet, '#c7bdff', COLORS.gold]);
  game.glows.push({ c: t.c, y: cy, age: 0, life: 0.4 });
  game.combo = rating === 'perfect' ? game.combo + 1 : 0;   // combo: sequência de acertos Perfeitos; qualquer outro acerto zera
  showRating(rating);
  game.done++;
  gainPoints(pts);
  updateProgress(true);
}

// Tecla longa que encheu até o fim: bônus máximo (depende do tamanho da tecla).
function completeHold(row, t) {
  t.s = 2; t.f = 1;
  for (const [id, h] of game.holds) if (h.tile === t) game.holds.delete(id);
  const cx = t.c + 0.5, cy = Math.min(rowBottom(row) - ROW_H / 2, VIEW_H - 0.5), pts = Levels.holdBonus(row.len);
  burst(cx, cy, 8, [COLORS.gold, '#fff', COLORS.violet]);
  game.glows.push({ c: t.c, y: cy, age: 0, life: 0.4 });
  Sound.hold();
  gainPoints(pts);
}

// Soltou o dedo/tecla antes de encher: a tecla fica INCOMPLETA (s = 3, com o enchimento congelado) e os pontos extras
// são proporcionais ao que encheu (bônus máximo x fração enchida, arredondado para baixo). Só encerra a partida se holdMinMs > 0.
function dropHold(row, t) {
  const frac = Math.max(0, Math.min((game.offset - t.o0) / holdNeed(row), 1));
  t.s = 3; t.f = frac;
  const pts = Math.floor(frac * Levels.holdBonus(row.len));
  if (pts > 0) {
    const cx = t.c + 0.5, cy = Math.min(rowBottom(row) - ROW_H / 2, VIEW_H - 0.5);
    Sound.hold();
    gainPoints(pts);
  }
}

function releaseInput(id) {
  const h = game.holds.get(id);
  if (!h) return;
  game.holds.delete(id);
  if (game.state !== STATES.PLAYING || h.tile.s !== 1) return;
  if (CONFIG.holdMinMs > 0 && performance.now() - h.tile.pressMs < CONFIG.holdMinMs) endRound('release', h);
  else dropHold(h.row, h.tile);
}

// Pausa/reinício: ninguém está mais segurando nada, então é como soltar: as teclas longas em andamento ficam incompletas.
function releaseAllHolds() {
  for (const r of game.rows) for (const t of r.tiles) if (t.s === 1) dropHold(r, t);
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
  commitLevel();
  setState(STATES.OVER);
}

// Fase concluída: a barra chegou a 100% (3 estrelas). Comemora e mostra a tela de vitória.
function winRound() {
  if (game.state !== STATES.PLAYING) return;
  game.endReason = 'win';
  game.holds.clear();
  game.stars = 3;
  for (let i = 0; i < 4; i++) burst(0.6 + Math.random() * 2.8, 1 + Math.random() * 3.5, 14, [COLORS.gold, '#fff', COLORS.violet, COLORS.berry]);
  Sound.win();
  game.overAt = performance.now();
  game.goFlash = 0; ui.count.classList.remove('go');
  PianoTapStorage.clearGame();
  commitLevel();
  setState(STATES.OVER);
}

// Grava no storage as estrelas e o recorde da fase atual (só sobem). No modo infinito não faz nada (o recorde já é gravado na hora).
function commitLevel() {
  if (game.mode !== 'level') return;
  game.progress = PianoTapStorage.setLevelResult(game.level, game.stars, game.score);
}

// Pequena trava após a derrota para um toque acidental de jogo rápido não acionar um botão da tela de fim.
function overLocked() { return game.state === STATES.OVER && performance.now() - game.overAt < CONFIG.restartLock; }

function restart() {
  if (overLocked()) return;
  Sound.unlock(); Sound.click();
  resetRound();
  startGame();
}

// Botão principal da tela de fim: "Próxima fase" (após vencer) ou "Jogar novamente".
function overPrimary() {
  if (overLocked()) return;
  if (game.endReason === 'win' && game.mode === 'level' && game.level < Levels.COUNT) launch('level', game.level + 1);   // próxima fase, direto
  else restart();
}

// Escolheu uma fase (ou o infinito): vai direto para o jogo.
function launch(mode, level) {
  Sound.unlock(); Sound.click();
  resetRound(mode, level);
  startGame();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}

// Sai da partida em andamento (as estrelas já conquistadas ficam salvas).
function leaveRun() {
  closeHelp();
  game.holds.clear(); game.countdown = null; game.goFlash = 0; game.finishLeft = null;
  ui.count.classList.remove('go');
  PianoTapStorage.clearGame();
}
function blurActive() { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }

// Da pausa ou do fim de jogo: lista de fases (só existe no modo Fases).
function goMenu() {
  if (overLocked()) return;
  Sound.unlock(); Sound.click();
  leaveRun();
  openMenu();
  blurActive();
}

// Da pausa ou do fim de jogo (fases e infinito): volta para a tela inicial ("Toque para iniciar").
function goHome() {
  if (overLocked()) return;
  Sound.unlock(); Sound.click();
  leaveRun();
  showHome();
  blurActive();
}

// Navegação das telas de abertura: HOME -> MODE -> MENU (e de volta).
function showHome() { setState(STATES.HOME); }
function openMode() {
  game.progress = PianoTapStorage.getLevels();
  const total = game.progress.stars.reduce((a, b) => a + b, 0);
  ui.modeLevelsInfo.textContent = `${total} de ${Levels.COUNT * 3} estrelas`;
  ui.modeInfInfo.textContent = `Recorde ${PianoTapStorage.getBest()}`;
  setState(STATES.MODE);
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
    mode: game.mode, level: game.level, done: game.done, spawned: game.spawned,
    offset: game.offset, speed: game.speed, time: game.time, nextN: game.nextN,
    touchMode: game.touchMode,
    rows: game.rows.map((r) => ({ n: r.n, len: r.len, tiles: r.tiles.map((t) => ({ c: t.c, s: t.s === 1 ? 3 : t.s, hitAt: t.hitAt, f: t.s === 1 ? Math.max(0, Math.min((game.offset - t.o0) / holdNeed(r), 1)) : (t.f || 0) })) })),
    history: game.history.slice(),
    score: game.score, startBest: game.startBest, newRecord: game.newRecord, noteIndex: game.noteIndex,
    particles: game.particles.map((p) => ({ ...p })), combo: game.combo,
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
  if (![s.offset, s.speed, s.time].every(num) || s.time < 0 || s.speed < 0 || s.speed > 20) return false;
  if (![s.score, s.startBest, s.noteIndex, s.done, s.spawned].every(nat) || !Number.isInteger(s.nextN)) return false;
  if (s.mode !== 'level' && s.mode !== 'infinite') return false;
  if (s.mode === 'level' && !(Number.isInteger(s.level) && s.level >= 1 && s.level <= Levels.COUNT)) return false;
  const cfg = cfgFor(s.mode, s.mode === 'level' ? s.level : 0, Boolean(s.touchMode));
  if (s.done > s.spawned || s.spawned > cfg.goal) return false;
  if (!Array.isArray(s.rows) || !s.rows.length || s.rows.length > 60) return false;
  const rows = [];
  for (let i = 0; i < s.rows.length; i++) {
    const r = s.rows[i];
    if (!r || !Number.isInteger(r.n) || !Number.isInteger(r.len) || r.len < 1 || r.len > 3 || !Array.isArray(r.tiles) || r.tiles.length > 2) return false;
    if (i && r.n !== s.rows[i - 1].n + s.rows[i - 1].len) return false;   // fileiras consecutivas
    const seen = new Set(), tiles = [];
    for (const t of r.tiles) {
      if (!t || !Number.isInteger(t.c) || t.c < 0 || t.c >= COLS || seen.has(t.c) || (t.s !== 0 && t.s !== 2 && t.s !== 3) || !num(t.hitAt)) return false;
      seen.add(t.c); tiles.push({ c: t.c, s: t.s, hitAt: Math.min(t.hitAt, s.time), f: t.s === 3 ? Math.max(0, Math.min(Number(t.f) || 0, 1)) : (t.s === 2 ? 1 : 0) });
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

  const level = s.mode === 'level' ? s.level : 0;
  Object.assign(game, {
    mode: s.mode, level, cfg, done: s.done, spawned: s.spawned, finishLeft: null,
    stars: Levels.starsAt(Math.min(1, s.done / cfg.goal)),     // recalculado a partir do progresso (no infinito a meta é infinita: 0)
    offset: s.offset, speed: s.speed, time: s.time, nextN: s.nextN, rows, history: s.history.slice(),
    score: s.score, startBest: s.startBest, newRecord: Boolean(s.newRecord), noteIndex: s.noteIndex, combo: nat(s.combo) ? s.combo : 0, particles,
    touchMode: Boolean(s.touchMode), glows: [], holds: new Map(),
    wrong: null, missRow: null, missTile: null, endReason: '', countdown: null, goFlash: 0, pauseReason: 'restored',
  });
  fillRows();
  game.best = Math.max(bestFor(s.mode, level), game.score);
  ui.board.classList.remove('hit', 'shake');
  ui.count.classList.remove('go');
  updateScore(false);
  syncRunUI();
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

// Tecla longa: o brilho sobe a partir do fundo da tecla desde o instante do toque (d = quanto ela já andou) e enche por
// completo quando d chega à altura da tecla. Segurando: brilho forte e contorno pulsando (dourado = já passou da metade).
// Solta antes de encher (s = 3): o enchimento fica congelado, mais apagado, mostrando que ficou incompleta.
function drawHolding(r, y, t) {
  const q = tileRect(t.c, y, r.len), held = t.s === 1, bottom = q.y + q.h;
  const frac = held ? Math.max(0, Math.min((game.offset - t.o0) / q.h, 1)) : t.f, d = frac * q.h;
  ctx.save(); rr(ctx, q.x, q.y, q.w, q.h, q.r); ctx.clip();
  if (d > 0) {
    const g = ctx.createLinearGradient(0, bottom - d, 0, bottom);
    g.addColorStop(0, held ? '#e9e6ff' : '#b7aef0'); g.addColorStop(1, held ? '#8f7cff' : '#6a5bd0');
    ctx.globalAlpha = held ? 0.92 : 0.75; ctx.fillStyle = g; ctx.fillRect(q.x, bottom - d, q.w, d); ctx.globalAlpha = 1;
  }
  ctx.restore();
  if (!held) return;
  ctx.strokeStyle = frac >= 0.5 ? COLORS.gold : '#e9e6ff';
  ctx.lineWidth = 0.045 + 0.015 * Math.sin(game.time * 14);
  rr(ctx, q.x, q.y, q.w, q.h, q.r); ctx.stroke();
}

function drawRow(r, y) {
  for (const t of r.tiles) {
    if (t.s === 2) { drawDone(r, y, t); continue; }
    ctx.drawImage(sprites.tile[r.len].idle, t.c, y, 1, r.len * ROW_H);
    if (t.s === 1 || t.s === 3) drawHolding(r, y, t);
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
  b.toggle('is-home', s === STATES.HOME); b.toggle('is-mode', s === STATES.MODE); b.toggle('is-playing', s === STATES.PLAYING);
  b.toggle('is-paused', s === STATES.PAUSED); b.toggle('is-countdown', s === STATES.COUNTDOWN); b.toggle('is-over', s === STATES.OVER);
  b.toggle('is-menu', s === STATES.MENU); b.toggle('is-infinite', game.mode === 'infinite'); b.toggle('is-level', game.mode === 'level' && ![STATES.HOME, STATES.MODE, STATES.MENU].includes(s));
  if (s === STATES.HOME || s === STATES.MODE || s === STATES.MENU) b.remove('hit', 'shake');   // nada de borda vermelha do fim de jogo nos menus
  updateModeLabel();
  ui.pause.disabled = s !== STATES.PLAYING && s !== STATES.COUNTDOWN;
  if (s === STATES.PAUSED || s === STATES.OVER) {   // "Fases" só existe no modo Fases; no infinito o botão de início ocupa a linha toda
    const lv = game.mode === 'level', label = lv ? 'Início' : 'Tela inicial';
    ui.menuPause.hidden = ui.menuOver.hidden = !lv;
    for (const b of [ui.homePause, ui.homeOver]) b.querySelector('.home-label').textContent = label;
  }
  if (s === STATES.PAUSED) {
    const copy = PAUSE_COPY[game.pauseReason] || PAUSE_COPY.manual;
    // Fases: só "Pontos" (não há recorde). Infinito: só "Recorde".
    ui.pauseScore.textContent = String(game.score); ui.pauseBest.textContent = String(game.best);
    ui.pauseScoreRow.hidden = game.mode !== 'level'; ui.pauseBestRow.hidden = game.mode !== 'infinite';
    ui.pauseTitle.textContent = copy.title;
    ui.pauseNote.textContent = copy.note; ui.pauseNote.hidden = !copy.note;
  }
  if (s === STATES.OVER) {
    const win = game.endReason === 'win', isLevel = game.mode === 'level', next = win && isLevel && game.level < Levels.COUNT;
    ui.overScreen.classList.toggle('is-win', win);
    ui.overTitle.textContent = win ? 'Fase concluída!' : 'Fim de jogo';
    ui.overReason.textContent = win ? 'Você tocou todas as teclas!' : game.endReason === 'white' ? 'Você tocou fora das teclas.' : game.endReason === 'release' ? 'Você soltou a tecla longa cedo demais. Segure um pouco mais.' : 'Uma tecla escapou.';
    ui.overStars.hidden = !isLevel;
    if (isLevel) fillStars(ui.overStars, game.stars);
    ui.restart.textContent = next ? 'Próxima fase' : 'Jogar novamente';
    ui.replay.hidden = !next;
    ui.overScore.textContent = String(game.score);
    ui.overBest.textContent = String(game.best);
    ui.badge.hidden = !(game.mode === 'infinite' && game.newRecord);
    ui.overFinal.hidden = game.mode !== 'level'; ui.overBestRow.hidden = game.mode !== 'infinite';   // fases: pontos · infinito: recorde
    ui.restart.focus({ preventScroll: true });
  }
  if (s === STATES.PAUSED) ui.resume.focus({ preventScroll: true });
}

/* ===== 7b. ESTRELAS, PROGRESSO, ACERTOS E MENU ===== */
function updateModeLabel() {
  const s = game.state;
  ui.modeLabel.textContent = s === STATES.HOME ? 'Tela inicial' : s === STATES.MODE ? 'Escolha o modo' : s === STATES.MENU ? 'Escolha a fase' : game.mode === 'level' ? `Fase ${game.level}` : 'Modo infinito';
}

// Linha de 3 estrelas (as n primeiras acesas).
function fillStars(el, n) {
  el.innerHTML = [0, 1, 2].map((i) => starSvg('star' + (i < n ? ' on' : ''))).join('');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `${n} de 3 estrelas`);
}

// Estrelas da barra de progresso: uma por item de PianoTapLevels.STAR_AT, posicionadas ao longo do trilho.
const barStars = [];
function buildProgressStars() {
  Levels.STAR_AT.forEach((at) => {
    const el = document.createElement('span');
    el.className = 'pstar'; el.style.left = `${at * 100}%`; el.innerHTML = starSvg('pstar-svg');
    ui.progressRail.append(el); barStars.push(el);
  });
}

// Enche a barra e acende as estrelas conforme as teclas tocadas / meta. Conquistar uma estrela toca o som e grava o progresso.
function updateProgress(animate) {
  if (game.mode !== 'level') return;
  const ratio = Math.min(1, game.done / game.cfg.goal);
  ui.progressFill.style.width = `${ratio * 100}%`;
  const stars = Levels.starsAt(ratio);
  barStars.forEach((el, i) => el.classList.toggle('on', i < stars));
  if (stars > game.stars) {
    game.stars = stars;
    if (animate) {
      if (!reduceMotion) pop(barStars[stars - 1], 'pop');
      Sound.star();
      commitLevel();
    }
  }
}

// Mensagem de acerto no topo: Legal / Ótimo / Perfeito (+ combo).
function showRating(key) {
  ui.rating.className = 'rating r-' + key;
  ui.rating.textContent = Levels.LABELS[key];
  pop(ui.rating, 'show');
  ui.combo.textContent = game.combo >= 2 ? `x${game.combo}` : '';   // combo ao lado da mensagem (só a partir de 2 Perfeitos seguidos)
  if (game.combo >= 2) pop(ui.combo, 'show'); else ui.combo.classList.remove('show');
}

// Atualiza tudo que depende da fase/modo atual (tela inicial, barra, placar, título).
function syncRunUI() {
  ui.rating.className = 'rating'; ui.combo.className = 'combo'; ui.combo.textContent = '';
  ui.progressFill.style.width = '0%';
  barStars.forEach((el) => el.classList.remove('on', 'pop'));
  updateProgress(false);
  updateModeLabel();
}

// Menu de fases (2 páginas de 15).
const MENU = { perPage: 15, page: 0 };
const LOCK_SVG = '<svg class="lv-lock" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

// Fase mais avançada já liberada (a fronteira do progresso): é nela que o menu abre e que ganha destaque.
function frontierLevel() {
  const st = game.progress.stars;
  let n = 1;
  while (n < Levels.COUNT && Levels.isUnlocked(n + 1, st)) n++;
  return n;
}

function buildMenu() {
  const st = game.progress.stars, total = Levels.COUNT, pages = Math.ceil(total / MENU.perPage), next = frontierLevel();
  MENU.page = Math.max(0, Math.min(MENU.page, pages - 1));
  const from = MENU.page * MENU.perPage, to = Math.min(total, from + MENU.perPage);
  ui.menuGrid.textContent = '';
  for (let n = from + 1; n <= to; n++) {
    const open = Levels.isUnlocked(n, st), got = st[n - 1] || 0;
    const b = document.createElement('button');
    b.type = 'button'; b.disabled = !open; b.dataset.level = String(n);
    b.className = 'lv' + (open ? '' : ' is-locked') + (n === next ? ' is-next' : '');
    b.setAttribute('aria-label', open ? `Fase ${n}, ${got} de 3 estrelas` : `Fase ${n}, bloqueada`);
    const num = document.createElement('span');
    num.className = 'lv-n';
    if (open) num.textContent = String(n); else num.innerHTML = LOCK_SVG;
    b.append(num);
    if (open) { const s = document.createElement('span'); s.className = 'stars'; fillStars(s, got); b.append(s); }
    ui.menuGrid.append(b);
  }
  ui.menuPage.textContent = `${MENU.page + 1} / ${pages}`;
  ui.menuPrev.disabled = MENU.page <= 0;
  ui.menuNext.disabled = MENU.page >= pages - 1;
}

function openMenu() {
  game.progress = PianoTapStorage.getLevels();
  MENU.page = Math.floor((frontierLevel() - 1) / MENU.perPage);   // abre na página da fase mais avançada
  buildMenu();
  setState(STATES.MENU);
}

function pop(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
// Pontuação ao vivo: aparece no topo do tabuleiro, logo acima da mensagem de acerto. O recorde só é mostrado na pausa e no fim de jogo.
function updateScore(animate) { ui.scoreLive.textContent = String(game.score); if (animate && !reduceMotion) pop(ui.scoreLive, 'bump'); }
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
const HELP = { gap: 12, edge: 8, maxWidth: 270, button: 40, side: 22, below: 22, ring: 14 };   // side/below = afastamento dos botões; ring = folga da moldura do tabuleiro
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
  if (e.code === 'Escape' && !e.repeat && (game.state === STATES.MENU || game.state === STATES.MODE)) {   // Esc volta uma tela
    e.preventDefault(); Sound.click();
    if (game.state === STATES.MENU) openMode(); else showHome();
    return;
  }
  if (e.code in KEYS) { e.preventDefault(); if (!e.repeat) keyTap(KEYS[e.code], 'k' + e.code); }
  else if (e.code === 'KeyM' && !e.repeat) toggleMute();
  else if ((e.code === 'KeyP' || e.code === 'Escape') && !e.repeat) setPaused(game.state === STATES.PLAYING || game.state === STATES.COUNTDOWN);
  else if (e.code === 'Space' || e.code === 'Enter') {
    if (e.target.closest && e.target.closest('button')) return;   // deixa o botão focado agir (início, continuar, jogar de novo, "?")
    e.preventDefault();
    if (game.state === STATES.HOME) { Sound.click(); openMode(); }
    else if (game.state === STATES.PAUSED) setPaused(false);
    else if (game.state === STATES.OVER) overPrimary();
  }
}

/* ===== 9. REDIMENSIONAMENTO ===== */
// O botão "?" fica fora do jogo: ao lado (reserva dos dois lados, para o jogo seguir centralizado) ou, se faltar
// largura, logo abaixo. Escolhe o formato que permite o maior tabuleiro.
function resize() {
  const m = CONFIG.margin, btn = ui.helpButton.offsetWidth || HELP.button;   // botões: 40px (36px em telas pequenas)
  const help = btn + HELP.side, below = btn + HELP.below + HELP.ring;
  const pw = ui.play.clientWidth - m * 2, ph = ui.play.clientHeight - m * 2;
  let best = null;
  for (const pos of ['side', 'below']) {
    const aw = pw - (pos === 'side' ? help * 2 : 0), ah = ph - (pos === 'below' ? below : 0);
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
  buildProgressStars();
  const saved = PianoTapStorage.loadGame();
  if (!(saved && restoreGame(saved))) showHome();   // sem salvamento válido: tela inicial (e descarta o lixo)
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
  ui.start.addEventListener('click', () => { Sound.unlock(); Sound.click(); openMode(); });
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
  ui.restartPause.addEventListener('click', restart);
  ui.restart.addEventListener('click', overPrimary);
  ui.replay.addEventListener('click', restart);
  ui.menuOver.addEventListener('click', goMenu);
  ui.menuPause.addEventListener('click', goMenu);
  ui.homeOver.addEventListener('click', goHome);
  ui.homePause.addEventListener('click', goHome);
  ui.menuBack.addEventListener('click', () => { Sound.click(); openMode(); });
  ui.modeBack.addEventListener('click', () => { Sound.click(); showHome(); });
  ui.modeLevels.addEventListener('click', () => { Sound.click(); openMenu(); });
  ui.modeInfinite.addEventListener('click', () => launch('infinite', 0));
  ui.menuGrid.addEventListener('click', (e) => { const b = e.target.closest('.lv'); if (b && !b.disabled) launch('level', Number(b.dataset.level)); });
  ui.menuPrev.addEventListener('click', () => { MENU.page--; Sound.click(); buildMenu(); });
  ui.menuNext.addEventListener('click', () => { MENU.page++; Sound.click(); buildMenu(); });
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
window.__pianoTap = { game, CONFIG, Levels, step, registerTap, keyTap, rowTop, rowBottom, releaseInput, resetRound, startGame, openMenu, openMode, launch };
})();