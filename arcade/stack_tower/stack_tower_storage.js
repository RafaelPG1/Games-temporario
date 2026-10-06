/* arcade/stack_tower/stack_tower_storage.js - dados persistentes da Torre de Blocos (só deste jogo).
   Guarda um único objeto JSON em localStorage:
     best   maior pontuação (recorde; inteiro >= 0)
     muted  sons silenciados (boolean)
   Se o localStorage estiver bloqueado, os dados ficam só em memória (o jogo continua funcionando). */
(() => {
  'use strict';

  const KEY = 'stack_tower:v1';
  const DEFAULTS = { best: 0, muted: false };
  let data = null;

  function area() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  // Aceita só campos conhecidos e válidos
  function clean(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    if (typeof raw.muted === 'boolean') out.muted = raw.muted;
    const best = Math.floor(Number(raw.best));
    if (Number.isFinite(best) && best >= 0 && raw.best !== null && raw.best !== '') out.best = best;
    return out;
  }

  function parse(text) {
    try { return JSON.parse(text); } catch (e) { return text; }
  }

  // Registro do jogo dentro de um objeto maior (ex.: { stack_tower: {...} } ou { games: { stack_tower: {...} } })
  function nestedOf(value) {
    if (!value || typeof value !== 'object') return null;
    return value.stack_tower || (value.games && value.games.stack_tower) || (value.data && value.data.stack_tower) || null;
  }

  // Primeira execução: recupera o que o jogo gravava antes (chaves antigas 'stacktower:best' e 'stacktower:muted',
  // chaves com "stack_tower"/"stacktower" no nome e registros do armazenamento compartilhado antigo).
  function recoverOld(storage) {
    const found = {};
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key || key === KEY) continue;
        const raw = storage.getItem(key);
        if (raw === null) continue;
        const value = parse(raw);
        if (/stack_?tower/i.test(key)) {
          const last = key.split(/[:./]/).pop();
          if (last === 'muted') {
            if (value === 1 || value === '1' || value === true) found.muted = true;
            else if (value === 0 || value === '0' || value === false) found.muted = false;
          } else if (last === 'best') {
            Object.assign(found, clean({ best: value }));
          } else if (value && typeof value === 'object') {
            Object.assign(found, clean(nestedOf(value) || value));
          }
        } else if (typeof raw === 'string' && raw.charAt(0) === '{') {
          const nested = nestedOf(value);
          if (nested) Object.assign(found, clean(nested));
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
      Object.assign(data, clean(parse(saved)));
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

  window.StackTowerStorage = {
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
  };
})();
