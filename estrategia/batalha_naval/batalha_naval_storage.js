'use strict';
/* Batalha Naval · armazenamento próprio (localStorage). Guarda só as preferências do jogo: level (dificuldade), muted e vol (0–100).
   A partida em andamento não é salva. Nunca lança erro: se o navegador bloquear o armazenamento, o jogo segue só em memória. */
(function (global) {
  const KEY = 'arcadia:batalha_naval:v1';
  const FIELDS = ['level', 'muted', 'vol'];
  const VALID = {
    level: (v) => v === 'easy' || v === 'medium' || v === 'hard',
    muted: (v) => typeof v === 'boolean',
    vol: (v) => Number.isInteger(v) && v >= 0 && v <= 100,
  };
  const LEGACY = { level: 'batalha_naval:level', muted: 'batalha_naval:muted', vol: 'batalha_naval:vol' };   // chaves soltas antigas
  let data = null;   // só com valores válidos

  const ls = () => { try { return global.localStorage; } catch (e) { return null; } };
  const readRaw = (key) => { try { const s = ls(); return s ? s.getItem(key) : null; } catch (e) { return null; } };
  const parse = (txt) => { try { return JSON.parse(txt); } catch (e) { return null; } };
  const clean = (o) => { const out = {}; FIELDS.forEach((k) => { if (o && VALID[k](o[k])) out[k] = o[k]; }); return out; };

  // Procura, só para leitura, um registro antigo da Batalha Naval salvo por outro sistema (objeto com level/muted/vol).
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
        if (!key || key === KEY || !/batalha_naval|arcadia|game/i.test(key)) continue;
        const raw = parse(readRaw(key));
        const hit = /batalha_naval/i.test(key) ? findOld(raw, 1) : (raw && findOld(raw.batalha_naval, 1));
        if (hit) { found = clean(hit); break; }
      }
    } catch (e) { /* ignora */ }
    const old = { level: readRaw(LEGACY.level) }, lm = readRaw(LEGACY.muted), lv = readRaw(LEGACY.vol);
    if (lm != null) old.muted = lm === '1';
    if (lv != null && lv !== '') old.vol = Number(lv);
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

  global.BatalhaNavalStorage = { load, save };
})(window);