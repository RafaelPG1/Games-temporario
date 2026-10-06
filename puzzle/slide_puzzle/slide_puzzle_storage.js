/* ==========================================================================
   puzzle/slide_puzzle/slide_puzzle_storage.js - persistência exclusiva do Quebra-Cabeça Deslizante

   Script clássico (sem módulos ES). Carregue ANTES de slide_puzzle.js.
   Expõe um único objeto global: SlidePuzzleStorage.

   Dados guardados (chaves iguais às que o jogo já usava):
     slide_puzzle:level        -> última dificuldade: 'easy' | 'medium' | 'hard'
     slide_puzzle:muted        -> '1' = som desligado, '0' = som ligado
     slide_puzzle:best:<nível> -> melhor resultado do nível, JSON { moves, time }
                                  (menos movimentos; em empate, menor tempo em ms)

   Garantias:
     - nunca lança exceção (modo privado, cookies bloqueados, cota cheia...);
     - sem armazenamento persistente, os valores ficam em memória na sessão;
     - dado ausente ou inválido vira o padrão seguro (nível médio, som ligado, sem recorde);
     - o melhor resultado salvo nunca piora por engano.
   ========================================================================== */
(() => {
  'use strict';

  const LEVELS = Object.freeze(['easy', 'medium', 'hard']);
  const DEFAULTS = Object.freeze({ level: 'medium', muted: false });
  const KEYS = Object.freeze({
    level: 'slide_puzzle:level',
    muted: 'slide_puzzle:muted',
    best: (level) => `slide_puzzle:best:${level}`,
  });
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

  const validLevel = (level) => LEVELS.includes(level);
  const validResult = (r) => Boolean(r) && Number.isFinite(r.moves) && r.moves > 0 && Number.isFinite(r.time) && r.time >= 0;
  const isBetter = (a, b) => !b || a.moves < b.moves || (a.moves === b.moves && a.time < b.time);

  function getLevel() {
    const raw = readRaw(KEYS.level);
    return validLevel(raw) ? raw : DEFAULTS.level;
  }

  function setLevel(level) {
    if (!validLevel(level)) return getLevel();
    writeRaw(KEYS.level, level);
    return level;
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

  // Devolve { moves, time } ou null se o nível ainda não tem recorde válido.
  function getBest(level) {
    if (!validLevel(level)) return null;
    try {
      const parsed = JSON.parse(readRaw(KEYS.best(level)));
      if (validResult(parsed)) return { moves: Math.floor(parsed.moves), time: Math.round(parsed.time) };
    } catch (error) { /* JSON inválido: sem recorde */ }
    return null;
  }

  // Grava só se o resultado for válido e melhor que o atual. Devolve o melhor resultado vigente.
  function setBest(level, result) {
    if (!validLevel(level) || !validResult(result)) return getBest(level);
    const candidate = { moves: Math.floor(result.moves), time: Math.round(result.time) };
    const current = getBest(level);
    if (!isBetter(candidate, current)) return current;
    writeRaw(KEYS.best(level), JSON.stringify(candidate));
    return candidate;
  }

  window.SlidePuzzleStorage = Object.freeze({ LEVELS, KEYS, DEFAULTS, getLevel, setLevel, isMuted, setMuted, getBest, setBest });
})();
