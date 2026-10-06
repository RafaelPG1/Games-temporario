/* shared/game_storage.js - armazenamento persistente compartilhado dos jogos (localStorage)

   Um registro por jogo, em uma única chave do localStorage:

       arcadia:game:<id>   ->   {"v":1,"data":{ "best": 120, "muted": true, ... }}

   <id> é o identificador técnico e estável do jogo (o nome da pasta: "snake", "water_sort"...).
   Ele NUNCA muda quando o nome exibido muda. Cada jogo só enxerga o próprio registro.

   Uso:
       <script src="../../shared/game_storage.js"></script>
       const store = GameStorage.game('snake');
       store.migrate([{ from: 'snake:best', to: 'best', type: 'int' }]);   // chaves antigas -> novas (1 vez)
       store.get('best', 0);                  // lê (com valor padrão; nunca grava)
       store.set('muted', true);              // grava
       store.update('stats', (s) => ({ ...s, games: (s.games || 0) + 1 }), {});
       store.setRecord('best', score);        // só grava se for melhor -> { isRecord, best }
       store.setRecord('time', ms, { lowerIsBetter: true });
       store.remove('best'); store.all(); store.clear();

   Garantias:
     - ler nunca grava (a inicialização não sobrescreve dados válidos com padrões);
     - sem localStorage (modo privado, bloqueio) ou com a cota cheia, tudo continua funcionando em memória;
     - registro corrompido é ignorado; o texto original é guardado em "arcadia:game:<id>:corrupt"
       (uma única vez) antes de qualquer nova gravação;
     - migrate() só copia uma chave antiga se a nova ainda não existir, confere a leitura de volta e só então
       remove a chave antiga. Valores antigos inválidos são deixados intactos.

   Regras de cada jogo (pontuação, vitória, desbloqueio de fases) ficam no próprio jogo. */
(function (root) {
  'use strict';

  var PREFIX = 'arcadia:game:';
  var VERSION = 1;
  var ID_RE = /^[a-z0-9_]+$/;

  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

  function create(options) {
    var opts = options || {};
    var memory = {};      // espelho em memória: usado quando o localStorage falha
    var warned = false;

    function backend() {
      if (opts.storage) return opts.storage;
      try { return root.localStorage || null; } catch (e) { return null; }
    }
    function rawGet(k) { try { var s = backend(); return s ? s.getItem(k) : null; } catch (e) { return null; } }
    function rawSet(k, v) { try { var s = backend(); if (!s) return false; s.setItem(k, v); return true; } catch (e) { return false; } }
    function rawRemove(k) { try { var s = backend(); if (s) s.removeItem(k); return true; } catch (e) { return false; } }
    function available() {
      try {
        var s = backend(); if (!s) return false;
        var t = PREFIX + '__probe__'; s.setItem(t, '1'); s.removeItem(t); return true;
      } catch (e) { return false; }
    }

    // Lê o registro de um jogo. Devolve { data, corrupt, raw }.
    function readRecord(id) {
      var raw = rawGet(PREFIX + id);
      if (raw === null) return { data: memory[id] ? clone(memory[id]) : {}, corrupt: false, raw: null };
      try {
        var parsed = JSON.parse(raw);
        if (isPlainObject(parsed) && isPlainObject(parsed.data)) return { data: parsed.data, corrupt: false, raw: raw };
      } catch (e) { /* cai para corrompido */ }
      return { data: memory[id] ? clone(memory[id]) : {}, corrupt: true, raw: raw };
    }

    function writeRecord(id, data, rec) {
      memory[id] = clone(data);
      if (rec && rec.corrupt && rec.raw !== null && rawGet(PREFIX + id + ':corrupt') === null) {
        rawSet(PREFIX + id + ':corrupt', rec.raw);   // preserva o texto original uma única vez
      }
      var ok = rawSet(PREFIX + id, JSON.stringify({ v: VERSION, data: data }));
      if (!ok && !warned) { warned = true; try { console.warn('[game_storage] localStorage indisponível; usando memória.'); } catch (e) { /* ignora */ } }
      return ok;
    }

    function game(id) {
      if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('game_storage: id de jogo inválido: ' + id);

      function get(key, fallback) {
        var d = readRecord(id).data;
        return Object.prototype.hasOwnProperty.call(d, key) ? clone(d[key]) : fallback;
      }
      function has(key) { return Object.prototype.hasOwnProperty.call(readRecord(id).data, key); }
      function set(key, value) {
        var rec = readRecord(id);
        if (value === undefined) delete rec.data[key]; else rec.data[key] = clone(value);
        return writeRecord(id, rec.data, rec);
      }
      function update(key, fn, fallback) {
        var rec = readRecord(id);
        var cur = Object.prototype.hasOwnProperty.call(rec.data, key) ? clone(rec.data[key]) : clone(fallback);
        var next = fn(cur);
        if (next === undefined) return false;
        rec.data[key] = clone(next);
        return writeRecord(id, rec.data, rec);
      }
      function remove(key) {
        var rec = readRecord(id);
        if (!Object.prototype.hasOwnProperty.call(rec.data, key)) return false;
        delete rec.data[key];
        return writeRecord(id, rec.data, rec);
      }
      function all() { return clone(readRecord(id).data); }
      function clear() { delete memory[id]; rawRemove(PREFIX + id); }

      // Guarda um recorde só se for melhor que o atual. Números finitos apenas.
      function setRecord(key, value, ropts) {
        var lower = !!(ropts && ropts.lowerIsBetter);
        var n = Number(value);
        var cur = get(key, null);
        if (!Number.isFinite(n)) return { isRecord: false, best: cur };
        var better = cur === null || !Number.isFinite(Number(cur)) || (lower ? n < Number(cur) : n > Number(cur));
        if (better) { set(key, n); return { isRecord: true, best: n }; }
        return { isRecord: false, best: Number(cur) };
      }

      // rules: [{ from: 'chave:antiga', to: 'chaveNova', type: 'int'|'float'|'bool01'|'string'|'json'|fn }]
      // Devolve { migrated: [...], skipped: [...] } (para diagnóstico).
      function migrate(rules) {
        var out = { migrated: [], skipped: [] };
        (rules || []).forEach(function (r) {
          var legacy = rawGet(r.from);
          if (legacy === null) return;                                  // nada a migrar
          if (has(r.to)) { out.skipped.push(r.from); return; }          // já existe valor novo: não sobrescreve
          var value = parseLegacy(legacy, r.type);
          if (value === undefined) { out.skipped.push(r.from); return; } // valor antigo inválido: deixa intacto
          if (!set(r.to, value)) { out.skipped.push(r.from); return; }   // não gravou (cota/indisponível): mantém a antiga
          if (JSON.stringify(get(r.to, undefined)) === JSON.stringify(value)) {   // confirmou a leitura de volta
            rawRemove(r.from);                                                    // só então remove a chave antiga
            out.migrated.push(r.from);
          } else out.skipped.push(r.from);
        });
        return out;
      }

      return { id: id, get: get, has: has, set: set, update: update, remove: remove, all: all, clear: clear, setRecord: setRecord, migrate: migrate };
    }

    // Ids com dados gravados (útil para depuração e testes).
    function games() {
      var ids = [];
      try {
        var s = backend();
        for (var i = 0; s && i < s.length; i++) {
          var k = s.key(i);
          if (k && k.indexOf(PREFIX) === 0 && k.indexOf(':', PREFIX.length) === -1) ids.push(k.slice(PREFIX.length));
        }
      } catch (e) { /* ignora */ }
      return ids.sort();
    }

    return { game: game, games: games, available: available, PREFIX: PREFIX, create: create };
  }

  function parseLegacy(raw, type) {
    try {
      if (typeof type === 'function') return type(raw);
      switch (type) {
        case 'int': { var n = parseInt(raw, 10); return Number.isFinite(n) ? n : undefined; }
        case 'float': { var f = parseFloat(raw); return Number.isFinite(f) ? f : undefined; }
        case 'bool01': return raw === '1' ? true : raw === '0' ? false : undefined;
        case 'json': { var j = JSON.parse(raw); return j === null ? undefined : j; }
        default: return String(raw);
      }
    } catch (e) { return undefined; }
  }

  var api = create();
  root.GameStorage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
