/* ==========================================================================
breakout/breakout.js - Breakout em HTML5 Canvas + JavaScript puro.
Índice: 1 Configuração · 2 Áudio · 3 Estado e fases · 4 Física · 5 Renderização
· 6 Interface · 7 Entrada · 8 Redimensionamento · 9 Loop e inicialização
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
  audio: { masterVolume: 0.3, mutedKey: 'breakout:muted' },
  // helpRoom = espaço lateral mínimo (px) para exibir o botão/painel de ajuda ao lado do palco
  view: { margin: 6, maxCssHeight: 1000, helpRoom: 296 },
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
const PADDLE_FX = ['wide', 'narrow', 'sticky', 'pspeed', 'sluggish', 'gun'];   // efeitos que destacam a barra

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
  random:    { color: C5.blue, w: 5, g: 'blocos', l: '?', n: 'Aleatório', d: 'Sorteia um efeito ao quebrar. Quase sempre é bom.' },
  tough:     { color: C5.red, w: 3, hp: 2, item: 'puzzle', g: 'blocos', l: 'RESISTENTE', d: 'Aguenta 2 batidas e solta Bola lenta ao quebrar.' },
  hidden:    { color: C5.green, w: 2, hp: 2, g: 'blocos', l: 'OCULTO', d: 'Só o contorno aparece. Leva 2 batidas.' },
  tnt:       { color: C5.yellow, w: 2, g: 'blocos', l: 'TNT', d: 'Explode e quebra os blocos ao redor.' },
  ball:      { color: C5.yellow, w: 2, g: 'poderes', l: 'BOLA EXTRA', d: 'Cria mais uma bola em jogo.' },
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

const COLORS = {
  ink: '#0b0d26', hud: '#0f1235', hudLine: '#2a2f66',
  field: ['#1c2158', '#1a1f54', '#181c4f', '#16194a', '#141744', '#12153e', '#101338', '#0e1132'],
  grid: 'rgba(150,170,255,0.06)',
  steel: '#59628f', steelLight: '#9ba5d6', steelDark: '#2e3466', rivet: '#c9d0f0', rivetShade: '#262b58',
  pitBase: '#1a0d22', pitStripe: '#6f1b3a', pitEdge: '#ff4d5e',
  padWhite: '#ffffff',
  ball: '#ffffff', ballHalo: 'rgba(120,230,255,0.30)',
};

const { world: WORLD, field: FIELD, bricks: BR, paddle: PAD, ball: BALL, timing: TIM, fx: FX } = CONFIG;
const W = WORLD.width;
const H = WORLD.height;
const R = BALL.radius;
const SHIELD_Y = PAD.y + PAD.height + 12;
const STATES = { READY: 'ready', PLAYING: 'playing', PAUSED: 'paused', WON: 'won', GAME_OVER: 'gameOver' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MAX_ANGLE = PAD.maxAngle * Math.PI / 180;
const MIN_ANGLE = PAD.minAngle * Math.PI / 180;

/* ===== 2. ÁUDIO (Web Audio API, sem arquivos externos) ===== */
const Sound = (() => {
  let audioContext = null, master = null, noiseBuffer = null, unavailable = false;
  let muted = false;
  try { muted = window.localStorage.getItem(CONFIG.audio.mutedKey) === '1'; } catch (e) { /* sem armazenamento */ }

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
      try { window.localStorage.setItem(CONFIG.audio.mutedKey, muted ? '1' : '0'); } catch (e) { /* ignora */ }
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
  clearLineFx();
  resetServe();
  popup(`${SHAPES[Math.floor(idx / 3)][0]} ${idx % 3 + 1}/3`, W / 2, 330, '#c7ceef');
}

// "Saco embaralhado": cada tipo entra com w cópias, o saco é embaralhado e sorteado sem reposição;
// só se enche de novo quando esvazia. Assim TODOS os tipos aparecem em ciclos curtos, em qualquer fase,
// sem que nenhum fique excluído (a antiga fase mínima do bloco aleatório foi removida) nem raro demais.
let specialBag = [];
function drawSpecialType() {
  if (!specialBag.length) {
    for (const [k, s] of Object.entries(SPECIALS)) for (let i = 0; i < s.w; i++) specialBag.push(k);
    for (let i = specialBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [specialBag[i], specialBag[j]] = [specialBag[j], specialBag[i]];
    }
  }
  return specialBag.pop();
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
  syncUi();
}

function newGame() {
  game.score = 0;
  game.lives = CONFIG.lives;
  game.heartSlots = [];
  game.newLife = -1;
  loadLevel(1);
  game.state = STATES.PLAYING;
  syncHud();
  syncUi();
}

function startGame() {
  if (game.state !== STATES.READY) return;
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
}

function tryRestart() {
  if (game.state === STATES.GAME_OVER && game.idleTime > TIM.lockTime) { Sound.click(); newGame(); }
}

function setPaused(paused) {
  if (paused && game.state === STATES.PLAYING) game.state = STATES.PAUSED;
  else if (!paused && game.state === STATES.PAUSED) { game.state = STATES.PLAYING; lastTime = null; }
  else return;
  Sound.click();
  input.left = input.right = false;
  syncUi();
}

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
  if (stuck.length) { stuck.forEach(releaseBall); Sound.launch(); syncUi(); }
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
  syncHud();
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
  ui.wonScore.textContent = String(game.score);
  ui.wonLevel.textContent = String(game.level);
  syncUi();
}

function gameOver() {
  game.state = STATES.GAME_OVER;
  game.idleTime = 0;
  ui.overScore.textContent = String(game.score);
  ui.overLevel.textContent = String(game.level);
  Sound.over();
  syncUi();
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
      Sound.paddle(); syncUi();
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
    Sound.crack(); syncHud();
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
    if (brick.type === 'tnt') explode(brick, cx, cy);
    else if (brick.type === 'ball') spawnBall(cx, cy, sp.color);
    else if (brick.type === 'random') randomEffect(cx, cy);
    else if (sp.item) dropItem(sp.item, cx, cy);
  }
  syncHud();
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

function spawnBall(x, y, color) {
  if (game.balls.length >= BALL.maxBalls) return;
  const b = newBall(x, y), a = (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.5);
  b.color = color;
  b.vx = Math.sin(a) * b.speed;
  b.vy = Math.cos(a) * b.speed;                     // desce em direção à barra
  game.balls.push(b);
}

function randomEffect(x, y) {
  const total = RANDOM_POOL.reduce((a, [, w]) => a + w, 0);
  let v = Math.random() * total, type = RANDOM_POOL[0][0];
  for (const [k, w] of RANDOM_POOL) { v -= w; if (v < 0) { type = k; break; } }
  applyEffect(type, x, y);
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
  syncHud();
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

// Aplica um efeito. Temporários (inclusive o escudo) são apenas (re)armados: o valor real é recalculado a cada passo.
function applyEffect(type, x, y) {
  const sp = SPECIALS[type], fx = game.fx;
  if (type === 'gun') fx.gun = FX.gun.volleys;
  else if (type === 'heart') dropItem('heart', x, y);          // vira projétil em arco; a vida vem ao coletar
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

// O visual é um elemento DOM animado pelo breakout.css; o JS só informa posição e tamanho (unidades do mundo)
function spawnLineFx(kind, x, y, w, h, origin) {
  const el = document.createElement('div');
  el.className = `fx-line fx-${kind}`;
  el.style.setProperty('--x', x); el.style.setProperty('--y', y);
  el.style.setProperty('--w', w); el.style.setProperty('--h', h);
  el.style.setProperty('--org', origin);
  el.addEventListener('animationend', (e) => { if (!e.pseudoElement) el.remove(); });
  setTimeout(() => el.remove(), 1200);
  ui.stage.appendChild(el);
}
function clearLineFx() { ui.stage.querySelectorAll('.fx-line').forEach((el) => el.remove()); }

function ballPowerBlast(brick, power, dirX, dirY) {
  const horizontal = power === 'fire';
  const [lo, hi] = lineSpan(brick, horizontal ? 'h' : 'v', horizontal ? dirX : dirY);
  if (horizontal) {
    const w = (hi - lo + 1) * BR.width;
    spawnLineFx('fire', FIELD.left + lo * BR.width, brick.y - 4, w, BR.height + 8, `${((brick.c - lo + 0.5) * BR.width / w * 100).toFixed(1)}%`);
    Sound.boom();
  } else {
    const h = (hi - lo + 1) * BR.height;
    spawnLineFx('bolt', FIELD.left + brick.c * BR.width, BR.top + lo * BR.height, BR.width, h, `${((brick.r - lo + 0.5) * BR.height / h * 100).toFixed(1)}%`);
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

// Itens caindo: ao tocar a barra são coletados na hora (somem e aplicam o efeito); nunca quicam.
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
      if (it.type === 'heart') collectHeart(it.x);
      else applyEffect(it.type, clamp(it.x, 36, W - 36), PAD.y - 12);
    } else if (it.y > FIELD.pitY + 8) game.items.splice(i, 1);   // passou pela barra: some sem efeito
  }
}

function stepParticles(h) {
  const ps = game.particles;
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
  startButton: document.getElementById('start-button'),
  resumeButton: document.getElementById('resume-button'),
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
  ui.stage.classList.toggle('is-serving', s === STATES.PLAYING && game.phase === 'play' && game.balls.some((b) => b.stuck));
  if (s === STATES.PAUSED) ui.resumeButton.focus({ preventScroll: true });
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
  ui.arena.classList.toggle('help-open', open);
  ui.helpButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  ui.helpButton.setAttribute('aria-label', open ? 'Fechar ajuda dos efeitos' : 'Mostrar ajuda dos efeitos');
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
  if (isLeft || isRight) {
    e.preventDefault();
    if (isLeft) input.left = true; else input.right = true;
  } else if (e.code === 'KeyM' && !e.repeat) {
    toggleMute();
  } else if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) {
    setPaused(game.state === STATES.PLAYING);
  } else if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    if (e.repeat) return;
    if (game.state === STATES.READY) startGame();
    else if (game.state === STATES.PAUSED) setPaused(false);
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
  if (e.target.closest && e.target.closest('button, a, header, aside')) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  Sound.unlock();
  if (game.state !== STATES.PLAYING) return;
  if (e.pointerType === 'mouse') {
    paddleToClientX(e.clientX);
    launch();
  } else {
    drag.id = e.pointerId; drag.lastX = drag.startX = e.clientX; drag.startY = e.clientY; drag.moved = false;
  }
}

function onPointerMove(e) {
  if (game.state !== STATES.PLAYING) return;
  if (e.pointerType === 'mouse') { paddleToClientX(e.clientX); return; }
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
  const { margin, maxCssHeight, helpRoom } = CONFIG.view;
  const availW = Math.max(1, ui.arena.clientWidth - margin * 2);
  const availH = Math.max(1, ui.arena.clientHeight - margin * 2);
  const ratio = W / H;
  let cssH = Math.min(availH, maxCssHeight);
  let cssW = cssH * ratio;

  if (cssW > availW) { cssW = availW; cssH = cssW / ratio; }
  cssW = Math.floor(cssW); cssH = Math.floor(cssH);

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  ui.stage.style.width = `${cssW}px`;
  ui.stage.style.height = `${cssH}px`;
  ui.stage.style.setProperty('--u', `${cssW / W}px`);
  // Ajuda: só aparece quando sobra espaço ao lado do palco (o tamanho do palco nunca depende dela)
  const fits = (ui.arena.clientWidth - cssW) / 2 >= helpRoom;
  ui.arena.style.setProperty('--stage-w', `${cssW}px`);
  ui.arena.classList.toggle('help-fits', fits);
  if (!fits) setHelpOpen(false);
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(canvas.width * H / W));
  S = canvas.width / W;
  buildBackground();
  render();
}

/* ===== 9. LOOP E INICIALIZAÇÃO ===== */
let rafId = null;
let lastTime = null;

function frame(now) {
  rafId = requestAnimationFrame(frame);
  if (lastTime === null) lastTime = now;
  const dt = Math.min(Math.max((now - lastTime) / 1000, 0), TIM.maxFrameTime);
  lastTime = now;
  update(dt);
  render();
}

function init() {
  loadLevel(1);             // a tela inicial já mostra o tabuleiro da fase 1
  syncHud();
  syncMuteButton();
  buildHelp();

  document.addEventListener('keydown', onKeyDown, { passive: false });
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('pointerdown', onPointerDown, { passive: false });
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', (e) => { onPointerEnd(e, false); Sound.unlock(); });
  document.addEventListener('pointercancel', (e) => onPointerEnd(e, true));
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('blur', () => {
    input.left = input.right = false;
    drag.id = null;
    setPaused(true);
  });
  document.addEventListener('visibilitychange', () => { lastTime = null; if (document.hidden) setPaused(true); });

  ui.muteButton.addEventListener('click', (e) => { e.stopPropagation(); toggleMute(); ui.muteButton.blur(); });
  ui.pauseButton.addEventListener('click', (e) => { e.stopPropagation(); setPaused(true); ui.pauseButton.blur(); });
  ui.helpButton.addEventListener('click', (e) => { e.stopPropagation(); setHelpOpen(!ui.arena.classList.contains('help-open')); ui.helpButton.blur(); });
  ui.startButton.addEventListener('click', (e) => { e.stopPropagation(); startGame(); ui.startButton.blur(); });
  ui.resumeButton.addEventListener('click', (e) => { e.stopPropagation(); setPaused(false); ui.resumeButton.blur(); });
  ui.nextButton.addEventListener('click', (e) => { e.stopPropagation(); nextLevel(); ui.nextButton.blur(); });
  ui.restartButton.addEventListener('click', (e) => { e.stopPropagation(); tryRestart(); ui.restartButton.blur(); });

  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', resizeCanvas);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resizeCanvas);

  resizeCanvas();
  if (rafId === null) rafId = requestAnimationFrame(frame);
}

init();
window.__breakout = { render, game, CONFIG, SHAPES, SPECIALS, update, launch, startGame, loadLevel, setPaddleX, applyEffect, buildLayout, dropItem, damage, BRICK_COLORS, BRICK_ICONS, SPEC_COL };
})();