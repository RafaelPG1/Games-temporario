# base/ — infraestrutura visual compartilhada dos jogos

Dois arquivos CSS, sem JavaScript, sem build. Cada jogo carrega, **antes** do próprio CSS:

```html
<link rel="stylesheet" href="../../base/base.css?v=1">
<link rel="stylesheet" href="../../base/ui.css?v=1">
<link rel="stylesheet" href="meu_jogo.css">
```

(Todos os jogos ficam em `<categoria>/<jogo>/`, por isso o caminho é `../../base/`.)

## O que cada arquivo traz
- **base.css** — tokens `--shell-*` e `--tip-delay`, reset e fundo da página (`html`, `body`), `.topbar`, botão Catálogo (`.back`), `.game-id` / `.game-mark` / `.game-text`.
- **ui.css** — `.sr-only`, `.noscript`, botão `?` (`.help-btn`), estrutura da janela de ajuda (`.help-close`, `.help-popover`) e o esqueleto de tooltip por CSS.

## Como um jogo sobrescreve (sem tocar na base)
A base é só um **padrão**. Quase todas as regras usam `:where()` (especificidade zero): qualquer regra do CSS do jogo vence, sem `!important` e sem depender da ordem.

```css
/* meu_jogo.css — só este jogo muda */
:root { --shell-bg: #071a35; --shell-hover-line: rgba(126,224,138,.6); }
.topbar { height: 72px; }
.back  { border-radius: 6px; }
```

Variáveis de ajuste: `--shell-bg`, `--shell-surface`, `--shell-line`, `--shell-text`, `--shell-muted`, `--shell-accent`, `--shell-topbar-h` (56px), `--shell-topbar-h-sm` (52px, telas ≤640px), `--shell-topbar-top` (início do degradê do cabeçalho), `--shell-hover-bg`, `--shell-hover-line`, `--tip-delay`.

**Exceção importante:** regras de estado (`.back:hover`, `.back:active`, `.back:focus-visible`, `.help-btn:hover`, `.help-btn:active`, `.help-popover[hidden]`, `.help-popover[data-placement=…]::before`) mantêm a especificidade normal, porque dependem de vencer a regra base do componente. Para mudar uma delas, repita **o mesmo seletor** no CSS do jogo (ele carrega depois e vence o empate).

## O que NÃO está na base (fica em cada jogo)
Layout/posição do cabeçalho (`display`, `grid-template-columns`, `grid-column`, `justify-self`), marca e título, `touch-action`, `font-family`, cor e fonte do texto do cabeçalho, aparência, posição e animação dos tooltips, conteúdo e tamanho da janela "Como jogar", pausa, storage, áudio, mecânicas. **Nenhum JavaScript é compartilhado.**

## Tooltips por CSS (adesão explícita)
O esqueleto de `[data-tip]::before/::after` (posição absoluta, oculto por padrão) só vale com `<html lang="pt-BR" class="tips-css">`. Sem a classe, a base não toca nos tooltips (jogos com tooltip por JS não são afetados). A base nunca define `content`: o jogo declara `content: attr(data-tip)`, aparência, posição e a regra que mostra o tooltip.

## Cache
`?v=N` por arquivo, incrementado à mão quando o arquivo muda. Se alterar `base.css` ou `ui.css`, suba o `?v=` em **todos** os jogos (é um arquivo único para os 16).

## Cuidados ao editar a base
1. Uma mudança em `base.css`/`ui.css` afeta todos os jogos. Teste pelo menos um jogo de cada tipo de cabeçalho (grid `1fr auto 1fr`, grid com `minmax`, flex, `slide_puzzle`).
2. Ao mover uma declaração do CSS de um jogo para a base, confira a cascata: base vem antes, então empates de especificidade passam a ser vencidos pelas regras do jogo, e uma regra genérica de elemento (`button { color: inherit }`) vence um `:where()`.
3. Não ponha `touch-action`, `font-family` nem cores de texto do cabeçalho na base: nem todos os jogos declaram o mesmo valor.
4. Não use `base/` para storage, pausa, áudio ou gameplay.

## Novo jogo
Crie `<categoria>/<jogo>/` com os 3 arquivos (o `criar_arquivos.py` já faz isso), adicione os dois `<link>` da base antes do CSS do jogo e declare o layout do cabeçalho (`display: grid; grid-template-columns: 1fr auto 1fr` e o posicionamento de `.back` e `.game-id`) no CSS do jogo.
