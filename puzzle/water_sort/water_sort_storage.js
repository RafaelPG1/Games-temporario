/* ==========================================================================
   puzzle/water_sort/water_sort_storage.js - persistência exclusiva do Water Sort (Tubos de Cores)

   Script clássico (sem módulos ES). Carregue ANTES de water_sort.js.
   Expõe um único objeto global: WaterSortStorage.

   Dados guardados:
     water_sort:unlocked -> maior fase liberada (inteiro >= 1). Fases abaixo dela estão concluídas.
     water_sort:last     -> última fase jogada (inteiro >= 1)
     water_sort:muted    -> '1' = som desligado, '0' = som ligado
     water_sort:game     -> partida em andamento do Modo Fases (JSON): fase, configuração inicial, tubos atuais, histórico de despejos e tubo selecionado.
                            Os tubos são sorteados a cada fase, então precisam ser guardados para recuperar a partida após F5.
     water_sort:inf      -> Modo Infinito: maior nível de dificuldade alcançado (inteiro >= 1); é de onde o modo continua.
     water_sort:infgame  -> partida em andamento do Modo Infinito (mesmo formato de water_sort:game)
     water_sort:mode     -> último modo jogado: 'levels' ou 'infinite'
     water_sort:infhist  -> histórico do Modo Infinito (JSON { "nível": melhor nº de movimentos }). Guarda só os INF_HIST_MAX níveis mais
                            recentes, para não crescer sem limite; os níveis abaixo de water_sort:inf continuam contando como concluídos.
     water_sort:infboards -> tabuleiros sorteados do Modo Infinito (JSON [[nível, "texto"], ...], do mais antigo ao mais recente). Cada nível é
                            gerado ao acaso uma vez; ficar salvo aqui permite rejogar EXATAMENTE o mesmo tabuleiro pelo catálogo. Guarda só os
                            INF_BOARDS_MAX mais recentes (cada um tem ~60 caracteres); níveis mais antigos sorteiam um tabuleiro novo.

   O jogo não tem recorde de pontuação nem temporizadores, então nada além disso é guardado.

   Garantias:
     - nunca lança exceção (modo privado, cookies bloqueados, cota cheia...);
     - sem armazenamento persistente, os valores ficam em memória na sessão;
     - dado ausente ou inválido vira o padrão seguro (fase 1, som ligado);
     - a fase liberada nunca diminui por engano;
     - migra uma vez o progresso/som salvos pelo sistema compartilhado antigo (game_storage.js), se existirem.
   ========================================================================== */
(() => {
  'use strict';

  const MAX_LEVEL = 1001;   // teto: 1000 níveis no Infinito (1001 = "todos concluídos"); valores maiores salvos antes são limitados a isto
  const DEFAULTS = Object.freeze({ unlocked: 1, last: 1, muted: false, inf: 1, mode: 'levels' });
  const KEYS = Object.freeze({
    unlocked: 'water_sort:unlocked', last: 'water_sort:last', muted: 'water_sort:muted', game: 'water_sort:game',
    inf: 'water_sort:inf', infgame: 'water_sort:infgame', mode: 'water_sort:mode', infhist: 'water_sort:infhist', infboards: 'water_sort:infboards'
  });
  const INF_HIST_MAX = 1000, INF_BOARDS_MAX = 400;
  const gameKey = (mode) => (mode === 'infinite' ? KEYS.infgame : KEYS.game);
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

  /* ---- partida em andamento ----
     Aqui só se confere o formato (inteiros, tamanhos, índices). As regras (cores, capacidade, histórico que reproduz os tubos)
     são validadas pelo jogo ao restaurar; se algo não bater, a partida salva é descartada. */
  const asTubes = (v) => (Array.isArray(v) && v.length >= 1 && v.length <= 24 &&
    v.every((t) => Array.isArray(t) && t.length <= 4 && t.every((c) => Number.isInteger(c) && c >= 0 && c < 64))) ? v.map((t) => t.slice()) : null;

  function cleanGame(g) {
    if (!g || typeof g !== 'object') return null;
    const level = asLevel(g.level), initial = asTubes(g.initial), tubes = asTubes(g.tubes);
    if (!level || !initial || !tubes || !Array.isArray(g.history) || g.history.length > 5000) return null;
    const ok = (i) => Number.isInteger(i) && i >= 0 && i < tubes.length;
    const history = [];
    for (const h of g.history) {
      if (!h || !ok(h.from) || !ok(h.to) || !Number.isInteger(h.count) || h.count < 1 || h.count > 4) return null;
      history.push({ from: h.from, to: h.to, count: h.count });
    }
    return { level, initial, tubes, history, selected: ok(g.selected) ? g.selected : -1 };
  }

  // mode: 'levels' (padrão) ou 'infinite'; cada modo tem a própria partida salva.
  function getGame(mode) {
    try { return cleanGame(JSON.parse(readRaw(gameKey(mode)))); } catch (error) { return null; }
  }

  function setGame(game, mode) {
    const clean = cleanGame(game);
    if (!clean) return false;
    writeRaw(gameKey(mode), JSON.stringify(clean));
    return true;
  }

  function clearGame(mode) {
    const key = gameKey(mode);
    delete memory[key];
    try { window.localStorage.removeItem(key); } catch (error) { /* sem acesso: nada a remover */ }
  }

  /* ---- Modo Infinito: nível de dificuldade alcançado (só sobe) ---- */
  function getInfLevel() {
    return asLevel(readRaw(KEYS.inf)) || DEFAULTS.inf;
  }

  function setInfLevel(level) {
    const n = asLevel(level), current = getInfLevel();
    if (!n || n <= current) return current;
    writeRaw(KEYS.inf, n);
    return n;
  }

  /* ---- Modo Infinito: histórico de níveis concluídos (melhor nº de movimentos de cada um) ---- */
  function getInfHistory() {
    const out = {};
    try {
      const obj = JSON.parse(readRaw(KEYS.infhist));
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        for (const k of Object.keys(obj)) {
          const lv = asLevel(k), mv = Math.floor(Number(obj[k]));
          if (lv && String(lv) === k && Number.isFinite(mv) && mv >= 1 && mv <= 99999) out[lv] = mv;
        }
      }
    } catch (error) { /* ausente ou inválido: histórico vazio */ }
    return out;
  }

  // Registra a conclusão de um nível; se ele já estava no histórico, fica o menor nº de movimentos. Devolve o histórico atualizado.
  function addInfDone(level, moves) {
    const lv = asLevel(level), mv = Math.floor(Number(moves)), hist = getInfHistory();
    if (!lv || !Number.isFinite(mv) || mv < 1) return hist;
    hist[lv] = hist[lv] ? Math.min(hist[lv], mv) : Math.min(mv, 99999);
    const keys = Object.keys(hist).map(Number).sort((a, b) => a - b);
    for (let i = 0; i < keys.length - INF_HIST_MAX; i++) delete hist[keys[i]];   // descarta os níveis mais antigos (menores)
    writeRaw(KEYS.infhist, JSON.stringify(hist));
    return hist;
  }

  /* ---- Modo Infinito: tabuleiros gerados (para rejogar o mesmo nível com o mesmo tabuleiro) ----
     Formato de cada tabuleiro: tubos separados por "|", cores em base 36 (tubo vazio = nada entre dois "|"). */
  const encodeTubes = (tubes) => tubes.map((t) => t.map((c) => c.toString(36)).join('')).join('|');
  function decodeTubes(text) {
    if (typeof text !== 'string' || !/^[0-9a-z|]*$/.test(text)) return null;
    const tubes = text.split('|').map((part) => part.split('').filter(Boolean).map((ch) => parseInt(ch, 36)));
    return asTubes(tubes);                          // mesmas conferências de formato da partida salva
  }
  function readBoards() {
    try {
      const list = JSON.parse(readRaw(KEYS.infboards));
      if (Array.isArray(list)) return list.filter((e) => Array.isArray(e) && asLevel(e[0]) && typeof e[1] === 'string').map((e) => [asLevel(e[0]), e[1]]);
    } catch (error) { /* ausente ou inválido: nenhum tabuleiro salvo */ }
    return [];
  }

  // Devolve o tabuleiro salvo do nível (lista de tubos) ou null. O jogo ainda confere as regras (cores/capacidade) antes de usar.
  function getInfBoard(level) {
    const lv = asLevel(level); if (!lv) return null;
    const hit = readBoards().find((e) => e[0] === lv);
    return hit ? decodeTubes(hit[1]) : null;
  }

  // Guarda (ou troca) o tabuleiro de um nível; o mais recém-guardado vai para o fim e só os INF_BOARDS_MAX mais recentes ficam.
  function setInfBoard(level, tubes) {
    const lv = asLevel(level), clean = asTubes(tubes);
    if (!lv || !clean) return false;
    const list = readBoards().filter((e) => e[0] !== lv);
    list.push([lv, encodeTubes(clean)]);
    while (list.length > INF_BOARDS_MAX) list.shift();
    writeRaw(KEYS.infboards, JSON.stringify(list));
    return true;
  }

  /* ---- último modo jogado ---- */
  function getMode() {
    return readRaw(KEYS.mode) === 'infinite' ? 'infinite' : DEFAULTS.mode;
  }

  function setMode(mode) {
    const m = mode === 'infinite' ? 'infinite' : 'levels';
    writeRaw(KEYS.mode, m);
    return m;
  }

  migrate();

  window.WaterSortStorage = Object.freeze({
    KEYS, DEFAULTS, getUnlocked, setUnlocked, getLast, setLast, isMuted, setMuted,
    getGame, setGame, clearGame, getInfLevel, setInfLevel, getInfHistory, addInfDone, getInfBoard, setInfBoard, getMode, setMode
  });
})();