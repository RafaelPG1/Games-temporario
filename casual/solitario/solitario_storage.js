'use strict';
/* Paciência · armazenamento próprio (localStorage). Guarda só o que é do jogo: best (recorde de pontos), mode (cartas por compra: 1 ou 3) e muted.
   A partida em andamento não é salva. Nunca lança erro: se o navegador bloquear o armazenamento, o jogo segue só em memória. */
(function (global) {
  const KEY = 'arcadia:solitario:v1';
  const FIELDS = ['best', 'mode', 'muted'];
  const VALID = {
    best: (v) => Number.isInteger(v) && v >= 0,
    mode: (v) => v === 1 || v === 3,
    muted: (v) => typeof v === 'boolean',
  };
  const LEGACY = { best: 'solitaire:best', mode: 'solitaire:mode', muted: 'solitaire:muted' };   // chaves soltas antigas
  let data = null;   // só com valores válidos

  const ls = () => { try { return global.localStorage; } catch (e) { return null; } };
  const readRaw = (key) => { try { const s = ls(); return s ? s.getItem(key) : null; } catch (e) { return null; } };
  const parse = (txt) => { try { return JSON.parse(txt); } catch (e) { return null; } };
  const clean = (o) => { const out = {}; FIELDS.forEach((k) => { if (o && VALID[k](o[k])) out[k] = o[k]; }); return out; };

  // Procura, só para leitura, um registro antigo do Paciência salvo por outro sistema (objeto com best/mode/muted).
  function findOld(o, depth) {
    if (!o || typeof o !== 'object' || depth > 4) return null;
    if (FIELDS.some((k) => VALID[k](o[k]))) return o;
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
        if (hit) { found = clean(hit); break; }
      }
    } catch (e) { /* ignora */ }
    const old = {}, lb = readRaw(LEGACY.best), lm = readRaw(LEGACY.mode), lu = readRaw(LEGACY.muted);
    if (lb != null && lb !== '') old.best = Number(lb);
    if (lm != null && lm !== '') old.mode = Number(lm);
    if (lu != null) old.muted = lu === '1';
    return { ...found, ...clean(old) };
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
  function save(key, value) {
    if (!VALID[key] || !VALID[key](value)) return;
    load(); data[key] = value; flush();
  }

  global.SolitarioStorage = { load, save };
})(window);