/* ==========================================================================
   arcade/jumpy/jumpy_storage.js - persistência exclusiva do Pula-Pula (Jumpy)

   Script clássico (sem módulos ES). Carregue ANTES de jumpy.js.
   Expõe um único objeto global: JumpyStorage.

   Dados guardados:
     jumpy:muted -> '1' = som desligado, '0' = som ligado
                    (a mesma chave que o jogo já usava antes do registro compartilhado)
     jumpy:best  -> recorde: maior score já alcançado (inteiro >= 0)

   Garantias:
     - nunca lança exceção (modo privado, cookies bloqueados, cota cheia...);
     - sem armazenamento persistente, o valor fica em memória na sessão;
     - dado ausente ou inválido vira o padrão seguro (som ligado, recorde 0);
     - o recorde salvo nunca diminui por engano.
   ========================================================================== */
(() => {
  'use strict';

  const KEYS = Object.freeze({ muted: 'jumpy:muted', best: 'jumpy:best' });
  const DEFAULTS = Object.freeze({ muted: false, best: 0 });
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

  function isMuted() {
    const raw = readRaw(KEYS.muted);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return DEFAULTS.muted;
  }

  function setMuted(value) {
    const muted = Boolean(value);
    writeRaw(KEYS.muted, muted ? '1' : '0');
    return muted;
  }

  function getBest() {
    const parsed = parseInt(readRaw(KEYS.best), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULTS.best;
    return Math.min(parsed, Number.MAX_SAFE_INTEGER);
  }

  // Grava apenas se for um número válido e maior que o recorde atual. Devolve o recorde vigente.
  function setBest(value) {
    const number = Math.floor(Number(value));
    if (!Number.isFinite(number) || number <= 0) return getBest();
    const best = Math.max(number, getBest());
    writeRaw(KEYS.best, best);
    return best;
  }

  window.JumpyStorage = Object.freeze({ KEYS, DEFAULTS, isMuted, setMuted, getBest, setBest });
})();
