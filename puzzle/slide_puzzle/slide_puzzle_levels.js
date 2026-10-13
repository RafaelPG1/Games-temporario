/* ==========================================================================
   puzzle/slide_puzzle/slide_puzzle_levels.js - fases, dificuldades e lógica do tabuleiro do Quebra-Cabeça Deslizante

   Script clássico (sem módulos ES). Carregue DEPOIS de slide_puzzle_storage.js e ANTES de slide_puzzle.js.
   Expõe um único objeto global: SlidePuzzleLevels. Todo o balanceamento fica aqui:

   Modo Livre (DIFFICULTIES): easy 3×3, medium 4×4, hard 5×5, cada um com seus passos de embaralhamento.
   Modo Fases (1..COUNT = 20): progressão linear em três faixas de tamanho; dentro de cada faixa o embaralhamento
     (steps) e a distância mínima da solução (minDist) crescem fase a fase:
       fases  1 a  6 -> 3×3      fases  7 a 13 -> 4×4      fases 14 a 20 -> 5×5
     A fase N+1 é liberada ao concluir a fase N (isUnlocked).
   Lógica do tabuleiro (sem DOM): solvedBoard, isSolved, distance, neighbors, shuffled.
   ========================================================================== */
(() => {
  'use strict';

  const COUNT = 20;                      // precisa bater com LEVEL_COUNT de slide_puzzle_storage.js
  const DIFFICULTIES = Object.freeze({
    easy:   Object.freeze({ n: 3, steps: 120, minDist: 12 }),
    medium: Object.freeze({ n: 4, steps: 240, minDist: 24 }),
    hard:   Object.freeze({ n: 5, steps: 400, minDist: 44 }),
  });
  const TIERS = Object.freeze([
    Object.freeze({ from: 1,  to: 6,  n: 3, steps: [40, 130],  minDist: [4, 12] }),
    Object.freeze({ from: 7,  to: 13, n: 4, steps: [100, 260], minDist: [12, 26] }),
    Object.freeze({ from: 14, to: 20, n: 5, steps: [220, 420], minDist: [24, 44] }),
  ]);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (r, t) => Math.round(r[0] + (r[1] - r[0]) * t);

  // Parâmetros da fase: { stage, n (lado do tabuleiro), steps, minDist }
  function get(level) {
    const stage = clamp(Math.round(Number(level)) || 1, 1, COUNT);
    const tier = TIERS.find((t) => stage <= t.to), t = (stage - tier.from) / (tier.to - tier.from);
    return { stage, n: tier.n, steps: lerp(tier.steps, t), minDist: lerp(tier.minDist, t) };
  }

  // done = array de booleanos por fase (do storage). A fase 1 é sempre liberada.
  const isUnlocked = (level, done) => level <= 1 || (level <= COUNT && done[level - 2] === true);

  /* ---- tabuleiro ---- */
  const solvedBoard = (n) => Array.from({ length: n * n }, (_, i) => (i === n * n - 1 ? 0 : i + 1));
  function isSolved(b) { return b.every((v, i) => v === (i === b.length - 1 ? 0 : i + 1)); }
  function distance(b, n) {
    let d = 0;
    b.forEach((v, i) => { if (v) { const t = v - 1; d += Math.abs(Math.floor(i / n) - Math.floor(t / n)) + Math.abs((i % n) - (t % n)); } });
    return d;
  }
  function neighbors(e, n) {
    const r = Math.floor(e / n), c = e % n, out = [];
    if (r > 0) out.push(e - n); if (r < n - 1) out.push(e + n);
    if (c > 0) out.push(e - 1); if (c < n - 1) out.push(e + 1);
    return out;
  }

  /* Parte do estado resolvido e aplica movimentos válidos aleatórios (sempre solucionável).
     cfg = { n, steps, minDist } (uma dificuldade ou get(fase)); avoid = configurações (arrays) que não podem se repetir.
     Se nenhuma tentativa atingir minDist, devolve a mais embaralhada que encontrou. */
  function shuffled(cfg, avoid = []) {
    const { n, steps, minDist } = cfg;
    const same = (b) => avoid.some((a) => a && a.length === b.length && a.every((v, i) => v === b[i]));
    let best = null, bestDist = -1;
    for (let attempt = 0; attempt < 100; attempt++) {
      const b = solvedBoard(n); let e = b.length - 1, prev = -1;
      for (let s = 0; s < steps; s++) {
        let opts = neighbors(e, n);
        if (opts.length > 1) opts = opts.filter((i) => i !== prev);
        const t = opts[Math.floor(Math.random() * opts.length)];
        b[e] = b[t]; b[t] = 0; prev = e; e = t;
      }
      if (isSolved(b) || same(b)) continue;
      const d = distance(b, n);
      if (d >= minDist) return b;
      if (d > bestDist) { best = b; bestDist = d; }
    }
    if (best) return best;
    const b = solvedBoard(n); b[b.length - 1] = b[b.length - 2]; b[b.length - 2] = 0; return b; // reserva: um movimento
  }

  window.SlidePuzzleLevels = Object.freeze({ COUNT, DIFFICULTIES, get, isUnlocked, solvedBoard, isSolved, distance, neighbors, shuffled });
})();
