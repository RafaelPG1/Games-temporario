/* ==========================================================================
   arcade/flappy_bird/flappy_bird.js - HTML5 Canvas + JavaScript puro
   Sem dependências. Funciona abrindo o index.html direto no navegador.

   Índice
     1. Configuração (todas as constantes de ajuste estão aqui)
     2. Persistência (flappy_bird_storage.js, exclusivo deste jogo)
     3. Áudio (Web Audio API)
     4. Estado da partida (inclui partida salva e contagem de retomada após F5)
     5. Física do pássaro
     6. Canos (geração, dificuldade e remoção)
     7. Colisões
     8. Pontuação
     9. Sprites e renderização
    10. Interface (classes CSS e textos dos painéis)
    11. Entrada (teclado e ponteiro)
    12. Redimensionamento do canvas
    13. Loop principal e inicialização
   ========================================================================== */

(() => {
  'use strict';

  /* ======================================================================
     1. CONFIGURAÇÃO
     Unidades: pixels do "mundo" (288 x 512) e segundos.
     ====================================================================== */
  const CONFIG = {
    world: {
      width: 288,
      height: 512,
      groundHeight: 112,        // altura do chão; a área de voo é height - groundHeight
    },

    bird: {
      x: 72,                    // posição horizontal fixa
      startY: 236,              // altura inicial / centro da flutuação na tela inicial
      spriteWidth: 34,
      spriteHeight: 24,
      hitboxWidth: 24,          // menor que o desenho, para colisões mais justas
      hitboxHeight: 18,
      gravity: 1000,            // aceleração para baixo (px/s²)
      flapVelocity: 300,        // impulso para cima (px/s); SUBSTITUI a velocidade atual
      maxFallSpeed: 520,        // limite de velocidade de queda (px/s)
      tiltUp: -0.45,            // ângulo ao subir (rad)
      tiltDown: 1.45,           // ângulo máximo ao cair (rad)
      tiltUpRate: 18,           // quão rápido o bico sobe (1/s)
      tiltDownRate: 7,          // quão rápido o bico desce (1/s)
      floatAmplitude: 6,        // flutuação na tela inicial (px)
      floatSpeed: 5,            // rad/s
      wingFps: 12,
    },

    pipes: {
      width: 52,
      capHeight: 26,
      bodyInset: 3,             // o corpo é mais estreito que a extremidade
      firstOffset: 70,          // distância do primeiro par além da borda direita
      spacing: 180,             // distância horizontal entre pares (borda esquerda a borda esquerda)
      gapSize: 120,             // abertura vertical inicial
      gapMargin: 56,            // distância mínima entre a abertura e o topo / o chão
      maxGapShift: 95,          // variação máxima entre o centro de duas aberturas seguidas
      firstGapSpread: 50,       // o primeiro par fica perto do meio da tela
    },

    speed: {
      start: 120,               // velocidade dos canos e do chão (px/s)
    },

    difficulty: {
      pointsPerLevel: 5,        // a cada N pontos a dificuldade sobe um nível
      speedStep: 5,             // +px/s por nível
      maxSpeed: 145,            // teto de velocidade
      gapStep: 2,               // -px de abertura por nível
      minGap: 102,              // piso da abertura
    },

    timing: {
      maxFrameTime: 1 / 30,     // limite do delta time (aba em segundo plano, travadas)
      physicsStep: 1 / 120,     // passo máximo da simulação (evita atravessar canos)
      gameOverDelay: 0.5,       // espera até mostrar o painel e aceitar reinício
    },

    scenery: {
      cloudSpeed: [7, 13],      // px/s
      cityParallax: 0.2,        // fração da velocidade do chão
      bushParallax: 0.5,
      idleScroll: 60,           // rolagem do chão na tela inicial (px/s)
    },

    audio: {
      masterVolume: 0.3,
    },

    persistence: {
      saveIntervalMs: 400,      // intervalo mínimo entre gravações automáticas durante a partida
    },

    recovery: {
      seconds: 3,               // pausa de segurança ao voltar para uma partida em andamento
      goSeconds: 0.7,           // quanto tempo o "GO!" fica na tela depois da contagem
      onTabReturn: true,        // true: voltar de outra aba / tela bloqueada também faz a contagem
    },

    view: {
      margin: 6,                // folga ao redor do palco (px de tela)
      maxCssHeight: 1000,       // não estica o jogo em telas enormes
    },
  };

  const COLORS = {
    ink: '#543847',
    skyBands: ['#4ec0e8', '#58c6ea', '#63ccec', '#6fd2ee', '#7cd8f0', '#8adef2', '#9ae4f4', '#aceaf6'],
    cloud: '#ffffff',
    cloudShade: '#d3f0f8',
    city: '#b9e5ee',
    cityWindow: '#cdeff5',
    bushDark: '#59b84a',
    bushLight: '#74d160',
    pipe: ['#c4f58a', '#9ee152', '#73bf2e', '#5ba024', '#487d1b'],
    pipeShadow: 'rgba(40, 70, 10, 0.35)',
    grassLight: '#a6ea58',
    grassMid: '#78c72f',
    grassDark: '#4f9420',
    dirt: '#c4824a',
    dirtDark: '#a76a36',
    dirtLight: '#dba46a',
    dirtDeep: '#8f5a2c',
    dirtEdge: '#e0b27a',
    flash: '#ffffff',
    scoreFill: '#ffffff',
  };

  const { world: WORLD } = CONFIG;
  const GROUND_Y = WORLD.height - WORLD.groundHeight;      // topo do chão = limite de colisão
  const STATES = { READY: 'ready', PLAYING: 'playing', GAME_OVER: 'gameOver' };

  /* ======================================================================
     2. PERSISTÊNCIA
     Toda leitura/gravação (recorde, preferência de som e partida em andamento) passa por
     flappy_bird_storage.js, que precisa ser carregado antes deste arquivo.
     Ele trata dados inválidos e armazenamento indisponível.
     ====================================================================== */
  const Store = window.FlappyBirdStorage;

  /* ======================================================================
     3. ÁUDIO (efeitos gerados com Web Audio API, sem arquivos externos)
     O contexto só é criado/retomado dentro de um gesto do jogador.
     ====================================================================== */
  const Sound = (() => {
    let audioContext = null;
    let master = null;
    let noiseBuffer = null;
    let unavailable = false;
    let muted = Store.isMuted();

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
      const ctx = ensureContext();
      if (!ctx) return;
      const start = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(from, start);
      if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, start + duration);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    }

    function noise({ duration = 0.15, volume = 0.5, cutoff = 1800 }) {
      const ctx = ensureContext();
      if (!ctx) return;
      if (!noiseBuffer) {
        const length = Math.floor(ctx.sampleRate * 0.3);
        noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      }
      const start = ctx.currentTime;
      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
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
      try { fn(); } catch (error) { /* áudio nunca pode quebrar o jogo */ }
    }

    return {
      get muted() { return muted; },
      unlock() {
        if (!muted) safely(ensureContext);
      },
      setMuted(value) {
        muted = Boolean(value);
        Store.setMuted(muted);
        if (!muted) safely(ensureContext);
      },
      flap() {
        safely(() => tone({ type: 'square', from: 330, to: 620, duration: 0.09, volume: 0.35 }));
      },
      score() {
        safely(() => {
          tone({ type: 'square', from: 880, duration: 0.07, volume: 0.3 });
          tone({ type: 'square', from: 1320, duration: 0.13, volume: 0.3, delay: 0.07 });
        });
      },
      hit() {
        safely(() => {
          noise({ duration: 0.16, volume: 0.7, cutoff: 2200 });
          tone({ type: 'sawtooth', from: 220, to: 55, duration: 0.28, volume: 0.45 });
        });
      },
    };
  })();

  /* ======================================================================
     4. ESTADO DA PARTIDA
     ====================================================================== */
  const game = {
    state: STATES.READY,
    best: 0,
    score: 0,
    newBest: false,
    time: 0,              // relógio de animação (segundos)
    scroll: 0,            // distância acumulada de rolagem do chão (px)
    overTime: 0,          // tempo desde o fim da partida
    panelShown: false,
    paused: false,        // true = simulação congelada (só vale durante a partida)
    flash: 0,             // intensidade do clarão da colisão (0 a 1)
    lastGapY: null,       // centro da abertura do último par gerado
    bird: null,
    pipes: [],
  };

  const clouds = [];      // decoração; mantida entre partidas

  // Contagem de retomada (3, 2, 1, GO!). Só existe ao recarregar a página ou voltar a ela
  // com uma partida em andamento; a pausa manual NUNCA passa por aqui. Não usa setTimeout:
  // quem conta é o loop principal, então nunca há duas contagens ao mesmo tempo.
  const recovery = {
    active: false,        // true = retomada em andamento (game.paused também fica true)
    waiting: false,       // true = esperando o jogador tocar / apertar Espaço; só então começa a contagem
    remaining: 0,         // segundos que faltam
    go: 0,                // segundos que o "GO!" ainda fica visível
    shown: null,          // texto exibido agora (só mexe no DOM quando muda)
  };

  let clockNow = 0;       // último timestamp recebido do requestAnimationFrame
  let lastSaveAt = 0;     // instante (nesse mesmo relógio) da última gravação da partida
  let saveNow = false;    // true = gravar no próximo quadro (ex.: acabou de pontuar)

  function createBird() {
    return {
      x: CONFIG.bird.x,
      y: CONFIG.bird.startY,
      vy: 0,
      angle: 0,
      wingTime: 0,
      landed: false,
    };
  }

  // Zera TUDO o que pertence a uma partida e volta para a tela inicial.
  function resetRound() {
    cancelRecovery();
    game.state = STATES.READY;
    game.score = 0;
    game.newBest = false;
    game.overTime = 0;
    game.panelShown = false;
    game.paused = false;
    game.flash = 0;
    game.lastGapY = null;
    game.pipes.length = 0;
    game.bird = createBird();
    syncUi();
  }

  function startGame() {
    if (game.state !== STATES.READY) return;
    game.state = STATES.PLAYING;
    game.paused = false;
    game.overTime = 0;
    game.panelShown = false;
    syncUi();
    flap();                                   // o primeiro comando também dá o impulso inicial
  }

  function endGame() {
    if (game.state !== STATES.PLAYING) return;   // encerra uma única vez
    cancelRecovery();
    Store.clearRun();      // partida terminada não pode voltar depois de um F5 (o recorde fica)
    game.state = STATES.GAME_OVER;
    game.paused = false;
    game.overTime = 0;
    game.panelShown = false;
    game.flash = 1;
    game.bird.vy = Math.max(game.bird.vy, 0);
    if (game.score > game.best) {
      game.best = game.score;
      game.newBest = true;
      Store.setBest(game.best);
    }
    Sound.hit();
    syncUi();
  }

  function tryRestart() {
    if (game.state !== STATES.GAME_OVER) return;
    if (game.overTime < CONFIG.timing.gameOverDelay) return;   // evita reinício acidental
    resetRound();
  }

  // Pausa e retomada só existem durante a partida. Pausar não encerra nem
  // altera nada: apenas deixa de chamar update() (ver frame()).
  function pauseGame() {
    if (game.state !== STATES.PLAYING || game.paused) return;
    game.paused = true;
    persistRun();             // congelada: grava o estado exato em que parou
    syncUi();
  }

  function resumeGame() {
    if (game.state !== STATES.PLAYING || !game.paused || recovery.active) return;
    game.paused = false;
    lastTime = null;          // o primeiro quadro depois de continuar tem dt = 0: sem saltos
    syncUi();
  }
  // Despausa passando pela contagem 3, 2, 1 (a mesma do F5)
function resumeWithCountdown() {
  if (game.state !== STATES.PLAYING || recovery.active) return;
  beginRecovery();      // congela e prepara a contagem
  confirmRecovery();    // o toque já aconteceu: começa o 3, 2, 1 na hora
}

function togglePause() {
  if (recovery.active) return;
  if (game.paused) resumeWithCountdown();
  else pauseGame();
}

  // Botão "Reiniciar" da tela de pausa: descarta a partida em andamento e volta à tela inicial.
  // Só vale com a pausa manual ativa (é a única tela que mostra o botão). O recorde não muda.
  function discardRun() {
    if (game.state !== STATES.PLAYING || !game.paused || recovery.active) return;
    Store.clearRun();      // sem isso, um F5 traria de volta a partida que acabou de ser descartada
    resetRound();          // zera placar, canos, pássaro, pausa e contagem; estado volta a READY
  }
  /* ---------- Partida salva e retomada (F5) ---------- */

  // Retrato completo da partida: tudo o que é preciso para reconstruí-la.
  // A velocidade é derivada da pontuação (currentSpeed), então é gravada só como conferência.
  function snapshotRun() {
    const { bird } = game;
    return {
      score: game.score,
      level: currentLevel(),
      speed: currentSpeed(),
      scroll: game.scroll,
      time: game.time,
      lastGapY: game.lastGapY,
      bird: { x: bird.x, y: bird.y, vy: bird.vy, angle: bird.angle, wingTime: bird.wingTime },
      pipes: game.pipes.map((pipe) => ({ x: pipe.x, gapY: pipe.gapY, gapSize: pipe.gapSize, scored: pipe.scored })),
      clouds: clouds.map((cloud) => ({ x: cloud.x, y: cloud.y })),
    };
  }

  // Grava a partida agora. Só existe partida "salvável" enquanto o estado é PLAYING.
  function persistRun() {
    if (game.state !== STATES.PLAYING || !game.bird) return;
    lastSaveAt = clockNow;
    saveNow = false;
    Store.saveRun(snapshotRun());
  }

  // Chamado a cada quadro, mas só grava de tempos em tempos (e logo após marcar ponto).
  // Pausado ou em contagem nada muda, então nada é gravado aqui (a pausa já gravou).
  function autosaveRun() {
    const due = saveNow || clockNow - lastSaveAt >= CONFIG.persistence.saveIntervalMs;
    if (!due) return;
    saveNow = false;
    if (game.state === STATES.PLAYING && !game.paused) persistRun();
  }

  // Reconstrói a partida a partir do que foi salvo. Confere as regras do jogo ANTES de
  // mexer no estado; se algo não fizer sentido, devolve false e o jogo fica na tela inicial.
  function applyRun(run) {
    const cfg = CONFIG.bird;
    const pipeCfg = CONFIG.pipes;
    const halfH = cfg.hitboxHeight / 2;
    const saved = run.bird;

    if (saved.y < halfH || saved.y + halfH >= GROUND_Y) return false;
    if (saved.vy < -cfg.flapVelocity - 1 || saved.vy > cfg.maxFallSpeed + 1) return false;

    let previousX = -Infinity;
    for (const pipe of run.pipes) {
      const topHeight = pipe.gapY - pipe.gapSize / 2;
      const bottomHeight = GROUND_Y - (pipe.gapY + pipe.gapSize / 2);
      if (pipe.x <= previousX || topHeight < 0 || bottomHeight < 0) return false;
      previousX = pipe.x;
    }

    resetRound();                       // base limpa: um único lugar zera tudo
    game.state = STATES.PLAYING;
    game.score = run.score;             // atribuição direta: sem som e sem passar por updateScore
    game.scroll = run.scroll;
    game.time = run.time;
    game.lastGapY = run.lastGapY;
    game.bird = {
      x: cfg.x, y: saved.y, vy: saved.vy, angle: saved.angle, wingTime: saved.wingTime, landed: false,
    };
    for (const pipe of run.pipes) {
      game.pipes.push({
        x: pipe.x,
        width: pipeCfg.width,
        gapY: pipe.gapY,
        gapSize: pipe.gapSize,
        topHeight: pipe.gapY - pipe.gapSize / 2,
        bottomHeight: GROUND_Y - (pipe.gapY + pipe.gapSize / 2),
        scored: pipe.scored,
      });
    }
    if (run.clouds.length === clouds.length) {
      run.clouds.forEach((cloud, i) => { clouds[i].x = cloud.x; clouds[i].y = cloud.y; });
    }

    if (hitsAnyPipe()) {                // partida salva já "batida": não faz sentido restaurar
      resetRound();
      return false;
    }
    return true;
  }

  // Só roda uma vez, no init, e só a partir da tela inicial.
  function restoreSavedRun() {
    if (game.state !== STATES.READY) return false;
    const run = Store.loadRun();
    if (!run) return false;
    if (!applyRun(run)) {
      Store.clearRun();
      return false;
    }
    beginRecovery();
    return true;
  }

  // Congela a partida e inicia a contagem. Chamar de novo apenas reinicia a contagem
  // (existe um único objeto `recovery`, então nunca há duas).
  function beginRecovery() {
    if (game.state !== STATES.PLAYING) return;
    recovery.active = true;
    recovery.waiting = true;           // primeiro pede um toque / Espaço do jogador
    recovery.remaining = CONFIG.recovery.seconds;
    recovery.go = 0;
    recovery.shown = null;
    game.paused = true;
    syncUi();
  }

  function tickRecovery(elapsed) {
    if (recovery.waiting) return;     // sem toque do jogador a contagem não começa
    recovery.remaining -= elapsed;
    if (recovery.remaining <= 0) endRecovery();
    else syncRecoveryUi();
  }

  function endRecovery() {
    recovery.active = false;
    recovery.waiting = false;
    recovery.remaining = 0;
    recovery.go = CONFIG.recovery.goSeconds;
    recovery.shown = null;
    game.paused = false;
    lastTime = null;          // o primeiro quadro depois da contagem tem dt = 0: sem saltos
    syncUi();
  }

  function cancelRecovery() {
    recovery.active = false;
    recovery.waiting = false;
    recovery.remaining = 0;
    recovery.go = 0;
    recovery.shown = null;
  }

  // O jogador tocou / apertou Espaço: agora sim começa a contagem 3, 2, 1.
  function confirmRecovery() {
    if (!recovery.active || !recovery.waiting) return;
    recovery.waiting = false;
    recovery.remaining = CONFIG.recovery.seconds;
    recovery.shown = null;
    syncRecoveryUi();
  }

  function tickGo(elapsed) {
    recovery.go = Math.max(0, recovery.go - elapsed);
    if (recovery.go === 0) syncRecoveryUi();
  }

  // Ao voltar para a página com a partida correndo (ou já em contagem), passa pela contagem.
  // Pausa manual fica como está; tela inicial e Game Over não são afetados.
  function guardOnReturn() {
    if (game.state !== STATES.PLAYING) return;
    if (game.paused && !recovery.active) return;
    beginRecovery();
  }

  /* ======================================================================
     5. FÍSICA DO PÁSSARO
     ====================================================================== */
  function flap() {
    if (game.state !== STATES.PLAYING) return;
    game.bird.vy = -CONFIG.bird.flapVelocity;   // substitui a velocidade, não soma
    Sound.flap();
  }

  function birdHitbox() {
    const { bird } = game;
    const halfW = CONFIG.bird.hitboxWidth / 2;
    const halfH = CONFIG.bird.hitboxHeight / 2;
    return { left: bird.x - halfW, right: bird.x + halfW, top: bird.y - halfH, bottom: bird.y + halfH };
  }

  // Integra a gravidade. Retorna true se tocou o chão.
  function stepBirdPhysics(h) {
    const { bird } = game;
    const cfg = CONFIG.bird;
    const halfH = cfg.hitboxHeight / 2;

    bird.vy = Math.min(bird.vy + cfg.gravity * h, cfg.maxFallSpeed);
    bird.y += bird.vy * h;

    // Teto: o pássaro para no topo, mas o topo não é letal.
    if (bird.y - halfH < 0) {
      bird.y = halfH;
      if (bird.vy < 0) bird.vy = 0;
    }

    // Chão: limite real de colisão.
    if (bird.y + halfH >= GROUND_Y) {
      bird.y = GROUND_Y - halfH;
      bird.vy = 0;
      return true;
    }
    return false;
  }

  function updateBirdAngle(dt) {
    const { bird } = game;
    const cfg = CONFIG.bird;
    let target;
    let rate;
    if (bird.vy < 0) {
      target = cfg.tiltUp;
      rate = cfg.tiltUpRate;
    } else {
      target = Math.min(cfg.tiltDown, (bird.vy / cfg.maxFallSpeed) * cfg.tiltDown * 1.6);
      target = Math.max(target, cfg.tiltUp);
      rate = cfg.tiltDownRate;
    }
    bird.angle += (target - bird.angle) * Math.min(1, rate * dt);
  }

  /* ======================================================================
     6. CANOS
     ====================================================================== */
  function currentLevel() {
    return Math.floor(game.score / CONFIG.difficulty.pointsPerLevel);
  }

  function currentSpeed() {
    const d = CONFIG.difficulty;
    return Math.min(d.maxSpeed, CONFIG.speed.start + currentLevel() * d.speedStep);
  }

  function currentGapSize() {
    const d = CONFIG.difficulty;
    return Math.max(d.minGap, CONFIG.pipes.gapSize - currentLevel() * d.gapStep);
  }

  function spawnPipe(x) {
    const cfg = CONFIG.pipes;
    const gapSize = currentGapSize();
    let minCenter = cfg.gapMargin + gapSize / 2;
    let maxCenter = GROUND_Y - cfg.gapMargin - gapSize / 2;

    if (game.lastGapY === null) {
      const middle = (minCenter + maxCenter) / 2;
      minCenter = Math.max(minCenter, middle - cfg.firstGapSpread);
      maxCenter = Math.min(maxCenter, middle + cfg.firstGapSpread);
    } else {
      // Mudança limitada em relação ao par anterior: sempre possível de atravessar.
      minCenter = Math.max(minCenter, game.lastGapY - cfg.maxGapShift);
      maxCenter = Math.min(maxCenter, game.lastGapY + cfg.maxGapShift);
    }

    const gapY = minCenter + Math.random() * (maxCenter - minCenter);
    game.lastGapY = gapY;

    game.pipes.push({
      x,
      width: cfg.width,
      gapY,
      gapSize,
      topHeight: gapY - gapSize / 2,
      bottomHeight: GROUND_Y - (gapY + gapSize / 2),
      scored: false,
    });
  }

  function spawnPipesIfNeeded() {
    const cfg = CONFIG.pipes;
    const { pipes } = game;
    if (pipes.length === 0) spawnPipe(WORLD.width + cfg.firstOffset);
    // Gera novos pares sempre fora da borda direita, com espaçamento constante.
    while (pipes[pipes.length - 1].x + cfg.spacing <= WORLD.width + cfg.width) {
      spawnPipe(pipes[pipes.length - 1].x + cfg.spacing);
    }
  }

  function advanceWorld(h) {
    const distance = currentSpeed() * h;
    game.scroll += distance;
    for (const pipe of game.pipes) pipe.x -= distance;
    while (game.pipes.length > 0 && game.pipes[0].x + game.pipes[0].width < 0) {
      game.pipes.shift();            // saiu totalmente da área visível
    }
    spawnPipesIfNeeded();
  }

  /* ======================================================================
     7. COLISÕES
     ====================================================================== */
  function overlaps(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  // Cada par vira 4 retângulos: corpo e extremidade de cima e de baixo.
  function pipeRects(pipe) {
    const cfg = CONFIG.pipes;
    const bodyLeft = pipe.x + cfg.bodyInset;
    const bodyRight = pipe.x + pipe.width - cfg.bodyInset;
    const gapTop = pipe.topHeight;
    const gapBottom = GROUND_Y - pipe.bottomHeight;
    return [
      { left: bodyLeft, right: bodyRight, top: -1000, bottom: gapTop - cfg.capHeight },
      { left: pipe.x, right: pipe.x + pipe.width, top: gapTop - cfg.capHeight, bottom: gapTop },
      { left: pipe.x, right: pipe.x + pipe.width, top: gapBottom, bottom: gapBottom + cfg.capHeight },
      { left: bodyLeft, right: bodyRight, top: gapBottom + cfg.capHeight, bottom: GROUND_Y },
    ];
  }

  function hitsAnyPipe() {
    const box = birdHitbox();
    for (const pipe of game.pipes) {
      if (pipe.x > box.right || pipe.x + pipe.width < box.left) continue;
      for (const rect of pipeRects(pipe)) {
        if (overlaps(box, rect)) return true;
      }
    }
    return false;
  }

  /* ======================================================================
     8. PONTUAÇÃO
     ====================================================================== */
  function updateScore() {
    const box = birdHitbox();
    for (const pipe of game.pipes) {
      // Ponto só quando o pássaro já passou por completo pelo par.
      if (!pipe.scored && box.left > pipe.x + pipe.width) {
        pipe.scored = true;
        game.score += 1;
        saveNow = true;                  // pontuou: grava no próximo quadro
        Sound.score();
      }
    }
  }

  /* ======================================================================
     Atualização por estado
     ====================================================================== */
  function animateWings(dt) {
    game.bird.wingTime += dt;
  }

  function updateScenery(dt) {
    for (const cloud of clouds) {
      cloud.x -= cloud.speed * dt;
      if (cloud.x + cloud.sprite.width < 0) {
        cloud.x = WORLD.width + Math.random() * 40;
        cloud.y = 24 + Math.random() * 190;
      }
    }
  }

  function updateReady(dt) {
    const { bird } = game;
    const cfg = CONFIG.bird;
    game.time += dt;
    game.scroll += CONFIG.scenery.idleScroll * dt;
    bird.y = cfg.startY + Math.sin(game.time * cfg.floatSpeed) * cfg.floatAmplitude;
    bird.vy = 0;
    bird.angle = 0;
    animateWings(dt);
    updateScenery(dt);
  }

  function updatePlaying(dt) {
    const steps = Math.max(1, Math.ceil(dt / CONFIG.timing.physicsStep));
    const h = dt / steps;

    for (let i = 0; i < steps; i++) {
      const touchedGround = stepBirdPhysics(h);
      advanceWorld(h);
      if (touchedGround || hitsAnyPipe()) {   // colisão detectada no mesmo passo em que ocorre
        endGame();
        break;
      }
      updateScore();
    }

    game.time += dt;
    updateBirdAngle(dt);
    animateWings(dt);
    updateScenery(dt);
  }

  function updateGameOver(dt) {
    const { bird } = game;
    game.overTime += dt;
    game.flash = Math.max(0, game.flash - dt * 4);

    if (!bird.landed) {
      const steps = Math.max(1, Math.ceil(dt / CONFIG.timing.physicsStep));
      for (let i = 0; i < steps && !bird.landed; i++) {
        if (stepBirdPhysics(dt / steps)) bird.landed = true;
      }
      updateBirdAngle(dt);
    }

    if (!game.panelShown && game.overTime >= CONFIG.timing.gameOverDelay) {
      game.panelShown = true;
      syncUi();
    }
  }

  function update(dt) {
    if (game.state === STATES.READY) updateReady(dt);
    else if (game.state === STATES.PLAYING) updatePlaying(dt);
    else updateGameOver(dt);
  }

  /* ======================================================================
     9. SPRITES E RENDERIZAÇÃO
     Tudo é desenhado em um canvas de 288 x 512 e depois ampliado sem
     suavização para o canvas visível. Assim o pixel art continua nítido
     em qualquer tamanho de tela e nada é deformado.
     ====================================================================== */
  const canvas = document.getElementById('game-canvas');
  const viewCtx = canvas.getContext('2d');
  const worldCanvas = makeCanvas(WORLD.width, WORLD.height);
  const ctx = worldCanvas.getContext('2d');

  function makeCanvas(width, height) {
    const element = document.createElement('canvas');
    element.width = width;
    element.height = height;
    return element;
  }

  // Gerador pseudoaleatório com semente: o cenário é sempre o mesmo.
  function seededRandom(seed) {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fillRect(target, color, x, y, w, h) {
    target.fillStyle = color;
    target.fillRect(x, y, w, h);
  }

  // Disco "pixelado": cada linha é um retângulo, em células de tamanho `cell`.
  function fillPixelDisc(target, color, cx, cy, radius, cell) {
    target.fillStyle = color;
    for (let dy = -radius; dy <= radius; dy++) {
      const half = Math.round(Math.sqrt(radius * radius - dy * dy));
      target.fillRect((cx - half) * cell, (cy + dy) * cell, half * 2 * cell, cell);
    }
  }

  function paintGrid(target, rows, palette, cell, offsetX = 0, offsetY = 0) {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const key = row[x];
        if (key === '.') continue;
        target.fillStyle = palette[key];
        target.fillRect(offsetX + x * cell, offsetY + y * cell, cell, cell);
      }
    });
  }

  /* ---------- Pássaro (sprite de 34 x 24 px, desenhado em pixels) ---------- */

  const BIRD_COLORS = {
    outline: COLORS.ink,
    body: '#fbd530',
    shade: '#f0a21a',
    gloss: '#fff08a',
    belly: '#fdf0a8',
    white: '#ffffff',
    beakTop: '#f45a1f',
    beakTopLight: '#ff8a4c',
    beakBottom: '#e8481a',
  };

  // Elipse "pixelada": uma linha de 1 px por vez.
  function fillPixelEllipse(target, color, cx, cy, rx, ry) {
    target.fillStyle = color;
    for (let dy = -ry; dy <= ry; dy++) {
      const ratio = (dy * dy) / ((ry + 0.5) * (ry + 0.5));
      const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - ratio)));
      target.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
    }
  }

  // Centro vertical da asa em cada quadro: em cima, no meio e embaixo.
  const WING_CENTERS = [11, 14, 17];

  function buildBirdFrames() {
    const c = BIRD_COLORS;
    return WING_CENTERS.map((wingY) => {
      const sprite = makeCanvas(CONFIG.bird.spriteWidth, CONFIG.bird.spriteHeight);
      const g = sprite.getContext('2d');

      // Corpo: contorno, sombra laranja embaixo, amarelo, brilho e barriga clara.
      fillPixelEllipse(g, c.outline, 14, 12, 14, 11);
      fillPixelEllipse(g, c.shade, 14, 12, 13, 10);
      fillPixelEllipse(g, c.body, 14, 11, 13, 9);
      fillPixelEllipse(g, c.gloss, 10, 5, 5, 1);
      fillPixelEllipse(g, c.belly, 15, 17, 8, 3);

      // Olho: aro escuro, branco e pupila.
      fillPixelEllipse(g, c.outline, 22, 8, 5, 5);
      fillPixelEllipse(g, c.white, 22, 8, 4, 4);
      g.fillStyle = c.outline;
      g.fillRect(24, 6, 2, 5);

      // Bico: parte de cima (mais longa) e de baixo.
      g.fillStyle = c.outline;
      g.fillRect(22, 12, 12, 5);
      g.fillRect(23, 16, 10, 5);
      g.clearRect(33, 12, 1, 1);
      g.fillStyle = c.beakTop;
      g.fillRect(23, 13, 10, 3);
      g.fillStyle = c.beakTopLight;
      g.fillRect(24, 13, 8, 1);
      g.fillStyle = c.beakBottom;
      g.fillRect(24, 17, 8, 3);

      // Asa: contorno, sombra, branco.
      fillPixelEllipse(g, c.outline, 8, wingY, 7, 4);
      fillPixelEllipse(g, c.shade, 8, wingY, 6, 3);
      fillPixelEllipse(g, c.white, 8, wingY - 1, 6, 2);
      return sprite;
    });
  }

  const WING_SEQUENCE = [1, 0, 1, 2];

  /* ---------- Cenário ---------- */

  function buildSky() {
    const sky = makeCanvas(WORLD.width, WORLD.height);
    const target = sky.getContext('2d');
    const bands = COLORS.skyBands;
    const bandHeight = Math.ceil(GROUND_Y / bands.length);
    bands.forEach((color, index) => fillRect(target, color, 0, index * bandHeight, WORLD.width, bandHeight));
    fillRect(target, bands[bands.length - 1], 0, bands.length * bandHeight, WORLD.width, WORLD.height);
    return sky;
  }

  // Silhueta de prédios distantes (ladrilho de 288 px que se repete).
  function buildCity() {
    const height = 96;
    const tile = makeCanvas(WORLD.width, height);
    const target = tile.getContext('2d');
    const random = seededRandom(7);
    let x = -6;
    while (x < WORLD.width) {
      const w = 18 + Math.floor(random() * 5) * 4;
      const h = 28 + Math.floor(random() * 14) * 4;
      const drawAt = (px) => {
        fillRect(target, COLORS.city, px, height - h, w, h);
        for (let wy = height - h + 6; wy < height - 8; wy += 8) {
          for (let wx = px + 4; wx < px + w - 6; wx += 8) {
            fillRect(target, COLORS.cityWindow, wx, wy, 4, 4);
          }
        }
      };
      drawAt(x);
      if (x + w > WORLD.width) drawAt(x - WORLD.width);
      if (x < 0) drawAt(x + WORLD.width);
      x += w + 2 + Math.floor(random() * 3) * 2;
    }
    return tile;
  }

  // Moitas verdes à frente dos prédios (também em ladrilho de 288 px).
  function buildBushes() {
    const height = 40;
    const cell = 2;
    const tile = makeCanvas(WORLD.width, height);
    const target = tile.getContext('2d');
    const random = seededRandom(21);
    const cols = WORLD.width / cell;
    const rows = height / cell;
    const blobs = [];
    for (let cx = 0; cx < cols; cx += 7 + Math.floor(random() * 6)) {
      blobs.push({ cx, radius: 6 + Math.floor(random() * 6) });
    }
    const draw = (color, lift) => {
      for (const blob of blobs) {
        for (const shift of [-cols, 0, cols]) {
          fillPixelDisc(target, color, blob.cx + shift, rows - 1 + lift - Math.floor(blob.radius * 0.35), blob.radius, cell);
        }
      }
    };
    draw(COLORS.bushDark, 0);
    draw(COLORS.bushLight, -1);
    return tile;
  }

  // Chão: faixa de grama listrada em diagonal sobre terra marrom (ladrilho de 288 px).
  function buildGround() {
    const w = WORLD.width;
    const h = WORLD.groundHeight;
    const tile = makeCanvas(w, h);
    const target = tile.getContext('2d');
    const random = seededRandom(99);

    fillRect(target, COLORS.ink, 0, 0, w, 2);
    fillRect(target, COLORS.grassLight, 0, 2, w, 2);

    // Listras diagonais da grama (período de 16 px, divide 288 sem sobras).
    const grassTop = 4;
    const grassHeight = 12;
    for (let y = 0; y < grassHeight; y++) {
      for (let x = 0; x < w; x += 2) {
        const stripe = Math.floor(((x + y * 2) % 16) / 8);
        fillRect(target, stripe === 0 ? COLORS.grassMid : COLORS.grassLight, x, grassTop + y, 2, 1);
      }
    }
    fillRect(target, COLORS.grassDark, 0, grassTop + grassHeight, w, 2);
    fillRect(target, COLORS.ink, 0, grassTop + grassHeight + 2, w, 2);

    // Terra.
    const dirtTop = grassTop + grassHeight + 4;
    fillRect(target, COLORS.dirtEdge, 0, dirtTop, w, 2);
    fillRect(target, COLORS.dirt, 0, dirtTop + 2, w, h - dirtTop - 2);
    fillRect(target, COLORS.dirtDeep, 0, h - 14, w, 14);
    fillRect(target, COLORS.dirtDark, 0, h - 16, w, 2);

    // Detalhes pixelados: torrões e pedrinhas.
    for (let i = 0; i < 60; i++) {
      const x = Math.floor(random() * (w / 2)) * 2;
      const y = dirtTop + 6 + Math.floor(random() * ((h - dirtTop - 24) / 2)) * 2;
      const color = random() < 0.5 ? COLORS.dirtDark : COLORS.dirtLight;
      fillRect(target, color, x, y, random() < 0.5 ? 4 : 2, 2);
    }
    return tile;
  }

  // Nuvens brancas em pixel art, com sombra azulada embaixo.
  function buildCloudSprites() {
    const shapes = [
      [[8, 12, 5], [14, 9, 7], [21, 11, 6], [26, 13, 4], [17, 14, 5]],
      [[6, 10, 4], [11, 8, 6], [17, 10, 5], [21, 11, 3]],
      [[7, 14, 6], [14, 11, 8], [22, 10, 7], [29, 13, 5], [34, 15, 3], [19, 16, 6]],
    ];
    return shapes.map((discs) => {
      const cell = 2;
      const sprite = makeCanvas(48 * cell * 0.75 + 28, 26 * cell);
      const target = sprite.getContext('2d');
      for (const [cx, cy, r] of discs) fillPixelDisc(target, COLORS.cloudShade, cx, cy, r, cell);
      for (const [cx, cy, r] of discs) fillPixelDisc(target, COLORS.cloud, cx, cy - 1, r, cell);
      return sprite;
    });
  }

  const sprites = {
    sky: buildSky(),
    city: buildCity(),
    bushes: buildBushes(),
    ground: buildGround(),
    birdFrames: buildBirdFrames(),
    clouds: buildCloudSprites(),
  };

  function initClouds() {
    const random = seededRandom(5);
    const [minSpeed, maxSpeed] = CONFIG.scenery.cloudSpeed;
    for (let i = 0; i < 5; i++) {
      const sprite = sprites.clouds[i % sprites.clouds.length];
      clouds.push({
        sprite,
        x: (i / 5) * (WORLD.width + 40) + random() * 30 - 20,
        y: 24 + random() * 190,
        speed: minSpeed + random() * (maxSpeed - minSpeed),
      });
    }
  }

  /* ---------- Fonte de pontos para a pontuação (5 x 7) ---------- */

  const DIGITS = {
    0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  };

  function drawScore(value) {
    const text = String(value);
    const cell = 5;                       // cada ponto da fonte vira 5 px no mundo
    const ink = 6;                        // preenchimento ligeiramente maior: traço grosso
    const gap = 6;
    const digitWidth = 5 * cell + 1;
    const totalWidth = text.length * digitWidth + (text.length - 1) * gap;
    const startX = Math.round((WORLD.width - totalWidth) / 2);
    const startY = 40;
    const outline = 2;

    // Primeiro todos os contornos, depois o preenchimento: evita contornos sobre dígitos vizinhos.
    for (const pass of ['outline', 'fill']) {
      for (let i = 0; i < text.length; i++) {
        const glyph = DIGITS[text[i]];
        const originX = startX + i * (digitWidth + gap);
        for (let gy = 0; gy < 7; gy++) {
          for (let gx = 0; gx < 5; gx++) {
            if (glyph[gy][gx] !== '1') continue;
            const px = originX + gx * cell;
            const py = startY + gy * cell;
            if (pass === 'outline') {
              fillRect(ctx, COLORS.ink, px - outline, py - outline, ink + outline * 2, ink + outline * 2 + 2);
            } else {
              fillRect(ctx, COLORS.scoreFill, px, py, ink, ink);
            }
          }
        }
      }
    }
  }

  /* ---------- Canos ---------- */

  function drawPipeShading(x, y, w, h) {
    const [highlight, light, main, shade, dark] = COLORS.pipe;
    fillRect(ctx, main, x, y, w, h);
    fillRect(ctx, light, x, y, 7, h);
    fillRect(ctx, highlight, x + 2, y, 3, h);
    fillRect(ctx, shade, x + w - 12, y, 12, h);
    fillRect(ctx, dark, x + w - 5, y, 5, h);
  }

  function drawPipeBody(x, y, w, h) {
    if (h <= 0) return;
    fillRect(ctx, COLORS.ink, x, y, w, h);
    drawPipeShading(x + 2, y, w - 4, h);
  }

  function drawPipeCap(x, y, shadowDirection) {
    const { width, capHeight } = CONFIG.pipes;
    fillRect(ctx, COLORS.ink, x, y, width, capHeight);
    drawPipeShading(x + 2, y + 2, width - 4, capHeight - 4);
    // Sombra discreta sobre o corpo, junto à extremidade.
    const { bodyInset } = CONFIG.pipes;
    const shadowY = shadowDirection === 'above' ? y - 4 : y + capHeight;
    fillRect(ctx, COLORS.pipeShadow, x + bodyInset + 2, shadowY, width - bodyInset * 2 - 4, 4);
  }

  function drawPipe(pipe) {
    const { capHeight, bodyInset, width } = CONFIG.pipes;
    const x = Math.round(pipe.x);
    const gapTop = Math.round(pipe.topHeight);
    const gapBottom = Math.round(GROUND_Y - pipe.bottomHeight);
    const bodyWidth = width - bodyInset * 2;

    drawPipeBody(x + bodyInset, 0, bodyWidth, gapTop - capHeight);
    drawPipeBody(x + bodyInset, gapBottom + capHeight, bodyWidth, GROUND_Y - (gapBottom + capHeight));
    drawPipeCap(x, gapTop - capHeight, 'above');
    drawPipeCap(x, gapBottom, 'below');
  }

  /* ---------- Pássaro ---------- */

  function drawBird() {
    const { bird } = game;
    const cfg = CONFIG.bird;
    let frameIndex = 1;
    if (game.state !== STATES.GAME_OVER) {
      frameIndex = WING_SEQUENCE[Math.floor(bird.wingTime * cfg.wingFps) % WING_SEQUENCE.length];
    }
    ctx.save();
    ctx.translate(Math.round(bird.x), Math.round(bird.y));
    ctx.rotate(bird.angle);
    ctx.drawImage(sprites.birdFrames[frameIndex], -cfg.spriteWidth / 2, -cfg.spriteHeight / 2);
    ctx.restore();
  }

  /* ---------- Cena ---------- */

  // Desenha um ladrilho de 288 px repetido, deslocado para a esquerda.
  function drawTiled(sprite, offset, y) {
    const w = sprite.width;
    const x = -(((Math.floor(offset) % w) + w) % w);
    ctx.drawImage(sprite, x, y);
    ctx.drawImage(sprite, x + w, y);
  }

  function renderWorld() {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprites.sky, 0, 0);

    for (const cloud of clouds) {
      ctx.drawImage(cloud.sprite, Math.round(cloud.x), Math.round(cloud.y));
    }

    const scenery = CONFIG.scenery;
    drawTiled(sprites.city, game.scroll * scenery.cityParallax, GROUND_Y - sprites.city.height + 4);
    drawTiled(sprites.bushes, game.scroll * scenery.bushParallax, GROUND_Y - sprites.bushes.height + 2);

    for (const pipe of game.pipes) drawPipe(pipe);

    drawBird();
    drawTiled(sprites.ground, game.scroll, GROUND_Y);

    if (game.state === STATES.PLAYING || (game.state === STATES.GAME_OVER && !game.panelShown)) {
      drawScore(game.score);
    }

    if (game.flash > 0) {
      ctx.globalAlpha = Math.min(1, game.flash) * 0.8;
      fillRect(ctx, COLORS.flash, 0, 0, WORLD.width, WORLD.height);
      ctx.globalAlpha = 1;
    }
  }

  function render() {
    renderWorld();
    viewCtx.imageSmoothingEnabled = false;
    viewCtx.drawImage(worldCanvas, 0, 0, canvas.width, canvas.height);
  }

  /* ======================================================================
     10. INTERFACE (painéis em HTML sobre o canvas)
     ====================================================================== */
  const ui = {
    arena: document.getElementById('arena'),
    stageWrap: document.getElementById('stage-wrap'),
    stage: document.getElementById('stage'),
    muteButton: document.getElementById('mute-button'),
    pauseButton: document.getElementById('pause-button'),
    recoveryCount: document.getElementById('recovery-count'),
    restartButton: document.getElementById('restart-button'),
    pauseRestartButton: document.getElementById('pause-restart-button'),
    readyBest: document.getElementById('ready-best'),
    readyBestValue: document.getElementById('ready-best-value'),
    overScore: document.getElementById('over-score'),
    overBest: document.getElementById('over-best'),
    overNew: document.getElementById('over-new'),
    infoButton: document.getElementById('info-button'),
    infoPopover: document.getElementById('info-popover'),
    infoClose: document.getElementById('info-close'),
  };

  function syncUi() {
    const { stage } = ui;
    stage.classList.toggle('is-ready', game.state === STATES.READY);
    stage.classList.toggle('is-playing', game.state === STATES.PLAYING);
    stage.classList.toggle('is-over', game.state === STATES.GAME_OVER);
    stage.classList.toggle('show-panel', game.state === STATES.GAME_OVER && game.panelShown);

    // Botão de pausa: só aparece durante a partida; o rótulo acompanha o estado.
    const playing = game.state === STATES.PLAYING;
    stage.classList.toggle('is-paused', playing && game.paused && !recovery.active);
    ui.pauseButton.hidden = !playing || recovery.active;     // na contagem não há o que continuar
    const pauseText = game.paused ? 'Continuar' : 'Pausar';     // só para leitores de tela e dica
    ui.pauseButton.classList.toggle('is-paused', game.paused);
    ui.pauseButton.setAttribute('aria-pressed', game.paused ? 'true' : 'false');
    ui.pauseButton.setAttribute('aria-label', pauseText);
    ui.pauseButton.setAttribute('data-tip', pauseText + ' (P)');

    ui.readyBest.hidden = game.best <= 0;
    ui.readyBestValue.textContent = String(game.best);

    // Os valores do painel são gravados no fim da partida e não mudam mais.
    if (game.state === STATES.GAME_OVER) {
      ui.overScore.textContent = String(game.score);
      ui.overBest.textContent = String(game.best);
      ui.overNew.hidden = !game.newBest;
    }

    syncRecoveryUi();
  }

  // Contagem "Partida retomada" (3, 2, 1) e o "GO!" logo depois. Só mexe no DOM quando o texto muda.
  function syncRecoveryUi() {
    const playing = game.state === STATES.PLAYING;
    const counting = playing && recovery.active;
    const going = playing && !recovery.active && recovery.go > 0;
    ui.stage.classList.toggle('is-recovery', counting);
    ui.stage.classList.toggle('is-waiting', counting && recovery.waiting);
    ui.stage.classList.toggle('is-go', going);

    let text = null;
    if (counting && !recovery.waiting) text = String(Math.max(1, Math.ceil(recovery.remaining)));
    else if (going) text = 'GO!';

    if (text === null) {
      recovery.shown = null;
    } else if (text !== recovery.shown) {
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
    const muted = Sound.muted;
    ui.muteButton.classList.toggle('is-muted', muted);
    ui.muteButton.setAttribute('aria-pressed', muted ? 'true' : 'false');
    ui.muteButton.setAttribute('aria-label', muted ? 'Ativar efeitos sonoros' : 'Silenciar efeitos sonoros');
  }

  function toggleMute() {
    Sound.setMuted(!Sound.muted);
    syncMuteButton();
  }

  // Ajuda "Como jogar": popover pequeno ancorado ao botão "?", fora da área do jogo.
  // Abrir ou fechar NÃO inicia, pausa nem altera a partida: é só um painel de leitura.
  let infoOpen = false;
  pauseGame();

  const HELP = { gap: 12, edge: 8, compactWidth: 150, minWidth: 168, maxWidth: 240 };

function openInfo() {
  if (infoOpen) return;
  infoOpen = true;
  ui.infoPopover.hidden = false;
  ui.infoButton.setAttribute('aria-expanded', 'true');
  placeHelp();

  // Se a partida está rolando (e não pausada), pausa e anota que foi a ajuda
  if (game.state === STATES.PLAYING && !game.paused) {
    pauseGame();
    pausedByHelp = true;
  }
}

function closeInfo() {
  if (!infoOpen) return;
  infoOpen = false;
  ui.infoPopover.hidden = true;
  ui.infoButton.setAttribute('aria-expanded', 'false');
  // NÃO despausa aqui. Quem despausa é o toque na tela (onPointerDown)
}

  // Escolhe onde o painel abre. A preferência é SEMPRE abaixo do botão:
  //   below = abaixo do botão, alinhado a ele (nunca sobre o jogo quando há espaço)
  // Só quando o painel não cabe na altura que sobra abaixo do botão:
  //   right = à direita do botão (celular deitado, botão ao lado do jogo)
  //   above = acima do botão, que fica numa faixa sob o jogo (celular em pé, sem altura livre)
  function placeHelp() {
    if (!infoOpen) return;
    const pop = ui.infoPopover;
    const arena = ui.arena.getBoundingClientRect();
    const btn = ui.infoButton.getBoundingClientRect();
    const stage = ui.stage.getBoundingClientRect();
    const bottomMode = ui.arena.classList.contains('help-bottom');

    pop.style.removeProperty('--shift');
    pop.style.removeProperty('--arrow-y');
    pop.style.removeProperty('--pop-x');
    pop.style.removeProperty('--arrow-x');
    pop.style.removeProperty('max-height');
    pop.style.removeProperty('overflow-y');

    // 1) Largura e posição horizontal para abrir abaixo do botão.
    let width;
    let left;                                   // borda esquerda do painel, em coordenadas da janela
    if (bottomMode) {
      // Botão na faixa sob o jogo: painel alinhado à direita do botão, dentro da arena.
      width = Math.min(HELP.maxWidth, arena.width - HELP.edge * 2);
      left = btn.right - width;
      left = Math.min(left, arena.right - HELP.edge - width);
      left = Math.max(left, arena.left + HELP.edge);
    } else {
      // Botão ao lado do jogo: painel começa no botão e cresce para o lado de fora do palco.
      const spanLeft = stage.right + HELP.edge;
      const spanRight = arena.right - HELP.edge;
      width = Math.min(HELP.maxWidth, spanRight - spanLeft);
      if (width >= HELP.minWidth) {
        left = Math.min(btn.left, spanRight - width);
        left = Math.max(left, spanLeft);
      } else {
        // Sem largura livre ao lado do palco: único caso em que o painel invade um pouco o jogo,
        // e o mínimo possível (largura mínima legível, encostada na borda direita da arena).
        width = Math.min(Math.max(HELP.compactWidth, spanRight - spanLeft), HELP.minWidth, arena.width - HELP.edge * 2);
        left = Math.max(arena.left + HELP.edge, spanRight - width);
      }
    }
    width = Math.floor(width);
    pop.style.width = `${width}px`;

    // 2) Cabe na altura que sobra abaixo do botão?
    const height = pop.offsetHeight;
    const roomBelow = arena.bottom - (btn.bottom + HELP.gap) - HELP.edge;
    const roomRight = arena.right - btn.right - HELP.gap - HELP.edge;
    let placement = 'below';

    if (height > roomBelow) {
      if (!bottomMode && roomRight >= HELP.minWidth) placement = 'right';
      else if (bottomMode) placement = 'above';
    }

    if (placement === 'below') {
      const arrowX = Math.min(Math.max(btn.left + btn.width / 2 - left, 16), width - 16);
      pop.style.setProperty('--pop-x', `${Math.round(left - btn.left)}px`);
      pop.style.setProperty('--arrow-x', `${Math.round(arrowX)}px`);
      if (height > roomBelow) {
        // Sem espaço nem para os lados: limita a altura e deixa o conteúdo rolar.
        pop.style.maxHeight = `${Math.max(96, Math.floor(roomBelow))}px`;
        pop.style.overflowY = 'auto';
      }
    } else if (placement === 'right') {
      const rightWidth = Math.floor(Math.min(HELP.maxWidth, roomRight));
      pop.style.width = `${rightWidth}px`;
      // Alinha ao topo do botão; se faltar altura, sobe o painel e a seta continua no botão.
      const h = pop.offsetHeight;
      let up = Math.max(0, btn.top + h - (arena.bottom - HELP.edge));
      up = Math.min(up, Math.max(0, btn.top - (arena.top + HELP.edge)));
      const arrow = Math.min(Math.max(19 + up, 16), Math.max(16, h - 16));
      pop.style.setProperty('--shift', `${-up}px`);
      pop.style.setProperty('--arrow-y', `${arrow}px`);
    } else {
      // above: último recurso do celular em pé, quando não sobra altura abaixo do botão.
      pop.style.width = `${Math.floor(Math.max(150, Math.min(HELP.maxWidth, stage.width - 16, arena.width - HELP.edge * 2)))}px`;
    }
    pop.dataset.placement = placement;
  }

  /* ======================================================================
     11. ENTRADA (teclado, mouse e toque)
     Todo comando válido passa por handleAction, que gera no máximo um
     impulso por comando.
     ====================================================================== */
function handleAction() {
    if (recovery.active) {             // retomada: o primeiro toque / Espaço inicia a contagem
      Sound.unlock();
      confirmRecovery();
      return;
    }
    if (game.paused) {                 // AGORA DESPAUSA COM O TECLADO
      if (infoOpen) closeInfo();       // garante que a telinha de ajuda vai fechar
      resumeWithCountdown();
      return;
    }
    Sound.unlock();
    if (game.state === STATES.READY) startGame();
    else if (game.state === STATES.PLAYING) flap();
    else tryRestart();
  }

  const keysHeld = new Set();
  const FLAP_KEYS = new Set(['Space', 'ArrowUp']);

  function onKeyDown(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    // Com a ajuda aberta, Esc fecha só o painel (não pausa); as demais teclas seguem normais.
    if (infoOpen && event.code === 'Escape') {
      event.preventDefault();
      closeInfo();
      return;
    }

    if (FLAP_KEYS.has(event.code)) {
      event.preventDefault();                       // impede a rolagem da página
      if (event.repeat || keysHeld.has(event.code)) return;   // segurar a tecla não repete o impulso
      keysHeld.add(event.code);
      handleAction();
    } else if (event.code === 'Enter') {
      if (game.state === STATES.GAME_OVER && !game.paused) {
        event.preventDefault();
        tryRestart();
      }
    } else if (event.code === 'KeyM' && !event.repeat) {
      toggleMute();
    } else if ((event.code === 'KeyP' || event.code === 'Escape') && !event.repeat) {
      togglePause();
    }
  }

  function onKeyUp(event) {
    keysHeld.delete(event.code);
    // Evita que Espaço "clique" em um botão que esteja com o foco.
    if (event.code === 'Space') event.preventDefault();
  }

function onPointerDown(event) {
  const target = event.target;
  const hit = (selector) => Boolean(target && target.closest && target.closest(selector));

  // Jogo pausado (por qualquer motivo) + toque na tela do jogo = despausa com 3, 2, 1
  if (game.state === STATES.PLAYING && game.paused && !recovery.active
      && hit('#stage') && !hit('button, a, header')) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();          // esse toque só despausa, o pássaro não pula
    if (infoOpen) closeInfo();       // se a ajuda estava aberta, fecha também
    resumeWithCountdown();
    return;
  }
    // Ajuda aberta: tocar fora dela só a fecha. Se o toque foi no jogo, não vira voo nem início.
    if (infoOpen && !hit('.help')) {
      closeInfo();
      if (!hit('button, a, header')) { event.preventDefault(); return; }
    }
    // Botões, links, o cabeçalho da Arcádia e a ajuda não contam como comando de voo.
    if (hit('button, a, header, .help')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;   // só o botão esquerdo
    event.preventDefault();
    handleAction();
  }

  /* ======================================================================
     12. REDIMENSIONAMENTO
     O mundo (288 x 512) é ampliado para o canvas visível. Para não haver
     linhas irregulares, falhas ou bordas nas emendas, o tamanho é calculado
     UMA vez, em pixels físicos, e sempre na proporção exata 9:16:
       - largura = múltiplo de 9  ->  altura = largura * 16 / 9 é inteira,
         então a escala é idêntica na horizontal e na vertical;
       - o buffer do canvas tem exatamente o tamanho do palco em pixels
         físicos (1 pixel do buffer = 1 pixel da tela), sem segunda
         reamostragem feita pelo navegador.
     (Antes, largura e altura eram arredondadas separadamente e o buffer
     era arredondado de novo a partir do tamanho em CSS.)
     ====================================================================== */
  // O botão de ajuda fica ao lado do palco. Se não houver espaço lateral (celular em pé),
  // ele vai para uma faixa logo abaixo do jogo, e essa faixa é descontada da altura.
  const HELP_SIDE_ROOM = 72;     // botão (44) + folga (16) + margem
  const HELP_STRIP = 56;         // faixa abaixo do palco no modo celular em pé

  function fitUnit(boxWidth, boxHeight, pixelRatio, reserveY) {
    const { margin, maxCssHeight } = CONFIG.view;
    const availableWidth = Math.max(1, boxWidth - margin * 2) * pixelRatio;
    const availableHeight = Math.max(1, Math.min(boxHeight - margin * 2 - reserveY, maxCssHeight)) * pixelRatio;
    // Maior múltiplo de 9 (em pixels físicos) que cabe na largura e, pela proporção, na altura.
    return Math.max(1, Math.floor(Math.min(availableWidth / 9, availableHeight / 16)));
  }

  function resizeCanvas() {
    const pixelRatio = window.devicePixelRatio || 1;
    const boxWidth = ui.arena ? ui.arena.clientWidth : window.innerWidth;
    const boxHeight = ui.arena ? ui.arena.clientHeight : window.innerHeight;

    let unit = fitUnit(boxWidth, boxHeight, pixelRatio, 0);
    const sideRoom = (boxWidth - (unit * 9) / pixelRatio) / 2;
    const helpBottom = sideRoom < HELP_SIDE_ROOM;
    if (helpBottom) unit = fitUnit(boxWidth, boxHeight, pixelRatio, HELP_STRIP);
    ui.arena.classList.toggle('help-bottom', helpBottom);

    const bufferWidth = unit * 9;
    const bufferHeight = unit * 16;           // 288:512 = 9:16, exato

    const cssWidth = bufferWidth / pixelRatio;
    const cssHeight = bufferHeight / pixelRatio;
    ui.stage.style.width = `${cssWidth}px`;
    ui.stage.style.height = `${cssHeight}px`;
    ui.stage.style.setProperty('--u', `${cssWidth / WORLD.width}px`);

    canvas.width = bufferWidth;
    canvas.height = bufferHeight;

    render();     // redimensionar limpa o canvas: redesenha na hora para não piscar
    placeHelp();  // reposiciona o painel de ajuda, se estiver aberto
  }

  /* ======================================================================
     13. LOOP PRINCIPAL E INICIALIZAÇÃO
     ====================================================================== */
  let rafId = null;
  let lastTime = null;

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    clockNow = now;
    if (lastTime === null) lastTime = now;
    const elapsed = Math.min(Math.max((now - lastTime) / 1000, 0), 0.25);   // tempo real, sem o limite do jogo
    const dt = Math.min(elapsed, CONFIG.timing.maxFrameTime);
    lastTime = now;

    if (recovery.active) {
      tickRecovery(elapsed);          // contagem de retomada: a simulação continua congelada
    } else {
      if (!game.paused) update(dt);   // pausado: nada avança, mas o loop (único) continua
      if (recovery.go > 0) tickGo(elapsed);
    }
    autosaveRun();
    render();
  }

  function startLoop() {
    if (rafId !== null) return;      // garante um único loop
    lastTime = null;
    rafId = requestAnimationFrame(frame);
  }

  let booted = false;

  function onVisibilityChange() {
    lastTime = null;
    if (document.visibilityState !== 'hidden') return;
    persistRun();                                         // saiu da aba / recarregando: grava o quadro exato
    if (CONFIG.recovery.onTabReturn) guardOnReturn();     // ao voltar, passa pela contagem
  }

  function onPageShow(event) {
    if (!event.persisted) return;     // carga normal: o init() já cuidou da restauração
    lastTime = null;
    guardOnReturn();                  // página reaberta pelo cache do navegador (voltar/avançar)
  }

  function init() {
    if (booted) return;               // garante uma única inicialização (um loop, uma restauração)
    booted = true;
    game.best = Store.getBest();
    initClouds();
    resetRound();
    restoreSavedRun();                // partida salva em andamento? volta pausada, com contagem
    syncMuteButton();

    document.addEventListener('keydown', onKeyDown, { passive: false });
    document.addEventListener('keyup', onKeyUp, { passive: false });
    document.addEventListener('pointerdown', onPointerDown, { passive: false });
    // Alguns navegadores só liberam áudio ao soltar o dedo / o botão.
    document.addEventListener('pointerup', () => Sound.unlock());
    document.addEventListener('contextmenu', (event) => event.preventDefault());
    window.addEventListener('blur', () => keysHeld.clear());

    ui.restartButton.addEventListener('click', (event) => {
      event.stopPropagation();
      tryRestart();                  // só reinicia; nunca inicia uma nova partida
    });
    ui.pauseRestartButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (infoOpen) closeInfo();     // se a ajuda estava aberta (teclado), não deixa o painel na tela inicial
      discardRun();
      ui.pauseRestartButton.blur();  // Espaço não deve acionar o botão depois
    });
    ui.muteButton.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleMute();
      ui.muteButton.blur();          // Espaço não deve acionar o botão depois
    });

    ui.infoButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (infoOpen) closeInfo(); else openInfo();
      if (event.detail > 0) ui.infoButton.blur();   // clique/toque: Espaço não deve acionar o botão depois
    });
    ui.infoClose.addEventListener('click', (event) => {
      event.stopPropagation();
      closeInfo();
    });
    ui.pauseButton.addEventListener('click', (event) => {
      event.stopPropagation();
      togglePause();
      ui.pauseButton.blur();         // Espaço não deve acionar o botão depois
    });

    // Tooltips (data-tip): o CSS cuida do atraso. Aqui só some na hora ao pressionar e não volta
    // até o mouse sair e entrar de novo (sem isso, o :hover traria o tooltip de volta depois do clique).
    document.querySelectorAll('[data-tip]').forEach((el) => {
      el.addEventListener('pointerdown', () => el.setAttribute('data-tip-off', ''));
      ['pointerenter', 'pointerleave', 'pointercancel'].forEach((type) => el.addEventListener(type, () => el.removeAttribute('data-tip-off')));
    });

    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', resizeCanvas);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', resizeCanvas);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', persistRun);      // F5 / fechar: grava o estado exato
    window.addEventListener('pageshow', onPageShow);

    resizeCanvas();
    startLoop();
  }

  init();

  // Atalho para depuração no console: __flappy.game.score, __flappy.CONFIG, ...
  window.__flappy = { game, CONFIG, recovery };
})();