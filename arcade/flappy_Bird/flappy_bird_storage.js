/* ==========================================================================
   arcade/flappy_bird/flappy_bird_storage.js - persistência exclusiva do Flappy Bird

   Script clássico (sem módulos ES), como o resto do jogo. Deve ser carregado
   ANTES de flappy_bird.js e expõe um único objeto global: FlappyBirdStorage.

   Dados guardados (as chaves são as mesmas que o jogo já usava, então os
   recordes e preferências existentes continuam valendo, sem migração):
     flappy-bird:best   -> recorde (inteiro >= 0)
     flappy-bird:muted  -> '1' = som desligado, '0' = som ligado

   Garantias:
     - nunca lança exceção (modo privado, cookies bloqueados, cota cheia...);
     - sem armazenamento persistente, os valores ficam em memória durante a sessão;
     - dado ausente, inválido ou corrompido vira o valor padrão seguro;
     - o recorde salvo nunca diminui por engano.
   ========================================================================== */

(() => {
  'use strict';

  const KEYS = Object.freeze({
    best: 'flappy-bird:best',
    muted: 'flappy-bird:muted',
  });

  const DEFAULTS = Object.freeze({
    best: 0,
    muted: false,
  });

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

  window.FlappyBirdStorage = Object.freeze({
    KEYS,
    DEFAULTS,
    getBest,
    setBest,
    isMuted,
    setMuted,
  });
})();