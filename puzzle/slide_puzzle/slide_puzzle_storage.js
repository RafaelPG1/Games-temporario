/* ==========================================================================
   puzzle/slide_puzzle/slide_puzzle_storage.js - persistência exclusiva do Quebra-Cabeça Deslizante

   Script clássico (sem módulos ES). Carregue ANTES de slide_puzzle.js.
   Expõe um único objeto global: SlidePuzzleStorage.

   Dados guardados (chaves iguais às que o jogo já usava):
     slide_puzzle:level        -> última dificuldade: 'easy' | 'medium' | 'hard'
     slide_puzzle:muted        -> '1' = som desligado, '0' = som ligado
     slide_puzzle:best:<nível> -> melhor resultado do nível, JSON { moves, time }
                                  (menos movimentos; em empate, menor tempo em ms)
     slide_puzzle:levels       -> progresso do modo Fases (JSON): { done: [bool x 40], best: [{ moves, time } | null x 40] } (fases 1-20 = números, 21-40 = imagens)
     slide_puzzle:mix          -> modo Infinito: '1' = sorteia números/imagem a cada partida, '0' = desligado (padrão)
     slide_puzzle:image        -> imagem personalizada do modo Livre (data URI JPEG quadrado, já recortado).
                                  Ausente = tabuleiro com números.
     slide_puzzle:game         -> partida em andamento (JSON): mode ('free' | 'levels'), stage, level, board, initial, moves, elapsed,
                                  status, isRecord, look ('num' | 'art:<0-19>' | 'custom' = estilo do tabuleiro da rodada). Permite recuperar a partida após F5 sem embaralhar de novo. Apagada ao voltar à tela inicial.
                                  Salvamentos antigos (sem mode) valem como modo Livre.

   Garantias:
     - nunca lança exceção (modo privado, cookies bloqueados, cota cheia...);
     - sem armazenamento persistente, os valores ficam em memória na sessão;
     - dado ausente ou inválido vira o padrão seguro (nível médio, som ligado, sem recorde, sem imagem);
     - o melhor resultado salvo (por dificuldade e por fase) nunca piora por engano.
   ========================================================================== */
(() => {
  'use strict';

  const LEVELS = Object.freeze(['easy', 'medium', 'hard']);
  const DEFAULTS = Object.freeze({ level: 'medium', muted: false });
  const KEYS = Object.freeze({
    level: 'slide_puzzle:level',
    muted: 'slide_puzzle:muted',
    best: (level) => `slide_puzzle:best:${level}`,
    levels: 'slide_puzzle:levels',
    game: 'slide_puzzle:game',
    image: 'slide_puzzle:image',
    mix: 'slide_puzzle:mix',
  });
  const GAME_STATUS = Object.freeze(['playing', 'paused', 'won']);
  const LEVEL_COUNT = 40;                                   // precisa bater com Levels.COUNT (slide_puzzle.js): 20 de números + 20 de imagens
  const ART_COUNT = 20;                                     // ilustrações disponíveis (SlidePuzzleImages.COUNT)
  const validLook = (l) => l === 'num' || l === 'custom' || (/^art:\d{1,2}$/.test(l) && Number(l.slice(4)) < ART_COUNT);
  const FREE_SIZE = Object.freeze({ easy: 9, medium: 16, hard: 25 });
  const BOARD_SIZES = Object.freeze([9, 16, 25]);
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

  /* ---- fases ---- */
  // Devolve sempre { done, best } com LEVEL_COUNT itens válidos.
  function getLevels() {
    const out = { done: new Array(LEVEL_COUNT).fill(false), best: new Array(LEVEL_COUNT).fill(null) };
    try {
      const data = JSON.parse(readRaw(KEYS.levels));
      if (data && typeof data === 'object') {
        for (let i = 0; i < LEVEL_COUNT; i++) {
          out.done[i] = Array.isArray(data.done) && data.done[i] === true;
          const r = Array.isArray(data.best) ? data.best[i] : null;
          out.best[i] = validResult(r) ? { moves: Math.floor(r.moves), time: Math.round(r.time) } : null;
        }
      }
    } catch (error) { /* JSON ruim: começa do zero */ }
    return out;
  }

  // Grava o resultado de uma fase concluída (stage = 1..LEVEL_COUNT). Só melhora: o melhor resultado nunca piora.
  function setLevelResult(stage, result) {
    const data = getLevels(), i = Math.floor(Number(stage)) - 1;
    if (!(i >= 0 && i < LEVEL_COUNT)) return data;
    data.done[i] = true;
    if (validResult(result)) {
      const candidate = { moves: Math.floor(result.moves), time: Math.round(result.time) };
      if (isBetter(candidate, data.best[i])) data.best[i] = candidate;
    }
    writeRaw(KEYS.levels, JSON.stringify(data));
    return data;
  }

  function removeRaw(key) {
    delete memory[key];
    try { window.localStorage.removeItem(key); } catch (error) { /* ignora */ }
  }

  // Tabuleiro válido: permutação de 0..size-1 (0 = espaço vazio).
  function validBoard(b, size) {
    if (!Array.isArray(b) || b.length !== size) return false;
    return b.every((v) => Number.isInteger(v) && v >= 0 && v < size) && new Set(b).size === size;
  }

  // Devolve a partida salva já validada ou null (dado ausente/corrompido nunca quebra o jogo).
  // O tamanho exato do tabuleiro de cada fase é conferido pelo jogo ao restaurar.
  function getGame() {
    try {
      const g = JSON.parse(readRaw(KEYS.game));
      if (!g || !GAME_STATUS.includes(g.status)) return null;
      const mode = g.mode === 'levels' ? 'levels' : 'free';
      let level = validLevel(g.level) ? g.level : null, stage = 1, size;
      if (mode === 'levels') {
        stage = Math.floor(Number(g.stage));
        if (!(stage >= 1 && stage <= LEVEL_COUNT) || !Array.isArray(g.board)) return null;
        size = g.board.length; level = level || DEFAULTS.level;
      } else {
        if (!level) return null;
        size = FREE_SIZE[level];
      }
      if (!BOARD_SIZES.includes(size) || !validBoard(g.board, size) || !validBoard(g.initial, size)) return null;
      if (!Number.isInteger(g.moves) || g.moves < 0 || !Number.isFinite(g.elapsed) || g.elapsed < 0) return null;
      return { mode, stage, level, board: g.board.slice(), initial: g.initial.slice(), moves: g.moves,
               elapsed: Math.round(g.elapsed), status: g.status, isRecord: g.isRecord === true, look: validLook(g.look) ? g.look : null };
    } catch (error) { return null; }
  }

  function setGame(game) {
    if (!game || !validLevel(game.level) || !GAME_STATUS.includes(game.status) || !Array.isArray(game.board)) return false;
    if (!BOARD_SIZES.includes(game.board.length) || !validBoard(game.board, game.board.length)) return false;
    return writeRaw(KEYS.game, JSON.stringify({ mode: game.mode === 'levels' ? 'levels' : 'free', stage: Math.floor(Number(game.stage)) || 1,
      level: game.level, board: game.board, initial: game.initial, moves: game.moves,
      elapsed: Math.round(game.elapsed), status: game.status, isRecord: Boolean(game.isRecord), look: validLook(game.look) ? game.look : 'num' }));
  }

  function clearGame() { removeRaw(KEYS.game); }

  /* ---- imagem personalizada (modo Livre) ---- */
  const IMAGE_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  const validImage = (v) => typeof v === 'string' && v.length < 2000000 && IMAGE_RE.test(v);
  function getImage() { const raw = readRaw(KEYS.image); return validImage(raw) ? raw : null; }
  // false = imagem inválida (nada é gravado). Sem cota no localStorage, a imagem fica só na sessão.
  function setImage(dataUrl) { if (!validImage(dataUrl)) return false; writeRaw(KEYS.image, dataUrl); return true; }
  function clearImage() { removeRaw(KEYS.image); }

  /* ---- modo Infinito: misturar estilos (números/imagem) ---- */
  const getMix = () => readRaw(KEYS.mix) === '1';
  function setMix(value) { const on = Boolean(value); writeRaw(KEYS.mix, on ? '1' : '0'); return on; }

  window.SlidePuzzleStorage = Object.freeze({ LEVELS, LEVEL_COUNT, KEYS, DEFAULTS, getLevel, setLevel, isMuted, setMuted, getBest, setBest, getLevels, setLevelResult, getGame, setGame, clearGame, getImage, setImage, clearImage, getMix, setMix });
})();