/* ==========================================================================
   arcade/piano_tap/piano_tap_storage.js - persistência exclusiva do Piano Tap

   Script clássico (sem módulos ES). Carregue ANTES de piano_tap.js.
   Expõe um único objeto global: PianoTapStorage.

   Dados guardados:
     piano_tap:best  -> maior pontuação (inteiro >= 0)
     piano_tap:muted -> '1' = som desligado, '0' = som ligado
     piano_tap:save  -> instantâneo completo da partida em andamento (JSON); apagado ao reiniciar/terminar

   Garantias:
     - nunca lança exceção (modo privado, cookies bloqueados, cota cheia...);
     - sem armazenamento persistente, os valores ficam em memória na sessão;
     - dado ausente ou inválido vira o padrão seguro (recorde 0, som ligado);
     - o recorde salvo nunca diminui por engano;
     - o salvamento da partida é opaco aqui: quem valida o conteúdo é piano_tap.js (dado corrompido => null);
     - migra uma vez o recorde/som salvos antes (chaves antigas "piano-tap:*" e o registro do game_storage.js), se existirem.
   ========================================================================== */
(() => {
  'use strict';

  const MAX_BEST = 1e9;
  const DEFAULTS = Object.freeze({ best: 0, muted: false });
  const KEYS = Object.freeze({ best: 'piano_tap:best', muted: 'piano_tap:muted', save: 'piano_tap:save' });
  const LEGACY = Object.freeze({ best: 'piano-tap:best', muted: 'piano-tap:muted' });   // chaves que o jogo já usou
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

  const asScore = (value) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n >= 0 ? Math.min(n, MAX_BEST) : null;
  };

  /* ---- migração (roda só se ainda não há dado novo) ---- */
  function legacyBest() {
    let best = asScore(readRaw(LEGACY.best));
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (!key || key.indexOf('piano_tap') === -1 || key.indexOf('piano_tap:') === 0) continue;
        const raw = window.localStorage.getItem(key);
        let found = null;
        if (/best$/.test(key)) {                           // chave solta: "...best" = número
          try { found = asScore(JSON.parse(raw)); } catch (error) { found = asScore(raw); }
        } else {                                           // registro único em JSON: { best: n, ... }
          try { const obj = JSON.parse(raw); if (obj && typeof obj === 'object') found = asScore(obj.best); } catch (error) { /* não é JSON */ }
        }
        if (found !== null && (best === null || found > best)) best = found;
      }
    } catch (error) { /* sem acesso: nada a migrar */ }
    return best;
  }

  function migrate() {
    if (readRaw(KEYS.best) === null) {
      const old = legacyBest();
      if (old) writeRaw(KEYS.best, old);
    }
    if (readRaw(KEYS.muted) === null) {
      const old = readRaw(LEGACY.muted);
      if (old === '1' || old === '0') writeRaw(KEYS.muted, old);
    }
  }

  function getBest() {
    const n = asScore(readRaw(KEYS.best));
    return n === null ? DEFAULTS.best : n;
  }

  // Só sobe: devolve o recorde vigente.
  function setBest(score) {
    const n = asScore(score), current = getBest();
    if (n === null || n <= current) return current;
    writeRaw(KEYS.best, n);
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

  function removeRaw(key) {
    delete memory[key];
    try { window.localStorage.removeItem(key); } catch (error) { /* nada a remover */ }
  }

  // Partida em andamento: objeto simples serializável. Devolve true se gravou de fato no navegador.
  function saveGame(data) {
    try { return writeRaw(KEYS.save, JSON.stringify(data)); }
    catch (error) { return false; }
  }

  // Devolve o objeto salvo ou null (ausente, ilegível ou não-objeto; nesse caso o lixo é apagado).
  function loadGame() {
    const raw = readRaw(KEYS.save);
    if (raw === null) return null;
    try {
      const data = JSON.parse(raw);
      if (data && typeof data === 'object' && !Array.isArray(data)) return data;
    } catch (error) { /* cai no descarte abaixo */ }
    removeRaw(KEYS.save);
    return null;
  }

  function clearGame() { removeRaw(KEYS.save); }

  migrate();

  window.PianoTapStorage = Object.freeze({ KEYS, DEFAULTS, getBest, setBest, isMuted, setMuted, saveGame, loadGame, clearGame });
})();