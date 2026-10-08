/* ==========================================================================
arcade/jumpy/jumpy.js - Endless jumper em HTML5 Canvas + JavaScript puro.
Índice: 1 Configuração · 2 Estado · 3 Plataformas · 4 Física · 5 Câmera
e pontuação · 6 Sprites · 7 Renderização · 8 Interface · 9 Entrada
· 10 Redimensionamento · 11 Loop e inicialização
========================================================================== */
(() => {
'use strict';

/* ===== 1. CONFIGURAÇÃO (pixels do mundo 288 x 512 e segundos) ===== */
const CONFIG = {
  world: { width: 288, height: 512 },

  // FÍSICA: altura máxima do pulo = jumpVelocity² / (2 · gravity) ≈ 142 px
  player: {
    width: 20, height: 20, hitWidth: 12,
    gravity: 1100,          // px/s²
    jumpVelocity: 560,      // impulso automático ao pousar (px/s)
    maxFallSpeed: 900,
    maxSpeed: 190,          // velocidade horizontal máxima (px/s)
    accel: 900,             // aceleração horizontal (px/s²)
    decel: 650,             // desaceleração sem tecla (px/s²)
    squashTime: 0.18,       // duração da animação de pouso
  },

  // PLATAFORMAS: tamanho e espaçamento (start = fácil, end = difícil)
  platforms: {
    height: 14,
    widthStart: 58, widthEnd: 30,       // plataformas mais estreitas
    shiftStart: 90, shiftEnd: 170,      // mais distância horizontal (a validação ainda corta o inalcançável)
    groundY: 480, groundHeight: 40,

    // QUANTIDADE POR ALTURA: distância vertical média entre plataformas, [metros, px].
    gapByScore: [[0, 85], [100, 92], [200, 99], [300, 105], [400, 110], [500, 115], [600, 119], [700, 123], [800, 126]],
    gapMin: 60, gapMax: 126,

    // RARIDADE (chance por plataforma; d = altura / difficulty.scoreForMax).
    movingMinRows: 2, movingStart: 0.18, movingEnd: 0.45,
    breakMinD: 0.06, breakStart: 0.08, breakEnd: 0.22, breakMinRows: 5,
    boostMinD: 0.2, boostStart: 0.02, boostEnd: 0.04, boostMinRows: 20,   // impulso: extremamente rara

    // TRECHOS SEM PLATAFORMA NORMAL (só móvel / quebrável / impulso)
    segMinD: 0.4, segChance: 0.25, segRows: [3, 4], segCooldown: 6,

    // TIPOS
    movingRange: 36, movingSpeedStart: 40, movingSpeedEnd: 90,
    breakTime: 1.0,                     // segundos até a quebrável sumir
    boostMultiplier: 1.7,

    // VALIDAÇÃO DE ALCANCE (fração da capacidade real do pulo considerada segura)
    reachHeight: 0.9, reachSpeedStart: 0.78, reachSpeedEnd: 0.88,
  },

  // DIFICULDADE: score em que atinge o máximo
  difficulty: { scoreForMax: 800 },

  camera: { followLine: 0.42 },         // fração da tela em que o jogador "prende"
  scoring: { pixelsPerPoint: 10 },
  markers: {
    // EDITE AQUI: alturas fixas (em metros), em ordem crescente. Iguais em todas as partidas.
    heights: [100, 250, 450, 650, 850, 1050, 1250, 1450],
    repeatEvery: 200,        // depois do último da lista: +200 m, +200 m... (determinístico)
    upcomingAlpha: 0.22,     // marcos ainda não alcançados (0 = escondidos)
    settledAlpha: 0.55,      // dourado discreto depois da animação
    blinkTime: 0.7, blinkRate: 14, flashTime: 1.6,
  },
  timing: { maxFrameTime: 1 / 30, physicsStep: 1 / 120 },
  scenery: { cloudCount: 6 },
  audio: { masterVolume: 0.3 },

  // CONTROLE POR ARRASTO (toque/mouse): o deslocamento do dedo em relação ao ponto de referência vira uma
  // intensidade analógica (-1 a 1) que alimenta a física horizontal do personagem (não é posição nem botão).
  input: {
    dragRange: 0.13,        // arrasto (fração da largura do palco) que dá 100% de intensidade (~47 px em 360 px)
    dragDeadZone: 0.012,    // dead zone (fração da largura) só para tremor do dedo (~4 px em 360 px)
    dragCurve: 1.15,        // levemente > 1: mais precisão perto do centro, sem "esconder" arrastos pequenos
    dragSmoothing: 55,      // suavização do eixo (1/s): só tira o serrilhado dos eventos; ~18 ms de atraso
    anchorFollow: true,     // passou do limite: a referência acompanha o dedo, então inverter responde na hora
    accel: 1700,            // aceleração horizontal em direção à velocidade-alvo do dedo (px/s²); só toque/mouse
  },

  // F5 / RECARREGAMENTO
  persistence: { saveIntervalMs: 400 },   // intervalo mínimo entre gravações automáticas da partida
  recovery: {
    seconds: 3,             // contagem 3, 2, 1 sempre que o jogo volta de uma pausa (F5, Continuar, P, ajuda...)
    goSeconds: 0.7,         // quanto tempo o "GO!" fica na tela depois da contagem
  },

  view: { margin: 6, maxCssHeight: 1000 },
};

const COLORS = {
  ink: '#543847', white: '#ffffff',
  skyBands: ['#4ec0e8', '#58c6ea', '#63ccec', '#6fd2ee', '#7cd8f0', '#8adef2', '#9ae4f4', '#aceaf6'],
  cloud: '#ffffff', cloudShade: '#d3f0f8',
  hillFar: '#59b84a', hillNear: '#74d160',
  grassLight: '#a6ea58', grassMid: '#78c72f', grassDark: '#4f9420',
  dirt: '#c4824a', dirtDark: '#a76a36', dirtLight: '#dba46a',
  body: '#ff6b57', bodyLight: '#ff9a85', bodyShade: '#d9452f',
};

const { world: WORLD, player: PLAYER, platforms: PLAT } = CONFIG;
const W = WORLD.width;
const H = WORLD.height;
const STATES = { READY: 'ready', PLAYING: 'playing', PAUSED: 'paused', RECOVERY: 'recovery', GAME_OVER: 'gameOver' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// Persistência: jumpy_storage.js (JumpyStorage), isolado do restante do projeto.

/* ===== ÁUDIO (Web Audio API, sem arquivos externos) ===== */
const Sound = (() => {
  let audioContext = null, master = null, noiseBuffer = null, unavailable = false;
  let muted = false;
  muted = JumpyStorage.isMuted();

  function ensureContext() {
    if (unavailable) return null;
    if (!audioContext) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) { unavailable = true; return null; }
      try {
        audioContext = new Ctor();
        master = audioContext.createGain();
        master.gain.value = CONFIG.audio.masterVolume;
        master.connect(audioContext.destination);
      } catch (e) { unavailable = true; audioContext = null; return null; }
    }
    if (audioContext.state === 'suspended') { try { audioContext.resume().catch(() => {}); } catch (e) {} }
    return audioContext;
  }

  function tone({ type = 'square', from, to = from, duration = 0.1, volume = 0.5, delay = 0 }) {
    const ctx2 = ensureContext();
    if (!ctx2) return;
    const t0 = ctx2.currentTime + delay;
    const osc = ctx2.createOscillator(), gain = ctx2.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain); gain.connect(master);
    osc.start(t0); osc.stop(t0 + duration + 0.02);
  }

  function noise({ duration = 0.15, volume = 0.5, cutoff = 1800 }) {
    const ctx2 = ensureContext();
    if (!ctx2) return;
    if (!noiseBuffer) {
      const len = Math.floor(ctx2.sampleRate * 0.4);
      noiseBuffer = ctx2.createBuffer(1, len, ctx2.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const t0 = ctx2.currentTime;
    const src = ctx2.createBufferSource(), filter = ctx2.createBiquadFilter(), gain = ctx2.createGain();
    src.buffer = noiseBuffer;
    filter.type = 'lowpass'; filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter); filter.connect(gain); gain.connect(master);
    src.start(t0); src.stop(t0 + duration + 0.02);
  }

  function safely(fn) {
    if (muted) return;
    try { fn(); } catch (e) { /* áudio nunca pode quebrar o jogo */ }
  }

  return {
    get muted() { return muted; },
    unlock() { if (!muted) safely(ensureContext); },
    setMuted(value) {
      muted = Boolean(value);
      JumpyStorage.setMuted(muted);
      if (!muted) safely(ensureContext);
    },
    bounce() {
      safely(() => {
        tone({ type: 'triangle', from: 170, to: 80, duration: 0.07, volume: 0.5 });
        tone({ type: 'square', from: 330, to: 620, duration: 0.09, volume: 0.2, delay: 0.015 });
      });
    },
    boost() {
      safely(() => {
        tone({ type: 'square', from: 280, to: 1400, duration: 0.35, volume: 0.28 });
        tone({ type: 'triangle', from: 140, to: 560, duration: 0.3, volume: 0.4 });
      });
    },
    crack() {
      safely(() => {
        noise({ duration: 0.08, volume: 0.35, cutoff: 3000 });
        tone({ type: 'sawtooth', from: 200, to: 120, duration: 0.06, volume: 0.2 });
      });
    },
    crumble() {
      safely(() => {
        noise({ duration: 0.35, volume: 0.55, cutoff: 900 });
        tone({ type: 'sawtooth', from: 140, to: 50, duration: 0.3, volume: 0.3 });
      });
    },
    hit() {
      safely(() => {
        noise({ duration: 0.18, volume: 0.5, cutoff: 2200 });
        tone({ type: 'sawtooth', from: 330, to: 55, duration: 0.5, volume: 0.4 });
      });
    },
    click() { safely(() => tone({ type: 'square', from: 520, to: 700, duration: 0.05, volume: 0.22 })); },
  };
})();

/* ===== 2. ESTADO ===== */
const game = {
  state: STATES.READY,
  time: 0, camY: 0, score: 0, maxHeight: 0, height: 0,
  overTime: 0, topY: 0, lastCx: W / 2,
  player: null, platforms: [],
};

const clouds = [];

// Contagem de retomada (3, 2, 1, GO!). Acontece SEMPRE que o jogo sai de uma pausa (F5/recarregar, botão de
// pausa, P/Esc, Continuar, Espaço, ajuda...). Quem conta é o loop principal (update), sem setTimeout.
const recovery = {
  remaining: 0,         // segundos que faltam (enquanto o estado é RECOVERY)
  go: 0,                // segundos que o "GO!" ainda fica visível
  shown: null,          // texto exibido agora (só mexe no DOM quando muda)
};

function createPlayer() {
  return { x: W / 2, y: PLAT.groundY, vx: 0, vy: 0, facing: 1, tilt: 0, squash: 0 };
}

// Altura (m) do marco de índice i. Lista fixa em CONFIG.markers.heights, depois repete.
function markerHeight(i) {
  const M = CONFIG.markers, L = M.heights;
  return i < L.length ? L[i] : L[L.length - 1] + (i - L.length + 1) * M.repeatEvery;
}

function difficulty() {
  return clamp(game.score / CONFIG.difficulty.scoreForMax, 0, 1);
}

function resetRound() {
  game.state = STATES.READY;
  game.time = 0;
  game.camY = 0;
  game.score = 0;
  game.maxHeight = 0;
  game.height = 0;                 // altura atual do jogador (m)
  game.markIdx = 0;                // índice do próximo marco
  game.nextMark = markerHeight(0); // altura (m) do próximo marco
  game.reached = {};               // marcos já alcançados nesta partida
  game.overTime = 0;
  game.lastCx = W / 2;
  game.player = createPlayer();
  game.platforms.length = 0;
  game.rows = 0;
  game.last = { type: 'normal', cx: W / 2, y: PLAT.groundY, w: W };
  game.lastBoostRow = game.lastBreakRow = game.segmentEndRow = -99;
  game.segmentLeft = 0;
  game.inSegment = false;
  game.flashes = {};
  recovery.remaining = 0;
  recovery.go = 0;
  recovery.shown = null;
  game.platforms.push(makePlatform('normal', W / 2, PLAT.groundY, W, PLAT.groundHeight));
  game.topY = PLAT.groundY;
  spawnPlatforms();
  syncUi();
}

function startGame() {
  if (game.state !== STATES.READY) return;
  game.state = STATES.PLAYING;
  closeHelp();
  Sound.click();
  syncUi();
}

function endGame() {
  if (game.state !== STATES.PLAYING) return;
  game.state = STATES.GAME_OVER;
  game.overTime = 0;
  JumpyStorage.setBest(game.score);   // só grava se superar o recorde salvo
  JumpyStorage.clearRun();            // partida terminada não volta depois de um F5 (o recorde fica)
  recovery.go = 0;
  releaseControl();
  Sound.hit();
  syncUi();
}

// Pausa ÚNICA para o jogo todo (botão, P/Esc, "Como jogar", troca de aba, F5): congela tudo e mostra a tela
// "PAUSADO / Toque para iniciar / ou / SPACE". Sair dela NUNCA retoma direto: passa sempre pela contagem 3, 2, 1, GO!.
// Pausar durante a contagem (ex.: trocar de aba) volta para a tela de pausa.
function setPaused(paused) {
  if (paused && (game.state === STATES.PLAYING || game.state === STATES.RECOVERY)) {
    game.state = STATES.PAUSED;
    recovery.remaining = 0;
    recovery.go = 0;
    recovery.shown = null;
  } else if (!paused && game.state === STATES.PAUSED) {
    closeHelp();                 // retomar sempre fecha a ajuda, se ainda estiver aberta
    Sound.click();
    beginRecovery();             // congelado durante 3, 2, 1; só depois do GO! o jogo anda
    return;
  } else return;
  Sound.click();
  releaseControl();
  persistRun();                  // congelada: grava o quadro exato em que parou
  syncUi();
}

// Reiniciar a partir da tela de pausa: descarta a partida em andamento (sem gravar recorde e sem snapshot
// para o F5) e volta à tela inicial, pronta para uma nova partida.
function abandonRun() {
  if (game.state !== STATES.PAUSED) return;
  releaseControl();
  closeHelp();
  JumpyStorage.clearRun();       // a partida descartada não pode voltar depois de um F5
  Sound.click();
  resetRound();                  // estado inicial + syncUi: volta para "Toque para iniciar"
}

function tryRestart() {
  if (game.state === STATES.GAME_OVER && game.overTime > 0.4) resetRound();
}

/* ===== PARTIDA SALVA (F5) E RETOMADA ===== */
// A partida ativa é gravada como UM snapshot (jumpy_storage.js), tirado de uma só vez a partir do estado
// do jogo: personagem, câmera, score, plataformas (com o tempo de quebra de cada uma), marcos, nuvens...
// Depois de F5 o jogo é reconstruído desse snapshot e fica congelado na tela PAUSADO até o jogador retomar.
let clockNow = 0;       // último timestamp recebido do requestAnimationFrame
let lastSaveAt = 0;     // instante (nesse mesmo relógio) da última gravação

function snapshotRun() {
  const p = game.player;
  return {
    score: game.score, height: game.height, maxHeight: game.maxHeight,
    time: game.time, camY: game.camY, lastCx: game.lastCx,
    markIdx: game.markIdx,
    reached: Object.keys(game.reached).map(Number),
    flashes: Object.keys(game.flashes).map((k) => [Number(k), game.flashes[k]]),
    rows: game.rows, lastBoostRow: game.lastBoostRow, lastBreakRow: game.lastBreakRow,
    segmentEndRow: game.segmentEndRow, segmentLeft: game.segmentLeft, inSegment: game.inSegment,
    last: { type: game.last.type, cx: game.last.cx, y: game.last.y, w: game.last.w },
    player: { x: p.x, y: p.y, vx: p.vx, vy: p.vy, facing: p.facing, tilt: p.tilt, squash: p.squash },
    platforms: game.platforms.map((q) => {
      const out = { type: q.type, x: q.x, y: q.y, w: q.w, h: q.h, dip: q.dip, breaking: q.breaking, breakT: q.breakT, dead: q.dead };
      if (q.type === 'moving') { out.minX = q.minX; out.maxX = q.maxX; out.dir = q.dir; out.speed = q.speed; }
      return out;
    }),
    clouds: clouds.map((c) => c.x),
  };
}

// Só existe partida "salvável" enquanto ela está ativa (jogando, pausada ou na contagem).
function persistRun() {
  const s = game.state;
  if (s !== STATES.PLAYING && s !== STATES.PAUSED && s !== STATES.RECOVERY) return;
  lastSaveAt = clockNow;
  JumpyStorage.saveRun(snapshotRun());
}

// Chamado a cada quadro, mas só grava de tempos em tempos. Pausado ou em contagem nada muda
// (e a pausa já gravou o quadro exato), então só grava jogando.
function autosaveRun() {
  if (game.state === STATES.PLAYING && clockNow - lastSaveAt >= CONFIG.persistence.saveIntervalMs) persistRun();
}

// Reconstrói a partida a partir do snapshot. Confere as regras do jogo ANTES de mexer no estado;
// se algo não fizer sentido, devolve false e o jogo fica na tela inicial.
function applyRun(run) {
  if (run.player.y - run.camY > H + 30) return false;   // já teria caído da tela
  if (!run.platforms.length) return false;

  resetRound();                                          // base limpa: um único lugar zera tudo
  game.score = run.score;
  game.height = run.height;
  game.maxHeight = run.maxHeight;
  game.time = run.time;
  game.camY = run.camY;
  game.lastCx = run.lastCx;
  game.rows = run.rows;
  game.lastBoostRow = run.lastBoostRow;
  game.lastBreakRow = run.lastBreakRow;
  game.segmentEndRow = run.segmentEndRow;
  game.segmentLeft = run.segmentLeft;
  game.inSegment = run.inSegment;
  game.last = { ...run.last };
  game.player = { ...run.player };
  game.platforms = run.platforms.map((q) => {
    const plat = { type: q.type, x: q.x, y: q.y, w: q.w, h: q.h, dip: q.dip, breaking: q.breaking, breakT: q.breakT, dead: q.dead };
    if (q.type === 'moving') { plat.minX = q.minX; plat.maxX = q.maxX; plat.dir = q.dir; plat.speed = q.speed; }
    return plat;
  });
  game.reached = {};
  for (const k of run.reached) game.reached[k] = true;
  game.flashes = {};
  for (const [k, t] of run.flashes) game.flashes[k] = t;
  game.markIdx = run.markIdx;
  game.nextMark = markerHeight(game.markIdx);
  while (game.score >= game.nextMark) {                  // confere os marcos sem disparar animação nova
    game.reached[game.nextMark] = true;
    game.markIdx++;
    game.nextMark = markerHeight(game.markIdx);
  }
  if (run.clouds.length === clouds.length) run.clouds.forEach((x, i) => { clouds[i].x = x; });
  return true;
}

// Só roda uma vez, no init, e só a partir da tela inicial. F5 -> restaura -> PAUSADO -> (jogador) -> 3, 2, 1, GO!.
function restoreSavedRun() {
  if (game.state !== STATES.READY) return false;
  const run = JumpyStorage.loadRun();
  if (!run) return false;
  if (!applyRun(run)) { JumpyStorage.clearRun(); return false; }
  game.state = STATES.PAUSED;      // volta congelada, na tela "PAUSADO": a contagem só começa quando o jogador pedir
  releaseControl();
  syncUi();
  return true;
}

// Congela a partida e inicia a contagem. Nada de gameplay anda enquanto o estado é RECOVERY.
function beginRecovery() {
  game.state = STATES.RECOVERY;
  recovery.remaining = CONFIG.recovery.seconds;
  recovery.go = 0;
  recovery.shown = null;
  releaseControl();
  syncUi();
}

function tickRecovery(dt) {
  recovery.remaining -= dt;
  if (recovery.remaining <= 0) endRecovery();
  else syncRecoveryUi();
}

function endRecovery() {
  game.state = STATES.PLAYING;
  recovery.remaining = 0;
  recovery.go = CONFIG.recovery.goSeconds;
  recovery.shown = null;
  lastTime = null;          // o primeiro quadro depois da contagem tem dt = 0: sem saltos
  syncUi();
}

function tickGo(dt) {
  recovery.go = Math.max(0, recovery.go - dt);
  if (recovery.go === 0) syncRecoveryUi();
}

/* ===== 3. PLATAFORMAS ===== */
function makePlatform(type, cx, y, w, h = PLAT.height) {
  const plat = { type, x: cx - w / 2, y, w, h, dip: 0, breaking: false, breakT: 0, dead: false };
  if (type === 'moving') {
    plat.minX = cx - PLAT.movingRange - w / 2;
    plat.maxX = cx + PLAT.movingRange - w / 2;
    plat.dir = Math.random() < 0.5 ? -1 : 1;
    plat.speed = lerp(PLAT.movingSpeedStart, PLAT.movingSpeedEnd, difficulty());
    plat.x = lerp(plat.minX, plat.maxX, Math.random());
  }
  return plat;
}

const rangeOf = (p) => (p.type === 'moving' ? PLAT.movingRange : 0);

function canReach(from, to) {
  const g = PLAYER.gravity, v = PLAYER.jumpVelocity;
  const rise = from.y - to.y;
  if (rise > (v * v) / (2 * g) * PLAT.reachHeight) return false;
  const t = (v + Math.sqrt(Math.max(0, v * v - 2 * g * Math.max(rise, 0)))) / g;
  const reach = PLAYER.maxSpeed * t * lerp(PLAT.reachSpeedStart, PLAT.reachSpeedEnd, difficulty());
  let dx = Math.abs(to.cx - from.cx);
  dx = Math.min(dx, W - dx);
  return dx + rangeOf(from) + rangeOf(to) - to.w / 2 <= reach;
}

function targetGap() {
  const t = PLAT.gapByScore, s = game.score;
  if (s >= t[t.length - 1][0]) return t[t.length - 1][1];
  for (let i = 1; i < t.length; i++) {
    if (s <= t[i][0]) return lerp(t[i - 1][1], t[i][1], (s - t[i - 1][0]) / (t[i][0] - t[i - 1][0]));
  }
  return t[0][1];
}

function randomWidth(d) {
  return Math.max(28, lerp(PLAT.widthStart, PLAT.widthEnd, d) * (0.9 + Math.random() * 0.2));
}

function sampleNext(from, type, d, scale = 1) {
  const w = randomWidth(d);
  const g = PLAYER.gravity, v = PLAYER.jumpVelocity;
  const gap = Math.min(clamp(targetGap() * (0.92 + Math.random() * 0.16) * scale, PLAT.gapMin, PLAT.gapMax),
    (v * v) / (2 * g) * PLAT.reachHeight - 1);
  const margin = type === 'moving' ? w / 2 + PLAT.movingRange + 2 : w / 2 + 4;
  const reach = PLAYER.maxSpeed * ((v + Math.sqrt(v * v - 2 * g * gap)) / g) * lerp(PLAT.reachSpeedStart, PLAT.reachSpeedEnd, d);
  const maxDx = reach + w / 2 - rangeOf(from) - (type === 'moving' ? PLAT.movingRange : 0);
  if (maxDx < 0) return null;
  const shift = Math.min(lerp(PLAT.shiftStart, PLAT.shiftEnd, d) * scale, maxDx);
  const cx = clamp(from.cx + (Math.random() * 2 - 1) * shift, margin, W - margin);
  const cand = { type, cx, y: from.y - gap, w };
  return canReach(from, cand) ? cand : null;
}

function pickSpecial(boostOk, breakOk) {
  const opts = [['moving', 0.72]];
  if (breakOk) opts.push(['breakable', 0.22]);
  if (boostOk) opts.push(['boost', 0.06]);
  let r = Math.random() * opts.reduce((s, o) => s + o[1], 0);
  for (const [type, weight] of opts) { if ((r -= weight) < 0) return type; }
  return 'moving';
}

function chooseType() {
  const d = difficulty();
  const boostOk = d >= PLAT.boostMinD && game.rows - game.lastBoostRow >= PLAT.boostMinRows;
  const breakOk = d >= PLAT.breakMinD && game.rows - game.lastBreakRow >= PLAT.breakMinRows;
  
  if (game.segmentLeft === 0 && d >= PLAT.segMinD && game.rows - game.segmentEndRow >= PLAT.segCooldown
      && Math.random() < lerp(0, PLAT.segChance, d)) {
    game.segmentLeft = PLAT.segRows[0] + Math.floor(Math.random() * (PLAT.segRows[1] - PLAT.segRows[0] + 1));
  }
  
  game.inSegment = game.segmentLeft > 0;
  if (game.inSegment) {
    if (--game.segmentLeft === 0) game.segmentEndRow = game.rows;
    return pickSpecial(boostOk, breakOk);
  }

  let r = Math.random();
  if (boostOk) { const p = lerp(PLAT.boostStart, PLAT.boostEnd, d); if (r < p) return 'boost'; r -= p; }
  if (breakOk) { const p = lerp(PLAT.breakStart, PLAT.breakEnd, d); if (r < p) return 'breakable'; r -= p; }
  if (game.rows >= PLAT.movingMinRows && r < lerp(PLAT.movingStart, PLAT.movingEnd, d)) return 'moving';
  return 'normal';
}

function findBackup(p, s, n, d) {
  const type = game.inSegment ? 'moving' : 'normal';
  const w = randomWidth(d);
  const margin = type === 'moving' ? w / 2 + PLAT.movingRange + 2 : w / 2 + 4;
  const options = [];
  for (let cx = margin; cx <= W - margin; cx += 12) {
    for (let k = 1; k <= 4; k++) {
      const c = { type, cx, y: p.y - (p.y - n.y) * (k / 5), w };
      if (Math.abs(cx - s.cx) < 55 || Math.abs(cx - n.cx) < 45) continue;
      if (p.y - c.y < 24 || c.y - n.y < 24) continue;
      if (canReach(p, c) && canReach(c, n)) options.push(c);
    }
  }
  return options.length ? options[Math.floor(Math.random() * options.length)] : null;
}

function planWithBackup(from, type, d) {
  const nType = game.inSegment ? 'moving' : 'normal';
  for (let i = 0; i < 20; i++) {
    const sc = 1 - i * 0.03;
    const s = sampleNext(from, type, d, sc);
    const n = s && sampleNext(s, nType, d, sc);
    const x = n && findBackup(from, s, n, d);
    if (x) return { s, n, x };
  }
  return null;
}

function addMain(c) {
  game.platforms.push(makePlatform(c.type, c.cx, c.y, c.w));
  game.last = c;
  game.rows++;
}

function spawnPlatform() {
  const d = difficulty();
  const from = game.last;
  let type = chooseType();
  
  if (type === 'breakable' || type === 'boost') {
    const plan = planWithBackup(from, type, d);
    if (plan) {
      game.platforms.push(makePlatform(plan.x.type, plan.x.cx, plan.x.y, plan.x.w));
      if (type === 'breakable') game.lastBreakRow = game.rows; else game.lastBoostRow = game.rows;
      addMain(plan.s);
      addMain(plan.n);
      if (game.inSegment && game.segmentLeft > 0 && --game.segmentLeft === 0) game.segmentEndRow = game.rows;
      return;
    }
    type = game.inSegment ? 'moving' : 'normal';
  }

  let cand = null;
  for (let i = 0; i < 12 && !cand; i++) cand = sampleNext(from, type, d, 1 - i * 0.05);
  addMain(cand || { type: 'normal', cx: from.cx, y: from.y - PLAT.gapMin, w: PLAT.widthStart });
}

function spawnPlatforms() {
  while (game.last.y > game.camY - 200) spawnPlatform();
  const limit = game.camY + H + 60;
  game.platforms = game.platforms.filter((p) => !p.dead && p.y <= limit);
}

/* ===== 4. FÍSICA ===== */
const input = { left: false, right: false, control: null };
let stageCssWidth = W;      // largura do palco na tela (px); o JS atualiza a cada redimensionamento

// Entrada horizontal: o teclado é digital (-1, 0, 1); o dedo é analógico (-1 a 1, já suavizado).
// Só existe UM dedo de controle por vez (input.control): outros toques simultâneos são ignorados.
function moveInput() {
  const c = input.control;
  return { key: (input.right ? 1 : 0) - (input.left ? 1 : 0), drag: c ? c.axis : 0, dragging: Boolean(c) };
}

// Suavização leve do eixo (uma vez por quadro, independente da taxa de quadros). Com 55/s o atraso é ~18 ms:
// serve só para esconder o "degrau" dos eventos de movimento, não para criar inércia.
function smoothDrags(dt) {
  const c = input.control;
  if (!c) return;
  const k = 1 - Math.exp(-CONFIG.input.dragSmoothing * dt);
  c.axis += (c.target - c.axis) * k;
  if (Math.abs(c.target - c.axis) < 0.002) c.axis = c.target;
}

function landsOn(p, plat, prevY) {
  if (plat.dead || p.vy <= 0 || prevY > plat.y || p.y < plat.y) return false;
  const half = PLAYER.hitWidth / 2;
  for (const off of [0, -W, W]) {
    if (p.x + off + half > plat.x && p.x + off - half < plat.x + plat.w) return true;
  }
  return false;
}

function stepPlayer(h, move, withLanding) {
  const p = game.player;
  if (move.key) {                       // teclado: igual a antes
    const dir = move.key;
    const turning = Math.sign(p.vx) === -dir ? 1.6 : 1;
    p.vx += dir * PLAYER.accel * turning * h;
    p.facing = dir;
  } else if (move.dragging) {           // arrasto: velocidade-alvo proporcional ao deslocamento do dedo
    const target = move.drag * PLAYER.maxSpeed;
    const turning = p.vx * target < 0 ? 1.6 : 1;
    const step = CONFIG.input.accel * turning * h;
    const diff = target - p.vx;
    p.vx = Math.abs(diff) <= step ? target : p.vx + Math.sign(diff) * step;
    if (Math.abs(move.drag) > 0.04) p.facing = Math.sign(move.drag);
  } else {
    const slow = PLAYER.decel * h;
    p.vx = Math.abs(p.vx) <= slow ? 0 : p.vx - Math.sign(p.vx) * slow;
  }
  
  p.vx = clamp(p.vx, -PLAYER.maxSpeed, PLAYER.maxSpeed);
  p.x += p.vx * h;
  if (p.x < 0) p.x += W;
  if (p.x >= W) p.x -= W;
  
  const prevY = p.y;
  p.vy = Math.min(p.vy + PLAYER.gravity * h, PLAYER.maxFallSpeed);
  p.y += p.vy * h;

  if (!withLanding) return;
  for (const plat of game.platforms) {
    if (landsOn(p, plat, prevY)) {
      p.y = plat.y;
      const boost = plat.type === 'boost';
      p.vy = -PLAYER.jumpVelocity * (boost ? PLAT.boostMultiplier : 1);
      p.squash = PLAYER.squashTime;
      plat.dip = 1;
      if (plat.type === 'breakable' && !plat.breaking) { 
        plat.breaking = true; plat.breakT = 0; if (game.state === STATES.PLAYING) Sound.crack(); 
      }
      if (game.state === STATES.PLAYING) { if (boost) Sound.boost(); else Sound.bounce(); }
      break;
    }
  }
}

function updatePlatforms(dt) {
  for (const plat of game.platforms) {
    if (plat.dip > 0) plat.dip = Math.max(0, plat.dip - dt * 7);
    if (plat.type === 'moving') {
      plat.x += plat.dir * plat.speed * dt;
      if (plat.x <= plat.minX) { plat.x = plat.minX; plat.dir = 1; }
      else if (plat.x >= plat.maxX) { plat.x = plat.maxX; plat.dir = -1; }
    } else if (plat.breaking && !plat.dead) {
      plat.breakT += dt;
      if (plat.breakT >= PLAT.breakTime) { plat.dead = true; Sound.crumble(); }
    }
  }
}

function animatePlayer(dt) {
  const p = game.player;
  p.squash = Math.max(0, p.squash - dt);
  p.tilt += ((p.vx / PLAYER.maxSpeed) * 0.3 - p.tilt) * Math.min(1, 12 * dt);
  updatePlatforms(dt);
}

/* ===== 5. CÂMERA E PONTUAÇÃO ===== */
function updateCamera(dt) {
  const target = game.player.y - H * CONFIG.camera.followLine;
  if (target < game.camY) game.camY += (target - game.camY) * Math.min(1, 14 * dt);
  if (game.player.y - game.camY < H * CONFIG.camera.followLine - 2 && target < game.camY) game.camY = target;
}

function updateScore() {
  const ppp = CONFIG.scoring.pixelsPerPoint;
  game.height = Math.max(0, Math.floor((PLAT.groundY - game.player.y) / ppp));   // altura atual (ex.: 347)
  game.maxHeight = Math.max(game.maxHeight, PLAT.groundY - game.player.y);
  game.score = Math.floor(game.maxHeight / ppp);                                 // recorde da partida
  while (game.score >= game.nextMark) {
    game.reached[game.nextMark] = true;
    game.flashes[game.nextMark] = 0;                                             // dispara a animação
    game.markIdx++;
    game.nextMark = markerHeight(game.markIdx);
  }
}

function updateScenery(dt) {
  for (const c of clouds) {
    c.x -= c.speed * dt;
    if (c.x + c.sprite.width < 0) c.x = W + Math.random() * 30;
  }
}

function update(dt) {
  // Pausado: o jogo todo fica congelado (física, plataformas e seus relógios, câmera, score, nuvens).
  if (game.state === STATES.PAUSED) return;
  // Contagem depois do F5: continua tudo congelado, só a contagem anda.
  if (game.state === STATES.RECOVERY) { tickRecovery(dt); return; }
  game.time += dt;
  updateScenery(dt);
  if (game.state === STATES.GAME_OVER) { game.overTime += dt; return; }
  if (recovery.go > 0) tickGo(dt);
  
  const playing = game.state === STATES.PLAYING;
  for (const k of Object.keys(game.flashes)) {
    game.flashes[k] += dt;
    if (game.flashes[k] > CONFIG.markers.flashTime) delete game.flashes[k];
  }
  
  const steps = Math.max(1, Math.ceil(dt / CONFIG.timing.physicsStep));
  const h = dt / steps;
  // Antes de iniciar (READY) o personagem fica parado: sem gravidade nem pulo.
  if (playing) {
    smoothDrags(dt);
    const move = moveInput();
    for (let i = 0; i < steps; i++) stepPlayer(h, move, true);
  }
  animatePlayer(dt);
  
  if (!playing) return;
  updateScore();
  updateCamera(dt);
  spawnPlatforms();
  if (game.player.y - game.camY > H + 30) endGame();
}

/* ===== 6. SPRITES ===== */
const canvas = document.getElementById('game-canvas');
const viewCtx = canvas.getContext('2d');
const worldCanvas = makeCanvas(W, H);
const ctx = worldCanvas.getContext('2d');

function makeCanvas(width, height) {
  const el = document.createElement('canvas');
  el.width = width; el.height = height;
  return el;
}

function seededRandom(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rect(target, color, x, y, w, h) {
  target.fillStyle = color;
  target.fillRect(x, y, w, h);
}

function pixelDisc(target, color, cx, cy, r, cell) {
  target.fillStyle = color;
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.round(Math.sqrt(r * r - dy * dy));
    target.fillRect((cx - half) * cell, (cy + dy) * cell, half * 2 * cell, cell);
  }
}

function buildPlayerFrames() {
  return [0, 1].map((spread) => {
    const s = makeCanvas(20, 20);
    const g = s.getContext('2d');
    const feet = spread ? [2, 14] : [4, 12];
    for (const fx of feet) { rect(g, COLORS.ink, fx, 16, 4, 4); rect(g, COLORS.bodyShade, fx + 1, 16, 2, 3); }
    rect(g, COLORS.ink, 1, 0, 18, 17);
    rect(g, COLORS.body, 2, 1, 16, 15);
    rect(g, COLORS.bodyLight, 2, 1, 16, 3);
    rect(g, COLORS.bodyShade, 2, 13, 16, 3);
    rect(g, COLORS.white, 4, 5, 5, 6); rect(g, COLORS.white, 11, 5, 5, 6);
    rect(g, COLORS.ink, 6, 7, 3, 4); rect(g, COLORS.ink, 13, 7, 3, 4);
    return s;
  });
}

function buildSky() {
  const s = makeCanvas(W, H);
  const g = s.getContext('2d');
  const bands = COLORS.skyBands;
  const bh = Math.ceil(H / bands.length);
  bands.forEach((c, i) => rect(g, c, 0, i * bh, W, bh));
  return s;
}

function buildHills(seed, color, cell, minR, varR, height) {
  const s = makeCanvas(W, height);
  const g = s.getContext('2d');
  const rnd = seededRandom(seed);
  const cols = W / cell, rows = height / cell;
  rect(g, color, 0, height * 0.55, W, height);
  for (let cx = 0; cx < cols; cx += 9 + Math.floor(rnd() * 8)) {
    const r = minR + Math.floor(rnd() * varR);
    for (const shift of [-cols, 0, cols]) pixelDisc(g, color, cx + shift, rows - Math.floor(r * 0.55), r, cell);
  }
  return s;
}

function buildClouds() {
  const shapes = [
    [[8, 12, 5], [14, 9, 7], [21, 11, 6], [26, 13, 4], [17, 14, 5]],
    [[6, 10, 4], [11, 8, 6], [17, 10, 5], [21, 11, 3]],
  ];
  return shapes.map((discs) => {
    const s = makeCanvas(76, 52);
    const g = s.getContext('2d');
    for (const [cx, cy, r] of discs) pixelDisc(g, COLORS.cloudShade, cx, cy, r, 2);
    for (const [cx, cy, r] of discs) pixelDisc(g, COLORS.cloud, cx, cy - 1, r, 2);
    return s;
  });
}

const sprites = {
  sky: buildSky(),
  hillsFar: buildHills(11, COLORS.hillFar, 2, 7, 6, 120),
  hillsNear: buildHills(23, COLORS.hillNear, 2, 5, 5, 80),
  player: buildPlayerFrames(),
  clouds: buildClouds(),
};

function initClouds() {
  const rnd = seededRandom(5);
  for (let i = 0; i < CONFIG.scenery.cloudCount; i++) {
    clouds.push({
      sprite: sprites.clouds[i % sprites.clouds.length],
      x: rnd() * W, y: rnd() * (H + 60),
      speed: 6 + rnd() * 8, depth: 0.08 + rnd() * 0.14,
    });
  }
}

const FONT = {
  S: '111100111001111', C: '111100100100111', O: '111101101101111', R: '110101110101101',
  E: '111100111100111', M: '101111111101101', T: '111010010010010', ':': '000010000010000', ' ': '000000000000000',
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111',
  4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001001001001',
  8: '111101111101111', 9: '111101111001111',
};

function drawText(text, x, y, cell, color = COLORS.white) {
  const o = cell >= 3 ? 2 : 1;
  for (const pass of ['outline', 'fill']) {
    let cx = x;
    for (const ch of text) {
      const bits = FONT[ch] || FONT[' '];
      for (let i = 0; i < 15; i++) {
        if (bits[i] !== '1') continue;
        const px = cx + (i % 3) * cell, py = y + Math.floor(i / 3) * cell;
        if (pass === 'outline') rect(ctx, COLORS.ink, px - o, py - o, cell + o * 2, cell + o * 2);
        else rect(ctx, color, px, py, cell, cell);
      }
      cx += cell * 4;
    }
  }
}

/* ===== 7. RENDERIZAÇÃO ===== */
function drawTiled(sprite, offsetX, y) {
  const x = -(((Math.floor(offsetX) % W) + W) % W);
  ctx.drawImage(sprite, x, y);
  ctx.drawImage(sprite, x + W, y);
}

const PALETTES = {
  normal:    { top: '#78c72f', light: '#a6ea58', dark: '#4f9420', body: '#c4824a', bodyDark: '#a76a36', speck: '#dba46a' },
  moving:    { top: '#3b8fe0', light: '#7fc4ff', dark: '#245fa8', body: '#8a93a8', bodyDark: '#646c82', speck: '#b4bccf' },
  breakable: { top: '#e6c27a', light: '#f6dc9a', dark: '#b98d4a', body: '#c9a26a', bodyDark: '#a07a45', speck: '#e3c08a' },
  boost:     { top: '#e552e0', light: '#ff9cf5', dark: '#a02a9c', body: '#7b3fb8', bodyDark: '#582c8a', speck: '#a67ae0' },
};

function drawPlatform(plat) {
  const pal = PALETTES[plat.type];
  const w = Math.round(plat.w), h = plat.h;
  let x = Math.round(plat.x);
  const y = Math.round(plat.y - game.camY) + Math.round(plat.dip * 2);
  
  if (y > H + 10 || y + h < -10) return;
  const f = plat.breaking ? plat.breakT / PLAT.breakTime : 0;
  
  if (plat.breaking) {
    x += Math.round(Math.sin(plat.breakT * 70) * f * 2);
    if (f > 0.7 && Math.floor(plat.breakT * 14) % 2) ctx.globalAlpha = 0.45;
  }

  rect(ctx, COLORS.ink, x - 2, y - 2, w + 4, h + 4);
  rect(ctx, pal.body, x, y, w, h);
  rect(ctx, pal.bodyDark, x, y + h - 3, w, 3);
  for (let i = 0; i < w - 6; i += 12) {
    rect(ctx, i % 24 ? pal.speck : pal.bodyDark, x + 4 + i, y + 7 + (i % 3) * 2, 3, 2);
  }
  rect(ctx, pal.top, x, y, w, 5);
  rect(ctx, pal.light, x, y, w, 2);
  rect(ctx, pal.dark, x, y + 5, w, 2);
  if (plat.type === 'normal') for (let i = 2; i < w - 2; i += 6) rect(ctx, pal.dark, x + i, y + 7, 2, 2);

  const mid = x + Math.floor(w / 2);
  if (plat.type === 'moving' && w >= 36) {
    for (const [ax, s] of [[x + 6, 1], [x + w - 8, -1]]) {
      rect(ctx, COLORS.white, ax + (s > 0 ? 0 : 2), y + 7, 2, 2);
      rect(ctx, COLORS.white, ax + (s > 0 ? -2 : 4), y + 9, 2, 2);
      rect(ctx, COLORS.white, ax + (s > 0 ? 0 : 2), y + 11, 2, 2);
    }
  } else if (plat.type === 'breakable') {
    const n = 1 + Math.floor(f * 4);
    for (let k = 1; k <= n; k++) {
      const cx = x + Math.floor((w * k) / (n + 1));
      rect(ctx, COLORS.ink, cx, y + 5, 1, 4); rect(ctx, COLORS.ink, cx + 1, y + 9, 1, 3); rect(ctx, COLORS.ink, cx - 1, y + 12, 1, 2);
    }
  } else if (plat.type === 'boost') {
    rect(ctx, '#ffe36a', mid - 1, y + 7, 2, 6);
    rect(ctx, '#ffe36a', mid - 3, y + 9, 6, 1);
    rect(ctx, '#ffe36a', mid - 2, y + 8, 4, 1);
    const sh = 6 - Math.round(plat.dip * 3);
    rect(ctx, COLORS.ink, mid - 6, y - 2 - sh, 12, 3);
    rect(ctx, '#ffe36a', mid - 5, y - 1 - sh, 10, 1);
    rect(ctx, COLORS.ink, mid - 4, y - sh, 8, sh);
    for (let i = 1; i < sh; i += 2) rect(ctx, '#e552e0', mid - 3, y - sh + i, 6, 1);
  }
  ctx.globalAlpha = 1;
}

// Trechos horizontais (em px de tela) ocupados por plataformas na faixa vertical [y0, y1].
function occupied(y0, y1) {
  const out = [];
  for (const p of game.platforms) {
    if (p.dead) continue;
    const sy = Math.round(p.y - game.camY);
    const top = sy - (p.type === 'boost' ? 14 : 3), bottom = sy + p.h + 4;
    if (bottom < y0 || top > y1) continue;
    out.push([Math.round(p.x) - 3, Math.round(p.x + p.w) + 3]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

// Preenche [x0, x1] pulando os trechos ocupados (a linha nunca cobre uma plataforma).
function fillFree(x0, x1, y, h, color, spans) {
  let cur = x0;
  for (const [a, b] of spans) {
    if (b <= cur) continue;
    if (a >= x1) break;
    if (a > cur) rect(ctx, color, cur, y, a - cur, h);
    cur = Math.max(cur, b);
  }
  if (cur < x1) rect(ctx, color, cur, y, x1 - cur, h);
}

// Marcos fixos: cinza discreto até serem alcançados; depois pisca, fica dourado e se acalma.
function drawMarkers() {
  const M = CONFIG.markers, ppp = CONFIG.scoring.pixelsPerPoint;
  const top = (PLAT.groundY - game.camY) / ppp;
  const bottom = (PLAT.groundY - game.camY - H) / ppp;
  const GOLD = '#ffd34a';
  
  for (let i = 0; markerHeight(i) <= top + 2; i++) {
    const k = markerHeight(i);
    if (k < bottom - 2) continue;
    const reached = Boolean(game.reached[k]);
    if (!reached && M.upcomingAlpha <= 0) continue;

    const t = game.flashes[k];
    let alpha = reached ? M.settledAlpha : M.upcomingAlpha;
    let color = reached ? GOLD : COLORS.white, lift = 0;
    
    if (reached && t !== undefined) {
      if (t < M.blinkTime) {                                   // passagem: pisca e dá um pulinho
        alpha = Math.floor(t * M.blinkRate) % 2 ? 0.6 : 1;
        lift = t < 0.15 ? -2 : 0;
        if (Math.floor(t * 7) % 2) color = '#fff3a8';
      } else {                                                 // acalma até o dourado discreto
        alpha = lerp(0.9, M.settledAlpha, (t - M.blinkTime) / (M.flashTime - M.blinkTime));
      }
    }

    const y = Math.round(PLAT.groundY - k * ppp - game.camY) + lift;
    const label = `${k} M`, cell = 2, tw = label.length * cell * 4 - cell;
    const spans = occupied(y - 12, y + 5);

    // posição do texto: centro, ou um dos lados se houver plataforma ali
    let tx = Math.round((W - tw) / 2);
    for (const cand of [tx, Math.round(W * 0.2), Math.round(W * 0.8 - tw)]) {
      if (!spans.some(([a, b]) => cand - 4 < b && cand + tw + 4 > a)) { tx = cand; break; }
    }

    ctx.globalAlpha = alpha;
    for (const [x0, x1] of [[0, tx - 8], [tx + tw + 8, W]]) {
      if (reached) {                                           // linha dupla ═══
        fillFree(x0, x1, y - 1, 5, COLORS.ink, spans);
        fillFree(x0, x1, y, 1, color, spans);
        fillFree(x0, x1, y + 2, 1, color, spans);
      } else {
        fillFree(x0, x1, y, 1, color, spans);
      }
    }
    drawText(label, tx, y - 5, cell, color);
    ctx.globalAlpha = 1;
  }
}

function drawPlayer() {
  const p = game.player;
  const frame = sprites.player[p.vy < 0 ? 1 : 0];
  const sq = p.squash / PLAYER.squashTime;
  const sy = sq > 0 ? 1 - 0.3 * sq : (p.vy < -700 ? 1.25 : p.vy < -200 ? 1.1 : 1);
  const sx = 1 / sy;
  const fy = Math.round(p.y - game.camY);
  
  for (const off of [0, -W, W]) {
    const cx = Math.round(p.x + off);
    if (cx < -PLAYER.width || cx > W + PLAYER.width) continue;
    ctx.save();
    ctx.translate(cx, fy);
    ctx.rotate(p.tilt);
    ctx.scale(p.facing * sx, sy);
    ctx.drawImage(frame, -PLAYER.width / 2, -PLAYER.height);
    ctx.restore();
  }
}

function renderWorld() {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sprites.sky, 0, 0);
  const camY = game.camY;
  
  for (const c of clouds) {
    const sy = ((((c.y - camY * c.depth) % (H + 60)) + (H + 60)) % (H + 60)) - 40;
    ctx.drawImage(c.sprite, Math.round(c.x), Math.round(sy));
  }

  // Colinas: ficam para trás conforme a câmera sobe (paralaxe).
  const far = H - 120 - camY * 0.35;
  const near = H - 80 - camY * 0.55;
  if (far < H) { ctx.drawImage(sprites.hillsFar, 0, Math.round(far)); rect(ctx, COLORS.hillFar, 0, Math.round(far) + 120, W, H); }
  if (near < H) { ctx.drawImage(sprites.hillsNear, 0, Math.round(near)); rect(ctx, COLORS.hillNear, 0, Math.round(near) + 80, W, H); }

  for (const plat of game.platforms) drawPlatform(plat);
  drawMarkers();
  drawPlayer();

  if (game.state !== STATES.READY) drawText(`SCORE: ${game.score}`, 8, 8, 3);
}

function render() {
  renderWorld();
  viewCtx.imageSmoothingEnabled = false;
  viewCtx.drawImage(worldCanvas, 0, 0, canvas.width, canvas.height);
}

/* ===== 8. INTERFACE ===== */
const ui = {
  arena: document.getElementById('arena'),
  stage: document.getElementById('stage'),
  pauseButton: document.getElementById('pause-button'),
  muteButton: document.getElementById('mute-button'),
  restartButton: document.getElementById('restart-button'),
  pauseRestart: document.getElementById('pause-restart'),
  recoveryCount: document.getElementById('recovery-count'),
  overScore: document.getElementById('over-score'),
  readyBest: document.getElementById('ready-best'),
  readyBestValue: document.getElementById('ready-best-value'),
  helpButton: document.getElementById('help-button'),
  helpPopover: document.getElementById('help-popover'),
  helpClose: document.getElementById('help-close'),
};

function syncUi() {
  const s = game.state;
  ui.stage.classList.toggle('is-ready', s === STATES.READY);
  ui.stage.classList.toggle('is-playing', s === STATES.PLAYING);
  ui.stage.classList.toggle('is-paused', s === STATES.PAUSED);
  ui.stage.classList.toggle('is-recovery', s === STATES.RECOVERY);
  ui.stage.classList.toggle('is-over', s === STATES.GAME_OVER);
  // Botão de pausa: continua no mesmo lugar em todos os estados da partida; só o ícone muda.
  const paused = s === STATES.PAUSED;
  const pauseText = paused ? 'Continuar' : 'Pausar';
  ui.pauseButton.classList.toggle('is-paused', paused);
  ui.pauseButton.disabled = s === STATES.RECOVERY;      // na contagem ele fica visível, mas não faz nada
  ui.pauseButton.setAttribute('aria-label', pauseText);
  ui.pauseButton.dataset.tip = pauseText + ' (P)';   // tooltip em CSS (data-tip): sem title nativo
  if (s === STATES.GAME_OVER) ui.overScore.textContent = String(game.score);
  if (s === STATES.READY) {                     // recorde na tela inicial (só depois de existir um)
    const best = JumpyStorage.getBest();
    ui.readyBest.hidden = best <= 0;
    ui.readyBestValue.textContent = String(best);
  }
  syncRecoveryUi();
}

// Contagem "Partida retomada" (3, 2, 1) e o "GO!" logo depois. Só mexe no DOM quando o texto muda.
function syncRecoveryUi() {
  const counting = game.state === STATES.RECOVERY;
  const going = game.state === STATES.PLAYING && recovery.go > 0;
  ui.stage.classList.toggle('is-go', going);

  let text = null;
  if (counting) text = String(Math.max(1, Math.ceil(recovery.remaining)));
  else if (going) text = 'GO!';

  if (text === null) { recovery.shown = null; return; }
  if (text !== recovery.shown) {
    recovery.shown = text;
    const el = ui.recoveryCount;
    el.textContent = text;
    el.classList.toggle('is-go', going);
    el.classList.remove('pop');
    void el.offsetWidth;               // reinicia a animação a cada número
    el.classList.add('pop');
  }
}

function syncMuteButton() {
  const m = Sound.muted;
  ui.muteButton.classList.toggle('is-muted', m);
  ui.muteButton.setAttribute('aria-pressed', m ? 'true' : 'false');
  ui.muteButton.setAttribute('aria-label', m ? 'Ativar efeitos sonoros' : 'Silenciar efeitos sonoros');
}

function toggleMute() {
  Sound.setMuted(!Sound.muted);
  syncMuteButton();
  Sound.click();
}

// Ajuda "Como jogar": popover pequeno ancorado ao botão "?", fora da área do jogo.
// Abrir a ajuda durante uma partida PAUSA o jogo (tudo congelado atrás do painel). Fechar a ajuda (X, Esc, toque fora)
// só fecha o painel: o jogo continua pausado até o jogador tocar na área do jogo (ou usar Continuar/P/Espaço).
let helpOpen = false;
const HELP = { gap: 12, edge: 8, minWidth: 176, maxWidth: 244 };

function openHelp() {
  if (helpOpen) return;
  helpOpen = true;
  ui.helpPopover.hidden = false;
  ui.helpButton.setAttribute('aria-expanded', 'true');
  pauseForHelp();
  placeHelp();
}

// Jogando (ou na contagem) -> pausa. Já pausado -> continua pausado. Em todo caso a retomada é pelo toque no jogo.
function pauseForHelp() {
  if (game.state === STATES.PLAYING || game.state === STATES.RECOVERY) setPaused(true);
}

function closeHelp() {
  if (!helpOpen) return;
  helpOpen = false;
  ui.helpPopover.hidden = true;
  ui.helpButton.setAttribute('aria-expanded', 'false');
}

// Preferência: abrir ABAIXO do botão. Se faltar altura abaixo, abre ao lado do botão (celular deitado).
// Na faixa sob o jogo (celular em pé) não há espaço abaixo: abre acima do botão.
function placeHelp() {
  if (!helpOpen) return;
  const pop = ui.helpPopover;
  for (const v of ['--pop-x', '--pop-y', '--arrow-x', '--arrow-y', 'max-height', 'overflow-y']) pop.style.removeProperty(v);

  const arena = ui.arena.getBoundingClientRect();
  const btn = ui.helpButton.getBoundingClientRect();
  const stage = ui.stage.getBoundingClientRect();
  const strip = ui.arena.classList.contains('help-bottom');

  // Largura e borda esquerda (coordenadas da janela) do painel quando ele fica abaixo/acima do botão.
  const freeSide = arena.right - HELP.edge - (stage.right + HELP.edge);   // faixa livre à direita do palco
  let width, left;
  if (strip) {
    width = Math.min(HELP.maxWidth, arena.width - HELP.edge * 2);
    left = Math.max(arena.left + HELP.edge, Math.min(btn.right, arena.right - HELP.edge) - width);
  } else if (freeSide >= HELP.minWidth) {
    width = Math.min(HELP.maxWidth, freeSide);
    left = Math.max(stage.right + HELP.edge, Math.min(btn.left, arena.right - HELP.edge - width));
  } else {
    // Sem faixa livre ao lado do palco: o painel invade o mínimo possível do jogo.
    width = Math.min(HELP.minWidth, arena.width - HELP.edge * 2);
    left = Math.max(arena.left + HELP.edge, arena.right - HELP.edge - width);
  }
  width = Math.floor(width);
  pop.style.width = `${width}px`;

  const height = pop.offsetHeight;
  const roomBelow = arena.bottom - btn.bottom - HELP.gap - HELP.edge;
  const roomAbove = btn.top - arena.top - HELP.gap - HELP.edge;
  const roomSide = arena.right - btn.right - HELP.gap - HELP.edge;
  let placement = strip ? 'above' : 'below';
  if (!strip && height > roomBelow && roomSide >= HELP.minWidth) placement = 'side';

  if (placement === 'side') {
    pop.style.width = `${Math.floor(Math.min(HELP.maxWidth, roomSide))}px`;
    const h = pop.offsetHeight;
    // Alinha ao topo do botão; se faltar altura, sobe o painel (a seta continua apontando para o botão).
    let up = Math.max(0, btn.top + h - (arena.bottom - HELP.edge));
    up = Math.min(up, Math.max(0, btn.top - (arena.top + HELP.edge)));
    pop.style.setProperty('--pop-y', `${-up}px`);
    pop.style.setProperty('--arrow-y', `${Math.min(Math.max(22 + up, 16), Math.max(16, h - 16))}px`);
  } else {
    const arrowX = Math.min(Math.max(btn.left + btn.width / 2 - left, 16), width - 16);
    pop.style.setProperty('--pop-x', `${Math.round(left - btn.left)}px`);
    pop.style.setProperty('--arrow-x', `${Math.round(arrowX)}px`);
    const room = placement === 'above' ? roomAbove : roomBelow;
    if (height > room) {            // último recurso: limita a altura e deixa o conteúdo rolar
      pop.style.maxHeight = `${Math.max(96, Math.floor(room))}px`;
      pop.style.overflowY = 'auto';
    }
  }
  pop.dataset.placement = placement;
}

/* ===== 9. ENTRADA ===== */
const LEFT_KEYS = new Set(['ArrowLeft', 'KeyA']);
const RIGHT_KEYS = new Set(['ArrowRight', 'KeyD']);

function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Com a ajuda aberta, Esc fecha só o painel (não pausa o jogo).
  if (helpOpen && e.code === 'Escape') { e.preventDefault(); closeHelp(); return; }
  // Espaço/Enter com um botão focado (ex.: o "?") ativa o botão, não o jogo.
  if ((e.code === 'Space' || e.code === 'Enter') && e.target.closest && e.target.closest('button')) return;
  Sound.unlock();
  const isLeft = LEFT_KEYS.has(e.code), isRight = RIGHT_KEYS.has(e.code);
  if (isLeft || isRight) {
    e.preventDefault();
    if (isLeft) input.left = true; else input.right = true;
    startGame();
  } else if (e.code === 'KeyM' && !e.repeat) {
    toggleMute();
  } else if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) {
    setPaused(game.state === STATES.PLAYING);
  } else if (e.code === 'Space' || e.code === 'Enter') {
    if (game.state === STATES.READY) { e.preventDefault(); startGame(); }
    else if (game.state === STATES.GAME_OVER) { e.preventDefault(); tryRestart(); }
    else if (game.state === STATES.PAUSED) { e.preventDefault(); setPaused(false); }
  }
}

function onKeyUp(e) {
  if (LEFT_KEYS.has(e.code)) input.left = false;
  if (RIGHT_KEYS.has(e.code)) input.right = false;
}

// Controle por arrastar (toque/mouse), ANALÓGICO e RELATIVO.
//  - O ponto onde o dedo encostou é a referência (anchorX). O deslocamento horizontal em relação a ela vira
//    a intensidade (-1 a 1): pouco arrasto = pouca força; muito = força máxima; voltando, a força cai junto
//    (zero na referência). O personagem NÃO segue a posição do dedo: a intensidade só define a velocidade-alvo
//    que a física do personagem (aceleração, inércia, wrap) persegue.
//  - Passou da força máxima, a referência acompanha o dedo (anchorFollow): quem arrastou "demais" não precisa
//    desfazer o excesso antes de inverter o sentido.
//  - Um único ponteiro de controle (pointerId) com setPointerCapture: segundo dedo não interfere, e o arrasto
//    continua válido mesmo fora do canvas ou da janela, até pointerup/pointercancel.
//  - Enquanto o jogo não está em PLAYING (início, contagem 3-2-1), o dedo já é rastreado e a referência fica
//    colada nele: quando o jogo anda, o dedo que está na tela já controla, sem precisar levantar e tocar de novo.
function dragMetrics() {
  const cfg = CONFIG.input;
  const width = Math.max(1, stageCssWidth);
  const dead = width * cfg.dragDeadZone;
  const range = Math.max(dead + 1, width * cfg.dragRange);
  return { dead, range };
}

// Converte o deslocamento (px) em intensidade analógica contínua: zero dentro da dead zone, cresce sem degrau
// a partir da borda dela e chega a 1 em `range`.
function axisFromOffset(dx) {
  const { dead, range } = dragMetrics();
  const t = clamp((Math.abs(dx) - dead) / (range - dead), 0, 1);
  return Math.sign(dx) * Math.pow(t, CONFIG.input.dragCurve);
}

function updateControl(c, x) {
  c.x = x;
  if (game.state !== STATES.PLAYING) { c.anchorX = x; c.target = 0; return; }   // ainda não vale: referência cola no dedo
  const { dead, range } = dragMetrics();
  let dx = x - c.anchorX;
  if (CONFIG.input.anchorFollow) {
    const limit = dead + range;                       // deslocamento que já dá 100%
    if (dx > limit) { c.anchorX = x - limit; dx = limit; }
    else if (dx < -limit) { c.anchorX = x + limit; dx = -limit; }
  }
  c.target = axisFromOffset(dx);
}

function beginControl(e) {
  if (input.control) return;                          // já há um dedo no comando: o outro é ignorado
  if (game.state !== STATES.PLAYING && game.state !== STATES.RECOVERY) return;
  input.control = { id: e.pointerId, x: e.clientX, anchorX: e.clientX, target: 0, axis: 0 };
  try { ui.arena.setPointerCapture(e.pointerId); } catch (error) { /* sem captura: os eventos ainda chegam ao document */ }
}

function releaseControl() {
  const c = input.control;
  if (!c) return;
  input.control = null;                               // soltou: a entrada volta a zero imediatamente
  try { ui.arena.releasePointerCapture(c.id); } catch (error) { /* já liberado */ }
}

function onPointerDown(e) {
  const hit = (selector) => Boolean(e.target.closest && e.target.closest(selector));
  // Tela PAUSADO: tocar/clicar na área do jogo (fora dos botões) fecha a ajuda, se aberta, e inicia a contagem 3, 2, 1, GO!.
  if (game.state === STATES.PAUSED && hit('#stage') && !hit('button, a')) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    Sound.unlock();
    setPaused(false);
    beginControl(e);          // o dedo que retomou o jogo já fica rastreado durante a contagem
    return;
  }
  // Ajuda aberta: tocar fora só a fecha (não vira início de partida nem movimento).
  if (helpOpen && !hit('.help')) {
    closeHelp();
    if (!hit('button, a, header')) { e.preventDefault(); return; }
  }
  if (hit('button, a, header, .help')) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  Sound.unlock();
  if (game.state === STATES.READY) startGame();
  beginControl(e);
}

function onPointerMove(e) {
  const c = input.control;
  if (!c || c.id !== e.pointerId) return;
  if (e.cancelable) e.preventDefault();
  updateControl(c, e.clientX);
}

function onPointerEnd(e) {
  const c = input.control;
  if (c && c.id === e.pointerId) releaseControl();
}

/* ===== 10. REDIMENSIONAMENTO ===== */
// O botão de ajuda fica ao lado do palco. Sem espaço lateral (celular em pé), ele vai
// para uma faixa logo abaixo do jogo, e essa faixa é descontada da altura disponível.
const HELP_SIDE_ROOM = 68;   // folga (16) + botão (44) + margem (8)
const HELP_STRIP = 56;

function fitStage(reserveY) {
  const { margin, maxCssHeight } = CONFIG.view;
  const availW = Math.max(1, ui.arena.clientWidth - margin * 2);
  const availH = Math.max(1, ui.arena.clientHeight - margin * 2 - reserveY);
  const ratio = W / H;
  let cssH = Math.min(availH, maxCssHeight);
  let cssW = cssH * ratio;
  if (cssW > availW) { cssW = availW; cssH = cssW / ratio; }
  return { cssW: Math.floor(cssW), cssH: Math.floor(cssH) };
}

function resizeCanvas() {
  let { cssW, cssH } = fitStage(0);
  const stripMode = (ui.arena.clientWidth - cssW) / 2 < HELP_SIDE_ROOM;
  if (stripMode) ({ cssW, cssH } = fitStage(HELP_STRIP));
  ui.arena.classList.toggle('help-bottom', stripMode);

  const dpr = window.devicePixelRatio || 1;
  ui.stage.style.width = `${cssW}px`;
  ui.stage.style.height = `${cssH}px`;
  ui.stage.style.setProperty('--u', `${cssW / W}px`);
  stageCssWidth = cssW;
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  render();
  placeHelp();   // reposiciona o painel de ajuda, se estiver aberto
}

/* ===== 11. LOOP E INICIALIZAÇÃO ===== */
let rafId = null;
let lastTime = null;

function frame(now) {
  rafId = requestAnimationFrame(frame);
  clockNow = now;
  if (lastTime === null) lastTime = now;
  const dt = Math.min(Math.max((now - lastTime) / 1000, 0), CONFIG.timing.maxFrameTime);
  lastTime = now;
  update(dt);
  autosaveRun();
  render();
}

function init() {
  initClouds();
  resetRound();
  restoreSavedRun();    // partida salva em andamento? volta congelada, com contagem 3, 2, 1
  syncMuteButton();
  document.addEventListener('keydown', onKeyDown, { passive: false });
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('pointerdown', onPointerDown, { passive: false });
  document.addEventListener('pointermove', onPointerMove, { passive: false });
  // Reforço para navegadores que ignoram touch-action: arrastar na área do jogo nunca rola a página.
  ui.arena.addEventListener('touchmove', (e) => {
    if (e.cancelable && !(e.target.closest && e.target.closest('.help-popover'))) e.preventDefault();
  }, { passive: false });
  document.addEventListener('pointerup', (e) => { onPointerEnd(e); Sound.unlock(); });
  document.addEventListener('pointercancel', onPointerEnd);
  document.addEventListener('lostpointercapture', onPointerEnd);
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  
  window.addEventListener('blur', () => {
    input.left = input.right = false;
    releaseControl();
    setPaused(true);
  });
  document.addEventListener('visibilitychange', () => {
    lastTime = null;
    if (document.hidden) { setPaused(true); persistRun(); }   // saiu da aba / recarregando: grava o quadro exato
  });
  window.addEventListener('pagehide', persistRun);            // F5 / fechar: grava o estado exato

  ui.helpButton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (helpOpen) closeHelp(); else openHelp();
    if (e.detail > 0) ui.helpButton.blur();   // clique/toque: Espaço não deve acionar o botão depois
  });
  ui.helpClose.addEventListener('click', (e) => { e.stopPropagation(); closeHelp(); ui.helpButton.focus({ preventScroll: true }); });
  ui.muteButton.addEventListener('click', (e) => { e.stopPropagation(); toggleMute(); ui.muteButton.blur(); });
  ui.pauseButton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (game.state === STATES.PLAYING) setPaused(true);
    else if (game.state === STATES.PAUSED) setPaused(false);   // continuar: retoma pela contagem 3, 2, 1, GO!
    ui.pauseButton.blur();
  });
  ui.restartButton.addEventListener('click', (e) => { e.stopPropagation(); tryRestart(); });
  ui.pauseRestart.addEventListener('click', (e) => { e.stopPropagation(); abandonRun(); ui.pauseRestart.blur(); });

  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', resizeCanvas);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resizeCanvas);

  resizeCanvas();
  if (rafId === null) rafId = requestAnimationFrame(frame);
}

init();
window.__jumpy = { game, CONFIG };
})();