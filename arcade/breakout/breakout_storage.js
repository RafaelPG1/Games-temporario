/* arcade/breakout/breakout_storage.js - dados persistentes do Quebra-Blocos (só deste jogo).
   Guarda um único objeto JSON em localStorage:
     muted      efeitos sonoros silenciados (boolean)
     bestLevel  fase mais alta alcançada em uma partida (inteiro >= 1)
     bestScore  maior pontuação (inteiro >= 0)
     mouseControl  mouse move a barra (boolean; padrão: ligado)
   A partida em andamento (bola, barra, blocos, itens, efeitos, timers, placar...) fica numa chave separada,
   'breakout:run:v1', para não misturar com as estatísticas: loadRun(), saveRun(obj) e clearRun().
   O snapshot recebe um número de versão (RUN_VERSION): se o formato mudar, snapshots antigos são descartados.
   Se o localStorage estiver bloqueado, os dados ficam só em memória (o jogo continua funcionando). */
(() => {
  'use strict';

  const KEY = 'breakout:v1';
  const RUN_KEY = 'breakout:run:v1';   // partida em andamento (snapshot completo)
  const RUN_VERSION = 2;               // formato do snapshot (sobe quando os campos mudam)
  let runMemory = null;                // cópia em memória, usada se o localStorage estiver bloqueado
  const DEFAULTS = { muted: false, bestLevel: 1, bestScore: 0, mouseControl: true, mouseMigrated: true };
  let data = null;

  function area() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  // Aceita só campos conhecidos e válidos
  function clean(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    if (typeof raw.muted === 'boolean') out.muted = raw.muted;
    if (typeof raw.mouseControl === 'boolean') out.mouseControl = raw.mouseControl;
    if (raw.mouseMigrated === true) out.mouseMigrated = true;
    const level = Math.floor(Number(raw.bestLevel));
    if (Number.isFinite(level) && level >= 1) out.bestLevel = level;
    const score = Math.floor(Number(raw.bestScore));
    if (Number.isFinite(score) && score >= 0 && raw.bestScore !== null && raw.bestScore !== '') out.bestScore = score;
    return out;
  }

  function parse(text) {
    try { return JSON.parse(text); } catch (e) { return text; }
  }

  // Primeira execução: recupera o que o jogo gravava antes (chave antiga 'breakout:muted', a chave
  // 'quebra_blocos:v1' e eventuais registros do armazenamento compartilhado com "breakout" no nome).
  function recoverOld(storage) {
    const found = {};
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key || key === KEY || key === RUN_KEY || !/breakout|quebra_blocos/i.test(key)) continue;
        const value = parse(storage.getItem(key));
        const last = key.split(/[:./]/).pop();
        if (last === 'muted') {
          if (value === 1 || value === '1' || value === true) found.muted = true;
          else if (value === 0 || value === '0' || value === false) found.muted = false;
        } else if (last === 'bestLevel') {
          Object.assign(found, clean({ bestLevel: value }));
        } else if (value && typeof value === 'object') {
          const nested = value.breakout || (value.games && value.games.breakout) || value;
          Object.assign(found, clean(nested));
        }
      }
    } catch (e) { /* sem acesso: segue com os padrões */ }
    return found;
  }

  function load() {
    if (data) return data;
    data = Object.assign({}, DEFAULTS);
    const storage = area();
    if (!storage) return data;
    let saved = null;
    try { saved = storage.getItem(KEY); } catch (e) { /* ignora */ }
    if (saved !== null) {
      const cleaned = clean(parse(saved));
      Object.assign(data, cleaned);
      // Uma vez só: quem tinha o mouse salvo como desligado (antigo padrão) passa a ligado; a escolha seguinte é respeitada
      if (!cleaned.mouseMigrated) { data.mouseControl = true; data.mouseMigrated = true; save(); }
    } else {
      Object.assign(data, recoverOld(storage));
      save();
    }
    return data;
  }

  function save() {
    const storage = area();
    if (!storage || !data) return;
    try { storage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* cheio ou bloqueado: mantém em memória */ }
  }

  window.BreakoutStorage = {
    get(key, fallback) {
      const d = load();
      return Object.prototype.hasOwnProperty.call(d, key) ? d[key] : fallback;
    },
    set(key, value) {
      const d = load();
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return;
      const next = clean({ [key]: value });
      if (!(key in next)) return;
      d[key] = next[key];
      save();
    },
    // Partida em andamento: um único objeto JSON, gravado inteiro a cada salvamento
    loadRun() {
      const storage = area();
      let text = null;
      if (storage) { try { text = storage.getItem(RUN_KEY); } catch (e) { /* ignora */ } }
      const value = text === null ? runMemory : parse(text);
      if (value && typeof value === 'object' && value.v === RUN_VERSION) return value;
      if (value !== null && value !== undefined) this.clearRun();   // lixo ou versão antiga: descarta
      return null;
    },
    saveRun(run) {
      const payload = Object.assign({}, run, { v: RUN_VERSION, savedAt: Date.now() });
      runMemory = payload;
      const storage = area();
      if (!storage) return false;
      try { storage.setItem(RUN_KEY, JSON.stringify(payload)); return true; } catch (e) { return false; }
    },
    clearRun() {
      runMemory = null;
      const storage = area();
      if (storage) { try { storage.removeItem(RUN_KEY); } catch (e) { /* ignora */ } }
    },
    // Registra a pontuação se for a maior já feita. Retorna true quando é um novo recorde.
    recordScore(score) {
      const s = Math.floor(Number(score));
      if (!Number.isFinite(s) || s <= this.get('bestScore', 0)) return false;
      this.set('bestScore', s);
      return true;
    },
  };
})();