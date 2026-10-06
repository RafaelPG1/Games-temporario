/* ==========================================================================
   puzzle/memory_match/memory_match_storage.js - persistência exclusiva do Jogo da Memória

   Script clássico (sem módulos ES). Carregue ANTES de memory_match.js.
   Expõe um único objeto global: MemoryMatchStorage.

   Dados guardados:
     memory_match:best  -> recorde: maior pontuação já alcançada (inteiro >= 0)
     memory_match:muted -> '1' = som desligado, '0' = som ligado
   Se a chave nova ainda não existe, lê as chaves antigas do jogo (memory:best / memory:muted).

   Garantias:
     - nunca lança exceção (modo privado, cookies bloqueados, cota cheia...);
     - sem armazenamento persistente, os valores ficam em memória na sessão;
     - dado ausente ou inválido vira o padrão seguro (recorde 0, som ligado);
     - o recorde salvo nunca diminui por engano.
   ========================================================================== */
(() => {
  'use strict';

  const KEYS = Object.freeze({ best: 'memory_match:best', muted: 'memory_match:muted' });
  const LEGACY = Object.freeze({ best: 'memory:best', muted: 'memory:muted' });
  const DEFAULTS = Object.freeze({ best: 0, muted: false });
  const memory = {};

  function readRaw(key) {
    try {
      const value = window.localStorage.getItem(key);
      if (value !== null) return value;
    } catch (error) { /* armazenamento indisponível: usa a memória */ }
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
  }

  function writeRaw(key, value) {
    const text = String(value);
    memory[key] = text;
    try { window.localStorage.setItem(key, text); return true; }
    catch (error) { return false; }     // o jogo segue normalmente, só sem persistência
  }

  const parseBest = (raw) => {
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, Number.MAX_SAFE_INTEGER) : 0;
  };

  function getBest() {
    return Math.max(parseBest(readRaw(KEYS.best)), parseBest(readRaw(LEGACY.best)), DEFAULTS.best);
  }

  // Grava apenas se for um número válido e maior que o recorde atual. Devolve o recorde vigente.
  function setBest(value) {
    const number = Math.floor(Number(value));
    if (!Number.isFinite(number) || number <= 0) return getBest();
    const best = Math.max(number, getBest());
    writeRaw(KEYS.best, best);
    return best;
  }

  function isMuted() {
    let raw = readRaw(KEYS.muted);
    if (raw === null) raw = readRaw(LEGACY.muted);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return DEFAULTS.muted;
  }

  function setMuted(value) {
    const muted = Boolean(value);
    writeRaw(KEYS.muted, muted ? '1' : '0');
    return muted;
  }

  window.MemoryMatchStorage = Object.freeze({ KEYS, DEFAULTS, getBest, setBest, isMuted, setMuted });
})();