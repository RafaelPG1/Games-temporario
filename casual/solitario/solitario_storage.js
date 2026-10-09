'use strict';
/* Paciência · armazenamento próprio (localStorage), numa única chave: arcadia:solitario:v1.
   Guarda: best (recorde de pontos), muted (som) e game (partida em andamento, para recuperar após F5).
   Nunca lança erro: se o navegador bloquear o armazenamento, o jogo segue só em memória. */
(function (global) {
  const KEY = 'arcadia:solitario:v1';
  const SCALARS = ['best', 'muted'];
  const isId = (v) => Number.isInteger(v) && v >= 0 && v < 52;
  const isNum = (v) => Number.isInteger(v) && v >= 0;

  // Confere se t/f/s/w juntos formam exatamente as 52 cartas, sem repetir nem faltar.
  function layoutOk(o) {
    if (!o || !Array.isArray(o.t) || o.t.length !== 7 || !Array.isArray(o.f) || o.f.length !== 4 || !Array.isArray(o.s) || !Array.isArray(o.w)) return false;
    if (o.w.length > 1) return false;                                   // só uma carta comprada por vez
    const all = [...o.t.flat(), ...o.f.flat(), ...o.s, ...o.w];
    return all.length === 52 && all.every(isId) && new Set(all).size === 52 && o.t.every(Array.isArray) && o.f.every(Array.isArray);
  }
  function upOk(up) { return Array.isArray(up) && up.length === 52 && up.every((b) => typeof b === 'boolean'); }
  function gameOk(g) {
    if (!layoutOk(g) || !upOk(g.up) || !isNum(g.score) || !isNum(g.moves) || !isNum(g.time) || typeof g.started !== 'boolean') return false;
    if (!Array.isArray(g.order) || g.order.length !== 52 || !g.order.every(isId) || new Set(g.order).size !== 52) return false;
    return Array.isArray(g.undo) && g.undo.every((u) => layoutOk(u) && upOk(u.up) && isNum(u.score) && isNum(u.moves));
  }
  const VALID = {
    best: isNum,
    muted: (v) => typeof v === 'boolean',
    game: gameOk,
  };
  const LEGACY = { best: 'solitaire:best', muted: 'solitaire:muted' };   // chaves soltas antigas
  let data = null;   // só com valores válidos

  const ls = () => { try { return global.localStorage; } catch (e) { return null; } };
  const readRaw = (key) => { try { const s = ls(); return s ? s.getItem(key) : null; } catch (e) { return null; } };
  const parse = (txt) => { try { return JSON.parse(txt); } catch (e) { return null; } };
  const clean = (o, keys) => { const out = {}; keys.forEach((k) => { if (o && VALID[k](o[k])) out[k] = o[k]; }); return out; };

  // Procura, só para leitura, um registro antigo do Paciência salvo por outro sistema (objeto com best/muted).
  function findOld(o, depth) {
    if (!o || typeof o !== 'object' || depth > 4) return null;
    if (SCALARS.some((k) => VALID[k](o[k]))) return o;
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
        if (!key || key === KEY || !/solitario|solitaire|arcadia|game/i.test(key)) continue;
        const raw = parse(readRaw(key));
        const hit = /solitario/i.test(key) ? findOld(raw, 1) : (raw && findOld(raw.solitario, 1));
        if (hit) { found = clean(hit, SCALARS); break; }
      }
    } catch (e) { /* ignora */ }
    const old = {}, lb = readRaw(LEGACY.best), lu = readRaw(LEGACY.muted);
    if (lb != null && lb !== '') old.best = Number(lb);
    if (lu != null) old.muted = lu === '1';
    return { ...found, ...clean(old, SCALARS) };
  }
  function flush() {
    try { const s = ls(); if (s && data) s.setItem(KEY, JSON.stringify({ v: 1, ...data })); } catch (e) { /* sem espaço ou bloqueado */ }
  }
  function load() {
    if (!data) {
      const saved = parse(readRaw(KEY));
      data = saved && saved.v === 1 ? clean(saved, [...SCALARS, 'game']) : migrate();
      if (!saved) flush();
    }
    return { ...data };
  }
  function save(key, value) {
    if (!VALID[key] || !VALID[key](value)) return;
    load(); data[key] = value; flush();
  }
  const saveGame = (g) => save('game', g);
  function clearGame() { load(); if (data.game) { delete data.game; flush(); } }

  global.SolitarioStorage = { load, save, saveGame, clearGame };
})(window);