// tests/check_project.js - verificações estáticas do projeto (Node, sem dependências).
// Uso (na raiz do projeto):  node tests/check_project.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const problems = [];
const fail = (msg) => problems.push(msg);
let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) fail(msg); };

const walk = (dir, out = []) => {
  for (const n of fs.readdirSync(dir)) {
    if (n === '.git' || n === 'node_modules') continue;
    const p = path.join(dir, n);
    fs.statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const files = walk(ROOT);
const isLocal = (u) => u && !/^(https?:|data:|mailto:|tel:|#|javascript:|\/\/)/i.test(u);

/* 1) Referências locais em HTML (href, src) e CSS (url()) existem de verdade */
for (const f of files.filter((f) => f.endsWith('.html'))) {
  const html = fs.readFileSync(f, 'utf8');
  for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
    const u = m[1];
    if (!isLocal(u)) continue;
    const target = path.resolve(path.dirname(f), u.split('#')[0].split('?')[0]);
    ok(fs.existsSync(target), `${rel(f)}: referência quebrada -> ${u}`);
  }
}
for (const f of files.filter((f) => f.endsWith('.css'))) {
  const css = fs.readFileSync(f, 'utf8');
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    const u = m[1];
    if (!isLocal(u)) continue;
    ok(fs.existsSync(path.resolve(path.dirname(f), u)), `${rel(f)}: url() quebrada -> ${u}`);
  }
}

/* 2) Sintaxe de todos os .js */
for (const f of files.filter((f) => f.endsWith('.js') && !f.includes('/tests/'))) {
  try { new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }); ok(true); } catch (e) { fail(`${rel(f)}: erro de sintaxe: ${e.message}`); }
}

/* 3) Catálogo: carrega script.js com um DOM falso e confere GAMES / GAME_ART / CATEGORIES */
const stubEl = () => new Proxy(function () {}, { get: (t, k) => (k === 'classList' ? { add() {}, toggle() {} } : k === 'dataset' ? {} : stubEl()), apply: () => stubEl(), set: () => true });
const sandbox = { document: { querySelector: stubEl, querySelectorAll: () => [], addEventListener() {} }, window: {}, console };
vm.createContext(sandbox);
const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8') + '\n;this.__out = { GAMES, GAME_ART, CATEGORIES, ART, gameUrl };';
vm.runInContext(src, sandbox, { filename: 'script.js' });
const { GAMES, GAME_ART, CATEGORIES, ART, gameUrl } = sandbox.__out;

const ids = new Set(), catIds = new Set(CATEGORIES.map((c) => c.id));
for (const g of GAMES) {
  ok(!ids.has(g.id), `catálogo: id duplicado ${g.id}`); ids.add(g.id);
  ok(/^[a-z0-9_]+$/.test(g.id), `catálogo: id técnico inválido ${g.id}`);
  ok(catIds.has(g.category), `catálogo: categoria inexistente em ${g.id}: ${g.category}`);
  ok(g.title && g.title.trim(), `catálogo: ${g.id} sem título`);
  const url = gameUrl(g);
  ok(fs.existsSync(path.join(ROOT, url)), `catálogo: destino inexistente de ${g.id}: ${url}`);
  ok(url === `${g.category}/${g.id}/${g.id}.html`, `catálogo: ${g.id} aponta para ${url}, fora da estrutura <categoria>/<id>/<id>.html`);
  const art = GAME_ART[g.id];
  ok(typeof art === 'function', `GAME_ART: sem ilustração para ${g.id}`);
  if (typeof art === 'function') {
    const out = art();
    ok(typeof out === 'string' && out.startsWith('<svg') && out.endsWith('</svg>'), `GAME_ART: ${g.id} não devolve um <svg> completo`);
  }
  // O título exibido deve ser o mesmo da página, do cabeçalho e do menu inicial do jogo
  const html = fs.readFileSync(path.join(ROOT, url), 'utf8');
  ok(html.includes(`<title>${g.title} · Arcádia</title>`), `${url}: <title> diferente do catálogo (${g.title})`);
  ok(new RegExp(`<div class="game-text"><(strong|h1)>${g.title}</\\1></div>`).test(html), `${url}: cabeçalho sem o nome "${g.title}"`);
  ok(/class="game-text"/.test(html) && !/class="keys"/.test(html), `${url}: o cabeçalho ainda contém instruções (.keys)`);
  ok(!/\bGG\b/.test(html), `${url}: "GG" no HTML`);
  ok(/<link rel="icon" type="image\/svg\+xml" href="favicon\.svg">/.test(html), `${url}: sem <link rel="icon">`);
  ok(fs.existsSync(path.join(ROOT, path.dirname(url), 'favicon.svg')), `${url}: favicon.svg ausente`);
  ok(/class="back" href="\.\.\/\.\.\/index\.html"/.test(html), `${url}: link de retorno ao catálogo incorreto`);
  ok(html.includes('../../shared/game_storage.js') && html.includes('../../shared/game_ui.js') && html.includes('../../shared/game_ui.css'), `${url}: não carrega os módulos compartilhados`);
  ok(html.indexOf('game_storage.js') < html.indexOf(`${g.id}.js`) && html.indexOf('game_ui.js') < html.indexOf(`${g.id}.js`), `${url}: módulos compartilhados devem vir antes de ${g.id}.js`);
  ok(/id="game-menu"/.test(html) || /screen-ready|screen-title/.test(html), `${url}: sem menu inicial`);
  // id do game_storage = id técnico do jogo
  const js = fs.readFileSync(path.join(ROOT, path.dirname(url), `${g.id}.js`), 'utf8');
  const m = js.match(/GameStorage\.game\('([a-z0-9_]+)'\)/);
  ok(m && m[1] === g.id, `${g.id}.js: GameStorage.game('${m && m[1]}') não coincide com o id do jogo`);
  ok(!/localStorage|sessionStorage/.test(js), `${g.id}.js: ainda usa localStorage diretamente`);
}
for (const k of Object.keys(GAME_ART)) ok(ids.has(k), `GAME_ART: chave "${k}" não corresponde a nenhum jogo`);
for (const c of CATEGORIES) ok(typeof ART[c.id] === 'function', `ART: sem arte padrão para a categoria ${c.id}`);

/* 4) Todo jogo existente em pasta está no catálogo (e vice-versa) */
const gameHtml = files.map(rel).filter((p) => /^(arcade|puzzle|classicos|estrategia|casual)\/[^/]+\/[^/]+\.html$/.test(p));
for (const p of gameHtml) ok(GAMES.some((g) => gameUrl(g) === p), `catálogo: ${p} existe mas não está listado`);

/* 5) Comentário de cabeçalho com caminho: precisa bater com o caminho real */
for (const f of files.filter((f) => /\.(html|css|js)$/.test(f) && !/\/(shared|tests)\//.test(f))) {
  const head = fs.readFileSync(f, 'utf8').split('\n').slice(0, 4).join('\n');
  const m = head.match(/(?:\/\*|<!--)\s*=*\s*\n?\s*([A-Za-z_]+\/)*[A-Za-z_]+\.(?:css|js|html)\b/);
  if (m) { const tok = m[0].match(/([A-Za-z_]+\/)*[A-Za-z_]+\.(?:css|js|html)/)[0]; if (tok.includes('/')) ok(tok === rel(f), `${rel(f)}: comentário de cabeçalho indica "${tok}"`); }
}

/* 6) localStorage só no módulo compartilhado */
for (const f of files.filter((f) => /\.(js|html)$/.test(f) && !/\/tests\//.test(f) && !f.endsWith('game_storage.js'))) {
  const t = fs.readFileSync(f, 'utf8');
  ok(!/localStorage\.|sessionStorage\./.test(t), `${rel(f)}: acesso direto ao localStorage`);
}

/* 7) Referências antigas que não devem mais existir */
const banned = [/jogo_faltando/, /flappy_Bird/, /flappy_bird_storage/, /FlappyBirdStorage/, /\.\.\/arcade\/index\.html/, /Tetris\.(css|js|html)/];
for (const f of files.filter((f) => /\.(js|html|css)$/.test(f) && !/\/tests\//.test(f))) {
  const t = fs.readFileSync(f, 'utf8');
  for (const b of banned) ok(!b.test(t), `${rel(f)}: referência antiga ${b}`);
}

console.log(`${checks} verificações, ${problems.length} problema(s).`);
if (problems.length) { console.log(problems.map((p) => ' - ' + p).join('\n')); process.exit(1); }
