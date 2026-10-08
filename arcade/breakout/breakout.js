/* ==========================================================================
arcade/breakout/breakout.js - Quebra-Blocos: interface, pausa e salvamento, entrada, renderização e loop.
O motor (física, fases, poderes) fica em breakout_game.js e a persistência em breakout_storage.js.
Índice: 1 Fluxo da partida, pausa e salvamento · 2 Efeitos de raio/fogo · 3 Renderização · 4 Interface
· 5 Entrada · 6 Redimensionamento · 7 Loop e inicialização
========================================================================== */
(() => {
'use strict';

const store = BreakoutStorage;
const {
  CONFIG, FIELD, BR, PAD, BALL, TIM, FX, W, R, SHIELD_Y, STATES, TIMED, SHAPES, LEVEL_COUNT,
  C5, SPECIALS, SPEC_COL, ICONS, BRICK_ICONS, ICON_SVG, ICON_VIEW, BRICK_COLORS,
  hooks, session, game, input, Sound, clamp, freshFx, setPaddleX, buildLayout, loadLevel, startLevel, unlockedLevel,
  launch, update, applyEffect, dropItem, damage,
} = BreakoutGame;
const { pause: PAUSE } = CONFIG;
const H = CONFIG.world.height;
const PADDLE_FX = ['wide', 'narrow', 'sticky', 'pspeed', 'sluggish', 'gun'];   // efeitos que destacam a barra

const COLORS = {
  ink: '#0b0d26', hud: '#0f1235', hudLine: '#2a2f66',
  field: ['#1c2158', '#1a1f54', '#181c4f', '#16194a', '#141744', '#12153e', '#101338', '#0e1132'],
  grid: 'rgba(150,170,255,0.06)',
  steel: '#59628f', steelLight: '#9ba5d6', steelDark: '#2e3466', rivet: '#c9d0f0', rivetShade: '#262b58',
  pitBase: '#1a0d22', pitStripe: '#6f1b3a', pitEdge: '#ff4d5e',
  padWhite: '#ffffff',
  ball: '#ffffff', ballHalo: 'rgba(120,230,255,0.30)',
};

function newGame() {
  game.score = 0;
  game.lives = CONFIG.lives;
  game.heartSlots = [];
  game.newLife = -1;
  loadLevel(startLevel());
  game.state = STATES.PLAYING;
  syncHud();
  syncUi();
  saveRun();
}

function startGame() {
  if (game.state !== STATES.READY) return;
  setHowOpen(false);
  Sound.click();
  newGame();
}

function nextLevel() {
  if (game.state !== STATES.WON || game.idleTime < TIM.lockTime) return;
  Sound.click();
  loadLevel(game.level + 1);
  game.state = STATES.PLAYING;
  syncHud();
  syncUi();
  saveRun();
}

function tryRestart() {
  if (game.state === STATES.GAME_OVER && game.idleTime > TIM.lockTime) { Sound.click(); newGame(); }
}

/* ----- PAUSA, RETOMADA E SALVAMENTO DA PARTIDA -----
   Quatro caminhos levam à pausa (reason), todos pelo mesmo setPaused():
     manual  botão, P ou Esc            auto   aba oculta / janela sem foco (visibilitychange, blur)
     howto   abrir "Como jogar"         reload F5: a partida salva é restaurada já pausada ("Partida retomada")
   (o seletor de fases também pausa, com reason 'menu').
   O jogo congela de verdade porque update() só avança com state === PLAYING: física, timers de efeitos, tiros,
   fases 'lost'/'cleared' e o relógio visual ficam parados. Sair da pausa sempre passa pela contagem 3-2-1-GO,
   que roda fora do update(): enquanto ela corre o estado continua PAUSED e nada do jogo se mexe. */
const PAUSE_TEXT = {
  manual: { title: 'Pausado', note: '' },
  menu: { title: 'Pausado', note: '' },
  auto: { title: 'Pausado', note: 'Pausa automática ao sair da aba' },
  howto: { title: 'Pausado', note: 'Pausado enquanto você lê' },
  reload: { title: 'Partida retomada', note: 'Seu progresso foi restaurado' },
};
const COUNT_STYLE = { 3: ['3', 't1'], 2: ['2', 't2'], 1: ['1', 't3'], 0: ['GO!', 't4'] };   // cores dos blocos do logotipo
let pauseReason = 'manual';
let countdown = null;        // { start, shown } enquanto o 3-2-1 roda (state continua PAUSED)
let goTimer = 0;
let lastSaveAt = 0;
let restartArmed = false, restartArmTimer = 0;

function setPaused(paused, reason = 'manual') {
  if (!paused) { requestResume(); return; }
  if (game.state === STATES.PLAYING) { game.state = STATES.PAUSED; pauseReason = reason; }
  else if (game.state === STATES.PAUSED && countdown) pauseReason = reason;   // pausou de novo durante a contagem: volta à tela de pausa
  else return;
  stopCountdown();
  if (reason !== 'auto') Sound.click();
  input.left = input.right = false;
  drag.id = null;
  saveRun();
  syncUi();
}

// P / Esc / botão: alterna. Durante a contagem, pausa de novo em vez de ignorar.
function togglePause() {
  if (game.state === STATES.PLAYING) setPaused(true, 'manual');
  else if (game.state === STATES.PAUSED) { if (countdown) setPaused(true, 'manual'); else requestResume(); }
}

// Continuar: não solta o jogo na hora; começa a contagem 3-2-1-GO (o jogo segue congelado até o GO!)
function requestResume() {
  if (game.state !== STATES.PAUSED || countdown) return;
  setLevelOpen(false);
  setHowOpen(false);
  armRestart(false);
  Sound.unlock();
  countdown = { start: performance.now(), shown: 3 };
  showCount(3);
  Sound.tick(false);
  syncUi();
}

function stopCountdown() {
  countdown = null;
  clearTimeout(goTimer);
  ui.stage.classList.remove('is-go');
}

function showCount(n) {
  const [text, tone] = COUNT_STYLE[n];
  const el = ui.countTile;
  el.className = `count-tile ${tone}`;
  el.textContent = text;
  void el.offsetWidth;            // reinicia a animação de entrada a cada número
  el.classList.add('is-pop');
}

function tickCountdown(now) {
  const n = Math.max(0, Math.floor((now - countdown.start) / (PAUSE.countStep * 1000)));
  if (n >= 3) { finishCountdown(); return; }
  if (3 - n !== countdown.shown) { countdown.shown = 3 - n; showCount(countdown.shown); Sound.tick(false); }
}

// GO!: o jogo volta a andar neste instante; o "GO!" só sobe e some por cima
function finishCountdown() {
  countdown = null;
  game.state = STATES.PLAYING;
  lastTime = null;
  ui.stage.classList.add('is-go');
  showCount(0);
  Sound.tick(true);
  clearTimeout(goTimer);
  goTimer = setTimeout(() => ui.stage.classList.remove('is-go'), PAUSE.goTime * 1000);
  saveRun();
  syncUi();
}

// Reiniciar (tela de pausa): pede confirmação com um segundo toque e volta para a tela inicial
function armRestart(on) {
  clearTimeout(restartArmTimer);
  restartArmed = on;
  ui.pauseRestart.classList.toggle('is-armed', on);
  ui.pauseRestart.setAttribute('aria-label', on ? 'Confirmar: descartar a partida e voltar à tela inicial' : 'Reiniciar a partida e voltar à tela inicial');
  if (on) restartArmTimer = setTimeout(() => armRestart(false), PAUSE.confirmTime * 1000);
}

function onPauseRestart() {
  if (game.state !== STATES.PAUSED || countdown) return;
  if (PAUSE.confirmRestart && !restartArmed) { Sound.click(); armRestart(true); return; }   // 1º toque: o botão só fica vermelho (o texto não muda)
  restartToTitle();
}

function restartToTitle() {
  armRestart(false);
  stopCountdown();
  setLevelOpen(false);
  setHowOpen(false);
  input.left = input.right = false;
  drag.id = null;
  lastTime = null;
  store.clearRun();
  Object.assign(game, { score: 0, lives: CONFIG.lives, heartSlots: [], newLife: -1, clock: 0, idleTime: 0, timer: 0, state: STATES.READY });
  loadLevel(startLevel());          // mesmo tabuleiro de abertura de uma visita nova
  document.getElementById('title-level').textContent = String(store.get('bestLevel', 1));
  Sound.click();
  ui.pauseRestart.blur();
  syncHud();
  syncUi();
}

/* Salvamento: o snapshot guarda tudo o que muda o rumo da partida (barra, bolas com posição e velocidade, blocos
   restantes com tipo e resistência, itens caindo, tiros, efeitos com o tempo que falta, fase, placar, vidas, fase
   'lost'/'cleared' e seu timer, saco de blocos especiais). Fora ficam só enfeites que somem em segundos
   (partículas, explosões, textos flutuantes, raios/fogo na tela) e as teclas apertadas. */
const RUN_STATES = [STATES.PLAYING, STATES.PAUSED, STATES.WON];

function snapshotRun() {
  const g = game, p = g.paddle;
  return {
    state: g.state === STATES.WON ? 'won' : 'playing',   // pausada = "em jogo"; o restaurar decide pausar
    level: g.level, score: g.score, lives: g.lives, heartSlots: Array.from(g.heartSlots, Boolean),   // from(): preenche posições vazias
    phase: g.phase, timer: g.timer, idleTime: g.idleTime, clock: g.clock, baseSpeed: g.baseSpeed,
    rows: g.rows, pv: g.pv, target: g.target, gunKick: g.gunKick,
    paddle: { x: p.x, w: p.w, base: p.base },
    fx: Object.assign({}, g.fx),
    gunFire: g.gunFire ? { left: g.gunFire.left, t: g.gunFire.t } : null,
    balls: g.balls.filter((b) => !b.dead).map((b) => ({
      x: b.x, y: b.y, vx: b.vx, vy: b.vy, speed: b.speed, stuck: b.stuck, off: b.off, color: b.color, power: b.power,
      trail: b.trail.map((q) => [q.x, q.y]),
    })),
    bricks: g.bricks.filter((b) => g.grid[b.r * BR.cols + b.c] === b).map((b) => [b.r, b.c, b.type, b.hp]),
    items: g.items.map((it) => ({ type: it.type, x: it.x, y: it.y, vx: it.vx, vy: it.vy, g: it.g })),
    shots: g.shots.map((s) => ({ x: s.x, y: s.y })),
    bag: session.bag.slice(), picked: session.picked,
  };
}

function saveRun() {
  if (!RUN_STATES.includes(game.state)) return;
  lastSaveAt = performance.now();
  try { store.saveRun(snapshotRun()); } catch (e) { /* salvar nunca pode quebrar o jogo */ }
}

// Valida tudo antes de tocar no jogo: snapshot corrompido ou de outra versão é ignorado (e a partida começa do zero)
function restoreRun(run) {
  if (!run || typeof run !== 'object') return false;
  try {
    const fin = (v) => typeof v === 'number' && Number.isFinite(v);
    const level = Math.floor(run.level), rows = Math.floor(run.rows);
    if (!(level >= 1 && level < 1e5) || !(rows >= 1 && rows <= 24)) return false;
    if (!fin(run.score) || run.score < 0 || !fin(run.lives) || run.lives < -1 || run.lives > CONFIG.maxLives) return false;
    if (!['play', 'lost', 'cleared'].includes(run.phase)) return false;
    const pd = run.paddle;
    if (!pd || !fin(pd.x) || !fin(pd.w) || !fin(pd.base) || pd.w < 10 || pd.w > W || pd.base < 10 || pd.base > W) return false;

    const bricks = [], grid = new Array(BR.cols * rows).fill(null);
    for (const e of Array.isArray(run.bricks) ? run.bricks : []) {
      const [r, c, type, hp] = Array.isArray(e) ? e : [];
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= rows || c < 0 || c >= BR.cols) return false;
      if (type !== null && !(typeof type === 'string' && Object.prototype.hasOwnProperty.call(SPECIALS, type))) return false;
      if (grid[r * BR.cols + c] || !(hp === 1 || hp === 2)) return false;
      const brick = { r, c, x: FIELD.left + c * BR.width, y: BR.top + r * BR.height, color: r % BRICK_COLORS.length, type, hp, flash: 0 };
      bricks.push(brick);
      grid[r * BR.cols + c] = brick;
    }

    const balls = [];
    for (const b of (Array.isArray(run.balls) ? run.balls : []).slice(0, 16)) {
      if (![b.x, b.y, b.vx, b.vy, b.speed, b.off].every(fin)) return false;
      balls.push({
        x: b.x, y: b.y, vx: b.vx, vy: b.vy, speed: b.speed, off: b.off, stuck: Boolean(b.stuck), dead: false,
        color: typeof b.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(b.color) ? b.color : '#ffffff',
        power: b.power === 'fire' || b.power === 'bolt' ? b.power : null,
        trail: (Array.isArray(b.trail) ? b.trail : []).slice(-5).filter((q) => Array.isArray(q) && fin(q[0]) && fin(q[1])).map((q) => ({ x: q[0], y: q[1] })),
      });
    }

    const items = [];
    for (const it of Array.isArray(run.items) ? run.items : []) {
      if (!it || ![it.x, it.y, it.vx, it.vy, it.g].every(fin) || !Object.prototype.hasOwnProperty.call(SPECIALS, it.type)) return false;
      items.push({ type: it.type, x: it.x, y: it.y, vx: it.vx, vy: it.vy, g: it.g });
    }
    const shots = (Array.isArray(run.shots) ? run.shots : []).filter((s) => s && fin(s.x) && fin(s.y)).map((s) => ({ x: s.x, y: s.y }));

    const fx = freshFx(), savedFx = run.fx || {};
    for (const k of Object.keys(fx)) if (fin(savedFx[k]) && savedFx[k] > 0) fx[k] = Math.min(savedFx[k], 120);
    const gf = run.gunFire;
    const gunFire = gf && fin(gf.left) && fin(gf.t) && gf.left > 0 ? { left: Math.floor(gf.left), t: gf.t } : null;

    Object.assign(game, {
      state: run.state === 'won' ? STATES.WON : STATES.PAUSED,
      level, score: Math.floor(run.score), lives: Math.floor(run.lives), phase: run.phase, rows,
      heartSlots: Array.from((Array.isArray(run.heartSlots) ? run.heartSlots : []).slice(0, CONFIG.maxLives), Boolean), newLife: -1,
      timer: fin(run.timer) ? run.timer : 0, idleTime: run.state === 'won' ? TIM.lockTime : (fin(run.idleTime) ? run.idleTime : 0), pitFlash: 0,   // vitória: botão já liberado
      clock: fin(run.clock) ? run.clock : 0, trailClock: 0,
      baseSpeed: fin(run.baseSpeed) && run.baseSpeed > 0 ? run.baseSpeed : BALL.speedStart,
      pv: fin(run.pv) ? run.pv : 0, target: fin(run.target) ? run.target : null, gunKick: fin(run.gunKick) ? run.gunKick : 0,
      paddle: { x: pd.x, w: pd.w, base: pd.base },
      bricks, grid, alive: bricks.length, balls, items, shots, gunFire, fx,
      particles: [], blasts: [], popups: [],
    });
    setPaddleX(game.paddle.x);
    session.bag = (Array.isArray(run.bag) ? run.bag : []).filter((k) => Object.prototype.hasOwnProperty.call(SPECIALS, k));
    session.picked = Number.isInteger(run.picked) && run.picked >= 1 ? run.picked : null;
    if (level > store.get('bestLevel', 1)) store.set('bestLevel', level);
    pauseReason = 'reload';
    if (game.state === STATES.WON) { ui.wonScore.textContent = String(game.score); ui.wonLevel.textContent = String(game.level); }
    return true;
  } catch (e) {
    return false;
  }
}

// Ganchos do motor: fim de fase e fim de jogo atualizam textos/painéis (e a vitória grava a partida)
function onWon() {
  ui.wonScore.textContent = String(game.score);
  ui.wonLevel.textContent = String(game.level);
  syncUi();
  saveRun();
}

function onOver() {
  ui.overScore.textContent = String(game.score);
  ui.overLevel.textContent = String(game.level);
  syncUi();
}

// O visual é um elemento DOM animado pelo breakout.css; o JS só informa posição e tamanho (unidades do mundo)
function spawnLineFx(kind, x, y, w, h, origin) {
  const el = document.createElement('div');
  el.className = `fx-line fx-${kind}`;
  el.style.setProperty('--x', x); el.style.setProperty('--y', y);
  el.style.setProperty('--w', w); el.style.setProperty('--h', h);
  el.style.setProperty('--org', origin);
  el.addEventListener('animationend', (e) => { if (!e.pseudoElement) el.remove(); });
  lineFx.push({ el, left: 1.2 });                // vida em tempo de jogo (stepParticles): na pausa o efeito congela junto
  ui.stage.appendChild(el);
}
const lineFx = [];
// Passa o tempo de jogo: na pausa o efeito congela junto; remove o que não terminou sozinho
function tickLineFx(h) {
  for (let i = lineFx.length - 1; i >= 0; i--) {
    lineFx[i].left -= h;
    if (lineFx[i].left <= 0 || !lineFx[i].el.isConnected) { lineFx[i].el.remove(); lineFx.splice(i, 1); }
  }
}
function clearLineFx() { lineFx.length = 0; ui.stage.querySelectorAll('.fx-line').forEach((el) => el.remove()); }

/* ===== 5. RENDERIZAÇÃO (desenha direto na resolução real da tela) ===== */
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
let bgCanvas = null;
let S = 1;                         // pixels do canvas por unidade do mundo

function rect(g, color, x, y, w, h) {
  const x0 = Math.round(x * S), y0 = Math.round(y * S);
  g.fillStyle = color;
  g.fillRect(x0, y0, Math.round((x + w) * S) - x0, Math.round((y + h) * S) - y0);
}

function icon(type, x, y, bw, bh = bw, row) {
  const img = row === undefined ? ICONS[type] : BRICK_ICONS[type] && BRICK_ICONS[type][row];
  if (!img || !img.complete || !img.naturalWidth) return;
  const [vw, vh] = ICON_VIEW[type] || [16, 16];
  const w = Math.min(bw, bh * vw / vh), h = w * vh / vw;
  ctx.drawImage(img, Math.round((x + (bw - w) / 2) * S), Math.round((y + (bh - h) / 2) * S), Math.round(w * S), Math.round(h * S));
}

// (blocos especiais: fundo e borda são SEMPRE os da linha; só o ícone muda)
// Retângulo com cantos cortados (1 unidade), no estilo das imagens de referência
function pill(color, x, y, w, h) {
  rect(ctx, color, x + 1, y, w - 2, h);
  rect(ctx, color, x, y + 1, w, h - 2);
}

function buildBackground() {
  if (!bgCanvas) bgCanvas = document.createElement('canvas');
  bgCanvas.width = canvas.width;
  bgCanvas.height = canvas.height;
  const g = bgCanvas.getContext('2d');
  const fieldW = FIELD.right - FIELD.left, fieldH = FIELD.pitY - FIELD.top;

  rect(g, COLORS.ink, 0, 0, W, H);
  const n = COLORS.field.length;
  for (let i = 0; i < n; i++) {
    const y0 = FIELD.top + Math.round(fieldH * i / n), y1 = FIELD.top + Math.round(fieldH * (i + 1) / n);
    rect(g, COLORS.field[i], FIELD.left, y0, fieldW, y1 - y0);
  }
  for (let x = FIELD.left + BR.width; x < FIELD.right; x += BR.width) rect(g, COLORS.grid, x, FIELD.top, 1, fieldH);
  for (let y = BR.top; y < FIELD.pitY; y += BR.height) rect(g, COLORS.grid, FIELD.left, y, fieldW, 1);

  rect(g, COLORS.hud, 0, 0, W, FIELD.hudHeight);
  rect(g, COLORS.hudLine, 0, FIELD.hudHeight - 2, W, 1);
  rect(g, COLORS.ink, 0, FIELD.hudHeight - 1, W, 1);

  const wallTop = FIELD.hudHeight, wallH = FIELD.pitY - wallTop;
  rect(g, COLORS.steel, 0, wallTop, FIELD.left, wallH);
  rect(g, COLORS.steel, FIELD.right, wallTop, W - FIELD.right, wallH);
  rect(g, COLORS.steel, 0, wallTop, W, FIELD.top - wallTop);
  rect(g, COLORS.steelLight, 1, wallTop + 1, 2, wallH - 1);
  rect(g, COLORS.steelLight, W - 3, wallTop + 1, 2, wallH - 1);
  rect(g, COLORS.steelLight, 1, wallTop + 1, W - 2, 2);
  rect(g, COLORS.steelDark, 8, wallTop + 3, 3, wallH - 3);
  rect(g, COLORS.steelDark, W - 11, wallTop + 3, 3, wallH - 3);
  rect(g, COLORS.steelDark, FIELD.left, FIELD.top - 5, fieldW, 4);
  rect(g, COLORS.ink, FIELD.left - 1, FIELD.top, 1, fieldH);
  rect(g, COLORS.ink, FIELD.right, FIELD.top, 1, fieldH);
  rect(g, COLORS.ink, FIELD.left - 1, FIELD.top - 1, fieldW + 2, 1);
  for (let y = FIELD.top + 12; y < FIELD.pitY - 6; y += 24) {
    for (const x of [4, W - 7]) { rect(g, COLORS.rivetShade, x, y + 1, 3, 3); rect(g, COLORS.rivet, x, y, 3, 3); }
  }
  for (let x = FIELD.left + 12; x < FIELD.right - 6; x += 24) {
    rect(g, COLORS.rivetShade, x, wallTop + 5, 3, 3); rect(g, COLORS.rivet, x, wallTop + 4, 3, 3);
  }

  const pitH = FIELD.floorY - FIELD.pitY;
  rect(g, COLORS.pitBase, 0, FIELD.pitY, W, pitH);
  for (let j = 0; j < pitH; j++) {
    for (let x = -16; x < W; x += 16) {
      const x0 = Math.max(0, x + j), x1 = Math.min(W, x + j + 8);
      if (x1 > x0) rect(g, COLORS.pitStripe, x0, FIELD.pitY + j, x1 - x0, 1);
    }
  }
  rect(g, COLORS.ink, 0, FIELD.pitY, W, 2);

  rect(g, COLORS.ink, 0, FIELD.floorY - 1, W, 1);
  rect(g, COLORS.steel, 0, FIELD.floorY, W, H - FIELD.floorY);
  rect(g, COLORS.steelLight, 1, FIELD.floorY + 1, W - 2, 2);
  rect(g, COLORS.steelDark, 0, H - 4, W, 4);
  for (let x = 16; x < W - 8; x += 24) {
    rect(g, COLORS.rivetShade, x, FIELD.floorY + 5, 3, 3); rect(g, COLORS.rivet, x, FIELD.floorY + 4, 3, 3);
  }
}

const BRICK_BORDER = 1.5;   // espessura da borda dos blocos (unidades do mundo)

function drawBrick(brick) {
  const sp = brick.type && SPECIALS[brick.type];
  const col = BRICK_COLORS[brick.color];
  const ox = brick.x + 0.5, oy = brick.y + 0.5, ow = BR.width - 1, oh = BR.height - 1;
  const ix = ox + BRICK_BORDER, iy = oy + BRICK_BORDER, iw = ow - BRICK_BORDER * 2, ih = oh - BRICK_BORDER * 2;
  if (brick.type === 'hidden' && brick.hp > 1) {        // oculto: só a borda tracejada (grossa), interior transparente, sem ícone
    for (let x = ox + 2; x < ox + ow - 4; x += 5) { rect(ctx, col.base, x, oy, 3, 2); rect(ctx, col.base, x, oy + oh - 2, 3, 2); }
    for (let y = oy + 3; y < oy + oh - 4; y += 5) { rect(ctx, col.base, ox, y, 2, 3); rect(ctx, col.base, ox + ow - 2, y, 2, 3); }
    return;
  }
  pill(col.edge, ox, oy, ow, oh);
  pill(col.base, ix, iy, iw, ih);
  rect(ctx, col.light, ix + 1, iy, iw - 2, 1);
  rect(ctx, col.light, ix, iy + 1, 1, ih - 2);
  rect(ctx, col.dark, ix + 1, iy + ih - 1, iw - 2, 1);
  rect(ctx, col.dark, ix + iw - 1, iy + 1, 1, ih - 2);
  if (!sp) rect(ctx, 'rgba(255,255,255,0.5)', ix + 3, iy + 2, 7, 1);
  else if (brick.type === 'tough') icon('tough', ix, iy, iw, ih, brick.color);
  else icon(brick.type, ix + 2, iy + 1, iw - 4, ih - 2, brick.color);
  if (brick.type === 'tough' && brick.hp < 2) {         // rachaduras após o 1º impacto
    for (const [dx, dy, dw, dh] of [[5, 0, 2, 5], [3, 5, 4, 2], [4, 7, 2, 6], [16, 0, 2, 4], [17, 4, 4, 2], [19, 6, 2, 7], [24, 2, 2, 4], [22, 6, 3, 2]]) rect(ctx, COLORS.ink, ix + dx, iy + dy, dw, dh);
  }
  if (brick.flash > 0) rect(ctx, 'rgba(255,255,255,0.65)', ix, iy, iw, ih);
}

function drawItem(it) {
  if (it.type === 'heart') {                            // coração: sem caixa, com brilho (é um projétil, não um item comum)
    circle(it.x, it.y, 9, 'rgba(255,77,94,0.25)');
    icon('heart', it.x - 7, it.y - 7, 14);
    return;
  }
  const sp = SPECIALS[it.type], c = SPEC_COL[it.type], x = it.x - 7, y = it.y - 7;
  pill(sp.bad ? '#ff4d5e' : c.edge, x - 1, y - 1, 16, 16);
  pill(c.base, x + 1, y + 1, 12, 12);
  rect(ctx, c.light, x + 2, y + 1, 10, 1);
  icon(it.type, x + 2, y + 2, 10);
}

// Barra branca. Com efeito ativo na barra: brilho pulsante (alterna as cores se houver mais de um; pulsa mais rápido
// nos últimos 2 s dos temporários) e uma faixa colorida por efeito na base. Sem efeito, volta a ficar só branca.
function drawPaddle() {
  const p = game.paddle, fx = game.fx, x = p.x, y = PAD.y, w = p.w, h = PAD.height;
  const active = PADDLE_FX.filter((k) => fx[k] > 0 || (k === 'gun' && game.gunFire));
  if (active.length) {
    const urgent = active.some((k) => TIMED.includes(k) && fx[k] < 2);
    const pulse = 0.5 + 0.5 * Math.sin(game.clock * (urgent ? 18 : 7));
    ctx.globalAlpha = 0.22 + 0.3 * pulse;
    pill(SPEC_COL[active[Math.floor(game.clock * 2) % active.length]].base, x - 2, y - 2, w + 4, h + 4);
    ctx.globalAlpha = 1;
  }
  pill(COLORS.padWhite, x, y, w, h);
  const sw = (w - 4) / Math.max(1, active.length);
  active.forEach((k, i) => rect(ctx, SPEC_COL[k].base, x + 2 + i * sw, y + h - 3, sw, 2));
  if (fx.gun > 0 || game.gunFire) drawCannons();
}

// Canhões nas pontas da barra: cano de aço com contorno e boca laranja; recuam e soltam clarão ao disparar
function drawCannons() {
  const p = game.paddle, y = PAD.y, k = game.gunKick, dy = k * 2;
  for (const x of [p.x + 1, p.x + p.w - 5]) {
    rect(ctx, COLORS.ink, x, y - 7 + dy, 4, 8);
    rect(ctx, COLORS.steelLight, x + 1, y - 6 + dy, 2, 6);
    rect(ctx, SPEC_COL.gun.base, x, y - 8 + dy, 4, 2);
    if (k > 0.45) circle(x + 2, y - 10, 1.5 + 2.5 * k, `rgba(255,220,90,${(0.4 + 0.5 * k).toFixed(2)})`);
  }
}

function drawShots() {
  for (const sh of game.shots) {
    rect(ctx, 'rgba(255,140,46,0.55)', sh.x - 1.5, sh.y - 1, 3, 8);
    rect(ctx, '#ffd23f', sh.x - 1, sh.y, 2, 6);
    rect(ctx, '#ffffff', sh.x - 0.5, sh.y, 1, 3);
  }
}

function circle(x, y, radius, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x * S, y * S, radius * S, 0, Math.PI * 2);
  ctx.fill();
}

const rnd = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// Bola de fogo: cauda de chamas tremulando para trás + línguas de fogo orbitando a bola
function drawFlames(b) {
  const t = game.clock, sp = Math.hypot(b.vx, b.vy);
  const ux = sp ? -b.vx / sp : 0, uy = sp ? -b.vy / sp : -1;
  circle(b.x, b.y, R + 4 + Math.sin(t * 30), 'rgba(255,90,20,0.28)');
  for (let k = 5; k >= 1; k--) {
    const f = 0.8 + 0.3 * Math.sin(t * 34 + k * 2 + b.x * 0.3);
    circle(b.x + ux * k * 2.4 + Math.sin(t * 20 + k) * 0.8, b.y + uy * k * 2.4, R * (1.15 - 0.17 * k) * f + 0.4,
      k > 3 ? 'rgba(255,70,20,0.6)' : k > 1 ? 'rgba(255,140,30,0.7)' : 'rgba(255,200,60,0.8)');
  }
  for (let i = 0; i < 6; i++) {
    const a = t * 7 + i * 1.05, r = R + 1.5 + 1.3 * Math.sin(t * 26 + i * 3);
    circle(b.x + Math.cos(a) * r, b.y + Math.sin(a) * r - 1.2, 1.5, i % 2 ? '#ffd23f' : '#ff8c2e');
  }
}

// Raio elétrico: brilho pulsante e faíscas em zigue-zague que mudam de posição ~18 vezes por segundo
function drawSparks(b) {
  const seed = Math.floor(game.clock * 18);
  circle(b.x, b.y, R + 3.5 + rnd(seed) * 1.5, 'rgba(255,235,90,0.3)');
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let j = 0; j < 5; j++) {
    const s0 = seed * 7 + j * 13, a = j * 1.2566 + rnd(s0) * 1.1, len = 8 + rnd(s0 + 1) * 7;   // 5 raios espalhados em volta da bola
    let x = b.x + Math.cos(a) * R, y = b.y + Math.sin(a) * R;
    ctx.beginPath();
    ctx.moveTo(x * S, y * S);
    for (let k = 1; k <= 3; k++) {
      const aa = a + (rnd(s0 + k * 3) - 0.5) * 1.6;
      x += Math.cos(aa) * len / 3; y += Math.sin(aa) * len / 3;
      ctx.lineTo(x * S, y * S);
    }
    ctx.strokeStyle = 'rgba(255,225,70,0.9)'; ctx.lineWidth = 2 * S; ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.8 * S; ctx.stroke();
  }
}

function drawBalls() {
  if (game.phase !== 'play') return;
  for (const b of game.balls) {
    const fire = b.power === 'fire', bolt = b.power === 'bolt';
    const halo = fire ? 'rgba(255,110,30,0.5)' : bolt ? 'rgba(255,235,90,0.45)' : (b.color === '#ffffff' ? COLORS.ballHalo : `${b.color}55`);
    for (let i = 0; i < b.trail.length; i++) {
      const t = b.trail[i], k = (i + 1) / (b.trail.length + 1);
      circle(t.x, t.y, R * (0.45 + 0.4 * k), fire ? `rgba(255,120,40,${(0.15 + 0.3 * k).toFixed(2)})` : `rgba(140,230,255,${(0.1 + 0.2 * k).toFixed(2)})`);
    }
    if (fire) drawFlames(b);
    circle(b.x, b.y, R + (fire ? 3.4 : 2.2), halo);
    circle(b.x, b.y, R + 0.9, 'rgba(11,13,38,0.75)');
    circle(b.x, b.y, R, fire ? '#ffd23f' : bolt ? '#f4fbff' : b.color);
    if (fire) circle(b.x, b.y, R * 0.5, '#ffffff');
    if (bolt) drawSparks(b);
  }
}

// Indicadores no poço: efeitos temporários (barra de tempo, inclusive o escudo) e metralhadora (cargas restantes)
function drawStatus() {
  const fx = game.fx, y = FIELD.pitY + 3;
  let x = 14;
  const chip = (type, ratio) => {
    rect(ctx, COLORS.ink, x - 1, y - 1, 16, 16);
    rect(ctx, SPEC_COL[type].base, x, y, 14, 14);
    icon(type, x + 1, y, 12);
    rect(ctx, COLORS.ink, x, y + 12, 14, 2);
    rect(ctx, '#ffffff', x, y + 12, Math.max(1, 14 * ratio), 2);
    x += 19;
  };
  for (const k of TIMED) if (fx[k] > 0) chip(k, fx[k] / FX[k].time);
  if (fx.gun > 0) chip('gun', fx.gun / FX.gun.volleys);
}

function drawEffects() {
  if (game.fx.shield > 0) {
    rect(ctx, 'rgba(58,123,255,0.35)', FIELD.left, SHIELD_Y - 2, FIELD.right - FIELD.left, 6);
    rect(ctx, '#3a7bff', FIELD.left, SHIELD_Y, FIELD.right - FIELD.left, 2);
    rect(ctx, '#c7d8ff', FIELD.left, SHIELD_Y, FIELD.right - FIELD.left, 1);
  }
  for (const bl of game.blasts) {
    const k = bl.t / bl.max;
    circle(bl.x, bl.y, bl.r * k, `rgba(255,140,40,${(0.55 * (1 - k)).toFixed(2)})`);
    circle(bl.x, bl.y, bl.r * k * 0.6, `rgba(255,240,170,${(0.75 * (1 - k)).toFixed(2)})`);
  }
}

function drawPopups() {
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.font = `${Math.round(8 * S)}px "Arial Black", Arial, sans-serif`;
  for (const p of game.popups) {
    ctx.globalAlpha = clamp((p.max - p.t) / 0.4, 0, 1);
    ctx.lineWidth = 3 * S;
    ctx.strokeStyle = COLORS.ink;
    ctx.strokeText(p.text, clamp(p.x, 40, W - 40) * S, p.y * S);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, clamp(p.x, 40, W - 40) * S, p.y * S);
  }
  ctx.globalAlpha = 1;
}

function render() {
  if (!bgCanvas) return;
  ctx.globalAlpha = 1;
  ctx.drawImage(bgCanvas, 0, 0);
  if (game.pitFlash > 0) {
    ctx.globalAlpha = Math.min(1, game.pitFlash / 0.45) * 0.55;
    rect(ctx, '#ff4d5e', 0, FIELD.pitY, W, FIELD.floorY - FIELD.pitY);
    ctx.globalAlpha = 1;
  }
  drawStatus();
  for (const brick of game.bricks) if (game.grid[brick.r * BR.cols + brick.c]) drawBrick(brick);
  drawEffects();
  drawShots();
  for (const p of game.particles) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
    rect(ctx, p.color, p.x - 1, p.y - 1, 2, 2);
  }
  ctx.globalAlpha = 1;
  for (const it of game.items) drawItem(it);
  drawPaddle();
  drawBalls();
  drawPopups();
}

/* ===== 6. INTERFACE ===== */
const ui = {
  arena: document.getElementById('arena'),
  stage: document.getElementById('stage'),
  pauseButton: document.getElementById('pause-button'),
  muteButton: document.getElementById('mute-button'),
  helpButton: document.getElementById('help-toggle'),
  helpList: document.getElementById('help-list'),
  howButton: document.getElementById('how-button'),
  howPopover: document.getElementById('how-popover'),
  howClose: document.getElementById('how-close'),
  levelButton: document.getElementById('level-button'),
  levelClose: document.getElementById('level-close'),
  levelPrev: document.getElementById('level-prev'),
  levelNext: document.getElementById('level-next'),
  levelPageList: document.getElementById('level-page-list'),
  levelCount: document.getElementById('level-count'),
  levelMenu: document.getElementById('level-menu'),
  levelGrid: document.getElementById('level-grid'),
  mouseButton: document.getElementById('mouse-button'),
  resumeButton: document.getElementById('resume-button'),
  pauseTitle: document.getElementById('pause-title'),
  pauseNote: document.getElementById('pause-note'),
  pauseRestart: document.getElementById('pause-restart-button'),
  pauseRestartLabel: document.getElementById('pause-restart-label'),
  countTile: document.getElementById('count-tile'),
  nextButton: document.getElementById('next-button'),
  restartButton: document.getElementById('restart-button'),
  score: document.getElementById('hud-score'),
  level: document.getElementById('hud-level'),
  livesBox: document.getElementById('hud-lives'),
  lifeDots: Array.from(document.querySelectorAll('#hud-lives .life')),
  overScore: document.getElementById('over-score'),
  overLevel: document.getElementById('over-level'),
  wonScore: document.getElementById('won-score'),
  wonLevel: document.getElementById('won-level'),
};

function syncHud() {
  const score = String(game.score).padStart(5, '0');
  if (ui.score.textContent !== score) ui.score.textContent = score;
  const level = String(game.level);
  if (ui.level.textContent !== level) ui.level.textContent = level;
  while (ui.lifeDots.length < game.lives) {            // vida extra: acrescenta bolinhas
    const dot = document.createElement('i');
    dot.className = 'life';
    ui.livesBox.appendChild(dot);
    ui.lifeDots.push(dot);
  }
  ui.lifeDots.forEach((dot, i) => {
    dot.classList.toggle('is-lost', i >= game.lives);
    dot.classList.toggle('is-heart', Boolean(game.heartSlots[i]));   // vida ganha por coração: coração vermelho
    if (i === game.newLife) { dot.classList.remove('is-new'); void dot.offsetWidth; dot.classList.add('is-new'); game.newLife = -1; }
    dot.style.display = i >= CONFIG.lives && i >= game.lives ? 'none' : '';
  });
  const lives = Math.max(0, game.lives);
  ui.livesBox.setAttribute('aria-label', `${lives} ${lives === 1 ? 'vida' : 'vidas'}`);
}

function syncUi() {
  const s = game.state;
  ui.stage.classList.toggle('is-ready', s === STATES.READY);
  ui.stage.classList.toggle('is-playing', s === STATES.PLAYING);
  ui.stage.classList.toggle('is-paused', s === STATES.PAUSED);
  ui.stage.classList.toggle('is-won', s === STATES.WON);
  ui.stage.classList.toggle('is-over', s === STATES.GAME_OVER);
  ui.stage.classList.toggle('is-counting', Boolean(countdown));   // 3-2-1 em andamento (o jogo segue congelado)
  ui.stage.classList.toggle('is-serving', s === STATES.PLAYING && game.phase === 'play' && game.balls.some((b) => b.stuck));
  if (s === STATES.PLAYING) setLevelOpen(false);      // o painel de fases só fica aberto com o jogo parado
  // Pausa: o botão nunca some nem muda de lugar; só troca o ícone (CSS, via .is-paused) e o rótulo
  const canPause = s === STATES.PLAYING || s === STATES.PAUSED;
  const pauseLabel = s === STATES.PAUSED && !countdown ? 'Continuar' : 'Pausar';   // na contagem dá para pausar de novo
  ui.pauseButton.classList.toggle('is-inactive', !canPause);
  ui.pauseButton.setAttribute('aria-disabled', canPause ? 'false' : 'true');
  ui.pauseButton.setAttribute('aria-label', pauseLabel);
  ui.pauseButton.dataset.tip = `${pauseLabel} (P)`;
  syncLevelButton();
  if (s === STATES.PAUSED) {
    const txt = PAUSE_TEXT[pauseReason] || PAUSE_TEXT.manual;     // título e aviso conforme o motivo da pausa
    ui.pauseTitle.textContent = txt.title;
    ui.pauseTitle.classList.toggle('is-resumed', pauseReason === 'reload');
    ui.pauseNote.textContent = txt.note;
    ui.pauseNote.hidden = !txt.note;
    if (!countdown) ui.resumeButton.focus({ preventScroll: true });
  } else if (restartArmed) armRestart(false);
  if (s === STATES.WON) ui.nextButton.focus({ preventScroll: true });
  if (s === STATES.GAME_OVER) ui.restartButton.focus({ preventScroll: true });
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

// Painel de ajuda: lista agrupada, montada a partir de SPECIALS/ICON_SVG (mesmos ícones do jogo); o visual fica no CSS
const HELP_GROUPS = [['blocos', 'Blocos especiais'], ['poderes', 'Poderes'], ['armadilhas', 'Armadilhas']];
function buildHelp() {
  const colorName = Object.fromEntries(Object.entries(C5).map(([k, v]) => [v, k]));
  for (const [gid, title] of HELP_GROUPS) {
    const section = document.createElement('section');
    section.className = `help-group is-${gid}`;
    const h3 = document.createElement('h3');
    h3.className = 'help-group-title';
    h3.textContent = title;
    const ul = document.createElement('ul');
    ul.className = 'help-list';
    for (const [k, sp] of Object.entries(SPECIALS)) {
      if (sp.g !== gid) continue;
      const li = document.createElement('li');
      li.className = 'help-item';
      const ico = document.createElement('span');
      ico.className = `help-icon c-${colorName[sp.color]}${k === 'hidden' ? ' is-hidden' : ''}`;
      if (ICON_SVG[k]) ico.innerHTML = ICON_SVG[k];
      const text = document.createElement('span');
      text.className = 'help-text';
      const head = document.createElement('span');
      head.className = 'help-name';
      const name = document.createElement('b');
      name.textContent = sp.n || sp.l.charAt(0) + sp.l.slice(1).toLowerCase();
      head.appendChild(name);
      if (sp.tag) {
        const tag = document.createElement('em');
        tag.className = 'help-tag';
        tag.textContent = sp.tag;
        head.appendChild(tag);
      }
      const desc = document.createElement('span');
      desc.textContent = sp.d;
      text.append(head, desc);
      li.append(ico, text);
      ul.appendChild(li);
    }
    section.append(h3, ul);
    ui.helpList.appendChild(section);
  }
}

function setHelpOpen(open) {
  if (open) setHowOpen(false);   // os dois painéis ocupam a mesma coluna: só um aberto por vez
  ui.arena.classList.toggle('help-open', open);
  ui.helpButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  ui.helpButton.setAttribute('aria-label', open ? 'Fechar ajuda dos efeitos' : 'Mostrar ajuda dos efeitos');
}

// Seletor de fase: mostra TODAS as fases, em páginas de 10. As ainda não alcançadas (> bestLevel) aparecem com cadeado
// e nunca são aceitas. O total acompanha o número de fases do jogo (e cresce se o jogador passar das voltas).
const LEVELS_PER_PAGE = 10;
let levelOpen = false;
let levelPage = 0;
const levelTotal = () => Math.max(LEVEL_COUNT, unlockedLevel());
const levelPageCount = () => Math.ceil(levelTotal() / LEVELS_PER_PAGE);
const LOCK_SVG = '<svg class="lock" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5 7V5.3a3 3 0 0 1 6 0V7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="2.8" y="7" width="10.4" height="7.4" rx="1.6" fill="currentColor"/><circle cx="8" cy="10.2" r="1.15" fill="#10133a"/><rect x="7.4" y="10.6" width="1.2" height="2" rx=".5" fill="#10133a"/></svg>';

// A fase destacada no painel: a escolhida (tela inicial/fim de partida) ou a que está em andamento
function levelShown() {
  return game.state === STATES.READY || game.state === STATES.GAME_OVER ? startLevel() : game.level;
}

function syncLevelButton() {
  ui.levelButton.setAttribute('aria-label', 'Escolher fase');   // o botão é só um ícone: não mostra o número da fase
}

function buildLevelPages() {
  const total = levelTotal(), top = unlockedLevel();
  ui.levelPageList.textContent = '';
  for (let p = 0; p < levelPageCount(); p++) {
    const first = p * LEVELS_PER_PAGE + 1, last = Math.min(total, first + LEVELS_PER_PAGE - 1);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'page-btn' + (first > top ? ' is-locked' : '');
    btn.textContent = String(p + 1);
    btn.dataset.tip = `Fases ${first}–${last}`;
    btn.setAttribute('aria-label', `Página ${p + 1}, fases ${first} a ${last}`);
    btn.addEventListener('click', (e) => { e.stopPropagation(); levelPage = p; renderLevelPage(); });
    ui.levelPageList.appendChild(btn);
  }
}

function renderLevelPage() {
  const current = levelShown(), top = unlockedLevel(), total = levelTotal(), pages = levelPageCount();
  levelPage = clamp(levelPage, 0, pages - 1);
  const first = levelPage * LEVELS_PER_PAGE + 1, last = Math.min(total, first + LEVELS_PER_PAGE - 1);
  ui.levelGrid.textContent = '';
  for (let n = first; n <= last; n++) {
    const locked = n > top;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `level-chip t${Math.floor(((n - 1) % LEVEL_COUNT) / 3) % 8 + 1}${locked ? ' is-locked' : ''}${n === current ? ' is-current' : ''}`;
    chip.innerHTML = `<span class="lv-num">${n}</span>${locked ? LOCK_SVG : ''}`;
    chip.setAttribute('aria-label', locked ? `Fase ${n}, bloqueada` : `Fase ${n}`);
    if (locked) chip.setAttribute('aria-disabled', 'true');
    if (n === current) chip.setAttribute('aria-current', 'true');
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (locked) { chip.classList.remove('is-denied'); void chip.offsetWidth; chip.classList.add('is-denied'); return; }
      pickLevel(n);
    });
    ui.levelGrid.appendChild(chip);
  }
  Array.from(ui.levelPageList.children).forEach((btn, i) => {
    btn.classList.toggle('is-current', i === levelPage);
    if (i === levelPage) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
  });
  ui.levelPrev.disabled = levelPage <= 0;
  ui.levelNext.disabled = levelPage >= pages - 1;
  ui.levelCount.innerHTML = `Desbloqueadas: <b>${Math.min(top, total)}</b> de ${total}`;
}

function setLevelOpen(open) {
  if (open === levelOpen) return;
  levelOpen = open;
  if (open) {
    levelPage = Math.floor((levelShown() - 1) / LEVELS_PER_PAGE);   // abre na página da fase destacada
    buildLevelPages();
    renderLevelPage();
  }
  ui.levelMenu.hidden = !open;
  ui.levelButton.setAttribute('aria-expanded', open ? 'true' : 'false');
}

// O botão de fases está sempre visível. Durante a partida, abrir o painel pausa o jogo.
function toggleLevelMenu() {
  if (levelOpen) { setLevelOpen(false); return; }
  if (game.state === STATES.PLAYING) setPaused(true, 'menu');
  setLevelOpen(true);
}

function pickLevel(n) {
  if (!(n >= 1 && n <= unlockedLevel())) return;   // fase bloqueada nunca é aceita
  const s = game.state;
  if ((s === STATES.PLAYING || s === STATES.PAUSED) && n === game.level) { setLevelOpen(false); return; }   // já é a fase em andamento
  session.picked = n;
  Sound.click();
  if (s === STATES.READY) { loadLevel(n); syncHud(); }   // a tela inicial mostra a fase escolhida
  else if (s !== STATES.GAME_OVER) {                     // no meio da partida (ou após vitória): começa uma nova partida nessa fase
    input.left = input.right = false;
    lastTime = null;
    newGame();
  }
  setLevelOpen(false);
  syncLevelButton();
}

// Controle pelo mouse: começa desligado; a preferência fica salva
let mouseControl = store.get('mouseControl', true) !== false;
function syncMouseButton() {
  const label = `Controle pelo mouse: ${mouseControl ? 'ligado' : 'desligado'}`;
  ui.mouseButton.classList.toggle('is-on', mouseControl);
  ui.mouseButton.setAttribute('aria-pressed', mouseControl ? 'true' : 'false');
  ui.mouseButton.setAttribute('aria-label', label);
  ui.mouseButton.dataset.tip = `Mouse: ${mouseControl ? 'ligado' : 'desligado'}`;
}
function setMouseControl(on) {
  mouseControl = Boolean(on);
  store.set('mouseControl', mouseControl);
  if (!mouseControl) game.target = null;   // a barra para onde está, sem seguir o último ponto do mouse
  syncMouseButton();
}

// Como jogar: popover pequeno ancorado ao botão "?", sempre fora do palco quando há espaço lateral.
let howOpen = false;
function setHowOpen(open) {
  if (open === howOpen) return;
  howOpen = open;
  if (open) setHelpOpen(false);
  ui.howPopover.hidden = !open;
  ui.howButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) { setPaused(true, 'howto'); placeHowPopover(); }   // abrir o menu pausa a partida (fechar não retoma: Continuar faz a contagem)
}

// Abaixo do botão; se não couber, acima; se não couber, ao lado. Sempre dentro da arena.
function placeHowPopover() {
  const pop = ui.howPopover;
  const a = ui.arena.getBoundingClientRect(), b = ui.howButton.getBoundingClientRect();
  const pad = 8, gap = 12;
  pop.style.maxHeight = `${Math.max(120, a.height - pad * 2)}px`;
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const bx = b.left - a.left, by = b.top - a.top;
  let place = 'side', left, top, ax = 22, ay = 22;
  if (a.height - (by + b.height + gap) >= ph + pad) place = 'below';
  else if (by - gap >= ph + pad) place = 'above';
  if (place === 'side') {
    left = bx + b.width + gap;
    top = clamp(by, pad, a.height - ph - pad);
    if (left + pw > a.width - pad) left = Math.max(pad, a.width - pw - pad);
    ay = clamp(by + b.height / 2 - top, 16, ph - 16);
  } else {
    left = clamp(bx, pad, a.width - pw - pad);
    top = place === 'below' ? by + b.height + gap : by - gap - ph;
    ax = clamp(bx + b.width / 2 - left, 16, pw - 16);
  }
  pop.dataset.placement = place;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
  pop.style.setProperty('--arrow-x', `${Math.round(ax)}px`);
  pop.style.setProperty('--arrow-y', `${Math.round(ay)}px`);
}

/* ===== 7. ENTRADA ===== */
const LEFT_KEYS = new Set(['ArrowLeft', 'KeyA']);
const RIGHT_KEYS = new Set(['ArrowRight', 'KeyD']);
const drag = { id: null, lastX: 0, startX: 0, startY: 0, moved: false };

function stageRect() { return ui.stage.getBoundingClientRect(); }
function setTarget(x) { game.target = clamp(x, FIELD.left, FIELD.right - game.paddle.w); }

function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  Sound.unlock();
  const isLeft = LEFT_KEYS.has(e.code), isRight = RIGHT_KEYS.has(e.code);
  if (levelOpen && (e.code === 'Space' || e.code === 'Enter') && e.target.closest && e.target.closest('.level-menu')) return;   // Enter/Espaço ativam o botão focado no painel
  if ((e.code === 'Space' || e.code === 'Enter') && game.state === STATES.PAUSED && e.target.closest && e.target.closest('.pause-actions button')) return;   // Continuar / Reiniciar agem pelo próprio botão focado
  if (e.code === 'Escape' && howOpen) {
    setHowOpen(false);
  } else if (e.code === 'Escape' && levelOpen) {
    setLevelOpen(false);
  } else if (isLeft || isRight) {
    e.preventDefault();
    if (isLeft) input.left = true; else input.right = true;
  } else if (e.code === 'KeyM' && !e.repeat) {
    toggleMute();
  } else if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) {
    togglePause();
  } else if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    if (e.repeat) return;
    if (game.state === STATES.READY) startGame();
    else if (game.state === STATES.PAUSED) requestResume();
    else if (game.state === STATES.WON) nextLevel();
    else if (game.state === STATES.GAME_OVER) tryRestart();
    else if (e.code === 'Space') launch();
  }
}

function onKeyUp(e) {
  if (LEFT_KEYS.has(e.code)) input.left = false;
  if (RIGHT_KEYS.has(e.code)) input.right = false;
}

function paddleToClientX(clientX) {
  const r = stageRect();
  setTarget((clientX - r.left) / r.width * W - game.paddle.w / 2);
}

function onPointerDown(e) {
  if (howOpen && !(e.target.closest && e.target.closest('.how-popover, #how-button'))) { setHowOpen(false); return; }   // toque fora só fecha a ajuda
  if (levelOpen && (e.target === ui.levelMenu || !(e.target.closest && e.target.closest('.level-menu, #level-button, #pause-button')))) { setLevelOpen(false); return; }   // toque fora só fecha o seletor
  if (e.target.closest && e.target.closest('button, a, header, aside, .how-popover, .level-menu')) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  Sound.unlock();
  if (game.state === STATES.READY) { startGame(); return; }   // "Toque para iniciar"
  if (game.state !== STATES.PLAYING) return;
  if (e.pointerType === 'mouse') {
    if (mouseControl) paddleToClientX(e.clientX);
    launch();
  } else {
    drag.id = e.pointerId; drag.lastX = drag.startX = e.clientX; drag.startY = e.clientY; drag.moved = false;
  }
}

function onPointerMove(e) {
  if (game.state !== STATES.PLAYING) return;
  if (e.pointerType === 'mouse') { if (mouseControl) paddleToClientX(e.clientX); return; }
  if (e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.lastX;
  drag.lastX = e.clientX;
  if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 10) drag.moved = true;
  setTarget((game.target === null ? game.paddle.x : game.target) + dx / stageRect().width * W);
}

function onPointerEnd(e, cancelled) {
  if (e.pointerId !== drag.id) return;
  if (!cancelled && !drag.moved) launch();
  drag.id = null;
}

/* ===== 8. REDIMENSIONAMENTO ===== */
function resizeCanvas() {
  const { margin, maxCssHeight, helpRoom, howRoom, howStrip } = CONFIG.view;
  const availW = Math.max(1, ui.arena.clientWidth - margin * 2);
  const ratio = W / H;
  const baseH = ui.arena.clientHeight - (ui.arena.classList.contains('how-bottom') ? howStrip : 0);   // altura sem a faixa
  const fit = (h) => {
    let cssH = Math.min(Math.max(1, h - margin * 2), maxCssHeight);
    let cssW = cssH * ratio;
    if (cssW > availW) { cssW = availW; cssH = cssW / ratio; }
    return [Math.floor(cssW), Math.floor(cssH)];
  };

  let [cssW, cssH] = fit(baseH);
  // "Como jogar" fica ao lado do palco; sem espaço lateral, vai para uma faixa sob o palco
  const bottom = (ui.arena.clientWidth - cssW) / 2 < howRoom;
  if (bottom) [cssW, cssH] = fit(baseH - howStrip);
  ui.arena.style.setProperty('--how-strip', `${howStrip}px`);
  ui.arena.classList.toggle('how-bottom', bottom);

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  ui.stage.style.width = `${cssW}px`;
  ui.stage.style.height = `${cssH}px`;
  ui.stage.style.setProperty('--u', `${cssW / W}px`);
  // Ajuda: só aparece quando sobra espaço ao lado do palco (o tamanho do palco nunca depende dela)
  const fits = (ui.arena.clientWidth - cssW) / 2 >= helpRoom;
  ui.arena.style.setProperty('--stage-w', `${cssW}px`);
  ui.arena.classList.toggle('help-fits', fits);
  if (!fits) setHelpOpen(false);
  // Tooltips dos botões externos: ao lado quando há espaço; senão abrem para dentro, sem sair da arena
  const sideRoom = (ui.arena.clientWidth - cssW) / 2;
  ui.howButton.dataset.tipPos = bottom ? 'above-end' : sideRoom >= 200 ? 'right' : 'below-end';
  ui.mouseButton.dataset.tipPos = bottom ? 'above-start' : sideRoom >= 200 ? 'right' : 'above-end';
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(canvas.width * H / W));
  S = canvas.width / W;
  buildBackground();
  if (howOpen) placeHowPopover();
  render();
}

/* ===== 9. LOOP E INICIALIZAÇÃO ===== */
let rafId = null;
let lastTime = null;

function frame(now) {
  rafId = requestAnimationFrame(frame);
  if (countdown) tickCountdown(now);                 // a contagem usa o relógio real; o jogo (update) fica parado até o GO!
  if (lastTime === null) lastTime = now;
  const dt = Math.min(Math.max((now - lastTime) / 1000, 0), TIM.maxFrameTime);
  lastTime = now;
  update(dt);
  render();
  if (game.state === STATES.PLAYING && now - lastSaveAt > PAUSE.saveEvery * 1000) saveRun();   // salvamento contínuo
}

function init() {
  // Liga o motor (breakout_game.js) à interface; o motor só chama estes ganchos, nunca a tela diretamente
  Object.assign(hooks, { hud: syncHud, ui: syncUi, won: onWon, over: onOver, lineFx: spawnLineFx, clearLineFx, tickLineFx });

  // F5/reload: se havia partida salva, volta exatamente ao ponto em que parou, pausada em "Partida retomada"
  if (!restoreRun(store.loadRun())) {
    store.clearRun();
    loadLevel(startLevel());  // a tela inicial já mostra o tabuleiro da fase selecionada
  }
  document.getElementById('title-level').textContent = String(store.get('bestLevel', 1));
  syncHud();
  syncUi();
  syncMuteButton();
  syncMouseButton();
  syncLevelButton();
  buildHelp();

  document.addEventListener('keydown', onKeyDown, { passive: false });
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('pointerdown', onPointerDown, { passive: false });
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', (e) => { onPointerEnd(e, false); Sound.unlock(); });
  document.addEventListener('pointercancel', (e) => onPointerEnd(e, true));
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // Pausa automática: aba oculta/minimizada (visibilitychange) ou janela sem foco. Ao voltar, o jogo continua pausado
  // na tela de pausa e só segue (com 3-2-1-GO) quando o jogador pedir.
  window.addEventListener('blur', () => {
    input.left = input.right = false;
    drag.id = null;
    setPaused(true, 'auto');
  });
  document.addEventListener('visibilitychange', () => {
    lastTime = null;
    if (document.hidden) { setPaused(true, 'auto'); saveRun(); }
  });
  window.addEventListener('pagehide', saveRun);        // F5, fechar ou trocar de página: grava o estado exato
  window.addEventListener('beforeunload', saveRun);

  // Tooltips (data-tip): ao apertar o botão somem na hora e só voltam depois que o ponteiro sair e entrar de novo
  document.addEventListener('pointerdown', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) el.setAttribute('data-tip-off', ''); }, true);
  document.addEventListener('pointerout', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip-off]');
    if (el && !el.contains(e.relatedTarget)) el.removeAttribute('data-tip-off');
  });

  ui.muteButton.addEventListener('click', (e) => { e.stopPropagation(); toggleMute(); ui.muteButton.blur(); });
  ui.pauseButton.addEventListener('click', (e) => { e.stopPropagation(); togglePause(); ui.pauseButton.blur(); });   // alterna pausar/continuar; fora da partida não faz nada
  ui.helpButton.addEventListener('click', (e) => { e.stopPropagation(); setHelpOpen(!ui.arena.classList.contains('help-open')); ui.helpButton.blur(); });
  ui.howButton.addEventListener('click', (e) => { e.stopPropagation(); setHowOpen(!howOpen); ui.howButton.blur(); });
  ui.levelButton.addEventListener('click', (e) => { e.stopPropagation(); toggleLevelMenu(); ui.levelButton.blur(); });
  ui.levelClose.addEventListener('click', (e) => { e.stopPropagation(); setLevelOpen(false); });
  ui.levelPrev.addEventListener('click', (e) => { e.stopPropagation(); levelPage -= 1; renderLevelPage(); });
  ui.levelNext.addEventListener('click', (e) => { e.stopPropagation(); levelPage += 1; renderLevelPage(); });
  ui.mouseButton.addEventListener('click', (e) => { e.stopPropagation(); setMouseControl(!mouseControl); ui.mouseButton.blur(); });
  ui.howClose.addEventListener('click', (e) => { e.stopPropagation(); setHowOpen(false); ui.howClose.blur(); });
  ui.resumeButton.addEventListener('click', (e) => { e.stopPropagation(); requestResume(); ui.resumeButton.blur(); });
  ui.pauseRestart.addEventListener('click', (e) => { e.stopPropagation(); onPauseRestart(); });
  ui.nextButton.addEventListener('click', (e) => { e.stopPropagation(); nextLevel(); ui.nextButton.blur(); });
  ui.restartButton.addEventListener('click', (e) => { e.stopPropagation(); tryRestart(); ui.restartButton.blur(); });

  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', resizeCanvas);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resizeCanvas);

  resizeCanvas();
  if (rafId === null) rafId = requestAnimationFrame(frame);
}

init();

window.__breakout = { snapshotRun, restoreRun, setPaused, requestResume, togglePause, render, game, CONFIG, SHAPES, SPECIALS, update, launch, startGame, loadLevel, setPaddleX, applyEffect, buildLayout, dropItem, damage, BRICK_COLORS, BRICK_ICONS, SPEC_COL };
})();
