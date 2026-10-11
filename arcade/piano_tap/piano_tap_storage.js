/* ==========================================================================
   arcade/piano_tap/piano_tap_storage.js - persistência exclusiva do Piano Tap

   Script clássico (sem módulos ES). Carregue ANTES de piano_tap_levels.js e piano_tap.js.
   Expõe um único objeto global: PianoTapStorage.

   Dados guardados:
     piano_tap:best_inf -> recorde do modo infinito (inteiro >= 0)
     piano_tap:levels   -> progresso das fases (JSON): { stars: [0..3 x 30], scores: [recorde x 30] }
     piano_tap:muted    -> '1' = som desligado, '0' = som ligado
     piano_tap:save     -> instantâneo completo da partida em andamento (JSON); apagado ao reiniciar/terminar/sair para o menu

   Observação: a pontuação mudou (5/7/9 pontos por tecla), então o recorde antigo (1 ponto por tecla) NÃO é migrado:
   ele ficaria baixo demais em relação à nova escala. A chave antiga "piano_tap:best" fica sem uso.

   Garantias:
     - nunca lança exceção (modo privado, cookies bloqueados, cota cheia...);
     - sem armazenamento persistente, os valores ficam em memória na sessão;
     - dado ausente ou inválido vira o padrão seguro (recorde 0, nenhuma estrela, som ligado);
     - recordes e estrelas salvos nunca diminuem por engano;
     - o salvamento da partida é opaco aqui: quem valida o conteúdo é piano_tap.js (dado corrompido => null);
     - migra uma vez o som salvo antes (chave antiga "piano-tap:muted"), se existir.
   ========================================================================== */
(() => {
  'use strict';

  const MAX_SCORE = 1e9;
  const LEVEL_COUNT = 30;                                   // precisa bater com PianoTapLevels.COUNT
  const DEFAULTS = Object.freeze({ best: 0, muted: false });
  const KEYS = Object.freeze({ best: 'piano_tap:best_inf', levels: 'piano_tap:levels', muted: 'piano_tap:muted', save: 'piano_tap:save' });
  const LEGACY = Object.freeze({ muted: 'piano-tap:muted' });   // chave que o jogo já usou
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
    return Number.isFinite(n) && n >= 0 ? Math.min(n, MAX_SCORE) : null;
  };

  function migrate() {
    if (readRaw(KEYS.muted) === null) {
      const old = readRaw(LEGACY.muted);
      if (old === '1' || old === '0') writeRaw(KEYS.muted, old);
    }
  }

  /* ---- modo infinito ---- */
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

  /* ---- fases ---- */
  function emptyLevels() {
    return { stars: new Array(LEVEL_COUNT).fill(0), scores: new Array(LEVEL_COUNT).fill(0) };
  }

  // Devolve sempre { stars, scores } com LEVEL_COUNT itens válidos (estrelas 0..3, recordes inteiros >= 0).
  function getLevels() {
    const out = emptyLevels();
    const raw = readRaw(KEYS.levels);
    if (raw === null) return out;
    try {
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        for (let i = 0; i < LEVEL_COUNT; i++) {
          const st = Math.floor(Number(Array.isArray(data.stars) ? data.stars[i] : 0));
          out.stars[i] = Number.isFinite(st) ? Math.max(0, Math.min(3, st)) : 0;
          const sc = asScore(Array.isArray(data.scores) ? data.scores[i] : 0);
          out.scores[i] = sc === null ? 0 : sc;
        }
      }
    } catch (error) { /* JSON ruim: começa do zero */ }
    return out;
  }

  // Grava o resultado de uma fase (level = 1..LEVEL_COUNT). Só sobe: estrelas e pontuação nunca diminuem. Devolve o progresso atualizado.
  function setLevelResult(level, stars, score) {
    const data = getLevels(), i = Math.floor(Number(level)) - 1;
    if (!(i >= 0 && i < LEVEL_COUNT)) return data;
    const st = Math.max(0, Math.min(3, Math.floor(Number(stars)) || 0)), sc = asScore(score) || 0;
    if (st <= data.stars[i] && sc <= data.scores[i]) return data;
    data.stars[i] = Math.max(data.stars[i], st);
    data.scores[i] = Math.max(data.scores[i], sc);
    writeRaw(KEYS.levels, JSON.stringify(data));
    return data;
  }

  /* ---- som ---- */
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

  /* ---- partida em andamento ---- */
  // Objeto simples serializável. Devolve true se gravou de fato no navegador.
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

  window.PianoTapStorage = Object.freeze({ KEYS, DEFAULTS, LEVEL_COUNT, getBest, setBest, getLevels, setLevelResult, isMuted, setMuted, saveGame, loadGame, clearGame });
})();
