'use strict';
/* Jogo da Velha · armazenamento próprio (localStorage), uma única chave.
   Guarda: preferências (mode, level, starter, muted), placar da sessão (score) e a partida em andamento (game: tabuleiro, jogador da vez e status).
   game = null significa "nenhuma partida salva" (tela inicial). Nunca lança erro: se o navegador bloquear o armazenamento, o jogo segue só em memória. */
(function (global) {
  const KEY = 'arcadia:jogo_velha:v1';
  const PREFS = ['mode', 'level', 'starter', 'muted'];
  const FIELDS = PREFS.concat(['score', 'game']);
  const isCount = (n) => Number.isInteger(n) && n >= 0 && n <= 999999;
  const VALID = {
    mode: (v) => v === 'two' || v === 'ai',
    level: (v) => v === 'easy' || v === 'medium' || v === 'hard',
    starter: (v) => v === 'X' || v === 'O',
    muted: (v) => typeof v === 'boolean',
    score: (v) => Boolean(v) && typeof v === 'object' && isCount(v.X) && isCount(v.O) && isCount(v.D),
    game: (v) => v === null || (Boolean(v) && typeof v === 'object' && Array.isArray(v.board) && v.board.length === 9
      && v.board.every((c) => c === '' || c === 'X' || c === 'O') && (v.turn === 'X' || v.turn === 'O')
      && ['playing', 'paused', 'won', 'draw'].includes(v.status)),
  };
  const NORM = {   // copia só os campos conhecidos
    score: (v) => ({ X: v.X, O: v.O, D: v.D }),
    game: (v) => (v ? { board: v.board.slice(), turn: v.turn, status: v.status } : null),
  };
  const LEGACY = { mode: 'jogo_velha:mode', level: 'jogo_velha:level', starter: 'jogo_velha:starter', muted: 'jogo_velha:muted' };   // chaves soltas antigas
  let data = null;   // só com valores válidos

  const ls = () => { try { return global.localStorage; } catch (e) { return null; } };
  const readRaw = (key) => { try { const s = ls(); return s ? s.getItem(key) : null; } catch (e) { return null; } };
  const parse = (txt) => { try { return JSON.parse(txt); } catch (e) { return null; } };
  const clean = (o, fields = FIELDS) => { const out = {}; fields.forEach((k) => { if (o && VALID[k](o[k])) out[k] = NORM[k] ? NORM[k](o[k]) : o[k]; }); return out; };

  // Procura, só para leitura, um registro antigo do Jogo da Velha salvo por outro sistema (objeto com mode/level/starter/muted).
  function findOld(o, depth) {
    if (!o || typeof o !== 'object' || depth > 4) return null;
    if (PREFS.some((k) => VALID[k](o[k]))) return o;
    for (const k of Object.keys(o)) {
      let v = o[k];
      if (typeof v === 'string' && v[0] === '{') v = parse(v);
      const hit = findOld(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  function migrate() {
    let found = {};
    try {
      const s = ls();
      if (s) for (let i = 0; i < s.length; i++) {
        const key = s.key(i);
        if (!key || key === KEY || !/jogo_velha|arcadia|game/i.test(key)) continue;
        const raw = parse(readRaw(key));
        const hit = /jogo_velha/i.test(key) ? findOld(raw, 1) : (raw && findOld(raw.jogo_velha, 1));
        if (hit) { found = clean(hit, PREFS); break; }
      }
    } catch (e) { /* ignora */ }
    const old = { mode: readRaw(LEGACY.mode), level: readRaw(LEGACY.level), starter: readRaw(LEGACY.starter) }, lm = readRaw(LEGACY.muted);
    if (lm != null) old.muted = lm === '1';
    return { ...found, ...clean(old, PREFS) };
  }
  function flush() {
    try { const s = ls(); if (s && data) s.setItem(KEY, JSON.stringify({ v: 1, ...data })); } catch (e) { /* sem espaço ou bloqueado */ }
  }
  function load() {
    if (!data) {
      const saved = parse(readRaw(KEY));
      data = saved && saved.v === 1 ? clean(saved) : migrate();
      if (!saved) flush();
    }
    return { ...data };
  }
  function saveMany(obj) {   // grava vários campos de uma vez; valores inválidos são ignorados
    load(); Object.assign(data, clean(obj)); flush();
  }
  const save = (key, value) => saveMany({ [key]: value });

  global.JogoVelhaStorage = { load, save, saveMany };
})(window);
