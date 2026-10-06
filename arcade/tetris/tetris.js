/* ==========================================================================
   arcade/tetris/tetris.js - HTML5 Canvas + JavaScript puro
   Sem dependências. Funciona abrindo o arcade/tetris/tetris.html direto no navegador.

   Índice
     1. Configuração (todas as constantes de ajuste estão aqui)
     2. Persistência (recorde e preferência de som)
     3. Áudio (Web Audio API)
     4. Peças (formatos, rotações e "wall kicks" do SRS)
     5. Estado da partida
     6. Regras (movimento, rotação, travamento, linhas, pontuação)
     7. Cenário e sprites
     8. Renderização
     9. Interface
    10. Entrada (teclado e botões de toque)
    11. Layout e redimensionamento
    12. Loop principal e inicialização
   ========================================================================== */

(() => {
  'use strict';

  /* ======================================================================
     1. CONFIGURAÇÃO
     ====================================================================== */
  const CONFIG = {
    board: {
      cols: 10,
      rows: 20,                // linhas visíveis
      hidden: 2,               // linhas extras acima do topo, onde as peças nascem
    },

    // VELOCIDADE DE QUEDA (segundos por linha) = base - (nível-1) * step, elevado a (nível-1).
    // Nível 1 = 1 s por linha; nível 5 ≈ 0,36 s; nível 10 ≈ 0,06 s. Para um jogo mais
    // rápido ou mais lento, aumente ou diminua `base` (ex.: 0.75 = mais rápido).
    speed: {
      base: 0.8,
      step: 0.007,
      minInterval: 0.016,      // piso: nunca cai mais rápido que isso (s por linha)
      softDropInterval: 0.04,  // velocidade com a seta para baixo pressionada
    },

    // DIFICULDADE: a cada N linhas o nível sobe (e a queda acelera)
    level: {
      linesPerLevel: 10,
      maxLevel: 20,
    },

    // PONTUAÇÃO: pontos por linhas eliminadas de uma vez (1, 2, 3, 4) x nível atual
    scoring: {
      lines: [0, 100, 300, 500, 800],
      softDrop: 1,             // pontos por linha descida acelerando
      hardDrop: 2,             // pontos por linha descida na queda instantânea
    },

    // MOVIMENTO LATERAL SEGURANDO A TECLA / BOTÃO
    input: {
      dasDelay: 0.16,          // espera antes de começar a repetir (s)
      dasRepeat: 0.05,         // intervalo entre repetições (s)
    },

    timing: {
      maxFrameTime: 1 / 20,    // limite do delta time (aba em segundo plano, travadas)
      clearTime: 0.28,         // duração da animação de linhas eliminadas (s)
      gameOverDelay: 0.9,      // espera até mostrar o painel e aceitar reinício (s)
    },

    audio: {
      masterVolume: 0.3,
    },

    view: {
      ring: 6,                 // folga para a moldura do tabuleiro (px de tela)
      maxCell: 50,             // tamanho máximo de cada bloco (px de tela)
    },
  };

  const COLORS = {
    ink: '#543847',
    white: '#ffffff',
    board: '#1c1424',
    gridLine: 'rgba(255, 255, 255, 0.075)',
  };

  // Cada peça tem uma cor própria: base, luz (topo/esquerda), sombra (fundo/direita), brilho.
  const PALETTE = {
    I: { base: '#4fd0ee', light: '#b0f2ff', dark: '#2a96b8' },
    O: { base: '#fbd530', light: '#fff08a', dark: '#d9a21a' },
    T: { base: '#b35be0', light: '#e0a4ff', dark: '#7d32a8' },
    S: { base: '#74d160', light: '#bdf3ac', dark: '#45a032' },
    Z: { base: '#ff6b57', light: '#ffa595', dark: '#c93a28' },
    J: { base: '#4a7be8', light: '#98b8ff', dark: '#2a4eae' },
    L: { base: '#f08a24', light: '#ffc374', dark: '#b85e0c' },
  };

  const { cols: COLS, rows: ROWS, hidden: HIDDEN } = CONFIG.board;
  const TOTAL_ROWS = ROWS + HIDDEN;
  const STATES = { READY: 'ready', PLAYING: 'playing', PAUSED: 'paused', GAME_OVER: 'over' };

  /* ======================================================================
     2. PERSISTÊNCIA
     Tudo passa pelo tetris_storage.js (TetrisStorage), isolado do restante do projeto,
     que cai para a memória se o armazenamento do navegador estiver indisponível
     (modo privado, bloqueio de cookies...).
     ====================================================================== */
  function loadBest() {
    return TetrisStorage.getBest();
  }

  function saveBest(value) {
    TetrisStorage.setBest(value);
  }

  /* ======================================================================
     3. ÁUDIO (efeitos gerados com Web Audio API, sem arquivos externos)
     O contexto só é criado/retomado dentro de um gesto do jogador. Se o
     navegador bloquear o som, nada quebra: os efeitos simplesmente não tocam.
     ====================================================================== */
  const Sound = (() => {
    let audioContext = null;
    let master = null;
    let noiseBuffer = null;
    let unavailable = false;
    let muted = TetrisStorage.isMuted();

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
        } catch (error) {
          unavailable = true;
          audioContext = null;
          return null;
        }
      }
      if (audioContext.state === 'suspended') {
        try { audioContext.resume().catch(() => {}); } catch (error) { /* ignora */ }
      }
      return audioContext;
    }

    // Um "bip" com envelope curto e glissando de frequência.
    function tone({ type = 'square', from, to = from, duration = 0.1, volume = 0.5, delay = 0 }) {
      const ac = ensureContext();
      if (!ac) return;
      const start = ac.currentTime + delay;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(from, start);
      if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, start + duration);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    }

    // Um estalo de ruído filtrado.
    function noise({ duration = 0.15, volume = 0.5, cutoff = 1800 }) {
      const ac = ensureContext();
      if (!ac) return;
      if (!noiseBuffer) {
        const length = Math.floor(ac.sampleRate * 0.4);
        noiseBuffer = ac.createBuffer(1, length, ac.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      }
      const start = ac.currentTime;
      const source = ac.createBufferSource();
      const filter = ac.createBiquadFilter();
      const gain = ac.createGain();
      source.buffer = noiseBuffer;
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      gain.gain.setValueAtTime(volume, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      source.start(start);
      source.stop(start + duration + 0.02);
    }

    function safely(fn) {
      if (muted) return;
      try { fn(); } catch (error) { /* o áudio nunca pode quebrar o jogo */ }
    }

    return {
      get muted() { return muted; },
      unlock() { if (!muted) safely(ensureContext); },
      setMuted(value) {
        muted = Boolean(value);
        TetrisStorage.setMuted(muted);
        if (!muted) safely(ensureContext);
      },
      move() { safely(() => tone({ type: 'square', from: 260, to: 220, duration: 0.03, volume: 0.1 })); },
      rotate() { safely(() => tone({ type: 'square', from: 360, to: 520, duration: 0.05, volume: 0.14 })); },
      hardDrop() {
        safely(() => {
          noise({ duration: 0.12, volume: 0.4, cutoff: 1400 });
          tone({ type: 'triangle', from: 200, to: 60, duration: 0.12, volume: 0.5 });
        });
      },
      lock() { safely(() => tone({ type: 'triangle', from: 170, to: 100, duration: 0.07, volume: 0.35 })); },
      lines(count) {
        safely(() => {
          const notes = [523, 659, 784, 1047];
          for (let i = 0; i < Math.min(4, count + 1); i++) {
            tone({ type: 'square', from: notes[i], duration: 0.1, volume: 0.2, delay: i * 0.065 });
          }
          if (count >= 4) tone({ type: 'triangle', from: 1319, duration: 0.3, volume: 0.3, delay: 0.26 });
        });
      },
      levelUp(delay = 0) {
        safely(() => {
          [523, 659, 784, 1047, 1319].forEach((f, i) => {
            tone({ type: 'triangle', from: f, duration: 0.12, volume: 0.3, delay: delay + i * 0.07 });
          });
        });
      },
      gameOver() {
        safely(() => {
          [392, 330, 262, 196].forEach((f, i) => {
            tone({ type: 'sawtooth', from: f, to: f * 0.96, duration: 0.22, volume: 0.28, delay: i * 0.15 });
          });
        });
      },
      click() { safely(() => tone({ type: 'square', from: 520, to: 700, duration: 0.05, volume: 0.2 })); },
    };
  })();

  /* ======================================================================
     4. PEÇAS
     Cada peça é uma matriz em uma "caixa" (4x4 para o I, 2x2 para o O e 3x3
     para as demais). As 4 rotações são geradas girando a matriz no sentido
     horário. Estados de rotação: 0 = inicial, 1 = direita, 2 = invertida, 3 = esquerda.
     ====================================================================== */
  const TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

  const BASE_SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
  };

  function rotateMatrixCW(m) {
    const n = m.length;
    return m.map((row, y) => row.map((_, x) => m[n - 1 - x][y]));
  }

  // PIECES[tipo] = { rots: [4 listas de células [x, y]], size, spawnX }
  const PIECES = {};
  for (const type of TYPES) {
    let matrix = BASE_SHAPES[type];
    const rots = [];
    for (let r = 0; r < 4; r++) {
      const cells = [];
      matrix.forEach((row, y) => row.forEach((value, x) => { if (value) cells.push([x, y]); }));
      rots.push(cells);
      matrix = rotateMatrixCW(matrix);
    }
    const size = BASE_SHAPES[type].length;
    PIECES[type] = { rots, size, spawnX: Math.floor((COLS - size) / 2) };
  }

  // "Wall kicks" do Super Rotation System: se a rotação direta bate em algo, tenta
  // estes deslocamentos em ordem. Índice = estado de origem (giro horário).
  // Coordenadas no padrão SRS (x para a direita, y PARA CIMA); a conversão está em rotatePiece().
  const KICKS_JLSTZ = [
    [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],   // 0 -> 1
    [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],       // 1 -> 2
    [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],      // 2 -> 3
    [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],    // 3 -> 0
  ];
  const KICKS_I = [
    [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],     // 0 -> 1
    [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],     // 1 -> 2
    [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],     // 2 -> 3
    [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],     // 3 -> 0
  ];

  /* ======================================================================
     5. ESTADO DA PARTIDA
     ====================================================================== */
  const game = {
    state: STATES.READY,
    board: [],            // TOTAL_ROWS linhas x COLS colunas; null = vazio, senão a letra da peça
    piece: null,          // peça ativa { type, rot, x, y }
    next: null,           // tipo da próxima peça
    bag: [],
    score: 0,
    lines: 0,
    level: 1,
    best: 0,
    newBest: false,
    dropAcc: 0,
    clearRows: [],
    clearElapsed: 0,
    overTime: 0,
    panelShown: false,
  };

  const input = {
    held: { left: false, right: false },
    down: false,
    dasDir: 0,
    dasTimer: 0,
    dasCharged: false,
  };
  const DIR = { left: -1, right: 1 };
  const pressedKeys = new Set();

  function emptyBoard() {
    return Array.from({ length: TOTAL_ROWS }, () => new Array(COLS).fill(null));
  }

  function resetInput() {
    input.held.left = false;
    input.held.right = false;
    input.down = false;
    input.dasDir = 0;
    input.dasTimer = 0;
    input.dasCharged = false;
    pressedKeys.clear();
  }

  function resetRound() {
    game.state = STATES.READY;
    game.board = emptyBoard();
    game.piece = null;
    game.bag = [];
    game.next = drawFromBag();
    game.score = 0;
    game.lines = 0;
    game.level = 1;
    game.newBest = false;
    game.dropAcc = 0;
    game.clearRows = [];
    game.clearElapsed = 0;
    game.overTime = 0;
    game.panelShown = false;
    resetInput();
    syncUi();
    syncHud();
    renderNext();
  }

  function startGame() {
    if (game.state !== STATES.READY) return;
    game.state = STATES.PLAYING;
    resetInput();
    lastTime = null;
    Sound.click();
    spawnPiece();
    syncUi();
  }

  function endGame() {
    if (game.state !== STATES.PLAYING) return;
    game.state = STATES.GAME_OVER;
    game.piece = null;
    game.overTime = 0;
    game.panelShown = false;
    resetInput();
    if (game.score > game.best) {
      game.best = game.score;
      game.newBest = true;
      saveBest(game.best);
    }
    Sound.gameOver();
    syncUi();
    syncHud();
  }

  function setPaused(paused) {
    if (paused && game.state === STATES.PLAYING) game.state = STATES.PAUSED;
    else if (!paused && game.state === STATES.PAUSED) game.state = STATES.PLAYING;
    else return;
    lastTime = null;
    resetInput();
    Sound.click();
    syncUi();
  }

  function tryRestart() {
    if (game.state !== STATES.GAME_OVER || game.overTime < CONFIG.timing.gameOverDelay) return;
    resetRound();
    startGame();
  }

  /* ======================================================================
     6. REGRAS
     ====================================================================== */
  function drawFromBag() {            // "saco de 7": cada peça aparece uma vez por saco
    if (game.bag.length === 0) {
      game.bag = TYPES.slice();
      for (let i = game.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [game.bag[i], game.bag[j]] = [game.bag[j], game.bag[i]];
      }
    }
    return game.bag.pop();
  }

  // A peça (tipo, rotação, posição da caixa) bate nas paredes, no chão ou em blocos fixos?
  function collides(type, rot, px, py) {
    for (const [cx, cy] of PIECES[type].rots[rot]) {
      const x = px + cx;
      const y = py + cy;
      if (x < 0 || x >= COLS || y >= TOTAL_ROWS) return true;
      if (y >= 0 && game.board[y][x] !== null) return true;
    }
    return false;
  }

  function dropInterval() {
    const { base, step, minInterval } = CONFIG.speed;
    const n = game.level - 1;
    return Math.max(minInterval, Math.pow(base - n * step, n));
  }

  function spawnPiece() {
    const type = game.next;
    game.next = drawFromBag();
    // y = 1: o I nasce na primeira linha visível; as demais ocupam a linha oculta e a primeira visível.
    game.piece = { type, rot: 0, x: PIECES[type].spawnX, y: 1 };
    game.dropAcc = 0;
    renderNext();
    if (collides(type, 0, game.piece.x, game.piece.y)) endGame();   // sem espaço: fim de jogo
  }

  function canAct() {
    return game.state === STATES.PLAYING && game.piece !== null && game.clearRows.length === 0;
  }

  function isGrounded() {
    const p = game.piece;
    return collides(p.type, p.rot, p.x, p.y + 1);
  }

  function tryMove(dx, dy) {
    const p = game.piece;
    if (collides(p.type, p.rot, p.x + dx, p.y + dy)) return false;
    p.x += dx;
    p.y += dy;
    return true;
  }

  function moveHorizontal(dir) {
    if (!canAct()) return;
    if (tryMove(dir, 0)) {
      Sound.move();
    }
  }

  function rotatePiece() {
    if (!canAct()) return;
    const p = game.piece;
    if (p.type === 'O') return;
    const to = (p.rot + 1) % 4;
    const kicks = (p.type === 'I' ? KICKS_I : KICKS_JLSTZ)[p.rot];
    for (const [kx, ky] of kicks) {
      const nx = p.x + kx;
      const ny = p.y - ky;                // SRS usa y para cima; o tabuleiro usa y para baixo
      if (!collides(p.type, to, nx, ny)) {
        p.rot = to;
        p.x = nx;
        p.y = ny;
        Sound.rotate();
        return;
      }
    }
  }

  function ghostY() {
    const p = game.piece;
    let y = p.y;
    while (!collides(p.type, p.rot, p.x, y + 1)) y++;
    return y;
  }

  function hardDrop() {
    if (!canAct()) return;
    const p = game.piece;
    const target = ghostY();
    game.score += (target - p.y) * CONFIG.scoring.hardDrop;
    p.y = target;
    Sound.hardDrop();
    lockPiece(true);
    syncHud();
  }

  function lockPiece(fromHardDrop = false) {
    const p = game.piece;
    let allHidden = true;
    for (const [cx, cy] of PIECES[p.type].rots[p.rot]) {
      const x = p.x + cx;
      const y = p.y + cy;
      if (y >= 0 && y < TOTAL_ROWS) game.board[y][x] = p.type;
      if (y >= HIDDEN) allHidden = false;
    }
    if (!fromHardDrop) Sound.lock();
    game.piece = null;

    if (allHidden) { endGame(); return; }   // travou inteira acima do topo

    const full = [];
    for (let y = 0; y < TOTAL_ROWS; y++) {
      if (game.board[y].every((cell) => cell !== null)) full.push(y);
    }
    if (full.length) startClear(full);
    else spawnPiece();
  }

  function startClear(rows) {
    const count = rows.length;
    game.clearRows = rows;
    game.clearElapsed = 0;
    game.score += CONFIG.scoring.lines[count] * game.level;
    game.lines += count;
    const newLevel = Math.min(CONFIG.level.maxLevel, Math.floor(game.lines / CONFIG.level.linesPerLevel) + 1);
    Sound.lines(count);
    if (newLevel > game.level) {
      game.level = newLevel;
      Sound.levelUp(0.35);
    }
    syncHud();
  }

  function finishClear() {
    const rows = new Set(game.clearRows);
    const kept = game.board.filter((_, y) => !rows.has(y));
    while (kept.length < TOTAL_ROWS) kept.unshift(new Array(COLS).fill(null));   // linhas vazias entram por cima
    game.board = kept;
    game.clearRows = [];
    game.clearElapsed = 0;
    spawnPiece();
  }

  function addSoftDropPoint() {
    game.score += CONFIG.scoring.softDrop;
    syncHud();
  }

  // Movimento lateral contínuo (DAS): move uma vez ao apertar; depois de um instante repete.
  function updateDas(dt) {
    const dir = input.dasDir;
    if (!dir) return;
    input.dasTimer += dt;
    if (!input.dasCharged) {
      if (input.dasTimer < CONFIG.input.dasDelay) return;
      input.dasCharged = true;
      input.dasTimer -= CONFIG.input.dasDelay;
      moveHorizontal(dir);
    }
    let guard = 0;
    while (input.dasTimer >= CONFIG.input.dasRepeat && guard++ < 20) {
      input.dasTimer -= CONFIG.input.dasRepeat;
      moveHorizontal(dir);
    }
  }

  function update(dt) {
    if (game.state === STATES.GAME_OVER) {
      game.overTime += dt;
      if (!game.panelShown && game.overTime >= CONFIG.timing.gameOverDelay) {
        game.panelShown = true;
        syncUi();
      }
      return;
    }
    if (game.state !== STATES.PLAYING) return;           // pausado ou na tela inicial: nada se move

    if (game.clearRows.length) {
      game.clearElapsed += dt;
      if (game.clearElapsed >= CONFIG.timing.clearTime) finishClear();
      return;
    }
    if (!game.piece) return;

    updateDas(dt);
    if (!game.piece) return;

    const soft = input.down;
    const interval = soft ? Math.min(dropInterval(), CONFIG.speed.softDropInterval) : dropInterval();
    
    // Ao acelerar, descarta o tempo acumulado pela queda normal; sem isso a peça
    // "recupera" várias linhas de uma vez e parece teleportar.
    if (soft) game.dropAcc = Math.min(game.dropAcc, interval);
    
    game.dropAcc += dt;
    let guard = 0;
    while (game.dropAcc >= interval && guard++ < 30) {
      game.dropAcc -= interval;
      if (!tryMove(0, 1)) { 
        game.dropAcc = 0; 
        break; 
      }
      if (soft) addSoftDropPoint();
    }

    // Trava imediatamente a peça caso não possa descer mais
    if (game.piece && isGrounded()) {
      lockPiece();
    }
  }

  /* ======================================================================
     7. CENÁRIO E SPRITES
     O cenário é desenhado uma vez em um canvas que cobre a arena inteira,
     atrás do tabuleiro. Os sprites são ampliados em múltiplos inteiros e
     sem suavização, então o pixel art continua nítido.
     ====================================================================== */
  const boardCanvas = document.getElementById('board-canvas');
  const ctx = boardCanvas.getContext('2d');
  const nextCanvas = document.getElementById('next-canvas');
  const nextCtx = nextCanvas.getContext('2d');

  function makeCanvas(width, height) {
    const element = document.createElement('canvas');
    element.width = width;
    element.height = height;
    return element;
  }

  function fillRect(target, color, x, y, w, h) {
    target.fillStyle = color;
    target.fillRect(x, y, w, h);
  }

  /* ======================================================================
     8. RENDERIZAÇÃO
     O tabuleiro é desenhado direto na resolução física do canvas (cada
     bloco é um quadrado de `cell` pixels inteiros), então nada é esticado
     e as linhas da grade ficam nítidas.
     ====================================================================== */
  let cell = 20;              // lado de cada bloco, em pixels físicos
  let boardBg = null;         // fundo + grade, pré-renderizado

  function buildBoardBg() {
    const w = cell * COLS;
    const h = cell * ROWS;
    boardBg = makeCanvas(w, h);
    const g = boardBg.getContext('2d');
    fillRect(g, COLORS.board, 0, 0, w, h);
    g.fillStyle = COLORS.gridLine;
    for (let x = 1; x < COLS; x++) g.fillRect(x * cell, 0, 1, h);
    for (let y = 1; y < ROWS; y++) g.fillRect(0, y * cell, w, 1);
  }

  // Bloco em pixel art: contorno escuro, luz em cima/esquerda, sombra embaixo/direita e brilho.
  function drawBlock(g, px, py, size, type, alpha = 1) {
    const pal = PALETTE[type];
    const o = Math.max(1, Math.floor(size / 16));
    const b = Math.max(1, Math.floor(size / 10));
    const ix = px + o;
    const iy = py + o;
    const iw = size - o * 2;
    if (alpha !== 1) g.globalAlpha = alpha;
    g.fillStyle = COLORS.ink;
    g.fillRect(px, py, size, size);
    g.fillStyle = pal.base;
    g.fillRect(ix, iy, iw, iw);
    g.fillStyle = pal.light;
    g.fillRect(ix, iy, iw, b);
    g.fillRect(ix, iy, b, iw);
    g.fillStyle = pal.dark;
    g.fillRect(ix, iy + iw - b, iw, b);
    g.fillRect(ix + iw - b, iy, b, iw);
    g.fillStyle = 'rgba(255, 255, 255, 0.55)';
    g.fillRect(ix + b + 1, iy + b + 1, Math.max(2, Math.floor(iw / 4)), Math.max(1, Math.floor(b / 2)));
    if (alpha !== 1) g.globalAlpha = 1;
  }

  // Indicação discreta de onde a peça vai cair: só o contorno, quase transparente.
  function drawGhostBlock(g, px, py, size, type) {
    const pal = PALETTE[type];
    const t = Math.max(1, Math.floor(size / 12));
    g.globalAlpha = 0.14;
    g.fillStyle = pal.base;
    g.fillRect(px, py, size, size);
    g.globalAlpha = 0.6;
    g.fillRect(px, py, size, t);
    g.fillRect(px, py + size - t, size, t);
    g.fillRect(px, py, t, size);
    g.fillRect(px + size - t, py, t, size);
    g.globalAlpha = 1;
  }

  function render() {
    if (!boardBg) return;
    const g = ctx;
    g.imageSmoothingEnabled = false;
    g.drawImage(boardBg, 0, 0);

    // Blocos fixos
    for (let r = 0; r < ROWS; r++) {
      const row = game.board[r + HIDDEN];
      for (let c = 0; c < COLS; c++) {
        if (row[c]) drawBlock(g, c * cell, r * cell, cell, row[c]);
      }
    }

    // Animação das linhas eliminadas: piscam em branco
    if (game.clearRows.length) {
      const blink = Math.floor(game.clearElapsed * 16) % 2;
      g.globalAlpha = blink ? 0.95 : 0.45;
      g.fillStyle = '#ffffff';
      for (const y of game.clearRows) {
        if (y >= HIDDEN) g.fillRect(0, (y - HIDDEN) * cell, COLS * cell, cell);
      }
      g.globalAlpha = 1;
    }

    // Peça ativa e sua sombra de queda
    const p = game.piece;
    if (p && game.state !== STATES.READY) {
      const gy = ghostY();
      if (gy !== p.y) {
        for (const [cx, cy] of PIECES[p.type].rots[p.rot]) {
          const row = gy + cy - HIDDEN;
          if (row >= 0) drawGhostBlock(g, (p.x + cx) * cell, row * cell, cell, p.type);
        }
      }
      for (const [cx, cy] of PIECES[p.type].rots[p.rot]) {
        const row = p.y + cy - HIDDEN;
        if (row >= 0) drawBlock(g, (p.x + cx) * cell, row * cell, cell, p.type);
      }
    }

    // Fim de jogo: o tabuleiro escurece aos poucos
    if (game.state === STATES.GAME_OVER) {
      g.globalAlpha = 0.6 * Math.min(1, game.overTime / 0.6);
      fillRect(g, COLORS.board, 0, 0, COLS * cell, ROWS * cell);
      g.globalAlpha = 1;
    }
  }

  // Prévia da próxima peça, centralizada na caixa ao lado do tabuleiro.
  function renderNext() {
    const w = nextCanvas.width;
    const h = nextCanvas.height;
    if (!w || !h) return;
    const g = nextCtx;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, w, h);
    if (!game.next) return;

    const cells = PIECES[game.next].rots[0];
    const xs = cells.map((c) => c[0]);
    const ys = cells.map((c) => c[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = maxX - minX + 1;
    const spanY = maxY - minY + 1;
    const size = Math.max(4, Math.floor(Math.min(w / 4.4, h / 3.4)));
    const offX = Math.floor((w - spanX * size) / 2);
    const offY = Math.floor((h - spanY * size) / 2);
    for (const [cx, cy] of cells) {
      drawBlock(g, offX + (cx - minX) * size, offY + (cy - minY) * size, size, game.next);
    }
  }

  /* ======================================================================
     9. INTERFACE
     ====================================================================== */
  const ui = {
    arena: document.getElementById('arena'),
    layout: document.getElementById('layout'),
    stage: document.getElementById('stage'),
    hud: document.getElementById('hud'),
    touchMove: document.getElementById('touch-move'),
    touchAct: document.getElementById('touch-act'),
    pauseButton: document.getElementById('pause-button'),
    muteButton: document.getElementById('mute-button'),
    helpButton: document.getElementById('help-button'),
    helpPopover: document.getElementById('help-popover'),
    helpClose: document.getElementById('help-close'),
    resumeButton: document.getElementById('resume-button'),
    restartButton: document.getElementById('restart-button'),
    hudScore: document.getElementById('hud-score'),
    hudBest: document.getElementById('hud-best'),
    hudLevel: document.getElementById('hud-level'),
    hudLines: document.getElementById('hud-lines'),
    overScore: document.getElementById('over-score'),
    overBest: document.getElementById('over-best'),
    overNew: document.getElementById('over-new'),
  };

  function syncUi() {
    ui.stage.dataset.state = game.state;
    document.body.dataset.state = game.state;
    ui.stage.classList.toggle('show-panel', game.state === STATES.GAME_OVER && game.panelShown);
    if (game.state === STATES.GAME_OVER) {
      ui.overScore.textContent = String(game.score);
      ui.overBest.textContent = String(game.best);
      ui.overNew.hidden = !game.newBest;
    }
    if (game.state === STATES.PAUSED) ui.resumeButton.focus({ preventScroll: true });
    ui.pauseButton.setAttribute('aria-label', game.state === STATES.PAUSED ? 'Continuar' : 'Pausar');
  }

  function syncHud() {
    ui.hudScore.textContent = String(game.score);
    ui.hudBest.textContent = String(Math.max(game.best, game.score));
    ui.hudLevel.textContent = String(game.level);
    ui.hudLines.textContent = String(game.lines);
  }

  function syncMuteButton() {
    const muted = Sound.muted;
    ui.muteButton.classList.toggle('is-muted', muted);
    ui.muteButton.setAttribute('aria-pressed', muted ? 'true' : 'false');
    ui.muteButton.setAttribute('aria-label', muted ? 'Ativar efeitos sonoros' : 'Silenciar efeitos sonoros');
  }

  function toggleMute() {
    Sound.setMuted(!Sound.muted);
    syncMuteButton();
    Sound.click();
  }

  // Ajuda "Como jogar": popover pequeno ancorado ao botão "?", fora do tabuleiro.
  // Abrir ou fechar não inicia, pausa nem altera a partida: é só um painel de leitura.
  let helpOpen = false;
  const HELP = { gap: 12, edge: 8, maxWidth: 250 };

  function openHelp() {
    if (helpOpen) return;
    helpOpen = true;
    ui.helpPopover.hidden = false;
    ui.helpButton.setAttribute('aria-expanded', 'true');
    placeHelp();
  }

  function closeHelp() {
    if (!helpOpen) return;
    helpOpen = false;
    ui.helpPopover.hidden = true;
    ui.helpButton.setAttribute('aria-expanded', 'false');
  }

  // Preferência: abrir ABAIXO do botão, dentro da arena. Se não couber, abre acima; se ainda
  // assim não couber (celular deitado), limita a altura e deixa o conteúdo rolar.
  function placeHelp() {
    if (!helpOpen) return;
    const pop = ui.helpPopover;
    for (const v of ['max-height', 'overflow-y']) pop.style.removeProperty(v);
    const arena = ui.arena.getBoundingClientRect();
    const btn = ui.helpButton.getBoundingClientRect();

    const width = Math.floor(Math.min(HELP.maxWidth, arena.width - HELP.edge * 2));
    const left = Math.max(arena.left + HELP.edge, Math.min(btn.left, arena.right - HELP.edge - width));
    pop.style.width = `${width}px`;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.setProperty('--arrow-x', `${Math.round(Math.min(Math.max(btn.left + btn.width / 2 - left, 16), width - 16))}px`);

    const height = pop.offsetHeight;
    const roomBelow = arena.bottom - btn.bottom - HELP.gap - HELP.edge;
    const roomAbove = btn.top - arena.top - HELP.gap - HELP.edge;
    let placement = 'below';
    if (height > roomBelow && roomAbove > roomBelow) placement = 'above';
    const room = placement === 'below' ? roomBelow : roomAbove;
    if (height > room) {
      pop.style.maxHeight = `${Math.max(96, Math.floor(room))}px`;
      pop.style.overflowY = 'auto';
    }
    const finalHeight = pop.offsetHeight;
    pop.style.top = `${Math.round(placement === 'below' ? btn.bottom + HELP.gap : btn.top - HELP.gap - finalHeight)}px`;
    pop.dataset.placement = placement;
  }

  /* ======================================================================
     10. ENTRADA (teclado e botões de toque)
     Tudo passa pelas mesmas funções, então teclado e toque se comportam igual.
     ====================================================================== */
  function pressDir(name) {
    const dir = DIR[name];
    input.held[name] = true;
    input.dasDir = dir;
    input.dasTimer = 0;
    input.dasCharged = false;
    moveHorizontal(dir);                // move já ao apertar; a repetição vem do updateDas
  }

  function releaseDir(name) {
    input.held[name] = false;
    if (input.dasDir !== DIR[name]) return;
    const other = name === 'left' ? 'right' : 'left';
    input.dasDir = input.held[other] ? DIR[other] : 0;
    input.dasTimer = 0;
    input.dasCharged = false;
  }

  function pressAction(action) {
    switch (action) {
      case 'left':
      case 'right': pressDir(action); break;
      case 'soft': input.down = true; break;
      case 'rotate': rotatePiece(); break;
      case 'hard': hardDrop(); break;
      default: break;
    }
  }

  function releaseAction(action) {
    if (action === 'left' || action === 'right') releaseDir(action);
    else if (action === 'soft') input.down = false;
  }

  const KEY_ACTIONS = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowDown: 'soft',
    ArrowUp: 'rotate',
    KeyA: 'left',
    KeyD: 'right',
    KeyS: 'soft',
    KeyW: 'rotate',
  };
  const BLOCKED_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Space']);

  function onKeyDown(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const code = event.code;
    // Com a ajuda aberta, Esc fecha só o painel.
    if (helpOpen && code === 'Escape') { event.preventDefault(); closeHelp(); return; }
    // Espaço/Enter com um botão focado (ex.: o "?") ativa o botão, não o jogo.
    if ((code === 'Space' || code === 'Enter') && event.target.closest && event.target.closest('button')) return;
    if (BLOCKED_KEYS.has(code)) event.preventDefault();      // impede a rolagem da página
    if (event.repeat) return;                                // a repetição é feita pelo jogo
    Sound.unlock();

    if (KEY_ACTIONS[code]) {
      pressedKeys.add(code);
      if (game.state === STATES.PLAYING) pressAction(KEY_ACTIONS[code]);
    } else if (code === 'Space') {
      if (game.state === STATES.PLAYING) hardDrop();
      else if (game.state === STATES.READY) startGame();
      else if (game.state === STATES.PAUSED) setPaused(false);
      else tryRestart();
    } else if (code === 'Enter') {
      if (game.state === STATES.READY) startGame();
      else if (game.state === STATES.PAUSED) setPaused(false);
      else if (game.state === STATES.GAME_OVER) tryRestart();
    } else if (code === 'KeyP') {
      setPaused(game.state === STATES.PLAYING);
    } else if (code === 'KeyM') {
      toggleMute();
    }
  }

  function onKeyUp(event) {
    const action = KEY_ACTIONS[event.code];
    if (action) {
      pressedKeys.delete(event.code);
      // só solta se nenhuma outra tecla da mesma ação (ex.: seta + A) continuar pressionada
      const held = Object.keys(KEY_ACTIONS).some((k) => KEY_ACTIONS[k] === action && pressedKeys.has(k));
      if (!held) releaseAction(action);
    }
    if (event.code === 'Space' && !(event.target.closest && event.target.closest('button'))) event.preventDefault();
  }

  function bindTouchButton(button) {
    const action = button.dataset.action;
    const release = () => {
      button.classList.remove('is-down');
      releaseAction(action);
    };
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      Sound.unlock();
      try { button.setPointerCapture(event.pointerId); } catch (error) { /* ignora */ }
      button.classList.add('is-down');
      if (game.state === STATES.PLAYING) pressAction(action);
    });
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  /* ======================================================================
     11. LAYOUT E REDIMENSIONAMENTO
     Calcula o maior bloco inteiro (em pixels físicos) que cabe na área livre
     ao lado do painel de informações e dos botões de toque. O tabuleiro
     mantém a proporção 10:20 e os blocos continuam quadrados.
     ====================================================================== */
  const MQ_PORTRAIT = window.matchMedia('(orientation: portrait)');
  const MQ_LAND_TOUCH = window.matchMedia('(orientation: landscape) and (pointer: coarse)');

  function fit() {
    const dpr = window.devicePixelRatio || 1;
    const cs = window.getComputedStyle(ui.layout);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const gapX = parseFloat(cs.columnGap) || 0;
    const gapY = parseFloat(cs.rowGap) || 0;

    let availW = ui.layout.clientWidth - padX;
    let availH = ui.layout.clientHeight - padY;
    if (MQ_PORTRAIT.matches) {
      const controls = Math.max(ui.touchMove.offsetHeight, ui.touchAct.offsetHeight);
      availH -= ui.hud.offsetHeight + controls + gapY * 2;
    } else if (MQ_LAND_TOUCH.matches) {
      availW -= Math.max(ui.hud.offsetWidth, ui.touchMove.offsetWidth) + ui.touchAct.offsetWidth + gapX * 2;
    } else {
      availW -= ui.hud.offsetWidth + gapX;
    }
    availW -= CONFIG.view.ring * 2;
    availH -= CONFIG.view.ring * 2;

    const cssCell = Math.max(4, Math.min(availW / COLS, availH / ROWS, CONFIG.view.maxCell));
    cell = Math.max(4, Math.floor(cssCell * dpr));       // bloco em pixels físicos inteiros
    const cssWidth = (cell * COLS) / dpr;
    const cssHeight = (cell * ROWS) / dpr;

    ui.stage.style.width = `${cssWidth}px`;
    ui.stage.style.height = `${cssHeight}px`;
    ui.stage.style.setProperty('--u', `${cssWidth / 160}px`);
    boardCanvas.width = cell * COLS;
    boardCanvas.height = cell * ROWS;
    buildBoardBg();

    nextCanvas.width = Math.max(1, Math.round(nextCanvas.clientWidth * dpr));
    nextCanvas.height = Math.max(1, Math.round(nextCanvas.clientHeight * dpr));
    renderNext();

    render();       // redimensionar limpa os canvas: redesenha na hora para não piscar
    placeHelp();    // reposiciona o painel de ajuda, se estiver aberto
  }

  /* ======================================================================
     12. LOOP PRINCIPAL E INICIALIZAÇÃO
     ====================================================================== */
  let rafId = null;
  let lastTime = null;

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (lastTime === null) lastTime = now;
    const dt = Math.min(Math.max((now - lastTime) / 1000, 0), CONFIG.timing.maxFrameTime);
    lastTime = now;
    update(dt);
    render();
  }

  function startLoop() {
    if (rafId !== null) return;          // garante um único loop
    lastTime = null;
    rafId = requestAnimationFrame(frame);
  }

  function pauseIfPlaying() {
    input.held.left = input.held.right = input.down = false;
    input.dasDir = 0;
    setPaused(true);                      // perder o foco pausa a partida
  }

  function init() {
    game.best = loadBest();
    resetRound();
    syncMuteButton();

    document.addEventListener('keydown', onKeyDown, { passive: false });
    document.addEventListener('keyup', onKeyUp, { passive: false });
    document.addEventListener('pointerup', () => Sound.unlock());
    document.addEventListener('contextmenu', (event) => event.preventDefault());
    window.addEventListener('blur', pauseIfPlaying);
    document.addEventListener('visibilitychange', () => {
      lastTime = null;
      if (document.hidden) pauseIfPlaying();
    });
    window.addEventListener('pagehide', () => {
      if (game.score > game.best) saveBest(game.score);
    });

    // Tocar/clicar no tabuleiro inicia a partida (sem botão "Jogar"). Com a ajuda aberta, o
    // primeiro toque fora dela só a fecha.
    let helpClosedBy = null;
    document.addEventListener('pointerdown', (event) => {
      if (helpOpen && !(event.target.closest && event.target.closest('#help-popover, #help-button'))) {
        closeHelp();
        helpClosedBy = event;
      }
    }, true);
    ui.stage.addEventListener('pointerdown', (event) => {
      if (event.target.closest && event.target.closest('button')) return;
      if (helpClosedBy === event) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (game.state !== STATES.READY) return;
      event.preventDefault();
      Sound.unlock();
      startGame();
    });
    ui.helpButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (helpOpen) closeHelp(); else openHelp();
      if (event.detail > 0) ui.helpButton.blur();   // clique/toque: Espaço não deve acionar o botão depois
    });
    ui.helpClose.addEventListener('click', (event) => {
      event.stopPropagation();
      closeHelp();
      ui.helpButton.focus({ preventScroll: true });
    });
    ui.resumeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      setPaused(false);
      ui.resumeButton.blur();
    });
    ui.restartButton.addEventListener('click', (event) => {
      event.stopPropagation();
      Sound.unlock();
      tryRestart();                      // só reinicia depois do atraso de fim de jogo
      ui.restartButton.blur();
    });
    ui.pauseButton.addEventListener('click', (event) => {
      event.stopPropagation();
      setPaused(game.state === STATES.PLAYING);
      ui.pauseButton.blur();
    });
    ui.muteButton.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleMute();
      ui.muteButton.blur();              // Espaço não deve acionar o botão depois
    });

    document.querySelectorAll('.tbtn').forEach(bindTouchButton);

    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', fit);
    if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(ui.arena);

    fit();
    startLoop();
  }

  init();

  // Atalho para depuração no console: __tetris.game.score, __tetris.CONFIG, ...
  window.__tetris = { game, CONFIG };
})();