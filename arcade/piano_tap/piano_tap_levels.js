/* ==========================================================================
   arcade/piano_tap/piano_tap_levels.js - fases, estrelas e pontuação do Piano Tap

   Script clássico (sem módulos ES). Carregue DEPOIS de piano_tap_storage.js e ANTES de piano_tap.js.
   Expõe um único objeto global: PianoTapLevels. Aqui ficam TODOS os números de balanceamento:
   para deixar o jogo mais fácil ou difícil, mexa só neste arquivo.

   Fases (1..COUNT):
     - cada fase tem uma META (goal) de teclas; a barra de progresso enche a cada tecla tocada;
     - as estrelas aparecem na barra em STAR_AT (40%, 70% e 100% do caminho); chegar a 100% conclui a fase;
     - a velocidade sobe de forma suave do início ao fim da fase (speedStart -> speedEnd);
     - teclas longas aparecem conforme a fase avança; toda fileira tem exatamente 1 tecla (sem fileiras vazias).
   Modo infinito: sem meta; a velocidade sobe a cada tecla até um teto. Duplas (2 teclas na linha) existem no código, mas estão
   desligadas (doubleChance: 0).
   Desktop (teclado/mouse): get(fase, true) e infinite(true) usam o perfil DESKTOP, um pouco mais lento.

   Pontuação:
     - cada tecla vale 5 (Legal), 7 (Ótimo) ou 9 (Perfeito) pontos, conforme a altura em que a tecla foi tocada:
       quanto mais perto do fim da tela (mais arriscado), mais pontos;
     - tecla longa: pontos do toque + bônus proporcional ao quanto o brilho encheu (máx. 10 na de 2 casas, 16 na de 3).
   ========================================================================== */
(() => {
  'use strict';

  const COUNT = 30;                          // número de fases (o storage guarda LEVEL_COUNT = 30 também)
  const STAR_AT = Object.freeze([0.4, 0.7, 1]);   // fração da meta em que cada estrela é conquistada
  const UNLOCK_STARS = 1;                    // estrelas mínimas numa fase para liberar a seguinte

  // Avaliação do toque: pos = (borda de baixo da tecla) / (altura do tabuleiro). 0 = topo, 1 = linha vermelha.
  const POINTS = Object.freeze({ cool: 5, great: 7, perfect: 9 });
  const LABELS = Object.freeze({ cool: 'Legal', great: 'Ótimo', perfect: 'Perfeito' });
  // Zonas de acerto (fração da altura do tabuleiro em que a borda de baixo da tecla está quando você toca; 0 = topo, 1 = linha vermelha).
// Quanto MENOR o número, MAIOR a zona. Perfeito = de 0.42 até a linha vermelha; Ótimo = de 0.22 a 0.42; Legal = acima disso.
const RATE_AT = Object.freeze({ perfect: 0.42, great: 0.22 });
  const HOLD_BONUS = Object.freeze({ 1: 0, 2: 10, 3: 16 });   // extra máximo ao encher por completo a tecla longa (por nº de casas)

  // Ajuste de dificuldade para teclado/mouse: velocidade e chance de teclas longas.
const DESKTOP = Object.freeze({ speed: 0.8, hold: 0.7 });

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function rate(pos) {
    return pos >= RATE_AT.perfect ? 'perfect' : pos >= RATE_AT.great ? 'great' : 'cool';
  }
  const points = (rating) => POINTS[rating] || POINTS.cool;
  const holdBonus = (len) => HOLD_BONUS[len] || 0;

  // Quantas estrelas valem a fração de progresso (0..1).
  function starsAt(ratio) {
    let n = 0;
    for (let i = 0; i < STAR_AT.length; i++) if (ratio >= STAR_AT[i] - 1e-9) n = i + 1;
    return n;
  }

  // As contagens "From" são em teclas já geradas na fase (spawned).
  function get(level, desktop = false) {
  const n = clamp(Math.round(Number(level)) || 1, 1, COUNT), i = n - 1;
  const k = desktop ? DESKTOP.speed : 1, h = desktop ? DESKTOP.hold : 1;
  const goal = 20 + i * 3;                                                       // 20 teclas na fase 1 ... 107 na fase 30
  const base = 2.2 + i * 0.1;                                                    // unidades/s
  const speedStart = base * k;
  const speedEnd = Math.min(8.4 * k, (base + 1.0 + i * 0.06) * k);
  return {
    n, goal, speedStart, speedEnd,
    speedAt: (done) => lerp(speedStart, speedEnd, clamp(done / goal, 0, 1)),
    holdFrom: 4, holdChance: (i < 2 ? 0 : Math.min(0.32, 0.08 + (i - 2) * 0.009)) * h,                 // teclas longas: a partir da fase 3
    holdLongFrom: 10, holdLongChance: (i < 9 ? 0 : Math.min(0.35, 0.1 + (i - 9) * 0.012)) * h,         // de 3 casas: a partir da fase 10
    doubleFrom: 0, doubleChance: 0,                                                                    // fases: nunca duas teclas na mesma fileira
    gapChance: 0,                                                                                      // fileiras vazias: nunca (toda linha tem 1 tecla)
  };
}

function infinite(desktop = false) {
  const k = desktop ? DESKTOP.speed : 1, h = desktop ? DESKTOP.hold : 1, cap = 8.4 * k, start = 2.4 * k;
  return {
    n: 0, goal: Infinity, speedStart: start, speedEnd: cap,
    speedAt: (done) => Math.min(cap, start + done * 0.07 * k),
    holdFrom: 5, holdChance: 0.2 * h, holdLongFrom: 30, holdLongChance: 0.3 * h,
    doubleFrom: 45, doubleChance: 0,           // duplas DESLIGADAS (1 tecla por linha). Para reativar no celular: ex. 0.12 (raro, a partir de 45 teclas)
    gapChance: 0,                              // fileiras vazias: nunca
  };
}

// stars = array de estrelas por fase (do storage). A fase 1 é sempre liberada.
  function isUnlocked(level, stars) {
    if (level <= 1) return true;
    return level <= COUNT && (stars[level - 2] || 0) >= UNLOCK_STARS;
  }

  window.PianoTapLevels = Object.freeze({ COUNT, STAR_AT, UNLOCK_STARS, POINTS, LABELS, RATE_AT, DESKTOP, rate, points, holdBonus, starsAt, get, infinite, isUnlocked });
})();