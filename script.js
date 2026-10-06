/* script.js - catálogo (raiz do projeto)

   Para adicionar um jogo: crie a pasta  <categoria>/<id>/  com  <id>.html, <id>.css e <id>.js
   (ex.: puzzle/novo_jogo/novo_jogo.html) e inclua uma linha em GAMES.

   GAMES: { id, title, category, path?, available?, art? }
     - id:        identificador técnico e ESTÁVEL. É o nome da pasta/arquivo e o id usado no game_storage.
                  Nunca muda quando o nome exibido muda.
     - title:     nome exibido ao usuário (em português).
     - category:  um id de CATEGORIES (também é a pasta pai do jogo).
     - path:      (opcional) caminho exato a partir da raiz. Sem ele vale <category>/<id>/<id>.html.
     - available: (opcional) false mostra "Em breve" e mantém o card sem link.
     - art:       (opcional) HTML de um <svg> próprio; sem ele usa GAME_ART[id] e, na falta, a arte da categoria.

   CATEGORIES: { id, nome, hue }  (hue 0-360 define a cor dos cards) */
const CATEGORIES = [
  { id: 'arcade',      nome: 'Arcade',         hue: 320 },
  { id: 'puzzle',      nome: 'Quebra-cabeças', hue: 190 },
  { id: 'classicos',   nome: 'Clássicos',      hue: 42  },
  { id: 'estrategia',  nome: 'Estratégia',     hue: 150 },
  { id: 'casual',      nome: 'Casual',         hue: 12  }
];

const GAMES = [
  { id: 'flappy_bird',   title: 'Flappy Bird',              category: 'arcade' },
  { id: 'jumpy',         title: 'Pula-Pula',                category: 'arcade' },
  { id: 'tetris',        title: 'Tetris',                   category: 'arcade' },
  { id: 'breakout',      title: 'Quebra-Blocos',            category: 'arcade' },
  { id: 'stack_tower',   title: 'Torre de Blocos',          category: 'arcade' },
  { id: 'snake',         title: 'Cobrinha',                 category: 'classicos' },
  { id: 'memory_match',  title: 'Jogo da Memória',          category: 'puzzle' },
  { id: 'slide_puzzle',  title: 'Quebra-Cabeça Deslizante', category: 'puzzle' },
  { id: 'water_sort',    title: 'Tubos de Cores',           category: 'puzzle' },
  { id: 'piano_tap',     title: 'Piano Tap',                category: 'arcade' },
  { id: 'campo_minado',  title: 'Campo Minado',             category: 'puzzle' },
  { id: 'sokoban',       title: 'Sokoban',                  category: 'puzzle' },
  { id: 'jogo_velha',    title: 'Jogo da Velha',            category: 'classicos' },
  { id: 'batalha_naval', title: 'Batalha Naval',            category: 'estrategia' },
  { id: 'solitario',     title: 'Paciência',                category: 'casual' },
  { id: 'pac_man',       title: 'Pac-Man',                  category: 'arcade' }
];

/* ===== ARTE DAS MINIATURAS (SVG) ===== */
const px = (rows, s = 8) => rows.flatMap((r, y) => [...r].map((c, x) =>
  c === '1' ? `<rect x="${x * s}" y="${y * s}" width="${s - 1}" height="${s - 1}" rx="1.5"/>` : '')).join('');
const svg = (w, h, body) => `<svg viewBox="0 0 ${w} ${h}" fill="currentColor" aria-hidden="true">${body}</svg>`;
const INVADER = ['00100000100','00010001000','00111111100','01101110110','11111111111','10111111101','10100000101','00011011000'];
const LINE = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

// Arte padrão por categoria (também usada nas vagas "Em breve").
const ART = {
  arcade: () => svg(88, 64, px(INVADER)),
  puzzle: () => svg(96, 64, [[0,0],[24,0],[48,0],[24,24],[0,24],[72,24],[48,48],[72,48]].map(([x, y], i) =>
    `<rect x="${x + 1}" y="${y + 1}" width="22" height="22" rx="5" opacity="${i % 3 ? .55 : 1}"/>`).join('')),
  classicos: () => svg(100, 64, '<rect x="4" y="16" width="8" height="26" rx="3"/><rect x="88" y="26" width="8" height="26" rx="3"/><circle cx="56" cy="30" r="5"/><path d="M50 4v56" stroke="currentColor" stroke-width="2" stroke-dasharray="4 6" opacity=".4"/>'),
  estrategia: () => svg(100, 72, [[30,22],[70,22],[50,56]].map(([x, y], i) =>
    `<polygon points="${[0,1,2,3,4,5].map(k => `${(x + 20 * Math.cos(k * Math.PI / 3 + Math.PI / 6)).toFixed(1)},${(y + 20 * Math.sin(k * Math.PI / 3 + Math.PI / 6)).toFixed(1)}`).join(' ')}" opacity="${i === 1 ? 1 : .5}"/>`).join('')),
  casual: () => svg(96, 64, '<circle cx="24" cy="38" r="18"/><circle cx="58" cy="26" r="14" opacity=".6"/><circle cx="76" cy="46" r="10" opacity=".85"/><circle cx="44" cy="10" r="6" opacity=".5"/>')
};

// Arte própria de cada jogo. Chave = id do jogo.
const GAME_ART = {
  'flappy_bird': () => svg(100, 64, '<rect x="84" y="0" width="12" height="20" rx="3" opacity=".4"/><rect x="82" y="16" width="16" height="6" rx="2" opacity=".4"/><rect x="84" y="44" width="12" height="20" rx="3" opacity=".4"/><rect x="82" y="42" width="16" height="6" rx="2" opacity=".4"/>' +
    '<ellipse cx="40" cy="34" rx="21" ry="17"/><ellipse cx="32" cy="39" rx="11" ry="7" fill="var(--bg)" opacity=".45" transform="rotate(-20 32 39)"/>' +
    '<path d="M58 29l15 5-15 6z" opacity=".7"/><circle cx="49" cy="27" r="5" fill="var(--bg)"/><circle cx="50.6" cy="27" r="2"/>'),
  'jumpy': () => svg(100, 64, '<rect x="14" y="52" width="40" height="8" rx="4" opacity=".5"/><rect x="50" y="36" width="36" height="8" rx="4" opacity=".75"/><rect x="18" y="20" width="30" height="8" rx="4" opacity=".5"/><circle cx="66" cy="29" r="6"/><circle cx="66" cy="19" r="4"/>'),
  'tetris': () => svg(63, 54, px(['0011100','0001000','0000000','1100000','1101110','1111110'], 9)),
  'breakout': () => svg(100, 66, [0,1,2].flatMap(r => [0,1,2,3,4].map(c =>
    `<rect x="${c * 19 + 2}" y="${r * 10 + 2}" width="17" height="8" rx="2" opacity="${1 - r * .25}"/>`)).join('') + '<circle cx="54" cy="46" r="4"/><rect x="36" y="58" width="30" height="5" rx="2.5"/>'),
  'stack_tower': () => svg(100, 64, [[30,50],[24,38],[34,26],[28,14],[32,2]].map(([x, y], i) =>
    `<rect x="${x}" y="${y}" width="40" height="10" rx="2" opacity="${.45 + i * .14}"/>`).join('')),
  'snake': () => svg(100, 64, `<path d="M12 50H44V32H72V14H86" ${LINE} stroke-width="9"/><circle cx="88" cy="14" r="7"/><circle cx="20" cy="16" r="4" opacity=".6"/>`),
  'memory_match': () => svg(100, 64, '<rect x="12" y="8" width="34" height="48" rx="6" opacity=".5" transform="rotate(-8 29 32)"/><rect x="54" y="8" width="34" height="48" rx="6"/><circle cx="71" cy="32" r="9" fill="var(--bg)"/>'),
  'slide_puzzle': () => svg(64, 64, [...Array(8).keys()].map(i =>
    `<rect x="${(i % 3) * 22}" y="${Math.floor(i / 3) * 22}" width="20" height="20" rx="4" opacity="${i % 2 ? .55 : 1}"/>`).join('')),
  'water_sort': () => svg(92, 64, [[1, .55, 1], [.55, .55], [1]].map((layers, i) => {
    const x = 6 + i * 30;
    return `<rect x="${x}" y="4" width="24" height="56" rx="12" ${LINE.replace('none', 'none')} stroke-width="2" opacity=".7"/>` +
      layers.map((o, j) => `<rect x="${x + 4}" y="${46 - j * 12}" width="16" height="11" rx="${j ? 2 : 6}" opacity="${o}"/>`).join('');
  }).join('')),
  'campo_minado': () => svg(64, 64, [...Array(9).keys()].map(i => `<rect x="${(i % 3) * 22}" y="${Math.floor(i / 3) * 22}" width="20" height="20" rx="3" opacity="${i === 4 || i === 6 ? .9 : .28}"/>`).join('') +
    '<g fill="var(--bg)"><circle cx="32" cy="32" r="5"/></g><path d="M32 23v18M23 32h18M26 26l12 12M38 26L26 38" stroke="var(--bg)" stroke-width="2" stroke-linecap="round"/><path d="M8 59V46M8 46l8 3.5-8 3.5" stroke="var(--bg)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="var(--bg)"/>'),
  'sokoban': () => svg(66, 66, '<rect x="0" y="0" width="66" height="14" rx="3" opacity=".35"/><rect x="0" y="52" width="66" height="14" rx="3" opacity=".35"/><rect x="0" y="14" width="14" height="38" opacity=".35"/>' +
    '<rect x="26" y="22" width="22" height="22" rx="3"/><path d="M30 26l14 14M44 26L30 40" stroke="var(--bg)" stroke-width="2.4" stroke-linecap="round"/><circle cx="56" cy="33" r="5" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="19" cy="33" r="5" opacity=".7"/>'),
  'jogo_velha': () => svg(66, 66, `<path d="M22 4v58M44 4v58M4 22h58M4 44h58" ${LINE} stroke-width="3" opacity=".45"/><path d="M8 8l10 10M18 8L8 18" ${LINE} stroke-width="4"/><circle cx="33" cy="33" r="7" ${LINE.replace('none', 'none')} stroke-width="4"/><path d="M48 48l10 10M58 48L48 58" ${LINE} stroke-width="4"/>`),
  'batalha_naval': () => svg(100, 64, `<path d="M8 40h84l-12 14H22z"/><rect x="36" y="26" width="26" height="14" rx="2" opacity=".6"/><rect x="46" y="14" width="6" height="12" rx="1"/><path d="M6 60q9-6 18 0t18 0 18 0 18 0 18 0" ${LINE} stroke-width="3" opacity=".45"/>`),
  'solitario': () => svg(88, 64, '<rect x="10" y="8" width="38" height="52" rx="6" opacity=".45" transform="rotate(-9 29 34)"/><rect x="40" y="6" width="38" height="52" rx="6"/>' +
    '<text x="48" y="24" font-size="15" font-weight="800" font-family="system-ui,sans-serif" fill="var(--bg)">A</text><path d="M59 28l9 11-9 11-9-11z" fill="var(--bg)"/>'),
  'pac_man': () => svg(100, 64, `<path d="M4 20h30M50 20h46M4 44h46M66 44h30M34 20v14M66 20v14" ${LINE} stroke-width="4" opacity=".4"/><path d="M26 32L38 22a13 13 0 1 0 0 20z" transform="translate(6 0)"/><circle cx="58" cy="32" r="3" opacity=".8"/><circle cx="72" cy="32" r="3" opacity=".8"/><circle cx="86" cy="32" r="3" opacity=".8"/>`),
  'piano_tap': () => svg(92, 64, ['0100', '0001', '1000', '0010'].flatMap((row, r) => [...row].map((c, k) =>
    `<rect x="${k * 23}" y="${r * 16}" width="21" height="14" rx="3" ${c === '1' ? '' : 'opacity=".25"'}/>`)).join(''))
};

/* ===== ESTADO E RENDERIZAÇÃO ===== */
const $ = (s) => document.querySelector(s);
const state = { q: '', cat: 'todos' };
const norm = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const catOf = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];

// Link do jogo: path explícito, ou <categoria>/<id>/<id>.html (a estrutura real de pastas).
const gameUrl = (g) => g.path || `${g.category}/${g.id}/${g.id}.html`;
const PLAY = '<svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M2 1l9 5-9 5z"/></svg>';

// Vagas reservadas: aparecem só em categorias sem jogos (ou com o catálogo vazio).
const SLOTS = [0, 1].flatMap(() => CATEGORIES.map((c) => ({ category: c.id, slot: true })));

function card(item, i) {
  const c = catOf(item.category);
  const soon = item.slot || item.available === false;
  const art = item.art || (GAME_ART[item.id] || ART[c.id])();
  const play = soon ? '' : `<span class="play">${PLAY}Jogar</span>`;
  const inner = `<div class="thumb">${art}${play}</div>
    <div class="body"><span class="name">${item.slot ? 'Vaga reservada' : esc(item.title)}</span><span class="cat">${esc(c.nome)}</span></div>`;
  const style = `style="--h:${c.hue};--i:${Math.min(i, 14)}"`;
  const badge = soon ? '<span class="badge">Em breve</span>' : '';
  if (soon) return `<div class="card soon" ${style}>${badge}${inner}</div>`;
  return `<a class="card" ${style} href="${esc(gameUrl(item))}" aria-label="Jogar ${esc(item.title)}, ${esc(c.nome)}">${inner}</a>`;
}

function visibleItems() {
  const q = norm(state.q);
  const list = GAMES.filter((g) => (state.cat === 'todos' || g.category === state.cat) &&
    (!q || norm(g.title).includes(q) || norm(catOf(g.category).nome).includes(q)));
  if (list.length || q) return list;
  return SLOTS.filter((s) => state.cat === 'todos' || s.category === state.cat);
}

function render() {
  const list = visibleItems();
  const grid = $('#catalogo');
  if (list.length) {
    grid.innerHTML = list.map(card).join('');
  } else {
    const msg = !GAMES.length ? ['Nenhum jogo cadastrado ainda', 'Quando os jogos chegarem, você poderá encontrá-los por aqui.']
      : ['Nenhum jogo encontrado', 'Tente outro nome ou volte para todas as categorias.'];
    grid.innerHTML = `<div class="empty"><svg viewBox="0 0 88 64" fill="currentColor" aria-hidden="true" opacity=".85">${px(INVADER)}</svg>
      <strong>${msg[0]}</strong>${msg[1]}</div>`;
  }
  $('#status').textContent = list.length ? '' : 'Nenhum resultado.';
}

function renderChips() {
  const all = [{ id: 'todos', nome: 'Todos', hue: 45 }, ...CATEGORIES];
  $('#categorias').innerHTML = all.map((c) =>
    `<button class="chip" type="button" data-cat="${c.id}" style="--h:${c.hue}" aria-pressed="${c.id === state.cat}">${esc(c.nome)}</button>`).join('');
}

$('#categorias').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  state.cat = b.dataset.cat;
  document.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', x === b));
  render();
});
$('#busca').addEventListener('input', (e) => { state.q = e.target.value; render(); });

renderChips();
render();