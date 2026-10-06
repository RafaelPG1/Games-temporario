# shared/ — módulos compartilhados

Funciona abrindo os arquivos direto no navegador (sem build, sem Node). Cada jogo carrega, **antes** do próprio script:

```html
<link rel="stylesheet" href="jogo.css">
<link rel="stylesheet" href="../../shared/game_ui.css">   <!-- depois do CSS do jogo -->
<script src="../../shared/game_storage.js"></script>
<script src="../../shared/game_ui.js"></script>
<script src="jogo.js"></script>
```

## game_storage.js — armazenamento persistente

Um registro por jogo no `localStorage`, na chave `arcadia:game:<id>`, com o formato `{"v":1,"data":{...}}`.
`<id>` é o **identificador técnico** do jogo (o nome da pasta, ex.: `snake`, `water_sort`). Ele nunca muda quando o
nome exibido muda. Cada jogo só enxerga o próprio registro.

```js
const store = GameStorage.game('snake');

store.migrate([{ from: 'snake:best', to: 'best', type: 'int' }]); // chaves antigas -> novas (uma vez)

store.get('best', 0);              // lê; devolve o padrão se não existir. Ler NUNCA grava.
store.has('best');
store.set('muted', true);          // grava (aceita qualquer valor JSON)
store.update('stats', (s) => ({ ...s, games: (s.games || 0) + 1 }), {});
store.setRecord('best', score);                           // só grava se for melhor -> { isRecord, best }
store.setRecord('tempo', ms, { lowerIsBetter: true });    // para recordes em que menor é melhor
store.remove('best');  store.all();  store.clear();

GameStorage.available();   // true se o localStorage funciona
GameStorage.games();       // ids com dados gravados (depuração)
```

Garantias:

- **Ler nunca grava**: abrir o jogo não sobrescreve dados válidos com valores padrão.
- **Sem localStorage** (modo privado, bloqueado) ou **cota cheia**: o jogo continua funcionando em memória.
- **Registro corrompido**: é ignorado e o texto original é guardado uma vez em `arcadia:game:<id>:corrupt`
  antes de qualquer nova gravação.
- **`migrate`** só copia se a chave nova ainda não existir, confere a leitura de volta e só então remove a antiga.
  Valor antigo inválido é deixado intacto. É idempotente.
- Tipos de `migrate`: `'int'`, `'float'`, `'bool01'` (`'1'`/`'0'`), `'string'`, `'json'` ou uma função `(texto) => valor`.

Regras do jogo (pontuação, vitória, derrota, desbloqueio de fases) ficam no próprio jogo; o módulo só guarda dados.

### Dados guardados por jogo

| id | chaves em `data` |
|---|---|
| `snake`, `piano_tap`, `stack_tower`, `flappy_bird`, `tetris`, `memory_match`, `solitario` | `best`, `muted` (`solitario`: também `mode`) |
| `pac_man` | `best`, `bestLevel`, `muted` |
| `breakout` | `bestLevel`, `muted` |
| `jumpy` | `muted` |
| `jogo_velha` | `mode`, `level`, `starter`, `muted` |
| `campo_minado` | `level` |
| `slide_puzzle` | `level`, `muted`, `best_<dificuldade>` = `{ moves, time }` |
| `batalha_naval` | `level`, `muted`, `vol` |
| `sokoban` | `progress` = `{ unlocked, best: { <índice da fase>: movimentos } }`, `last`, `muted` |
| `water_sort` | `unlocked` (próxima fase liberada), `last`, `muted` |

## game_ui.js / game_ui.css — interface compartilhada

- `GameUI.isTyping(e)` e uma proteção global: teclas digitadas em `input`/`textarea`/`select` não chegam aos atalhos dos jogos.
- **Menu inicial** (`<div id="game-menu" class="gmenu" hidden>…</div>`): abre ao carregar a página, fecha no botão
  `[data-menu-play]` e bloqueia as teclas do jogo enquanto está aberto. Um contêiner `data-mirror="seletor"` recebe
  cópias dos botões de opção do jogo (ex.: dificuldade); clicar na cópia aciona o botão original.
  Com `data-manual`, o jogo chama `GameUI.menu.mount({ el, onOpen, onPlay })` e decide o que fazer.
- **Grade de fases**: `GameUI.levels.mount(el, { total, unlocked, completed, current, selected, onPick })`
  (concluída / atual / disponível / bloqueada). Fases acima de `unlocked` não disparam `onPick`.
- Classes prontas: `.menu-keys` + `<kbd>` (teclas), `.menu-desc`, `.menu-note`, `.menu-touch`, `.menu-progress`.
  A cor de destaque de cada jogo é `--menu-accent` no `:root` do CSS do jogo.

## Como adicionar um jogo novo

1. Crie `<categoria>/<id>/<id>.html`, `.css` e `.js` (o `criar_arquivos.py` da raiz cria a pasta e os arquivos). O `<id>` usa só `a-z`, `0-9` e `_`.
2. No HTML: `<title>Nome · Arcádia</title>`, `<link rel="icon" type="image/svg+xml" href="favicon.svg">` (crie o `favicon.svg`),
   link de retorno `href="../../index.html"`, os módulos acima e um menu inicial com **só os comandos que o jogo implementa**.
3. No JS: `const store = GameStorage.game('<id>');`
4. No `script.js` da raiz: uma linha em `GAMES` (`{ id, title, category }`) e uma ilustração em `GAME_ART['<id>']`.
5. Rode as verificações:

```bash
node tests/check_project.js          # caminhos, catálogo, GAME_ART, ids de storage, cabeçalhos, favicons
node tests/storage.test.js           # testes do game_storage
python3 tests/e2e_browser.py         # (Playwright) abre cada jogo pelo catálogo
python3 tests/migration_browser.py   # (Playwright) migração dos dados antigos
python3 tests/controls_browser.py    # (Playwright) pausa e som
python3 tests/layout_browser.py      # (Playwright) responsivo em 360/390/1280 px
```
