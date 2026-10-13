/* puzzle/water_sort/water_sort.js — regras e geração (puras) primeiro; interface e animação depois do marcador "UI". */
'use strict';

/* ===== Regras ===== */
const CAP = 4, MAX_COLORS = 12;
// Persistência: tudo passa por water_sort_storage.js (WaterSortStorage): unlocked = maior fase liberada, last = última fase jogada, muted,
// inf = nível alcançado no Modo Infinito, mode = último modo, e uma partida em andamento por modo.
/* O deslocamento do tubo até o destino, a inclinação e o jato são a própria mecânica de despejo. Com true, eles rodam mesmo
   quando o sistema pede "reduzir movimento" (que continua desligando balanço, ondulação, respingos e brilhos decorativos).
   Com false, quem usa esse ajuste vê só os níveis mudarem no lugar, sem o tubo se mover. */
const POUR_KEEPS_REDUCED_MOTION = true;

/* Modo Fases: 30 fases fixas, da mais fácil (3 cores) à mais difícil. Liberada = LEVELS_MAX + 1 significa "todas concluídas". */
const LEVELS_MAX = 30;
/* Modo Infinito: teto de 1000 níveis. Alcançado = INF_MAX + 1 significa "todos concluídos" (mesma convenção do Modo Fases). */
const INF_MAX = 1000;
function levelConfig(n) {
  const colors = Math.min(MAX_COLORS, 3 + Math.floor((n - 1) / 2));
  return { colors, empty: 2, moves: Math.min(220, 12 + n * 5 + colors * 4) };
}
/* Modo Infinito: começa em 4 cores (dificuldade padrão) e cada nível concluído aumenta a dificuldade aos poucos:
   +1 cor a cada 2 níveis até 12 e, depois disso, mais embaralhamento (o limite é alto, então segue ficando mais difícil). */
function infiniteConfig(n) {
  const colors = Math.min(MAX_COLORS, 4 + Math.floor((n - 1) / 2));
  return { colors, empty: 2, moves: Math.min(420, 22 + n * 6 + colors * 5) };
}
const modeConfig = (mode, n) => (mode === 'infinite' ? infiniteConfig(n) : levelConfig(n));
function topRun(t) {
  if (!t.length) return null;
  const color = t[t.length - 1]; let len = 0;
  for (let i = t.length - 1; i >= 0 && t[i] === color; i--) len++;
  return { color, len };
}
function planMove(tubes, from, to) {
  if (from === to) return null;
  const s = tubes[from], d = tubes[to];
  if (!s.length || d.length >= CAP) return null;
  const r = topRun(s);
  if (d.length && d[d.length - 1] !== r.color) return null;
  return { from, to, color: r.color, count: Math.min(r.len, CAP - d.length) };
}
function applyMove(tubes, m) { for (let i = 0; i < m.count; i++) tubes[m.to].push(tubes[m.from].pop()); }
const isPure = t => t.length === CAP && t.every(c => c === t[0]);
const isSolved = tubes => tubes.every(t => !t.length || isPure(t));
const copyTubes = tubes => tubes.map(t => t.slice());
const tubesKey = tubes => tubes.map(t => t.join('.')).join('|');
function validState(tubes, cfg) {
  if (!Array.isArray(tubes) || tubes.length !== cfg.colors + cfg.empty) return false;
  const count = new Array(cfg.colors).fill(0);
  for (const t of tubes) {
    if (!Array.isArray(t) || t.length > CAP) return false;
    for (const c of t) { if (!Number.isInteger(c) || c < 0 || c >= cfg.colors) return false; count[c]++; }
  }
  return count.every(n => n === CAP);
}

/* Embaralha por movimentos REVERSOS a partir do estado resolvido. Cada reverso é o inverso exato de uma
   jogada válida: destino vazio ou com topo de outra cor (a sequência movida fica exatamente com k unidades
   no topo) e origem que fica vazia ou com a mesma cor no topo (aceita a volta). Depois a solução é
   reproduzida com as regras reais do jogo para provar que existe caminho de volta. */
function scramble(cfg) {
  const tubes = [];
  for (let c = 0; c < cfg.colors; c++) tubes.push(new Array(CAP).fill(c));
  for (let i = 0; i < cfg.empty; i++) tubes.push([]);
  const rev = []; let last = null;
  for (let step = 0; step < cfg.moves; step++) {
    const cands = []; let total = 0;
    for (let s = 0; s < tubes.length; s++) {
      const S = tubes[s]; if (!S.length) continue;
      const r = topRun(S);
      for (let d = 0; d < tubes.length; d++) {
        if (d === s || (last && s === last.d && d === last.s)) continue;
        const D = tubes[d], room = CAP - D.length;
        if (!room || (D.length && D[D.length - 1] === r.color)) continue;
        for (let k = 1; k <= Math.min(r.len, room); k++) {
          const rest = S.length - k;
          if (rest === 0 || S[rest - 1] === r.color) { const w = D.length ? 4 : 1; cands.push({ s, d, k, w }); total += w; }
        }
      }
    }
    if (!cands.length) break;
    let x = Math.random() * total, pick = cands[cands.length - 1];
    for (const c of cands) { x -= c.w; if (x < 0) { pick = c; break; } }
    for (let i = 0; i < pick.k; i++) tubes[pick.d].push(tubes[pick.s].pop());
    rev.push(pick); last = pick;
  }
  const check = copyTubes(tubes);
  for (let i = rev.length - 1; i >= 0; i--) {
    const m = planMove(check, rev[i].d, rev[i].s);
    if (!m || m.count !== rev[i].k) return null;
    applyMove(check, m);
  }
  return isSolved(check) ? { tubes, steps: rev.length } : null;
}
const mixScore = tubes => tubes.reduce((a, t) => a + t.reduce((n, c, i) => n + (i && t[i - 1] !== c ? 1 : 0), 0), 0);

const recentKeys = [];
/* Gerador pseudoaleatório com semente (mulberry32): mesma semente, mesma sequência. */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/* Modo Fases: a fase n é SEMPRE a mesma (semente = número da fase), então a progressão é fixa e igual para todo mundo.
   Modo Infinito: cada nível é sorteado (e depois salvo pelo jogo, para poder ser rejogado igual). */
function generateLevel(n, mode) {
  const fixed = mode !== 'infinite', realRandom = Math.random;
  if (fixed) Math.random = seededRandom((Math.imul(n, 2654435761) ^ 0x9E3779B9) >>> 0);   // escopo curto e síncrono: restaurado no finally
  try {
    const cfg = modeConfig(mode, n); let res = null;
    for (let a = 0; a < 60; a++) {
      const r = scramble(cfg); if (!r) continue;
      res = res || r;
      const strict = a < 40;
      if (validState(r.tubes, cfg) && !isSolved(r.tubes) && mixScore(r.tubes) >= cfg.colors * (strict ? 1.5 : 0.8) &&
          (!strict || !r.tubes.some(isPure)) && (fixed || !recentKeys.includes(tubesKey(r.tubes)))) { res = r; break; }
    }
    const tubes = res.tubes;
    for (let i = tubes.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [tubes[i], tubes[j]] = [tubes[j], tubes[i]]; }
    if (!fixed) { recentKeys.push(tubesKey(tubes)); if (recentKeys.length > 30) recentKeys.shift(); }
    return { cfg, tubes };
  } finally { Math.random = realRandom; }
}

/* ===== UI ===== */
/* Líquidos: 12 cores vivas, com matizes bem espaçados e sem marrom/cinza. A ordem importa: as primeiras fases usam só as
   primeiras cores, então elas são as mais distintas entre si (vermelho, amarelo, azul-céu, verde, roxo, laranja...). */
const PALETTE = [
  '#ff3b4e', // 0  vermelho
  '#ffe033', // 1  amarelo
  '#3fb0ff', // 2  azul-céu
  '#12b76a', // 3  verde-esmeralda
  '#c04cf5', // 4  roxo
  '#ff8a1f', // 5  laranja
  '#2ee6d6', // 6  ciano
  '#ff66b3', // 7  rosa
  '#a3e635', // 8  lima
  '#6f5cff', // 9  violeta-índigo
  '#7dffc3', // 10 menta
  '#f4f8ff'  // 11 branco-gelo
];
const INK = '#1b2150', PAPER = '#ffd84a';
const $ = id => document.getElementById(id);
const ui = {
  stage: $('stage'), canvas: $('game-canvas'), level: $('hud-level'), label: $('hud-label'), moves: $('hud-moves'),
  undo: $('undo-button'), restart: $('restart-button'), fresh: $('new-button'), mute: $('mute-button'),
  dTitle: $('dialog-title'), dText: $('dialog-text'), dOk: $('dialog-ok'), dNo: $('dialog-cancel'),
  arena: $('arena'), frame: $('frame'), startScreen: $('start-screen'),
  mLevels: $('mode-levels'), mInf: $('mode-infinite'), mLevelsInfo: $('mode-levels-info'), mInfInfo: $('mode-infinite-info'),
  helpButton: $('help-button'), helpPopover: $('help-popover'), helpClose: $('help-close'), helpBody: $('help-body'),
  levelsBtn: $('levels-button'), lvScreen: $('levels-screen'), lvClose: $('levels-close'), lvBack: $('levels-back'), lvWrap: $('levels-wrap'), lvGrid: $('levels-grid'),
  lvPrev: $('levels-prev'), lvNext: $('levels-next'), lvPage: $('levels-page'), lvFirst: $('levels-first'), lvCur: $('levels-cur'),
  lvTitle: $('levels-title'), lvSub: $('levels-sub'), speed: $('speed-button'), hud: document.querySelector('.hud'),
  pause: $('pause-button'), resume: $('resume-button'), pauseHome: $('pause-home'), pauseText: $('pause-text'), toast: $('toast')
};
const ctx = ui.canvas.getContext('2d');
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
let cw = 288, ch = 512, dpr = 1, lay = null, clock = 0, winT = -1, dialogOk = null, dialogNo = null, dialogEsc = false;

/* mode: 'levels' (30 fases) ou 'infinite'. best = maior fase liberada do Modo Fases (LEVELS_MAX + 1 = tudo concluído);
   inf = nível alcançado no Modo Infinito. */
const G = {
  mode: WaterSortStorage.getMode(), level: 1, best: Math.min(WaterSortStorage.getUnlocked(), LEVELS_MAX + 1), inf: Math.min(WaterSortStorage.getInfLevel(), INF_MAX + 1),
  tubes: [], initial: [], moves: 0, history: [], selected: -1, busy: false, anim: null, won: false
};
let ready = true;   // tela inicial: o jogo fica parado até escolher um modo (ou apertar Space para continuar o último)
let helpOpen = false;
/* Pausa e retomada: com paused ligado, nada da partida avança (update retorna na hora) e nenhuma entrada de jogo é aceita. */
let paused = false, pauseReason = 'manual', toastTimer = null;
const PAUSE_TEXT = {
  manual: 'Partida salva. Toque em Continuar para voltar.',
  reload: 'Página recarregada. Partida salva. Toque em Continuar para voltar.',
  hidden: 'Pausado ao sair da aba. Partida salva.',
  help: 'Feche a ajuda e toque em Continuar para voltar.'
};
const store = WaterSortStorage;
const lockedUI = () => ready || paused || G.won;
const HELP = { gap: 12, edge: 8, maxWidth: 270, button: 40, side: 24 };
const LV = { open: false, from: 'game', page: 0, per: 15, minCell: 40, maxCols: 5, maxRows: 5, fasesCols: 4, fasesRows: 4 };
const STAGE_W = 288, STAGE_H = 512, MARGIN = 6, MAX_CSS_HEIGHT = 1000;
let vis = [], parts = [], booted = false;   // booted: só grava "last" depois da fase inicial carregada

/* --- Som --- */
const sfx = (() => {
  let ac = null, muted = false, noise = null;
  muted = WaterSortStorage.isMuted();
  const get = () => {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  };
  function tone(f, d, type, vol, when, slide) {
    const a = get(); if (!a || muted) return;
    const t = a.currentTime + (when || 0), o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t + d);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + d + 0.02);
  }
  return {
    get muted() { return muted; },
    toggle() { muted = !muted; WaterSortStorage.setMuted(muted); return muted; },
    unlock() { if (!muted) get(); },
    select: () => tone(620, 0.08, 'triangle', 0.07),
    bad: () => tone(150, 0.14, 'square', 0.04, 0, 0.7),
    done: () => { tone(700, 0.1, 'triangle', 0.07); tone(930, 0.14, 'triangle', 0.07, 0.09); },
    win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.08, i * 0.11)),
    pour(d) {
      const a = get(); if (!a || muted) return;
      if (!noise) { noise = a.createBuffer(1, a.sampleRate, a.sampleRate); const x = noise.getChannelData(0); for (let i = 0; i < x.length; i++) x[i] = Math.random() * 2 - 1; }
      const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime;
      s.buffer = noise; s.loop = true; f.type = 'bandpass'; f.Q.value = 3;
      f.frequency.setValueAtTime(500, t); f.frequency.linearRampToValueAtTime(1300, t + d);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.1, t + 0.06);
      g.gain.setValueAtTime(0.1, t + Math.max(0.07, d - 0.1)); g.gain.linearRampToValueAtTime(0, t + d);
      s.connect(f); f.connect(g); g.connect(a.destination); s.start(t); s.stop(t + d + 0.02);
    }
  };
})();

/* --- Fluxo do jogo --- */
function setGame(level, initial, tubes, history) {
  G.level = level;
  if (G.mode === 'infinite') G.inf = Math.max(G.inf, level);
  else { G.best = Math.min(LEVELS_MAX + 1, Math.max(G.best, level)); if (booted) WaterSortStorage.setLast(level); }
  G.initial = initial; G.tubes = tubes; G.history = history; G.moves = history.length;
  G.selected = -1; G.busy = false; G.anim = null; G.won = false; winT = -1; parts = [];
  paused = false; pauseReason = 'manual';   // fase nova/reiniciada: nenhuma pausa antiga sobrevive
  vis = tubes.map(t => ({ lift: 0, shake: 0, flash: 0, wob: 0, wt: 0, imp: 0, impx: 0, rt: 0, cap: isPure(t) ? 1 : 0, lock: 0 }));
  closeDialog(); relayout(); saveGame(); syncPause();
}
/* Começa o nível/fase n. Fases: sempre o mesmo tabuleiro (semente). Infinito: usa o tabuleiro já sorteado e salvo para esse nível, se houver
   (assim o catálogo reabre exatamente a mesma fase); sem registro, ou com fresh = true ("Novo jogo"), sorteia um e grava. */
function startLevel(n, fresh) {
  n = Math.min(n, G.mode === 'infinite' ? INF_MAX : LEVELS_MAX);   // teto travado: não existe nível além do limite
  let tubes = null;
  if (G.mode === 'infinite' && !fresh) {
    const saved = store.getInfBoard(n);
    if (saved && validState(saved, infiniteConfig(n)) && !isSolved(saved)) tubes = saved;
  }
  if (!tubes) tubes = generateLevel(n, G.mode).tubes;
  if (G.mode === 'infinite' && booted) store.setInfBoard(n, tubes);   // registro das fases geradas (não grava o tabuleiro de fundo da tela inicial)
  setGame(n, copyTubes(tubes), tubes, []);
}
// Reiniciar vale a qualquer hora após iniciar (inclusive sem jogadas), mas não durante um despejo nem com o jogo pausado.
// Desbloqueios/nível alcançado/som ficam intactos; a partida salva é substituída.
function restartLevel() {
  if (ready || G.won || paused || G.busy) return;
  setGame(G.level, G.initial, copyTubes(G.initial), []);
}
function undo() {
  if (lockedUI() || G.busy || !G.history.length) return;
  const h = G.history.pop();
  for (let i = 0; i < h.count; i++) G.tubes[h.from].push(G.tubes[h.to].pop());
  G.moves = G.history.length; G.selected = -1;
  vis[h.from].wob = vis[h.to].wob = 0.6; sfx.select(); saveGame(); updateHud();
}
/* "Novo jogo" (só Modo Infinito) é destrutivo: troca o tabuleiro do nível e zera a partida salva. Por isso SEMPRE passa por um aviso de confirmação,
   com o foco inicial em "Cancelar". Nas telas de conclusão (G.won) ele nem existe: o botão fica oculto (updateHud) e esta função recusa. */
function newGame() {
  if (G.mode !== 'infinite') return;   // Modo Fases: progressão fixa, não existe "novo jogo" (só Reiniciar, que volta ao mesmo tabuleiro)
  if (lockedUI() || G.busy) return;    // lockedUI inclui G.won
  openDialog('Novo jogo?',
    `Um novo tabuleiro será sorteado para o nível ${G.level}. O progresso da partida atual será apagado permanentemente e o salvamento será zerado. Isso não pode ser desfeito.`,
    'Apagar e sortear', 'Cancelar', () => { store.clearGame(G.mode); startLevel(G.level, true); }, { esc: true, danger: true });
}
function tapTube(i) {
  const sel = G.selected, t = G.tubes[i];
  if (isPure(t)) return locked(i);   // tubo concluído: indisponível (nem origem nem destino)
  if (sel < 0) { if (!t.length) return bad(i); G.selected = i; sfx.select(); return; }
  if (sel === i) { G.selected = -1; sfx.select(); return; }
  const m = planMove(G.tubes, sel, i);
  if (m) return startMove(m);
  if (t.length && !isPure(t)) { G.selected = i; sfx.select(); return; } // troca a origem
  bad(i);
}
function bad(i) { vis[i].shake = 0.3; vis[i].flash = 0.35; sfx.bad(); }
const LOCK_T = 0.4;   // duração do balanço de "tubo concluído" (s)
function locked(i) { vis[i].lock = LOCK_T; sfx.bad(); }
function startMove(m) {
  const s = m.from, d = m.to;
  const an = { ...m, src: G.tubes[s].slice(), dst: G.tubes[d].slice(), t: 0, t1: 0, t2: 0, t3: 0, T: 0, sgn: 1, lift0: vis[s].lift, snd: false, reduced: reduced.matches && !POUR_KEEPS_REDUCED_MOTION, cur: null };
  applyMove(G.tubes, m);                       // o estado muda uma única vez; a animação só apresenta
  G.history.push({ from: s, to: d, count: m.count }); G.moves = G.history.length; G.selected = -1;
  vis[s].lift = 0; saveGame(); updateHud();
  if (an.reduced) { an.t2 = 0.16 + 0.07 * m.count; an.T = an.t2; }   // movimento reduzido: só os níveis mudam, sem inclinar nem fluxo
  else {
    const P = lay.pos, dist = Math.min(8, Math.hypot(P[d].x - P[s].x, P[d].y - P[s].y) / lay.w);
    an.sgn = Math.abs(P[d].x - P[s].x) < 1 ? (P[d].x <= cw / 2 ? -1 : 1) : P[d].x > P[s].x ? 1 : -1;   // inclina para o lado do destino
    if (spill(an.sgn, P[d]) > lay.w * 0.3 && spill(-an.sgn, P[d]) < spill(an.sgn, P[d])) an.sgn = -an.sgn;   // …ou para o lado com espaço
    an.t1 = 0.34 + 0.025 * dist; an.t2 = 0.26 + 0.22 * m.count; an.t3 = 0.32 + 0.02 * dist;   // tempos conforme distância e quantidade
    pourGeom(an);
    an.T = Math.max(an.t1 + an.t2 + an.t3, an.t1 + an.t2 + jetAt(an, an.t1 + an.t2).tau + 0.03);
  }
  G.busy = true; G.anim = an; stepAnim(an);
}
function endMove() {
  const an = G.anim; G.anim = null; G.busy = false;
  vis[an.to].wob = reduced.matches ? 0 : 1; vis[an.from].wob = reduced.matches ? 0 : 0.4;
  if (isPure(G.tubes[an.to])) { sfx.done(); sparkle(an.to, 8); }
  if (isSolved(G.tubes)) win();
}
/* Registra a vitória: sobe o progresso do modo e apaga a partida salva (saveGame faz isso quando G.won). */
function commitWin() {
  G.won = true;
  if (G.mode === 'infinite') { G.inf = Math.min(INF_MAX + 1, Math.max(G.inf, G.level + 1)); store.setInfLevel(G.inf); store.addInfDone(G.level, G.moves); }
  else { G.best = Math.min(LEVELS_MAX + 1, Math.max(G.best, G.level + 1)); store.setUnlocked(G.best); }
  saveGame();
}
function win() {
  winT = 0; commitWin(); sfx.win();
  G.tubes.forEach((t, i) => t.length && sparkle(i, 6));
  setTimeout(() => {
    if (!G.won || ready) return;
    if (G.mode === 'infinite' && G.level >= INF_MAX) {
      openDialog('Parabéns!', `Você concluiu os ${INF_MAX} níveis! Movimentos: ${G.moves}`, 'Tela inicial', null, goHome);
    } else if (G.mode === 'infinite') {
      openDialog(`Nível ${G.level} concluído!`, `Movimentos: ${G.moves}. O próximo nível fica um pouco mais difícil.`, 'Próximo nível', 'Tela inicial', () => startLevel(G.level + 1), { no: goHome });
    } else if (G.level >= LEVELS_MAX) {
      openDialog('Parabéns!', `Você concluiu as ${LEVELS_MAX} fases! Movimentos: ${G.moves}`, 'Modo Infinito', 'Tela inicial', () => enterMode('infinite'), { no: goHome });
    } else {
      openDialog(`Fase ${G.level} concluída!`, `Movimentos: ${G.moves}`, 'Próxima fase', 'Tela inicial', () => startLevel(G.level + 1), { no: goHome });
    }
  }, reduced.matches ? 150 : 1100);
  updateHud();
}
/* openDialog(título, texto, rótuloOk, rótuloCancelar|null, açãoOk, { no: açãoCancelar, esc: Esc aciona o cancelar }) */
function openDialog(title, text, ok, cancel, fn, opt = {}) {
  ui.dTitle.textContent = title; ui.dText.textContent = text; ui.dOk.textContent = ok;
  ui.dNo.hidden = !cancel; ui.dNo.textContent = cancel || '';
  dialogOk = fn; dialogNo = opt.no || null; dialogEsc = !!opt.esc;
  ui.dOk.classList.toggle('btn-danger', !!opt.danger);   // ação destrutiva: botão vermelho e foco inicial em Cancelar
  ui.stage.classList.add('is-dialog'); (opt.danger && cancel ? ui.dNo : ui.dOk).focus({ preventScroll: true });
}
function closeDialog() { ui.stage.classList.remove('is-dialog'); ui.dOk.classList.remove('btn-danger'); dialogOk = null; dialogNo = null; dialogEsc = false; }
function updateHud() {
  const inf = G.mode === 'infinite';
  ui.level.textContent = G.level; ui.moves.textContent = G.moves;
  ui.label.textContent = inf ? '∞ Nível' : 'Fase';
  ui.levelsBtn.textContent = inf ? 'Níveis' : 'Fases';   // catálogo nos dois modos
  ui.levelsBtn.disabled = ready;
  ui.undo.disabled = lockedUI() || G.busy || !G.history.length;
  ui.restart.disabled = ready || G.won || paused || G.busy;
  ui.fresh.hidden = !inf || G.won;   // Modo Fases não tem "Novo jogo"; na conclusão da fase ele some de vez (evita reset acidental)
  ui.fresh.disabled = ready || paused || G.won;
  ui.pause.disabled = ready || G.won;
  ui.stage.classList.toggle('is-won', G.won);   // conclusão: o CSS esconde o botão de aceleração desde o instante da vitória
  fitHud(inf);
}
/* O HUD é sempre uma linha só. Com números grandes (nível de 4 dígitos, muitos movimentos) ele se compacta em duas etapas:
   1) espaçamento reduzido (.is-tight); 2) se ainda não couber, o rótulo do Infinito vira só "∞". Mede o DOM real, então vale em qualquer tamanho de tela. */
function fitHud(inf) {
  const h = ui.hud, over = () => h.scrollWidth > h.clientWidth + 1;
  h.classList.remove('is-tight'); ui.label.textContent = inf ? '∞ Nível' : 'Fase';
  if (!over()) return;
  h.classList.add('is-tight');
  if (inf && over()) ui.label.textContent = '∞';
}
function sparkle(i, n) {
  if (reduced.matches || !lay) return;
  const p = lay.pos[i], col = G.tubes[i].length ? PALETTE[G.tubes[i][0]] : '#fff';
  for (let k = 0; k < n; k++) parts.push({ x: p.x + (Math.random() - .5) * lay.w, y: p.y - lay.ihC * Math.random(), vx: (Math.random() - .5) * 40, vy: -30 - Math.random() * 50, g: 60, life: 0.7, max: 0.7, r: 1.5 + Math.random() * 2, c: Math.random() < .5 ? col : '#fff' });
}

/* --- Geometria --- */
function relayout() {
  const n = G.tubes.length, u = cw / 288;
  const top = 46 * u, bot = 54 * u, aw = cw - 24 * u, ah = ch - top - bot;
  let best = null;
  for (let r = 1; r <= 4; r++) {
    const c = Math.ceil(n / r), w = Math.min(aw / (c + (c - 1) * 0.32), ah / (r * 3.95 + 0.6), 44 * u);
    if (!best || w > best.w + 0.01) best = { r, w };
  }
  const w = best.w, iw = w * 0.84, seg = iw * 0.88, ih = seg * CAP, rim = w * 0.12, ihC = ih + rim, rowH = ihC + w * 0.8;
  const y0 = top + (ah - best.r * rowH) / 2 + w * 0.35, pos = [], shelves = [];
  let idx = 0;
  for (let j = 0; j < best.r; j++) {
    const cnt = Math.floor(n / best.r) + (j < n % best.r ? 1 : 0), step = w * 1.32, by = y0 + j * rowH + ihC;
    const x0 = cw / 2 - (cnt - 1) * step / 2;
    for (let k = 0; k < cnt; k++) pos[idx++] = { x: x0 + k * step, y: by };
    shelves.push({ x: x0 - w * 0.85, x2: x0 + (cnt - 1) * step + w * 0.85, y: by + w * 0.01, h: w * 0.3 });
  }
  lay = { w, iw, seg, ih, rim, ihC, pos, shelves, liftH: seg * 0.7 };
}
function hit(x, y) {
  let found = -1, bd = 1e9;
  lay.pos.forEach((p, i) => {
    if (Math.abs(x - p.x) <= lay.w * 0.66 && y >= p.y - lay.ihC - lay.liftH && y <= p.y + lay.w * 0.35) {
      const d = Math.abs(y - (p.y - lay.ihC / 2)); if (d < bd) { bd = d; found = i; }
    }
  });
  return found;
}
/* O botão "?" fica fora do jogo: ao lado (reserva dos dois lados, para o jogo seguir centralizado) ou, se faltar
   largura, logo abaixo. Escolhe o formato que permite o maior jogo. */
function resize() {
  const aw = Math.max(1, ui.arena.clientWidth - MARGIN * 2), ah = Math.max(1, ui.arena.clientHeight - MARGIN * 2), help = HELP.button + HELP.side;
  let best = { w: 0, pos: 'side' };
  for (const pos of ['side', 'below']) {
    const w = Math.max(1, aw - (pos === 'side' ? help * 2 : 0)), h = Math.max(1, ah - (pos === 'below' ? help : 0));
    let sw = Math.min(h, MAX_CSS_HEIGHT) * (STAGE_W / STAGE_H);
    if (sw > w) sw = w;
    sw = Math.floor(sw);
    if (sw > best.w) best = { w: sw, pos };
  }
  ui.frame.dataset.helpPos = best.pos;
  ui.stage.style.width = `${best.w}px`; ui.stage.style.height = `${Math.floor(best.w / (STAGE_W / STAGE_H))}px`;
  const r = ui.stage.getBoundingClientRect(); if (!r.width) return;
  cw = r.width; ch = r.height; dpr = Math.min(window.devicePixelRatio || 1, 3);
  ui.canvas.width = Math.round(cw * dpr); ui.canvas.height = Math.round(ch * dpr);
  ui.stage.style.setProperty('--u', `${cw / 288}px`); relayout();
  fitHud(G.mode === 'infinite'); placeHelp();   // reposiciona o painel de ajuda, se estiver aberto
  if (LV.open) renderLevels(); // e refaz a grade de fases com o novo espaço
}

/* --- Física do líquido: níveis horizontais no mundo dentro de um tubo inclinado --- */
function areaBelow(P, Y) {
  const out = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], ai = a[1] >= Y, bi = b[1] >= Y;
    if (ai) out.push(a);
    if (ai !== bi) { const t = (Y - a[1]) / (b[1] - a[1]); out.push([a[0] + t * (b[0] - a[0]), Y]); }
  }
  if (out.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < out.length; i++) { const a = out[i], b = out[(i + 1) % out.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}
function solveLevel(P, target) {
  let lo = Math.min(...P.map(p => p[1])), hi = Math.max(...P.map(p => p[1]));
  for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (areaBelow(P, m) > target) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
function spanAt(P, Y, fb) {
  const xs = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    if ((a[1] - Y) * (b[1] - Y) <= 0 && a[1] !== b[1]) xs.push(a[0] + (Y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
  }
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : fb;
}
function corners(p) {
  const c = Math.cos(p.a), s = Math.sin(p.a), hw = lay.iw / 2, W = (x, y) => [p.x + x * c - y * s, p.y + x * s + y * c];
  return [W(-hw, 0), W(hw, 0), W(hw, -lay.ihC), W(-hw, -lay.ihC)];
}
/* Ângulo em que a superfície de v segmentos passa exatamente pelo bico (inclinação de despejo) */
function thetaFor(v) {
  const hw = lay.iw / 2, lipY = -lay.ihC, target = v * lay.seg * lay.iw;
  const pts = [[-hw, 0], [hw, 0], [hw, lipY], [-hw, lipY]];
  const area = th => { const c = Math.cos(th), s = Math.sin(th); return areaBelow(pts.map(([x, y]) => { const dx = x - hw, dy = y - lipY; return [dx * c - dy * s, dx * s + dy * c]; }), 0); };
  let lo = 0, hi = 2.0;
  if (area(hi) > target) return hi;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (area(m) > target) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
function layersOf(arr, pop, add) {
  const runs = [];
  for (const c of arr) { const l = runs[runs.length - 1]; if (l && l[0] === c) l[1]++; else runs.push([c, 1]); }
  if (pop > 0 && runs.length) { const l = runs[runs.length - 1]; l[1] -= pop; if (l[1] <= 0.001) runs.pop(); }
  if (add && add.amt > 0.001) { const l = runs[runs.length - 1]; if (l && l[0] === add.color) l[1] += add.amt; else runs.push([add.color, add.amt]); }
  return runs;
}

/* --- Desenho --- */
const ease = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
function capPath(hw, top) {
  ctx.beginPath(); ctx.moveTo(-hw, top); ctx.lineTo(-hw, -hw); ctx.arc(0, -hw, hw, Math.PI, 0, true); ctx.lineTo(hw, top);
}
/* Tubo concluído: puxa a cor do líquido muito levemente para o cinza (mantém o brilho e o matiz) e escurece quase nada */
function dimColor(hex, k) {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, y = 0.3 * r + 0.59 * g + 0.11 * b;
  const c = v => Math.round((v + (y - v) * 0.12 * k) * (1 - 0.05 * k));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}
/* Tampa do tubo concluído, em coordenadas locais do tubo. plug=true: pino dentro da boca (só ocupa a folga livre do topo,
   L.rim, então nunca cobre o líquido); plug=false: cabeça por cima da borda, com ressaltos, brilho e contorno. k = assentamento. */
function drawCap(k, plug) {
  const L = lay, w = L.w, ihw = L.iw / 2, y0 = -L.ihC, e = ease(k), lw = Math.max(1.2, w * 0.04);
  ctx.save(); ctx.globalAlpha = e; ctx.translate(0, -(1 - e) * w * 0.45);   // desce e encaixa
  if (plug) {
    const pw = ihw * 0.94, d = L.rim * 0.85, g = ctx.createLinearGradient(-pw, 0, pw, 0);
    g.addColorStop(0, '#e0a800'); g.addColorStop(.4, '#ffd84a'); g.addColorStop(1, '#b88700');
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(-pw, y0 - w * 0.02, pw * 2, d + w * 0.02, [0, 0, w * 0.04, w * 0.04]); ctx.fill();
    ctx.fillStyle = 'rgba(27,33,80,.4)'; ctx.fillRect(-pw, y0 + d - Math.max(1, w * 0.025), pw * 2, Math.max(1, w * 0.025));   // sombra no fundo do pino
  } else {
    const W = w * 1.06, H = w * 0.2, x = -W / 2, y = y0 - H + w * 0.04, r = w * 0.07, g = ctx.createLinearGradient(x, 0, x + W, 0);
    g.addColorStop(0, '#fff3b0'); g.addColorStop(.3, PAPER); g.addColorStop(.72, '#f5b700'); g.addColorStop(1, '#c98a0a');
    ctx.beginPath(); ctx.roundRect(x, y, W, H, [r, r, r * 0.45, r * 0.45]); ctx.fillStyle = g; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = 'rgba(27,33,80,.2)'; ctx.fillRect(x, y + H * 0.78, W, H * 0.22);                       // sombra de contato com a borda
    ctx.strokeStyle = 'rgba(27,33,80,.2)'; ctx.lineWidth = Math.max(1, w * 0.025);                         // ressaltos verticais
    for (let j = 1; j < 6; j++) { const lx = x + W * j / 6; ctx.beginPath(); ctx.moveTo(lx, y + H * 0.2); ctx.lineTo(lx, y + H * 0.72); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(x + W * 0.1, y + H * 0.08, W * 0.8, Math.max(1, H * 0.12));   // brilho no topo
    ctx.restore();
    ctx.beginPath(); ctx.roundRect(x, y, W, H, [r, r, r * 0.45, r * 0.45]); ctx.strokeStyle = 'rgba(27,33,80,.9)'; ctx.lineWidth = lw; ctx.stroke();
  }
  ctx.restore();
}
function drawTube(p, layers, v, opt) {
  const L = lay, hw = L.w / 2, ihw = L.iw / 2, k = opt.done || 0, base = () => { ctx.translate(p.x, p.y); ctx.rotate(p.a); };
  ctx.save(); base();
  if (opt.sel) { ctx.globalAlpha = opt.sel === true ? 1 : opt.sel; capPath(hw, -L.ihC); ctx.closePath(); ctx.shadowColor = '#ffd84a'; ctx.shadowBlur = L.w * 0.35; ctx.lineWidth = L.w * 0.1; ctx.strokeStyle = '#ffd84a'; ctx.stroke(); ctx.shadowBlur = 0; ctx.globalAlpha = 1; }
  capPath(hw, -L.ihC); ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fill();
  ctx.restore();
  if (layers.length || opt.inner) {
    ctx.save(); base(); capPath(ihw, -L.ihC); ctx.closePath(); ctx.clip();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const P = corners(p), flat = Math.abs(p.a) < 1e-3, lvY = q => flat ? p.y - q * L.seg : solveLevel(P, q * L.seg * L.iw);
    const X0 = p.x - L.w * 4, X1 = p.x + L.w * 4, nL = layers.length;
    const yFloor = (flat ? p.y : Math.max(...P.map(q => q[1]))) + 2;   // abaixo do fundo do tubo (o recorte esconde o excesso)
    /* Nível do topo de cada camada: calculado UMA vez e usado tanto no preenchimento quanto nas divisórias,
       então as duas coisas partilham exatamente a mesma coordenada. */
    const tops = []; let cum = 0;
    layers.forEach(ly => { cum += ly[1]; tops.push(lvY(cum)); });
    /* Camadas comuns, de cima para baixo: cada uma vai do próprio topo até o fundo e a de baixo cobre a de cima
       exatamente em tops[j]. Assim a troca de cor tem uma única borda no nível exato, sem sobreposição nem fresta. */
    for (let li = nL - 2; li >= 0; li--) {
      ctx.fillStyle = k ? dimColor(PALETTE[layers[li][0]], k) : PALETTE[layers[li][0]];
      ctx.fillRect(X0, tops[li], X1 - X0, yFloor - tops[li]);
    }
    /* Camada do topo: com menisco/ondulação, recortada exatamente na fronteira com a camada de baixo (sem margem). */
    if (nL) {
      const yTop = tops[nL - 1], yBot = nL > 1 ? tops[nL - 2] : yFloor;
      const [xl, xr] = spanAt(P, yTop, [p.x - ihw, p.x + ihw]), m = L.iw * 0.05, wb = v.wob * L.iw * 0.09 * Math.sin(v.wt);
      const y0 = yTop - m + wb * 0.5, yc = yTop + m * 1.3 + wb, y1 = yTop - m - wb * 0.5;
      const surf = () => {   // superfície: curva suave; com impacto do fio, vira polilinha com covinha e anéis que se espalham
        if (v.imp < 0.02) { ctx.quadraticCurveTo((xl + xr) / 2, yc, xr, y1); return; }
        for (let j = 1; j <= 18; j++) {
          const f = j / 18, x = xl + (xr - xl) * f, d = x - v.impx, ad = Math.abs(d), dd = d / (L.iw * 0.15);
          ctx.lineTo(x, (1 - f) * (1 - f) * y0 + 2 * (1 - f) * f * yc + f * f * y1 + v.imp * L.iw * (0.07 * Math.exp(-dd * dd) + 0.03 * Math.sin(ad / (L.iw * 0.09) - v.rt) * Math.exp(-ad / (L.iw * 0.5))));
        }
      };
      ctx.save();
      ctx.beginPath(); ctx.rect(X0, yTop - L.w, X1 - X0, yBot - (yTop - L.w)); ctx.clip();   // nunca passa da fronteira de baixo
      ctx.fillStyle = k ? dimColor(PALETTE[layers[nL - 1][0]], k) : PALETTE[layers[nL - 1][0]];
      ctx.beginPath(); ctx.moveTo(X0, yTop - m); ctx.lineTo(xl, y0); surf();
      ctx.lineTo(X1, yTop - m); ctx.lineTo(X1, yBot); ctx.lineTo(X0, yBot); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(xl, y0); surf();
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = Math.max(1, L.w * 0.035); ctx.stroke();
      ctx.restore();
    }
    /* Separação entre camadas: linha escura fina centrada em tops[j] (a fronteira exata) e um realce claro finíssimo
       encostado logo acima dela. Dentro do recorte do tubo: acompanha a largura interna e não chega às paredes externas. */
    if (nL > 1) {
      const dk = Math.max(1, L.w * 0.03), lt = Math.max(0.8, L.w * 0.016);
      for (let j = 0; j < nL - 1; j++) {
        const y = tops[j];
        ctx.strokeStyle = 'rgba(16,22,72,.55)'; ctx.lineWidth = dk; ctx.beginPath(); ctx.moveTo(X0, y); ctx.lineTo(X1, y); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = lt; ctx.beginPath(); ctx.moveTo(X0, y - dk / 2 - lt / 2); ctx.lineTo(X1, y - dk / 2 - lt / 2); ctx.stroke();
      }
    }
    if (opt.inner) opt.inner();   // fio dentro do tubo: sob os reflexos do vidro
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.translate(p.x, p.y); ctx.rotate(p.a);
    const g = ctx.createLinearGradient(-ihw, 0, ihw, 0);
    g.addColorStop(0, 'rgba(10,16,60,.2)'); g.addColorStop(.3, 'rgba(255,255,255,0)'); g.addColorStop(.6, 'rgba(255,255,255,.1)'); g.addColorStop(1, 'rgba(10,16,60,.28)');
    ctx.fillStyle = g; ctx.fillRect(-ihw, -L.ihC, L.iw, L.ihC + 1);
    ctx.restore();
  }
  ctx.save(); base();
  if (k > 0) { capPath(hw, -L.ihC); ctx.closePath(); ctx.fillStyle = `rgba(52,211,153,${0.16 * k})`; ctx.fill(); drawCap(k, true); }   // véu verde sutil (concluído) + pino da tampa dentro da boca
  capPath(hw, -L.ihC); ctx.strokeStyle = `rgba(255,255,255,${0.85 - 0.2 * k})`; ctx.lineWidth = Math.max(1.5, L.w * 0.055); ctx.stroke();
  capPath(hw + L.w * 0.03, -L.ihC); ctx.strokeStyle = 'rgba(27,33,80,.55)'; ctx.lineWidth = Math.max(1, L.w * 0.03); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fillRect(-ihw + L.iw * 0.1, -L.ih * 0.9, L.iw * 0.11, L.ih * 0.7);
  ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(ihw - L.iw * 0.2, -L.ih * 0.85, L.iw * 0.05, L.ih * 0.45);
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(-hw - L.w * 0.05, -L.ihC - L.w * 0.02, L.w * 1.1, L.w * 0.07);
  if (opt.flash > 0) { capPath(hw, -L.ihC); ctx.closePath(); ctx.fillStyle = `rgba(255,122,26,${Math.min(.45, opt.flash)})`; ctx.fill(); }
  if (k > 0) drawCap(k, false);   // tampa por cima da borda
  ctx.restore();
}
/* Fundo: "laboratório noturno". A camada estática (gradiente, brilhos, grade de pontos, vinheta) é pintada uma vez num canvas
   fora da tela e reaproveitada a cada quadro; por cima só se animam os feixes de luz e as partículas (paradas se o sistema pede menos movimento). */
const MOTES = Array.from({ length: 16 }, (_, i) => ({ x: (i * 0.618034) % 1, y: (i * 0.381966 + 0.13) % 1, r: 1 + (i % 4) * 0.7, sp: 0.01 + (i % 5) * 0.005, ph: i * 1.7 }));
let bgLayer = null, bgSig = '';
function buildBackground() {
  const sig = `${cw}x${ch}@${dpr}`;
  if (bgLayer && bgSig === sig) return bgLayer;
  const c = document.createElement('canvas'); c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const u = cw / 288, R = Math.max(cw, ch);
  let f = g.createLinearGradient(0, 0, 0, ch);
  f.addColorStop(0, '#171d52'); f.addColorStop(.5, '#0f2554'); f.addColorStop(1, '#06283a');
  g.fillStyle = f; g.fillRect(0, 0, cw, ch);
  let r = g.createRadialGradient(cw * .5, ch * .3, 0, cw * .5, ch * .3, R * .65);
  r.addColorStop(0, 'rgba(94,234,212,.15)'); r.addColorStop(.55, 'rgba(94,234,212,.04)'); r.addColorStop(1, 'rgba(94,234,212,0)');
  g.fillStyle = r; g.fillRect(0, 0, cw, ch);
  r = g.createRadialGradient(cw * .95, ch * .92, 0, cw * .95, ch * .92, R * .6);
  r.addColorStop(0, 'rgba(167,139,250,.16)'); r.addColorStop(1, 'rgba(167,139,250,0)');
  g.fillStyle = r; g.fillRect(0, 0, cw, ch);
  const step = 16 * u, d = Math.max(1, u * 1.1);   // grade de pontos em quincunx
  g.fillStyle = 'rgba(190,215,255,.08)';
  for (let row = 0, y = step / 2; y < ch; row++, y += step) for (let x = (row % 2 ? step : step / 2); x < cw; x += step) g.fillRect(x - d / 2, y - d / 2, d, d);
  r = g.createRadialGradient(cw / 2, ch / 2, R * .35, cw / 2, ch / 2, R * .78);   // vinheta
  r.addColorStop(0, 'rgba(2,6,23,0)'); r.addColorStop(1, 'rgba(2,6,23,.5)');
  g.fillStyle = r; g.fillRect(0, 0, cw, ch);
  bgLayer = c; bgSig = sig;
  return c;
}
function drawBackground() {
  ctx.drawImage(buildBackground(), 0, 0, cw, ch);
  const u = cw / 288, t = reduced.matches ? 0 : clock;
  [[.2, 1], [.52, .8], [.82, .9]].forEach(([x, k], i) => {   // feixes de luz vindos do alto
    const sway = Math.sin(t * .25 + i * 2.1) * 10 * u, x0 = x * cw + sway, gr = ctx.createLinearGradient(0, 0, 0, ch * .75);
    gr.addColorStop(0, `rgba(150,235,255,${0.09 * k})`); gr.addColorStop(1, 'rgba(150,235,255,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(x0 - 10 * u, 0); ctx.lineTo(x0 + 16 * u, 0); ctx.lineTo(x0 + 90 * u, ch * .75); ctx.lineTo(x0 + 30 * u, ch * .75); ctx.closePath(); ctx.fill();
  });
  MOTES.forEach(m => {   // partículas lentas subindo
    const y = (((m.y - t * m.sp) % 1) + 1) % 1 * ch, x = m.x * cw + Math.sin(t * .5 + m.ph) * 6 * u, a = 0.1 + 0.08 * Math.sin(t * .9 + m.ph);
    ctx.fillStyle = `rgba(200,240,255,${a})`; ctx.beginPath(); ctx.arc(x, y, m.r * u, 0, 7); ctx.fill();
  });
  const lw = Math.max(1.5, u * 1.5);
  lay.shelves.forEach(s => {   // prateleira de vidro fosco
    const w = s.x2 - s.x, r = s.h * 0.4, gl = ctx.createLinearGradient(0, s.y, 0, s.y + s.h * 2.2), gs = ctx.createLinearGradient(0, s.y, 0, s.y + s.h * 0.75);
    gl.addColorStop(0, 'rgba(94,234,212,.18)'); gl.addColorStop(1, 'rgba(94,234,212,0)');
    ctx.fillStyle = gl; ctx.beginPath(); ctx.roundRect(s.x + 2, s.y + s.h * .6, w - 4, s.h * 1.6, r); ctx.fill();
    gs.addColorStop(0, 'rgba(220,240,255,.42)'); gs.addColorStop(1, 'rgba(150,190,255,.12)');
    ctx.fillStyle = gs; ctx.beginPath(); ctx.roundRect(s.x, s.y, w, s.h * .75, r); ctx.fill();
    ctx.strokeStyle = 'rgba(190,235,255,.5)'; ctx.lineWidth = lw; ctx.stroke();
  });
}
function idlePose(i) {
  const p = lay.pos[i], v = vis[i]; let x = p.x, y = p.y - v.lift * lay.liftH;
  if (v.shake > 0) x += Math.sin(v.shake * 60) * lay.w * 0.07 * (v.shake / 0.3);
  if (v.lock > 0) { const q = 1 - v.lock / LOCK_T; x += Math.sin(q * Math.PI * 4) * Math.sin(q * Math.PI) * lay.w * 0.07; }
  if (winT >= 0 && !reduced.matches) { const k = winT - i * 0.06; if (k > 0 && k < 0.45) y -= Math.sin(k / 0.45 * Math.PI) * lay.w * 0.35; }
  return { x, y, a: 0 };
}
/* --- Animação de despejo ---
   Linha do tempo (t em segundos): [0, t1] o tubo sobe/inclina até o bico ficar sobre a boca do destino;
   [t1, t1+t2] o líquido passa pelo bico; [t1+t2, t1+t2+t3] o tubo volta. O jato é balístico: cada porção sai do bico
   no instante te e cai até a superfície do destino, chegando lá em te+tau. O nível do destino sobe com o que
   realmente chegou (arrived), então origem + fluxo no ar + destino sempre somam a quantidade movida. */
const JET_G = 95;                                                       // gravidade do jato, em larguras de tubo por s²
const pourCurve = u => u <= 0 ? 0 : u >= 1 ? 1 : 0.3 * u + 0.7 * ease(u);   // fração já despejada (começa e termina suave)
const pourRate = u => u <= 0 || u >= 1 ? 0 : 0.3 + 4.2 * u * (1 - u);       // derivada de pourCurve
const outAt = (an, te) => an.count * pourCurve((te - an.t1) / an.t2);       // quanto já passou pelo bico até te

/* Posição horizontal do bico: normalmente um pouco antes do centro da boca do destino; perto da borda do palco ele avança
   (sem passar muito do centro) para o corpo do tubo inclinado não sair da tela. 'spill' mede o quanto ainda sobra para fora. */
function lipX(s, dp) {
  const L = lay, edge = L.ihC * 0.95, lx = dp.x - s * L.w * 0.28, lim = dp.x + s * L.w * 0.28;
  return s > 0 ? Math.max(lx, Math.min(edge, lim)) : Math.min(lx, Math.max(cw - edge, lim));
}
function spill(s, dp) { const x = lipX(s, dp), e = lay.ihC * 0.95; return s > 0 ? Math.max(0, e - x) : Math.max(0, x - (cw - e)); }
/* Posição do bico (pivô da inclinação) e ponto de queda, sempre sobre a boca real do destino; recalculado se o layout mudar */
function pourGeom(an) {
  const L = lay, s = an.sgn, dp = L.pos[an.to], u = cw / 288, x = lipX(s, dp);
  an.lip = { x, y: Math.max(dp.y - L.ihC - L.w * 0.5, 42 * u + L.w * 0.25) };
  an.tx = Math.max(dp.x - L.iw * 0.28, Math.min(dp.x + L.iw * 0.28, x + s * L.w * 0.22));
  an.g = JET_G * L.w; an.wmax = L.iw * (0.34 + 0.04 * an.count); an.geoFor = L;
}
/* Pose do tubo que despeja: gira em torno do próprio bico, que fica sobre a boca do destino */
function poseAt(an, t) {
  const L = lay, s = an.sgn, sp = L.pos[an.from];
  if (an.reduced) return { p: { x: sp.x, y: sp.y, a: 0 }, pr: an.count * ease(t / an.t2) };
  const hw = L.iw / 2, L0 = an.lip;
  const tlip = a => { const c = Math.cos(a), si = Math.sin(a), lx0 = s * hw, ly0 = -L.ihC; return { x: L0.x - (lx0 * c - ly0 * si), y: L0.y - (lx0 * si + ly0 * c) }; };
  const start = { x: sp.x, y: sp.y - an.lift0 * L.liftH }, end = { x: sp.x, y: sp.y };
  const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
  const v0 = an.src.length, v1 = v0 - an.count, tE = an.t1 + an.t2;
  if (t < an.t1) { const k = ease(t / an.t1), a = s * thetaFor(v0) * k; return { p: { ...lerp(start, tlip(a), k), a }, pr: 0 }; }
  if (t < tE) { const pr = outAt(an, t), a = s * thetaFor(v0 - pr); return { p: { ...tlip(a), a }, pr }; }
  const k = ease((t - tE) / an.t3), a = s * thetaFor(v1) * (1 - k); return { p: { ...lerp(tlip(a), end, k), a }, pr: an.count };
}
/* Largura do fio no instante de saída te: afina no começo e no fim, cresce com a vazão e com a quantidade */
function jetWidth(an, te) {
  const rise = 0.4 + 0.6 * ease((te - an.t1) / 0.14), fall = ease((an.t1 + an.t2 - te) / 0.2);
  return an.wmax * rise * fall * (0.78 + 0.22 * pourRate((te - an.t1) / an.t2) / 1.35);
}
/* Trajetória da porção que sai no instante te: parte do bico na horizontal e cai até a superfície do destino naquele momento */
function jetAt(an, te) {
  const L = lay, s = an.sgn, wd = jetWidth(an, te), q = outAt(an, te);
  const ex = an.lip.x - s * wd * 0.15, ey = an.lip.y + wd * 0.5;
  const yl = L.pos[an.to].y - (an.dst.length + q) * L.seg;
  const tau = Math.sqrt(2 * Math.max(yl - ey, L.w * 0.25) / an.g);
  return { ex, ey, vx: (an.tx - ex) / tau, tau, wd };
}
/* Fio visível em t: porções já emitidas (te <= min(t, fim)) que ainda não chegaram ao destino (te + tau > t) */
function jetState(an, t) {
  const tS = an.t1, tE = an.t1 + an.t2, L = lay;
  if (t < tS) return { arrived: 0, pts: null, land: 0 };
  const hi = Math.min(t, tE), F = te => te + jetAt(an, te).tau;
  if (t >= tE && F(tE) <= t) return { arrived: an.count, pts: null, land: 0 };
  let lo = tS;
  if (F(tS) < t) { let a = tS, b = hi; for (let i = 0; i < 18; i++) { const m = (a + b) / 2; if (F(m) > t) b = m; else a = m; } lo = b; }
  const landed = lo > tS + 1e-6, K = 26, pts = [];
  for (let k = 0; k <= K; k++) {
    const f = k / K, te = hi - (hi - lo) * (f * f * 0.6 + f * 0.4), j = jetAt(an, te), a = t - te;   // do bico (k=0) até a ponta (k=K), mais denso perto do bico, onde a curva fecha
    pts.push({ x: j.ex + j.vx * a, y: j.ey + 0.5 * an.g * a * a, w: j.wd * (1 - 0.3 * ease(a / j.tau)) });
  }
  if (landed) pts[K].y += L.seg * 0.15;                                  // a ponta entra um pouco no líquido, sem emenda
  return { arrived: outAt(an, lo), pts, landed, land: landed ? Math.min(1, pts[K].w / an.wmax) : 0 };
}
function stepAnim(an) {
  if (!an.reduced && an.geoFor !== lay) pourGeom(an);
  const ps = poseAt(an, an.t);
  if (an.reduced) { an.cur = { p: ps.p, pr: ps.pr, arr: ps.pr, jet: null }; return; }
  const js = jetState(an, an.t);
  an.cur = { p: ps.p, pr: ps.pr, arr: an.t >= an.T ? an.count : js.arrived, jet: js };
}
/* Pinta o fio. 'out': trecho acima da boca do destino, por cima de tudo. 'in': trecho dentro do destino
   (chamado por drawTube já recortado pela parede interna e antes dos reflexos do vidro). */
function paintJet(an, mode) {
  const J = an.cur.jet; if (!J || !J.pts) return;
  const P = J.pts, n = P.length, col = PALETTE[an.color], L = lay, nx = [], ny = [];
  ctx.save();
  if (mode === 'out') { ctx.beginPath(); ctx.rect(0, 0, cw, idlePose(an.to).y - L.ihC + 1); ctx.clip(); }
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
    nx[i] = -dy / d; ny[i] = dx / d;
  }
  const ribbon = (wk, off) => {
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const h = P[i].w * wk / 2, c = P[i].w * off; ctx[i ? 'lineTo' : 'moveTo'](P[i].x + nx[i] * (h + c), P[i].y + ny[i] * (h + c)); }
    for (let i = n - 1; i >= 0; i--) { const h = P[i].w * wk / 2, c = P[i].w * off; ctx.lineTo(P[i].x - nx[i] * (h - c), P[i].y - ny[i] * (h - c)); }
    ctx.closePath();
  };
  ctx.fillStyle = col; ribbon(1, 0); ctx.fill();
  const hd = P[n - 1];
  if (!J.landed) { ctx.beginPath(); ctx.arc(hd.x, hd.y, hd.w / 2, 0, 7); ctx.fill(); }   // ponta arredondada enquanto cai
  if (P[0].w > 0.8) { ctx.beginPath(); ctx.arc(P[0].x, P[0].y, P[0].w / 2, 0, 7); ctx.fill(); }
  ctx.fillStyle = 'rgba(255,255,255,.34)'; ribbon(0.26, 0.12); ctx.fill();
  if (J.landed && mode === 'in') {                                        // marolinha curta onde o fio encontra a superfície
    ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(hd.x, hd.y - L.seg * 0.12, hd.w * 0.8, Math.max(1, hd.w * 0.17), 0, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = Math.max(1, L.w * 0.03); ctx.stroke();
  }
  ctx.restore();
}
function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, ch);
  drawBackground();
  const an = G.anim, cur = an && an.cur;
  G.tubes.forEach((t, i) => {
    if (an && i === an.from) return;
    const isDst = an && i === an.to;
    const add = isDst ? { color: an.color, amt: cur.arr } : null;      // o destino mostra só o que já chegou
    drawTube(idlePose(i), layersOf(isDst ? an.dst : t, 0, add), vis[i], { sel: G.selected === i, flash: vis[i].flash, done: vis[i].cap, inner: isDst && cur.jet ? () => paintJet(an, 'in') : null });
  });
  if (an) {
    const glow = an.reduced || an.t >= an.t1 ? 0 : 1 - ease(an.t / (an.t1 * 0.7));   // o destaque da seleção se despede enquanto o tubo se prepara
    drawTube(cur.p, layersOf(an.src, cur.pr, null), vis[an.from], { sel: glow, flash: 0, done: 0 });
    paintJet(an, 'out');
  }
  parts.forEach(q => { ctx.globalAlpha = Math.max(0, q.life / q.max); ctx.fillStyle = q.c; ctx.beginPath(); ctx.arc(q.x, q.y, q.r * cw / 288, 0, 7); ctx.fill(); });
  ctx.globalAlpha = 1;
}
/* Acelerador: alterna 1× (padrão, desligado) e 2×. A velocidade NÃO muda de uma vez: SPEED.cur se aproxima de SPEED.target de forma
   exponencial (independente da taxa de quadros), então ligar/desligar no meio de um despejo acelera ou freia com suavidade.
   Em vez de mexer na lógica de despejo, só se escala o tempo que ela recebe (dt × velocidade) e, acima de 1×, esse tempo é fatiado
   em passos de até ~34 ms: cada passo é o mesmo que um quadro normal, então nada é "pulado" (fases do despejo, sons, fim do movimento). */
const SPEED = { on: false, cur: 1, target: 1, fast: 2, rate: 7, maxStep: 1 / 29 };
function toggleSpeed() {
  SPEED.on = !SPEED.on; SPEED.target = SPEED.on ? SPEED.fast : 1;
  ui.speed.classList.toggle('is-on', SPEED.on); ui.speed.setAttribute('aria-pressed', String(SPEED.on));
  ui.speed.setAttribute('aria-label', SPEED.on ? 'Acelerar animações (ligado, 2×)' : 'Acelerar animações (desligado)');
}
function update(rawDt) {
  const gap = SPEED.target - SPEED.cur;   // a velocidade acompanha o alvo mesmo com o jogo pausado
  SPEED.cur = Math.abs(gap) < 0.004 ? SPEED.target : SPEED.cur + gap * (1 - Math.exp(-rawDt * SPEED.rate));
  if (paused) return;   // congelado por completo: relógio, animações de despejo, partículas e vitória
  clock += rawDt;       // o fundo anda em tempo real; só a partida acelera
  const dt = rawDt * SPEED.cur, n = SPEED.cur > 1.001 ? Math.ceil(dt / SPEED.maxStep) : 1;
  for (let i = 0; i < n; i++) step(dt / n);
}
function step(dt) {
  vis.forEach((v, i) => {
    const goal = G.selected === i ? 1 : 0; v.lift += (goal - v.lift) * Math.min(1, dt * (reduced.matches ? 60 : 14));
    v.shake = Math.max(0, v.shake - dt); v.flash = Math.max(0, v.flash - dt); v.wob *= Math.exp(-dt * 3.2); v.wt += dt * 14;
    v.imp *= Math.exp(-dt * 3); v.rt += dt * 24;
    const capOn = isPure(G.tubes[i]) && !(G.anim && G.anim.to === i);   // o destino só fecha depois que o despejo termina
    v.cap = capOn ? (reduced.matches ? 1 : Math.min(1, v.cap + dt * 5)) : 0; v.lock = Math.max(0, v.lock - dt);
  });
  const an = G.anim;
  if (an) {
    const a0 = an.cur ? an.cur.p.a : 0;
    an.t += dt; stepAnim(an);
    if (!an.reduced) {
      const c = an.cur, J = c.jet, vs = vis[an.from], vd = vis[an.to];
      if (!an.snd && an.t >= an.t1) { an.snd = true; sfx.pour((an.t2 + 0.12) / SPEED.cur); }   // o som do jato dura o tempo REAL do despejo
      if (!reduced.matches) vs.wob = Math.max(vs.wob, Math.min(0.6, Math.abs(c.p.a - a0) / Math.max(dt, 1e-3) * 0.12));   // o líquido balança ao inclinar
      if (J && J.land > 0 && !reduced.matches) {                                                // o fio bate na superfície: ondulação no ponto de queda
        vd.imp = Math.max(vd.imp, J.land); vd.impx = an.tx;
        if (J.land > 0.45 && Math.random() < dt * 6) { const y = lay.pos[an.to].y - (an.dst.length + c.arr) * lay.seg, u = cw / 288; parts.push({ x: an.tx + (Math.random() - .5) * lay.iw * 0.25, y, vx: (Math.random() - .5) * 22 * u, vy: -(28 + Math.random() * 22) * u, g: 230 * u, life: 0.32, max: 0.32, r: 0.8 + Math.random() * 0.7, c: PALETTE[an.color] }); }
      }
    }
    if (an.t >= an.T) endMove();
  }
  if (winT >= 0) winT += dt;
  parts = parts.filter(q => { q.life -= dt; q.vy += q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt; return q.life > 0; });
  if (ui.undo.disabled !== (lockedUI() || G.busy || !G.history.length)) updateHud();
}

/* --- Entrada e inicialização --- */
ui.canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (lockedUI() || LV.open || G.busy || ui.stage.classList.contains('is-dialog')) return;
  const r = ui.canvas.getBoundingClientRect(), i = hit((e.clientX - r.left) * cw / r.width, (e.clientY - r.top) * ch / r.height);
  if (i >= 0) tapTube(i);
});
ui.undo.addEventListener('click', undo);
ui.restart.addEventListener('click', restartLevel);
ui.fresh.addEventListener('click', newGame);
ui.dOk.addEventListener('click', () => { const f = dialogOk; closeDialog(); if (f) f(); });
ui.dNo.addEventListener('click', () => { const f = dialogNo; closeDialog(); if (f) f(); });
function syncMute() { ui.mute.classList.toggle('is-muted', sfx.muted); ui.mute.setAttribute('aria-pressed', String(sfx.muted)); ui.mute.setAttribute('aria-label', sfx.muted ? 'Ativar efeitos sonoros' : 'Silenciar efeitos sonoros'); }
ui.mute.addEventListener('click', () => { sfx.toggle(); syncMute(); });
const isDialog = () => ui.stage.classList.contains('is-dialog');
window.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase(), dlg = isDialog();
  if (k === 'escape') {
    if (helpOpen) { e.preventDefault(); closeHelp(); ui.helpButton.focus({ preventScroll: true }); }
    else if (LV.open) { if (LV.from === 'menu') goHome(); else closeLevels(); }   // sem "X" na origem Menu: Esc = Voltar
    else if (dlg) { if (dialogEsc) closeDialog(); }   // só o aviso "Novo jogo" fecha com Esc; os de vitória não
    else pause('manual');
    return;
  }
  if (e.code === 'Space') {
    if (e.target.closest && e.target.closest('#help-button, #help-close')) return;   // deixa o botão focado agir
    if (e.repeat) return;
    if (ready && e.target.closest && e.target.closest('#start-screen button')) return;   // botão de modo focado: Space age nele
    if (ready && !dlg && !LV.open) { e.preventDefault(); enterMode(G.mode); }            // Space continua o último modo
    else if (paused && !dlg && !(e.target.closest && e.target.closest('button'))) { e.preventDefault(); resume(); }
    return;
  }
  if (dlg) return;
  if (k === 'm') { sfx.toggle(); syncMute(); }
  else if (k === 's') toggleSpeed();
  else if (k === 'p') togglePause();
  else if (LV.open) return;
  else if (k === 'z') undo();
  else if (k === 'r') restartLevel();
});
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

let lastT = 0;
function frame(t) { const dt = Math.min(0.05, (t - lastT) / 1000 || 0); lastT = t; update(dt); draw(); requestAnimationFrame(frame); }

/* Recarregar (F5) durante a partida: um marcador em sessionStorage guarda "em jogo" (e o modo) enquanto a pessoa está na tela de partida.
   Se a página abrir por um RECARREGAMENTO e o marcador existir, em vez da Tela Inicial voltamos à partida salva, já pausada (ver o fim do arquivo).
   Abrir a página de novo (nova aba, voltar do catálogo da Arcádia) não é recarregamento e continua caindo na Tela Inicial. */
const PLAY_KEY = 'water_sort:playing';
const RELOAD_MODE = (() => {
  try {
    const nav = performance.getEntriesByType('navigation')[0], m = sessionStorage.getItem(PLAY_KEY);
    return nav && nav.type === 'reload' && (m === 'levels' || m === 'infinite') ? m : null;
  } catch (e) { return null; }
})();
function syncPlayFlag() {
  const playing = !ready && !(LV.open && LV.from === 'menu');   // catálogo aberto pelo menu ainda não é partida
  try { if (playing) sessionStorage.setItem(PLAY_KEY, G.mode); else sessionStorage.removeItem(PLAY_KEY); } catch (e) { /* sem sessionStorage: F5 cai no menu */ }
}
syncMute(); resize();
/* A página sempre abre na tela inicial. Um tabuleiro qualquer do último modo fica por trás só para o canvas ter o que desenhar
   (ready = true: nada é salvo nem aparece). A partida de cada modo é recuperada quando o jogador escolhe o modo. */
startLevel(G.mode === 'infinite' ? Math.min(G.inf, INF_MAX) : Math.min(G.best, LEVELS_MAX));
booted = true;
renderMenu();

/* ===== Tela inicial e modos ===== */
function beginPlay() {
  if (!ready) return;
  ready = false; ui.stage.classList.remove('is-ready'); sfx.unlock(); saveGame(); syncPause();
}
/* Textos do menu: fase em que o Modo Fases está e nível em que o Modo Infinito continua; o último modo jogado ganha destaque. */
function renderMenu() {
  ui.mLevelsInfo.textContent = G.best > LEVELS_MAX ? `${LEVELS_MAX} de ${LEVELS_MAX} concluídas` : `Fase ${G.best} de ${LEVELS_MAX}`;
  ui.mInfInfo.textContent = G.inf > INF_MAX ? `${INF_MAX} de ${INF_MAX} concluídos` : `Nível ${G.inf}`;
  ui.mLevels.classList.toggle('is-last', G.mode === 'levels');
  ui.mInf.classList.toggle('is-last', G.mode === 'infinite');
}
/* Entra num modo: retoma a partida salva dele (se houver e for válida) ou começa a fase/nível alcançado. Também troca de modo no meio do jogo. */
function enterMode(mode, opt = {}) {
  closeLevels(); closeDialog(); closeHelp();
  if (!ready) saveGame();   // guarda a partida do modo atual antes de sair dele (se acabou de vencer, isso apaga o save)
  G.mode = mode; store.setMode(mode);
  const saved = store.getGame(mode);
  const restored = !!(saved && restoreGame(saved));
  if (!restored) {
    if (saved) store.clearGame(mode);   // partida salva inválida: descarta
    startLevel(mode === 'infinite' ? Math.min(G.inf, INF_MAX) : Math.min(G.best, LEVELS_MAX));
  }
  beginPlay();
  if (opt.resume) pause('reload');   // volta de um F5: partida restaurada e pausada, sem abrir o catálogo
  else openLevels('menu');   // entrar em qualquer modo abre o catálogo já na página do nível mais recente alcançado (origem Menu: só "Voltar")
}
/* Volta para a tela inicial (botão da pausa e botão "Tela inicial" dos avisos de vitória). A partida em andamento é salva. */
function goHome() {
  if (ready) return;
  closeDialog(); closeLevels(); closeHelp();
  if (G.anim) {   // pausado no meio de um despejo: o estado dos tubos já está final, então só encerra a animação
    G.anim = null; G.busy = false;
    if (isSolved(G.tubes) && !G.won) commitWin();
  }
  saveGame();
  ready = true; paused = false; pauseReason = 'manual'; G.selected = -1;
  ui.stage.classList.add('is-ready');
  renderMenu(); syncPause();
  (G.mode === 'infinite' ? ui.mInf : ui.mLevels).focus({ preventScroll: true });
}

/* ===== Partida salva, pausa e retomada ===== */
function saveGame() {
  if (ready) return;   // na tela inicial não mexe no que já está salvo
  if (G.won) { store.clearGame(G.mode); return; }
  store.setGame({ level: G.level, initial: G.initial, tubes: G.tubes, history: G.history, selected: G.selected }, G.mode);
}
/* Restaura a partida salva do modo atual (G.mode). Confere tudo (cores, capacidade, e se o histórico reproduz exatamente os tubos); qualquer divergência recusa. */
function restoreGame(g) {
  const reached = G.mode === 'infinite' ? Math.min(store.getInfLevel(), INF_MAX) : Math.min(store.getUnlocked(), LEVELS_MAX);
  if (g.level > reached) return false;
  const cfg = modeConfig(G.mode, g.level);
  if (!validState(g.initial, cfg) || !validState(g.tubes, cfg)) return false;
  const t = copyTubes(g.initial);
  for (const h of g.history) { const m = planMove(t, h.from, h.to); if (!m || m.count !== h.count) return false; applyMove(t, m); }
  if (tubesKey(t) !== tubesKey(g.tubes) || isSolved(g.tubes)) return false;
  setGame(g.level, copyTubes(g.initial), copyTubes(g.tubes), g.history.map(h => ({ ...h })));
  const s = g.selected; G.selected = s >= 0 && g.tubes[s].length && !isPure(g.tubes[s]) ? s : -1;
  return true;
}
function syncPause() {
  const c = ui.stage.classList;
  c.toggle('is-paused', !ready && !G.won && paused);
  ui.pauseText.textContent = PAUSE_TEXT[pauseReason] || PAUSE_TEXT.manual;
  syncPlayFlag(); updateHud();
}
function pause(reason = 'manual', focus = true) {
  if (ready || G.won) return;
  if (!paused) { paused = true; pauseReason = reason; }
  saveGame(); syncPause();
  if (focus && reason !== 'hidden') ui.resume.focus({ preventScroll: true });
}
// Continuar: retoma na hora, exatamente de onde parou (sem contagem regressiva).
function resume() {
  if (!paused || ready || G.won) return;
  closeHelp();
  paused = false; saveGame(); syncPause();
}
function togglePause() {
  if (ready || G.won) return;
  if (!paused) pause('manual'); else resume();
}
function showToast(msg) {
  ui.toast.textContent = msg; ui.toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 2400);
}

/* ===== Catálogo (Fases e Níveis) =====
   Modo Fases: LEVELS_MAX (30) fases fixas. Modo Infinito: até INF_MAX (1000) níveis; a grade mostra só do nível 1 até o alcançado
   (sem cadeados à frente) e ganha células/páginas conforme o jogador avança; cada nível concluído guarda o melhor nº de movimentos (histórico).
   Estados: concluído (abaixo do alcançado, com marca), atual (o alcançado, destacado), bloqueado (cadeado).
   Fases: G.best = LEVELS_MAX + 1 significa que as 30 foram concluídas (nenhuma fica como "atual").
   Cada célula é um contêiner (container query): o tamanho do número depende dos dígitos (--d) e da largura da célula, e a grade
   reserva mais largura por célula quando há 4 ou 5 dígitos. */
const ICON_LOCK = '<svg class="lock" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="3" y="7" width="10" height="7.5" rx="1.8" fill="currentColor"/><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const ICON_TICK = '<span class="tick" aria-hidden="true"><svg viewBox="0 0 12 12" focusable="false"><path d="M2.6 6.3l2.4 2.4 4.4-4.9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lvInf = () => G.mode === 'infinite';
const lvReached = () => (lvInf() ? G.inf : G.best);                                   // maior nível liberado (o "atual")
const lvLast = () => (lvInf() ? Math.min(G.inf, INF_MAX) : LEVELS_MAX);              // último número exibido na grade (Infinito: o alcançado)
const lvName = () => (lvInf() ? 'Nível' : 'Fase');
/* Quantos cabem por página: depende do espaço real da grade e de quantos dígitos têm os maiores números */
function measureLevels() {
  const gap = parseFloat(getComputedStyle(ui.lvGrid).columnGap) || 6, W = ui.lvWrap.clientWidth, H = ui.lvWrap.clientHeight;
  if (!lvInf()) {   // Fases: grade fixa 4×4 = 16 por página, então as 30 fases ficam sempre em exatamente 2 páginas; a grade encolhe se faltar altura
    const side = Math.max(1, Math.min((W - gap * (LV.fasesCols - 1)) / LV.fasesCols, (H - gap * (LV.fasesRows - 1)) / LV.fasesRows));
    ui.lvGrid.style.width = `${Math.floor(side * LV.fasesCols + gap * (LV.fasesCols - 1))}px`;
    ui.lvGrid.style.setProperty('--cols', LV.fasesCols);
    LV.per = LV.fasesCols * LV.fasesRows;
    return;
  }
  ui.lvGrid.style.width = '';   // Infinito: largura total, colunas conforme os dígitos
  const minCell = Math.max(LV.minCell, 10 * String(lvLast()).length + 12);             // 3 díg.: 42 · 4: 52 · 5: 62 (mín. 40px de alvo de toque)
  const cols = clamp(Math.floor((W + gap) / (minCell + gap)), 3, LV.maxCols), side = (W - gap * (cols - 1)) / cols;
  const rows = clamp(Math.floor((H + gap) / (side + gap)), 1, LV.maxRows);
  ui.lvGrid.style.setProperty('--cols', cols);
  LV.per = cols * rows;
}
function levelsSummary() {
  const done = lvInf() ? G.inf - 1 : Math.min(G.best - 1, LEVELS_MAX);
  if (lvInf()) return done === 0 ? 'Nenhum nível concluído ainda' : `${done.toLocaleString('pt-BR')} de ${INF_MAX.toLocaleString('pt-BR')} concluídos`;
  return `${done} de ${LEVELS_MAX} concluídas`;
}
function renderLevels(toCurrent) {
  measureLevels();
  const per = LV.per, last = lvLast(), reached = lvReached(), pages = Math.ceil(last / per), hist = lvInf() ? store.getInfHistory() : null, name = lvName();
  if (toCurrent) LV.page = Math.floor((Math.min(reached, last) - 1) / per);
  LV.page = clamp(LV.page, 0, pages - 1);
  let html = '';
  for (let n = LV.page * per + 1; n <= Math.min((LV.page + 1) * per, last); n++) {
    const locked = n > reached, done = n < reached, cur = n === reached, best = hist && hist[n];
    const cls = ['lv', locked ? 'is-locked' : '', done ? 'is-done' : '', cur ? 'is-current' : '', n === G.level && !cur ? 'is-playing' : ''].filter(Boolean).join(' ');
    const label = locked ? `${name} ${n}, bloqueado` : done ? `${name} ${n}, concluído${best ? `, melhor: ${best} movimentos` : ''}` : cur ? `${name} ${n}, atual` : `${name} ${n}`;
    html += `<button type="button" class="${cls}" data-n="${n}" style="--d:${String(n).length}" aria-label="${label}"${locked ? ' disabled' : ''}${n === G.level ? ' aria-current="true"' : ''}>`
      + `${locked ? ICON_LOCK : ''}<span class="n">${n}</span>${done && best ? `<span class="mv" aria-hidden="true">${best} mov</span>` : ''}${done ? ICON_TICK : ''}</button>`;
  }
  ui.lvGrid.innerHTML = html;
  ui.lvTitle.textContent = lvInf() ? 'Níveis' : 'Fases'; ui.lvGrid.setAttribute('aria-label', ui.lvTitle.textContent);
  ui.lvSub.textContent = levelsSummary();
  ui.lvPage.textContent = `${LV.page + 1} / ${pages}`;
  const curPage = Math.floor((Math.min(reached, last) - 1) / per);
  ui.lvFirst.hidden = ui.lvCur.hidden = !lvInf();   // Fases: só Anterior/Próxima (são 2 páginas); os saltos existem só no Infinito
  ui.lvPrev.disabled = ui.lvFirst.disabled = LV.page === 0;
  ui.lvNext.disabled = LV.page >= pages - 1;
  ui.lvCur.disabled = LV.page === curPage;
}
/* from: 'menu' (aberto ao escolher o modo na Tela Inicial → só "Voltar", que leva ao menu) ou 'game' (aberto durante a partida → só "X",
   que apenas fecha e deixa o jogo exatamente como estava). */
function openLevels(from = 'game') {
  if (LV.open || ready || G.busy || G.won || isDialog() || paused) return;
  LV.from = from === 'menu' ? 'menu' : 'game';
  ui.lvBack.hidden = LV.from !== 'menu'; ui.lvClose.hidden = LV.from === 'menu';
  LV.open = true; ui.stage.classList.add('is-levels'); syncPlayFlag(); renderLevels(true);
  const cur = ui.lvGrid.querySelector('.is-current'); (cur || (LV.from === 'menu' ? ui.lvBack : ui.lvClose)).focus({ preventScroll: true });
}
function closeLevels() { if (!LV.open) return; LV.open = false; ui.stage.classList.remove('is-levels'); syncPlayFlag(); }
function pickLevel(n) {
  if (!(n >= 1 && n <= Math.min(lvReached(), lvInf() ? INF_MAX : LEVELS_MAX))) return;
  closeLevels();
  if (n === G.level && G.moves > 0 && !G.won) return;   // mesmo nível em andamento: só volta para ele, sem perder a partida
  startLevel(n);
}

/* ===== Ajuda "Como jogar": popover ancorado ABAIXO do botão "?", fora da área do jogo ===== */
function openHelp() {
  if (helpOpen) return;
  helpOpen = true; ui.helpPopover.hidden = false; ui.helpBody.scrollTop = 0; ui.helpButton.setAttribute('aria-expanded', 'true'); placeHelp();
  pause('help', false);   // abrir a ajuda pausa a partida (sem efeito na tela inicial); fechar NÃO retoma
}
function closeHelp() {
  if (!helpOpen) return;
  helpOpen = false; ui.helpPopover.hidden = true; ui.helpButton.setAttribute('aria-expanded', 'false');
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
  pop.style.width = `${width}px`; pop.style.left = `${Math.round(left)}px`;
  pop.style.setProperty('--arrow-x', `${Math.round(Math.min(Math.max(btn.left + btn.width / 2 - left, 16), width - 16))}px`);
  const height = pop.offsetHeight, roomBelow = window.innerHeight - btn.bottom - HELP.gap - HELP.edge, roomAbove = btn.top - HELP.gap - HELP.edge;
  let placement = 'below';
  if (ui.frame.dataset.helpPos !== 'side' && height > roomBelow && roomAbove > roomBelow) placement = 'above';
  const room = placement === 'below' ? roomBelow : roomAbove;
  if (height > room) { pop.style.maxHeight = `${Math.max(96, Math.floor(room))}px`; }   // o miolo (.help-body) é quem rola
  const finalHeight = pop.offsetHeight;
  pop.style.top = `${Math.round(placement === 'below' ? btn.bottom + HELP.gap : btn.top - HELP.gap - finalHeight)}px`;
  pop.dataset.placement = placement;
  updateHelpFade();
}
/* Esmaece o topo/rodapé do miolo só onde ainda há conteúdo escondido (começo: só embaixo; fim: só em cima; sem rolagem: nenhum). */
function updateHelpFade() {
  const el = ui.helpBody, max = el.scrollHeight - el.clientHeight;
  el.classList.toggle('fade-top', max > 1 && el.scrollTop > 2);
  el.classList.toggle('fade-bottom', max > 1 && el.scrollTop < max - 2);
}

/* ===== Ligações ===== */
ui.mLevels.addEventListener('click', () => enterMode('levels'));
ui.mInf.addEventListener('click', () => enterMode('infinite'));
ui.levelsBtn.addEventListener('click', () => openLevels('game'));
ui.lvClose.addEventListener('click', closeLevels);
ui.lvBack.addEventListener('click', goHome);
ui.lvFirst.addEventListener('click', () => { LV.page = 0; renderLevels(); });
ui.lvPrev.addEventListener('click', () => { LV.page--; renderLevels(); });
ui.lvNext.addEventListener('click', () => { LV.page++; renderLevels(); });
ui.lvCur.addEventListener('click', () => renderLevels(true));
ui.lvGrid.addEventListener('click', e => { const b = e.target.closest('.lv'); if (b && !b.disabled) pickLevel(Number(b.dataset.n)); });
ui.helpButton.addEventListener('click', e => {
  e.stopPropagation();
  if (helpOpen) closeHelp(); else openHelp();
  if (e.detail > 0) ui.helpButton.blur();   // clique/toque: Space não deve acionar o botão depois
});
ui.helpBody.addEventListener('scroll', updateHelpFade, { passive: true });
ui.helpClose.addEventListener('click', e => { e.stopPropagation(); closeHelp(); ui.helpButton.focus({ preventScroll: true }); });
// Um toque fora do popover só o fecha.
document.addEventListener('pointerdown', e => {
  if (helpOpen && !(e.target.closest && e.target.closest('#help-popover, #help-button'))) closeHelp();
}, true);
// Depois de um clique/toque, o botão solta o foco: assim Space inicia a partida em vez de reacionar o botão.
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('button'); if (b && e.detail > 0) b.blur(); });
document.addEventListener('pointerdown', () => sfx.unlock());
ui.pause.addEventListener('click', togglePause);
ui.speed.addEventListener('click', toggleSpeed);
ui.resume.addEventListener('click', resume);
ui.pauseHome.addEventListener('click', goHome);
// Sair da aba ou minimizar pausa e salva; ao voltar, a partida segue pausada até o jogador pedir (Continuar → contagem).
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause('hidden', false);
  else if (paused && pauseReason === 'hidden') showToast('Partida retomada');
});
window.addEventListener('pagehide', saveGame);
// Tooltips: sair do hover ou clicar/ativar esconde na hora; só volta com nova entrada do mouse ou novo foco.
document.querySelectorAll('[data-tip]').forEach(el => {
  const off = () => el.classList.add('tip-off'), on = () => el.classList.remove('tip-off');
  el.addEventListener('pointerdown', off); el.addEventListener('click', off);
  el.addEventListener('pointerleave', on); el.addEventListener('focusout', () => { if (!el.matches(':hover')) on(); });
});
updateHud();
if (RELOAD_MODE) enterMode(RELOAD_MODE, { resume: true });   // F5 no meio da partida → partida atual + modal de pausa
requestAnimationFrame(frame);