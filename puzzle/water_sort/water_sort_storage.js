/* ==========================================================================
   puzzle/water_sort/water_sort_storage.js - persistência exclusiva do Water Sort (Tubos de Cores)

   Script clássico (sem módulos ES). Carregue ANTES de water_sort.js.
   Expõe um único objeto global: WaterSortStorage.

   Dados guardados:
     water_sort:unlocked -> maior fase liberada (inteiro >= 1). Fases abaixo dela estão concluídas.
     water_sort:last     -> última fase jogada (inteiro >= 1)
     water_sort:muted    -> '1' = som desligado, '0' = som ligado

   O jogo não tem recorde de pontuação, então nada além disso é guardado.

   Garantias:
     - nunca lança exceção (modo privado, cookies bloqueados, cota cheia...);
     - sem armazenamento persistente, os valores ficam em memória na sessão;
     - dado ausente ou inválido vira o padrão seguro (fase 1, som ligado);
     - a fase liberada nunca diminui por engano;
     - migra uma vez o progresso/som salvos pelo sistema compartilhado antigo (game_storage.js), se existirem.
   ========================================================================== */
(() => {
  'use strict';

  const MAX_LEVEL = 99999;
  const DEFAULTS = Object.freeze({ unlocked: 1, last: 1, muted: false });
  const KEYS = Object.freeze({ unlocked: 'water_sort:unlocked', last: 'water_sort:last', muted: 'water_sort:muted' });
  const LEGACY_MUTED = 'arcadia.water_sort.muted';   // chave que o jogo já usava para o som
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

  const asLevel = (value) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_LEVEL) : null;
  };

  /* ---- migração do sistema compartilhado antigo (roda só se ainda não há dado novo) ---- */
  function legacyUnlocked() {
    let best = null;
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (!key || key.indexOf('water_sort') === -1 || key.indexOf('water_sort:') === 0 || key === LEGACY_MUTED) continue;
        const raw = window.localStorage.getItem(key);
        let found = null;
        if (/unlocked$/.test(key)) {                       // chave solta: "...unlocked" = número
          try { found = asLevel(JSON.parse(raw)); } catch (error) { found = asLevel(raw); }
        } else {                                           // registro único em JSON: { unlocked: n, ... }
          try { const obj = JSON.parse(raw); if (obj && typeof obj === 'object') found = asLevel(obj.unlocked); } catch (error) { /* não é JSON */ }
        }
        if (found && (!best || found > best)) best = found;
      }
    } catch (error) { /* sem acesso: nada a migrar */ }
    return best;
  }

  function migrate() {
    if (readRaw(KEYS.unlocked) === null) {
      const old = legacyUnlocked();
      if (old) writeRaw(KEYS.unlocked, old);
    }
    if (readRaw(KEYS.muted) === null) {
      const old = readRaw(LEGACY_MUTED);
      if (old === '1' || old === '0') writeRaw(KEYS.muted, old);
    }
  }

  function getUnlocked() {
    return asLevel(readRaw(KEYS.unlocked)) || DEFAULTS.unlocked;
  }

  // Só sobe: devolve a maior fase liberada vigente.
  function setUnlocked(level) {
    const n = asLevel(level), current = getUnlocked();
    if (!n || n <= current) return current;
    writeRaw(KEYS.unlocked, n);
    return n;
  }

  function getLast() {
    return asLevel(readRaw(KEYS.last)) || DEFAULTS.last;
  }

  function setLast(level) {
    const n = asLevel(level);
    if (!n) return getLast();
    writeRaw(KEYS.last, n);
    return n;
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

  migrate();

  window.WaterSortStorage = Object.freeze({ KEYS, DEFAULTS, getUnlocked, setUnlocked, getLast, setLast, isMuted, setMuted });
})();
