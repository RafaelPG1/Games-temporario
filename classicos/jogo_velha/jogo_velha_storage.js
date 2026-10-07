'use strict';
/* Jogo da Velha · armazenamento próprio (localStorage). Guarda só as preferências do jogo: mode, level, starter e muted.
   O placar é da sessão e não é salvo. Nunca lança erro: se o navegador bloquear o armazenamento, o jogo segue só em memória. */
(function (global) {
  const KEY = 'arcadia:jogo_velha:v1';
  const FIELDS = ['mode', 'level', 'starter', 'muted'];
  const VALID = {
    mode: (v) => v === 'two' || v === 'ai',
    level: (v) => v === 'easy' || v === 'medium' || v === 'hard',
    starter: (v) => v === 'X' || v === 'O',
    muted: (v) => typeof v === 'boolean',
  };
  const LEGACY = { mode: 'jogo_velha:mode', level: 'jogo_velha:level', starter: 'jogo_velha:starter', muted: 'jogo_velha:muted' };   // chaves soltas antigas
  let data = null;   // { mode?, level?, starter?, muted? } só com valores válidos

  const ls = () => { try { return global.localStorage; } catch (e) { return null; } };
  const readRaw = (key) => { try { const s = ls(); return s ? s.getItem(key) : null; } catch (e) { return null; } };
  const parse = (txt) => { try { return JSON.parse(txt); } catch (e) { return null; } };
  const clean = (o) => { const out = {}; FIELDS.forEach((k) => { if (o && VALID[k](o[k])) out[k] = o[k]; }); return out; };

  // Procura, só para leitura, um registro antigo do Jogo da Velha salvo por outro sistema (objeto com mode/level/starter/muted).
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
        if (!key || key === KEY || !/jogo_velha|arcadia|game/i.test(key)) continue;
        const raw = parse(readRaw(key));
        const hit = /jogo_velha/i.test(key) ? findOld(raw, 1) : (raw && findOld(raw.jogo_velha, 1));
        if (hit) { found = clean(hit); break; }
      }
    } catch (e) { /* ignora */ }
    const old = { mode: readRaw(LEGACY.mode), level: readRaw(LEGACY.level), starter: readRaw(LEGACY.starter) }, lm = readRaw(LEGACY.muted);
    if (lm != null) old.muted = lm === '1';
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

  global.JogoVelhaStorage = { load, save };
})(window);