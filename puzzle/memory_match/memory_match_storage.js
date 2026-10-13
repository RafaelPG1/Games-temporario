/* ==========================================================================
   puzzle/memory_match/memory_match_storage.js - persistência exclusiva do Jogo da Memória

   Script clássico (sem módulos ES). Carregue ANTES de memory_match.js.
   Expõe um único objeto global: MemoryMatchStorage.

   Dados guardados (todos sob o prefixo "memory_match:", sem tocar nas chaves de outros jogos):
     memory_match:best  -> recorde antigo do jogo de 10 pares (mantido só por compatibilidade)
     memory_match:levels -> progresso das fases (JSON): { done: [bool x 18], time: [melhor tempo em ms x 18], score: [melhor pontuação x 18] }
     memory_match:muted -> '1' = som desligado, '0' = som ligado
     memory_match:game  -> partida em andamento (JSON): modo, fase, símbolos, cartas na ordem atual, reveladas, pares,
                           vez de jogar, placar, tentativas, pontuação, tempo. Validado pelo jogo ao restaurar.
   Se a chave nova ainda não existe, lê as chaves antigas do jogo (memory:best / memory:muted).

   Garantias:
     - nunca lança exceção (modo privado, cookies bloqueados, cota cheia...);
     - sem armazenamento persistente, os valores ficam em memória na sessão;
     - dado ausente ou inválido vira o padrão seguro (recorde 0, som ligado, sem partida salva);
     - o recorde salvo nunca diminui por engano (e não é apagado ao reiniciar ou limpar a partida).
   ========================================================================== */
(() => {
  'use strict';

  const KEYS = Object.freeze({ best: 'memory_match:best', levels: 'memory_match:levels', muted: 'memory_match:muted', game: 'memory_match:game' });
  const LEGACY = Object.freeze({ best: 'memory:best', muted: 'memory:muted' });
  const DEFAULTS = Object.freeze({ best: 0, muted: false });
  const GAME_VERSION = 2;                                   // v2: modos de jogo (fases, IA, 2 jogadores); salvamentos v1 são descartados
  const LEVEL_COUNT = 18;                                   // precisa bater com MemoryMatchLevels.COUNT
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

  function removeRaw(key) {
    delete memory[key];
    try { window.localStorage.removeItem(key); } catch (error) { /* ignora */ }
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

  /* ---- fases ---- */
  // Devolve sempre { done, time, score } com LEVEL_COUNT itens válidos.
  function getLevels() {
    const out = { done: new Array(LEVEL_COUNT).fill(false), time: new Array(LEVEL_COUNT).fill(0), score: new Array(LEVEL_COUNT).fill(0) };
    const raw = readRaw(KEYS.levels);
    if (raw === null) return out;
    try {
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        const num = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, Number.MAX_SAFE_INTEGER) : 0; };
        for (let i = 0; i < LEVEL_COUNT; i++) {
          out.done[i] = Array.isArray(data.done) && data.done[i] === true;
          out.time[i] = num(Array.isArray(data.time) ? data.time[i] : 0);
          out.score[i] = num(Array.isArray(data.score) ? data.score[i] : 0);
        }
      }
    } catch (error) { /* JSON ruim: começa do zero */ }
    return out;
  }

  // Grava o resultado de uma fase concluída (level = 1..LEVEL_COUNT). Só melhora: o menor tempo e a maior pontuação ficam.
  function setLevelResult(level, timeMs, score) {
    const data = getLevels(), i = Math.floor(Number(level)) - 1;
    if (!(i >= 0 && i < LEVEL_COUNT)) return data;
    const t = Math.floor(Number(timeMs)), sc = Math.floor(Number(score));
    data.done[i] = true;
    if (Number.isFinite(t) && t > 0 && (data.time[i] === 0 || t < data.time[i])) data.time[i] = t;
    if (Number.isFinite(sc) && sc > data.score[i]) data.score[i] = sc;
    writeRaw(KEYS.levels, JSON.stringify(data));
    return data;
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

  // Partida em andamento. O jogo entrega um objeto simples; aqui só serializamos.
  // loadGame devolve o objeto salvo ou null (ausente, JSON quebrado, versão diferente).
  function saveGame(state) {
    try { return writeRaw(KEYS.game, JSON.stringify({ ...state, v: GAME_VERSION })); }
    catch (error) { return false; }
  }

  function loadGame() {
    const raw = readRaw(KEYS.game);
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && parsed.v === GAME_VERSION ? parsed : null;
    } catch (error) { return null; }
  }

  function clearGame() { removeRaw(KEYS.game); }

  window.MemoryMatchStorage = Object.freeze({ KEYS, DEFAULTS, LEVEL_COUNT, getBest, setBest, getLevels, setLevelResult, isMuted, setMuted, saveGame, loadGame, clearGame });
})();
