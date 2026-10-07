/* ==========================================================================
   arcade/flappy_bird/flappy_bird_storage.js - persistência exclusiva do Flappy Bird

   Script clássico (sem módulos ES), como o resto do jogo. Deve ser carregado
   ANTES de flappy_bird.js e expõe um único objeto global: FlappyBirdStorage.

   Dados guardados (as chaves antigas continuam as mesmas, sem migração):
     flappy-bird:best   -> recorde (inteiro >= 0)
     flappy-bird:muted  -> '1' = som desligado, '0' = som ligado
     flappy-bird:run    -> partida EM ANDAMENTO (JSON), usada para voltar de onde
                           parou depois de um F5. Só existe enquanto a partida
                           estiver viva: o Game Over apaga essa chave, o recorde
                           fica na chave própria.

   Partida salva (versão 1):
     { v, status: 'playing', savedAt, score, level, speed, scroll, time, lastGapY,
       bird:  { x, y, vy, angle, wingTime },
       pipes: [ { x, gapY, gapSize, scored } ],   // do mais antigo ao mais novo
       clouds:[ { x, y } ] }                      // só decoração

   Garantias:
     - nunca lança exceção (modo privado, cookies bloqueados, cota cheia...);
     - sem armazenamento persistente, os valores ficam em memória durante a sessão;
     - dado ausente, inválido, corrompido, de outra versão ou velho demais vira
       "sem partida salva" (e é apagado), nunca uma partida quebrada;
     - o recorde salvo nunca diminui por engano.
   ========================================================================== */

(() => {
  'use strict';

  const KEYS = Object.freeze({
    best: 'flappy-bird:best',
    muted: 'flappy-bird:muted',
    run: 'flappy-bird:run',
  });

  const DEFAULTS = Object.freeze({
    best: 0,
    muted: false,
  });

  const RUN_VERSION = 1;
  const RUN_MAX_AGE_MS = 2 * 60 * 60 * 1000;   // partida parada há mais que isso não volta
  const RUN_CLOCK_SKEW_MS = 60 * 1000;         // tolera relógio levemente adiantado
  const RUN_MAX_SCORE = 99999;
  const RUN_MAX_PIPES = 8;
  const RUN_MAX_CLOUDS = 12;

  // Espelho em memória: garante o comportamento correto se o localStorage falhar.
  const memory = {};

  function readRaw(key) {
    try {
      const value = window.localStorage.getItem(key);
      if (value !== null) return value;
    } catch (error) {
      /* armazenamento indisponível: usa a memória */
    }
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
  }

  function writeRaw(key, value) {
    const text = String(value);
    memory[key] = text;
    try {
      window.localStorage.setItem(key, text);
      return true;
    } catch (error) {
      return false;      // o jogo continua normalmente, só sem persistência
    }
  }

  function removeRaw(key) {
    delete memory[key];
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      /* nada a fazer */
    }
  }

  function parseBest(raw) {
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULTS.best;
    return Math.min(parsed, Number.MAX_SAFE_INTEGER);
  }

  function parseMuted(raw) {
    if (raw === '1') return true;
    if (raw === '0') return false;
    return DEFAULTS.muted;
  }

  function getBest() {
    return parseBest(readRaw(KEYS.best));
  }

  // Grava apenas se for um número válido e maior que o recorde atual.
  function setBest(value) {
    const number = Math.floor(Number(value));
    if (!Number.isFinite(number) || number <= 0) return getBest();
    const best = Math.max(number, getBest());
    writeRaw(KEYS.best, best);
    return best;
  }

  function isMuted() {
    return parseMuted(readRaw(KEYS.muted));
  }

  function setMuted(value) {
    const muted = Boolean(value);
    writeRaw(KEYS.muted, muted ? '1' : '0');
    return muted;
  }

  /* ---------- Partida em andamento ---------- */

  const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
  const inRange = (value, min, max) => isNum(value) && value >= min && value <= max;
  const round = (value, digits = 3) => {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  };

  // Valida e normaliza uma partida (usada ao gravar e ao ler). Devolve uma cópia
  // limpa ou null. Aqui só entram limites "de sanidade"; as regras do jogo
  // (chão, colisão com cano...) são conferidas pelo próprio jogo ao restaurar.
  function cleanRun(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (raw.v !== RUN_VERSION || raw.status !== 'playing') return null;

    if (!isNum(raw.savedAt)) return null;
    const age = Date.now() - raw.savedAt;
    if (age > RUN_MAX_AGE_MS || age < -RUN_CLOCK_SKEW_MS) return null;

    if (!Number.isInteger(raw.score) || raw.score < 0 || raw.score > RUN_MAX_SCORE) return null;
    if (!Number.isInteger(raw.level) || raw.level < 0 || raw.level > RUN_MAX_SCORE) return null;
    if (!inRange(raw.speed, 0, 5000)) return null;
    if (!inRange(raw.scroll, 0, 1e12) || !inRange(raw.time, 0, 1e12)) return null;
    if (raw.lastGapY !== null && !inRange(raw.lastGapY, -1000, 2000)) return null;

    const b = raw.bird;
    if (!b || typeof b !== 'object') return null;
    if (!inRange(b.x, -1000, 2000) || !inRange(b.y, -1000, 2000) || !inRange(b.vy, -5000, 5000)
        || !inRange(b.angle, -6.3, 6.3) || !inRange(b.wingTime, 0, 1e9)) return null;

    if (!Array.isArray(raw.pipes) || raw.pipes.length > RUN_MAX_PIPES) return null;
    const pipes = [];
    for (const p of raw.pipes) {
      if (!p || typeof p !== 'object') return null;
      if (!inRange(p.x, -1000, 3000) || !inRange(p.gapY, -1000, 2000)
          || !inRange(p.gapSize, 20, 1000) || typeof p.scored !== 'boolean') return null;
      pipes.push({ x: round(p.x), gapY: round(p.gapY), gapSize: round(p.gapSize), scored: p.scored });
    }

    // Nuvens são só decoração: se vierem estragadas, perde-se apenas elas.
    const clouds = [];
    if (Array.isArray(raw.clouds) && raw.clouds.length <= RUN_MAX_CLOUDS) {
      let valid = true;
      for (const c of raw.clouds) {
        if (!c || !inRange(c.x, -1000, 3000) || !inRange(c.y, -1000, 2000)) { valid = false; break; }
        clouds.push({ x: round(c.x), y: round(c.y) });
      }
      if (!valid) clouds.length = 0;
    }

    return {
      v: RUN_VERSION,
      status: 'playing',
      savedAt: Math.round(raw.savedAt),
      score: raw.score,
      level: raw.level,
      speed: round(raw.speed),
      scroll: round(raw.scroll),
      time: round(raw.time),
      lastGapY: raw.lastGapY === null ? null : round(raw.lastGapY),
      bird: {
        x: round(b.x), y: round(b.y), vy: round(b.vy), angle: round(b.angle, 4), wingTime: round(b.wingTime),
      },
      pipes,
      clouds,
    };
  }

  // Grava a partida em andamento. O objeto recebido é só o "retrato" do jogo
  // (sem v/status/savedAt, que são colocados aqui). Devolve true se persistiu.
  function saveRun(run) {
    const clean = cleanRun({ ...run, v: RUN_VERSION, status: 'playing', savedAt: Date.now() });
    if (!clean) return false;
    return writeRaw(KEYS.run, JSON.stringify(clean));
  }

  // Devolve a partida salva (já validada) ou null. Dado inválido é apagado.
  // Ler NÃO apaga uma partida válida: ela só some no Game Over (clearRun).
  function loadRun() {
    const raw = readRaw(KEYS.run);
    if (raw === null) return null;
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      parsed = null;
    }
    const clean = cleanRun(parsed);
    if (!clean) removeRaw(KEYS.run);
    return clean;
  }

  function clearRun() {
    removeRaw(KEYS.run);
  }

  window.FlappyBirdStorage = Object.freeze({
    KEYS,
    DEFAULTS,
    getBest,
    setBest,
    isMuted,
    setMuted,
    saveRun,
    loadRun,
    clearRun,
  });
})();