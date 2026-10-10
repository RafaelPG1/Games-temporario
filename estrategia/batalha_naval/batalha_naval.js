'use strict';
/* Batalha Naval · Arcádia. Modos: 1 jogador (contra a IA) e 2 jogadores locais (cada um posiciona a própria frota, com uma tela de privacidade "handoff" entre os dois; na batalha os dois mares ficam visíveis, só com disparos, e as vezes alternam sozinhas). Fonte única de verdade: o objeto S. O DOM só reflete S (função render) e a partida é gravada a cada render (persist).
   Só se joga quando live(): partida iniciada e sem pausa. Pausa: S.pause = manual | recovered (partida retomada) | help; continuar retoma na hora, sem contagem. */
const N = 10, COLS = 'ABCDEFGHIJ';
const FLEET = [['Porta-aviões', 5], ['Encouraçado', 4], ['Cruzador', 3], ['Submarino', 3], ['Destróier', 2]];
const AI_DELAY = 800;
const $ = (id) => document.getElementById(id);
const rand = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rand(a.length)];
const coord = (i) => COLS[i % N] + (Math.floor(i / N) + 1);
// Persistência própria em batalha_naval_storage.js: mode, level, muted, partida.
const store = BatalhaNavalStorage, SAVED = store.load();

/* Tabuleiro: shot[i] = 0 intacta | 1 água | 2 acerto | 3 casa de navio afundado */
const newBoard = () => ({ ships: FLEET.map(([n, l], id) => ({ id, n, l, cells: null })), shot: Array(N * N).fill(0) });
const S = {
  started: false,          // false até o primeiro toque/SPACE: nada pode ser jogado
  phase: 'setup',            // setup | battle | over
  mode: 1, edit: 'me', handoff: null, // mode: 1 jogador (IA) | 2 jogadores locais; edit: de quem é a frota em posicionamento; handoff: quem deve receber o aparelho (tela de privacidade)
  level: 'medium', horiz: true, sel: 0, hover: -1, turn: 'me', busy: false, gen: 0, timer: 0,
  me: newBoard(), foe: newBoard(), log: [], msg: '', last: null, dlg: null, showResult: false, win: false,
  pause: null, prevKind: 'manual', focusKey: null, lastShot: 0,
};
const live = () => S.started && !S.pause;
// Dois jogadores: S.me = frota do Jogador 1 (mar da esquerda), S.foe = frota do Jogador 2 (mar da direita); turn 'me' (J1) | 'p2' (J2).
const cur = () => S[S.edit];                                                                  // frota em posicionamento
const mine = () => (S.mode === 2 && S.phase === 'setup' ? S[S.edit] : S.me); // mar da esquerda ("Sua frota" / Jogador 1); no posicionamento, a frota de quem está posicionando
const theirs = () => (mine() === S.me ? S.foe : S.me);                                         // mar da direita (radar inimigo / Jogador 2): só mostra disparos

/* ===== Áudio (Web Audio, sem arquivos externos). Só toca por eventos reais da partida ===== */
const Sound = (() => {
  const st = { muted: SAVED.muted === true }, log = [];
  let ctx = null, master = null, noise = null, off = false;
  const gain = () => 0.29; // volume padrão fixo
  function ensure() {
    if (off) return null;
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) { off = true; return null; }
      try {
        ctx = new C(); master = ctx.createGain(); master.gain.value = gain(); master.connect(ctx.destination);
        noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { off = true; ctx = null; return null; }
    }
    if (ctx.state === 'suspended') { try { ctx.resume().catch(() => {}); } catch (e) { /* ignora */ } }
    return ctx;
  }
  const env = (c, g, t, dur, v) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); };
  function tone(c, f0, f1, dur, type, v, d = 0) {
    const t = c.currentTime + d, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(c, g, t, dur, v); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.03);
  }
  function hush(c, f0, f1, dur, type, v, d = 0) { // ruído filtrado com varredura de frequência
    const t = c.currentTime + d, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = noise; f.type = type; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(c, g, t, dur, v); s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.03);
  }
  const defs = {
    fire: (c, d) => { hush(c, 3000, 500, 0.22, 'bandpass', 0.35, d); tone(c, 700, 160, 0.2, 'sawtooth', 0.1, d); },
    miss: (c, d) => { hush(c, 2500, 300, 0.4, 'lowpass', 0.5, d); tone(c, 380, 700, 0.1, 'sine', 0.12, d + 0.04); },
    hit: (c, d) => { tone(c, 160, 45, 0.28, 'square', 0.25, d); hush(c, 1400, 200, 0.25, 'lowpass', 0.6, d); },
    sunk: (c, d) => { hush(c, 1800, 90, 1, 'lowpass', 0.8, d); tone(c, 260, 35, 1, 'sawtooth', 0.28, d); tone(c, 110, 40, 0.35, 'square', 0.28, d + 0.35); hush(c, 900, 150, 0.3, 'lowpass', 0.5, d + 0.5); },
    win: (c, d) => [523, 659, 784, 1047].forEach((f, i) => tone(c, f, f, 0.22, 'triangle', 0.25, d + i * 0.14)),
    lose: (c, d) => [330, 294, 262, 196].forEach((f, i) => tone(c, f, f * 0.98, 0.3, 'triangle', 0.25, d + i * 0.2)),
    click: (c, d) => tone(c, 700, 520, 0.05, 'sine', 0.12, d),
  };
  function play(name, d = 0) {
    if (st.muted) return;
    log.push(name); if (log.length > 60) log.shift();
    try { const c = ensure(); if (c) defs[name](c, d); } catch (e) { /* áudio nunca quebra o jogo */ }
  }
  return {
    log, play, get muted() { return st.muted; },
    // Um disparo = lançamento + UM resultado; o afundamento substitui o som de acerto
    shot(t) { play('fire'); play(t, 0.3); },
    setMuted(m) { st.muted = m; store.save('muted', m); if (!m) ensure(); },
    unlock() { if (!st.muted) ensure(); },
  };
})();

/* ===== Posicionamento e validação ===== */
function span(i, l, h) { // casas ocupadas por um navio que começa em i, ou null se sair do mapa
  const r = Math.floor(i / N), c = i % N;
  if (h ? c + l > N : r + l > N) return null;
  return Array.from({ length: l }, (_, k) => (h ? i + k : i + k * N));
}
const owner = (b, i) => b.ships.find((s) => s.cells && s.cells.includes(i));
const canPlace = (b, cells, self) => Boolean(cells) && cells.every((i) => { const o = owner(b, i); return !o || o === self; });
function randomFleet(b) {
  for (;;) {
    b.ships.forEach((s) => { s.cells = null; });
    if (b.ships.every((s) => {
      for (let t = 0; t < 200; t++) { const c = span(rand(N * N), s.l, Math.random() < 0.5); if (canPlace(b, c, s)) { s.cells = c; return true; } }
      return false;
    })) return;
  }
}
const allPlaced = (b) => b.ships.every((s) => s.cells);

/* ===== Disparos e vitória ===== */
const sunk = (b, s) => s.cells.every((c) => b.shot[c] === 3);
const allSunk = (b) => b.ships.every((s) => sunk(b, s));
function fire(b, i) { // registra o disparo imediatamente; null se inválido
  if (!(i >= 0 && i < N * N) || b.shot[i]) return null;
  const s = owner(b, i);
  if (!s) { b.shot[i] = 1; return { t: 'miss', i, cells: [i] }; }
  b.shot[i] = 2;
  if (s.cells.every((c) => b.shot[c] >= 2)) { s.cells.forEach((c) => { b.shot[c] = 3; }); return { t: 'sunk', i, ship: s, cells: s.cells }; }
  return { t: 'hit', i, ship: s, cells: [i] };
}

/* ===== IA: só enxerga o que o jogador também vê (água, acertos e navios afundados) ===== */
const around = (i) => {
  const r = Math.floor(i / N), c = i % N, o = [];
  if (r > 0) o.push(i - N); if (r < N - 1) o.push(i + N); if (c > 0) o.push(i - 1); if (c < N - 1) o.push(i + 1);
  return o;
};
function aiPick(b, level) {
  const free = [], hits = [];
  b.shot.forEach((v, i) => { if (!v) free.push(i); else if (v === 2) hits.push(i); });
  if (level === 'easy') return pick(free);
  if (level === 'medium') {
    const t = [...new Set(hits.flatMap(around))].filter((i) => !b.shot[i]);
    return pick(t.length ? t : free);
  }
  // Difícil: densidade de probabilidade. Conta posições possíveis dos navios ainda vivos (tamanhos públicos);
  // posições que cobrem acertos pendentes pesam muito mais (perseguição e linha); na caça, prefere o padrão xadrez.
  const alive = b.ships.filter((s) => !sunk(b, s)).map((s) => s.l), score = Array(N * N).fill(0);
  for (const l of alive) for (const h of [true, false]) for (let i = 0; i < N * N; i++) {
    const c = span(i, l, h);
    if (!c || c.some((x) => b.shot[x] === 1 || b.shot[x] === 3)) continue;
    const w = 20 ** c.filter((x) => b.shot[x] === 2).length;
    c.forEach((x) => { if (!b.shot[x]) score[x] += w; });
  }
  const val = (i) => score[i] * (hits.length || (Math.floor(i / N) + (i % N)) % 2 ? 1 : 0.7);
  const top = Math.max(...free.map(val));
  return pick(free.filter((i) => val(i) === top));
}

/* ===== Fluxo da partida ===== */
const LABEL = { me: 'Você', foe: 'O inimigo' }, LABEL2 = { me: 'Jogador 1', foe: 'Jogador 2' };
function say(who, r) {
  if (S.mode === 2) {
    const t2 = r.t === 'miss' ? 'água.' : r.t === 'hit' ? 'acertou um navio!' : `afundou o ${r.ship.n}!`;
    S.msg = `${LABEL2[who]} disparou em ${coord(r.i)}: ${t2}`; S.log.unshift(S.msg); S.log.length = Math.min(S.log.length, 6);
    Sound.shot(r.t); return;
  }
  const t = r.t === 'miss' ? 'água.' : r.t === 'hit' ? (who === 'me' ? 'acertou um navio!' : 'acertou um dos seus navios!')
    : `${who === 'me' ? 'afundou o' : 'afundou seu'} ${r.ship.n}!`;
  S.msg = `${LABEL[who]} disparou em ${coord(r.i)}: ${t}`;
  S.log.unshift(S.msg); S.log.length = Math.min(S.log.length, 6);
  S.last = { side: who === 'me' ? 'foe' : 'me', cells: r.cells };
  Sound.shot(r.t);
}
const SHOT_LOCK_MS = 500; // 2 jogadores: trava curta contra duplo toque (a vez passa na hora, e o mesmo dedo poderia atirar pelo outro jogador)
function playerFire(i, side = 'foe') {
  if (!live() || S.phase !== 'battle' || S.busy || (S.mode === 1 && (S.turn !== 'me' || side !== 'foe'))) return;
  const two = S.mode === 2;
  if (two && (side !== (S.turn === 'p2' ? 'me' : 'foe') || Date.now() - S.lastShot < SHOT_LOCK_MS)) return; // só se atira no mar do adversário
  const tgt = two ? (side === 'me' ? S.me : S.foe) : S.foe, r = fire(tgt, i); if (!r) return;
  say(two && S.turn === 'p2' ? 'foe' : 'me', r);
  if (two) {
    S.lastShot = Date.now(); S.last = { side, cells: r.cells };
    if (allSunk(tgt)) { finish(S.turn !== 'p2'); return; }
    S.turn = S.turn === 'p2' ? 'me' : 'p2'; render(); return; // a vez passa para o outro jogador
  }
  S.busy = true;
  if (allSunk(tgt)) { finish(true); return; }
  S.turn = 'ai'; render();
  const g = S.gen; S.timer = setTimeout(() => aiTurn(g), AI_DELAY);
}
function aiTurn(g) {
  if (g !== S.gen || S.phase !== 'battle' || !live()) return;
  const r = fire(S.me, aiPick(S.me, S.level)); if (!r) return;
  say('foe', r);
  if (allSunk(S.me)) { finish(false); return; }
  S.turn = 'me'; S.busy = false; render();
}
function finish(win) {
  S.phase = 'over'; S.win = win; S.busy = true; render();
  const g = S.gen; S.timer = setTimeout(() => { if (g === S.gen) { S.showResult = true; render(); Sound.play(win || S.mode === 2 ? 'win' : 'lose'); $('again').focus(); } }, 1300);
}
function reset(toStart = false) { // toStart: volta à tela inicial (Abandonar/Reiniciar); sem ele, vai direto ao posicionamento (Nova partida)
  clearTimeout(S.timer); S.gen++;
  if (toStart) S.started = false;
  Object.assign(S, { pause: null, prevKind: 'manual', edit: 'me', handoff: null, phase: 'setup', sel: 0, hover: -1, turn: 'me', busy: false, me: newBoard(), foe: newBoard(), log: [], last: null,
    dlg: null, showResult: false, msg: 'Escolha um navio e toque no mar para posicioná-lo.' });
  render();
}
function startBattle() {
  if (!live() || S.phase !== 'setup' || !allPlaced(cur())) return;
  if (S.mode === 2) { // cada jogador posiciona a própria frota, com tela de privacidade entre os dois; depois a batalha começa com sorteio
    if (S.edit === 'me') { S.edit = 'foe'; S.sel = 0; S.hover = -1; S.msg = 'Jogador 2: escolha um navio e toque no mar para posicioná-lo.'; S.handoff = 'p2'; render(); return; }
    const first = Math.random() < 0.5 ? 'me' : 'p2'; // sorteio único, no início da batalha
    Object.assign(S, { phase: 'battle', turn: first, busy: false, sel: null, hover: -1, log: [], last: null, handoff: null, msg: `Sorteio: o Jogador ${first === 'p2' ? 2 : 1} começa! Dispare no tabuleiro do adversário.` });
    render(); return;
  }
  randomFleet(S.foe);
  Object.assign(S, { phase: 'battle', turn: 'me', busy: false, sel: null, hover: -1, log: [], last: null, msg: 'Batalha iniciada. Escolha uma casa no radar inimigo.' });
  render();
}
function placeAt(i) {
  if (!live() || S.phase !== 'setup') return;
  const o = owner(cur(), i);
  if (o) { o.cells = null; S.sel = o.id; S.msg = `${o.n} recolhido. Escolha onde posicioná-lo.`; }
  else if (S.sel !== null) {
    const sh = cur().ships[S.sel], c = span(i, sh.l, S.horiz);
    if (!canPlace(cur(), c, sh)) { S.msg = 'Posição inválida: o navio sai do mapa ou toca outro navio.'; render(); return; }
    sh.cells = c; S.sel = cur().ships.findIndex((s) => !s.cells); if (S.sel < 0) S.sel = null;
    S.msg = allPlaced(cur()) ? 'Frota posicionada. Inicie a batalha ou ajuste os navios.' : `${sh.n} posicionado.`;
  }
  render();
}

/* ===== Tela inicial, pausa, ajuda e retomada ===== */
function begin() {
  if (S.started) return;
  S.started = true; Sound.unlock(); render();
}
function pauseGame(kind = 'manual') { // congela tudo: cancela a vez da IA e a contagem; nada joga até o jogador continuar
  if (!S.started || S.phase === 'over' || S.handoff) return; // na tela de privacidade já está tudo oculto e parado
  if (S.pause) { if (kind === 'recovered' && S.pause === 'manual') S.pause = kind; render(); return; }
  clearTimeout(S.timer); S.timer = 0; S.gen++; S.dlg = null; S.pause = kind; render();
}
function resume() { // só o jogador chama; sem contagem: a partida segue de onde parou (se era a vez da IA, ela é reagendada)
  if (S.pause !== 'manual' && S.pause !== 'recovered') return;
  S.pause = null; Sound.unlock(); render();
  if (S.phase === 'battle' && S.turn === 'ai') { const g = S.gen; S.timer = setTimeout(() => aiTurn(g), AI_DELAY); }
}
function togglePause() {
  if (!S.started || S.phase === 'over' || S.dlg || S.handoff) return;
  if (!S.pause) pauseGame('manual'); else if (S.pause === 'help') closeHelp(); else resume();
}
function openHelp() {
  if (!S.started || S.phase === 'over' || S.handoff) return;
  if (!S.pause) { pauseGame('help'); return; }
  if (S.pause !== 'help') { S.prevKind = S.pause; S.pause = 'help'; render(); }
}
function closeHelp() { // fechar a ajuda NÃO retoma: volta à tela de pausa e espera o jogador
  if (S.pause === 'help') { S.pause = S.prevKind; S.prevKind = 'manual'; render(); }
}
function onAway() { // saiu da aba / minimizou / vai descarregar: pausa e deixa a retomada pronta
  if (!S.started || S.phase === 'over') return;
  if (!S.pause) pauseGame('recovered'); else if (S.pause === 'manual') { S.pause = 'recovered'; render(); }
}

/* ===== Persistência: o estado completo para continuar de onde parou ===== */
const snap = (b) => ({ ships: b.ships.map((s) => (s.cells ? s.cells.slice() : null)), shot: b.shot.slice() });
function persist() {
  store.saveMany({
    level: S.level,
    game: !S.started ? null : {
      mode: S.mode, edit: S.edit, handoff: S.handoff, done: S.busy, phase: S.phase, horiz: S.horiz, sel: S.sel, turn: S.turn, win: S.win, msg: S.msg, log: S.log.slice(), me: snap(S.me), foe: snap(S.foe),
      status: S.phase === 'over' ? (S.win ? 'won' : 'lost') : (live() ? (S.phase === 'setup' ? 'setup' : 'playing') : 'paused'),
    },
  });
}
function restore(g) { // partida salva: volta pausada ("retomada") e espera o jogador; vitória/derrota são recalculadas dos mares
  const rb = (b, d) => { b.ships.forEach((s, i) => { s.cells = d.ships[i] ? d.ships[i].slice() : null; }); b.shot = d.shot.slice(); };
  rb(S.me, g.me); rb(S.foe, g.foe);
  Object.assign(S, { mode: g.mode, edit: g.edit, handoff: g.handoff, started: true, phase: g.phase, horiz: g.horiz, sel: g.sel, turn: g.turn, win: g.win, msg: g.msg, log: g.log.slice(), last: null, hover: -1, dlg: null,
    showResult: false, busy: false, pause: 'recovered', prevKind: 'recovered' });
  if (S.phase !== 'setup') {
    if (allSunk(S.foe)) { S.phase = 'over'; S.win = true; } else if (allSunk(S.me)) { S.phase = 'over'; S.win = false; } else S.phase = 'battle';
  }
  if (S.phase === 'over') { S.pause = null; S.handoff = null; S.busy = true; S.showResult = true; }
  else if (S.phase === 'battle') S.busy = S.mode === 1 && S.turn === 'ai';
  if (S.mode === 2 && S.phase === 'setup' && !S.handoff) S.handoff = S.edit === 'me' ? 'me' : 'p2'; // 2 jogadores: ao recarregar durante o posicionamento, a frota fica oculta até confirmar
  if (S.phase !== 'setup') S.handoff = null;
  if (S.handoff) S.pause = null; // a tela de privacidade já segura o jogo; ao confirmar, a partida segue
}
function setMode(m) { if (S.started || m === S.mode) return; S.mode = m; store.save('mode', m); render(); } // só na tela inicial
function setLevel(l) { if (S.phase !== 'setup' || l === S.level || S.pause) return; S.level = l; store.save('level', l); render(); }

/* ===== Renderização ===== */
const cells = { me: [], foe: [] };
function build(side) {
  const el = $('board-' + side), lb = (t) => { const d = document.createElement('span'); d.className = 'lb'; d.textContent = t; d.setAttribute('aria-hidden', 'true'); return d; };
  el.append(lb(''), ...[...COLS].map(lb));
  for (let r = 0; r < N; r++) {
    el.append(lb(r + 1));
    for (let c = 0; c < N; c++) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.i = r * N + c; el.appendChild(b); cells[side].push(b);
    }
  }
}
function paint(side) {
  const b = side === 'me' ? mine() : theirs(), setup = S.phase === 'setup', prev = new Set();
  let bad = false;
  const tgtSide = S.mode === 2 ? (S.turn === 'p2' ? 'me' : 'foe') : 'foe'; // mar que pode receber disparo agora
  if (side === 'me' && setup && S.sel !== null && S.hover >= 0) {
    const sh = b.ships[S.sel], row = Math.floor(S.hover / N);
    for (let k = 0; k < sh.l; k++) { const x = S.horiz ? S.hover + k : S.hover + k * N; if (S.horiz ? Math.floor(x / N) === row : x < N * N) prev.add(x); }
    bad = !canPlace(b, span(S.hover, sh.l, S.horiz), sh);
  }
  cells[side].forEach((el, i) => {
    const v = b.shot[i], o = (side === 'me' && (S.mode === 1 || setup)) || b.shot[i] === 3 ? owner(b, i) : null, k = ['c']; // navio afundado é público; em 2 jogadores, na batalha, nenhuma frota intacta aparece
    if (o) {
      k.push('ship', o.cells[1] - o.cells[0] === 1 ? 'h' : 'v');
      if (i === o.cells[0]) k.push('st'); if (i === o.cells[o.l - 1]) k.push('en'); if (o.l > 2 && i === o.cells[1]) k.push('bridge');
    }
    if (v) k.push(v === 1 ? 'miss' : v === 2 ? 'hit' : 'sunk');
    if (prev.has(i)) k.push(bad ? 'bad' : 'prev');
    if (S.last && S.last.side === side && S.last.cells.includes(i)) k.push('pop');
    el.className = k.join(' ');
    el.disabled = setup ? side !== 'me' || !live() : !(S.phase === 'battle' && live() && !S.busy && !v && side === tgtSide && (S.mode === 2 || S.turn === 'me'));
    el.setAttribute('aria-label', `${coord(i)}: ${v === 1 ? 'água' : v === 2 ? 'acerto' : v === 3 ? 'navio afundado' : o ? 'seu navio' : side === 'foe' || S.mode === 2 ? 'não atacada' : 'mar'}`);
  });
}
function fleetList(side) {
  const b = side === 'me' ? mine() : theirs(), el = $('fleet-' + side);
  el.className = 'fleet' + (side === 'foe' || S.mode === 2 ? ' hid' : '');
  el.innerHTML = S.phase === 'setup' ? '' : b.ships.map((s) => {
    const gone = sunk(b, s), pips = Array.from({ length: s.l }, (_, k) => `<i class="${side === 'me' && S.mode === 1 && b.shot[s.cells[k]] >= 2 ? 'h' : ''}"></i>`).join('');
    return `<li class="${gone ? 'gone' : ''}">${pips}<span>${s.n}</span></li>`;
  }).join('');
  if (S.phase !== 'setup') {
    const left = b.ships.filter((s) => !sunk(b, s)).length;
    $(side === 'me' ? 'sub-me' : 't-foe').innerHTML = side === 'me' ? `${left} de 5 navios` : `${S.mode === 2 ? 'Jogador 2' : 'Radar inimigo'} <small>${left} de 5 navios</small>`;
  } else $('sub-me').textContent = `${cur().ships.filter((s) => s.cells).length} de 5 posicionados`;
}
const pickBtns = [];
function render() {
  const setup = S.phase === 'setup';
  $('stage').dataset.phase = S.phase; $('stage').classList.toggle('is-ready', !S.started); $('stage-body').inert = !S.started || Boolean(S.handoff); $('stage').classList.toggle('is-handoff', Boolean(S.handoff));
  const idle = S.pause ? (S.pause === 'recovered' ? 'Partida retomada' : S.pause === 'help' ? 'Como jogar' : 'Pausado'): '';
  $('turn').dataset.t = idle ? 'pause' : setup ? 'setup' : S.phase === 'over' ? 'over' : S.mode === 2 || S.turn === 'me' ? 'me' : 'ai';
  $('boards').inert = !live();
  $('turn').textContent = idle ? idle : setup ? (S.mode === 2 ? `Jogador ${S.edit === 'me' ? 1 : 2}: posicione a frota` : 'Posicionamento da frota') : S.phase === 'over' ? 'Fim de jogo'
    : S.mode === 2 ? `Vez do Jogador ${S.turn === 'p2' ? 2 : 1}` : S.turn === 'me' ? 'Sua vez de atacar' : 'Inimigo está mirando…';
  $('status').textContent = S.msg; $('stage').dataset.t = $('turn').dataset.t;
  $('lvl').textContent = `IA · ${{ easy: 'Fácil', medium: 'Médio', hard: 'Difícil' }[S.level]}`;
  document.querySelectorAll('.levels button').forEach((el) => { el.setAttribute('aria-checked', el.dataset.level === S.level); el.disabled = !setup || !live(); });
  document.querySelectorAll('.start-modes button').forEach((el) => { const on = Number(el.dataset.mode) === S.mode; el.setAttribute('aria-checked', on); el.tabIndex = on ? 0 : -1; });
  $('levels').hidden = S.mode === 2; $('lvl').hidden = S.mode === 2;
  $('who-me').textContent = S.mode === 2 ? (setup ? `Frota do Jogador ${S.edit === 'me' ? 1 : 2}` : 'Jogador 1') : 'Sua frota';
  $('start').textContent = S.mode === 2 && S.edit === 'me' ? 'Passar ao Jogador 2' : 'Iniciar batalha';
  $('stage').dataset.mode = S.mode; $('stage').dataset.shooter = S.mode === 2 && S.phase === 'battle' ? S.turn : '';
  $('handoff').hidden = !S.handoff;
  if (S.handoff) {
    const n = S.handoff === 'me' ? 1 : 2;
    $('handoff-t').textContent = `Jogador ${n}: prepare sua frota`;
    $('handoff-p').textContent = `Passe o dispositivo ao Jogador ${n}. Ninguém mais deve olhar a tela.`;
  }
  paint('me'); paint('foe'); fleetList('me'); fleetList('foe');
  pickBtns.forEach((el, i) => {
    const s = cur().ships[i]; el.setAttribute('aria-pressed', S.sel === i); el.classList.toggle('done', Boolean(s.cells));
  });
  $('mute').setAttribute('aria-pressed', Sound.muted); $('mute').classList.toggle('is-muted', Sound.muted); $('mute').setAttribute('aria-label', Sound.muted ? 'Ativar efeitos sonoros' : 'Silenciar efeitos sonoros');
  $('rotate').textContent = `Girar: ${S.horiz ? 'horizontal' : 'vertical'}`;
  $('start').disabled = !allPlaced(cur()) || !live();
  $('confirm').hidden = S.dlg !== 'confirm';
  $('result').hidden = !(S.phase === 'over' && S.showResult);
  if (S.phase === 'over') {
    const two = S.mode === 2, mineShots = S.foe.shot.filter(Boolean).length, theirShots = S.me.shot.filter(Boolean).length; // mineShots: disparos do Jogador 1 (ou seus)
    $('result').dataset.win = two || S.win ? '1' : '0';
    $('result-t').textContent = two ? `Jogador ${S.win ? 1 : 2} venceu!` : S.win ? 'Vitória!' : 'Derrota';
    $('result-p').textContent = two
      ? `O Jogador ${S.win ? 1 : 2} afundou toda a frota adversária em ${S.win ? mineShots : theirShots} disparos (o outro fez ${S.win ? theirShots : mineShots}).`
      : `${S.win ? 'Você afundou toda a frota inimiga' : 'Sua frota foi afundada'} em ${mineShots} disparos seus e ${theirShots} do inimigo.`;
  }
  /* pausa / ajuda / partida retomada / contagem sobre os mares */
  const paused = Boolean(S.pause), help = S.pause === 'help', rec = S.pause === 'recovered';
  $('veil').hidden = !paused;
  $('panel-pause').hidden = !(paused && !help); $('panel-help').hidden = !help;
  $('panel-pause').classList.toggle('is-recovered', rec);
  $('pause-title').textContent = rec ? 'Partida retomada' : 'Pausa';
  $('pause-text').textContent = rec ? 'Sua partida foi salva. Continue de onde parou.' : 'A partida está congelada até você continuar.';
  const pb = $('pause-btn');
  pb.classList.toggle('is-paused', paused); pb.disabled = !S.started || S.phase === 'over';
  pb.setAttribute('aria-label', paused ? 'Continuar partida' : 'Pausar partida'); pb.dataset.tip = paused ? 'Continuar (P)' : 'Pausar (P)';
  $('help-button').setAttribute('aria-expanded', help ? 'true' : 'false');
  const key = S.handoff ? 'handoff' : S.pause ? `pause:${S.pause}` : '';
  if (S.focusKey !== null && key !== S.focusKey) { const el = { 'pause:manual': $('resume-btn'), 'pause:recovered': $('resume-btn'), 'pause:help': $('help-close'), handoff: $('handoff-ok') }[key]; if (el) el.focus({ preventScroll: true }); }
  S.focusKey = key;
  persist();
}

/* ===== Entradas ===== */
function init() {
  if (SAVED.level) S.level = SAVED.level;
  if (SAVED.mode) S.mode = SAVED.mode;
  build('me'); build('foe');
  S.me.ships.forEach((s, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.innerHTML = `<span class="pp">${'<i></i>'.repeat(s.l)}</span><span>${s.n}</span>`; b.setAttribute('aria-label', `${s.n}, ${s.l} casas`);
    b.addEventListener('click', () => { if (!live()) return; const sh = cur().ships[i]; sh.cells = null; S.sel = i; S.msg = `${sh.n}: escolha onde posicioná-lo.`; render(); });
    $('pick').appendChild(b); pickBtns.push(b);
  });
  const cellOf = (e) => e.target.closest && e.target.closest('.c, button[data-i]');
  $('board-me').addEventListener('click', (e) => { const c = cellOf(e); if (!c) return; if (S.phase === 'setup') placeAt(Number(c.dataset.i)); else playerFire(Number(c.dataset.i), 'me'); }); // 'me' só recebe disparo no 2P (vez do Jogador 2)
  $('board-foe').addEventListener('click', (e) => { const c = cellOf(e); if (c) playerFire(Number(c.dataset.i), 'foe'); });
  const hover = (e) => { const c = cellOf(e); if (c && S.phase === 'setup') { S.hover = Number(c.dataset.i); paint('me'); } };
  $('board-me').addEventListener('mouseover', hover); $('board-me').addEventListener('focusin', hover);
  $('board-me').addEventListener('mouseleave', () => { S.hover = -1; paint('me'); });
  ['me', 'foe'].forEach((side) => $('board-' + side).addEventListener('keydown', (e) => { // setas movem o foco
    const c = cellOf(e); if (!c) return;
    const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -N, ArrowDown: N }[e.key]; if (!d) return;
    const i = Number(c.dataset.i), j = i + d;
    if (j >= 0 && j < N * N && !((d === -1 && i % N === 0) || (d === 1 && i % N === N - 1))) { const t = cells[side][j]; if (!t.disabled) t.focus(); }
    e.preventDefault();
  }));
  document.querySelectorAll('.levels button').forEach((el) => el.addEventListener('click', () => setLevel(el.dataset.level)));
  document.querySelectorAll('.start-modes button').forEach((el) => el.addEventListener('click', () => setMode(Number(el.dataset.mode))));
  $('start-screen').addEventListener('click', (e) => { if (!e.target.closest('.start-modes')) begin(); }); // os seletores não iniciam a partida
  $('handoff-ok').addEventListener('click', () => { S.handoff = null; render(); }); // confirmação explícita: só agora o posicionamento do próximo jogador aparece
  $('pause-btn').addEventListener('click', togglePause);
  $('help-button').addEventListener('click', () => { if (S.pause === 'help') closeHelp(); else openHelp(); });
  $('resume-btn').addEventListener('click', resume);
  $('help-close').addEventListener('click', closeHelp);
  $('pause-restart').addEventListener('click', () => reset(true)); // descarta a partida e volta à tela inicial
  const rotate = () => { if (live() && S.phase === 'setup') { S.horiz = !S.horiz; render(); } };
  $('rotate').addEventListener('click', rotate);
  $('random').addEventListener('click', () => { if (live() && S.phase === 'setup') { randomFleet(cur()); S.sel = null; S.msg = 'Frota posicionada aleatoriamente. Inicie ou ajuste.'; render(); } });
  $('clear').addEventListener('click', () => { if (live() && S.phase === 'setup') { cur().ships.forEach((s) => { s.cells = null; }); S.sel = 0; S.msg = 'Frota removida. Posicione novamente.'; render(); } });
  $('start').addEventListener('click', startBattle);
  $('quit-button').addEventListener('click', () => { if (S.phase === 'setup') { reset(true); return; } S.dlg = 'confirm'; render(); $('no').focus(); });
  $('yes').addEventListener('click', () => reset(true));
  $('no').addEventListener('click', () => { S.dlg = null; render(); });
  $('again').addEventListener('click', () => reset());
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const onBtn = e.target && e.target.closest && e.target.closest('button');
    if (e.code === 'Escape') { if (S.pause === 'help') closeHelp(); else if (S.dlg) { S.dlg = null; render(); } else if (S.started && !S.pause) pauseGame('manual'); return; }
    if ((e.code === 'Space' || e.code === 'Enter') && !onBtn) {
      if (!S.started) { e.preventDefault(); begin(); } else if (e.code === 'Space' && (S.pause === 'manual' || S.pause === 'recovered')) { e.preventDefault(); resume(); }
      return;
    }
    if (!S.started) return;
    if (e.code === 'KeyP') togglePause(); else if (e.code === 'KeyR') rotate();
  });
  $('mute').addEventListener('click', () => { Sound.setMuted(!Sound.muted); render(); });
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button');
    if (b && !b.classList.contains('c') && b.id !== 'mute') Sound.play('click');
    if (b && e.detail && b.id !== 'start' && !b.closest('.pick')) b.blur();   // clique/toque não deixa foco preso: SPACE continua iniciando
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) onAway(); });
  window.addEventListener('pagehide', onAway);
  /* Tooltips: o atraso de 0,3 s é do CSS (--tip-delay); aqui só se esconde o balão ao clicar/ativar até o mouse sair ou o foco se perder */
  document.querySelectorAll('[data-tip]').forEach((el) => {
    el.addEventListener('click', () => el.classList.add('tip-off'));
    el.addEventListener('pointerleave', () => el.classList.remove('tip-off'));
    el.addEventListener('blur', () => { if (!el.matches(':hover')) el.classList.remove('tip-off'); });
  });
  document.addEventListener('pointerdown', () => Sound.unlock());
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  if (SAVED.game) { restore(SAVED.game); render(); } else reset(); // partida salva volta pausada, aguardando o jogador
}
init();
window.__bn = { S, cur, mine, theirs, setMode, live, reset, pauseGame, resume, openHelp, closeHelp, togglePause, onAway, begin, N, span, canPlace, randomFleet, newBoard, fire, aiPick, allSunk, sunk, playerFire, startBattle, aiTurn, cells, Sound };