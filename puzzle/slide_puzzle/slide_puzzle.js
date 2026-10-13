'use strict';
/* Slide Puzzle · Arcádia. Fonte única de verdade: o objeto S. O DOM só reflete S (função render). */
/* ===== Fases, dificuldades e lógica do tabuleiro (antes em slide_puzzle_levels.js; juntado aqui para o projeto ter só 3 arquivos JS) =====
   Modo Livre (DIFFICULTIES): easy 3×3, medium 4×4, hard 5×5, cada um com seus passos de embaralhamento.
   Modo Fases (1..COUNT = 40) em duas páginas de 20: fases 1-20 usam NÚMEROS e fases 21-40 usam IMAGENS (a fase 21 usa a ilustração 0, e assim por diante).
   Cada página tem a mesma curva: três faixas de tamanho, e dentro de cada faixa o embaralhamento (steps) e a distância mínima da solução (minDist)
   crescem fase a fase: posições 1-6 -> 3×3, 7-13 -> 4×4, 14-20 -> 5×5. A fase N+1 libera ao concluir a fase N (isUnlocked), então as imagens
   só abrem depois da fase 20.
   Lógica do tabuleiro (sem DOM): solvedBoard, isSolved, distance, neighbors, shuffled. */
const Levels = (() => {
  const PAGE = 20, COUNT = PAGE * 2;      // precisa bater com LEVEL_COUNT (storage); a 2ª página usa as PAGE ilustrações de SlidePuzzleImages
  const DIFFICULTIES = Object.freeze({
    easy:   Object.freeze({ n: 3, steps: 120, minDist: 12 }),
    medium: Object.freeze({ n: 4, steps: 240, minDist: 24 }),
    hard:   Object.freeze({ n: 5, steps: 400, minDist: 44 }),
  });
  const TIERS = Object.freeze([
    Object.freeze({ from: 1,  to: 6,  n: 3, steps: [40, 130],  minDist: [4, 12] }),
    Object.freeze({ from: 7,  to: 13, n: 4, steps: [100, 260], minDist: [12, 26] }),
    Object.freeze({ from: 14, to: 20, n: 5, steps: [220, 420], minDist: [24, 44] }),
  ]);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (r, t) => Math.round(r[0] + (r[1] - r[0]) * t);

  // Parâmetros da fase: { stage, n (lado do tabuleiro), steps, minDist }
  function get(level) {
    const stage = clamp(Math.round(Number(level)) || 1, 1, COUNT), pos = ((stage - 1) % PAGE) + 1;   // pos = posição dentro da página
    const tier = TIERS.find((t) => pos <= t.to), t = (pos - tier.from) / (tier.to - tier.from);
    return { stage, n: tier.n, steps: lerp(tier.steps, t), minDist: lerp(tier.minDist, t) };
  }

  const isImage = (stage) => stage > PAGE;           // 2ª página = fases com imagem
  const artIndex = (stage) => stage - PAGE - 1;      // ilustração da fase com imagem (0..PAGE-1)

  // done = array de booleanos por fase (do storage). A fase 1 é sempre liberada.
  const isUnlocked = (level, done) => level <= 1 || (level <= COUNT && done[level - 2] === true);

  /* ---- tabuleiro ---- */
  const solvedBoard = (n) => Array.from({ length: n * n }, (_, i) => (i === n * n - 1 ? 0 : i + 1));
  function isSolved(b) { return b.every((v, i) => v === (i === b.length - 1 ? 0 : i + 1)); }
  function distance(b, n) {
    let d = 0;
    b.forEach((v, i) => { if (v) { const t = v - 1; d += Math.abs(Math.floor(i / n) - Math.floor(t / n)) + Math.abs((i % n) - (t % n)); } });
    return d;
  }
  function neighbors(e, n) {
    const r = Math.floor(e / n), c = e % n, out = [];
    if (r > 0) out.push(e - n); if (r < n - 1) out.push(e + n);
    if (c > 0) out.push(e - 1); if (c < n - 1) out.push(e + 1);
    return out;
  }

  /* Parte do estado resolvido e aplica movimentos válidos aleatórios (sempre solucionável).
     cfg = { n, steps, minDist } (uma dificuldade ou get(fase)); avoid = configurações (arrays) que não podem se repetir.
     Se nenhuma tentativa atingir minDist, devolve a mais embaralhada que encontrou. */
  function shuffled(cfg, avoid = []) {
    const { n, steps, minDist } = cfg;
    const same = (b) => avoid.some((a) => a && a.length === b.length && a.every((v, i) => v === b[i]));
    let best = null, bestDist = -1;
    for (let attempt = 0; attempt < 100; attempt++) {
      const b = solvedBoard(n); let e = b.length - 1, prev = -1;
      for (let s = 0; s < steps; s++) {
        let opts = neighbors(e, n);
        if (opts.length > 1) opts = opts.filter((i) => i !== prev);
        const t = opts[Math.floor(Math.random() * opts.length)];
        b[e] = b[t]; b[t] = 0; prev = e; e = t;
      }
      if (isSolved(b) || same(b)) continue;
      const d = distance(b, n);
      if (d >= minDist) return b;
      if (d > bestDist) { best = b; bestDist = d; }
    }
    if (best) return best;
    const b = solvedBoard(n); b[b.length - 1] = b[b.length - 2]; b[b.length - 2] = 0; return b; // reserva: um movimento
  }

  return Object.freeze({ COUNT, PAGE, DIFFICULTIES, get, isImage, artIndex, isUnlocked, solvedBoard, isSolved, distance, neighbors, shuffled });
})();
const Images = SlidePuzzleImages;     // arte das fases + imagem do usuário (slide_puzzle_images.js)
const LEVELS = Levels.DIFFICULTIES;   // modo Livre: easy | medium | hard
const START_GUARD_MS = 450;
const W = 288, H = 512, MARGIN = 6, MAX_CSS_HEIGHT = 1000;
const $ = (id) => document.getElementById(id);
const ui = {
  arena: $('arena'), stage: $('stage'), grid: $('grid'), moves: $('moves'), time: $('time'), best: $('best'),
  status: $('status'), mute: $('mute-button'), pause: $('pause-button'), confirmText: $('confirm-text'),
  levels: [...document.querySelectorAll('.levels button')],
  lvlGrid: $('lvl-grid'), homeInfo: $('home-info'), homeBar: $('home-bar'), titleTop: document.querySelector('.game-title .title-top'),
  wonStage: $('won-stage'), nextButton: $('next-button'), againButton: $('again-button'), countNum: $('count-num'), pauseNote: $('pause-note'),
  board: document.querySelector('.board'), peekBtn: $('peek-button'), imgPick: $('img-upload'), imgThumb: $('img-thumb'), imgTitle: $('img-title'), imgSub: $('img-sub'),
  imgTools: $('img-tools'), mix: $('mix-toggle'), mixSub: $('mix-sub'), tabNum: $('tab-num'), tabImg: $('tab-img'), fileInput: $('file-input'), cropRange: $('crop-range'), cropFit: $('crop-fit'),
  frame: $('frame'), helpBody: $('help-body'), helpButton: $('help-button'), helpPopover: $('help-popover'), helpClose: $('help-close'),
};

const S = {
  level: 'medium', stage: 1, n: 4, board: [], initial: [], moves: 0,
  status: 'home',             // home (tela inicial) | menu (escolha de fase) | ready (ajuste do modo Livre) | playing | paused | countdown (3-2-1-GO!) | won
  mode: 'free',               // free (Livre: dificuldade em level) | levels (Fases: fase em stage)
  elapsed: 0, t0: 0, readyAt: 0, pending: null, muted: false, isRecord: false, tiles: new Map(),
  resumeNote: false,          // mostra "Partida retomada" na tela de pausa (após F5 ou ao voltar à aba)
  go: false, cd: null, goT: null,
  look: 'num',                // estilo do tabuleiro da rodada: 'num' | 'art:<i>' (ilustração) | 'custom' (imagem do usuário)
  mix: false, menuPage: 0,    // modo Infinito: sorteia o estilo a cada partida | página do menu de fases (0 = números, 1 = imagens)
  imgNote: '',                // aviso curto sob "Enviar imagem" (ex.: arquivo inválido)
  customUrl: null,            // imagem do usuário (modo Livre): data URI JPEG quadrado ou null (= números)
  imgVer: 0, imgKey: '',      // imgKey identifica a imagem do tabuleiro montado (muda -> reconstrói as peças)
  srcImg: null, cropping: false,   // imagem original (só na sessão) e editor de recorte aberto
};
let booted = false;           // só persiste depois da inicialização/recuperação

/* ===== Armazenamento (nunca pode quebrar o jogo) ===== */
// Persistência: tudo passa por slide_puzzle_storage.js (SlidePuzzleStorage): level, muted, melhor resultado por dificuldade e progresso das fases.
const loadBest = () => (S.mode === 'levels' ? SlidePuzzleStorage.getLevels().best[S.stage - 1] : SlidePuzzleStorage.getBest(S.level));
const isBetter = (a, b) => !b || a.moves < b.moves || (a.moves === b.moves && a.time < b.time);

/* ===== Áudio (Web Audio, sem arquivos externos) ===== */
const Sound = (() => {
  let ctx = null, master = null, off = false;
  S.muted = SlidePuzzleStorage.isMuted();
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
  return {
    unlock() { if (!S.muted) { try { ensure(); } catch (e) {} } },
    move() { tone(330, 460, 0.07); },
    blocked() { tone(150, 120, 0.09, 'square', 0.18); },
    tick() { tone(440, 440, 0.09, 'triangle', 0.35); },
    go() { tone(660, 990, 0.2, 'square', 0.3); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.16, 'square', 0.3, i * 0.11)); },
  };
})();

/* ===== Lógica do tabuleiro (em slide_puzzle_levels.js: isSolved, neighbors, shuffled...) ===== */
const { isSolved, neighbors } = Levels;
// Parâmetros da partida atual: a fase (modo Fases) ou a dificuldade (modo Livre)
const currentCfg = () => (S.mode === 'levels' ? Levels.get(S.stage) : LEVELS[S.level]);
const AWAY = ['home', 'menu', 'ready'];
/* Estilo do tabuleiro (S.look): 'num' = peças com número; 'art:i' = ilustração i; 'custom' = imagem do usuário.
   Fases: a página 1 (fases 1-20) é número e a página 2 (21-40) é imagem. Infinito: com "misturar" ligado cada partida sorteia o estilo;
   desligado usa a imagem do usuário (se houver) ou números. */
const isArt = (look) => typeof look === 'string' && look.startsWith('art:');
const imgKey = () => (S.look === 'custom' ? `custom:${S.imgVer}` : isArt(S.look) ? S.look : '');
const imageUrl = () => (S.look === 'custom' ? S.customUrl : isArt(S.look) ? Images.artUrl(Number(S.look.slice(4))) : null);
const lookName = () => (S.look === 'custom' ? 'Sua imagem' : isArt(S.look) ? Images.name(Number(S.look.slice(4))) : '');
function pickLook() {
  if (S.mode === 'levels') return Levels.isImage(S.stage) ? `art:${Levels.artIndex(S.stage)}` : 'num';
  if (!S.mix) return S.customUrl ? 'custom' : 'num';
  if (Math.random() < 0.5) return 'num';                                   // sorteio: 50% números, 50% imagem
  const pool = Array.from({ length: Images.COUNT }, (_, i) => `art:${i}`); if (S.customUrl) pool.push('custom');
  const opts = pool.filter((x) => x !== S.look);                           // não repete a imagem da rodada anterior
  return opts[Math.floor(Math.random() * opts.length)];
}   // telas fora da partida: início, escolha de fase e ajuste do modo Livre

/* ===== Tempo ===== */
const elapsedNow = () => (S.status === 'playing' ? S.elapsed + performance.now() - S.t0 : S.elapsed);
const fmt = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function cancelCountdown() { clearTimeout(S.cd); clearTimeout(S.goT); S.cd = S.goT = null; S.go = false; }
/* Congela a partida: o tempo para e qualquer contagem regressiva em curso é cancelada */
function pauseTimer() {
  if (S.status === 'playing') { S.elapsed = elapsedNow(); S.status = 'paused'; }
  else if (S.status === 'countdown') S.status = 'paused';
  cancelCountdown();
}
function showCount(text) {
  ui.countNum.textContent = text; ui.countNum.style.animation = 'none'; void ui.countNum.offsetWidth; ui.countNum.style.animation = '';
}
/* Retomada: 3 → 2 → 1 → GO!. Durante a contagem ninguém joga e o tempo continua congelado */
function startCountdown() {
  if (S.status !== 'paused' || S.pending) return;
  S.status = 'countdown'; S.resumeNote = false; let i = 0;
  const seq = ['3', '2', '1'];
  const step = () => {
    if (S.status !== 'countdown') return;
    if (i < seq.length) { showCount(seq[i++]); Sound.tick(); S.cd = setTimeout(step, 800); return; }
    S.status = 'playing'; S.t0 = performance.now(); S.go = true; showCount('GO!'); Sound.go();
    S.goT = setTimeout(() => { S.go = false; render(); }, 650);
    render();
  };
  step(); render();
}
/* Persistência da partida em andamento (um único objeto em SlidePuzzleStorage) */
function persist() {
  if (!booted) return;
  if (AWAY.includes(S.status)) { SlidePuzzleStorage.clearGame(); return; }
  SlidePuzzleStorage.setGame({ mode: S.mode, stage: S.stage, level: S.level, board: S.board, initial: S.initial, moves: S.moves, elapsed: elapsedNow(),
    status: S.status === 'countdown' ? 'paused' : S.status, isRecord: S.isRecord, look: S.look });
}

/* ===== Ações ===== */
function moveAt(i) {
  if (S.status !== 'playing' || S.pending) return false;
  const e = S.board.indexOf(0);
  if (!neighbors(e, S.n).includes(i)) { Sound.blocked(); return false; }
  S.board[e] = S.board[i]; S.board[i] = 0; S.moves++;
  if (isSolved(S.board)) win(); else Sound.move();
  render();
  return true;
}
/* Começa uma rodada na fase/dificuldade atual: sorteia um tabuleiro novo (diferente do anterior), zera movimentos e tempo e já joga.
   É o que o "Novo jogo" faz: sem confirmação e sem passar pela tela inicial. Também serve ao início das partidas e à "Próxima fase". */
function newRound() {
  cancelCountdown(); S.resumeNote = false; S.pending = null; S.isRecord = false;
  S.look = pickLook(); if (imgKey() !== S.imgKey || !S.tiles.size) buildBoard();   // Infinito com mistura: o estilo pode mudar a cada partida
  S.initial = Levels.shuffled(currentCfg(), [S.board, S.initial]); S.board = S.initial.slice(); S.moves = 0;
  S.status = 'playing'; S.elapsed = 0; S.t0 = performance.now();
  Sound.unlock(); render();
}
/* Toque inicial (tela do modo Livre): começa a partida e o cronômetro; nenhuma peça é movida */
function beginPlay() {
  if (S.status !== 'ready' || S.pending || S.cropping || performance.now() - S.readyAt < START_GUARD_MS) return; // ignora toque duplo logo após abrir a tela
  newRound();
}
function win() {
  cancelCountdown(); S.elapsed = elapsedNow(); S.status = 'won';
  const result = { moves: S.moves, time: Math.round(S.elapsed) };
  S.isRecord = isBetter(result, loadBest());
  if (S.mode === 'levels') SlidePuzzleStorage.setLevelResult(S.stage, result);   // conclui a fase (libera a próxima) e guarda o melhor resultado
  else if (S.isRecord) SlidePuzzleStorage.setBest(S.level, result);
  Sound.win();
}
function buildBoard() {
  S.tiles.clear(); ui.grid.textContent = ''; ui.grid.style.setProperty('--n', S.n);
  const url = imageUrl(); S.imgKey = imgKey();
  ui.grid.classList.toggle('has-img', Boolean(url));
  if (url) ui.board.style.setProperty('--img', `url("${url}")`); else ui.board.style.removeProperty('--img');   // a imagem fica numa variável CSS só (não repete a string em cada peça)
  // Cada peça mostra a fatia da imagem que pertence ao lugar de origem dela (linha --hr, coluna --hc)
  const pic = (v) => `<span class="clip"><i class="pic" style="--hr:${Math.floor((v - 1) / S.n)};--hc:${(v - 1) % S.n}"></i></span>`;
  for (let i = 0; i < S.n * S.n; i++) {
    const s = document.createElement('div'); s.className = 'cell slot';
    s.style.setProperty('--r', Math.floor(i / S.n)); s.style.setProperty('--c', i % S.n);
    s.innerHTML = '<span class="face"></span>'; ui.grid.appendChild(s);
  }
  for (let v = 1; v < S.n * S.n; v++) {
    const t = document.createElement('button'); t.type = 'button'; t.className = 'cell tile'; t.dataset.v = v;
    t.tabIndex = -1; t.setAttribute('aria-label', `Peça ${v}`); t.innerHTML = `<span class="face">${url ? pic(v) : v}</span>`;
    ui.grid.appendChild(t); S.tiles.set(v, t);
  }
  if (url) {   // a última fatia (canto inferior direito) fica escondida até o quebra-cabeça ser resolvido
    const r = document.createElement('div'); r.className = 'cell reveal'; r.style.setProperty('--r', S.n - 1); r.style.setProperty('--c', S.n - 1);
    r.innerHTML = `<span class="face">${pic(S.n * S.n)}</span>`; ui.grid.appendChild(r);
  }
}
/* Reiniciar: volta à configuração inicial da partida atual (S.initial, guardada ao começar) e já começa a contar.
   Funciona em qualquer momento da partida (jogando, pausado, em contagem ou após vencer), mesmo sem nenhum movimento. */
function restartGame() {
  if (!S.initial.length || AWAY.includes(S.status)) return;
  cancelCountdown(); S.resumeNote = false;
  S.board = S.initial.slice(); S.moves = 0; S.elapsed = 0; S.t0 = performance.now();
  S.status = 'playing'; S.pending = null; S.isRecord = false;
  render();
}
/* Prepara a dificuldade (Livre) ou a fase (Fases): ajusta o tamanho do tabuleiro e sorteia uma configuração. Não muda a tela. */
function select(mode, key) {
  cancelCountdown(); S.resumeNote = false; S.pending = null;
  if (mode === 'levels') { S.mode = 'levels'; S.stage = Levels.get(key).stage; }
  else { S.mode = 'free'; S.level = LEVELS[key] ? key : 'medium'; SlidePuzzleStorage.setLevel(S.level); }
  const cfg = currentCfg();
  S.look = pickLook();
  const resize = cfg.n !== S.n || !S.tiles.size || imgKey() !== S.imgKey;
  S.n = cfg.n;
  S.initial = Levels.shuffled(cfg, [S.board, S.initial]); S.board = S.initial.slice();
  S.moves = 0; S.elapsed = 0; S.isRecord = false; S.readyAt = performance.now();
  if (resize) buildBoard();
}
/* Navegação entre as telas: início -> (Fases: menu -> partida) | (Livre: ajuste -> partida). Sair da partida apaga a partida salva. */
function goHome() { cancelCountdown(); S.pending = null; S.cropping = false; S.resumeNote = false; S.status = 'home'; render(); }
function openMenu() {
  const next = SlidePuzzleStorage.getLevels().done.findIndex((d) => !d) + 1;   // abre na página da próxima fase a jogar
  S.menuPage = next > Levels.PAGE ? 1 : 0; S.status = 'menu'; render();
}
function openFree() { select('free', S.level); S.status = 'ready'; render(); }
function startLevel(stage) { select('levels', stage); newRound(); }
/* Menu de fases: duas páginas de 20 botões (página 1 = números, página 2 = imagens). Os mesmos 20 botões são reaproveitados nas duas páginas
   (renderMenu troca número, tamanho e estado). A fase só abre depois de concluir a anterior. */
function buildMenu() {
  ui.lvlGrid.textContent = '';
  for (let k = 0; k < Levels.PAGE; k++) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'lvl';
    b.innerHTML = `<b></b><i></i><svg class="lvl-check" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg><svg class="lvl-lock" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" fill="currentColor"/><path d="M5.5 7V5.5a2.5 2.5 0 015 0V7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
    ui.lvlGrid.appendChild(b);
  }
}
function renderMenu(lv) {
  const P = Levels.PAGE, base = S.menuPage * P, next = lv.done.findIndex((d) => !d) + 1;   // next = primeira fase ainda não concluída (0 = todas concluídas)
  const count = (p) => lv.done.slice(p * P, p * P + P).filter(Boolean).length;
  [[ui.tabNum, 0, 'Números'], [ui.tabImg, 1, 'Imagens']].forEach(([el, p, label]) => {
    el.setAttribute('aria-selected', S.menuPage === p); el.tabIndex = S.menuPage === p ? 0 : -1;
    el.innerHTML = `${label} <i>${count(p)}/${P}</i>`;
  });
  [...ui.lvlGrid.children].forEach((b, k) => {
    const i = base + k + 1, n = Levels.get(i).n, open = Levels.isUnlocked(i, lv.done), best = lv.best[i - 1], done = lv.done[i - 1], img = Levels.isImage(i);
    const art = img ? Images.name(Levels.artIndex(i)) : '';
    b.dataset.stage = i; b.style.setProperty('--t', (k / (P - 1)).toFixed(3));
    b.firstChild.textContent = i; b.querySelector('i').textContent = `${n}×${n}`;
    b.classList.toggle('is-locked', !open); b.classList.toggle('is-done', done); b.classList.toggle('is-next', i === next);
    if (done && img) { b.style.setProperty('--art', `url("${Images.artUrl(Levels.artIndex(i))}")`); b.dataset.art = '1'; }   // fase de imagem concluída mostra a imagem conquistada
    else { b.style.removeProperty('--art'); delete b.dataset.art; }
    b.setAttribute('aria-disabled', !open);
    b.setAttribute('aria-label', `Fase ${i}, ${img ? 'imagem' : 'números'}, ${n} por ${n}${!open ? ', bloqueada' : done ? ', concluída' : ''}`);
    b.dataset.tip = !open ? `Conclua a fase ${i - 1} para liberar` : best ? `Fase ${i}${art ? ` · ${art}` : ''} · melhor: ${best.moves} mov · ${fmt(best.time)}` : `Fase ${i} · ${n}×${n}${img ? ' · imagem' : ''}`;
  });
}
function renderMix() {
  ui.mix.setAttribute('aria-checked', S.mix);
  ui.mixSub.textContent = S.mix ? 'Cada partida sorteia números ou uma imagem' : 'Desligado: números (ou sua imagem)';
}

/* ===== Imagem do usuário (modo Livre): enviar -> recorte automático -> (opcional) ajustar no editor ===== */
let cropper = null;
function renderImgRow() {
  const has = Boolean(S.customUrl);
  ui.imgPick.classList.toggle('has-image', has);
  ui.imgThumb.style.setProperty('--thumb', has ? `url("${S.customUrl}")` : 'none');
  ui.imgTitle.textContent = has ? 'Sua imagem' : 'Enviar imagem';
  ui.imgSub.textContent = S.imgNote || (has ? 'Toque para trocar' : 'Use uma foto no tabuleiro');
  ui.imgSub.classList.toggle('is-error', Boolean(S.imgNote));
  ui.imgTools.hidden = !has;
  ui.imgPick.setAttribute('aria-label', has ? 'Trocar imagem' : 'Enviar imagem');
}
// Aplica a imagem nova/removida ao tabuleiro do modo Livre (sorteia um tabuleiro novo; ainda estamos na tela de ajuste)
function refreshPicture() { select('free', S.level); S.readyAt = -START_GUARD_MS; renderImgRow(); render(); }
function setCustom(url) {
  if (url) { SlidePuzzleStorage.setImage(url); S.customUrl = url; } else { SlidePuzzleStorage.clearImage(); S.customUrl = null; S.srcImg = null; }
  S.imgVer++; S.imgNote = ''; refreshPicture();
}
async function onFile(file) {
  if (!file) return;
  try {
    const img = await Images.loadFile(file);
    S.srcImg = img; setCustom(Images.autoSquare(img));          // recorte automático já aplicado
    const r = Images.ratio(img);
    if (r > 1.6 || r < 1 / 1.6) openCrop();                      // proporção muito diferente de um quadrado: abre o editor
  } catch (e) { S.imgNote = e && e.message ? e.message : 'Não foi possível abrir essa imagem'; renderImgRow(); }
}
async function openCrop() {
  if (S.status !== 'ready' || !S.customUrl) return;
  try {
    const img = S.srcImg || await Images.loadSrc(S.customUrl);   // sem o original (após F5), ajusta a versão já recortada
    const lim = cropper.load(img);
    ui.cropRange.min = lim.min; ui.cropRange.max = lim.max; ui.cropRange.value = 1;
    ui.cropFit.hidden = lim.min > 0.98;
    S.cropping = true; render();
  } catch (e) { S.imgNote = 'Não foi possível abrir essa imagem'; renderImgRow(); }
}
function closeCrop(apply) {
  if (!S.cropping) return;
  const url = apply ? cropper.export() : null;
  S.cropping = false;
  if (url) { setCustom(url); } else render();
}

/* Pede confirmação quando há progresso a perder. A partida fica pausada; ao cancelar, volta à tela de pausa
   (retomar sempre exige uma ação explícita e a contagem 3-2-1) */
function ask(text, action) {
  if (S.moves === 0 || S.status === 'won') { action(); return; }
  pauseTimer(); S.pending = action; ui.confirmText.textContent = text; render();
}
function answer(yes) {
  const action = S.pending; S.pending = null;
  if (yes && action) action();
  render();
}
function togglePause(wantPause) {
  if (S.pending) return;
  if (wantPause && (S.status === 'playing' || S.status === 'countdown')) { pauseTimer(); render(); }
  else if (!wantPause && S.status === 'paused') startCountdown();
}

/* ===== Renderização ===== */
function render() {
  const { n, board } = S, e = board.indexOf(0), near = new Set(neighbors(e, n)), live = S.status === 'playing';
  board.forEach((v, i) => {
    if (!v) return;
    const t = S.tiles.get(v); if (!t) return;
    t.style.setProperty('--r', Math.floor(i / n)); t.style.setProperty('--c', i % n);
    const can = live && !S.pending && near.has(i);
    t.classList.toggle('can-move', can); t.classList.toggle('is-home', v === i + 1); // v pertence à posição v - 1
  });
  ui.moves.textContent = S.moves; ui.time.textContent = fmt(elapsedNow());
  const b = loadBest(); ui.best.textContent = b ? `${b.moves} · ${fmt(b.time)}` : '—';
  ui.levels.forEach((el) => { const on = el.dataset.level === S.level; el.setAttribute('aria-checked', on); el.tabIndex = on ? 0 : -1; });
  $('won-moves').textContent = S.moves; $('won-time').textContent = fmt(S.elapsed); $('won-record').hidden = !S.isRecord;
  ui.pauseNote.hidden = !S.resumeNote;
  const picName = lookName();
  ui.status.textContent = S.status === 'ready' ? 'O tempo começa quando você iniciar a partida'
    : S.imgKey ? `${picName} · segure o olho para espiar` : `Ordene de 1 a ${n * n - 1}, com o espaço no canto`;
  ui.grid.classList.toggle('is-solved', S.status === 'won');
  if (S.status !== 'playing') ui.board.classList.remove('is-peek');
  const c = ui.stage.classList;
  c.toggle('is-ready', S.status === 'ready'); c.toggle('is-home', S.status === 'home'); c.toggle('is-menu', S.status === 'menu'); c.toggle('is-away', AWAY.includes(S.status));
  c.toggle('is-playing', S.status === 'playing');
  c.toggle('is-paused', S.status === 'paused' && !S.pending); c.toggle('is-confirm', Boolean(S.pending)); c.toggle('is-won', S.status === 'won');
  c.toggle('is-countdown', S.status === 'countdown'); c.toggle('is-go', S.go);
  c.toggle('is-crop', S.cropping); c.toggle('has-pic', Boolean(S.imgKey));
  $('reset-button').disabled = AWAY.includes(S.status); // ainda não há partida iniciada para restaurar
  ui.mute.classList.toggle('is-muted', S.muted); ui.mute.setAttribute('aria-pressed', S.muted);
  ui.mute.setAttribute('aria-label', S.muted ? 'Ativar efeitos sonoros' : 'Silenciar efeitos sonoros');
  ui.mute.dataset.tip = S.muted ? 'Ativar efeitos' : 'Silenciar efeitos';
  ui.titleTop.textContent = S.mode === 'levels' ? `Fase ${S.stage} de ${Levels.COUNT}` : 'Quebra-Cabeça';
  const lvl = S.mode === 'levels', last = S.stage >= Levels.COUNT;
  ui.wonStage.hidden = !lvl; ui.wonStage.textContent = `Fase ${S.stage} de ${Levels.COUNT}`;
  ui.nextButton.hidden = !lvl || last; ui.againButton.classList.toggle('btn-alt', lvl && !last);   // "Próxima fase" é o botão principal
  if (S.status === 'home' || S.status === 'menu') {
    const lv = SlidePuzzleStorage.getLevels();
    const nDone = lv.done.filter(Boolean).length;
    ui.homeInfo.textContent = `${nDone} de ${Levels.COUNT} concluídas`; ui.homeBar.style.width = `${(nDone / Levels.COUNT) * 100}%`;
    if (S.status === 'menu') renderMenu(lv);
  }
  persist();
}
function toggleMute() { S.muted = !S.muted; SlidePuzzleStorage.setMuted(S.muted); if (!S.muted) Sound.unlock(); render(); }
/* O botão "?" fica fora do jogo: ao lado (reserva dos dois lados, para o jogo seguir centralizado) ou, se faltar
   largura, logo abaixo. Escolhe o formato que permite o maior jogo. */
const HELP = { gap: 12, edge: 8, maxWidth: 270, button: 40, side: 18 };
function resizeStage() {
  const aw = Math.max(1, ui.arena.clientWidth - MARGIN * 2), ah = Math.max(1, ui.arena.clientHeight - MARGIN * 2), help = HELP.button + HELP.side;
  let best = { cw: 0, pos: 'side' };
  for (const pos of ['side', 'below']) {
    const w = Math.max(1, aw - (pos === 'side' ? help * 2 : 0)), h = Math.max(1, ah - (pos === 'below' ? help : 0));
    let cw = Math.min(h, MAX_CSS_HEIGHT) * (W / H);
    if (cw > w) cw = w;
    cw = Math.floor(cw);
    if (cw > best.cw) best = { cw, pos };
  }
  const cw = best.cw, ch = Math.floor(cw / (W / H));
  ui.frame.dataset.helpPos = best.pos;
  ui.stage.style.width = `${cw}px`; ui.stage.style.height = `${ch}px`; ui.stage.style.setProperty('--u', `${cw / W}px`);
  placeHelp();     // reposiciona o painel de ajuda, se estiver aberto
}

/* ===== Ajuda "Como jogar": botão "?" escuro fora do palco; popover ancorado abaixo dele, com cabeçalho fixo e corpo rolável =====
   Abrir a ajuda pausa a partida; fechar NÃO retoma: a pausa continua até o jogador tocar em "Continuar" (e vem a contagem 3-2-1). */
let helpOpen = false;
function openHelp() {
  if (helpOpen) return;
  helpOpen = true;
  ui.helpPopover.hidden = false;
  ui.helpButton.setAttribute('aria-expanded', 'true');
  ui.helpBody.scrollTop = 0;
  togglePause(true);                        // só tem efeito durante a partida ou a contagem
  placeHelp();
}
function closeHelp() {
  if (!helpOpen) return;
  helpOpen = false;
  ui.helpPopover.hidden = true;
  ui.helpButton.setAttribute('aria-expanded', 'false');
}
// Abre sempre ABAIXO do botão (com rolagem interna se faltar altura). Só inverte para cima quando o botão
// está sob o jogo (celular), onde pode não sobrar espaço embaixo.
function updateHelpMore() { const b = ui.helpBody; b.classList.toggle('has-more', b.scrollHeight - b.scrollTop - b.clientHeight > 2); }
function placeHelp() {
  if (!helpOpen) return;
  const pop = ui.helpPopover;
  pop.style.removeProperty('max-height');
  const arena = ui.arena.getBoundingClientRect();
  const btn = ui.helpButton.getBoundingClientRect();
  const width = Math.floor(Math.min(HELP.maxWidth, arena.width - HELP.edge * 2));
  const left = Math.max(arena.left + HELP.edge, Math.min(btn.left, arena.right - HELP.edge - width));
  pop.style.width = `${width}px`;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.setProperty('--arrow-x', `${Math.round(Math.min(Math.max(btn.left + btn.width / 2 - left, 16), width - 16))}px`);
  const height = pop.offsetHeight;
  const roomBelow = window.innerHeight - btn.bottom - HELP.gap - HELP.edge;
  const roomAbove = btn.top - HELP.gap - HELP.edge;
  let placement = 'below';
  if (ui.frame.dataset.helpPos !== 'side' && height > roomBelow && roomAbove > roomBelow) placement = 'above';
  const room = placement === 'below' ? roomBelow : roomAbove;
  if (height > room) pop.style.maxHeight = `${Math.max(120, Math.floor(room))}px`;   // só o corpo rola; título e fechar ficam fixos
  const finalHeight = pop.offsetHeight;
  pop.style.top = `${Math.round(placement === 'below' ? btn.bottom + HELP.gap : btn.top - HELP.gap - finalHeight)}px`;
  pop.dataset.placement = placement;
  updateHelpMore();
}

/* ===== Tooltips: sistema único. Qualquer elemento com data-tip (e data-tip-key opcional) ganha dica.
   Mouse: aparece após var(--tip-delay) de hover e some ao sair/clicar. Teclado (:focus-visible): aparece na hora.
   Toque: nunca aparece (não depende de hover, nada fica preso). O elemento #tip fica no body e é posicionado
   com limites da janela, então nunca é cortado pelo palco. ===== */
const Tip = (() => {
  const el = document.createElement('div'); el.id = 'tip'; el.className = 'tip'; el.setAttribute('role', 'tooltip'); document.body.appendChild(el);
  let cur = null, timer = 0, quiet = null;   // quiet: alvo clicado; só volta a mostrar depois que o ponteiro sair dele
  const delay = () => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--tip-delay').trim(), n = parseFloat(v);
    return Number.isFinite(n) ? (/ms$/.test(v) ? n : n * 1000) : 300;
  };
  function hide() { clearTimeout(timer); timer = 0; cur = null; el.classList.remove('is-on'); }
  function show(t) {
    const r = t.getBoundingClientRect(); if (!t.isConnected || !r.width || !r.height) return;
    el.textContent = ''; const span = document.createElement('span'); span.textContent = t.dataset.tip; el.appendChild(span);
    if (t.dataset.tipKey) { const k = document.createElement('kbd'); k.textContent = t.dataset.tipKey; el.appendChild(k); }
    const w = el.offsetWidth, h = el.offsetHeight, m = 8, gap = 10;
    const left = Math.min(Math.max(r.left + r.width / 2 - w / 2, m), Math.max(m, window.innerWidth - m - w));
    let place = t.dataset.tipPos === 'bottom' ? 'bottom' : 'top';
    if (place === 'top' && r.top - gap - h < m) place = 'bottom';
    else if (place === 'bottom' && r.bottom + gap + h > window.innerHeight - m && r.top - gap - h >= m) place = 'top';
    el.style.left = `${Math.round(left)}px`; el.style.top = `${Math.round(place === 'top' ? r.top - gap - h : r.bottom + gap)}px`;
    el.style.setProperty('--arrow-x', `${Math.round(Math.min(Math.max(r.left + r.width / 2 - left, 12), w - 12))}px`);
    el.dataset.place = place; cur = t; el.classList.add('is-on');
  }
  const target = (e) => (e.target && e.target.closest ? e.target.closest('[data-tip]') : null);
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;                 // toque/caneta: sem hover
    const t = target(e); if (t && t === cur) return;
    if (t && t === quiet) return;                           // o navegador redispara pointerover quando o layout muda
    hide(); if (!t) return;
    cur = t; timer = setTimeout(() => { timer = 0; show(t); }, delay());
  });
  document.addEventListener('pointerout', (e) => {
    const t = target(e); if (!t || t.contains(e.relatedTarget)) return;
    if (t === quiet) quiet = null; if (t === cur) hide();
  });
  document.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') quiet = target(e); hide(); }, true);
  document.addEventListener('click', hide, true);          // inclui ativação por teclado (Enter/Space)
  document.addEventListener('focusin', (e) => { const t = target(e); if (t && t.matches(':focus-visible')) { hide(); show(t); } });
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', (e) => { if (e.code === 'Escape') hide(); }, true);
  window.addEventListener('scroll', hide, true); window.addEventListener('resize', hide); window.addEventListener('blur', hide);
  document.addEventListener('visibilitychange', hide);
  return { hide, show, el };
})();

/* ===== Entradas ===== */
// Espiar: enquanto o olho (ou a tecla V) estiver pressionado, a imagem completa aparece por cima do tabuleiro. O tempo continua correndo.
const peek = (on) => ui.board.classList.toggle('is-peek', Boolean(on) && S.status === 'playing' && Boolean(S.imgKey));
/* Teclado: Space inicia a partida; M som; P/Esc pausa. As peças se movem apenas por clique/toque. */
function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (helpOpen && e.code === 'Escape') { e.preventDefault(); closeHelp(); ui.helpButton.focus({ preventScroll: true }); return; }
  if (S.cropping) {                                                   // editor de recorte aberto: Esc cancela, Enter confirma
    if (e.code === 'Escape') { e.preventDefault(); closeCrop(false); }
    else if (e.code === 'Enter' && !e.target.closest('button')) { e.preventDefault(); closeCrop(true); }
    return;
  }
  if (e.repeat) return;
  if (e.code === 'KeyV') { peek(true); return; }                       // segurar V espia a imagem completa
  if (e.code === 'Space') {
    if (e.target.closest && e.target.closest('#help-button, #help-close')) return;   // deixa o botão focado agir
    e.preventDefault();
    if (S.status === 'ready') beginPlay();
    else if (S.status === 'paused' && !helpOpen) togglePause(false);      // Space também continua (com contagem)
  }
  else if (e.code === 'KeyM') toggleMute();
  else if (e.code === 'KeyP') togglePause(S.status === 'playing' || S.status === 'countdown');
  else if (e.code === 'Escape') {
    if (S.pending) answer(false);
    else if (S.status === 'menu' || S.status === 'ready') goHome();     // Esc volta uma tela
    else togglePause(S.status === 'playing' || S.status === 'countdown');
  }
}
/* Recupera a partida salva (F5): mesmo tabuleiro, mesmos movimentos e tempo; volta PAUSADA, sem embaralhar */
function restoreGame() {
  const g = SlidePuzzleStorage.getGame();
  if (!g) return false;
  const cfg = g.mode === 'levels' ? Levels.get(g.stage) : LEVELS[g.level];
  if (!cfg || g.board.length !== cfg.n * cfg.n || isSolved(g.board) !== (g.status === 'won')) return false;
  S.mode = g.mode; S.level = g.level; S.stage = g.stage; S.n = cfg.n;
  // estilo da rodada: fases derivam da fase; no Infinito vale o estilo salvo (saves antigos: imagem do usuário, se houver)
  S.look = g.mode === 'levels' ? pickLook() : g.look === 'custom' && !S.customUrl ? 'num' : g.look || (S.customUrl ? 'custom' : 'num'); S.board = g.board.slice(); S.initial = g.initial.slice();
  S.moves = g.moves; S.elapsed = g.elapsed; S.isRecord = g.isRecord; S.pending = null;
  S.status = g.status === 'won' ? 'won' : 'paused'; S.resumeNote = S.status === 'paused';
  buildBoard(); if (g.mode === 'free') SlidePuzzleStorage.setLevel(g.level);
  return true;
}
function init() {
  const saved = SlidePuzzleStorage.getLevel();
  S.level = LEVELS[saved] ? saved : 'medium';
  S.customUrl = SlidePuzzleStorage.getImage(); S.mix = SlidePuzzleStorage.getMix();
  cropper = Images.createCropper($('crop-canvas'), (z) => { ui.cropRange.value = z; });
  buildMenu();
  document.querySelectorAll('.mini').forEach((m) => { const n = Number(m.dataset.n); m.style.setProperty('--n', n); m.innerHTML = '<i></i>'.repeat(n * n); });   // miniatura n×n
  if (!restoreGame()) { select('free', S.level); S.status = 'home'; }   // sem partida salva: abre na tela inicial
  S.readyAt = -START_GUARD_MS; // a proteção contra toque duplo vale só ao abrir a tela do modo Livre, não ao abrir a página
  booted = true; renderImgRow(); renderMix(); render();
  resizeStage();
  ui.grid.addEventListener('click', (e) => {
    const t = e.target.closest('.tile'); if (!t || e.detail === 0) return; // detail 0 = clique gerado por teclado
    Sound.unlock(); moveAt(S.board.indexOf(Number(t.dataset.v))); t.blur();
  });
  $('start-button').addEventListener('click', beginPlay);
  ui.mix.addEventListener('click', () => { if (S.status !== 'ready' || S.cropping) return; S.mix = SlidePuzzleStorage.setMix(!S.mix); renderMix(); });
  [[ui.tabNum, 0], [ui.tabImg, 1]].forEach(([el, p]) => el.addEventListener('click', () => { if (S.status === 'menu' && S.menuPage !== p) { S.menuPage = p; Sound.tick(); render(); } }));
  ui.imgPick.addEventListener('click', () => { if (S.status === 'ready' && !S.cropping) { S.imgNote = ''; ui.fileInput.value = ''; ui.fileInput.click(); } });
  ui.fileInput.addEventListener('change', () => onFile(ui.fileInput.files[0]));
  $('img-adjust').addEventListener('click', openCrop);
  $('img-remove').addEventListener('click', () => { if (S.status === 'ready') setCustom(null); });
  $('crop-ok').addEventListener('click', () => closeCrop(true));
  $('crop-cancel').addEventListener('click', () => closeCrop(false));
  ui.cropFit.addEventListener('click', () => cropper.fit());
  ui.cropRange.addEventListener('input', () => cropper.setZoom(Number(ui.cropRange.value)));
  ui.peekBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); peek(true); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => ui.peekBtn.addEventListener(t, () => peek(false)));
  document.addEventListener('keyup', (e) => { if (e.code === 'KeyV') peek(false); });
  $('card-levels').addEventListener('click', openMenu);
  $('card-free').addEventListener('click', openFree);
  $('back-menu').addEventListener('click', goHome);
  $('back-free').addEventListener('click', goHome);
  ui.levels.forEach((el) => el.addEventListener('click', () => {      // dificuldade do modo Livre (só aparece na tela de ajuste)
    const lv = el.dataset.level; if (lv === S.level || S.status !== 'ready' || S.cropping) return;
    select('free', lv); S.readyAt = -START_GUARD_MS; render();         // trocar a dificuldade não deve atrasar o botão Iniciar
  }));
  ui.lvlGrid.addEventListener('click', (e) => {
    const b = e.target.closest('.lvl'); if (!b || S.status !== 'menu') return;
    if (b.classList.contains('is-locked')) { Sound.blocked(); return; }
    Sound.unlock(); startLevel(Number(b.dataset.stage));
  });
  const confirmRestart = () => ask('Reiniciar volta o tabuleiro à ordem inicial e zera movimentos e tempo. Continuar?', restartGame);
  const newGame = () => { if (!AWAY.includes(S.status)) newRound(); };  // "Novo jogo": instantâneo, na mesma fase/dificuldade
  const goHomeAsk = () => ask('Voltar à tela inicial encerra a partida atual. Continuar?', goHome);
  $('new-button').addEventListener('click', newGame);
  $('again-button').addEventListener('click', newGame);
  $('next-button').addEventListener('click', () => { if (S.mode === 'levels' && S.stage < Levels.COUNT) startLevel(S.stage + 1); });
  $('reset-button').addEventListener('click', confirmRestart);
  $('pause-home').addEventListener('click', goHomeAsk);
  $('won-home').addEventListener('click', goHome);
  $('resume-button').addEventListener('click', () => togglePause(false));
  $('confirm-yes').addEventListener('click', () => answer(true));
  $('confirm-no').addEventListener('click', () => answer(false));
  ui.helpButton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (helpOpen) closeHelp(); else openHelp();
    if (e.detail > 0) ui.helpButton.blur();   // clique/toque: Space não deve acionar o botão depois
  });
  ui.helpBody.addEventListener('scroll', updateHelpMore, { passive: true });
  ui.helpClose.addEventListener('click', (e) => { e.stopPropagation(); closeHelp(); ui.helpButton.focus({ preventScroll: true }); });
  // Um toque fora do popover só o fecha.
  document.addEventListener('pointerdown', (e) => {
    if (helpOpen && !(e.target.closest && e.target.closest('#help-popover, #help-button'))) closeHelp();
  }, true);
  // Depois de um clique/toque, o botão solta o foco: assim Space inicia a partida em vez de reacionar o botão.
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b && e.detail > 0) b.blur(); });
  ui.pause.addEventListener('click', () => { togglePause(true); ui.pause.blur(); });
  ui.mute.addEventListener('click', () => { toggleMute(); ui.mute.blur(); });
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('pointerdown', () => Sound.unlock());
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', () => { peek(false); togglePause(true); });
  // Sair da aba/minimizar pausa e salva; ao voltar, a tela de pausa mostra "Partida retomada" e espera o jogador
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (S.status === 'playing' || S.status === 'countdown' || S.status === 'paused') S.resumeNote = true;
      togglePause(true); render();
    }
  });
  window.addEventListener('pagehide', persist); window.addEventListener('beforeunload', persist);
  window.addEventListener('resize', resizeStage);
  window.addEventListener('orientationchange', resizeStage);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resizeStage);
  let beat = 0;
  setInterval(() => { if (S.status === 'playing') { ui.time.textContent = fmt(elapsedNow()); if (++beat % 20 === 0) persist(); } }, 250);
}
init();

window.__slide = { S, Images, setCustom, onFile, openCrop, closeCrop, peek, shuffled: Levels.shuffled, isSolved, moveAt, select, newRound, goHome, openMenu, openFree, startLevel, neighbors, beginPlay, startCountdown, togglePause, restartGame };