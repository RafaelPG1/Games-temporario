/* ==========================================================================
arcade/breakout/breakout_game.js - motor do Quebra-Blocos: configuração, blocos/poderes, áudio, estado,
fases, física, colisões, itens que caem e efeitos. Não toca na página: avisa a interface por BreakoutGame.hooks.
Ordem dos scripts: breakout_storage.js -> breakout_game.js -> breakout.js (cada um só depende dos anteriores).
Índice: 1 Configuração · 2 Áudio · 3 Estado e fases · 4 Física e efeitos
========================================================================== */
(() => {
'use strict';

/* ===== 1. CONFIGURAÇÃO (unidades do mundo 288 x 512 e segundos) ===== */
const CONFIG = {
  world: { width: 288, height: 512 },
  field: { left: 12, right: 276, top: 68, hudHeight: 56, pitY: 480, loseY: 486, floorY: 500 },
  bricks: { cols: 8, width: 33, height: 18, top: 84 },
  // BARRA: largura base cai 1 por grupo de 3 fases (e 3 a cada volta completa de 36 fases)
  paddle: { y: 436, height: 10, widthStart: 56, widthMin: 34, keySpeed: 380, maxAngle: 60, minAngle: 7 },
  // BOLA: velocidade sobe 5 por fase (+25 a cada volta), limitada por speedMax
  ball: { radius: 3.5, speedStart: 240, speedStep: 5, speedMax: 420, minVertical: 0.3, maxBalls: 8 },
  lives: 3, maxLives: 5,
  timing: { maxFrameTime: 1 / 30, maxStep: 1 / 120, maxMove: 2, lostDelay: 0.8, clearDelay: 0.7, lockTime: 0.4 },
  audio: { masterVolume: 0.3 },
  // helpRoom = espaço lateral mínimo (px) para o botão/painel de Efeitos ao lado do palco
  // howRoom = espaço lateral mínimo para o botão "Como jogar"; abaixo disso ele vai para uma faixa (howStrip, px) sob o palco
  view: { margin: 6, maxCssHeight: 1000, helpRoom: 296, howRoom: 66, howStrip: 56 },
  // PAUSA: countStep = segundos de cada número do 3-2-1; goTime = quanto o "GO!" fica na tela; saveEvery = intervalo do
  // salvamento automático da partida (s); confirmRestart = true faz o Reiniciar pedir um segundo toque (confirmTime s); false = um toque só
  pause: { countStep: 0.75, goTime: 0.55, saveEvery: 1, confirmRestart: false, confirmTime: 3 },
  // EFEITOS: time = duração (s); mult = fator; specials = [mínimo, extra aleatório] por fase
  fx: {
    wide: { time: 12, mult: 1.5 }, narrow: { time: 8, mult: 0.65 }, sticky: { time: 12 },
    puzzle: { time: 8, mult: 0.7 }, pspeed: { time: 7, mult: 0.5 }, sluggish: { time: 6, lag: 5 },
    shield: { time: 10 },
    // metralhadora: volleys = rajadas (1 por rebote da bola na barra); burst = tiros por canhão em cada rajada
    gun: { volleys: 4, burst: 3, interval: 0.07, speed: 520 },
    // coração: arco parabólico (gravity em u/s²; altura do arco e velocidade horizontal sorteadas nos intervalos)
    heart: { gravity: 260, apexMin: 18, apexMax: 60, vxMin: 20, vxMax: 75 },
    itemSpeed: 80, tntRadius: 1, specials: [4, 2],
    line: { reach: 3 },   // Fogo/Raio: blocos extras destruídos além do atingido
  },
};
const TIMED = ['wide', 'narrow', 'sticky', 'puzzle', 'pspeed', 'sluggish', 'shield'];

/* FORMATOS: 12 disposições x 3 níveis (t = 0, 1, 2). f(linha, coluna, nLinhas, t) -> true = bloco.
   Nível t usa 5 + t linhas; cada formato fica mais cheio/difícil com t. */
const SHAPES = [
  ['Muro cheio', () => true],
  ['Pirâmide invertida', (r, c, n) => { const m = Math.round(r * 3 / (n - 1)); return c >= m && c < 8 - m; }],
  ['Janelas', (r, c, n, t) => !(r % 2 === 1 && r <= 5 - 2 * t && (c % 4 === 1 || c % 4 === 2))],
  ['Xadrez', (r, c, n, t) => (t === 0 ? (r + c) % 2 === 0 : (r + c) % (t + 2) !== 0)],
  ['Moldura', (r, c, n, t) => Math.min(r, n - 1 - r, c, 7 - c) <= t],
  ['Diamante', (r, c, n, t) => Math.abs(c - 3.5) / 4 + Math.abs(r - (n - 1) / 2) / (n / 2 + 0.5) <= 0.85 + 0.2 * t],
  ['Escadaria', (r, c, n, t) => c <= r + 1 + t],
  ['Zigue-zague', (r, c, n, t) => { const z = Math.abs(((r + 2) % 6) - 3); return c >= z && c < z + 4 + t; }],
  ['Colunas', (r, c, n, t) => [c % 3 === 0, c % 2 === 0, c % 4 !== 1][t]],
  ['Fortaleza', (r, c, n, t) => (r === 0 ? c % 2 === 0 : !((c === 3 || c === 4) && r >= n - [2, 1, 0][t]))],
  ['Ampulheta', (r, c, n, t) => { const m = Math.round((3 - t) * (1 - Math.abs(r - (n - 1) / 2) / ((n - 1) / 2))); return c >= m && c < 8 - m; }],
  ['Corredor central', (r, c, n, t) => !((c === 3 || c === 4) && r < n - [0, 2, 4][t])],
];
const LEVEL_COUNT = SHAPES.length * 3;

function buildLayout(idx) {
  const f = SHAPES[Math.floor(idx / 3)][1], t = idx % 3, n = 5 + t;
  const rows = [];
  for (let r = 0; r < n; r++) {
    let s = '';
    for (let c = 0; c < 8; c++) s += f(r, c, n, t) ? 'X' : '.';
    rows.push(s);
  }
  return rows;
}

/* PALETA: somente as 5 cores originais dos blocos. Cada efeito usa uma delas; ícones e bordas usam tons dela. */
const C5 = { red: '#ff4d5e', orange: '#ff8c2e', yellow: '#ffd23f', green: '#4fd36b', blue: '#5b7cff' };
const shade = (hex, amount) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount));
  const to = (v) => ch(v).toString(16).padStart(2, '0');
  return `#${to((n >> 16) & 255)}${to((n >> 8) & 255)}${to(n & 255)}`;
};
// edge = borda; ink = ícone (tom escuro); pale = detalhe claro do ícone
const palette = (base) => ({ base, light: shade(base, 0.45), dark: shade(base, -0.28), edge: shade(base, -0.62), ink: shade(base, -0.62), pale: shade(base, 0.6) });
const BRICK_COLORS = [C5.red, C5.orange, C5.yellow, C5.green, C5.blue].map(palette);   // cor da linha = linha % 5

/* BLOCOS ESPECIAIS / ITENS: o bloco usa SEMPRE a cor da sua linha (fundo e borda); o tipo aparece só pelo ícone.
   color = cor do EFEITO (itens, indicadores, barra e ajuda); w = cópias no "saco embaralhado" (0 = só item);
   hp = batidas; item = item solto ao quebrar; bad = efeito negativo; l = rótulo na tela;
   n = nome na ajuda (padrão: rótulo); d = descrição curta; g = grupo na ajuda; tag = detalhe curto na ajuda.
   Não há fase mínima: qualquer bloco pode aparecer em qualquer fase (ver drawSpecialType). */
const FXC = CONFIG.fx;
const SPECIALS = {
  random:    { color: C5.blue, w: 5, item: 'random', g: 'blocos', l: '?', n: 'Aleatório', d: 'Sorteia um efeito ao quebrar. Quase sempre é bom.' },
  tough:     { color: C5.red, w: 3, hp: 2, item: 'puzzle', g: 'blocos', l: 'RESISTENTE', d: 'Aguenta 2 batidas e solta Bola lenta ao quebrar.' },
  hidden:    { color: C5.green, w: 2, hp: 2, g: 'blocos', l: 'OCULTO', d: 'Só o contorno aparece. Leva 2 batidas.' },
  tnt:       { color: C5.yellow, w: 2, g: 'blocos', l: 'TNT', d: 'Explode e quebra os blocos ao redor.' },
  ball:      { color: C5.yellow, w: 2, item: 'ball', g: 'poderes', l: 'BOLA EXTRA', d: 'Cria mais uma bola em jogo.' },
  heart:     { color: C5.orange, w: 2, item: 'heart', g: 'poderes', l: 'CORAÇÃO', tag: '+1 vida', d: 'Solta um coração em arco. Pegue com a barra para ganhar uma vida.' },
  wide:      { color: C5.green, w: 2, item: 'wide', g: 'poderes', l: 'BARRA +', tag: `${FXC.wide.time} s`, d: 'Aumenta a barra.' },
  fire:      { color: C5.orange, w: 2, item: 'fire', g: 'poderes', l: 'BOLA DE FOGO', tag: '1 impacto', d: 'Ao bater, explode em linha: destrói o bloco e mais 3 na horizontal, mesmo os resistentes.' },
  sticky:    { color: C5.green, w: 2, item: 'sticky', g: 'poderes', l: 'BARRA PEGAJOSA', tag: `${FXC.sticky.time} s`, d: 'A bola gruda na barra. Lance com Espaço ou toque.' },
  shield:    { color: C5.blue, w: 2, item: 'shield', g: 'poderes', l: 'ESCUDO', tag: `${FXC.shield.time} s`, d: 'Barreira sob a barra que rebate a bola.' },
  bolt:      { color: C5.yellow, w: 2, item: 'bolt', g: 'poderes', l: 'RAIO', tag: '1 impacto', d: 'Ao bater, cai um raio: destrói o bloco e mais 3 na vertical.' },
  gun:       { color: C5.orange, w: 2, item: 'gun', g: 'poderes', l: 'METRALHADORA', n: 'Metralhadora', tag: `${FXC.gun.volleys} rajadas`, d: 'Dois canhões nas pontas da barra atiram a cada rebote da bola.' },
  puzzle:    { color: C5.red, w: 0, g: 'poderes', l: 'BOLA LENTA', tag: `${FXC.puzzle.time} s`, d: 'Deixa a bola mais lenta.' },
  narrow:    { color: C5.red, w: 1, item: 'narrow', bad: true, g: 'armadilhas', l: 'BARRA -', tag: `${FXC.narrow.time} s`, d: 'Diminui a barra.' },
  pspeed:    { color: C5.orange, w: 1, item: 'pspeed', bad: true, g: 'armadilhas', l: 'BARRA LENTA', tag: `${FXC.pspeed.time} s`, d: 'A barra se move mais devagar.' },
  sluggish: { color: C5.blue, w: 1, item: 'sluggish', bad: true, g: 'armadilhas', l: 'RESPOSTA LENTA', tag: `${FXC.sluggish.time} s`, d: 'A barra demora a responder aos comandos.' },
};
// Resultados do bloco aleatório (peso): maioria positiva, negativos raros (~8%)
const RANDOM_POOL = [['wide', 3], ['fire', 1.5], ['sticky', 2], ['shield', 2], ['bolt', 2], ['puzzle', 2], ['ball', 3], ['heart', 2], ['gun', 3],
  ['narrow', 0.5], ['pspeed', 0.5], ['sluggish', 0.5]];

// Ícones SVG (FG = tom escuro, LT = tom claro, BS = cor do bloco). 'hidden' não tem ícone (bloco sólido).
const ICON_VIEW = { tnt: [20, 8], tough: [28, 13] };
const ICON_SRC = {
  random: '<rect x="6" y="1" width="4" height="14" fill="FG"/><rect x="1" y="6" width="14" height="4" fill="FG"/><rect x="7" y="3" width="2" height="10" fill="LT"/><rect x="3" y="7" width="10" height="2" fill="LT"/>',
  tough: '<g fill="FG"><rect x="0" y="6" width="28" height="1"/><rect x="9" y="0" width="1" height="6"/><rect x="19" y="0" width="1" height="6"/><rect x="4" y="7" width="1" height="6"/><rect x="14" y="7" width="1" height="6"/><rect x="24" y="7" width="1" height="6"/></g><g fill="LT" opacity="0.6"><rect x="0" y="0" width="9" height="1"/><rect x="10" y="0" width="9" height="1"/><rect x="20" y="0" width="8" height="1"/><rect x="0" y="7" width="4" height="1"/><rect x="5" y="7" width="9" height="1"/><rect x="15" y="7" width="9" height="1"/><rect x="25" y="7" width="3" height="1"/></g>',
  // bola: esfera sólida com brilho e sombra no chão (antes parecia um relógio)
  ball: '<ellipse cx="8" cy="14.3" rx="4.2" ry="1" fill="FG" opacity="0.35"/><circle cx="8" cy="7.6" r="6" fill="FG"/><ellipse cx="5.8" cy="5.3" rx="2.1" ry="1.3" fill="LT" transform="rotate(-35 5.8 5.3)"/>',
  heart: '<path d="M8 14 2 8.2A3.6 3.6 0 0 1 8 4a3.6 3.6 0 0 1 6 4.2z" fill="FG"/><rect x="5" y="6" width="2" height="2" fill="LT"/>',
  tnt: '<g fill="FG"><rect x="0" y="0" width="6" height="2"/><rect x="2" y="2" width="2" height="6"/><rect x="7" y="0" width="2" height="8"/><rect x="11" y="0" width="2" height="8"/><rect x="9" y="2" width="1" height="2"/><rect x="10" y="4" width="1" height="2"/><rect x="14" y="0" width="6" height="2"/><rect x="16" y="2" width="2" height="6"/></g>',
  // barra +: seta horizontal de duas pontas (↔)
  wide: '<path d="M0.5 8 5 3.5v3h6v-3L15.5 8 11 12.5v-3H5v3z" fill="FG"/>',
  fire: '<path d="M8 1c1 3 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 2 2 2 0-2-1-3 0-6z" fill="FG"/><path d="M8 8c2 1 3 2 3 3.5a3 3 0 0 1-6 0C5 10 6 9 8 8z" fill="LT"/>',
  sticky: '<rect x="2" y="3" width="12" height="4" fill="FG"/><rect x="4" y="7" width="2" height="5" fill="FG"/><circle cx="5" cy="12.3" r="1.5" fill="FG"/><rect x="10" y="7" width="2" height="6" fill="FG"/><circle cx="11" cy="13.4" r="1.5" fill="FG"/>',
  shield: '<path d="M8 1l6 2v5c0 3-3 6-6 7-3-1-6-4-6-7V3z" fill="FG"/><path d="M8 4v8c2-1 4-3 4-5V5z" fill="BS"/>',
  bolt: '<path d="M9.5 1 3 9h4l-1 6 7-9H9z" fill="FG"/>',
  // metralhadora: barra com dois canhões e tiros subindo
  gun: '<rect x="1" y="12" width="14" height="3" fill="FG"/><rect x="2" y="7" width="3" height="5" fill="FG"/><rect x="11" y="7" width="3" height="5" fill="FG"/><rect x="3" y="1.5" width="1" height="3" fill="LT"/><rect x="12" y="1.5" width="1" height="3" fill="LT"/><rect x="3" y="5.5" width="1" height="1" fill="LT"/><rect x="12" y="5.5" width="1" height="1" fill="LT"/>',
  // barra -: duas setas apontando para o centro (→ ←)
  narrow: '<path d="M0.5 6.5h3V3.5L7.2 8l-3.7 4.5v-3h-3zM15.5 6.5h-3V3.5L8.8 8l3.7 4.5v-3h3z" fill="FG"/>',
  pspeed: '<path d="M2 12a6 6 0 0 1 12 0" fill="none" stroke="FG" stroke-width="2"/><path d="M8 12 5.5 7.5" stroke="FG" stroke-width="2" fill="none"/><circle cx="8" cy="12" r="1.5" fill="FG"/>',
  sluggish: '<circle cx="8" cy="8" r="6" fill="none" stroke="FG" stroke-width="2"/><path d="M8 4v4l3 2" fill="none" stroke="FG" stroke-width="2"/>',
  puzzle: '<path d="M2 4h4V3a2 2 0 0 1 4 0v1h4v4h-1a2 2 0 0 0 0 4h1v2H2z" fill="FG"/>',
};
const SPEC_COL = {};       // paleta do EFEITO (itens, indicadores, barra, ajuda); os blocos usam a cor da linha
const ICONS = {};          // ícone sobre a cor do efeito (itens e indicadores)
const BRICK_ICONS = {};    // ícone sobre cada cor de linha: BRICK_ICONS[tipo][linha] (contraste garantido em cada cor)
const ICON_SVG = {};       // ícone claro para fundo escuro (painel de ajuda)
const HEART_RED = ['#e5283f', '#ffb3bd'];
const svgOf = (k, fg, lt, bs) => {
  const [vw, vh] = ICON_VIEW[k] || [16, 16];
  const body = ICON_SRC[k].split('FG').join(fg).split('LT').join(lt).split('BS').join(bs);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" width="${vw * 8}" height="${vh * 8}">${body}</svg>`;
};
const imgOf = (svg) => {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return img;
};
for (const [k, sp] of Object.entries(SPECIALS)) {
  const pal = SPEC_COL[k] = palette(sp.color);
  if (!ICON_SRC[k]) continue;
  const [fg, lt] = k === 'heart' ? HEART_RED : [pal.ink, pal.pale];
  ICONS[k] = imgOf(svgOf(k, fg, lt, sp.color));
  BRICK_ICONS[k] = BRICK_COLORS.map((c) => imgOf(svgOf(k, c.ink, c.pale, c.base)));
  ICON_SVG[k] = svgOf(k, k === 'heart' ? HEART_RED[0] : pal.light, k === 'heart' ? HEART_RED[1] : pal.pale, '#141744');
}

// Ganchos para a interface (breakout.js os preenche): o motor nunca acessa o DOM nem chama funções de tela.
const hooks = {
  hud() {},             // placar, fase e vidas mudaram
  ui() {},              // classes/rótulos da tela mudaram (ex.: bola presa ou solta)
  won() {},             // fase concluída: mostrar a vitória e salvar
  over() {},            // fim de jogo: mostrar o Game Over
  lineFx() {},          // raio/fogo na tela: (tipo, x, y, largura, altura, origem)
  clearLineFx() {},     // limpa os efeitos de raio/fogo
  tickLineFx() {},      // passa o tempo de jogo dos efeitos de raio/fogo
};

const { world: WORLD, field: FIELD, bricks: BR, paddle: PAD, ball: BALL, timing: TIM, fx: FX } = CONFIG;
const W = WORLD.width;
const R = BALL.radius;
const SHIELD_Y = PAD.y + PAD.height + 12;
const STATES = { READY: 'ready', PLAYING: 'playing', PAUSED: 'paused', WON: 'won', GAME_OVER: 'gameOver' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MAX_ANGLE = PAD.maxAngle * Math.PI / 180;
const MIN_ANGLE = PAD.minAngle * Math.PI / 180;

// Persistência: breakout_storage.js (muted, bestLevel, bestScore, mouseControl)
const store = BreakoutStorage;

/* ===== 2. ÁUDIO (Web Audio API, sem arquivos externos) ===== */
const Sound = (() => {
  let audioContext = null, master = null, noiseBuffer = null, unavailable = false;
  let muted = false;
  muted = store.get('muted', false) === true;

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
    if (audioContext.state === 'suspended') { try { audioContext.resume().catch(() => {}); } catch (e) { /* ignora */ } }
    return audioContext;
  }

  function tone({ type = 'square', from, to = from, duration = 0.1, volume = 0.5, delay = 0 }) {
    const ac = ensureContext();
    if (!ac) return;
    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator(), gain = ac.createGain();
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
    const ac = ensureContext();
    if (!ac) return;
    if (!noiseBuffer) {
      const len = Math.floor(ac.sampleRate * 0.4);
      noiseBuffer = ac.createBuffer(1, len, ac.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const t0 = ac.currentTime;
    const src = ac.createBufferSource(), filter = ac.createBiquadFilter(), gain = ac.createGain();
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
      store.set('muted', muted);
      if (!muted) safely(ensureContext);
    },
    wall() { safely(() => tone({ type: 'square', from: 320, to: 270, duration: 0.04, volume: 0.16 })); },
    paddle() {
      safely(() => {
        tone({ type: 'triangle', from: 260, to: 170, duration: 0.07, volume: 0.5 });
        tone({ type: 'square', from: 520, to: 700, duration: 0.05, volume: 0.15, delay: 0.01 });
      });
    },
    brick(row) {
      safely(() => {
        const f = 920 - row * 85;             // linhas de cima soam mais agudas
        tone({ type: 'square', from: f, to: f * 0.72, duration: 0.09, volume: 0.22 });
        noise({ duration: 0.05, volume: 0.18, cutoff: 4200 });
      });
    },
    launch() { safely(() => tone({ type: 'triangle', from: 300, to: 640, duration: 0.09, volume: 0.35 })); },
    lose() {
      safely(() => {
        noise({ duration: 0.2, volume: 0.45, cutoff: 2000 });
        tone({ type: 'sawtooth', from: 330, to: 55, duration: 0.5, volume: 0.35 });
      });
    },
    win() {
      safely(() => {
        [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'square', from: f, duration: 0.14, volume: 0.22, delay: i * 0.1 }));
        tone({ type: 'triangle', from: 262, duration: 0.5, volume: 0.35 });
      });
    },
    over() {
      safely(() => [392, 330, 262, 196].forEach((f, i) => tone({ type: 'triangle', from: f, duration: 0.22, volume: 0.4, delay: i * 0.2 })));
    },
    click() { safely(() => tone({ type: 'square', from: 520, to: 700, duration: 0.05, volume: 0.22 })); },
    tick(go) {   // contagem 3-2-1: bip curto; o GO! é mais agudo e sobe
      safely(() => tone({ type: 'square', from: go ? 700 : 440, to: go ? 1250 : 440, duration: go ? 0.2 : 0.08, volume: go ? 0.3 : 0.22 }));
    },
    crack() { safely(() => { tone({ type: 'square', from: 200, to: 120, duration: 0.06, volume: 0.25 }); noise({ duration: 0.06, volume: 0.2, cutoff: 3000 }); }); },
    boom() { safely(() => { noise({ duration: 0.38, volume: 0.7, cutoff: 900 }); tone({ type: 'sawtooth', from: 140, to: 40, duration: 0.35, volume: 0.4 }); }); },
    power() { safely(() => [600, 800, 1000].forEach((f, i) => tone({ type: 'triangle', from: f, duration: 0.08, volume: 0.3, delay: i * 0.05 }))); },
    bad() { safely(() => tone({ type: 'sawtooth', from: 300, to: 100, duration: 0.25, volume: 0.3 })); },
    zap() { safely(() => { tone({ type: 'sawtooth', from: 1400, to: 200, duration: 0.18, volume: 0.3 }); noise({ duration: 0.12, volume: 0.25, cutoff: 6000 }); }); },
    shot() { safely(() => { tone({ type: 'square', from: 900, to: 300, duration: 0.05, volume: 0.14 }); noise({ duration: 0.04, volume: 0.12, cutoff: 5000 }); }); },
  };
})();

/* ===== 3. ESTADO E FASES ===== */
const freshFx = () => ({ wide: 0, narrow: 0, sticky: 0, puzzle: 0, pspeed: 0, sluggish: 0, shield: 0, gun: 0 });
const game = {
  state: STATES.READY, level: 1, score: 0, lives: CONFIG.lives,
  rows: 0, alive: 0, bricks: [], grid: [],
  paddle: { x: 0, w: PAD.widthStart, base: PAD.widthStart },
  balls: [], baseSpeed: BALL.speedStart,
  phase: 'play',          // 'play' | 'lost' (aguardando nova bola) | 'cleared' (fase limpa)
  timer: 0, idleTime: 0, pitFlash: 0,
  particles: [], items: [], blasts: [], popups: [], trailClock: 0, clock: 0,
  fx: freshFx(), target: null, pv: 0,
  heartSlots: [],          // heartSlots[i] = a vida i veio de um coração (aparece como coração vermelho no placar)
  newLife: -1,             // índice da vida recém-ganha (animação no placar)
  shots: [], gunFire: null, gunKick: 0,   // metralhadora: tiros, rajada em andamento, recuo dos canhões
};
const input = { left: false, right: false };

function setPaddleX(x) {
  game.paddle.x = clamp(x, FIELD.left, FIELD.right - game.paddle.w);
}

// Largura = base x efeitos (calculada do zero a cada passo: nada se acumula nem fica preso)
function updatePaddle() {
  const p = game.paddle, fx = game.fx;
  const w = p.base * (fx.wide > 0 ? FX.wide.mult : 1) * (fx.narrow > 0 ? FX.narrow.mult : 1);
  if (Math.abs(w - p.w) < 0.01) return;
  const center = p.x + p.w / 2;
  p.w = w;
  setPaddleX(center - w / 2);
}

function popup(text, x, y, color = '#ffffff') {
  game.popups.push({ text, x, y, t: 0, max: 1.3, color });
}

function newBall(x, y) {
  return { x, y, vx: 0, vy: 0, speed: game.baseSpeed, stuck: false, off: 0, color: '#ffffff', trail: [], dead: false, power: null };
}

function loadLevel(n) {
  const idx = (n - 1) % LEVEL_COUNT, lap = Math.floor((n - 1) / LEVEL_COUNT);
  const layout = buildLayout(idx);
  game.level = n;
  if (n > store.get('bestLevel', 1)) store.set('bestLevel', n);   // estatística: fase mais alta alcançada em uma partida
  game.rows = layout.length;
  game.bricks = [];
  game.grid = new Array(BR.cols * game.rows).fill(null);
  for (let r = 0; r < layout.length; r++) {
    for (let c = 0; c < BR.cols; c++) {
      if (layout[r][c] !== 'X') continue;
      const brick = { r, c, x: FIELD.left + c * BR.width, y: BR.top + r * BR.height, color: r % BRICK_COLORS.length, type: null, hp: 1, flash: 0 };
      game.bricks.push(brick);
      game.grid[r * BR.cols + c] = brick;
    }
  }
  game.alive = game.bricks.length;
  placeSpecials();
  game.paddle.base = Math.max(PAD.widthMin, PAD.widthStart - Math.floor(idx / 3) - 3 * lap);
  game.paddle.w = game.paddle.base;
  setPaddleX((FIELD.left + FIELD.right - game.paddle.w) / 2);
  game.baseSpeed = Math.min(BALL.speedMax, BALL.speedStart + BALL.speedStep * idx + 25 * lap);
  Object.assign(game, { fx: freshFx(), target: null, pv: 0, pitFlash: 0, shots: [], gunFire: null, gunKick: 0 });
  game.particles = []; game.items = []; game.blasts = []; game.popups = [];
  hooks.clearLineFx();
  resetServe();
  popup(`${SHAPES[Math.floor(idx / 3)][0]} ${idx % 3 + 1}/3`, W / 2, 330, '#c7ceef');
}

// "Saco embaralhado": cada tipo entra com w cópias, o saco é embaralhado e sorteado sem reposição;
// só se enche de novo quando esvazia. Assim TODOS os tipos aparecem em ciclos curtos, em qualquer fase,
// sem que nenhum fique excluído (a antiga fase mínima do bloco aleatório foi removida) nem raro demais.
const session = { bag: [], picked: null };   // saco de blocos especiais e fase escolhida no seletor (gravados junto da partida)
function drawSpecialType() {
  if (!session.bag.length) {
    for (const [k, s] of Object.entries(SPECIALS)) for (let i = 0; i < s.w; i++) session.bag.push(k);
    for (let i = session.bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [session.bag[i], session.bag[j]] = [session.bag[j], session.bag[i]];
    }
  }
  return session.bag.pop();
}

// Escolhe posições dentro do formato, sempre afastadas entre si (nunca vizinhas), e sorteia o tipo de cada uma
function placeSpecials() {
  const count = Math.min(game.bricks.length >> 2, FX.specials[0] + Math.floor(Math.random() * (FX.specials[1] + 1)));
  const placed = [];
  for (let tries = 0; placed.length < count && tries < 120; tries++) {
    const b = game.bricks[Math.floor(Math.random() * game.bricks.length)];
    if (b.type || placed.some((p) => Math.abs(p.r - b.r) < 2 && Math.abs(p.c - b.c) < 2)) continue;
    const type = drawSpecialType();
    b.type = type; b.hp = SPECIALS[type].hp || 1;
    placed.push(b);
  }
}

function resetServe() {
  const b = newBall(game.paddle.x + game.paddle.w / 2, PAD.y - R);
  b.stuck = true;
  game.balls = [b];
  game.phase = 'play';
  hooks.ui();
}

// Fases desbloqueadas = 1..bestLevel (a fase mais alta já alcançada, como sempre). A partida começa na fase
// escolhida no seletor; sem escolha manual, na última desbloqueada.
const unlockedLevel = () => Math.max(1, Math.floor(store.get('bestLevel', 1)));
const startLevel = () => (session.picked === null ? unlockedLevel() : Math.min(session.picked, unlockedLevel()));

function releaseBall(b) {
  const p = game.paddle;
  let a;
  if (Math.abs(b.off) < 2) a = (Math.random() < 0.5 ? -1 : 1) * (0.2 + Math.random() * 0.36);   // 11° a 32°
  else { a = clamp(b.off / (p.w / 2), -1, 1) * MAX_ANGLE; if (Math.abs(a) < MIN_ANGLE) a = Math.sign(a) * MIN_ANGLE; }
  b.stuck = false;
  b.vx = Math.sin(a) * b.speed;
  b.vy = -Math.cos(a) * b.speed;
}

// Espaço/toque: solta as bolas presas
function launch() {
  if (game.state !== STATES.PLAYING || game.phase !== 'play') return;
  const stuck = game.balls.filter((b) => b.stuck);
  if (stuck.length) { stuck.forEach(releaseBall); Sound.launch(); hooks.ui(); }
}

function loseLife() {
  game.lives -= 1;
  game.phase = 'lost';
  game.timer = TIM.lostDelay;
  game.pitFlash = 0.45;
  game.items = [];
  if (game.lives >= 0) game.heartSlots[game.lives] = false;          // a vida perdida deixa de ser "de coração"
  Object.assign(game, { fx: freshFx(), shots: [], gunFire: null });  // perder a bola perde os efeitos ativos
  Sound.lose();
  hooks.hud();
}

function clearLevel() {
  game.phase = 'cleared';
  game.timer = TIM.clearDelay;
  game.balls = [];
  game.items = [];
  game.shots = []; game.gunFire = null;
  Sound.win();
}

function showWon() {
  game.state = STATES.WON;
  game.idleTime = 0;
  store.recordScore(game.score);
  hooks.won();                          // interface: textos da vitória, painéis e salvamento
}

function gameOver() {
  game.state = STATES.GAME_OVER;
  game.idleTime = 0;
  store.recordScore(game.score);
  Sound.over();
  store.clearRun();                    // partida encerrada: não há o que retomar
  hooks.over();                        // interface: textos do Game Over e painéis
}

/* ===== 4. FÍSICA E EFEITOS ===== */
function normalizeBall(b) {
  const len = Math.hypot(b.vx, b.vy) || 1;
  b.vx = b.vx / len * b.speed;
  b.vy = b.vy / len * b.speed;
  const minY = b.speed * BALL.minVertical;
  if (Math.abs(b.vy) < minY) {
    b.vy = (b.vy < 0 ? -1 : 1) * minY;
    b.vx = (b.vx < 0 ? -1 : 1) * Math.sqrt(b.speed * b.speed - minY * minY);
  }
}

function collideWalls(b) {
  let hit = false;
  if (b.x - R < FIELD.left) { b.x = FIELD.left + R; b.vx = Math.abs(b.vx); hit = true; }
  else if (b.x + R > FIELD.right) { b.x = FIELD.right - R; b.vx = -Math.abs(b.vx); hit = true; }
  if (b.y - R < FIELD.top) { b.y = FIELD.top + R; b.vy = Math.abs(b.vy); hit = true; }
  if (hit) { normalizeBall(b); Sound.wall(); }
}

function collidePaddle(b) {
  const p = game.paddle, top = PAD.y;
  const px = clamp(b.x, p.x, p.x + p.w), py = clamp(b.y, top, top + PAD.height);
  const dx = b.x - px, dy = b.y - py;
  if (dx * dx + dy * dy >= R * R) return;

  if (b.y < top + PAD.height * 0.5) {
    if (b.vy <= 0) return;                             // já está subindo: não bate de novo
    if (game.fx.sticky > 0) {                          // barra pegajosa: a bola fica presa onde tocou
      b.stuck = true; b.off = clamp(b.x - (p.x + p.w / 2), -p.w / 2, p.w / 2);
      b.vx = b.vy = 0; b.y = top - R;
      Sound.paddle(); hooks.ui();
      return;
    }
    const t = clamp((b.x - (p.x + p.w / 2)) / (p.w / 2), -1, 1);
    let a = t * MAX_ANGLE;
    if (Math.abs(a) < MIN_ANGLE) a = ((a < 0 || (a === 0 && Math.random() < 0.5)) ? -1 : 1) * MIN_ANGLE;
    b.vx = Math.sin(a) * b.speed;
    b.vy = -Math.cos(a) * b.speed;
    b.y = top - R;
    Sound.paddle();
    if (game.fx.gun > 0) startVolley();             // 1 rajada por rebote: a bola sobe logo depois, então não repete
  } else {
    const left = b.x < p.x + p.w / 2;
    b.x = left ? p.x - R : p.x + p.w + R;
    b.vx = (left ? -1 : 1) * Math.max(Math.abs(b.vx), b.speed * 0.35);
    normalizeBall(b);
    Sound.wall();
  }
}

// --- Blocos: dano, destruição e efeitos especiais ---
// force = ignora a resistência (fogo, TNT). Blocos de 2 batidas só perdem 1 de hp sem force.
function damage(brick, force) {
  if (game.grid[brick.r * BR.cols + brick.c] !== brick) return;   // já destruído: nunca ativa duas vezes
  if (!force && brick.hp > 1) {
    brick.hp -= 1; brick.flash = 0.15; game.score += 5;
    Sound.crack(); hooks.hud();
    return;
  }
  destroyBrick(brick);
}

function destroyBrick(brick) {
  game.grid[brick.r * BR.cols + brick.c] = null;   // remove primeiro: evita reentrada em explosões em cadeia
  game.alive -= 1;
  const sp = brick.type && SPECIALS[brick.type];
  const col = BRICK_COLORS[brick.color];
  const cx = brick.x + BR.width / 2, cy = brick.y + BR.height / 2;
  game.score += sp ? 50 : Math.max(10, (7 - brick.r) * 10);
  const n = sp ? 12 : 7;
  for (let i = 0; i < n && game.particles.length < 200; i++) {
    game.particles.push({
      x: cx + (Math.random() - 0.5) * 14, y: cy + (Math.random() - 0.5) * 6,
      vx: (Math.random() - 0.5) * 120, vy: -20 - Math.random() * 70,
      life: 0.5 + Math.random() * 0.2, max: 0.7, color: i % 3 === 0 ? col.light : col.base,
    });
  }
  Sound.brick(Math.min(brick.r, 6));
  if (sp) {
    if (brick.type === 'tnt') explode(brick, cx, cy);   // TNT só quebra blocos ao redor: não é um poder da barra
    else if (sp.item) dropItem(sp.item, cx, cy);        // todo poder: apenas CRIA o item; o efeito só vem da coleta (applyEffect)
  }
  hooks.hud();
}

function explode(brick, cx, cy) {
  game.blasts.push({ x: cx, y: cy, t: 0, max: 0.45, r: (FX.tntRadius + 0.7) * BR.width });
  Sound.boom();
  const rad = FX.tntRadius;
  for (let r = brick.r - rad; r <= brick.r + rad; r++) {
    for (let c = brick.c - rad; c <= brick.c + rad; c++) {
      if (r < 0 || c < 0 || c >= BR.cols || r >= game.rows) continue;
      const nb = game.grid[r * BR.cols + c];
      if (nb) destroyBrick(nb);                       // inclui outros especiais (TNT em cadeia, bola, coração...)
    }
  }
}

// Cria a bola extra (chamada só por applyEffect, ao coletar o item)
function spawnBall(x, y, color) {
  if (game.balls.length >= BALL.maxBalls) return;
  const b = newBall(x, y), a = (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.5);
  b.color = color;
  b.vx = Math.sin(a) * b.speed;
  b.vy = Math.cos(a) * b.speed;                     // desce em direção à barra
  game.balls.push(b);
}

// Item aleatório: o sorteio só acontece quando a barra o pega (ver applyEffect)
function pickRandomType() {
  const total = RANDOM_POOL.reduce((a, [, w]) => a + w, 0);
  let v = Math.random() * total, type = RANDOM_POOL[0][0];
  for (const [k, w] of RANDOM_POOL) { v -= w; if (v < 0) { type = k; break; } }
  return type;
}

// Coração coletado: +1 vida (até maxLives), que aparece como coração vermelho no placar.
// Com as vidas cheias a coleta não se perde: vale pontos. O item já foi removido antes (nunca conta duas vezes).
function collectHeart(x) {
  const px = clamp(x, 36, W - 36);
  if (game.lives < CONFIG.maxLives) {
    game.heartSlots[game.lives] = true;
    game.newLife = game.lives;
    game.lives += 1;
    popup('+1 VIDA', px, PAD.y - 12, '#ff7a8a');
  } else {
    game.score += 100;
    popup('VIDAS CHEIAS +100', px, PAD.y - 12, '#ff7a8a');
  }
  Sound.power();
  hooks.hud();
}

// Solta um item. Itens comuns caem em linha reta; o coração sai em arco parabólico
// (direção horizontal e altura do arco sorteadas) e não interage com blocos.
function dropItem(type, x, y) {
  const it = { type, x, y, vx: 0, vy: FX.itemSpeed, g: 0 };
  if (type === 'heart') {
    const H0 = FX.heart, apex = H0.apexMin + Math.random() * (H0.apexMax - H0.apexMin);
    it.g = H0.gravity;
    it.vy = -Math.sqrt(2 * it.g * apex);
    it.vx = (Math.random() < 0.5 ? -1 : 1) * (H0.vxMin + Math.random() * (H0.vxMax - H0.vxMin));
  }
  game.items.push(it);
}

// ÚNICO ponto onde um efeito é aplicado, e só a coleta do item pela barra (stepItems) chama esta função.
// Aleatório: sorteia aqui, na coleta; o sorteado vale na hora (não solta outro item).
// Temporários (inclusive o escudo) são apenas (re)armados: o valor real é recalculado a cada passo.
function applyEffect(type, x, y) {
  if (type === 'random') type = pickRandomType();
  if (type === 'heart') { collectHeart(x); return; }          // vida: popup e som próprios
  const sp = SPECIALS[type], fx = game.fx;
  if (type === 'gun') fx.gun = FX.gun.volleys;
  else if (type === 'ball') spawnBall(x, y, SPECIALS.ball.color);
  else if (type === 'fire') game.balls.forEach((b) => { b.power = 'fire'; });   // dura até a bola atingir um bloco
  else if (type === 'bolt') game.balls.forEach((b) => { b.power = 'bolt'; });   // dura até a bola atingir um bloco
  else fx[type] = FX[type].time;
  popup(sp.l, x, y, sp.bad ? '#ff4d5e' : '#ffffff');
  if (sp.bad) Sound.bad(); else Sound.power();
}

// --- Metralhadora: uma rajada por rebote da bola na barra; cada rajada = burst disparos de cada canhão ---
function startVolley() {
  game.fx.gun -= 1;
  const pending = game.gunFire ? game.gunFire.left : 0;        // rajada anterior ainda saindo: soma em vez de perder
  game.gunFire = { left: pending + FX.gun.burst, t: 0 };
}

function fireCannons() {
  const p = game.paddle;
  for (const x of [p.x + 3, p.x + p.w - 3]) game.shots.push({ x, y: PAD.y - 8 });
  game.gunKick = 1;
  Sound.shot();
}

function stepGun(h) {
  const gf = game.gunFire;
  if (gf) {
    gf.t -= h;
    if (gf.t <= 0 && gf.left > 0) { fireCannons(); gf.left -= 1; gf.t = FX.gun.interval; }
    if (gf.left <= 0) game.gunFire = null;
  }
  for (let i = game.shots.length - 1; i >= 0; i--) {
    const sh = game.shots[i];
    sh.y -= FX.gun.speed * h;
    let hit = sh.y < FIELD.top;                             // topo da arena
    if (!hit) {
      const col = Math.floor((sh.x - FIELD.left) / BR.width), row = Math.floor((sh.y - BR.top) / BR.height);
      if (row >= 0 && row < game.rows && col >= 0 && col < BR.cols) {
        const nb = game.grid[row * BR.cols + col];
        if (nb) { damage(nb, false); hit = true; }              // mesma regra da bola: resistentes levam 2 tiros
      }
    }
    if (hit) {
      for (let k = 0; k < 3 && game.particles.length < 200; k++) {
        game.particles.push({ x: sh.x, y: sh.y, vx: (Math.random() - 0.5) * 80, vy: -10 - Math.random() * 40, life: 0.3, max: 0.3, color: '#ffd23f' });
      }
      game.shots.splice(i, 1);
    }
  }
}

// --- Poderes da bola em linha: Fogo (3 extras na horizontal) e Raio (3 extras na vertical) ---
// Janela contígua de 4 células: o bloco atingido + 3 extras, priorizando o sentido em que a bola vinha
// e completando para o outro lado quando há borda.
function lineSpan(brick, axis, dir) {
  const base = axis === 'h' ? brick.c : brick.r;
  const max = axis === 'h' ? BR.cols : game.rows;
  let lo = base, hi = base, extra = 0;
  for (let k = 1; k < max && extra < FX.line.reach; k++) {
    for (const s of [dir, -dir]) {
      const v = base + s * k;
      if (v < 0 || v >= max || extra >= FX.line.reach) continue;
      lo = Math.min(lo, v); hi = Math.max(hi, v); extra++;
    }
  }
  return [lo, hi];
}

function ballPowerBlast(brick, power, dirX, dirY) {
  const horizontal = power === 'fire';
  const [lo, hi] = lineSpan(brick, horizontal ? 'h' : 'v', horizontal ? dirX : dirY);
  if (horizontal) {
    const w = (hi - lo + 1) * BR.width;
    hooks.lineFx('fire', FIELD.left + lo * BR.width, brick.y - 4, w, BR.height + 8, `${((brick.c - lo + 0.5) * BR.width / w * 100).toFixed(1)}%`);
    Sound.boom();
  } else {
    const h = (hi - lo + 1) * BR.height;
    hooks.lineFx('bolt', FIELD.left + brick.c * BR.width, BR.top + lo * BR.height, BR.width, h, `${((brick.r - lo + 0.5) * BR.height / h * 100).toFixed(1)}%`);
    Sound.zap();
  }
  for (let i = lo; i <= hi; i++) {               // inclui o bloco atingido; damage() ignora os já destruídos
    const nb = horizontal ? game.grid[brick.r * BR.cols + i] : game.grid[i * BR.cols + brick.c];
    if (nb) damage(nb, true);                       // force: ignora resistência e oculto
  }
}

// Círculo contra retângulo; só o bloco mais próximo por micro-passo.
function collideBricks(b) {
  const c0 = Math.max(0, Math.floor((b.x - R - FIELD.left) / BR.width));
  const c1 = Math.min(BR.cols - 1, Math.floor((b.x + R - FIELD.left) / BR.width));
  const r0 = Math.max(0, Math.floor((b.y - R - BR.top) / BR.height));
  const r1 = Math.min(game.rows - 1, Math.floor((b.y + R - BR.top) / BR.height));
  let best = null, bestD2 = Infinity, bdx = 0, bdy = 0;

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const brick = game.grid[r * BR.cols + c];
      if (!brick) continue;
      const dx = b.x - clamp(b.x, brick.x, brick.x + BR.width);
      const dy = b.y - clamp(b.y, brick.y, brick.y + BR.height);
      const d2 = dx * dx + dy * dy;
      if (d2 < R * R && d2 < bestD2) { best = brick; bestD2 = d2; bdx = dx; bdy = dy; }
    }
  }
  if (!best) return;

  const dirX = b.vx < 0 ? -1 : 1, dirY = b.vy < 0 ? -1 : 1;   // sentido da bola antes do quique

  if (bestD2 === 0) {
    const l = b.x - best.x, rt = best.x + BR.width - b.x, t = b.y - best.y, bt = best.y + BR.height - b.y;
    const m = Math.min(l, rt, t, bt);
    if (m === t) { b.y = best.y - R; b.vy = -Math.abs(b.vy); }
    else if (m === bt) { b.y = best.y + BR.height + R; b.vy = Math.abs(b.vy); }
    else if (m === l) { b.x = best.x - R; b.vx = -Math.abs(b.vx); }
    else { b.x = best.x + BR.width + R; b.vx = Math.abs(b.vx); }
  } else {
    const dist = Math.sqrt(bestD2), push = R - dist;
    b.x += bdx / dist * push;
    b.y += bdy / dist * push;
    const flipX = () => { if (bdx !== 0 && b.vx * bdx < 0) { b.vx = -b.vx; return true; } return false; };
    const flipY = () => { if (bdy !== 0 && b.vy * bdy < 0) { b.vy = -b.vy; return true; } return false; };
    if (Math.abs(bdx) > Math.abs(bdy)) { if (!flipX()) flipY(); } else if (!flipY()) flipX();
  }

  const power = b.power;                           // poder consumido neste impacto, antes do dano (correntes não o reaproveitam)
  b.power = null;                                  // a bola volta ao normal
  if (power) ballPowerBlast(best, power, dirX, dirY);
  else damage(best, false);
  normalizeBall(b);
}

function stepBall(b, h) {
  const p = game.paddle;
  const sp = game.baseSpeed * (game.fx.puzzle > 0 ? FX.puzzle.mult : 1);   // velocidade recalculada: não acumula
  if (b.speed !== sp) { b.speed = sp; if (!b.stuck) normalizeBall(b); }
  if (b.stuck) { b.x = clamp(p.x + p.w / 2 + b.off, FIELD.left + R, FIELD.right - R); b.y = PAD.y - R; return; }
  const n = Math.max(1, Math.ceil(b.speed * h / TIM.maxMove));
  const d = h / n;
  for (let i = 0; i < n; i++) {
    b.x += b.vx * d;
    b.y += b.vy * d;
    collideWalls(b);
    collidePaddle(b);
    if (b.stuck) return;
    collideBricks(b);
    if (game.alive === 0) { clearLevel(); return; }
    if (game.fx.shield > 0 && b.vy > 0 && b.y + R >= SHIELD_Y) {   // escudo rebate a bola e continua ativo até o tempo acabar
      b.y = SHIELD_Y - R; b.vy = -Math.abs(b.vy);
      Sound.wall();
    }
    if (b.y > FIELD.loseY) { b.dead = true; return; }
  }
}

function stepBalls(h) {
  for (let i = game.balls.length - 1; i >= 0; i--) {
    stepBall(game.balls[i], h);
    if (game.phase !== 'play') return;
    if (game.balls[i] && game.balls[i].dead) game.balls.splice(i, 1);
  }
  if (game.balls.length === 0) loseLife();         // só perde vida quando TODAS as bolas caem
}

// Itens caindo: ao tocar a barra são coletados (somem e só então aplicam o efeito); nunca quicam.
// A checagem usa a posição anterior também, para não "atravessar" a barra entre dois passos.
// O coração tem gravidade e só é coletado na descida; nas paredes laterais ele rebate, no topo começa a cair.
function stepItems(h) {
  const p = game.paddle;
  for (let i = game.items.length - 1; i >= 0; i--) {
    const it = game.items[i];
    const prevY = it.y;
    if (it.g) {
      it.vy += it.g * h;
      it.x += it.vx * h;
      if (it.x < FIELD.left + 7) { it.x = FIELD.left + 7; it.vx = Math.abs(it.vx); }
      else if (it.x > FIELD.right - 7) { it.x = FIELD.right - 7; it.vx = -Math.abs(it.vx); }
    }
    it.y += it.vy * h;
    if (it.y < FIELD.top + 7) { it.y = FIELD.top + 7; it.vy = Math.max(it.vy, 0); }
    if (it.vy > 0 && it.y + 7 >= PAD.y && prevY - 7 <= PAD.y + PAD.height && it.x >= p.x - 7 && it.x <= p.x + p.w + 7) {
      game.items.splice(i, 1);
      applyEffect(it.type, clamp(it.x, 36, W - 36), PAD.y - 12);   // coleta: o único caminho que aplica efeitos
    } else if (it.y > FIELD.pitY + 8) game.items.splice(i, 1);   // passou pela barra: some sem efeito
  }
}

function stepParticles(h) {
  const ps = game.particles;
  hooks.tickLineFx(h);                                  // interface: segurança que remove o raio/fogo que não terminou sozinho
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.life -= h;
    if (p.life <= 0) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
    p.vy += 320 * h;
    p.x += p.vx * h;
    p.y += p.vy * h;
  }
  if (game.pitFlash > 0) game.pitFlash = Math.max(0, game.pitFlash - h);
  for (const list of [game.blasts, game.popups]) {
    for (let i = list.length - 1; i >= 0; i--) {
      list[i].t += h;
      if (list[i].y !== undefined && list[i].text) list[i].y -= 18 * h;
      if (list[i].t >= list[i].max) list.splice(i, 1);
    }
  }
  for (const b of game.bricks) if (b.flash > 0) b.flash = Math.max(0, b.flash - h);
}

// Teclas: velocidade suavizada; ponteiro: segue o alvo. Efeitos da barra mudam só o limite/suavização.
function movePaddle(h) {
  const fx = game.fx, p = game.paddle;
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const vmax = PAD.keySpeed * (fx.pspeed > 0 ? FX.pspeed.mult : 1);
  const rate = fx.sluggish > 0 ? FX.sluggish.lag : 60;
  if (dir) game.target = null;
  game.pv += (dir * vmax - game.pv) * Math.min(1, h * rate);
  if (Math.abs(game.pv) < 0.5 && !dir) game.pv = 0;
  if (game.pv) setPaddleX(p.x + game.pv * h);
  if (game.target !== null) {
    let d = game.target - p.x;
    if (fx.sluggish > 0) d *= Math.min(1, h * rate);
    if (fx.pspeed > 0) d = clamp(d, -vmax * h, vmax * h);
    setPaddleX(p.x + d);
  }
}

function step(h) {
  const fx = game.fx;
  for (const k of TIMED) if (fx[k] > 0) fx[k] = Math.max(0, fx[k] - h);
  if (game.gunKick > 0) game.gunKick = Math.max(0, game.gunKick - h * 7);
  updatePaddle();
  movePaddle(h);

  if (game.phase === 'lost') {
    game.timer -= h;
    if (game.timer <= 0) {
      if (game.lives < 0) gameOver();               // a partida só termina ao chegar a -1 vida (0 vidas ainda joga)
      else { resetServe(); if (game.lives === 0) popup('ÚLTIMA CHANCE', W / 2, 330, '#ff4d5e'); }
    }
  } else if (game.phase === 'cleared') {
    game.timer -= h;
    if (game.timer <= 0) showWon();
  } else {
    stepBalls(h);
    if (game.phase === 'play') {
      stepItems(h);
      stepGun(h);
      if (game.alive === 0) clearLevel();          // fim de fase por TNT/raio também
    }
  }
  stepParticles(h);
}

function update(dt) {
  if (game.state === STATES.GAME_OVER || game.state === STATES.WON) {
    game.idleTime += dt;
    stepParticles(dt);
    return;
  }
  if (game.state !== STATES.PLAYING) return;
  game.clock += dt;

  const steps = Math.max(1, Math.ceil(dt / TIM.maxStep));
  const h = dt / steps;
  for (let i = 0; i < steps && game.state === STATES.PLAYING; i++) step(h);

  game.trailClock += dt;
  if (game.trailClock >= 0.016) {
    game.trailClock = 0;
    for (const b of game.balls) {
      if (b.stuck) b.trail.length = 0;
      else { b.trail.push({ x: b.x, y: b.y }); if (b.trail.length > 5) b.trail.shift(); }
    }
  }
}

window.BreakoutGame = {
  // configuração e medidas do mundo
  CONFIG, FIELD, BR, PAD, BALL, TIM, FX, W, R, SHIELD_Y, STATES, TIMED, SHAPES, LEVEL_COUNT,
  // blocos, poderes e ícones
  C5, SPECIALS, SPEC_COL, ICONS, BRICK_ICONS, ICON_SVG, ICON_VIEW, BRICK_COLORS,
  // estado, ganchos da interface e ações do jogo
  hooks, session, game, input, Sound, clamp, freshFx, setPaddleX, buildLayout, loadLevel, startLevel, unlockedLevel,
  launch, update, applyEffect, dropItem, damage,
};
})();
