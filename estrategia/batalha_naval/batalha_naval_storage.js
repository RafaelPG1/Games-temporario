'use strict';
/* Batalha Naval · armazenamento próprio (localStorage), uma única chave.
   Guarda: preferências (mode 1|2 jogadores, level, muted) e a partida em andamento (game: modo, fase, vez, mares com navios e disparos, log, status, privacidade).
   game = null significa "nenhuma partida salva" (tela inicial). Nunca lança erro: se o navegador bloquear o armazenamento, o jogo segue só em memória. */
(function (global) {
  const KEY = 'arcadia:batalha_naval:v1';
  const PREFS = ['mode', 'level', 'muted'];
  const FIELDS = PREFS.concat(['game']);
  const N = 10, SIZES = [5, 4, 3, 3, 2];   // mesma frota do jogo: tamanhos dos 5 navios, por índice
  const isCells = (c, l) => Array.isArray(c) && c.length === l && c.every((i) => Number.isInteger(i) && i >= 0 && i < N * N)
    && ((c.every((x, k) => x === c[0] + k) && Math.floor(c[0] / N) === Math.floor(c[l - 1] / N)) || c.every((x, k) => x === c[0] + k * N));
  function validBoard(b, placed) {   // navios inteiros e sem sobreposição; acerto/afundado só em casa de navio; água só fora de navio
    if (!b || !Array.isArray(b.ships) || b.ships.length !== 5 || !Array.isArray(b.shot) || b.shot.length !== N * N) return false;
    if (!b.shot.every((v) => v === 0 || v === 1 || v === 2 || v === 3)) return false;
    const used = new Set();
    for (let k = 0; k < 5; k++) {
      const c = b.ships[k];
      if (c === null) { if (placed) return false; continue; }
      if (!isCells(c, SIZES[k])) return false;
      for (const i of c) { if (used.has(i)) return false; used.add(i); }
    }
    return b.shot.every((v, i) => (v === 1 ? !used.has(i) : v === 0 || used.has(i)));
  }
  const text = (t) => typeof t === 'string' && t.length <= 200;
  const VALID = {
    mode: (v) => v === 1 || v === 2,
    level: (v) => v === 'easy' || v === 'medium' || v === 'hard',
    muted: (v) => typeof v === 'boolean',
    game: (v) => v === null || (Boolean(v) && typeof v === 'object'
      && (v.phase === 'setup' || v.phase === 'battle' || v.phase === 'over') && typeof v.horiz === 'boolean'
      && (v.mode === 1 || v.mode === 2) && (v.edit === 'me' || v.edit === 'foe') && (v.handoff === null || v.handoff === 'me' || v.handoff === 'p2') && typeof v.done === 'boolean'
      && (v.sel === null || (Number.isInteger(v.sel) && v.sel >= 0 && v.sel < 5)) && (v.mode === 2 ? (v.turn === 'me' || v.turn === 'p2') : (v.turn === 'me' || v.turn === 'ai') && v.edit === 'me' && v.handoff === null)
      && ['setup', 'playing', 'paused', 'won', 'lost'].includes(v.status) && typeof v.win === 'boolean' && text(v.msg)
      && Array.isArray(v.log) && v.log.length <= 6 && v.log.every(text)
      && validBoard(v.me, v.phase !== 'setup') && validBoard(v.foe, v.phase !== 'setup')),
  };
  const NORM = {   // copia só os campos conhecidos
    game: (v) => (v ? {
      mode: v.mode, edit: v.edit, handoff: v.handoff, done: v.done, phase: v.phase, horiz: v.horiz, sel: v.sel, turn: v.turn, status: v.status, win: v.win, msg: v.msg, log: v.log.slice(),
      me: { ships: v.me.ships.map((c) => (c ? c.slice() : null)), shot: v.me.shot.slice() },
      foe: { ships: v.foe.ships.map((c) => (c ? c.slice() : null)), shot: v.foe.shot.slice() },
    } : null),
  };
  const LEGACY = { level: 'batalha_naval:level', muted: 'batalha_naval:muted' };   // chaves soltas antigas
  let data = null;   // só com valores válidos

  const ls = () => { try { return global.localStorage; } catch (e) { return null; } };
  const readRaw = (key) => { try { const s = ls(); return s ? s.getItem(key) : null; } catch (e) { return null; } };
  const parse = (txt) => { try { return JSON.parse(txt); } catch (e) { return null; } };
  const clean = (o, fields = FIELDS) => { const out = {}; fields.forEach((k) => { if (o && VALID[k](o[k])) out[k] = NORM[k] ? NORM[k](o[k]) : o[k]; }); return out; };

  // Procura, só para leitura, um registro antigo da Batalha Naval salvo por outro sistema (objeto com mode/level/muted).
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
        if (!key || key === KEY || !/batalha_naval|arcadia|game/i.test(key)) continue;
        const raw = parse(readRaw(key));
        const hit = /batalha_naval/i.test(key) ? findOld(raw, 1) : (raw && findOld(raw.batalha_naval, 1));
        if (hit) { found = clean(hit, PREFS); break; }
      }
    } catch (e) { /* ignora */ }
    const old = { level: readRaw(LEGACY.level) }, lm = readRaw(LEGACY.muted);
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

  global.BatalhaNavalStorage = { load, save, saveMany };
})(window);