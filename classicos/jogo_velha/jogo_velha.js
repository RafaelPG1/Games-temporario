'use strict';
/* Jogo da Velha · Arcádia. Fonte única de verdade: o objeto S. O DOM só reflete S (render) e o armazenamento é gravado a cada mudança (persist).
   Fases: start (tela inicial) → play ⇄ pause (manual | recovered | help) → count (3·2·1·GO!) → play. */
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const AI_DELAY_MS = 380, CONFIRM_MS = 3000, COUNT_STEP_MS = 700, GO_MS = 550;
const W = 288, H = 512, MARGIN = 6, MAX_CSS_HEIGHT = 1000;
const SYMBOL = {
  X: '<svg class="sx" viewBox="0 0 100 100" aria-hidden="true"><path class="draw" pathLength="1" d="M26 27C38 38 58 60 75 74"/><path class="draw d2" pathLength="1" d="M74 25C60 40 42 58 27 76"/></svg>',
  O: '<svg class="so" viewBox="0 0 100 100" aria-hidden="true"><path class="draw" pathLength="1" d="M50 22C71 21 80 38 78 54C76 72 58 80 44 77C27 73 21 55 26 40C30 29 41 23 53 24"/></svg>',
};
/* Camada de tinta sobre o tabuleiro: o "#" desenhado à caneta e o risco da vitória (#strike) */
const INK = '<svg id="ink" class="ink" viewBox="0 0 300 300" aria-hidden="true" focusable="false"><g class="hash"><path d="M100 8C98 90 102 200 100 292"/><path d="M200 8C202 90 198 200 200 292"/><path d="M8 100C90 98 200 102 292 100"/><path d="M8 200C90 202 200 198 292 200"/></g><g id="strike" class="strike"></g></svg>';
const $ = (id) => document.getElementById(id);
const ui = {
  arena: $('arena'), wrap: $('stage-wrap'), stage: $('stage'), game: $('game'), board: $('board'), status: $('status'),
  round: $('round-btn'), session: $('session-btn'), mute: $('mute-btn'), pause: $('pause-btn'), help: $('help-button'),
  veil: $('veil'), pausePanel: $('panel-pause'), helpPanel: $('panel-help'), countPanel: $('panel-count'), countNum: $('count-num'),
  pauseTitle: $('pause-title'), pauseText: $('pause-text'), resume: $('resume-btn'), pauseRestart: $('pause-restart'),
  helpClose: $('help-close'), start: $('start-screen'), startBtn: $('start-btn'), strike: null, cells: [],
};

const S = {
  mode: 'ai',          // 'two' (2 jogadores) | 'ai' (humano é X, IA é O)
  level: 'medium',     // easy | medium | hard
  starter: 'X',        // quem abre cada rodada
  board: Array(9).fill(''), turn: 'X', over: false, line: null, result: null, // result: 'X' | 'O' | 'D'
  score: { X: 0, O: 0, D: 0 },
  token: 0,            // muda a cada rodada nova ou pausa: invalida jogada pendente da IA
  thinking: false, confirm: 0, muted: false,
  phase: 'start',      // start | play | pause | count: só em 'play' alguém joga, nem a IA
  pauseKind: 'manual', // manual | recovered (partida retomada) | help
  prevKind: 'manual',  // tipo de pausa a que se volta ao fechar a ajuda
  count: 3, countTimer: 0, focusKey: null, lastCount: null,
};

/* ===== Armazenamento: preferências, placar e partida em jogo_velha_storage.js ===== */
const store = JogoVelhaStorage;

/* ===== Áudio (Web Audio, sem arquivos externos; falhas nunca interrompem o jogo) ===== */
const Sound = (() => {
  let ctx = null, master = null, off = false;
  function ensure() {
    if (off) return null;
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) { off = true; return null; }
      try { ctx = new C(); master = ctx.createGain(); master.gain.value = 0.22; master.connect(ctx.destination); }
      catch (e) { off = true; ctx = null; return null; }
    }
    if (ctx.state === 'suspended') { try { ctx.resume().catch(() => {}); } catch (e) { /* ignora */ } }
    return ctx;
  }
  function tone(from, to, dur, type = 'triangle', vol = 0.4, delay = 0) {
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
  const D = 0.14; // resultados começam logo depois do toque da jogada, sem sobrepor
  return {
    unlock() { if (!S.muted) { try { ensure(); } catch (e) { /* ignora */ } } },
    place(p) { const f = p === 'X' ? 330 : 440; tone(f, f * 0.8, 0.09, 'triangle', 0.4); },
    click() { tone(620, 700, 0.04, 'sine', 0.14); },
    tick() { tone(520, 520, 0.08, 'sine', 0.22); },
    go() { tone(784, 1047, 0.22, 'triangle', 0.3); },
    result(kind) { // 'win' | 'lose' | 'draw'
      if (kind === 'win') [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.16, 'triangle', 0.3, D + i * 0.1));
      else if (kind === 'lose') { tone(392, 330, 0.18, 'triangle', 0.28, D); tone(330, 247, 0.3, 'triangle', 0.28, D + 0.17); }
      else { tone(440, 440, 0.12, 'sine', 0.3, D); tone(349, 349, 0.22, 'sine', 0.3, D + 0.15); }
    },
  };
})();

/* ===== Regras ===== */
const other = (p) => (p === 'X' ? 'O' : 'X');
const empties = (b) => b.reduce((o, v, i) => (v ? o : (o.push(i), o)), []);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function findWinner(b) {
  for (const l of LINES) if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[0]] === b[l[2]]) return { p: b[l[0]], line: l };
  return null;
}
const isAITurn = () => S.mode === 'ai' && S.turn === 'O';
const playing = () => S.phase === 'play';

/* ===== Inteligência artificial ===== */
/* Minimax completo (o espaço de jogo é pequeno). Pontua do ponto de vista de `me`; vitórias rápidas valem mais. */
function minimax(b, p, me, d) {
  const w = findWinner(b);
  if (w) return w.p === me ? 10 - d : d - 10;
  const e = empties(b); if (!e.length) return 0;
  let best = p === me ? -Infinity : Infinity;
  for (const i of e) {
    b[i] = p; const s = minimax(b, other(p), me, d + 1); b[i] = '';
    best = p === me ? Math.max(best, s) : Math.min(best, s);
  }
  return best;
}
function bestMoves(b, me) { // todas as jogadas ótimas (b é uma cópia)
  const e = empties(b);
  if (e.length === 9) return [0, 2, 4, 6, 8]; // abertura: todas empatam; evita cálculo inútil
  let top = -Infinity, list = [];
  for (const i of e) {
    b[i] = me; const s = minimax(b, other(me), me, 1); b[i] = '';
    if (s > top) { top = s; list = [i]; } else if (s === top) list.push(i);
  }
  return list;
}
function immediate(b, p) { // casa que dá vitória imediata a p, ou undefined
  return empties(b).find((i) => { b[i] = p; const w = findWinner(b); b[i] = ''; return w; });
}
function chooseMove(b, me, level = S.level) {
  const e = empties(b);
  if (level === 'hard') return pick(bestMoves(b, me));
  if (level === 'medium') {
    const win = immediate(b, me); if (win !== undefined) return win;
    const block = immediate(b, other(me)); if (block !== undefined) return block;
    if (Math.random() < 0.35) return pick(e); // erro deliberado fora das situações táticas
    return pick([[4], [0, 2, 6, 8]].map((g) => g.filter((i) => !b[i])).find((g) => g.length) || e);
  }
  return pick(e);
}
function maybeAI() {
  if (!playing() || S.over || !isAITurn()) return;
  S.thinking = true; render();
  const t = S.token;
  setTimeout(() => {
    if (t !== S.token || !playing() || S.over || !isAITurn()) return; // rodada reiniciada, pausada ou encerrada: descarta
    S.thinking = false; place(chooseMove(S.board.slice(), 'O'));
  }, AI_DELAY_MS);
}

/* ===== Ações ===== */
function place(i) {
  if (!playing() || S.over || S.board[i]) return false;
  const p = S.turn; S.board[i] = p; Sound.place(p);
  const w = findWinner(S.board);
  if (w) finish(w.p, w.line); else if (!empties(S.board).length) finish('D', null); else S.turn = other(S.turn);
  sync(); maybeAI();
  return true;
}
function finish(result, line) { // único ponto que altera o placar
  S.over = true; S.result = result; S.line = line; S.thinking = false; S.score[result]++;
  Sound.result(result === 'D' ? 'draw' : S.mode === 'ai' && result === 'O' ? 'lose' : 'win'); // uma vez por resultado
}
function humanMove(i) {
  if (!playing() || S.over || S.thinking || isAITurn() || S.board[i]) { if (!S.over && !S.thinking) render(); return false; }
  return place(i);
}
function clearBoard() { S.board = Array(9).fill(''); S.turn = S.starter; S.over = false; S.line = null; S.result = null; }
function newRound() { // nova rodada na fase atual (na tela inicial continua na tela inicial; no jogo continua jogando)
  S.token++; S.thinking = false; clearCount(); clearConfirm(); clearBoard();
  sync(); maybeAI();
}
function restartToStart() { // descarta a partida, cancela contagens e volta à tela inicial sem iniciar nada; o placar é mantido
  S.token++; S.thinking = false; clearCount(); clearConfirm(); clearBoard();
  S.phase = 'start'; S.pauseKind = 'manual'; S.prevKind = 'manual';
  sync();
}
function resetSession() { S.score = { X: 0, O: 0, D: 0 }; newRound(); } // placar + rodada (troca de modo/dificuldade)
function resetScore() { S.score = { X: 0, O: 0, D: 0 }; clearConfirm(); sync(); } // só o placar; o tabuleiro continua
function setMode(m) { if (m !== S.mode) { Sound.click(); S.mode = m; store.save('mode', m); resetSession(); } }
function setLevel(l) { if (l !== S.level) { Sound.click(); S.level = l; store.save('level', l); resetSession(); } }
function setStarter(s) { if (s !== S.starter) { Sound.click(); S.starter = s; store.save('starter', s); newRound(); } }
function clearConfirm() { clearTimeout(S.confirm); S.confirm = 0; }
function clearCount() { clearTimeout(S.countTimer); S.countTimer = 0; }
function onSession() { // zerar o placar pede um segundo toque (expira sozinho) e não mexe no tabuleiro
  Sound.click();
  if (!S.confirm) { S.confirm = setTimeout(() => { S.confirm = 0; render(); }, CONFIRM_MS); render(); return; }
  resetScore();
}
function onRound() { // rodada encerrada: "Jogar de novo"; rodada em curso: "Reiniciar" volta à tela inicial
  if (S.phase === 'start') return;
  Sound.click();
  if (S.over && playing()) newRound(); else restartToStart();
}
function begin() {
  if (S.phase !== 'start') return;
  S.phase = 'play'; Sound.unlock(); sync(); maybeAI();
}

/* ===== Pausa, ajuda e retomada ===== */
function pauseGame(kind = 'manual') { // congela tudo: invalida a IA pendente e cancela a contagem; nada joga até continuar
  if (S.phase === 'start') return;
  if (S.phase === 'pause') { if (kind === 'recovered' && S.pauseKind === 'manual') { S.pauseKind = kind; sync(); } return; }
  clearCount(); S.token++; S.thinking = false; S.phase = 'pause'; S.pauseKind = kind; sync();
}
function resume() { // só o jogador chama: a retomada começa na contagem 3 → 2 → 1 → GO!
  if (S.phase !== 'pause') return;
  if (S.over) { S.phase = 'play'; sync(); return; } // rodada já decidida: nada a retomar
  startCount();
}
function startCount() { // a contagem só muda S.count; o jogo só volta a andar em GO!
  clearCount(); S.phase = 'count'; S.count = 3; Sound.unlock(); sync(); Sound.tick();
  const step = () => {
    if (S.phase !== 'count') return;
    S.count--;
    if (S.count > 0) { sync(); Sound.tick(); S.countTimer = setTimeout(step, COUNT_STEP_MS); return; }
    S.count = 0; sync(); Sound.go();
    S.countTimer = setTimeout(() => { S.countTimer = 0; if (S.phase !== 'count') return; S.phase = 'play'; sync(); maybeAI(); }, GO_MS);
  };
  S.countTimer = setTimeout(step, COUNT_STEP_MS);
}
function togglePause() {
  if ((S.phase === 'play' && !S.over) || S.phase === 'count') pauseGame('manual');
  else if (S.phase === 'pause') { if (S.pauseKind === 'help') closeHelp(); else resume(); }
}
function openHelp() {
  if (S.phase === 'start') return;
  if (S.phase !== 'pause') { pauseGame('help'); return; }
  if (S.pauseKind !== 'help') { S.prevKind = S.pauseKind; S.pauseKind = 'help'; sync(); }
}
function closeHelp() { // fechar a ajuda NÃO retoma: volta à tela de pausa e espera o jogador
  if (S.phase === 'pause' && S.pauseKind === 'help') { S.pauseKind = S.prevKind; S.prevKind = 'manual'; sync(); }
}
function toggleHelp() { if (S.phase === 'pause' && S.pauseKind === 'help') closeHelp(); else openHelp(); }
function onAway() { // saiu da aba / minimizou / vai descarregar: pausa e deixa a retomada pronta
  if ((S.phase === 'play' && !S.over) || S.phase === 'count') pauseGame('recovered');
  else if (S.phase === 'pause' && S.pauseKind === 'manual') { S.pauseKind = 'recovered'; sync(); }
}
function toggleMute() { S.muted = !S.muted; store.save('muted', S.muted); if (!S.muted) { Sound.unlock(); Sound.click(); } render(); }

/* ===== Persistência: o estado completo para continuar de onde parou ===== */
function persist() {
  store.saveMany({
    score: { ...S.score },
    game: S.phase === 'start' ? null : {
      board: S.board.slice(), turn: S.turn,
      status: S.over ? (S.result === 'D' ? 'draw' : 'won') : (playing() ? 'playing' : 'paused'),
    },
  });
}
function restore(g) { // partida salva: volta como "pausada/retomada" e espera o jogador
  S.board = g.board.slice(); S.turn = g.turn;
  const w = findWinner(S.board); // vitória/empate são recalculados do tabuleiro, não confiados ao armazenamento
  S.over = Boolean(w) || !empties(S.board).length; S.line = w ? w.line : null; S.result = w ? w.p : (S.over ? 'D' : null);
  S.phase = 'pause'; S.pauseKind = 'recovered'; S.prevKind = 'recovered';
}
function sync() { render(); persist(); }

/* ===== Renderização ===== */
function strikePath(line) { // risco da vitória, do centro da primeira casa ao da última, um pouco além
  const c = (i) => [(i % 3) * 100 + 50, Math.floor(i / 3) * 100 + 50];
  const [ax, ay] = c(line[0]), [bx, by] = c(line[2]), len = Math.hypot(bx - ax, by - ay), dx = (bx - ax) / len * 40, dy = (by - ay) / len * 40;
  return `M${ax - dx} ${ay - dy}L${bx + dx} ${by + dy}`;
}
function focusFor(key) { // leva o foco ao botão certo quando a tela muda por ação do jogador
  const el = { 'pause:manual': ui.resume, 'pause:recovered': ui.resume, 'pause:help': ui.helpClose, count: ui.veil }[key];
  if (el) el.focus({ preventScroll: true });
}
function render() {
  const ai = S.mode === 'ai', inPlay = playing(), paused = S.phase === 'pause', help = paused && S.pauseKind === 'help';
  ui.cells.forEach((c, i) => {
    const v = S.board[i], win = Boolean(S.line && S.line.includes(i));
    if ((c.dataset.v || '') !== v) { c.dataset.v = v; c.innerHTML = v ? SYMBOL[v] : ''; }
    c.className = `cell${v ? '' : ' empty'}${win ? ` win win-${v}` : ''}`;
    c.setAttribute('aria-disabled', !inPlay || S.over || Boolean(v) || isAITurn());
    c.setAttribute('aria-label', `Linha ${Math.floor(i / 3) + 1}, coluna ${(i % 3) + 1}: ${v || 'vazia'}`);
  });
  ui.board.inert = !inPlay; ui.game.inert = S.phase === 'start'; ui.start.hidden = S.phase !== 'start';
  ui.board.classList.toggle('has-win', Boolean(S.line));
  const sk = S.line ? `${S.line.join('')}${S.result}` : '';
  if (ui.strike.dataset.k !== sk) {
    ui.strike.dataset.k = sk; ui.strike.setAttribute('class', `strike${S.result ? ` w-${S.result}` : ''}`);
    ui.strike.innerHTML = S.line ? `<path class="strike-hl" pathLength="1" d="${strikePath(S.line)}"/><path class="strike-ink" pathLength="1" d="${strikePath(S.line)}"/>` : '';
  }

  let text, k = '';
  if (S.phase === 'start') { k = 'end'; text = 'Aguardando início'; }
  else if (S.phase === 'count') text = 'Prepare-se…';
  else if (paused) text = help ? 'Como jogar' : S.pauseKind === 'recovered' ? 'Partida retomada' : 'Pausado';
  else if (S.over) {
    k = 'end';
    text = S.result === 'D' ? 'Empate!' : ai ? (S.result === 'X' ? 'Você venceu!' : 'A IA venceu!') : `O jogador ${S.result} venceu!`;
  } else if (S.thinking) { k = 'O'; text = 'A IA está jogando…'; }
  else { k = S.turn; text = ai ? (S.turn === 'X' ? 'Sua vez · X' : 'Vez da IA · O') : `Vez do jogador ${S.turn}`; }
  ui.status.textContent = text; ui.status.dataset.k = k;
  $('name-X').textContent = ai ? 'Você · X' : 'Jogador X'; $('name-O').textContent = ai ? 'IA · O' : 'Jogador O';
  ['X', 'O', 'D'].forEach((p) => {
    $(`score-${p}`).textContent = S.score[p];
    $(`card-${p}`).classList.toggle('active', inPlay && (S.over ? S.result === p : p === S.turn));
  });
  const sync_ = (sel, key, val) => document.querySelectorAll(sel).forEach((el) => { const on = el.dataset[key] === val; el.setAttribute('aria-checked', on); el.tabIndex = on ? 0 : -1; });
  sync_('[data-mode]', 'mode', S.mode); sync_('[data-level]', 'level', S.level); sync_('[data-starter]', 'starter', S.starter);
  $('levels').hidden = !ai;
  document.querySelector('[data-starter="X"]').setAttribute('aria-label', ai ? 'Você começa (X)' : 'X começa');
  document.querySelector('[data-starter="O"]').setAttribute('aria-label', ai ? 'A IA começa (O)' : 'O começa');

  /* tela de pausa / ajuda / contagem sobre o tabuleiro */
  const veil = paused || S.phase === 'count';
  ui.veil.hidden = !veil; ui.veil.classList.toggle('is-count', S.phase === 'count');
  ui.pausePanel.hidden = !(paused && !help); ui.helpPanel.hidden = !help; ui.countPanel.hidden = S.phase !== 'count';
  const rec = S.pauseKind === 'recovered';
  ui.pausePanel.classList.toggle('is-recovered', rec);
  ui.pauseTitle.textContent = rec ? 'Partida retomada' : 'Pausa';
  ui.pauseText.textContent = rec ? 'Sua partida foi salva. Continue de onde parou.' : 'A partida está congelada até você continuar.';
  if (S.phase === 'count') {
    const label = S.count > 0 ? String(S.count) : 'GO!';
    ui.countNum.textContent = label; ui.countNum.classList.toggle('go', S.count === 0);
    if (S.lastCount !== S.count) { S.lastCount = S.count; ui.countNum.style.animation = 'none'; void ui.countNum.offsetWidth; ui.countNum.style.animation = ''; }
  } else S.lastCount = null;

  const again = S.over && inPlay;
  ui.round.textContent = again ? 'Jogar de novo' : 'Reiniciar'; ui.round.dataset.tip = again ? 'Reinicia a partida atual' : 'Descarta a partida e volta ao início'; ui.round.disabled = S.phase === 'start';
  ui.session.textContent = S.confirm ? 'Confirmar?' : 'Zerar placar';
  ui.session.disabled = !(S.score.X + S.score.O + S.score.D); // nada a zerar
  ui.pause.classList.toggle('is-paused', paused);
  ui.pause.disabled = S.phase === 'start' || (inPlay && S.over);
  ui.pause.setAttribute('aria-label', paused ? 'Continuar partida' : 'Pausar partida'); ui.pause.dataset.tip = paused ? 'Continuar (P)' : 'Pausar (P)';
  ui.help.setAttribute('aria-expanded', help ? 'true' : 'false');
  ui.mute.classList.toggle('is-muted', S.muted); ui.mute.setAttribute('aria-pressed', S.muted);
  ui.mute.setAttribute('aria-label', S.muted ? 'Ativar efeitos sonoros' : 'Silenciar efeitos sonoros');

  const key = S.phase === 'pause' ? `pause:${S.pauseKind}` : S.phase;
  if (S.focusKey !== null && key !== S.focusKey) focusFor(key);
  S.focusKey = key;
}
/* O palco mantém 288 × 512 e escala tudo pela unidade --u. */
function fitStage(w, h) {
  let ch = Math.min(h, MAX_CSS_HEIGHT), cw = ch * (W / H);
  if (cw > w) { cw = w; ch = cw / (W / H); }
  return [Math.floor(cw), Math.floor(ch)];
}
function resizeStage() {
  const [cw, ch] = fitStage(Math.max(1, ui.arena.clientWidth - MARGIN * 2), Math.max(1, ui.arena.clientHeight - MARGIN * 2));
  ui.wrap.style.width = `${cw}px`; ui.wrap.style.height = `${ch}px`; ui.wrap.style.setProperty('--u', `${cw / W}px`);
}

/* ===== Entradas ===== */
function init() {
  const saved = store.load();
  if (saved.mode) S.mode = saved.mode;
  if (saved.level) S.level = saved.level;
  if (saved.starter) S.starter = saved.starter;
  if (saved.score) S.score = { ...saved.score };
  S.muted = saved.muted === true;
  for (let i = 0; i < 9; i++) {
    const c = document.createElement('button'); c.type = 'button'; c.dataset.i = i; c.dataset.v = '';
    ui.board.appendChild(c); ui.cells.push(c);
  }
  ui.board.insertAdjacentHTML('beforeend', INK); ui.strike = $('strike');
  resizeStage();
  ui.board.addEventListener('click', (e) => { const c = e.target.closest('.cell'); if (c) humanMove(Number(c.dataset.i)); });
  document.querySelectorAll('[data-mode]').forEach((el) => el.addEventListener('click', () => setMode(el.dataset.mode)));
  document.querySelectorAll('[data-level]').forEach((el) => el.addEventListener('click', () => setLevel(el.dataset.level)));
  document.querySelectorAll('[data-starter]').forEach((el) => el.addEventListener('click', () => setStarter(el.dataset.starter)));
  ui.round.addEventListener('click', onRound);
  ui.mute.addEventListener('click', toggleMute);
  ui.session.addEventListener('click', onSession);
  ui.pause.addEventListener('click', () => { Sound.click(); togglePause(); });
  ui.help.addEventListener('click', () => { Sound.click(); toggleHelp(); });
  ui.resume.addEventListener('click', () => { Sound.click(); resume(); });
  ui.helpClose.addEventListener('click', () => { Sound.click(); closeHelp(); });
  ui.pauseRestart.addEventListener('click', () => { Sound.click(); restartToStart(); });
  ui.start.addEventListener('click', (e) => { if (!e.target.closest('.opts')) begin(); }); // os seletores não iniciam a partida
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const onBtn = e.target && e.target.closest && e.target.closest('button');
    if (e.code === 'Escape') {
      if (S.phase === 'pause' && S.pauseKind === 'help') closeHelp(); else if ((S.phase === 'play' && !S.over) || S.phase === 'count') pauseGame('manual');
      return;
    }
    if (e.code === 'Space' && !onBtn) {
      if (S.phase === 'start') { e.preventDefault(); begin(); }
      else if (S.phase === 'pause' && S.pauseKind !== 'help') { e.preventDefault(); resume(); }
      return;
    }
    if (e.code === 'Enter' && e.target === ui.start) { e.preventDefault(); begin(); return; }
    if (e.code === 'KeyP') togglePause(); else if (e.code === 'KeyR') onRound(); else if (e.code === 'KeyM') toggleMute();
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button'); if (b && e.detail) b.blur();   // toque/clique não deixa foco preso: SPACE continua valendo
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) onAway(); });
  window.addEventListener('pagehide', onAway);
  document.addEventListener('pointerdown', () => Sound.unlock()); // libera o áudio após a primeira interação
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('resize', resizeStage);
  window.addEventListener('orientationchange', resizeStage);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resizeStage);
  /* Tooltips: o atraso de 0,3 s é do CSS (--tip-delay); aqui só se esconde o balão ao clicar/ativar até o mouse sair ou o foco se perder */
  document.querySelectorAll('[data-tip]').forEach((el) => {
    el.addEventListener('click', () => el.classList.add('tip-off'));
    el.addEventListener('pointerleave', () => el.classList.remove('tip-off'));
    el.addEventListener('blur', () => { if (!el.matches(':hover')) el.classList.remove('tip-off'); });
  });
  if (saved.game) { restore(saved.game); sync(); } else newRound(); // partida salva volta pausada, aguardando o jogador
}
init();
window.__velha = { S, LINES, begin, findWinner, chooseMove, bestMoves, humanMove, newRound, restartToStart, resetSession, resetScore, pauseGame, resume, openHelp, closeHelp, togglePause, onAway, Sound, setMode, setLevel, setStarter };
