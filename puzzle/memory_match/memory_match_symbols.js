/* ==========================================================================
   puzzle/memory_match/memory_match_symbols.js - biblioteca de símbolos do Jogo da Memória

   Script clássico (sem módulos ES). Carregue ANTES de memory_match_levels.js e memory_match.js.
   Expõe um único objeto global: MemoryMatchSymbols.

   São 60 símbolos (SVG próprio, viewBox 48, cor principal = currentColor via --c) em 5 temas de 12:
     Natureza · Formas · Bichinhos · Frutas · Jogos e objetos
   ALL é a lista plana (o índice é o "id global" do símbolo, usado nas fases e no salvamento);
   THEMES diz onde cada tema começa. Os detalhes claros usam o creme #fffaf0; olhos e contornos, o índigo #2b2d5b.
   ========================================================================== */
(() => {
  'use strict';

  const CR = '#fffaf0', INK = '#2b2d5b';
  const f1 = (n) => Math.round(n * 10) / 10;
  // Polígono regular com n lados e estrela com n pontas (centro 24,24).
  const poly = (n, r, rot = -90, cy = 24) => Array.from({ length: n }, (_, i) => {
    const a = (rot + (i * 360) / n) * Math.PI / 180;
    return `${f1(24 + r * Math.cos(a))},${f1(cy + r * Math.sin(a))}`;
  }).join(' ');
  const starPts = (n, ro, ri, rot = -90) => Array.from({ length: n * 2 }, (_, i) => {
    const a = (rot + (i * 180) / n) * Math.PI / 180, r = i % 2 ? ri : ro;
    return `${f1(24 + r * Math.cos(a))},${f1(24 + r * Math.sin(a))}`;
  }).join(' ');
  const shape = (pts) => `<polygon points="${pts}" fill="currentColor" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>`;
  const eyes = (y = 25, dx = 6.5, r = 2.4) => `<circle cx="${24 - dx}" cy="${y}" r="${r}" fill="${INK}"/><circle cx="${24 + dx}" cy="${y}" r="${r}" fill="${INK}"/>`;
  const line = (d, w = 1.5, c = INK) => `<path d="${d}" stroke="${c}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  const mouth = (y) => line(`M24 ${y}v2M24 ${y + 2}c-2 2-4 2-5.5 1M24 ${y + 2}c2 2 4 2 5.5 1`);

  const natureza = [
    { name: 'Sol', hue: '#f0a500', svg: '<circle cx="24" cy="24" r="9" fill="currentColor"/><g stroke="currentColor" stroke-width="3.5" stroke-linecap="round"><path d="M24 4v6M24 38v6M4 24h6M38 24h6M10 10l4 4M34 34l4 4M38 10l-4 4M14 34l-4 4"/></g>' },
    { name: 'Lua', hue: '#4f5fd0', svg: '<path d="M32 6a18 18 0 1 0 10 28A15 15 0 0 1 32 6z" fill="currentColor"/>' },
    { name: 'Estrela', hue: '#e4572e', svg: '<path d="M24 4l6 13 14 2-10 10 3 14-13-7-13 7 3-14L4 19l14-2z" fill="currentColor"/>' },
    { name: 'Folha', hue: '#3a9d5d', svg: `<path d="M8 40C6 18 20 6 42 6c0 22-12 36-30 34z" fill="currentColor"/><path d="M10 38C20 26 28 20 36 14" stroke="${CR}" stroke-width="2.5" fill="none" stroke-linecap="round"/>` },
    { name: 'Gota', hue: '#2f9bd8', svg: `<path d="M24 4C16 16 10 23 10 31a14 14 0 0 0 28 0c0-8-6-15-14-27z" fill="currentColor"/><path d="M17 31a7 7 0 0 0 7 7" stroke="${CR}" stroke-width="2.5" fill="none" stroke-linecap="round"/>` },
    { name: 'Raio', hue: '#8a4fd6', svg: '<path d="M28 3L10 27h11l-3 18 20-26H27z" fill="currentColor"/>' },
    { name: 'Nuvem', hue: '#6f869e', svg: '<g fill="currentColor"><circle cx="15" cy="28" r="9"/><circle cx="26" cy="21" r="11"/><circle cx="35" cy="29" r="8"/><rect x="10" y="28" width="30" height="9" rx="4.5"/></g>' },
    { name: 'Flor', hue: '#e0457b', svg: `<g fill="currentColor"><circle cx="24" cy="13.5" r="7.5"/><circle cx="34" cy="20.8" r="7.5"/><circle cx="30.2" cy="32.5" r="7.5"/><circle cx="17.8" cy="32.5" r="7.5"/><circle cx="14" cy="20.8" r="7.5"/></g><circle cx="24" cy="25" r="5.5" fill="#ffc857"/>` },
    { name: 'Cogumelo', hue: '#e4572e', svg: `<path d="M5 26a19 18 0 0 1 38 0z" fill="currentColor"/><path d="M17 26h14l-2 15a3 3 0 0 1-3 2.5h-4A3 3 0 0 1 19 41z" fill="currentColor" opacity=".45"/><g fill="${CR}"><circle cx="15" cy="20" r="3.2"/><circle cx="26" cy="14" r="3.6"/><circle cx="34" cy="21" r="2.8"/></g>` },
    { name: 'Pinheiro', hue: '#2f8a52', svg: '<path d="M24 3l10 14h-5.5l9 12.5H10.5l9-12.5H14z" fill="currentColor"/><rect x="21" y="29" width="6" height="12" rx="1.5" fill="currentColor" opacity=".55"/>' },
    { name: 'Montanha', hue: '#5b6fa8', svg: `<path d="M3 40L19 10l8 14 5-8 13 24z" fill="currentColor"/><path d="M19 10l-5.5 10 5-3.2 4 3.4z" fill="${CR}"/>` },
    { name: 'Floco de neve', hue: '#2f9bd8', svg: '<g stroke="currentColor" stroke-width="3.5" stroke-linecap="round" fill="none"><path d="M24 5v38M7.5 14.5l33 19M7.5 33.5l33-19"/><path d="M19 8l5 4 5-4M19 40l5-4 5 4"/></g>' },
  ];

  const formas = [
    { name: 'Círculo', hue: '#e4572e', svg: '<circle cx="24" cy="24" r="17" fill="currentColor"/>' },
    { name: 'Quadrado', hue: '#2f9bd8', svg: '<rect x="7.5" y="7.5" width="33" height="33" rx="5" fill="currentColor"/>' },
    { name: 'Triângulo', hue: '#3a9d5d', svg: shape(poly(3, 19, -90, 28)) },
    { name: 'Losango', hue: '#8a4fd6', svg: shape(`24,4 40,24 24,44 8,24`) },
    { name: 'Pentágono', hue: '#f0a500', svg: shape(poly(5, 18, -90, 26)) },
    { name: 'Hexágono', hue: '#17a8a0', svg: shape(poly(6, 18, 0)) },
    { name: 'Octógono', hue: '#e0457b', svg: shape(poly(8, 18, 22.5)) },
    { name: 'Estrela de cinco pontas', hue: '#f0a500', svg: shape(starPts(5, 20, 8.5)) },
    { name: 'Brilho', hue: '#4f5fd0', svg: shape(starPts(4, 21, 5.5)) },
    { name: 'Cruz', hue: '#e4572e', svg: '<path d="M18 5h12v13h13v12H30v13H18V30H5V18h13z" fill="currentColor"/>' },
    { name: 'Anel', hue: '#17a8a0', svg: '<circle cx="24" cy="24" r="14.5" fill="none" stroke="currentColor" stroke-width="7"/>' },
    { name: 'Semicírculo', hue: '#6f869e', svg: '<path d="M5 32a19 19 0 0 1 38 0z" fill="currentColor"/>' },
  ];

  const bichos = [
    { name: 'Gato', hue: '#e8833a', svg: `<path d="M8 21L9 4l12 8zM40 21L39 4 27 12z" fill="currentColor"/><circle cx="24" cy="27" r="16" fill="currentColor"/><path d="M12 8.5l-.8 7 5-3.2zM36 8.5l.8 7-5-3.2z" fill="#ffb59a"/>${eyes(25)}<path d="M21.5 30h5l-2.5 3z" fill="#ff7a8a"/>${mouth(33)}` },
    { name: 'Cachorro', hue: '#b9763a', svg: `<ellipse cx="9" cy="23" rx="5.5" ry="11" transform="rotate(12 9 23)" fill="#6b4220"/><ellipse cx="39" cy="23" rx="5.5" ry="11" transform="rotate(-12 39 23)" fill="#6b4220"/><circle cx="24" cy="27" r="15.5" fill="currentColor"/><ellipse cx="24" cy="33" rx="8" ry="6" fill="${CR}"/>${eyes(24, 7)}<ellipse cx="24" cy="30.5" rx="3.2" ry="2.4" fill="${INK}"/>${line('M24 33v3M24 36c-2 2-4 1.5-5 0M24 36c2 2 4 1.5 5 0')}` },
    { name: 'Urso', hue: '#8a5a3c', svg: `<circle cx="11" cy="13" r="6.5" fill="currentColor"/><circle cx="37" cy="13" r="6.5" fill="currentColor"/><circle cx="11" cy="13" r="3" fill="#d9a77f"/><circle cx="37" cy="13" r="3" fill="#d9a77f"/><circle cx="24" cy="27" r="16.5" fill="currentColor"/><ellipse cx="24" cy="32.5" rx="7.5" ry="5.8" fill="#e9c9a5"/>${eyes(23, 7.5)}<ellipse cx="24" cy="30" rx="3" ry="2.1" fill="${INK}"/>${line('M24 32v2.5M24 34.5c-2 1.6-3.6 1.2-4.4 0M24 34.5c2 1.6 3.6 1.2 4.4 0')}` },
    { name: 'Coelho', hue: '#b78cd9', svg: `<ellipse cx="17" cy="12" rx="4.8" ry="11" transform="rotate(-8 17 12)" fill="currentColor"/><ellipse cx="31" cy="12" rx="4.8" ry="11" transform="rotate(8 31 12)" fill="currentColor"/><ellipse cx="17" cy="12" rx="2.3" ry="7.5" transform="rotate(-8 17 12)" fill="#ffc3d6"/><ellipse cx="31" cy="12" rx="2.3" ry="7.5" transform="rotate(8 31 12)" fill="#ffc3d6"/><circle cx="24" cy="31" r="14.5" fill="currentColor"/>${eyes(29, 6.5)}<ellipse cx="24" cy="33.5" rx="2.4" ry="1.8" fill="#ff7a8a"/>${line('M24 35.3v1.4M24 36.7c-1.6 1.6-3.4 1.2-4 0M24 36.7c1.6 1.6 3.4 1.2 4 0')}` },
    { name: 'Porco', hue: '#f4909f', svg: `<path d="M9 15l2-10 10 6zM39 15l-2-10-10 6z" fill="currentColor"/><circle cx="24" cy="26" r="16.5" fill="currentColor"/><ellipse cx="24" cy="31.5" rx="8.5" ry="6.2" fill="#e8667f"/><ellipse cx="21" cy="31.5" rx="1.4" ry="2.2" fill="${INK}"/><ellipse cx="27" cy="31.5" rx="1.4" ry="2.2" fill="${INK}"/>${eyes(21, 8, 2.3)}` },
    { name: 'Panda', hue: '#2f3447', svg: `<circle cx="11" cy="12" r="6" fill="currentColor"/><circle cx="37" cy="12" r="6" fill="currentColor"/><circle cx="24" cy="27" r="16.5" fill="#ffffff" stroke="currentColor" stroke-width="2"/><ellipse cx="16.5" cy="25" rx="4.2" ry="5.6" transform="rotate(20 16.5 25)" fill="currentColor"/><ellipse cx="31.5" cy="25" rx="4.2" ry="5.6" transform="rotate(-20 31.5 25)" fill="currentColor"/><circle cx="17" cy="24.5" r="1.7" fill="#ffffff"/><circle cx="31" cy="24.5" r="1.7" fill="#ffffff"/><ellipse cx="24" cy="31" rx="3.2" ry="2.2" fill="currentColor"/>${line('M24 33v2M24 35c-1.8 1.6-3.4 1.2-4 0M24 35c1.8 1.6 3.4 1.2 4 0', 1.5, '#2f3447')}` },
    { name: 'Rato', hue: '#8d97ad', svg: `<circle cx="10.5" cy="14" r="8.5" fill="currentColor"/><circle cx="37.5" cy="14" r="8.5" fill="currentColor"/><circle cx="10.5" cy="14" r="4.6" fill="#ffc3d6"/><circle cx="37.5" cy="14" r="4.6" fill="#ffc3d6"/><ellipse cx="24" cy="29" rx="14.5" ry="15.5" fill="currentColor"/>${eyes(26, 6.5, 2.3)}<circle cx="24" cy="35.5" r="2.7" fill="#ff7a8a"/>${line('M9 33l8 1M9 38.5l8-2.5M39 33l-8 1M39 38.5l-8-2.5', 1.2)}` },
    { name: 'Raposa', hue: '#e4572e', svg: `<path d="M24 43L5 21 8 5l12 9h8l12-9 3 16z" fill="currentColor"/><path d="M9 8.5l-.8 6 5-3.4zM39 8.5l.8 6-5-3.4z" fill="#ffd0b8"/><path d="M24 43L9 26c5 4 10 5 15 5s10-1 15-5z" fill="#ffd9bf"/>${eyes(23, 7.5)}<circle cx="24" cy="40" r="2.3" fill="${INK}"/>` },
    { name: 'Leão', hue: '#d68a10', svg: `<circle cx="24" cy="25" r="20" fill="currentColor"/><circle cx="24" cy="27" r="12.5" fill="#ffd98a"/><circle cx="14" cy="11" r="4.2" fill="currentColor" stroke="#ffd98a" stroke-width="1.5"/><circle cx="34" cy="11" r="4.2" fill="currentColor" stroke="#ffd98a" stroke-width="1.5"/>${eyes(25, 5.5, 2.2)}<path d="M21.5 29.5h5L24 32z" fill="${INK}"/>${line('M24 32v2M24 34c-2 1.8-3.6 1.4-4.4 0M24 34c2 1.8 3.6 1.4 4.4 0')}` },
    { name: 'Sapo', hue: '#3f9d4f', svg: `<ellipse cx="24" cy="29" rx="19" ry="14" fill="currentColor"/><circle cx="14" cy="16" r="7.5" fill="currentColor"/><circle cx="34" cy="16" r="7.5" fill="currentColor"/><circle cx="14" cy="16" r="5" fill="${CR}"/><circle cx="34" cy="16" r="5" fill="${CR}"/><circle cx="14.6" cy="16.4" r="2.4" fill="${INK}"/><circle cx="33.4" cy="16.4" r="2.4" fill="${INK}"/>${line('M10 33c8 6 20 6 28 0', 2)}<circle cx="21" cy="27" r="1" fill="${INK}"/><circle cx="27" cy="27" r="1" fill="${INK}"/>` },
    { name: 'Coruja', hue: '#9a6b3f', svg: `<path d="M9 15L8 3l10 6zM39 15l1-12-10 6z" fill="currentColor"/><ellipse cx="24" cy="27" rx="17" ry="18" fill="currentColor"/><circle cx="16" cy="22" r="7.2" fill="${CR}"/><circle cx="32" cy="22" r="7.2" fill="${CR}"/><circle cx="16.5" cy="22.5" r="3.3" fill="${INK}"/><circle cx="31.5" cy="22.5" r="3.3" fill="${INK}"/><path d="M21 28h6l-3 6z" fill="#f0a500"/>${line('M16 39l3 2 5-2 5 2 3-2', 2, CR)}` },
    { name: 'Pinguim', hue: '#2b2d5b', svg: `<ellipse cx="24" cy="24" rx="16" ry="19" fill="currentColor"/><ellipse cx="24" cy="29.5" rx="10" ry="12.5" fill="${CR}"/><circle cx="18" cy="18" r="3.6" fill="${CR}"/><circle cx="30" cy="18" r="3.6" fill="${CR}"/><circle cx="18.4" cy="18.4" r="1.7" fill="${INK}"/><circle cx="29.6" cy="18.4" r="1.7" fill="${INK}"/><path d="M20.5 22.5h7l-3.5 5z" fill="#f09a1c"/><ellipse cx="17" cy="44" rx="5" ry="2.4" fill="#f09a1c"/><ellipse cx="31" cy="44" rx="5" ry="2.4" fill="#f09a1c"/>` },
  ];

  const LEAF = '#3a9d5d';
  const frutas = [
    { name: 'Maçã', hue: '#e0382e', svg: `<path d="M24 15c-5-5-17-4-17 9 0 10 7 19 12 19 2.5 0 3.5-1.5 5-1.5s2.5 1.5 5 1.5c5 0 12-9 12-19 0-13-12-14-17-9z" fill="currentColor"/><path d="M24 15c0-4 1-8 3-11" stroke="#6b4220" stroke-width="2.6" stroke-linecap="round" fill="none"/><path d="M26 10c3-4 8-5 11-4-1 4-5 7-11 4z" fill="${LEAF}"/>` },
    { name: 'Cereja', hue: '#c4152f', svg: `<circle cx="13.5" cy="35" r="8" fill="currentColor"/><circle cx="34" cy="34" r="8" fill="currentColor"/><path d="M14 28C16 18 22 11 29 6M34 27C33 19 31 12 29 6" stroke="#4a8a3a" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M29 6c4-3 9-2 12 1-4 3-9 3-12-1z" fill="${LEAF}"/><circle cx="11" cy="32.5" r="1.8" fill="${CR}" opacity=".7"/>` },
    { name: 'Laranja', hue: '#f08a1c', svg: `<circle cx="24" cy="26" r="17" fill="currentColor"/><path d="M24 9c0-3 2-5 5-5 0 3-2 5-5 5z" fill="${LEAF}"/><path d="M13 22a12 12 0 0 1 6-8" stroke="${CR}" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".7"/>` },
    { name: 'Limão', hue: '#e3bb18', svg: `<ellipse cx="24" cy="25" rx="18" ry="12.5" transform="rotate(-25 24 25)" fill="currentColor"/><circle cx="8.4" cy="31.6" r="2.6" fill="currentColor"/><circle cx="39.6" cy="18.4" r="2.6" fill="currentColor"/><path d="M15 23a10 8 0 0 1 8-6" stroke="${CR}" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".75"/>` },
    { name: 'Melancia', hue: '#2f9f4f', svg: `<path d="M3 15h42a21 21 0 0 1-42 0z" fill="currentColor"/><path d="M7.5 15h33a16.5 16.5 0 0 1-33 0z" fill="#ef4a5a"/><g fill="${INK}"><ellipse cx="17" cy="21" rx="1.4" ry="2.2"/><ellipse cx="24" cy="25" rx="1.4" ry="2.2"/><ellipse cx="31" cy="21" rx="1.4" ry="2.2"/></g>` },
    { name: 'Morango', hue: '#e0243f', svg: `<path d="M24 43C10 35 7 23 9 17c4-3 10-2 15-1 5-1 11-2 15 1 2 6-1 18-15 26z" fill="currentColor"/><path d="M13 16l4-6 4 3 3-5 3 5 4-3 4 6z" fill="${LEAF}"/><g fill="${CR}"><ellipse cx="17" cy="24" rx="1.2" ry="1.8"/><ellipse cx="25" cy="22" rx="1.2" ry="1.8"/><ellipse cx="32" cy="25" rx="1.2" ry="1.8"/><ellipse cx="21" cy="31" rx="1.2" ry="1.8"/><ellipse cx="28" cy="32" rx="1.2" ry="1.8"/><ellipse cx="24" cy="38" rx="1.2" ry="1.8"/></g>` },
    { name: 'Uva', hue: '#7a3fb0', svg: `<g fill="currentColor"><circle cx="15" cy="19" r="6.6"/><circle cx="24" cy="19" r="6.6"/><circle cx="33" cy="19" r="6.6"/><circle cx="19.5" cy="28" r="6.6"/><circle cx="28.5" cy="28" r="6.6"/><circle cx="24" cy="37" r="6.6"/></g><path d="M24 13V6" stroke="#6b4220" stroke-width="2.6" stroke-linecap="round"/><path d="M25 8c3-4 8-4 11-2-3 4-8 5-11 2z" fill="${LEAF}"/><circle cx="12.8" cy="16.8" r="1.6" fill="${CR}" opacity=".6"/>` },
    { name: 'Banana', hue: '#f2c230', svg: `<path d="M6 10c-2 17 8 30 31 29 2 0 3.5-1.2 4.5-3.2-1.5-1-3.5-.4-6-.4C17 35 11 25 11.5 8.5 9 7 7 8 6 10z" fill="currentColor"/><path d="M6 10c1-3 4-3.5 6-1.5" stroke="#6b4220" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M14 18c1.5 7 6 12 12 14" stroke="${CR}" stroke-width="2" fill="none" stroke-linecap="round" opacity=".6"/>` },
    { name: 'Abacaxi', hue: '#f0a500', svg: `<ellipse cx="24" cy="31" rx="12" ry="14.5" fill="currentColor"/><path d="M24 17c-2-5-6-7-10-7 2 3 4 5 7 6-4 0-7 2-8 4 4 0 8-1 11-3zM24 17c2-5 6-7 10-7-2 3-4 5-7 6 4 0 7 2 8 4-4 0-8-1-11-3zM24 17c-2.5-5-2-9 0-13 2 4 2.5 8 0 13z" fill="${LEAF}"/><path d="M15 25l18 14M33 25L15 39M13 32l22 0M24 19v24" stroke="${CR}" stroke-width="1.6" fill="none" opacity=".7"/>` },
    { name: 'Pera', hue: '#8fba2f', svg: `<path d="M24 8c4 0 7 3 7 8 0 4 1.5 6 5 10 4 5 2 16-12 16S8 31 12 26c3.5-4 5-6 5-10 0-5 3-8 7-8z" fill="currentColor"/><path d="M24 8c0-2 1-4 3-5" stroke="#6b4220" stroke-width="2.6" stroke-linecap="round" fill="none"/><path d="M26 6c3-3 7-3 10-1-3 3-7 4-10 1z" fill="${LEAF}"/><path d="M16 31a8 8 0 0 0 5 7" stroke="${CR}" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".6"/>` },
    { name: 'Pêssego', hue: '#f6926b', svg: `<path d="M24 12c-9-4-18 2-18 14 0 9 8 16 18 16s18-7 18-16c0-12-9-18-18-14z" fill="currentColor"/><path d="M24 12c-3 7-3 20 0 30" stroke="#d96a45" stroke-width="2" fill="none" stroke-linecap="round" opacity=".7"/><path d="M25 11c1-5 5-8 10-8 0 5-4 8-10 8z" fill="${LEAF}"/>` },
    { name: 'Mirtilo', hue: '#3d5fc4', svg: `<circle cx="24" cy="26" r="16.5" fill="currentColor"/><polygon points="${starPts(5, 5.2, 2.2).split(' ').map((p) => { const [x, y] = p.split(','); return `${f1(+x)},${f1(+y - 3)}`; }).join(' ')}" fill="${CR}" opacity=".85"/><path d="M12 22a12 12 0 0 1 5-8" stroke="${CR}" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".5"/>` },
  ];

  const jogos = [
    { name: 'Espadas', hue: '#2b2d5b', svg: '<path d="M24 4C15 13 6 19 6 29c0 6 5 9.5 10 7.5 1-.4 2-1 3-2-1 5-2 8-5 10h20c-3-2-4-5-5-10 1 1 2 1.6 3 2 5 2 10-1.5 10-7.5C42 19 33 13 24 4z" fill="currentColor"/>' },
    { name: 'Paus', hue: '#1f7a4d', svg: '<g fill="currentColor"><circle cx="24" cy="13.5" r="9"/><circle cx="14" cy="28" r="9"/><circle cx="34" cy="28" r="9"/><path d="M24 22l-5 21h10z"/></g>' },
    { name: 'Ouros', hue: '#e4572e', svg: '<path d="M24 3l15 21-15 21L9 24z" fill="currentColor"/>' },
    { name: 'Copas', hue: '#e0457b', svg: '<path d="M24 42C6 30 4 18 10 11c5-5 12-3 14 3 2-6 9-8 14-3 6 7 4 19-14 31z" fill="currentColor"/>' },
    { name: 'Dado', hue: '#4f5fd0', svg: `<rect x="6.5" y="6.5" width="35" height="35" rx="7.5" fill="currentColor"/><g fill="${CR}"><circle cx="16" cy="16" r="3.2"/><circle cx="32" cy="16" r="3.2"/><circle cx="24" cy="24" r="3.2"/><circle cx="16" cy="32" r="3.2"/><circle cx="32" cy="32" r="3.2"/></g>` },
    { name: 'Coroa', hue: '#f0a500', svg: `<path d="M6 35L4 13l12 10 8-13 8 13 12-10-2 22z" fill="currentColor"/><rect x="6" y="37" width="36" height="5.5" rx="2.2" fill="currentColor"/><g fill="${CR}"><circle cx="24" cy="29" r="2.6"/><circle cx="14" cy="30" r="2"/><circle cx="34" cy="30" r="2"/></g>` },
    { name: 'Troféu', hue: '#d9a21b', svg: '<path d="M13 5h22v13a11 11 0 0 1-22 0z" fill="currentColor"/><path d="M13 9H6.5v4a8 8 0 0 0 8 8M35 9h6.5v4a8 8 0 0 1-8 8" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/><rect x="21" y="28" width="6" height="8" fill="currentColor"/><rect x="14" y="36" width="20" height="7" rx="2.5" fill="currentColor"/>' },
    { name: 'Chave', hue: '#a8642a', svg: '<circle cx="15" cy="15" r="9" fill="none" stroke="currentColor" stroke-width="5"/><path d="M21 21l20 20M31 31l5-5M37 37l5-5" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>' },
    { name: 'Cadeado', hue: '#6f869e', svg: `<path d="M15.5 22v-6a8.5 8.5 0 0 1 17 0v6" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round"/><rect x="8" y="21" width="32" height="22" rx="5" fill="currentColor"/><circle cx="24" cy="30.5" r="3.2" fill="${CR}"/><rect x="22.6" y="32" width="2.8" height="6" rx="1.2" fill="${CR}"/>` },
    { name: 'Sino', hue: '#f0a500', svg: '<path d="M24 6c-9 0-13 7-13 15 0 8-3 10-5 12h36c-2-2-5-4-5-12 0-8-4-15-13-15z" fill="currentColor"/><circle cx="24" cy="39" r="4" fill="currentColor"/><circle cx="24" cy="5" r="2.6" fill="currentColor"/>' },
    { name: 'Bandeira', hue: '#e0457b', svg: '<rect x="9" y="4" width="4.5" height="40" rx="2.2" fill="currentColor" opacity=".6"/><path d="M13 6h27l-7 9.5 7 9.5H13z" fill="currentColor"/>' },
    { name: 'Casa', hue: '#17a8a0', svg: `<path d="M24 4L2 24h7v18h30V24h7z" fill="currentColor"/><rect x="19.5" y="29" width="9" height="13" rx="1.5" fill="${CR}"/>` },
  ];

  const THEMES = [
    { id: 'natureza', name: 'Natureza', icons: natureza },
    { id: 'formas', name: 'Formas', icons: formas },
    { id: 'bichinhos', name: 'Bichinhos', icons: bichos },
    { id: 'frutas', name: 'Frutas', icons: frutas },
    { id: 'jogos', name: 'Jogos e objetos', icons: jogos },
  ];
  const ALL = [];
  const themeInfo = THEMES.map((t) => { const from = ALL.length; ALL.push(...t.icons); return Object.freeze({ id: t.id, name: t.name, from, count: t.icons.length }); });

  window.MemoryMatchSymbols = Object.freeze({ ALL: Object.freeze(ALL), THEMES: Object.freeze(themeInfo), COUNT: ALL.length });
})();
