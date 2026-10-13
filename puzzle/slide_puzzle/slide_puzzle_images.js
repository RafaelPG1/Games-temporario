/* ==========================================================================
   puzzle/slide_puzzle/slide_puzzle_images.js - imagens do Quebra-Cabeça Deslizante

   Script clássico (sem módulos ES). Carregue DEPOIS de slide_puzzle_storage.js e ANTES de slide_puzzle.js.
   Expõe um único objeto global: SlidePuzzleImages. Duas partes independentes:

   1) ARTE DAS FASES: 20 ilustrações vetoriais (SVG 400×400 desenhadas por código), uma por fase.
      artUrl(i) devolve a imagem como data URI (pronta para CSS url()); name(i) devolve o título da cena.
   2) IMAGEM DO USUÁRIO (modo Livre): loadFile (abre o arquivo), autoSquare (recorte automático centralizado,
      "cover") e createCropper (editor simples: arrastar, zoom por controle/roda/pinça e "Encaixar" tudo).
      A saída é sempre um JPEG quadrado (640 px) leve, que cabe no localStorage.
   ========================================================================== */
(() => {
  'use strict';

  /* ---------- 1) Arte das fases ---------- */
  const f = (n) => Math.round(n * 10) / 10;
  const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const LG = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
  const RGd = (id, stops) => `<radialGradient id="${id}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`;
  const svg = (defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice"><defs>${defs}</defs>${body}</svg>`;
  const stars = (seed, n, h, c = '#fff') => { const r = rng(seed); let s = ''; for (let i = 0; i < n; i++) s += `<circle cx="${f(r() * 400)}" cy="${f(r() * h)}" r="${f(0.6 + r() * 1.3)}" fill="${c}" opacity="${f(0.35 + r() * 0.6)}"/>`; return s; };
  const cloud = (x, y, s, c = '#fff', o = 1) => `<g transform="translate(${x} ${y}) scale(${s})" fill="${c}" opacity="${o}"><ellipse cx="0" cy="0" rx="46" ry="14"/><circle cx="-14" cy="-12" r="16"/><circle cx="14" cy="-18" r="21"/><circle cx="34" cy="-6" r="13"/></g>`;
  const pine = (x, y, s, c) => `<path d="M${x} ${f(y - 70 * s)}l${f(-16 * s)} ${f(34 * s)}h${f(8 * s)}l${f(-14 * s)} ${f(26 * s)}h${f(10 * s)}l${f(-16 * s)} ${f(30 * s)}h${f(56 * s)}l${f(-16 * s)} ${f(-30 * s)}h${f(10 * s)}l${f(-14 * s)} ${f(-26 * s)}h${f(8 * s)}z" fill="${c}"/><rect x="${f(x - 4 * s)}" y="${f(y + 19 * s)}" width="${f(8 * s)}" height="${f(10 * s)}" fill="${c}"/>`;
  const fish = (x, y, s, c, c2, flip = 1) => `<g transform="translate(${x} ${y}) scale(${s * flip} ${s})"><path d="M-30 0Q-6 -22 22 -4L40 -18V18L22 4Q-6 22 -30 0Z" fill="${c}"/><path d="M-6 -14Q4 -2 -6 14Q-14 0 -6 -14Z" fill="${c2}" opacity=".85"/><circle cx="-18" cy="-3" r="3.4" fill="#fff"/><circle cx="-18.8" cy="-3" r="1.7" fill="#14213d"/></g>`;
  const bubbles = (seed, n, x0, x1, y0, y1) => { const r = rng(seed); let s = ''; for (let i = 0; i < n; i++) s += `<circle cx="${f(x0 + r() * (x1 - x0))}" cy="${f(y0 + r() * (y1 - y0))}" r="${f(2 + r() * 6)}" fill="#fff" opacity=".18" stroke="#fff" stroke-opacity=".45"/>`; return s; };
  const waves = (y, n, amp, c, o = 1, step = 16) => { let d = `M0 ${y}`; for (let i = 0; i < n; i++) d += `q${step} ${-amp} ${step * 2} 0t${step * 2} 0`; return `<path d="${d}V400H0z" fill="${c}" opacity="${o}"/>`; };
  const flower = (x, y, r, petal, mid, stem, n = 6) => { let p = ''; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; p += `<circle cx="${f(x + Math.cos(a) * r * 0.9)}" cy="${f(y + Math.sin(a) * r * 0.9)}" r="${f(r * 0.62)}" fill="${petal}"/>`; } return `<path d="M${x} ${y}Q${x + 8} ${y + 60} ${x - 4} 400" stroke="${stem}" stroke-width="5" fill="none"/><path d="M${x + 2} ${y + 70}q22-18 32-4q-14 16-32 4z" fill="${stem}"/>${p}<circle cx="${x}" cy="${y}" r="${f(r * 0.5)}" fill="${mid}"/>`; };
  const balloon = (x, y, s, a, b) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 -58C-46 -58-52 -6-18 34L-8 44H8L18 34C52 -6 46 -58 0 -58Z" fill="${a}"/><path d="M0 -58C-20 -50-24 -6-8 44H8C24 -6 20 -50 0 -58Z" fill="${b}"/><path d="M-18 34L-10 62M18 34L10 62" stroke="#5b4636" stroke-width="1.6"/><rect x="-11" y="62" width="22" height="15" rx="3" fill="#8a5a3c"/></g>`;
  const house = (x, y, w, h, wall, roof) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${wall}"/><path d="M${x - 8} ${y}L${x + w / 2} ${y - h * 0.62}L${x + w + 8} ${y}Z" fill="${roof}"/><rect x="${x + w * 0.4}" y="${y + h * 0.4}" width="${w * 0.2}" height="${h * 0.6}" fill="#5a3e36"/><rect x="${x + w * 0.1}" y="${y + h * 0.2}" width="${w * 0.2}" height="${h * 0.22}" fill="#ffe28a"/><rect x="${x + w * 0.7}" y="${y + h * 0.2}" width="${w * 0.2}" height="${h * 0.22}" fill="#ffe28a"/>`;
  const tree = (x, y, s, c, t = '#6b4a2f') => `<rect x="${x - 4 * s}" y="${y - 10 * s}" width="${8 * s}" height="${36 * s}" fill="${t}"/><circle cx="${x}" cy="${y - 22 * s}" r="${26 * s}" fill="${c}"/><circle cx="${x - 16 * s}" cy="${y - 4 * s}" r="${18 * s}" fill="${c}"/><circle cx="${x + 16 * s}" cy="${y - 4 * s}" r="${18 * s}" fill="${c}"/>`;
  const palm = (x, y, s, lean) => `<path d="M${x} ${y}Q${x + lean * 0.5} ${y - 70 * s} ${x + lean} ${y - 120 * s}" stroke="#7a5230" stroke-width="${7 * s}" fill="none" stroke-linecap="round"/>` + [-70, -35, 0, 35, 70].map((a) => `<path d="M${x + lean} ${y - 120 * s}q${f(30 * s * Math.cos((a - 90) * Math.PI / 180) + 20 * s)} ${f(-26 * s)} ${f(66 * s * Math.sin(a * Math.PI / 180) + 4)} ${f(14 * s + Math.abs(a) * 0.5 * s)}q${f(-30 * s * Math.sin(a * Math.PI / 180))} ${f(-10 * s)} ${f(-66 * s * Math.sin(a * Math.PI / 180) - 4)} ${f(-14 * s - Math.abs(a) * 0.5 * s)}z" fill="#2f9e5b"/>`).join('');

  const ART = [
    { name: 'Pôr do sol no mar', draw: () => {
      let st = ''; for (let i = 0; i < 9; i++) { const w = 120 - i * 10; st += `<rect x="${200 - w / 2}" y="${240 + i * 15}" width="${w}" height="5" rx="2.5" fill="#ffd27a" opacity="${f(0.9 - i * 0.09)}"/>`; }
      return svg(LG('s', [[0, '#241a5e'], [.45, '#8a2f8f'], [.78, '#ff6f61'], [1, '#ffd27a']]) + LG('w', [[0, '#ff9a62'], [1, '#2c1456']]) + RGd('g', [[0, '#fff6c8'], [1, '#ffc857']]),
        `<rect width="400" height="400" fill="url(#s)"/>${stars(1, 28, 120)}<circle cx="200" cy="238" r="74" fill="url(#g)"/>${cloud(80, 120, 1.1, '#ff9aa2', .55)}${cloud(320, 160, .9, '#ffb28a', .6)}<rect y="238" width="400" height="162" fill="url(#w)"/>${st}<g transform="translate(78 218)"><path d="M0 26h54l-9 14H9z" fill="#1d1040"/><path d="M26 0v26" stroke="#1d1040" stroke-width="2.4"/><path d="M28 3l22 20H28z" fill="#ffe3b0"/><path d="M24 7L6 23h18z" fill="#ffc78a"/></g>`);
    } },
    { name: 'Lago entre montanhas', draw: () => {
      const M = `<path d="M0 250L70 150L110 200L170 110L250 230L300 160L400 250Z" fill="#6f8fc6"/><path d="M170 110L145 148l18-8 14 14 14-18 12 16z" fill="#fff"/><path d="M70 150L52 178l14-6 12 10 10-14z" fill="#fff"/><path d="M0 250L90 190L160 250L230 180L320 250Z" fill="#4b6aa3"/><path d="M0 250V232Q60 210 120 236T250 226T400 240V250Z" fill="#2f6f58"/>`;
      return svg(LG('s', [[0, '#8ec5ff'], [1, '#ffe9c8']]) + LG('l', [[0, '#5a8fc8'], [1, '#1f4778']]) + '<clipPath id="c"><rect y="250" width="400" height="150"/></clipPath>',
        `<rect width="400" height="400" fill="url(#s)"/><circle cx="318" cy="76" r="26" fill="#fff6d8"/>${cloud(90, 70, 1, '#fff', .9)}${M}<rect y="250" width="400" height="150" fill="url(#l)"/><g clip-path="url(#c)" opacity=".5" transform="translate(0 500) scale(1 -1)">${M}</g><g stroke="#fff" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"><path d="M40 285h60M220 300h90M120 330h70M290 350h60M60 372h50"/></g>`);
    } },
    { name: 'Pinheiros ao luar', draw: () => {
      const r = rng(3); let back = '', front = '';
      for (let i = 0; i < 9; i++) back += pine(18 + i * 46 + r() * 10, 300 + r() * 14, 0.8 + r() * 0.2, '#16495a');
      for (let i = 0; i < 7; i++) front += pine(24 + i * 62 + r() * 14, 392, 1.5 + r() * 0.4, '#0b2430');
      return svg(LG('s', [[0, '#081a3a'], [1, '#2c5a82']]) + RGd('m', [[0, '#fffbe6'], [.6, '#fff1b8'], [1, '#fff1b8', 0]]),
        `<rect width="400" height="400" fill="url(#s)"/>${stars(3, 60, 220)}<circle cx="292" cy="98" r="90" fill="url(#m)" opacity=".5"/><circle cx="292" cy="98" r="46" fill="#fff6cc"/><circle cx="278" cy="88" r="9" fill="#efe0a0"/><circle cx="306" cy="112" r="6" fill="#efe0a0"/><circle cx="304" cy="82" r="4" fill="#efe0a0"/><path d="M0 300Q100 250 200 290T400 270V400H0z" fill="#10394a"/>${back}<rect y="318" width="400" height="82" fill="#0e3140"/>${front}`);
    } },
    { name: 'Deserto ao entardecer', draw: () => svg(LG('s', [[0, '#ff7e5f'], [.6, '#feb47b'], [1, '#ffe8a3']]),
      `<rect width="400" height="400" fill="url(#s)"/><circle cx="130" cy="190" r="62" fill="#fff0b3" opacity=".9"/><path d="M0 230L50 200L96 214L150 186L200 230Z" fill="#c9694a" opacity=".7"/><path d="M0 250Q110 190 220 250T400 230V400H0z" fill="#e9a257"/><path d="M0 300Q130 240 260 310T400 290V400H0z" fill="#d98a43"/><path d="M0 360Q150 310 300 370T400 350V400H0z" fill="#b8692f"/><g fill="#3f8f5a"><rect x="296" y="236" width="20" height="112" rx="10"/><rect x="264" y="272" width="34" height="14" rx="7"/><rect x="264" y="250" width="14" height="36" rx="7"/><rect x="314" y="262" width="34" height="14" rx="7"/><rect x="334" y="240" width="14" height="36" rx="7"/></g><g fill="#3a2a2a" opacity=".7"><path d="M60 100q8-8 16 0q8-8 16 0l-16 6z"/><path d="M110 70q6-6 12 0q6-6 12 0l-12 5z"/></g>`) },
    { name: 'Cidade à noite', draw: () => {
      const r = rng(5); let back = '', front = '', x = -10;
      while (x < 410) { const w = 34 + r() * 30, h = 90 + r() * 120; back += `<rect x="${f(x)}" y="${f(330 - h)}" width="${f(w)}" height="${f(h + 70)}" fill="#3a2870"/>`; x += w - 4; }
      x = -6;
      while (x < 410) { const w = 40 + r() * 34, h = 60 + r() * 150; front += `<rect x="${f(x)}" y="${f(400 - h)}" width="${f(w)}" height="${f(h)}" fill="#1b1240"/>`;
        for (let wy = 400 - h + 10; wy < 392; wy += 16) for (let wx = x + 6; wx < x + w - 8; wx += 12) if (r() > 0.45) front += `<rect x="${f(wx)}" y="${f(wy)}" width="6" height="8" fill="${r() > 0.2 ? '#ffd86b' : '#8fd3ff'}" opacity=".9"/>`; x += w + 2; }
      return svg(LG('s', [[0, '#150b3a'], [.7, '#5b2a86'], [1, '#e0608e']]), `<rect width="400" height="400" fill="url(#s)"/>${stars(5, 50, 200)}<circle cx="86" cy="86" r="32" fill="#fff3d6"/><circle cx="98" cy="78" r="30" fill="#2a1860"/>${back}${front}`);
    } },
    { name: 'Farol na costa', draw: () => svg(LG('s', [[0, '#3b5998'], [.6, '#f09a7a'], [1, '#ffd9a0']]) + LG('w', [[0, '#3b6ea8'], [1, '#14315c']]),
      `<rect width="400" height="400" fill="url(#s)"/>${cloud(300, 90, 1.2, '#ffd0b5', .7)}${cloud(80, 130, .9, '#ffd0b5', .6)}<rect y="250" width="400" height="150" fill="url(#w)"/><path d="M200 120L400 60V170Z" fill="#fff6c0" opacity=".28"/><path d="M200 120L0 70V170Z" fill="#fff6c0" opacity=".16"/><path d="M178 330L186 150H214L222 330Z" fill="#f4f4f4"/><path d="M182 250L184 205H216L218 250Z" fill="#d6403f"/><path d="M186 170L187 150H213L214 170Z" fill="#d6403f"/><path d="M180 150H220L210 138H190Z" fill="#2c2c3a"/><rect x="190" y="118" width="20" height="20" rx="3" fill="#ffe27a"/><path d="M186 118L200 100L214 118Z" fill="#d6403f"/><path d="M120 400Q130 320 190 326T290 336Q300 380 320 400Z" fill="#4a4a5a"/><path d="M140 400Q160 350 200 350T270 360Q280 380 290 400Z" fill="#6a6a7c"/>${waves(352, 14, 7, '#7fb3e0', .55)}${waves(380, 14, 7, '#ffffff', .35, 14)}<g fill="#fff"><path d="M70 60q8-8 16 0q8-8 16 0l-16 5z"/><path d="M110 90q6-6 12 0q6-6 12 0l-12 4z"/></g>`) },
    { name: 'Aquário colorido', draw: () => {
      const r = rng(7); let sea = '';
      for (let i = 0; i < 8; i++) sea += `<path d="M${30 + i * 52} 400q-18-40 0-80t0-70" stroke="${i % 2 ? '#2fa36b' : '#1f8a5a'}" stroke-width="${9 + (i % 3) * 2}" fill="none" stroke-linecap="round"/>`;
      return svg(LG('s', [[0, '#26c6da'], [1, '#05446e']]), `<rect width="400" height="400" fill="url(#s)"/><path d="M60 0L130 0L40 400H-60Z M220 0L270 0L200 400H120Z M330 0L370 0L330 400H270Z" fill="#fff" opacity=".07"/>${bubbles(7, 14, 20, 380, 20, 340)}${fish(110, 120, 1.3, '#ff9f43', '#ffd8a8')}${fish(290, 90, 1, '#ff6b81', '#ffc2cc', -1)}${fish(250, 210, 1.5, '#ffd32a', '#fff2a8')}${fish(100, 250, 1, '#7bed9f', '#d5ffe3', -1)}${fish(330, 290, .9, '#a29bfe', '#d9d6ff')}<path d="M0 360Q100 336 200 360T400 350V400H0z" fill="#e6c98f"/>${sea}<circle cx="60" cy="378" r="10" fill="#f78fb3"/><path d="M300 382l8-14 8 14z" fill="#ffb8b8"/><circle cx="${f(200 + r() * 10)}" cy="384" r="8" fill="#f5cd79"/>`);
    } },
    { name: 'Planetas e estrelas', draw: () => svg(RGd('b', [[0, '#2a1a5e'], [1, '#05030f']]) + RGd('n1', [[0, '#c04cff', .5], [1, '#c04cff', 0]]) + RGd('n2', [[0, '#27c4ff', .4], [1, '#27c4ff', 0]]) + RGd('p', [[0, '#ffb86b'], [1, '#c2492f']]) + RGd('q', [[0, '#8ff0d0'], [1, '#2a7fa8']]) + '<clipPath id="pc"><circle cx="205" cy="200" r="78"/></clipPath>',
      `<rect width="400" height="400" fill="url(#b)"/><circle cx="90" cy="90" r="120" fill="url(#n1)"/><circle cx="330" cy="320" r="130" fill="url(#n2)"/>${stars(8, 90, 400)}<g transform="rotate(-18 205 200)"><ellipse cx="205" cy="200" rx="140" ry="30" fill="none" stroke="#f6d9a8" stroke-width="12" opacity=".5"/><circle cx="205" cy="200" r="78" fill="url(#p)"/><g clip-path="url(#pc)"><rect x="120" y="170" width="170" height="10" fill="#e8744f" opacity=".7"/><rect x="120" y="196" width="170" height="14" fill="#a8341f" opacity=".5"/><rect x="120" y="226" width="170" height="8" fill="#ffd29a" opacity=".6"/></g><path d="M65 200a140 30 0 0 0 280 0" fill="none" stroke="#f6d9a8" stroke-width="12" opacity=".9"/></g><circle cx="78" cy="318" r="38" fill="url(#q)"/><circle cx="66" cy="308" r="8" fill="#fff" opacity=".25"/><circle cx="330" cy="86" r="18" fill="#d6d6e8"/><circle cx="324" cy="80" r="4" fill="#a9a9c4"/>`) },
    { name: 'Balões no céu', draw: () => svg(LG('s', [[0, '#5aa9f6'], [1, '#ffeaa7']]) + LG('h', [[0, '#7bd17b'], [1, '#3a9a5b']]),
      `<rect width="400" height="400" fill="url(#s)"/>${cloud(70, 90, 1.2)}${cloud(330, 170, 1)}${cloud(150, 300, 1.4, '#fff', .9)}${balloon(110, 150, 1.1, '#ff5d73', '#ff9aa8')}${balloon(250, 110, .8, '#ffc93c', '#ffe58a')}${balloon(300, 240, 1, '#6c5ce7', '#a29bfe')}${balloon(180, 270, .65, '#00b894', '#6ee7c2')}<path d="M0 360Q100 320 200 350T400 340V400H0z" fill="url(#h)"/>`) },
    { name: 'Aldeia no vale', draw: () => svg(LG('s', [[0, '#9fd8ff'], [1, '#fff3d1']]) + LG('h', [[0, '#8fd16f'], [1, '#4a9a52']]),
      `<rect width="400" height="400" fill="url(#s)"/><circle cx="330" cy="70" r="30" fill="#ffe27a"/>${cloud(90, 80, 1)}<path d="M0 230Q100 160 220 220T400 190V400H0z" fill="#79c36a"/><path d="M0 280Q120 230 260 290T400 270V400H0z" fill="url(#h)"/>${house(40, 250, 60, 46, '#f6e3c4', '#d65a4a')}${house(150, 232, 50, 40, '#fbd6a8', '#3d7ea6')}${house(260, 258, 68, 52, '#f1efe6', '#8f4fb0')}${tree(130, 300, 1, '#2f8f4a')}${tree(236, 290, .8, '#3aa95b')}${tree(360, 300, 1.1, '#2a7d44')}<path d="M170 400Q190 340 230 320T300 300" stroke="#e8d3a1" stroke-width="22" fill="none" stroke-linecap="round"/>`) },
    { name: 'Jardim de flores', draw: () => svg(LG('s', [[0, '#fff4ea'], [1, '#f6c9dc']]),
      `<rect width="400" height="400" fill="url(#s)"/><circle cx="330" cy="60" r="26" fill="#ffe9a8"/>` + [[60, 210, 30, '#ff6b81', '#ffe27a'], [150, 150, 26, '#ffffff', '#ffb52e'], [240, 230, 34, '#ffa94d', '#8a3b12'], [330, 170, 28, '#c77dff', '#ffe27a'], [110, 300, 24, '#ffd43b', '#c92a2a'], [210, 320, 28, '#ff8fab', '#fff3b0'], [310, 330, 24, '#74c0fc', '#ffe27a'], [30, 340, 20, '#ff6b81', '#ffe27a']].map(([x, y, r, p, m], i) => flower(x, y, r, p, m, i % 2 ? '#3d9a5b' : '#2f8a4d', 5 + (i % 3))).join('') + `<path d="M0 400V376Q100 354 200 378T400 366V400Z" fill="#4aa95e"/>`) },
    { name: 'Aurora boreal', draw: () => {
      let fg = ''; const r = rng(12); for (let i = 0; i < 8; i++) fg += pine(20 + i * 52 + r() * 10, 396, 1.2 + r() * 0.5, '#07131f');
      return svg(LG('s', [[0, '#050b24'], [1, '#12315a']]) + LG('a2', [[0, '#8c5cff', 0], [1, '#46f0d0']]) + '<filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="9"/></filter>',
        `<rect width="400" height="400" fill="url(#s)"/>${stars(12, 70, 260)}<g filter="url(#b)"><path d="M-20 200Q80 60 180 140T420 70V200Q300 240 200 190T-20 280Z" fill="url(#a2)" opacity=".75"/><path d="M-20 260Q100 130 220 200T420 150V240Q300 290 180 240T-20 330Z" fill="#3dffb0" opacity=".5"/></g><path d="M0 330L80 250L130 300L210 210L300 310L350 270L400 320V400H0z" fill="#1b3558"/><path d="M210 210l-24 30 14-6 10 12 10-14 12 10z" fill="#e6f2ff"/><path d="M80 250l-18 26 12-4 8 8 8-10z" fill="#e6f2ff"/><path d="M0 360Q120 330 240 362T400 350V400H0z" fill="#dce9f7"/>${fg}`);
    } },
    { name: 'Ilha tropical', draw: () => svg(LG('s', [[0, '#3fa7ff'], [1, '#d3f6ff']]) + LG('w', [[0, '#27c7c7'], [1, '#0f6a9a']]),
      `<rect width="400" height="400" fill="url(#s)"/><circle cx="310" cy="76" r="34" fill="#fff2a0"/>${cloud(90, 90, 1.2)}${cloud(260, 150, .8)}<rect y="230" width="400" height="170" fill="url(#w)"/>${waves(262, 12, 6, '#7fe6e0', .45)}${waves(310, 12, 6, '#ffffff', .22)}<ellipse cx="200" cy="296" rx="150" ry="36" fill="#f2d8a0"/><ellipse cx="200" cy="288" rx="110" ry="24" fill="#f7e5b8"/>${palm(160, 288, 1, -40)}${palm(250, 290, .85, 36)}<path d="M20 372l60-8l-8 14H32z" fill="#b5651d"/><path d="M50 364V330l30 28z" fill="#fff"/>`) },
    { name: 'Castelo no alto', draw: () => {
      const tower = (x, w, h, roof) => { let cr = ''; for (let i = 0; i < 4; i++) cr += `<rect x="${x + i * (w / 4) + 1}" y="${300 - h - 8}" width="${w / 4 - 3}" height="9" fill="#cdbfd9"/>`; return `<rect x="${x}" y="${300 - h}" width="${w}" height="${h}" fill="#e3d9ec"/>${cr}<path d="M${x - 6} ${300 - h - 8}L${x + w / 2} ${300 - h - 8 - w * 1.1}L${x + w + 6} ${300 - h - 8}Z" fill="${roof}"/><rect x="${x + w / 2 - 4}" y="${300 - h + 16}" width="8" height="16" rx="4" fill="#5a4a8a"/>`; };
      return svg(LG('s', [[0, '#6dd5ed'], [1, '#fdf1c9']]) + LG('h', [[0, '#7fd16b'], [1, '#3f9a4f']]),
        `<rect width="400" height="400" fill="url(#s)"/>${cloud(80, 70, 1.1)}${cloud(320, 110, 1)}<path d="M0 300Q100 250 200 280T400 260V400H0z" fill="url(#h)"/>${tower(70, 52, 120, '#d64550')}${tower(278, 52, 130, '#d64550')}<rect x="130" y="190" width="140" height="110" fill="#d4c8e2"/>${tower(172, 56, 190, '#3d63c9')}<path d="M130 190h140v-8h-10v-8h-10v8h-14v-8h-10v8h-14v-8h-10v8h-14v-8h-10v8h-14v-8h-10v8h-14v-8h-10v8h-10z" fill="#d4c8e2"/><path d="M178 300V262a22 22 0 0 1 44 0V300Z" fill="#4a3a6a"/><path d="M200 76V44l26 8-26 8" fill="#ffc93c" transform="translate(0 4)"/><path d="M96 134V100l22 8-22 8" fill="#ffc93c" transform="translate(-2 2)"/><path d="M304 122V90l22 8-22 8" fill="#ffc93c"/><path d="M185 400Q200 340 210 300" stroke="#e8d3a1" stroke-width="30" fill="none"/><path d="M0 360Q120 340 220 372T400 356V400H0z" fill="#46a455"/>`);
    } },
    { name: 'Moinho e tulipas', draw: () => {
      const rows = ['#e63946', '#ffb703', '#ff7aa8', '#b565d9', '#ff8c42', '#e63946']; let t = '';
      rows.forEach((c, i) => { const y = 270 + i * 24, s = 0.7 + i * 0.16, r = rng(20 + i); for (let x = -10; x < 420; x += 22 * s) t += `<path d="M${f(x)} ${y}q${f(-6 * s)} ${f(-16 * s)} 0 ${f(-22 * s)}q${f(6 * s)} ${f(6 * s)} ${f(6 * s)} ${f(-4 * s)}q0 ${f(10 * s)} ${f(6 * s)} ${f(4 * s)}q${f(6 * s)} ${f(10 * s)} 0 ${f(22 * s)}z" fill="${c}"/><rect x="${f(x)}" y="${y}" width="${f(2 * s)}" height="${f((24 - r() * 4) * s)}" fill="#2f8a4d"/>`; });
      let bl = ''; [0, 90, 180, 270].forEach((a) => { bl += `<g transform="rotate(${a + 20} 200 150)"><rect x="196" y="40" width="8" height="110" fill="#6b4a2f"/><rect x="204" y="48" width="30" height="64" fill="#f5efe1" stroke="#6b4a2f" stroke-width="3"/></g>`; });
      return svg(LG('s', [[0, '#7cc6ff'], [1, '#ffeec6']]) + LG('g', [[0, '#9fdc7a'], [1, '#4f9f55']]),
        `<rect width="400" height="400" fill="url(#s)"/>${cloud(80, 90, 1.2)}${cloud(330, 60, .9)}<rect y="250" width="400" height="150" fill="url(#g)"/><path d="M168 262L182 160H218L232 262Z" fill="#d9825b"/><path d="M168 262L182 160H200V262Z" fill="#b8654a"/><path d="M178 160L200 122L222 160Z" fill="#7a4a35"/>${bl}<circle cx="200" cy="150" r="9" fill="#5a3e2a"/>${t}`);
    } },
    { name: 'Foguete rumo à Lua', draw: () => svg(LG('s', [[0, '#0f0c29'], [.55, '#302b63'], [1, '#24243e']]) + LG('f', [[0, '#fff3a8'], [.5, '#ff9f1c'], [1, '#ff4d2e', 0]]) + RGd('m', [[0, '#f4f4fb'], [1, '#aeb0c9']]),
      `<rect width="400" height="400" fill="url(#s)"/>${stars(16, 80, 330)}<circle cx="90" cy="400" r="130" fill="url(#m)"/><circle cx="60" cy="338" r="14" fill="#8f91ad" opacity=".5"/><circle cx="130" cy="318" r="9" fill="#8f91ad" opacity=".5"/><g transform="rotate(22 220 190)"><path d="M220 290Q190 340 220 390Q250 340 220 290Z" fill="url(#f)"/><path d="M190 270L170 306L196 288Z M250 270L270 306L244 288Z" fill="#d64550"/><path d="M190 280V150Q220 70 250 150V280Z" fill="#f5f7ff"/><path d="M220 80Q245 120 250 150H220Z" fill="#dfe3f7"/><path d="M193 150Q220 70 247 150Z" fill="#d64550"/><circle cx="220" cy="196" r="20" fill="#3d63c9" stroke="#c9d3ff" stroke-width="5"/><circle cx="214" cy="190" r="6" fill="#fff" opacity=".5"/><rect x="190" y="248" width="60" height="14" fill="#d64550"/></g><g fill="#fff" opacity=".85"><circle cx="300" cy="360" r="26"/><circle cx="330" cy="340" r="20"/><circle cx="270" cy="378" r="18"/></g>`) },
    { name: 'Floresta de outono', draw: () => {
      const cols = ['#e8731a', '#d1432b', '#f2b134', '#b5651d', '#c9a227']; const r = rng(17); let back = '', front = '', leaves = '';
      for (let i = 0; i < 8; i++) back += tree(20 + i * 52, 290, 1.1, cols[i % 5], '#7a5535');
      for (let i = 0; i < 5; i++) front += tree(40 + i * 85 + r() * 14, 372, 1.9 + r() * 0.4, cols[(i + 2) % 5], '#5a3b22');
      for (let i = 0; i < 40; i++) leaves += `<ellipse cx="${f(r() * 400)}" cy="${f(330 + r() * 70)}" rx="6" ry="3" fill="${cols[i % 5]}" transform="rotate(${f(r() * 180)} ${f(r() * 400)} 360)" opacity=".9"/>`;
      return svg(LG('s', [[0, '#ffd89b'], [1, '#fbe9c9']]) + RGd('g', [[0, '#fff6c8', .9], [1, '#fff6c8', 0]]), `<rect width="400" height="400" fill="url(#s)"/><circle cx="300" cy="90" r="120" fill="url(#g)"/><path d="M0 290Q100 260 200 290T400 280V400H0z" fill="#9a6a3c"/>${back}<rect y="300" width="400" height="100" fill="#8a5a30"/><path d="M150 400Q190 340 260 310" stroke="#d9a866" stroke-width="40" fill="none" stroke-linecap="round" opacity=".75"/>${front}${leaves}`);
    } },
    { name: 'Recife de coral', draw: () => {
      const coral = (x, y, c, s) => `<g transform="translate(${x} ${y}) scale(${s})" stroke="${c}" stroke-width="9" stroke-linecap="round" fill="none"><path d="M0 0V-50M0 -20L-20 -46M0 -30L22 -58M-20 -46V-62M22 -58V-76"/></g>`;
      return svg(LG('s', [[0, '#1d7fc4'], [.6, '#0d3a7a'], [1, '#2a1a5a']]),
        `<rect width="400" height="400" fill="url(#s)"/><path d="M80 0L150 0L50 400H-40Z M250 0L310 0L230 400H150Z" fill="#9fe8ff" opacity=".08"/>${bubbles(18, 12, 10, 390, 20, 330)}${fish(110, 110, 1.2, '#ffb703', '#fff1a8')}${fish(290, 170, 1.4, '#ff6b9a', '#ffc7da', -1)}${fish(180, 230, .9, '#7be0ff', '#d6f6ff')}<g transform="translate(300 90) scale(.8)"><path d="M-28 0Q0-30 40 0Q0 30-28 0Z" fill="#ffd166"/><path d="M40 0L66-16V16Z" fill="#ffd166"/><circle cx="-12" cy="-3" r="3" fill="#14213d"/></g><path d="M0 350Q100 320 200 352T400 338V400H0z" fill="#c9a36a"/>` + coral(40, 360, '#ff6f91', 1.2) + coral(110, 372, '#ffa94d', 1) + coral(300, 366, '#f06595', 1.3) + coral(360, 380, '#ffd43b', .9) + `<g fill="#ff8c42"><path d="M200 362l6-14 6 14 14 2-11 9 3 14-12-7-12 7 3-14-11-9z"/></g><g fill="#9b5de5"><ellipse cx="240" cy="372" rx="26" ry="14"/><ellipse cx="240" cy="364" rx="20" ry="9" fill="#c39bff"/></g><g fill="#2fbf71"><path d="M150 400q-14-30 0-60 14 30 0 60z"/><path d="M168 400q-10-24 2-46 12 22-2 46z"/></g>`);
    } },
    { name: 'Mandala radiante', draw: () => {
      let m = ''; const rings = [[16, 168, '#ff6b81', 26, 8], [14, 138, '#ffa94d', 24, 7], [12, 110, '#ffd43b', 22, 6], [10, 84, '#51cf66', 20, 5], [8, 58, '#339af0', 18, 4]];
      rings.forEach(([n, dist, c, rx, ry], k) => { for (let i = 0; i < n; i++) { const a = (360 / n) * i + (k % 2) * (180 / n); m += `<g transform="rotate(${f(a)} 200 200)"><ellipse cx="200" cy="${200 - dist}" rx="${ry * 2}" ry="${rx}" fill="${c}" opacity=".92"/><ellipse cx="200" cy="${200 - dist}" rx="${ry}" ry="${rx * 0.6}" fill="#fff" opacity=".35"/></g>`; } });
      let dots = ''; for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2; dots += `<circle cx="${f(200 + Math.cos(a) * 190)}" cy="${f(200 + Math.sin(a) * 190)}" r="${i % 2 ? 4 : 7}" fill="#f5f6ff" opacity=".8"/>`; }
      return svg(RGd('b', [[0, '#2b2d6e'], [1, '#0a0c24']]) + RGd('c', [[0, '#fff6c8'], [1, '#ff9f1c']]), `<rect width="400" height="400" fill="url(#b)"/>${dots}${m}<circle cx="200" cy="200" r="30" fill="#9c36b5"/><circle cx="200" cy="200" r="20" fill="url(#c)"/><circle cx="200" cy="200" r="7" fill="#fff"/>`);
    } },
    { name: 'Vitral de cores', draw: () => {
      const pal = ['#e63946', '#f4a261', '#ffd166', '#2a9d8f', '#3a86ff', '#8338ec', '#ff5d8f', '#06d6a0']; const r = rng(23); let g = ''; const N = 8, s = 400 / N;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = i * s, y = j * s, h = s / 2, c = [r(), r(), r(), r(), r()].map((v) => pal[Math.floor(v * pal.length)]);
        g += `<path d="M${x} ${y}H${x + s}L${x + h} ${y + h}Z" fill="${c[0]}"/><path d="M${x + s} ${y}V${y + s}L${x + h} ${y + h}Z" fill="${c[1]}"/><path d="M${x + s} ${y + s}H${x}L${x + h} ${y + h}Z" fill="${c[2]}"/><path d="M${x} ${y + s}V${y}L${x + h} ${y + h}Z" fill="${c[3]}"/><circle cx="${x + h}" cy="${y + h}" r="${f(s * 0.14)}" fill="${c[4]}"/>`; }
      return svg('', `<rect width="400" height="400" fill="#1b1230"/>${g}<g stroke="#1b1230" stroke-width="3" fill="none"><path d="M0 0H400V400H0z"/>${Array.from({ length: N }, (_, i) => `<path d="M${i * s} 0V400M0 ${i * s}H400"/>`).join('')}</g>`);
    } },
  ];

  const cache = [];
  const name = (i) => (ART[i] ? ART[i].name : '');
  const artUrl = (i) => {
    if (!ART[i]) return '';
    if (!cache[i]) cache[i] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(ART[i].draw());
    return cache[i];
  };

  /* ---------- 2) Imagem do usuário ---------- */
  const OUT = 640, MAX_BYTES = 25 * 1024 * 1024, MAX_ZOOM = 4;

  // Abre um arquivo de imagem. Rejeita com Error de mensagem curta (mostrada ao jogador).
  function loadSrc(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => (img.naturalWidth > 0 && img.naturalHeight > 0 ? resolve(img) : reject(new Error('Imagem inválida')));
      img.onerror = () => reject(new Error('Não foi possível abrir essa imagem'));
      img.src = src;
    });
  }
  function loadFile(file) {
    if (!file || !/^image\//.test(file.type)) return Promise.reject(new Error('Escolha um arquivo de imagem'));
    if (file.size > MAX_BYTES) return Promise.reject(new Error('Imagem grande demais (máx. 25 MB)'));
    const url = URL.createObjectURL(file);
    return loadSrc(url).then((img) => { URL.revokeObjectURL(url); return img; }, (e) => { URL.revokeObjectURL(url); throw e; });
  }
  const ratio = (img) => img.naturalWidth / img.naturalHeight;

  // Estado de recorte: { img, w, h, zoom, cx, cy } (cx/cy = centro do recorte em pixels da imagem; lado = min(w,h)/zoom)
  const side = (st) => Math.min(st.w, st.h) / st.zoom;
  function clampCenter(st) {
    const s = side(st);
    st.cx = s >= st.w ? st.w / 2 : Math.max(s / 2, Math.min(st.w - s / 2, st.cx));
    st.cy = s >= st.h ? st.h / 2 : Math.max(s / 2, Math.min(st.h - s / 2, st.cy));
  }
  // Pinta o recorte num contexto 2D de out × out. Se sobrar espaço (zoom < 1), o fundo é a própria imagem desfocada.
  function paint(st, c2, out) {
    const s = side(st), k = out / s, m = Math.min(st.w, st.h);
    c2.fillStyle = '#10122a'; c2.fillRect(0, 0, out, out);
    if (s > m + 0.5) {
      const kc = (out / m) * 1.2, dw = st.w * kc, dh = st.h * kc;
      c2.save(); if ('filter' in c2) c2.filter = `blur(${Math.round(out / 22)}px)`;
      c2.drawImage(st.img, (out - dw) / 2, (out - dh) / 2, dw, dh); c2.restore();
    }
    c2.drawImage(st.img, -(st.cx - s / 2) * k, -(st.cy - s / 2) * k, st.w * k, st.h * k);
  }
  function toJpeg(st, size = OUT, q = 0.86) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    paint(st, c.getContext('2d'), size);
    return c.toDataURL('image/jpeg', q);
  }
  const stateOf = (img) => ({ img, w: img.naturalWidth, h: img.naturalHeight, zoom: 1, cx: img.naturalWidth / 2, cy: img.naturalHeight / 2 });

  // Recorte automático: preenche o quadrado ("cover"), centralizado.
  const autoSquare = (img, size = OUT) => toJpeg(stateOf(img), size);

  /* Editor: arrastar move, controle/roda/pinça dá zoom. zoom 1 = preenche o quadrado; abaixo disso a imagem inteira
     "encaixa" (até zoomMin) com fundo desfocado. onZoom(z) avisa a tela para sincronizar o controle deslizante. */
  function createCropper(canvas, onZoom = () => {}) {
    const ctx = canvas.getContext('2d'), pts = new Map();
    let st = null, min = 1, lastDist = 0;
    const draw = () => { if (st && ctx) paint(st, ctx, canvas.width); };
    function setZoom(z) {
      if (!st) return;
      st.zoom = Math.max(min, Math.min(MAX_ZOOM, z)); clampCenter(st); draw(); onZoom(st.zoom);
    }
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    canvas.addEventListener('pointerdown', (e) => {
      if (!st) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* sem captura: segue */ }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) lastDist = dist();
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId); if (!p || !st) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 1) {
        const k = side(st) / (canvas.getBoundingClientRect().width || 1);
        st.cx -= dx * k; st.cy -= dy * k; clampCenter(st); draw();
      } else if (pts.size === 2) { const d = dist(); if (lastDist) setZoom(st.zoom * (d / lastDist)); lastDist = d; }
    });
    const up = (e) => { pts.delete(e.pointerId); lastDist = 0; };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => { if (!st) return; e.preventDefault(); setZoom(st.zoom * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    return {
      // Carrega a imagem já com o recorte automático e devolve os limites do zoom para o controle deslizante.
      load(img) {
        st = stateOf(img); pts.clear(); min = Math.min(1, Math.min(st.w, st.h) / Math.max(st.w, st.h));
        draw(); onZoom(1); return { min, max: MAX_ZOOM };
      },
      setZoom, fit: () => setZoom(min), reset() { if (st) { st.cx = st.w / 2; st.cy = st.h / 2; setZoom(1); } },
      get min() { return min; },
      export: () => (st ? toJpeg(st) : null),
    };
  }

  window.SlidePuzzleImages = Object.freeze({ COUNT: ART.length, name, artUrl, loadFile, loadSrc, ratio, autoSquare, createCropper });
})();