# Arcádia — site completo (18 jogos)

Página da Arcádia (`index.html`, `style.css`, `script.js`) mais 18 jogos de navegador, cada um em sua pasta. Tudo é HTML, CSS e JavaScript puro: sem Node.js, npm, build ou backend.

## Como executar

Abra `index.html` no navegador. Também funciona em hospedagem estática, enviando a pasta inteira. Os cards abrem `<pasta-do-jogo>/index.html` por caminho relativo.

## Jogos, origem e licença

| Pasta | Jogo no catálogo | Origem | Licença |
|---|---|---|---|
| flappy_bird, ant-jump, block-drop, breakout, stack-tower, piano-tap | Ant Flap, Ant Jump, Block Drop, Breakout, Stack Tower, Piano Tap | mashukui/web-games, commit 38094525 | MIT |
| snake | Snake | idem | MIT |
| memory-match, slide-puzzle, sudoku, water-sort | Memory Match, Slide Puzzle, Sudoku, Water Sort | idem | MIT |
| 2048 | 2048 | idem | MIT |
| minesweeper | Campo Minado | idem | MIT |
| sokoban | Sokoban | idem | MIT |
| tic-tac-toe | Jogo da Velha | idem | MIT |
| battleship | Batalha Naval | idem | MIT |
| maze-muncher | Maze Muncher | idem | MIT |
| solitaire | Solitário (Klondike) | jhatzimalis/solitaire, commit a737d5a (2026-05-18) | MIT |

Repositórios: https://github.com/mashukui/web-games e https://github.com/jhatzimalis/solitaire

## Licenças e atribuição

- Os textos completos estão em `licencas/` (`web-games-mashukui-MIT.txt`, © 2026 mashukui; `solitaire-jhatzimalis-MIT.txt`, © 2026 Justin Hatzimalis) e devem acompanhar qualquer redistribuição. A pasta `solitaire/` também tem uma cópia do `LICENSE`.
- A MIT exige manter o aviso de copyright e a licença. Os dois autores não exigem crédito visível, mas os rodapés originais (créditos, GitHub e link para saveone.pro) foram mantidos nos jogos do mashukui.
- Recursos gráficos, sonoros e fontes: nenhum jogo usa arquivos externos de imagem, áudio ou fonte. O som é sintetizado por WebAudio e as fontes são do sistema. Nenhum jogo faz requisições externas.
- Fases do Sokoban: segundo o comentário no código, as 30 fases foram geradas por script. Não consegui confirmar isso de forma independente.
- Nomes: títulos como Sokoban e Battleship podem ser marcas de terceiros. Não verifiquei registros. No catálogo usei "Batalha Naval", "Campo Minado" e "Jogo da Velha".

## Alterações em relação às fontes originais

1. Jogos do mashukui: `src="../i18n.js"` virou `src="i18n.js"` (cópia do `i18n.js` em cada pasta); `GC_SITE` foi esvaziado no `i18n.js`, o que desliga o contador de visitas do autor (`analytics.js` não incluído); e o botão Home e o link "More games" passaram de `../` para `../index.html`, para voltar à Arcádia também ao abrir direto do disco.
2. Solitário: removidos `canonical`, `og:url` e `twitter:url`, que apontavam para o site do autor, e os emojis da mensagem de vitória.
3. Nenhuma mudança de jogabilidade ou visual nos jogos.

## Verificação feita

Em Chromium 141 headless, abrindo os arquivos via `file://`:

- Os 18 cards do catálogo abrem o jogo correto, sem erros de JavaScript, sem requisições externas e sem requisições falhas.
- O botão Home volta à Arcádia nos 17 jogos que têm esse botão.
- Interação básica: 2048 (setas), Campo Minado (clique revela células), Sokoban (setas), Jogo da Velha (jogada e resposta), Batalha Naval (posicionar, iniciar e 8 tiros com resposta do computador), Maze Muncher (iniciar e setas) e Solitário (comprar do estoque, cronômetro).
- **Não testado:** partidas completas e telas de vitória/derrota, bandeiras do Campo Minado, arrastar cartas do Solitário, som, toque em celular real, Firefox e Safari, e idiomas além do inglês.

## Pendências

- O Solitário tem interface só em inglês e não tem botão para voltar à Arcádia.
- Os jogos do mashukui usam emojis em favicons, botões e telas iniciais, mantidos por preservação.
- Cada `i18n.js` tem ~341 KB e traz textos de todos os jogos do repositório de origem.
