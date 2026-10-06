/* ==========================================================================
   puzzle/campo_minado/campo_minado_storage.js - persistência exclusiva do Campo Minado

   Script clássico (sem módulos ES). Carregue ANTES de campo_minado.js.
   Expõe um único objeto global: CampoMinadoStorage.

   Dados guardados:
     campo_minado:level          -> última dificuldade escolhida: easy | medium | hard
                                    (mesma chave que o jogo já usava antes do registro compartilhado)
     campo_minado:best:<nível>   -> melhor tempo (ms inteiros) de vitória naquele nível
     campo_minado:game           -> partida em andamento (JSON), para sobreviver ao F5; apagada ao vencer/perder

   Garantias:
     - nunca lança exceção (modo privado, cookies bloqueados, cota cheia...);
     - sem armazenamento persistente, o valor fica em memória durante a sessão;
     - dado ausente ou inválido vira o padrão seguro (nível fácil, sem recorde);
     - o melhor tempo salvo nunca piora por engano.
   ========================================================================== */
(() => {
  'use strict';

  const LEVEL_IDS = Object.freeze(['easy', 'medium', 'hard']);
  const DEFAULTS = Object.freeze({ level: 'easy' });
  const KEYS = Object.freeze({
    level: 'campo_minado:level',
    best: (level) => `campo_minado:best:${level}`,
    game: 'campo_minado:game',
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

  const isLevel = (level) => LEVEL_IDS.indexOf(level) !== -1;

  function getLevel() {
    const raw = readRaw(KEYS.level);
    return isLevel(raw) ? raw : DEFAULTS.level;
  }

  function setLevel(level) {
    if (!isLevel(level)) return getLevel();
    writeRaw(KEYS.level, level);
    return level;
  }

  // Melhor tempo (ms) do nível, ou null se ainda não há vitória registrada.
  function getBestTime(level) {
    if (!isLevel(level)) return null;
    const parsed = parseInt(readRaw(KEYS.best(level)), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.min(parsed, Number.MAX_SAFE_INTEGER);
  }

  // Grava só se for um tempo válido e menor que o atual. Devolve { best, isRecord }.
  function setBestTime(level, ms) {
    const best = getBestTime(level);
    const time = Math.floor(Number(ms));
    if (!isLevel(level) || !Number.isFinite(time) || time <= 0) return { best, isRecord: false };
    if (best !== null && time >= best) return { best, isRecord: false };
    writeRaw(KEYS.best(level), time);
    return { best: time, isRecord: true };
  }

  // Partida em andamento. O jogo valida o conteúdo ao restaurar; aqui só garantimos que é um objeto JSON.
  function getGame() {
    try {
      const data = JSON.parse(readRaw(KEYS.game));
      return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
    } catch (error) { return null; }
  }
  function setGame(data) {
    try { return writeRaw(KEYS.game, JSON.stringify(data)); } catch (error) { return false; }
  }
  function clearGame() {
    delete memory[KEYS.game];
    try { window.localStorage.removeItem(KEYS.game); } catch (error) { /* ignora */ }
  }

  window.CampoMinadoStorage = Object.freeze({ KEYS, DEFAULTS, getLevel, setLevel, getBestTime, setBestTime, getGame, setGame, clearGame });
})();