'use strict';
/* Sokoban · armazenamento próprio (localStorage). Guarda só o que é do Sokoban:
   progress = { unlocked, best: { <índice da fase>: menor nº de movimentos } }, last (última fase aberta) e muted.
   Nunca lança erro: se o navegador bloquear o armazenamento, o jogo segue com os dados só em memória. */
(function (global) {
  const KEY = 'arcadia:sokoban:v1';
  const LEGACY = { progress: 'sokoban:progress:v2', last: 'sokoban:last', muted: 'sokoban:muted' };   // chaves soltas de versões antigas
  let data = null;   // { progress, last, muted } já no formato final

  const ls = () => { try { return global.localStorage; } catch (e) { return null; } };
  const readRaw = (key) => { try { const s = ls(); return s ? s.getItem(key) : null; } catch (e) { return null; } };
  const parse = (txt) => { try { return JSON.parse(txt); } catch (e) { return null; } };

  // Procura, só para leitura, um registro antigo do Sokoban salvo por outro sistema (objeto com progress.unlocked).
  function findOld(o, depth) {
    if (!o || typeof o !== 'object' || depth > 4) return null;
    if (o.progress && Number.isInteger(o.progress.unlocked)) return o;
    for (const k of Object.keys(o)) {
      let v = o[k];
      if (typeof v === 'string' && v[0] === '{') v = parse(v);
      const hit = findOld(v, depth + 1);
      if (hit && (/sokoban/i.test(k) || depth > 0 || hit.progress)) return hit;
    }
    return null;
  }
  function migrate() {
    const found = { progress: null, last: null, muted: false };
    try {
      const s = ls();
      if (s) for (let i = 0; i < s.length; i++) {
        const key = s.key(i);
        if (!key || key === KEY || !/sokoban|arcadia|game/i.test(key)) continue;
        const raw = parse(readRaw(key));
        const hit = /sokoban/i.test(key) ? findOld(raw, 1) : (raw && findOld(raw.sokoban, 1));
        if (hit) { found.progress = hit.progress; found.last = hit.last; found.muted = hit.muted === true; break; }
      }
    } catch (e) { /* ignora */ }
    const lp = parse(readRaw(LEGACY.progress)), ll = readRaw(LEGACY.last), lm = readRaw(LEGACY.muted);
    if (!found.progress && lp) found.progress = lp;
    if (found.last == null && ll != null) found.last = Number(ll);
    if (lm != null) found.muted = lm === '1';
    return found;
  }
  function clean(raw, total) {
    const p = raw && raw.progress, best = {};
    const unlocked = Number.isInteger(p && p.unlocked) ? Math.min(Math.max(p.unlocked, 1), total) : 1;
    Object.keys((p && p.best) || {}).forEach((k) => {
      const v = p.best[k], i = Number(k);
      if (Number.isInteger(i) && i >= 0 && i < total && Number.isInteger(v) && v > 0) best[i] = v;
    });
    const last = Number.isInteger(raw && raw.last) && raw.last >= 0 && raw.last < total ? raw.last : null;
    return { progress: { unlocked, best }, last, muted: !!(raw && raw.muted === true) };
  }
  function flush() {
    try { const s = ls(); if (s && data) s.setItem(KEY, JSON.stringify({ v: 1, ...data })); } catch (e) { /* sem espaço ou bloqueado */ }
  }
  function load(total) {
    if (!data) {
      const saved = parse(readRaw(KEY));
      data = clean(saved && saved.v === 1 ? saved : migrate(), total);
      if (!saved) flush();
    }
    return { progress: data.progress, last: data.last, muted: data.muted };
  }
  function ensure() { if (!data) load(Infinity); return data; }

  global.SokobanStorage = {
    load,
    saveProgress(progress) { ensure().progress = { unlocked: progress.unlocked, best: { ...progress.best } }; flush(); },
    saveLast(i) { if (Number.isInteger(i) && i >= 0) { ensure().last = i; flush(); } },
    saveMuted(on) { ensure().muted = !!on; flush(); },
  };
})(window);
