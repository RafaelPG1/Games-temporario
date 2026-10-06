// tests/storage.test.js - testes do shared/game_storage.js (Node, sem dependências). Uso: node tests/storage.test.js
const assert = require('assert');
const path = require('path');
const GS = require(path.join(__dirname, '..', 'shared', 'game_storage.js'));

class FakeStorage {
  constructor(opts = {}) { this.m = new Map(); this.failWrites = !!opts.failWrites; this.throwAll = !!opts.throwAll; }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { if (this.throwAll) throw new Error('SecurityError'); return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { if (this.throwAll || this.failWrites) throw new Error('QuotaExceeded'); this.m.set(k, String(v)); }
  removeItem(k) { if (this.throwAll) throw new Error('SecurityError'); this.m.delete(k); }
}
let n = 0; const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

t('ler não grava (inicialização não cria nem sobrescreve nada)', () => {
  const fs = new FakeStorage(); const s = GS.create({ storage: fs }).game('snake');
  assert.strictEqual(s.get('best', 0), 0); assert.strictEqual(s.has('best'), false); s.all();
  assert.strictEqual(fs.m.size, 0);
});
t('set/get/update/remove e tipos JSON', () => {
  const s = GS.create({ storage: new FakeStorage() }).game('sokoban');
  s.set('progress', { unlocked: 4, best: { 0: 12 } }); s.set('muted', true);
  assert.deepStrictEqual(s.get('progress'), { unlocked: 4, best: { 0: 12 } }); assert.strictEqual(s.get('muted'), true);
  s.update('stats', (v) => ({ ...v, games: (v.games || 0) + 1 }), {}); s.update('stats', (v) => ({ ...v, games: v.games + 1 }), {});
  assert.strictEqual(s.get('stats').games, 2);
  assert.strictEqual(s.remove('muted'), true); assert.strictEqual(s.get('muted', 'x'), 'x');
});
t('isolamento entre jogos', () => {
  const fs = new FakeStorage(), g = GS.create({ storage: fs }); const a = g.game('snake'), b = g.game('tetris');
  a.set('best', 10); b.set('best', 99); a.set('best', 11);
  assert.strictEqual(a.get('best'), 11); assert.strictEqual(b.get('best'), 99);
  a.clear(); assert.strictEqual(a.get('best', null), null); assert.strictEqual(b.get('best'), 99);
  assert.deepStrictEqual(g.games(), ['tetris']);
});
t('setRecord (maior e menor é melhor)', () => {
  const s = GS.create({ storage: new FakeStorage() }).game('snake');
  assert.deepStrictEqual(s.setRecord('best', 10), { isRecord: true, best: 10 });
  assert.deepStrictEqual(s.setRecord('best', 7), { isRecord: false, best: 10 });
  assert.deepStrictEqual(s.setRecord('best', 12), { isRecord: true, best: 12 });
  assert.deepStrictEqual(s.setRecord('t', 5000, { lowerIsBetter: true }), { isRecord: true, best: 5000 });
  assert.deepStrictEqual(s.setRecord('t', 6000, { lowerIsBetter: true }), { isRecord: false, best: 5000 });
  assert.strictEqual(s.setRecord('best', NaN).isRecord, false); assert.strictEqual(s.get('best'), 12);
});
t('id inválido é rejeitado', () => { assert.throws(() => GS.create({ storage: new FakeStorage() }).game('Snake Game')); });
t('registro corrompido: ignorado, backup único, dados novos gravados', () => {
  const fs = new FakeStorage(); fs.setItem('arcadia:game:snake', '{quebrado');
  const s = GS.create({ storage: fs }).game('snake');
  assert.strictEqual(s.get('best', 0), 0); assert.strictEqual(fs.getItem('arcadia:game:snake'), '{quebrado'); // leitura não destrói
  s.set('best', 5);
  assert.strictEqual(fs.getItem('arcadia:game:snake:corrupt'), '{quebrado'); assert.strictEqual(s.get('best'), 5);
});
t('forma inválida ({"data":[]}) também é tratada como corrompida', () => {
  const fs = new FakeStorage(); fs.setItem('arcadia:game:snake', '{"v":1,"data":[1]}');
  assert.strictEqual(GS.create({ storage: fs }).game('snake').get('best', 3), 3);
});
t('localStorage lançando exceção: segue funcionando em memória', () => {
  const g = GS.create({ storage: new FakeStorage({ throwAll: true }) }); const s = g.game('snake');
  assert.strictEqual(g.available(), false); assert.strictEqual(s.get('best', 0), 0);
  assert.strictEqual(s.set('best', 9), false); assert.strictEqual(s.get('best'), 9);
});
t('cota cheia: grava em memória, não perde o valor na sessão', () => {
  const s = GS.create({ storage: new FakeStorage({ failWrites: true }) }).game('snake');
  s.set('best', 3); assert.strictEqual(s.get('best', 0), 3);
});
t('sem localStorage nenhum (null)', () => {
  const s = GS.create({ storage: null, }).game('snake'); // cai em root.localStorage (inexistente no Node)
  s.set('a', 1); assert.strictEqual(s.get('a'), 1);
});
t('migrate: copia, confere e remove a chave antiga; tipos int/bool01/json', () => {
  const fs = new FakeStorage(); fs.setItem('snake:best', '42'); fs.setItem('snake:muted', '1'); fs.setItem('sokoban:progress:v2', '{"unlocked":6,"best":{"0":10}}');
  const g = GS.create({ storage: fs }); const s = g.game('snake'), k = g.game('sokoban');
  const r = s.migrate([{ from: 'snake:best', to: 'best', type: 'int' }, { from: 'snake:muted', to: 'muted', type: 'bool01' }]);
  k.migrate([{ from: 'sokoban:progress:v2', to: 'progress', type: 'json' }]);
  assert.deepStrictEqual(r.migrated.sort(), ['snake:best', 'snake:muted']);
  assert.strictEqual(s.get('best'), 42); assert.strictEqual(s.get('muted'), true); assert.deepStrictEqual(k.get('progress'), { unlocked: 6, best: { 0: 10 } });
  assert.strictEqual(fs.getItem('snake:best'), null); assert.strictEqual(fs.getItem('sokoban:progress:v2'), null);
});
t('migrate: não sobrescreve valor novo existente e não apaga a antiga', () => {
  const fs = new FakeStorage(); fs.setItem('snake:best', '5'); const s = GS.create({ storage: fs }).game('snake'); s.set('best', 50);
  const r = s.migrate([{ from: 'snake:best', to: 'best', type: 'int' }]);
  assert.strictEqual(s.get('best'), 50); assert.deepStrictEqual(r.skipped, ['snake:best']); assert.strictEqual(fs.getItem('snake:best'), '5');
});
t('migrate: valor antigo inválido fica intacto e nada é criado', () => {
  const fs = new FakeStorage(); fs.setItem('snake:best', 'abc'); fs.setItem('x:p', '{bad');
  const s = GS.create({ storage: fs }).game('snake');
  s.migrate([{ from: 'snake:best', to: 'best', type: 'int' }, { from: 'x:p', to: 'p', type: 'json' }]);
  assert.strictEqual(fs.getItem('snake:best'), 'abc'); assert.strictEqual(fs.getItem('x:p'), '{bad'); assert.strictEqual(s.has('best'), false);
});
t('migrate: falha de gravação mantém a chave antiga', () => {
  const fs = new FakeStorage({ failWrites: true }); fs.m.set('snake:best', '8');
  const s = GS.create({ storage: fs }).game('snake'); const r = s.migrate([{ from: 'snake:best', to: 'best', type: 'int' }]);
  assert.strictEqual(fs.getItem('snake:best'), '8'); assert.deepStrictEqual(r.migrated, []);
});
t('migrate é idempotente (segunda execução não faz nada)', () => {
  const fs = new FakeStorage(); fs.setItem('snake:best', '9'); const s = GS.create({ storage: fs }).game('snake');
  const rules = [{ from: 'snake:best', to: 'best', type: 'int' }]; s.migrate(rules); const r2 = s.migrate(rules);
  assert.deepStrictEqual(r2, { migrated: [], skipped: [] }); assert.strictEqual(s.get('best'), 9);
});
t('migrate: função de conversão personalizada', () => {
  const fs = new FakeStorage(); fs.setItem('old', '3,4'); const s = GS.create({ storage: fs }).game('snake');
  s.migrate([{ from: 'old', to: 'pair', type: (r) => r.split(',').map(Number) }]); assert.deepStrictEqual(s.get('pair'), [3, 4]);
});
console.log(`\n${n} testes de game_storage passaram.`);
