'use strict';
/* Sokoban · Arcádia. Mapa estático (paredes e destinos) separado do estado dinâmico (jogador e caixas). O DOM só reflete S (função render). */

/* Fases: # parede · espaço chão · . destino · $ caixa · * caixa no destino · @ jogador · + jogador no destino.
   50 fases em 5 grupos de 10 (Iniciante, Fácil, Intermediário, Difícil, Desafio). Todas são retangulares, cercadas por parede,
   têm tantas caixas quanto destinos e foram resolvidas por um solucionador (A* sobre empurrões) e reexecutadas por um simulador
   independente das regras do jogo antes de entrar aqui. */
const LEVELS = [
  ["######", "#   .#", "#@$  #", "##   #", "######"],
  ["########", "#.   @ #", "#    $ #", "#      #", "#      #", "########"],
  ["########", "#   # .#", "#    $@#", "##  #  #", "########"],
  ["#######", "#.    #", "##  $ #", "#  $@.#", "#   # #", "#######"],
  ["#######", "#     #", "#.    #", "#   $ #", "#  $@ #", "#.   ##", "#######"],
  ["########", "###. . #", "###    #", "# $    #", "#@$    #", "#  #   #", "########"],
  ["########", "#   # .#", "#      #", "# $ #$ #", "#.  #@ #", "########"],
  ["######", "#  @ #", "# $$$#", "# #  #", "##.  #", "###..#", "######"],
  ["#######", "#     #", "# $   #", "#  ####", "# $ $ #", "#.@ ..#", "#######"],
  ["########", "#.     #", "#### # #", "#+$ .  #", "# #$ $ #", "##     #", "########"],
  ["########", "#     .#", "#      #", "# $$#  #", "# +$  ##", "#     .#", "########"],
  ["#########", "#    # +#", "#     $$#", "# #  #  #", "#  $ # .#", "#.   #  #", "#########"],
  ["#########", "#.##    #", "#   *  ##", "#$ $#  .#", "#@$  .  #", "#########"],
  ["#######", "#. ..##", "##  $.#", "##  # #", "##$$$ #", "#  @  #", "#######"],
  ["##########", "#   .    #", "# # $ #.##", "# $ .  $@#", "# # # $ ##", "# #.     #", "##########"],
  ["##########", "#        #", "#   . $ ##", "#..$$    #", "#  @ .   #", "### ######", "# $      #", "#        #", "##########"],
  ["##########", "# .   $@##", "# #####*##", "#  .#   ##", "# $ #$# ##", "# $  .. ##", "# #####  #", "#        #", "##########", "##########"],
  ["#########", "#     # #", "#  $. . #", "## ##.$ #", "#.#.$ $ #", "#  $+$  #", "#   #   #", "#########"],
  ["########", "#.     #", "#.$ $  #", "#     ##", "# #. .##", "#$ #$ ##", "#@$  . #", "########"],
  ["##########", "#     .  #", "# $   $  #", "####$  * #", "####  .+ #", "##########"],
  ["#########", "#. .  . #", "# $ $ # #", "#  $    #", "# #@# $ #", "# .    ##", "#########"],
  ["########", "#   +  #", "# #$$$ #", "#.     #", "# .  $ #", "#  #.  #", "########"],
  ["#########", "#  .$@###", "# .  $###", "#  $.   #", "#     $ #", "#       #", "#.      #", "#########"],
  ["##########", "#       ##", "# $  $ $ #", "#  ..    #", "#.#      #", "#  # @$. #", "#        #", "##########"],
  ["#########", "##  . $ #", "#.# # # #", "#  #.$  #", "# #@$.  #", "#* $    #", "# # $ # #", "#  .    #", "#########"],
  ["#########", "#  . . ##", "# $   $ #", "#   $ $ #", "#.  +   #", "#########"],
  ["###########", "#   .  $+##", "#  . $  $ #", "#        .#", "#         #", "# $     $ #", "#   .     #", "###########"],
  ["########", "#   ####", "#  *@$ #", "#   $ .#", "# .  $ #", "#   $. #", "# .    #", "########"],
  ["##########", "###  ##  #", "#   . #  #", "#   . $  #", "#    #   #", "#  #$@#  #", "# .  $   #", "##  $  # #", "# $     ##", "# .    . #", "##########"],
  ["#########", "#.      #", "#  @$   #", "#   .#$ #", "#.$#  $ #", "#    . ##", "#########"],
  ["##########", "#    .   #", "#.     $ #", "#@$ #$   #", "# $ #. . #", "# . #    #", "# $ #    #", "#  ###   #", "##########"],
  ["###########", "#      .  #", "#     #.$ #", "# $$  # * #", "#  @  #   #", "#.  # # $ #", "#    .#   #", "###########"],
  ["##########", "##   .*  #", "#@$. $   #", "### #### #", "#        #", "#  $  $  #", "#    .  .#", "##########"],
  ["###########", "#   .   # #", "#         #", "#      #  #", "# #      ##", "# $ . $ . #", "#    $@$  #", "#.    #   #", "###########"],
  ["##########", "##@. .  .#", "# $$. $  #", "#        #", "#   $ $  #", "# .    # #", "##########"],
  ["#########", "#       #", "# $ $.$ #", "#  @$   #", "#.    ..#", "####  $ #", "####   .#", "#########"],
  ["##########", "#        #", "#  .     #", "#  . #$# #", "#    $@# #", "# #$  #  #", "# $ $.*. #", "#  .     #", "##########"],
  ["###########", "#   .  $+##", "#  . $  $ #", "#        .#", "#         #", "# $     $ #", "#   .   # #", "###########"],
  ["##########", "#    .   #", "# $ $ $ ##", "#   .   @#", "# # $ # $#", "# #    ..#", "# #.#   ##", "##########"],
  ["#########", "#       #", "# $ $.$ #", "# @$    #", "#.    ..#", "####  $ #", "####   .#", "#########"],
  ["#########", "# .    .#", "#.#     #", "#    *# #", "#    $@##", "# $ $.$ #", "#       #", "#########"],
  ["##########", "#### .@ ##", "####$$$$ #", "#### .   #", "#.     . #", "# $ $    #", "#    .   #", "#    .   #", "##########"],
  ["##########", "#   .    #", "#   $ $..#", "#.       #", "##$#######", "# $  $+$.#", "#        #", "##########"],
  ["###########", "#       ###", "#      $@##", "# . $ . $ #", "#   .     #", "#.   .$ $ #", "##        #", "###########"],
  ["#########", "##    . #", "#.. @$  #", "# $     #", "### #####", "#   # . #", "# $ $ $ #", "#    .  #", "#########"],
  ["##########", "#.      .#", "#        #", "#  $*.   #", "#  @     #", "# $ $ $ ##", "#.     ###", "##########"],
  ["###########", "#       ###", "# $     ###", "#    $   .#", "#    @.. .#", "#   $     #", "# $       #", "#         #", "###########"],
  ["###########", "#       ###", "#@$  $  ###", "#        .#", "#     .. .#", "#         #", "#  $ $    #", "#         #", "###########"],
  ["#########", "##    . #", "#.. @$  #", "# $     #", "### #####", "#     . #", "# $ $ $ #", "#    .  #", "#########"],
  ["##########", "#   . .  #", "#    $   #", "#   $.   #", "#  $@$ . #", "#   $    #", "# ..     #", "#   $ ####", "#     ####", "##########"]
];
const GROUPS = [
  { name: 'Iniciante', from: 0 }, { name: 'Fácil', from: 10 }, { name: 'Intermediário', from: 20 }, { name: 'Difícil', from: 30 }, { name: 'Desafio', from: 40 },
];
const GROUP_SIZE = 10;
const groupOf = (i) => Math.min(GROUPS.length - 1, Math.floor(i / GROUP_SIZE));
const STEP_MS = 95;        // intervalo mínimo entre passos (mantém a animação legível ao segurar uma tecla)
const REPEAT_MS = 140;     // repetição ao segurar um botão direcional
const W = 288, H = 512, MARGIN = 6, MAX_CSS_HEIGHT = 1000;
const DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
const KEYS = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
const HINTS = ['Empurre a caixa até o destino dourado.', 'Você só empurra, nunca puxa. Contorne a caixa para empurrar de outro lado.', 'Uma caixa em um canto não sai mais: desfaça (Z) se isso acontecer.'];
const $ = (id) => document.getElementById(id);
const ui = {
  arena: $('arena'), stage: $('stage'), map: $('map'), moves: $('moves'), best: $('best'), level: $('level-label'), status: $('status'),
  undo: $('undo-button'), mute: $('mute-button'), restart: $('restart-button'), grid: $('level-grid'), next: $('next-button'), group: $('group-name'),
  wrap: $('stage-wrap'), levelsScreen: document.querySelector('.screen-levels'), prev: $('page-prev'), pnext: $('page-next'), plabel: $('page-label'), lprog: $('levels-progress'),
  help: $('help-button'), pop: $('help-pop'), start: $('start-screen'), startLevel: $('start-level'), startProg: $('start-progress'),
};

/* Personagem: operário de depósito com capacete amarelo, camisa creme e macacão azul. Três vistas desenhadas (frente, costas, perfil);
   o perfil é espelhado para a esquerda. Tudo dentro da casa (viewBox 32 × 32), com a mesma sombra e contorno das caixas. */
const INK = '#0f1320', SKIN = '#f3c79b', SKIN_D = '#d49f74', HAT = '#ffc857', HAT_D = '#d9981f', SHIRT = '#f1e9d2', BIB = '#4aa3df', BIB_L = '#7cc8f4', BIB_D = '#2c76ae', BOOT = '#4a2a12', HAIR = '#6b3f1a';
const ST = `stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"`;
const boot = (cls, x, w) => `<g class="${cls}"><rect x="${x}" y="23.6" width="${w}" height="4.3" rx="1.9" fill="${BOOT}" ${ST}/></g>`;
const hat = (x, brimX, brimW) => `<path d="M${x} 10.5a6.4 6.4 0 0112.8 0z" fill="${HAT}" ${ST}/><path d="M${x + 3.2} 7.2a4.6 4.6 0 013.2-1.6" fill="none" stroke="#fff3c9" stroke-width="1.1" stroke-linecap="round"/><rect x="${brimX}" y="9.9" width="${brimW}" height="2.5" rx="1.25" fill="${HAT_D}" ${ST}/>`;
const VIEW_DOWN = `<g class="v v-down">${boot('ft1', 9.6, 5.6)}${boot('ft2', 16.8, 5.6)}
  <rect x="9.8" y="15.4" width="12.4" height="9.4" rx="3.2" fill="${BIB}" ${ST}/><path d="M16 20.5v4.2" stroke="${BIB_D}" stroke-width="1"/>
  <rect x="12.2" y="15.9" width="7.6" height="4.6" rx="1.3" fill="${BIB_L}" stroke="${BIB_D}" stroke-width=".9"/>
  <circle cx="13.3" cy="17" r=".9" fill="${HAT}"/><circle cx="18.7" cy="17" r=".9" fill="${HAT}"/>
  <g class="arm-l"><rect x="5.6" y="15.8" width="4.2" height="7.2" rx="2.1" fill="${SHIRT}" ${ST}/><circle cx="7.7" cy="23.3" r="1.9" fill="${SKIN}" ${ST}/></g>
  <g class="arm-r"><rect x="22.2" y="15.8" width="4.2" height="7.2" rx="2.1" fill="${SHIRT}" ${ST}/><circle cx="24.3" cy="23.3" r="1.9" fill="${SKIN}" ${ST}/></g>
  <circle cx="16" cy="11.7" r="6.3" fill="${SKIN}" ${ST}/>
  <circle cx="13.3" cy="13.6" r="1.15" fill="${INK}"/><circle cx="18.7" cy="13.6" r="1.15" fill="${INK}"/>
  <circle cx="11.3" cy="15.2" r="1.1" fill="#f0968a" opacity=".7"/><circle cx="20.7" cy="15.2" r="1.1" fill="#f0968a" opacity=".7"/>
  <path d="M14.4 15.9q1.6 1.2 3.2 0" fill="none" stroke="${INK}" stroke-width="1" stroke-linecap="round"/>
  ${hat(9.6, 8.2, 15.6)}</g>`;
const VIEW_UP = `<g class="v v-up">${boot('ft1', 9.6, 5.6)}${boot('ft2', 16.8, 5.6)}
  <rect x="9.8" y="15.4" width="12.4" height="9.4" rx="3.2" fill="${BIB}" ${ST}/><path d="M16 20.5v4.2M12.4 15.8l7.2 5.4M19.6 15.8l-7.2 5.4" stroke="${BIB_D}" stroke-width="1.1" stroke-linecap="round"/>
  <g class="arm-l"><rect x="5.6" y="15.8" width="4.2" height="7.2" rx="2.1" fill="${SHIRT}" ${ST}/><circle cx="7.7" cy="23.3" r="1.9" fill="${SKIN}" ${ST}/></g>
  <g class="arm-r"><rect x="22.2" y="15.8" width="4.2" height="7.2" rx="2.1" fill="${SHIRT}" ${ST}/><circle cx="24.3" cy="23.3" r="1.9" fill="${SKIN}" ${ST}/></g>
  <circle cx="9.9" cy="12.8" r="1.4" fill="${SKIN_D}" ${ST}/><circle cx="22.1" cy="12.8" r="1.4" fill="${SKIN_D}" ${ST}/>
  <circle cx="16" cy="11.9" r="6.3" fill="${HAIR}" ${ST}/>
  ${hat(9.6, 8.6, 14.8)}</g>`;
const VIEW_SIDE = `<g class="v v-side">${boot('ft1', 10.2, 6)}${boot('ft2', 15, 7.4)}
  <rect x="10.6" y="15.4" width="10.8" height="9.4" rx="3.2" fill="${BIB}" ${ST}/>
  <g class="arm"><rect x="13.8" y="15.8" width="4.4" height="7.4" rx="2.2" fill="${SHIRT}" ${ST}/><circle cx="16" cy="23.4" r="1.9" fill="${SKIN}" ${ST}/></g>
  <circle cx="22.7" cy="14.3" r="1.4" fill="${SKIN}" ${ST}/>
  <circle cx="16.2" cy="11.7" r="6.3" fill="${SKIN}" ${ST}/>
  <ellipse cx="13.8" cy="13.8" rx="1.2" ry="1.6" fill="${SKIN_D}"/>
  <circle cx="19.4" cy="13.7" r="1.15" fill="${INK}"/><circle cx="17.7" cy="15.7" r="1" fill="#f0968a" opacity=".7"/>
  <path d="M19.2 16.6q1.2.7 2.3.1" fill="none" stroke="${INK}" stroke-width="1" stroke-linecap="round"/>
  ${hat(9.8, 10.2, 16.4)}</g>`;
const SVG_PLAYER = `<svg viewBox="0 0 32 32" aria-hidden="true"><ellipse cx="16" cy="27.6" rx="9.6" ry="2.6" fill="rgba(0,0,0,.38)"/><g class="pl">${VIEW_DOWN}${VIEW_UP}${VIEW_SIDE}</g></svg>`;
const SVG_CHECK = '<svg class="chk" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7.5" fill="currentColor"/><path d="M4.6 8.3l2.3 2.3 4.5-4.9" fill="none" stroke="#0f1320" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_LOCK = '<svg class="lock" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

const S = {
  index: 0, rows: 0, cols: 0, wall: [], goal: [], start: null,   // estático + configuração inicial
  player: { r: 0, c: 0 }, boxes: [], history: [],                // dinâmico
  status: 'playing',                                             // playing | won
  menu: false, started: false, muted: false, lastStep: -1e9, progress: { unlocked: 1, best: {} }, page: 0, first: 0, size: 20,
  face: 'down', anim: 'idle', animN: 0,                          // só visual: direção do personagem e animação do último passo
  boxEls: [], playerEl: null,
};

/* ===== Armazenamento (nunca pode quebrar o jogo) ===== */
// Persistência própria em sokoban_storage.js: progress = { unlocked, best: { <índice>: movimentos } }, last, muted.
const store = SokobanStorage, SAVED = store.load(LEVELS.length);
const saveProgress = () => store.saveProgress(S.progress);

/* ===== Áudio (Web Audio, sem arquivos externos; mesmo padrão dos outros jogos da Arcádia) ===== */
const Sound = (() => {
  let ctx = null, master = null, off = false;
  S.muted = SAVED.muted;
  function ensure() {
    if (off) return null;
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) { off = true; return null; }
      try { ctx = new C(); master = ctx.createGain(); master.gain.value = 0.25; master.connect(ctx.destination); }
      catch (e) { off = true; ctx = null; return null; }
    }
    if (ctx.state === 'suspended') { try { ctx.resume().catch(() => {}); } catch (e) {} }
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
  let alt = false;   // alterna o tom dos passos para soar como pés se alternando
  return {
    unlock() { if (!S.muted) { try { ensure(); } catch (e) {} } },
    step() { alt = !alt; tone(alt ? 200 : 240, alt ? 150 : 180, 0.05, 'triangle', 0.22); },
    push() { tone(130, 70, 0.11, 'triangle', 0.7); tone(300, 190, 0.05, 'square', 0.1); },
    goal() { tone(130, 70, 0.1, 'triangle', 0.5); tone(660, 660, 0.12, 'sine', 0.35, 0.05); tone(990, 990, 0.18, 'sine', 0.3, 0.12); },
    blocked() { tone(150, 120, 0.09, 'square', 0.18); },
    undo() { tone(440, 300, 0.07, 'triangle', 0.35); },
    restart() { tone(380, 200, 0.12, 'triangle', 0.35); },
    click() { tone(520, 600, 0.04, 'triangle', 0.25); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.16, 'square', 0.3, i * 0.11)); },
  };
})();

/* ===== Lógica ===== */
function parseLevel(i) {
  const rows = LEVELS[i], wall = [], goal = [], boxes = []; let player = null;
  rows.forEach((line, r) => { wall.push([]); goal.push([]);
    [...line].forEach((ch, c) => {
      wall[r].push(ch === '#'); goal[r].push(ch === '.' || ch === '*' || ch === '+');
      if (ch === '$' || ch === '*') boxes.push({ r, c });
      if (ch === '@' || ch === '+') player = { r, c };
    });
  });
  return { rows: rows.length, cols: rows[0].length, wall, goal, start: { player, boxes } };
}
const boxAt = (r, c) => S.boxes.findIndex((b) => b.r === r && b.c === c);
const inside = (r, c) => r >= 0 && c >= 0 && r < S.rows && c < S.cols;
const blocked = (r, c) => !inside(r, c) || S.wall[r][c];
const solved = () => S.boxes.every((b) => S.goal[b.r][b.c]);

/* Tenta um passo. Devolve true só se o estado mudou (movimento válido). Nada aqui depende de animação. */
function tryMove(dir) {
  if (S.status !== 'playing' || S.menu || !S.started) return false;
  const [dr, dc] = DIRS[dir], nr = S.player.r + dr, nc = S.player.c + dc;
  S.face = dir;   // o personagem sempre olha para onde tentou ir (visual)
  let pushed = -1, landed = false;
  if (blocked(nr, nc)) return bump();
  const bi = boxAt(nr, nc);
  if (bi >= 0) {
    const tr = nr + dr, tc = nc + dc;
    if (blocked(tr, tc) || boxAt(tr, tc) >= 0) return bump();   // parede, limite ou outra caixa: inválido
    S.boxes[bi].r = tr; S.boxes[bi].c = tc; pushed = bi; landed = S.goal[tr][tc] && !S.goal[nr][nc];
  }
  S.player.r = nr; S.player.c = nc;
  S.history.push({ dir, box: pushed });
  S.anim = pushed >= 0 ? 'push' : 'walk'; S.animN++;
  if (solved()) win();
  else if (pushed < 0) Sound.step();
  else if (landed) Sound.goal();
  else Sound.push();
  render();
  return true;
}
function bump() { S.anim = 'idle'; Sound.blocked(); render(); return false; }   // movimento inválido: só vira o personagem, sem mexer no estado
function undo() {
  if (S.status !== 'playing' || S.menu || !S.started || !S.history.length) return;
  const { dir, box } = S.history.pop(), [dr, dc] = DIRS[dir];
  S.player.r -= dr; S.player.c -= dc;
  if (box >= 0) { S.boxes[box].r -= dr; S.boxes[box].c -= dc; }
  S.anim = 'idle'; Sound.undo();
  render();
}
function win() {
  S.status = 'won';
  const n = S.history.length, prev = S.progress.best[S.index], record = !prev || n < prev;
  if (record) S.progress.best[S.index] = n;
  S.progress.unlocked = Math.max(S.progress.unlocked, Math.min(S.index + 2, LEVELS.length));
  saveProgress();
  $('won-moves').textContent = n; $('won-record').hidden = !record;
  const last = S.index >= LEVELS.length - 1;
  ui.next.hidden = last; $('won-end').hidden = !last;
  Sound.win();
}
function loadLevel(i, persist = true) {
  if (!Number.isInteger(i) || i < 0 || i >= LEVELS.length || i >= S.progress.unlocked) return false;   // fase bloqueada: recusa
  Object.assign(S, parseLevel(i), { index: i, status: 'playing', menu: false, history: [], face: 'down', anim: 'idle' });
  S.player = { ...S.start.player }; S.boxes = S.start.boxes.map((b) => ({ ...b })); 
  buildBoard(); resizeStage(); render(); if (persist) store.saveLast(i);
  return true;
}
const restart = () => { if (S.status === 'playing' && !S.menu && S.started && S.history.length) { Sound.restart(); loadLevel(S.index); } };
const nextLevel = () => { if (S.status === 'won') loadLevel(S.index + 1); };

/* ===== Renderização ===== */
function buildBoard() {
  ui.map.textContent = '';
  ui.map.style.setProperty('--cols', S.cols); ui.map.style.setProperty('--rows', S.rows); ui.map.style.setProperty('--n', Math.max(S.cols, S.rows));
  const box = document.createElement('div'); box.className = 'grid-box';
  for (let r = 0; r < S.rows; r++) for (let c = 0; c < S.cols; c++) {
    const t = document.createElement('div');
    t.className = `t${S.wall[r][c] ? ' wall' : ''}${S.goal[r][c] ? ' goal' : ''}${(r + c) % 2 ? ' alt' : ''}`;
    t.style.setProperty('--r', r); t.style.setProperty('--c', c); box.appendChild(t);
  }
  S.boxEls = S.boxes.map(() => { const e = document.createElement('div'); e.className = 'e box'; e.innerHTML = '<span class="face"></span>'; box.appendChild(e); return e; });
  S.playerEl = document.createElement('div'); S.playerEl.className = 'e player'; S.playerEl.innerHTML = SVG_PLAYER; box.appendChild(S.playerEl);
  S.sideEl = S.playerEl.querySelector('.v-side');
  ui.map.appendChild(box);
}
function place(el, p) { el.style.setProperty('--r', p.r); el.style.setProperty('--c', p.c); }
function render() {
  S.boxes.forEach((b, i) => { place(S.boxEls[i], b); S.boxEls[i].classList.toggle('done', S.goal[b.r][b.c]); });
  place(S.playerEl, S.player); S.playerEl.classList.toggle('on-goal', S.goal[S.player.r][S.player.c]);
  S.playerEl.dataset.face = S.face;
  S.playerEl.dataset.anim = S.anim === 'idle' ? 'idle' : S.anim + (S.animN % 2 ? 'A' : 'B');   // nome alternado reinicia a animação CSS a cada passo
  S.sideEl.setAttribute('transform', S.face === 'left' ? 'translate(32 0) scale(-1 1)' : '');
  ui.moves.textContent = S.history.length;
  ui.level.textContent = `${S.index + 1}/${LEVELS.length}`;
  const b = S.progress.best[S.index]; ui.best.textContent = b ? `${b} mov.` : '—';
  ui.undo.disabled = !S.history.length || S.status !== 'playing'; ui.restart.disabled = !S.history.length || S.status !== 'playing';
  const done = S.boxes.filter((x) => S.goal[x.r][x.c]).length;
  ui.status.textContent = S.status === 'won' ? 'Fase concluída' : (HINTS[S.index] || `${GROUPS[groupOf(S.index)].name} · ${done} de ${S.boxes.length} caixas nos destinos`);
  const c = ui.stage.classList; c.toggle('is-won', S.status === 'won'); c.toggle('is-levels', S.menu); c.toggle('is-ready', !S.started);
}
/* Catálogo: grade paginada. Colunas e linhas se adaptam ao espaço real da tela (alvo mínimo de 44 px); a página mostra de S.first até S.first + S.size. */
const MIN_CELL = 44, MAX_COLS = 5, pad2 = (n) => String(n).padStart(2, '0');
function levelsLayout() {
  const sc = ui.levelsScreen, gridW = ui.grid.clientWidth;
  if (!gridW) return { cols: MAX_COLS, size: 20 };
  const gap = parseFloat(getComputedStyle(sc).rowGap) || 8, gg = parseFloat(getComputedStyle(ui.grid).columnGap) || 6;
  const cols = Math.max(3, Math.min(MAX_COLS, Math.floor((gridW + gg) / (MIN_CELL + gg)))), cell = (gridW - gg * (cols - 1)) / cols;
  const kids = [...sc.children].filter((k) => k !== ui.grid && k.offsetHeight);
  const free = sc.clientHeight - kids.reduce((n, k) => n + k.offsetHeight, 0) - gap * kids.length - 12;
  const rows = Math.max(2, Math.min(4, Math.floor((free + gg) / (cell + gg))));
  return { cols, size: cols * rows };
}
function buildLevelGrid() {
  const { cols, size } = levelsLayout(), total = LEVELS.length, pages = Math.max(1, Math.ceil(total / size));
  S.size = size; S.page = Math.min(Math.max(0, Math.floor(S.first / size)), pages - 1); S.first = S.page * size;
  const from = S.first, to = Math.min(from + size, total), done = completedCount();
  ui.grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  ui.group.textContent = `Fases ${from + 1}–${to}`;
  ui.plabel.textContent = `${S.page + 1} / ${pages}`;
  ui.prev.disabled = S.page === 0; ui.pnext.disabled = S.page >= pages - 1;
  ui.lprog.textContent = `${done} de ${total} concluídas`;
  ui.grid.textContent = '';
  for (let i = from; i < to; i++) {
    const locked = i >= S.progress.unlocked, b = S.progress.best[i], cur = i === S.index, el = document.createElement('button');
    el.type = 'button'; el.dataset.i = i; el.disabled = locked;
    el.className = `lv${cur ? ' is-current' : ''}${b ? ' is-done' : ''}${locked ? ' is-locked' : ''}`;
    el.setAttribute('aria-label', locked ? `Fase ${i + 1}, bloqueada` : `Fase ${i + 1}${cur ? ', atual' : ''}${b ? `, concluída, recorde ${b} movimentos` : ''}`);
    if (cur) el.setAttribute('aria-current', 'true');
    el.innerHTML = `<span class="num">${pad2(i + 1)}</span>${locked ? SVG_LOCK : b ? SVG_CHECK : ''}`;
    ui.grid.appendChild(el);
  }
}
function goPage(p) {
  S.first = Math.max(0, p) * S.size; buildLevelGrid();
  const other = ui.prev.disabled ? ui.pnext : ui.pnext.disabled ? ui.prev : null;   // não perde o foco quando um botão desativa
  if (other && document.activeElement === document.body) other.focus({ preventScroll: true });
}
function openMenu(on) {
  if (on) { setHelp(false); S.first = S.index; buildLevelGrid(); }
  S.menu = on; render();
  if (on) { const cur = ui.grid.querySelector('.is-current') || ui.grid.querySelector('button:not(:disabled)'); if (cur) cur.focus({ preventScroll: true }); }
}
function toggleMute() {
  S.muted = !S.muted; store.saveMuted(S.muted); if (!S.muted) Sound.unlock(); renderMute();
}
function renderMute() {
  ui.mute.classList.toggle('is-muted', S.muted); ui.mute.setAttribute('aria-pressed', S.muted);
  ui.mute.setAttribute('aria-label', S.muted ? 'Ativar efeitos sonoros' : 'Silenciar efeitos sonoros');
}
/* O palco mantém 288 × 512. O botão ? fica fora dele: ao lado quando há espaço; senão acima (se sobrar altura); senão o palco encolhe e abre espaço ao lado. */
const HELP_SIZE = 42, HELP_GAP = 10;
function fitStage(w, h) {
  let ch = Math.min(h, MAX_CSS_HEIGHT), cw = ch * (W / H);
  if (cw > w) { cw = w; ch = cw / (W / H); }
  return [Math.floor(cw), Math.floor(ch)];
}
function resizeStage() {
  const aw = ui.arena.clientWidth, ah = ui.arena.clientHeight, side = HELP_SIZE + HELP_GAP + 4;
  let [cw, ch] = fitStage(Math.max(1, aw - MARGIN * 2), Math.max(1, ah - MARGIN * 2)), mode = 'side', shift = 0;
  if ((aw - cw) / 2 >= side + MARGIN) mode = 'side';
  else if ((ah - ch) / 2 >= HELP_SIZE + 12) mode = 'top';
  else { [cw, ch] = fitStage(Math.max(1, aw - MARGIN * 2 - side), Math.max(1, ah - MARGIN * 2)); shift = side / 2; }
  ui.wrap.style.width = `${cw}px`; ui.wrap.style.height = `${ch}px`; ui.wrap.style.setProperty('--u', `${cw / W}px`);
  ui.wrap.dataset.help = mode; ui.wrap.style.transform = shift ? `translateX(${-shift}px)` : '';
}
function setHelp(on) { ui.pop.hidden = !on; ui.help.setAttribute('aria-expanded', on ? 'true' : 'false'); }

/* Tela inicial: o jogo fica parado até o primeiro toque/clique ou SPACE. Só então a fase conta como iniciada. */
function refreshStart() {
  const done = completedCount(), total = LEVELS.length, resume = done > 0 || S.index > 0;
  ui.startLevel.textContent = resume ? `Continuar · fase ${S.index + 1}` : 'Fase 1';
  ui.startProg.textContent = done ? `${done} de ${total} fases concluídas` : 'Empurre as caixas até os destinos';
}
function begin() {
  if (S.started || !ui.pop.hidden) return;   // com a ajuda aberta, o toque só fecha a ajuda
  S.started = true; Sound.unlock(); store.saveLast(S.index); render();
}
const completedCount = () => Object.keys(S.progress.best).length;
// Fase sugerida: a última aberta, se ainda não foi concluída; senão, a próxima fase liberada.
function resumeTarget() {
  const last = SAVED.last, top = S.progress.unlocked - 1;
  if (Number.isInteger(last) && last >= 0 && last <= top && !S.progress.best[last]) return last;
  return Math.min(top, LEVELS.length - 1);
}

/* ===== Entradas: teclado e toque passam pela mesma função (input → tryMove) ===== */
function input(dir) {
  const now = performance.now();
  if (now - S.lastStep < STEP_MS) return;
  if (tryMove(dir)) S.lastStep = now;
}
function init() {
  S.progress = SAVED.progress; renderMute();
  if (!loadLevel(resumeTarget(), false)) loadLevel(0, false);   // abre parado e sem gravar nada: só o primeiro toque/SPACE inicia
  refreshStart();
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Escape') { if (!ui.pop.hidden) { setHelp(false); ui.help.blur(); } else if (S.menu) openMenu(false); return; }
    const onBtn = e.target && e.target.closest && e.target.closest('button');
    if (e.code === 'Space' && !onBtn) { if (!S.started && !S.menu) { e.preventDefault(); begin(); } return; }
    if (e.code === 'Enter' && e.target === ui.start) { e.preventDefault(); begin(); return; }
    const dir = KEYS[e.code];
    if (dir) { e.preventDefault(); input(dir); return; }            // setas não rolam a página
    if (e.repeat) return;
    if (e.code === 'KeyZ' || e.code === 'KeyU') undo();
    else if (e.code === 'KeyR') restart();
    else if (e.code === 'KeyL') { Sound.click(); openMenu(!S.menu); }
    else if (e.code === 'KeyM') toggleMute();
  });
  let timer = null;
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } document.querySelectorAll('.pad.is-down').forEach((p) => p.classList.remove('is-down')); };
  document.querySelectorAll('.pad').forEach((p) => {
    p.addEventListener('pointerdown', (e) => {
      e.preventDefault(); stop(); p.classList.add('is-down'); S.lastStep = -1e9; input(p.dataset.dir);   // responde ao toque, não à soltura
      timer = setInterval(() => input(p.dataset.dir), REPEAT_MS);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => p.addEventListener(ev, stop));
    p.addEventListener('click', (e) => { if (e.detail === 0) input(p.dataset.dir); });          // detail 0 = ativado pelo teclado
    p.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  window.addEventListener('blur', stop);
  ui.undo.addEventListener('click', () => { undo(); ui.undo.blur(); });
  ui.restart.addEventListener('click', () => { restart(); ui.restart.blur(); });
  ui.mute.addEventListener('click', () => { toggleMute(); ui.mute.blur(); });
  document.addEventListener('pointerdown', () => Sound.unlock());
  document.addEventListener('keydown', () => Sound.unlock(), true);
  ui.start.addEventListener('click', begin);
  ui.help.addEventListener('click', () => { setHelp(ui.pop.hidden); ui.help.blur(); });   // sem foco no botão, SPACE continua iniciando o jogo
  document.addEventListener('click', (e) => { if (!ui.pop.hidden && !e.target.closest('.help')) setHelp(false); });
  $('levels-button').addEventListener('click', () => { Sound.click(); openMenu(true); });
  $('levels-close').addEventListener('click', () => openMenu(false));
  $('won-levels').addEventListener('click', () => openMenu(true));
  ui.next.addEventListener('click', () => { Sound.click(); nextLevel(); });
  $('again-button').addEventListener('click', () => loadLevel(S.index));
  ui.prev.addEventListener('click', () => { Sound.click(); goPage(S.page - 1); });
  ui.pnext.addEventListener('click', () => { Sound.click(); goPage(S.page + 1); });
  ui.grid.addEventListener('click', (e) => {
    const b = e.target.closest('.lv'); if (!b || b.disabled) return;
    Sound.click(); if (loadLevel(Number(b.dataset.i))) begin();   // escolher uma fase é uma ação do jogador: já começa
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  const onResize = () => { resizeStage(); if (S.menu) buildLevelGrid(); };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
}
init();

window.__soko = { S, LEVELS, GROUPS, tryMove, undo, restart, loadLevel, input, solved, begin };