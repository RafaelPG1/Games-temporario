'use strict';
/* arcade/pac_man/pacman_storage.js - dados persistentes exclusivos do Pac-Man (sem sistemas globais).
   Um único registro JSON no localStorage. Se o navegador bloquear o armazenamento (modo privado etc.),
   os valores continuam valendo durante a sessão e o jogo não quebra. */
const PacmanStorage = (() => {
  const KEY = 'arcadia:pac_man';
  const LEGACY = { best: 'pac_man:best', muted: 'pac_man:muted' };   // chaves antigas, importadas uma única vez
  let data = null;

  const rawGet = (k) => { try { return window.localStorage.getItem(k); } catch (e) { return null; } };
  const rawSet = (k, v) => { try { window.localStorage.setItem(k, v); } catch (e) { /* sem armazenamento: segue só na memória */ } };
  const toInt = (v, min) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= min ? n : min; };

  function load() {
    if (data) return data;
    let saved = null;
    const raw = rawGet(KEY);
    if (raw) { try { saved = JSON.parse(raw); } catch (e) { saved = null; } }
    const fresh = !saved || typeof saved !== 'object';
    if (fresh) saved = { best: rawGet(LEGACY.best), muted: rawGet(LEGACY.muted) === '1' };
    data = { best: toInt(saved.best, 0), bestLevel: toInt(saved.bestLevel, 1), muted: saved.muted === true };
    if (fresh && (data.best > 0 || data.muted)) persist();
    return data;
  }
  function persist() { rawSet(KEY, JSON.stringify(data)); }

  return {
    getBest() { return load().best; },
    setBest(n) { const d = load(), v = toInt(n, 0); if (v > d.best) { d.best = v; persist(); } return d.best; },   // só grava se for maior
    getBestLevel() { return load().bestLevel; },
    setBestLevel(n) { const d = load(), v = toInt(n, 1); if (v > d.bestLevel) { d.bestLevel = v; persist(); } return d.bestLevel; },
    getMuted() { return load().muted; },
    setMuted(on) { const d = load(); d.muted = on === true; persist(); return d.muted; },
  };
})();