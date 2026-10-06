'use strict';
/* Jogo da Velha · Arcádia. Fonte única de verdade: o objeto S. O DOM só reflete S (função render). */
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const AI_DELAY_MS = 380, CONFIRM_MS = 3000;
const W = 288, H = 512, MARGIN = 6, MAX_CSS_HEIGHT = 1000;
const SYMBOL = {
  X: '<svg class="sx" viewBox="0 0 100 100" aria-hidden="true"><path class="draw" pathLength="1" d="M24 24L76 76"/><path class="draw d2" pathLength="1" d="M76 24L24 76"/></svg>',
  O: '<svg class="so" viewBox="0 0 100 100" aria-hidden="true"><circle class="draw" pathLength="1" cx="50" cy="50" r="27" transform="rotate(-90 50 50)"/></svg>',
};
const $ = (id) => document.getElementById(id);
const ui = { arena: $('arena'), stage: $('stage'), board: $('board'), status: $('status'), round: $('round-btn'), session: $('session-btn'), mute: $('mute-btn'), cells: [] };

const S = {
  mode: 'ai',          // 'two' (2 jogadores) | 'ai' (humano é X, IA é O)
  level: 'medium',     // easy | medium | hard
  starter: 'X',        // quem abre cada rodada
  board: Array(9).fill(''), turn: 'X', over: false, line: null, result: null, // result: 'X' | 'O' | 'D'
  score: { X: 0, O: 0, D: 0 },
  token: 0,            // muda a cada rodada nova: invalida jogada pendente da IA
  thinking: false, confirm: 0, muted: false,
};

/* ===== Armazenamento: game_storage (registro "jogo_velha"); chaves antigas migradas uma vez ===== */
const store = GameStorage.game('jogo_velha');
store.migrate([
  { from: 'jogo_velha:mode', to: 'mode' }, { from: 'jogo_velha:level', to: 'level' }, { from: 'jogo_velha:starter', to: 'starter' },
  { from: 'jogo_velha:muted', to: 'muted', type: 'bool01' },
]);

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
  if (S.over || !isAITurn()) return;
  S.thinking = true; render();
  const t = S.token;
  setTimeout(() => {
    if (t !== S.token || S.over || !isAITurn()) return; // rodada reiniciada ou encerrada: descarta
    S.thinking = false; place(chooseMove(S.board.slice(), 'O'));
  }, AI_DELAY_MS);
}

/* ===== Ações ===== */
function place(i) {
  if (S.over || S.board[i]) return false;
  const p = S.turn; S.board[i] = p; Sound.place(p);
  const w = findWinner(S.board);
  if (w) finish(w.p, w.line); else if (!empties(S.board).length) finish('D', null); else S.turn = other(S.turn);
  render(); maybeAI();
  return true;
}
function finish(result, line) { // único ponto que altera o placar
  S.over = true; S.result = result; S.line = line; S.thinking = false; S.score[result]++;
  Sound.result(result === 'D' ? 'draw' : S.mode === 'ai' && result === 'O' ? 'lose' : 'win'); // uma vez por resultado
}
function humanMove(i) {
  if (S.over || S.thinking || isAITurn() || S.board[i]) { if (!S.over && !S.thinking) render(); return false; }
  return place(i);
}
function newRound() {
  S.token++; S.thinking = false; clearConfirm();
  S.board = Array(9).fill(''); S.turn = S.starter; S.over = false; S.line = null; S.result = null;
  render(); maybeAI();
}
function resetSession() { S.score = { X: 0, O: 0, D: 0 }; newRound(); } // placar + rodada (troca de modo/dificuldade)
function resetScore() { S.score = { X: 0, O: 0, D: 0 }; clearConfirm(); render(); } // só o placar; o tabuleiro continua
function setMode(m) { if (m !== S.mode) { Sound.click(); S.mode = m; store.set('mode', m); resetSession(); } }
function setLevel(l) { if (l !== S.level) { Sound.click(); S.level = l; store.set('level', l); resetSession(); } }
function setStarter(s) { if (s !== S.starter) { Sound.click(); S.starter = s; store.set('starter', s); newRound(); } }
function clearConfirm() { clearTimeout(S.confirm); S.confirm = 0; }
function onSession() { // zerar o placar pede um segundo toque (expira sozinho) e não mexe no tabuleiro
  Sound.click();
  if (!S.confirm) { S.confirm = setTimeout(() => { S.confirm = 0; render(); }, CONFIRM_MS); render(); return; }
  resetScore();
}
function onRound() { Sound.click(); newRound(); } // "Reiniciar rodada" e "Jogar de novo" são o mesmo comando
function toggleMute() { S.muted = !S.muted; store.set('muted', S.muted); if (!S.muted) { Sound.unlock(); Sound.click(); } render(); }

/* ===== Renderização ===== */
function render() {
  const ai = S.mode === 'ai';
  ui.cells.forEach((c, i) => {
    const v = S.board[i], win = Boolean(S.line && S.line.includes(i));
    if ((c.dataset.v || '') !== v) { c.dataset.v = v; c.innerHTML = v ? SYMBOL[v] : ''; }
    c.className = `cell${v ? '' : ' empty'}${win ? ` win win-${v}` : ''}`;
    c.setAttribute('aria-disabled', S.over || Boolean(v) || isAITurn());
    c.setAttribute('aria-label', `Linha ${Math.floor(i / 3) + 1}, coluna ${(i % 3) + 1}: ${v || 'vazia'}`);
  });
  ui.board.classList.toggle('has-win', Boolean(S.line));
  let text, k;
  if (S.over) {
    k = 'end';
    text = S.result === 'D' ? 'Empate!' : ai ? (S.result === 'X' ? 'Você venceu!' : 'A IA venceu!') : `O jogador ${S.result} venceu!`;
  } else if (S.thinking) { k = 'O'; text = 'A IA está jogando…'; }
  else { k = S.turn; text = ai ? (S.turn === 'X' ? 'Sua vez · X' : 'Vez da IA · O') : `Vez do jogador ${S.turn}`; }
  ui.status.textContent = text; ui.status.dataset.k = k;
  $('name-X').textContent = ai ? 'Você · X' : 'Jogador X'; $('name-O').textContent = ai ? 'IA · O' : 'Jogador O';
  ['X', 'O', 'D'].forEach((p) => {
    $(`score-${p}`).textContent = S.score[p];
    $(`card-${p}`).classList.toggle('active', S.over ? S.result === p : p === S.turn);
  });
  const sync = (sel, key, val) => document.querySelectorAll(sel).forEach((el) => { const on = el.dataset[key] === val; el.setAttribute('aria-checked', on); el.tabIndex = on ? 0 : -1; });
  sync('[data-mode]', 'mode', S.mode); sync('[data-level]', 'level', S.level); sync('[data-starter]', 'starter', S.starter);
  $('levels').hidden = !ai;
  document.querySelector('[data-starter="X"]').setAttribute('aria-label', ai ? 'Você começa (X)' : 'X começa');
  document.querySelector('[data-starter="O"]').setAttribute('aria-label', ai ? 'A IA começa (O)' : 'O começa');
  ui.round.textContent = S.over ? 'Jogar de novo' : 'Reiniciar rodada';
  ui.session.textContent = S.confirm ? 'Confirmar?' : 'Zerar placar';
  ui.session.disabled = !(S.score.X + S.score.O + S.score.D); // nada a zerar
  ui.mute.classList.toggle('is-muted', S.muted); ui.mute.setAttribute('aria-pressed', S.muted);
  ui.mute.setAttribute('aria-label', S.muted ? 'Ativar efeitos sonoros' : 'Silenciar efeitos sonoros');
}
function resizeStage() {
  const w = Math.max(1, ui.arena.clientWidth - MARGIN * 2), h = Math.max(1, ui.arena.clientHeight - MARGIN * 2);
  let ch = Math.min(h, MAX_CSS_HEIGHT), cw = ch * (W / H);
  if (cw > w) { cw = w; ch = cw / (W / H); }
  cw = Math.floor(cw); ch = Math.floor(ch);
  ui.stage.style.width = `${cw}px`; ui.stage.style.height = `${ch}px`; ui.stage.style.setProperty('--u', `${cw / W}px`);
}

/* ===== Entradas ===== */
function init() {
  const m = store.get('mode'), l = store.get('level'), s = store.get('starter');
  if (m === 'two' || m === 'ai') S.mode = m;
  if (['easy', 'medium', 'hard'].includes(l)) S.level = l;
  if (s === 'X' || s === 'O') S.starter = s;
  S.muted = store.get('muted', false) === true;
  for (let i = 0; i < 9; i++) {
    const c = document.createElement('button'); c.type = 'button'; c.dataset.i = i; c.dataset.v = '';
    ui.board.appendChild(c); ui.cells.push(c);
  }
  resizeStage();
  ui.board.addEventListener('click', (e) => { const c = e.target.closest('.cell'); if (c) humanMove(Number(c.dataset.i)); });
  document.querySelectorAll('[data-mode]').forEach((el) => el.addEventListener('click', () => setMode(el.dataset.mode)));
  document.querySelectorAll('[data-level]').forEach((el) => el.addEventListener('click', () => setLevel(el.dataset.level)));
  document.querySelectorAll('[data-starter]').forEach((el) => el.addEventListener('click', () => setStarter(el.dataset.starter)));
  ui.round.addEventListener('click', onRound);
  ui.mute.addEventListener('click', toggleMute);
  ui.session.addEventListener('click', onSession);
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.code === 'KeyR') onRound(); else if (e.code === 'KeyM') toggleMute();
  });
  document.addEventListener('pointerdown', () => Sound.unlock()); // libera o áudio após a primeira interação
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('resize', resizeStage);
  window.addEventListener('orientationchange', resizeStage);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resizeStage);
  newRound();
}
init();
window.__velha = { S, LINES, findWinner, chooseMove, bestMoves, humanMove, newRound, resetSession, resetScore, Sound, setMode, setLevel, setStarter };