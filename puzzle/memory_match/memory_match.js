/* ==========================================================================
puzzle/memory_match/memory_match.js - Jogo da Memória em JavaScript puro.
Índice: 1 Configuração · 2 Áudio · 3 Estado · 4 Lógica · 5 IA · 6 Pausa e contagem · 7 Persistência
· 8 Navegação (início, modo, fases, tamanho) · 9 Interface · 10 Entrada · 11 Redimensionamento
Arquivos: memory_match_storage.js (persistência) · memory_match_symbols.js (60 símbolos em 5 temas)
· memory_match_levels.js (18 fases e tamanhos) · este arquivo (jogo e interface).

Fluxo: ready (Toque para iniciar) -> mode (Fases · Contra a IA · 2 Jogadores) -> levels (menu de fases)
ou setup (quantidade de cartas) -> playing. Depois: paused · countdown (3-2-1-GO!) · over.
Só em "playing" o jogo aceita jogadas, o cronômetro corre e as tarefas agendadas (after) avançam.
Modos (g.mode): 'levels' (solo, com pontos e tempo-meta) · 'ai' (você x computador) · 'pvp' (2 humanos). null = menus.
========================================================================== */
(() => {
'use strict';

/* ===== 1. CONFIGURAÇÃO ===== */
const CONFIG = {
  gap: 10, gapDense: 6, maxCard: 128, minCard: 24, margin: 4,   // gapDense: espaçamento menor quando há mais de 24 cartas
  matchPoints: 100, streakBonus: 25, missPenalty: 10,   // Fases: acerto, bônus por sequência, erro
  flipMs: 420,                                          // duração do giro da carta (vai para o CSS como --flip)
  mismatchDelay: 600, finishDelay: 500, volume: 0.8,    // erro: tempo que as duas cartas ficam à mostra antes de fechar
  countMs: 800, goMs: 600,                              // contagem regressiva: duração de cada número e do "GO!"
  saveEveryMs: 1000,                                    // salva a partida a cada 1 s de jogo
  aiMemory: 0.7,                                        // IA: chance de memorizar cada carta que viu (1 = nunca esquece)
  aiForget: 0.07,                                       // IA: chance de esquecer cada carta memorizada, a cada jogada dela
  aiSlip: 0.15,                                         // IA: chance de se confundir e virar outra carta mesmo sabendo onde está o par
  aiThinkFirst: 900, aiThinkSecond: 750,                // IA: "tempo de pensar" (ms de jogo) antes da 1ª e da 2ª carta
};
const COUNTDOWN = ['3', '2', '1', 'GO!'];
const MENU_PHASES = ['ready', 'mode', 'levels', 'setup'];
const Symbols = MemoryMatchSymbols, Levels = MemoryMatchLevels;
// Persistência: tudo passa por memory_match_storage.js (MemoryMatchStorage), isolado do restante do projeto.
const Store = MemoryMatchStorage;

/* ===== 2. ÁUDIO ===== */
// Os tons ficam acima de 400 Hz e o volume é alto: alto-falantes de celular e notebook quase não reproduzem sons graves.
const Sound = (() => {
  let ctx = null, master = null, off = false, muted = Store.isMuted(), primed = false;
  function ensure() {
    if (off) return null;
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) { off = true; return null; }
      try {
        ctx = new C();
        const comp = ctx.createDynamicsCompressor();
        master = ctx.createGain(); master.gain.value = CONFIG.volume;
        master.connect(comp); comp.connect(ctx.destination);
        ctx.onstatechange = () => { if (ctx.state !== 'running') primed = false; };
      } catch (e) { off = true; ctx = null; return null; }
    }
    if (ctx.state !== 'running') { try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }   // 'suspended' (autoplay) e 'interrupted' (iOS)
    if (!primed) { try { const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0); primed = true; } catch (e) {} }   // iOS: som mudo destrava a saída
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
    flip() { play(() => tone('triangle', 420, 560, 0.07, 0.5)); },
    match() { play(() => { tone('triangle', 600, 600, 0.1, 0.55); tone('triangle', 900, 900, 0.16, 0.55, 0.09); }); },
    miss() { play(() => tone('sawtooth', 320, 170, 0.22, 0.35)); },
    win() { play(() => [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.16, 0.55, i * 0.11))); },
    lose() { play(() => [440, 392, 349, 294].forEach((f, i) => tone('triangle', f, f, 0.2, 0.5, i * 0.14))); },
    click() { play(() => tone('triangle', 520, 700, 0.06, 0.45)); },
    count() { play(() => tone('triangle', 520, 520, 0.09, 0.45)); },
    go() { play(() => tone('triangle', 780, 1040, 0.2, 0.55)); },
  };
})();

/* ===== 3. ESTADO ===== */
const g = {
  mode: null, level: 0, pairs: Levels.DEFAULT_PAIRS, icons: [],        // configuração da partida
  cards: [], first: null, busy: false, phase: 'ready', pauseReason: null,
  matched: 0, attempts: 0, score: 0, streak: 0, elapsed: 0, record: false, round: 0,
  turn: 0, pscore: [0, 0], known: {}, aiQueued: false,                // Contra a IA / 2 Jogadores: vez, pares de cada um, memória da IA
  lvBest: { time: 0, score: 0 }, result: null,                        // Fases: melhor tempo/pontos salvos da fase e resultado da partida
};
const $ = (id) => document.getElementById(id);
const ui = {
  play: $('play'), arena: $('arena'), panel: $('game-panel'), body: $('game-body'), hud: $('hud'), boardWrap: document.querySelector('.board-wrap'),
  board: $('board'), toast: $('toast'), score: $('score'), best: $('best'), bestCard: $('best-card'),
  hudSolo: $('hud-solo'), hudVersus: $('hud-versus'),
  pcard: [$('pcard-0'), $('pcard-1')], pname: [$('pname-0'), $('pname-1')], pscore: [$('pscore-0'), $('pscore-1')],
  levelBar: $('level-bar'), lbLevel: $('lb-level'), lbTarget: $('lb-target'), lbBest: $('lb-best'), lbFill: $('lb-fill'),
  time: $('time'), attempts: $('attempts'), pairs: $('pairs'), bar: $('bar'),
  mute: $('mute-button'), helpButton: $('help-button'), controls: $('controls'),
  screens: { start: $('screen-start'), mode: $('screen-mode'), levels: $('screen-levels'), setup: $('screen-setup'), pause: $('screen-pause'), count: $('screen-count'), win: $('screen-win'), help: $('screen-help') },
  resumedChip: $('resumed-chip'), pauseNote: $('pause-note'), pauseScoreLabel: $('pause-score-label'),
  pauseScore: $('pause-score'), pauseAttempts: $('pause-attempts'), pauseTime: $('pause-time'),
  menuPauseLabel: $('menu-pause-label'), menuWinLabel: $('menu-win-label'), nextButton: $('next-button'),
  countNum: $('count-num'), tip: $('tip'), tipText: $('tip-text'), tipKey: $('tip-key'),
  winTitle: $('win-title'), winScore: $('win-score'), winUnit: $('win-unit'), winAttempts: $('win-attempts'), winTime: $('win-time'), winGoal: $('win-goal'), badge: $('record-badge'),
  modeLevelsInfo: $('mode-levels-info'), levelsGrid: $('levels-grid'), sizeGrid: $('size-grid'),
  setupTitle: $('setup-title'), setupNote: $('setup-note'), setupRule: $('setup-rule'),
};
const LANDSCAPE = window.matchMedia('(max-height: 500px) and (orientation: landscape)');
const fmtTime = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtClock = (ms) => { const s = Math.round(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const isVersus = () => g.mode === 'ai' || g.mode === 'pvp';
const names = () => (g.mode === 'ai' ? ['Você', 'Computador'] : ['Jogador 1', 'Jogador 2']);
const symOf = (c) => Symbols.ALL[g.icons[c.id]];
const levelBest = () => {
  if (g.mode !== 'levels') return { time: 0, score: 0 };
  const d = Store.getLevels();
  return { time: d.time[g.level - 1] || 0, score: d.score[g.level - 1] || 0 };
};

/* ===== 4. LÓGICA ===== */
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const rand = (list) => list[Math.floor(Math.random() * list.length)];

// Tarefas agendadas contam o tempo de JOGO (g.elapsed), não o relógio real: com o jogo pausado ou em
// contagem regressiva nada dispara, e o fechamento de um par errado só acontece depois que o jogo volta.
const tasks = [];
const after = (ms, fn) => { tasks.push({ at: g.elapsed + ms, fn }); };

// Monta uma partida nova (cartas embaralhadas) com a configuração dada. Quem chama define a fase (g.phase) e atualiza a tela.
function newGame(cfg) {
  g.round++;
  tasks.length = 0;
  cancelCountdown();
  helpOpen = false; ui.helpButton.setAttribute('aria-expanded', 'false');
  Object.assign(g, {
    mode: cfg.mode, level: cfg.level || 0, pairs: cfg.pairs, icons: cfg.icons.slice(),
    first: null, busy: false, matched: 0, attempts: 0, score: 0, streak: 0, elapsed: 0, record: false, pauseReason: null,
    turn: 0, pscore: [0, 0], known: {}, aiQueued: false, result: null,
  });
  const ids = shuffle(Array.from({ length: cfg.pairs }, (_, i) => i).flatMap((i) => [i, i]));
  g.cards = ids.map((id, index) => ({ id, index, flipped: false, matched: false }));
  g.lvBest = levelBest();
  buildBoard(false);
  lastScore = 0; lastPs = [0, 0]; lastSec = -1;
}

const idleCfg = () => ({ mode: null, level: 0, pairs: Levels.DEFAULT_PAIRS, icons: Levels.randomIcons(Levels.DEFAULT_PAIRS) });

// Começa a jogar agora com esta configuração (menu de fases, tela de tamanho, Reiniciar, Próxima fase).
function launch(cfg) {
  Sound.unlock();
  newGame(cfg);
  g.phase = 'playing';
  renderHud(false); renderPause(); syncScreens();
  resize(); resize();
  save();
}
function launchLevel(n) { const L = Levels.get(n); launch({ mode: 'levels', level: L.n, pairs: L.pairs, icons: L.icons }); }
function launchSetup(pairs) { launch({ mode: setupMode, level: 0, pairs, icons: Levels.randomIcons(pairs) }); }
function restart() {
  if (!g.mode) return;
  Sound.unlock();
  launch({ mode: g.mode, level: g.level, pairs: g.pairs, icons: g.mode === 'levels' ? g.icons : Levels.randomIcons(g.pairs) });
}
function nextLevel() { if (g.mode === 'levels' && g.level < Levels.COUNT) { Sound.unlock(); launchLevel(g.level + 1); } }

const cardLabel = (c) => c.matched ? `Carta ${c.index + 1}, ${symOf(c).name}, par encontrado`
  : c.flipped ? `Carta ${c.index + 1}, ${symOf(c).name}` : `Carta ${c.index + 1}, virada para baixo`;

function buildBoard(settled) {
  ui.board.innerHTML = g.cards.map((c) => `<button class="card${settled ? ' settled' : ''}" type="button" data-i="${c.index}" style="--c:${symOf(c).hue}">` +
    `<span class="face face-back"></span><span class="face front"><svg viewBox="0 0 48 48" aria-hidden="true">${symOf(c).svg}</svg></span></button>`).join('');
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

const aiTurn = () => g.mode === 'ai' && g.turn === 1 && g.phase === 'playing';

// bot = true quando é a IA jogando. Fora isso, na vez do computador o toque do jogador é ignorado.
function pick(i, bot = false) {
  const c = g.cards[i];
  // sem jogada fora de "playing" (pausa, contagem, menus, fim), sem 3ª carta, sem repetir carta, sem carta de par já feito
  if (!c || g.phase !== 'playing' || g.busy || c.flipped || c.matched) return;
  if (g.mode === 'ai' && g.turn === 1 && !bot) return;
  Sound.flip();
  setFlipped(c, true);
  aiSee(c);
  if (!g.first) { g.first = c; save(); if (aiTurn()) kickAI(); return; }
  const a = g.first, b = c, versus = isVersus();
  g.first = null;
  lock(true);
  g.attempts++;
  if (a.id === b.id) {
    g.matched++;
    if (versus) { g.pscore[g.turn]++; }
    else { g.streak++; g.score += CONFIG.matchPoints + CONFIG.streakBonus * (g.streak - 1); if (g.streak > 1) showToast(`Sequência x${g.streak}!`); }
    a.matched = b.matched = true; paintCard(a); paintCard(b);
    delete g.known[a.index]; delete g.known[b.index];
    Sound.match();
    renderHud(true);
    if (g.matched === g.pairs) after(CONFIG.flipMs + CONFIG.finishDelay, () => finish(false));   // segue travado até o fim
    else { lock(false); if (versus) showToast(`${names()[g.turn]}: par! Joga de novo`); if (aiTurn()) kickAI(); }
  } else {
    g.streak = 0;
    if (!versus) g.score = Math.max(0, g.score - CONFIG.missPenalty);
    Sound.miss();
    for (const m of [a, b]) { const el = ui.board.children[m.index]; el.classList.remove('wrong'); void el.offsetWidth; el.classList.add('wrong'); }
    after(CONFIG.flipMs + CONFIG.mismatchDelay, () => {   // giro de abertura + tempo à mostra (só corre com o jogo em andamento)
      for (const m of [a, b]) { setFlipped(m, false); ui.board.children[m.index].classList.remove('wrong'); }
      save();
      after(CONFIG.flipMs, () => { lock(false); if (versus) switchTurn(); });   // segue travado até as cartas terminarem de fechar
    });
    renderHud(false);
  }
  save();
}

// Passa a vez (só Contra a IA e 2 Jogadores).
function switchTurn() {
  g.turn = g.turn ? 0 : 1;
  const msg = g.mode === 'ai' ? ['Sua vez', 'Vez do computador'] : [`Vez do ${names()[0]}`, `Vez do ${names()[1]}`];
  showToast(msg[g.turn]);
  renderHud(false);
  save();
  if (aiTurn()) kickAI();
}

function finish(silent) {
  tasks.length = 0;
  g.phase = 'over'; g.first = null; g.aiQueued = false; lock(false);
  if (g.mode === 'levels') {
    const L = Levels.get(g.level), prev = g.lvBest, t = Math.floor(g.elapsed);
    g.result = { inTime: t <= L.seconds * 1000, newTime: !prev.time || t < prev.time, newScore: g.score > prev.score };
    g.record = g.result.newTime || g.result.newScore;
    Store.setLevelResult(g.level, t, g.score);
    g.lvBest = levelBest();
  } else { g.result = null; g.record = false; }
  fillWin();
  renderHud(false); renderLevelBar();
  syncScreens();
  if (g.record) pop(ui.bestCard, 'glow');
  if (!silent) { if (g.mode === 'ai' && g.pscore[1] > g.pscore[0]) Sound.lose(); else Sound.win(); }
  save();
}

function fillWin() {
  ui.winAttempts.textContent = String(g.attempts);
  ui.winTime.textContent = fmtTime(g.elapsed);
  const levels = g.mode === 'levels';
  ui.nextButton.hidden = !(levels && g.level < Levels.COUNT);
  ui.menuWinLabel.textContent = levels ? 'Fases' : 'Cartas';
  if (levels) {
    const L = Levels.get(g.level), r = g.result || {};
    ui.winTitle.textContent = 'Fase concluída!';
    ui.winScore.textContent = String(g.score); ui.winUnit.textContent = 'pontos';
    ui.winGoal.hidden = false;
    ui.winGoal.classList.toggle('is-miss', !r.inTime);
    ui.winGoal.textContent = r.inTime ? `Meta de ${fmtClock(L.seconds * 1000)} batida!` : `Meta de ${fmtClock(L.seconds * 1000)}: dá para ser mais rápido`;
    ui.badge.textContent = 'Novo recorde!';
    ui.badge.hidden = !(r.newTime || r.newScore);
  } else {
    const [a, b] = g.pscore, nm = names();
    ui.winTitle.textContent = a === b ? 'Empate!' : g.mode === 'ai' ? (a > b ? 'Você venceu!' : 'O computador venceu!') : `${nm[a > b ? 0 : 1]} venceu!`;
    ui.winScore.textContent = `${a} × ${b}`; ui.winUnit.textContent = 'pares';
    ui.winGoal.hidden = true; ui.badge.hidden = true;
  }
}

/* ===== 5. IA (memória imperfeita) ===== */
// A IA só "sabe" o que viu: cada carta virada (por ela ou pelo jogador) é memorizada com chance aiMemory e pode ser esquecida depois.
function aiSee(c) { if (g.mode === 'ai' && Math.random() < CONFIG.aiMemory) g.known[c.index] = c.id; }
function kickAI() {
  if (g.aiQueued) return;
  g.aiQueued = true;
  after(g.first ? CONFIG.aiThinkSecond : CONFIG.aiThinkFirst, aiPlay);
}
function aiPlay() {
  g.aiQueued = false;
  if (!aiTurn()) return;
  if (g.busy) { kickAI(); return; }
  pick(g.first ? aiSecond() : aiFirst(), true);
}
const freeCards = () => g.cards.filter((c) => !c.matched && !c.flipped);
// Esquecimento: a cada jogada, cada carta memorizada pode sumir da memória da IA.
function aiDecay() { for (const k of Object.keys(g.known)) if (Math.random() < CONFIG.aiForget) delete g.known[k]; }
// Carta ao acaso, como alguém que não lembra ou se confundiu. `avoid` = posições a evitar (o par certo), se houver outra opção.
function aiRandom(avoid = []) {
  const free = freeCards(), ok = free.filter((c) => !avoid.includes(c.index));
  const pool = ok.length ? ok : free;
  const unknown = pool.filter((c) => !(c.index in g.known));   // evita o que lembra ser outro símbolo, mas só quando lembra
  return rand(unknown.length ? unknown : pool).index;
}
function aiFirst() {
  aiDecay();
  const seen = {};
  for (const [k, id] of Object.entries(g.known)) {
    const c = g.cards[Number(k)];
    if (c && !c.matched && !c.flipped) (seen[id] = seen[id] || []).push(Number(k));
  }
  for (const id of Object.keys(seen)) {
    if (seen[id].length < 2) continue;
    // lembra de um par inteiro, mas pode se confundir e virar outra carta
    return Math.random() < CONFIG.aiSlip ? aiRandom(seen[id]) : seen[id][0];
  }
  return aiRandom();
}
function aiSecond() {
  aiDecay();
  const f = g.first;
  const mate = Object.entries(g.known).find(([k, id]) => id === f.id && Number(k) !== f.index && !g.cards[Number(k)].matched);
  if (mate) return Math.random() < CONFIG.aiSlip ? aiRandom([Number(mate[0])]) : Number(mate[0]);   // lembra do par, mas pode errar
  return aiRandom();
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
  const versus = isVersus();
  ui.pauseNote.textContent = PAUSE_NOTE[g.pauseReason] || PAUSE_NOTE.manual;
  ui.resumedChip.hidden = !(g.pauseReason === 'restored' || g.pauseReason === 'returned');
  ui.pauseScoreLabel.textContent = versus ? 'Placar' : 'Pontos';
  ui.pauseScore.textContent = versus ? `${g.pscore[0]} × ${g.pscore[1]}` : String(g.score);
  ui.pauseAttempts.textContent = String(g.attempts);
  ui.pauseTime.textContent = fmtTime(g.elapsed);
  ui.menuPauseLabel.textContent = g.mode === 'levels' ? 'Fases' : 'Cartas';
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
      if (last) { g.phase = 'playing'; syncScreens(); save(); if (aiTurn() && !g.busy) kickAI(); }
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
  if (g.phase !== 'playing') return;   // uma tarefa pode ter encerrado a partida
  const sec = Math.floor(g.elapsed / 1000);
  if (sec !== lastSec) { lastSec = sec; ui.time.textContent = fmtTime(g.elapsed); renderLevelBar(); }
  saveAcc += dt;
  if (saveAcc >= CONFIG.saveEveryMs) { saveAcc = 0; save(); }
}

/* ===== 7. PERSISTÊNCIA (partida) ===== */
// Nos menus não há partida a recuperar: o salvamento é apagado (o progresso das fases fica no storage, à parte).
function save() {
  if (MENU_PHASES.includes(g.phase)) { Store.clearGame(); return; }
  Store.saveGame({
    phase: g.phase === 'countdown' ? 'paused' : g.phase,
    mode: g.mode, level: g.level, pairs: g.pairs, icons: g.icons, turn: g.turn, pscore: g.pscore, result: g.result,
    cards: g.cards.map((c) => ({ id: c.id, flipped: c.flipped, matched: c.matched })),   // ordem atual das cartas
    attempts: g.attempts, score: g.score, streak: g.streak, elapsed: Math.floor(g.elapsed), record: g.record,
  });
}

// Valida o que veio do disco: qualquer incoerência descarta a partida salva (o progresso das fases não é afetado).
function normalizeSaved(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.cards) || s.cards.length % 2) return null;
  if (!['levels', 'ai', 'pvp'].includes(s.mode)) return null;
  const pairs = s.cards.length / 2;
  if (s.pairs !== pairs || pairs < 2 || pairs > Levels.COUNT + 1) return null;
  const level = s.mode === 'levels' ? s.level : 0;
  if (s.mode === 'levels') { if (!Number.isInteger(level) || level < 1 || level > Levels.COUNT || Levels.get(level).pairs !== pairs) return null; }
  else if (!Levels.SIZES.some((z) => z.pairs === pairs)) return null;
  if (!Array.isArray(s.icons) || s.icons.length !== pairs || new Set(s.icons).size !== pairs) return null;
  if (!s.icons.every((n) => Number.isInteger(n) && n >= 0 && n < Symbols.COUNT)) return null;
  const seen = new Array(pairs).fill(0), done = new Array(pairs).fill(0), cards = [];
  for (const c of s.cards) {
    if (!c || !Number.isInteger(c.id) || c.id < 0 || c.id >= pairs) return null;
    seen[c.id]++;
    if (c.matched === true) done[c.id]++;
    cards.push({ id: c.id, flipped: c.flipped === true, matched: c.matched === true });
  }
  if (seen.some((n) => n !== 2) || done.some((n) => n !== 0 && n !== 2)) return null;
  if (!['playing', 'paused', 'over'].includes(s.phase)) return null;
  const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
  const attempts = num(s.attempts), score = num(s.score), streak = num(s.streak), elapsed = num(s.elapsed);
  if ([attempts, score, streak, elapsed].includes(null)) return null;
  const matched = done.filter((n) => n === 2).length;
  if (s.phase === 'over' && matched !== pairs) return null;
  const versus = s.mode !== 'levels';
  const turn = s.turn === 1 ? 1 : 0;
  let pscore = [0, 0];
  if (versus) {
    if (!Array.isArray(s.pscore) || s.pscore.length !== 2 || s.pscore.some((n) => !Number.isInteger(n) || n < 0) || s.pscore[0] + s.pscore[1] !== matched) return null;
    pscore = s.pscore.slice();
  }
  const r = s.result, result = s.mode === 'levels' && s.phase === 'over' && r && typeof r === 'object'
    ? { inTime: r.inTime === true, newTime: r.newTime === true, newScore: r.newScore === true } : null;
  if (s.mode === 'levels' && s.phase === 'over' && !result) return null;
  return { phase: s.phase, mode: s.mode, level, pairs, icons: s.icons.slice(), cards, attempts, score, streak, elapsed, matched, turn, pscore, result, record: s.record === true };
}

// Recupera a partida SEM embaralhar. Partida em andamento volta sempre pausada, esperando o jogador.
function restoreGame() {
  const s = normalizeSaved(Store.loadGame());
  if (!s) { Store.clearGame(); return false; }
  g.round++;
  Object.assign(g, { mode: s.mode, level: s.level, pairs: s.pairs, icons: s.icons });
  g.cards = s.cards.map((c, index) => ({ id: c.id, index, flipped: c.flipped || c.matched, matched: c.matched }));
  const open = g.cards.filter((c) => c.flipped && !c.matched);
  g.first = open.length === 1 ? open[0] : null;           // 1 carta aberta: a jogada continua dela
  let turn = s.turn;
  if (open.length !== 1) {                                 // 2 abertas = erro que ia fechar: fecha agora (e passa a vez, se houver vez)
    if (open.length === 2 && s.mode !== 'levels' && s.phase !== 'over') turn = turn ? 0 : 1;
    open.forEach((c) => { c.flipped = false; });
  }
  Object.assign(g, { busy: false, matched: s.matched, attempts: s.attempts, score: s.score, streak: s.streak, elapsed: s.elapsed, record: s.record, pauseReason: null, turn, pscore: s.pscore, result: s.result, known: {}, aiQueued: false });
  tasks.length = 0;
  g.lvBest = levelBest();
  buildBoard(true);
  lastScore = g.score; lastPs = g.pscore.slice(); lastSec = -1;
  if (s.phase === 'over') { g.phase = 'over'; fillWin(); }
  else { g.phase = 'paused'; g.pauseReason = 'restored'; }
  renderHud(false); renderPause(); syncScreens();
  if (s.phase !== 'over' && s.matched === s.pairs) finish(true);   // recarregou durante o intervalo até o fim
  return true;
}

/* ===== 8. NAVEGAÇÃO: início -> modo -> fases / tamanho -> partida ===== */
let setupMode = 'ai';
// Abre uma tela de menu. Os menus ficam sobre um tabuleiro decorativo de tamanho padrão, para o painel ter sempre o mesmo tamanho.
function enterMenu(phase) {
  if (g.mode !== null) newGame(idleCfg());
  tasks.length = 0; cancelCountdown();
  g.phase = phase; g.pauseReason = null;
  if (phase === 'mode') renderModeInfo();
  if (phase === 'levels') buildLevels();
  renderHud(false); renderPause(); syncScreens();
  save();                       // nos menus apaga a partida salva
  resize(); resize();
}
const showHome = () => enterMenu('ready');
const openMode = () => enterMenu('mode');
const openLevels = () => enterMenu('levels');
function openSetup(mode) { setupMode = mode; buildSetup(mode); enterMenu('setup'); }
const nav = (fn) => (...a) => { Sound.unlock(); Sound.click(); fn(...a); blurActive(); };
function blurActive() { if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur(); }

// Da pausa ou do fim da partida: "Fases" (modo Fases) ou "Cartas" (escolher a quantidade de novo).
function goMenu() { const m = g.mode; Sound.unlock(); Sound.click(); if (m === 'levels') openLevels(); else openSetup(m || setupMode); blurActive(); }
// Da pausa ou do fim da partida: volta para a tela inicial ("Toque para iniciar").
function goHome() { Sound.unlock(); Sound.click(); showHome(); blurActive(); }

function renderModeInfo() {
  const done = Store.getLevels().done.filter(Boolean).length;
  ui.modeLevelsInfo.textContent = `${done} de ${Levels.COUNT} concluídas`;
}

const ICON_CHECK = '<svg class="lv-mark" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_STAR = '<svg class="lv-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.2 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z" fill="currentColor"/></svg>';
const ICON_LOCK = '<svg class="lv-lock" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="3" y="7" width="10" height="7" rx="2" fill="currentColor"/><path d="M5.3 7V5.2a2.7 2.7 0 0 1 5.4 0V7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
function buildLevels() {
  const prog = Store.getLevels();
  ui.levelsGrid.innerHTML = Array.from({ length: Levels.COUNT }, (_, i) => {
    const n = i + 1, L = Levels.get(n), open = Levels.isUnlocked(n, prog.done), done = prog.done[i], gold = prog.time[i] > 0 && prog.time[i] <= L.seconds * 1000;
    const label = `Fase ${n}, ${L.cards} cartas, tempo meta ${fmtClock(L.seconds * 1000)}${gold ? ', meta batida' : done ? ', concluída' : open ? '' : ', bloqueada'}`;
    return `<button class="lv${done ? ' is-done' : ''}${gold ? ' is-gold' : ''}" type="button" data-level="${n}"${open ? '' : ' disabled'} aria-label="${label}">` +
      (open ? `<b>${n}</b><small>${L.cards}</small>${gold ? ICON_STAR : done ? ICON_CHECK : ''}` : ICON_LOCK) + '</button>';
  }).join('');
}

function buildSetup(mode) {
  ui.setupTitle.textContent = mode === 'ai' ? 'Contra a IA' : '2 Jogadores';
  ui.setupNote.textContent = 'Quantas cartas?';
  ui.setupRule.textContent = mode === 'ai'
    ? 'Você começa. Quem acha um par joga de novo; ao errar, passa a vez. Vence quem fizer mais pares.'
    : 'O Jogador 1 começa. Quem acha um par joga de novo; ao errar, passa a vez. Vence quem fizer mais pares.';
  ui.sizeGrid.innerHTML = Levels.SIZES.map((z) => `<button class="size-card" type="button" data-pairs="${z.pairs}" aria-label="${z.label}, ${z.cards} cartas">` +
    `<span class="sz-num">${z.cards}</span><span class="sz-unit">cartas</span><span class="sz-name">${z.label}</span></button>`).join('');
}

/* ===== 9. INTERFACE ===== */
function pop(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
let lastScore = 0, lastPs = [0, 0];
function renderHud(animate) {
  const versus = isVersus();
  ui.hudSolo.hidden = versus; ui.hudVersus.hidden = !versus;
  ui.levelBar.hidden = g.mode !== 'levels';
  ui.score.textContent = String(g.score);
  if (animate && g.score > lastScore) pop(ui.score, 'bump');
  lastScore = g.score;
  ui.best.textContent = String(g.lvBest.score);
  if (versus) {
    const nm = names(), tag = g.mode === 'ai' ? ['Sua vez', 'Pensando…'] : ['Vez', 'Vez'];
    for (const k of [0, 1]) {
      ui.pname[k].textContent = nm[k];
      ui.pscore[k].textContent = String(g.pscore[k]);
      if (animate && g.pscore[k] > lastPs[k]) pop(ui.pscore[k], 'bump');
      ui.pcard[k].classList.toggle('is-turn', g.turn === k && g.phase !== 'over');
      ui.pcard[k].querySelector('.turn-tag').textContent = tag[k];
    }
    lastPs = g.pscore.slice();
  }
  ui.attempts.textContent = String(g.attempts);
  ui.time.textContent = fmtTime(g.elapsed);
  ui.pairs.textContent = `${g.matched}/${g.pairs}`;
  ui.bar.style.setProperty('--p', `${(g.matched / g.pairs) * 100}%`);
  renderLevelBar();
}
// Barra da fase (embaixo): tempo-meta FIXO, melhor tempo salvo e quanto da meta já passou.
function renderLevelBar() {
  if (g.mode !== 'levels') return;
  const L = Levels.get(g.level), target = L.seconds * 1000;
  ui.lbLevel.textContent = String(g.level);
  ui.lbTarget.textContent = fmtClock(target);
  ui.lbBest.textContent = g.lvBest.time ? fmtClock(g.lvBest.time) : '--:--';
  ui.lbFill.style.setProperty('--t', `${Math.min(1, g.elapsed / target) * 100}%`);
  ui.levelBar.classList.toggle('is-late', g.elapsed > target);
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
  const under = { ready: 'start', mode: 'mode', levels: 'levels', setup: 'setup', paused: 'pause', countdown: 'count', over: 'win' }[g.phase] || '';
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
  const el = ui.screens[name] && ui.screens[name].querySelector('[data-primary]:not([hidden])');
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

/* ===== 10. ENTRADA ===== */
const ACTIONS = {
  start: nav(openMode), 'mode-levels': nav(openLevels), 'mode-ai': nav(() => openSetup('ai')), 'mode-pvp': nav(() => openSetup('pvp')),
  'back-home': nav(showHome), 'back-mode': nav(openMode),
  resume: startCountdown, restart, next: nextLevel, menu: goMenu, home: goHome,
  help: openHelp, 'help-close': closeHelp,
  pause: () => pauseGame('manual'),
  mute: () => { Sound.setMuted(!Sound.muted); syncMute(); },
};
ui.board.addEventListener('click', (e) => {
  const el = e.target.closest('.card');
  if (el) { Sound.unlock(); pick(Number(el.dataset.i)); }
});
ui.panel.addEventListener('click', (e) => {
  if (e.target === ui.screens.help) { closeHelp(); return; }   // clique no fundo escurecido fecha o modal
  const lv = e.target.closest('.lv');
  if (lv) { if (!lv.disabled && g.phase === 'levels') { Sound.unlock(); Sound.click(); launchLevel(Number(lv.dataset.level)); } return; }
  const sz = e.target.closest('.size-card');
  if (sz) { if (g.phase === 'setup') { Sound.unlock(); Sound.click(); launchSetup(Number(sz.dataset.pairs)); } return; }
  const t = e.target.closest('[data-action]');
  if (t) {
    const fn = ACTIONS[t.dataset.action];
    if (fn) fn();
    if (e.detail > 0 && document.activeElement === t) t.blur();   // clique/toque: Space não deve acionar o botão depois
  } else if (e.target.closest('#screen-start') && !helpOpen && g.phase === 'ready') nav(openMode)();   // toque em qualquer ponto da tela inicial
});
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Escape') {
    hideTip();
    if (helpOpen) { e.preventDefault(); closeHelp(); }
    else if (g.phase === 'playing' || g.phase === 'countdown') pauseGame('manual');
    else if (!e.repeat && (g.phase === 'levels' || g.phase === 'setup')) { e.preventDefault(); nav(openMode)(); }   // Esc volta uma tela
    else if (!e.repeat && g.phase === 'mode') { e.preventDefault(); nav(showHome)(); }
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
    if (g.phase === 'ready') nav(openMode)(); else if (g.phase === 'paused') startCountdown();
  }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
// Navegadores só liberam o áudio depois de um gesto do usuário (toque: pointerup/touchend; mouse e teclado: click/keydown).
['pointerup', 'touchend', 'click', 'keydown'].forEach((ev) => document.addEventListener(ev, () => Sound.unlock(), { capture: true, passive: true }));

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

/* ===== 11. REDIMENSIONAMENTO: escolhe o número de colunas (2 a 8) que dá as cartas maiores, descontando o espaço
   que HUD, controles e barra da fase ocupam no container. Celular deitado: HUD e controles à esquerda, cartas à direita. ===== */
function resize() {
  const total = g.cards.length, gap = total > 24 ? CONFIG.gapDense : CONFIG.gap;
  const aw = ui.play.clientWidth - CONFIG.margin * 2, ah = ui.play.clientHeight - CONFIG.margin * 2;
  const pad = parseFloat(getComputedStyle(ui.panel).paddingLeft) || 0;
  let ow, oh;
  if (LANDSCAPE.matches) {
    ow = pad * 2 + ui.hud.offsetWidth + (parseFloat(getComputedStyle(ui.body).columnGap) || 0);
    oh = pad * 2;
  } else {
    ow = pad * 2;
    oh = ui.panel.offsetHeight - ui.boardWrap.offsetHeight;   // padding + HUD + controles + barra da fase + espaçamentos
  }
  let best = null;
  for (let cols = 2; cols <= Math.min(8, total); cols++) {
    const rows = Math.ceil(total / cols);
    const cw = Math.min((aw - ow - gap * (cols - 1)) / cols, ((ah - oh - gap * (rows - 1)) / rows) * 0.75, CONFIG.maxCard);
    const score = cw * (total % cols === 0 ? 1 : 0.9);   // grade completa é preferida; última fileira incompleta só se compensar
    if (!best || score > best.score + 0.01) best = { cw, cols, score };
  }
  ui.arena.style.setProperty('--cw', `${Math.max(CONFIG.minCard, Math.floor(best.cw))}px`);
  ui.arena.style.setProperty('--cols', String(best.cols));
  ui.arena.style.setProperty('--gap', `${gap}px`);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(ui.play);

ui.arena.style.setProperty('--flip', `${CONFIG.flipMs}ms`);
if (!restoreGame()) { newGame(idleCfg()); g.phase = 'ready'; renderHud(false); renderPause(); syncScreens(); }
syncMute();
resize();
resize();   // 2ª passada: a 1ª já aplicou --cols/--cw e o HUD pode ter mudado de altura
lastFrame = performance.now();
requestAnimationFrame(tick);
window.__memory = { g, CONFIG, Levels, pick, launch, launchLevel, openSetup, launchSetup, restart, showHome, openMode, openLevels, tasks, aiPlay };
})();