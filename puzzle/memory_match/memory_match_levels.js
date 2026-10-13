/* ==========================================================================
   puzzle/memory_match/memory_match_levels.js - fases e tamanhos de partida do Jogo da Memória

   Script clássico (sem módulos ES). Carregue DEPOIS de memory_match_symbols.js e ANTES de memory_match.js.
   Expõe um único objeto global: MemoryMatchLevels. Todo o balanceamento fica aqui:

   Fases (1..COUNT):
     - a fase N tem N + 1 pares (fase 1 = 4 cartas ... fase 18 = 38 cartas): nenhuma fase repete a quantidade de cartas;
     - cada fase usa um conjunto de símbolos próprio: o tema gira (Natureza, Formas, Bichinhos, Frutas, Jogos) e, a cada
       volta completa, o conjunto começa 3 símbolos mais adiante; quando o tema não tem símbolos suficientes, continua no próximo;
     - cada fase tem um TEMPO-META fixo (seconds): é a referência a ser batida. Passar do tempo não reprova a fase.
     - a fase N+1 é liberada ao concluir a fase N.
   Contra a IA / 2 Jogadores: três tamanhos (SIZES) com símbolos sorteados.
   ========================================================================== */
(() => {
  'use strict';
  const S = window.MemoryMatchSymbols;

  const COUNT = 18;
  const DEFAULT_PAIRS = 10;                  // tabuleiro decorativo dos menus
  const SIZES = Object.freeze([
    Object.freeze({ pairs: 6, cards: 12, label: 'Pequeno' }),
    Object.freeze({ pairs: 10, cards: 20, label: 'Médio' }),
    Object.freeze({ pairs: 15, cards: 30, label: 'Grande' }),
  ]);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pairsOf = (n) => n + 1;
  // Tempo-meta em segundos, múltiplo de 5: 35 s na fase 1 ... 3 min 5 s na fase 18.
  const secondsOf = (pairs) => Math.round((15 + pairs * 9) / 5) * 5;

  // Símbolos (ids globais) do tema `start`, girados `rot` posições, seguidos dos temas seguintes.
  function iconsFor(n, pairs) {
    const T = S.THEMES, t = (n - 1) % T.length, rot = Math.floor((n - 1) / T.length) * 3, out = [];
    for (let k = 0; out.length < pairs && k < T.length; k++) {
      const th = T[(t + k) % T.length], r = k === 0 ? rot % th.count : 0;
      for (let i = 0; i < th.count && out.length < pairs; i++) out.push(th.from + ((i + r) % th.count));
    }
    return out;
  }

  function get(level) {
    const n = clamp(Math.round(Number(level)) || 1, 1, COUNT), pairs = pairsOf(n);
    return { n, pairs, cards: pairs * 2, seconds: secondsOf(pairs), theme: S.THEMES[(n - 1) % S.THEMES.length].name, icons: iconsFor(n, pairs) };
  }

  // Sorteia `pairs` símbolos de um tema (e do seguinte, se faltar) para as partidas Contra a IA e 2 Jogadores.
  function randomIcons(pairs) {
    const T = S.THEMES, t = Math.floor(Math.random() * T.length), pool = [];
    for (let k = 0; pool.length < pairs && k < T.length; k++) {
      const th = T[(t + k) % T.length], ids = Array.from({ length: th.count }, (_, i) => th.from + i);
      for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
      pool.push(...ids);
    }
    return pool.slice(0, pairs);
  }

  // done = array de booleanos por fase (do storage). A fase 1 é sempre liberada.
  const isUnlocked = (level, done) => level <= 1 || (level <= COUNT && done[level - 2] === true);

  window.MemoryMatchLevels = Object.freeze({ COUNT, SIZES, DEFAULT_PAIRS, get, randomIcons, isUnlocked });
})();
