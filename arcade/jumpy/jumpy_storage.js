/* ==========================================================================
   arcade/jumpy/jumpy_storage.js - persistência exclusiva do Pula-Pula (Jumpy)

   Script clássico (sem módulos ES). Carregue ANTES de jumpy.js.
   Expõe um único objeto global: JumpyStorage.

   Dados guardados:
     jumpy:muted -> '1' = som desligado, '0' = som ligado
                    (a mesma chave que o jogo já usava antes do registro compartilhado)
     jumpy:best  -> recorde: maior score já alcançado (inteiro >= 0)
     jumpy:run   -> partida EM ANDAMENTO (JSON, um snapshot único), usada para voltar de onde
                    parou depois de um F5. Só existe enquanto a partida estiver viva: o Game Over
                    apaga essa chave; o recorde fica na chave própria.

   Garantias:
     - nunca lança exceção (modo privado, cookies bloqueados, cota cheia...);
     - sem armazenamento persistente, o valor fica em memória na sessão;
     - dado ausente ou inválido vira o padrão seguro (som ligado, recorde 0);
     - o recorde salvo nunca diminui por engano;
     - partida salva ausente, inválida, corrompida, de outra versão ou velha demais vira
       "sem partida salva" (e é apagada), nunca uma partida quebrada.
   ========================================================================== */
(() => {
  'use strict';

  const KEYS = Object.freeze({ muted: 'jumpy:muted', best: 'jumpy:best', run: 'jumpy:run' });
  const DEFAULTS = Object.freeze({ muted: false, best: 0 });
  const memory = {};

  function readRaw(key) {
    try {
      const value = window.localStorage.getItem(key);
      if (value !== null) return value;
    } catch (error) { /* armazenamento indisponível: usa a memória */ }
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
  }

  function writeRaw(key, value) {
    const text = String(value);
    memory[key] = text;
    try { window.localStorage.setItem(key, text); return true; }
    catch (error) { return false; }     // o jogo segue normalmente, só sem persistência
  }

  function isMuted() {
    const raw = readRaw(KEYS.muted);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return DEFAULTS.muted;
  }

  function setMuted(value) {
    const muted = Boolean(value);
    writeRaw(KEYS.muted, muted ? '1' : '0');
    return muted;
  }

  function getBest() {
    const parsed = parseInt(readRaw(KEYS.best), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULTS.best;
    return Math.min(parsed, Number.MAX_SAFE_INTEGER);
  }

  // Grava apenas se for um número válido e maior que o recorde atual. Devolve o recorde vigente.
  function setBest(value) {
    const number = Math.floor(Number(value));
    if (!Number.isFinite(number) || number <= 0) return getBest();
    const best = Math.max(number, getBest());
    writeRaw(KEYS.best, best);
    return best;
  }

  /* ---------- Partida em andamento (snapshot) ---------- */

  const RUN_VERSION = 1;
  const RUN_MAX_AGE_MS = 2 * 60 * 60 * 1000;   // partida parada há mais que isso não volta
  const RUN_CLOCK_SKEW_MS = 60 * 1000;         // tolera relógio levemente adiantado
  const RUN_MAX_PLATFORMS = 120;
  const RUN_MAX_CLOUDS = 24;
  const RUN_MAX_MARKS = 400;
  const PLATFORM_TYPES = ['normal', 'moving', 'breakable', 'boost'];

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const inRange = (v, min, max) => isNum(v) && v >= min && v <= max;
  const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  const round = (v, digits = 3) => { const f = 10 ** digits; return Math.round(v * f) / f; };

  function cleanPlatform(q) {
    if (!q || typeof q !== 'object' || !PLATFORM_TYPES.includes(q.type)) return null;
    if (!inRange(q.x, -2000, 3000) || !inRange(q.y, -1e8, 1e4) || !inRange(q.w, 1, 1000) || !inRange(q.h, 1, 200)) return null;
    if (!inRange(q.dip, 0, 1) || !inRange(q.breakT, 0, 60)) return null;
    if (typeof q.breaking !== 'boolean' || typeof q.dead !== 'boolean') return null;
    const out = {
      type: q.type, x: round(q.x), y: round(q.y), w: round(q.w), h: round(q.h),
      dip: round(q.dip), breaking: q.breaking,
      breakT: round(q.breakT, 4),          // tempo já gasto do contador de quebra
      dead: q.dead,
    };
    if (q.type === 'moving') {
      if (!inRange(q.minX, -2000, 3000) || !inRange(q.maxX, -2000, 3000) || q.minX > q.maxX) return null;
      if (!inRange(q.speed, 0, 2000) || (q.dir !== 1 && q.dir !== -1)) return null;
      out.minX = round(q.minX); out.maxX = round(q.maxX); out.dir = q.dir; out.speed = round(q.speed);
    }
    return out;
  }

  // Valida e normaliza uma partida (usada ao gravar e ao ler). Devolve uma cópia limpa ou null.
  // Aqui só entram limites "de sanidade"; as regras do jogo são conferidas pelo próprio jogo ao restaurar.
  function cleanRun(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (raw.v !== RUN_VERSION || raw.status !== 'playing') return null;

    if (!isNum(raw.savedAt)) return null;
    const age = Date.now() - raw.savedAt;
    if (age > RUN_MAX_AGE_MS || age < -RUN_CLOCK_SKEW_MS) return null;

    if (!isInt(raw.score, 0, 1e6) || !isInt(raw.height, 0, 1e6) || !isInt(raw.markIdx, 0, 1e4)) return null;
    if (!isInt(raw.rows, 0, 1e7) || !isInt(raw.segmentLeft, 0, 100) || typeof raw.inSegment !== 'boolean') return null;
    if (!isInt(raw.lastBoostRow, -1000, 1e7) || !isInt(raw.lastBreakRow, -1000, 1e7) || !isInt(raw.segmentEndRow, -1000, 1e7)) return null;
    if (!inRange(raw.maxHeight, 0, 1e8) || !inRange(raw.time, 0, 1e9)) return null;
    if (!inRange(raw.camY, -1e8, 1e4) || !inRange(raw.lastCx, -1000, 2000)) return null;

    const l = raw.last;
    if (!l || typeof l !== 'object' || !PLATFORM_TYPES.includes(l.type)) return null;
    if (!inRange(l.cx, -1000, 2000) || !inRange(l.y, -1e8, 1e4) || !inRange(l.w, 1, 1000)) return null;

    const p = raw.player;
    if (!p || typeof p !== 'object') return null;
    if (!inRange(p.x, -1000, 2000) || !inRange(p.y, -1e8, 1e4) || !inRange(p.vx, -5000, 5000) || !inRange(p.vy, -5000, 5000)) return null;
    if ((p.facing !== 1 && p.facing !== -1) || !inRange(p.tilt, -6.3, 6.3) || !inRange(p.squash, 0, 1)) return null;

    if (!Array.isArray(raw.reached) || raw.reached.length > RUN_MAX_MARKS) return null;
    if (!raw.reached.every((k) => isInt(k, 0, 1e6))) return null;
    if (!Array.isArray(raw.flashes) || raw.flashes.length > RUN_MAX_MARKS) return null;
    if (!raw.flashes.every((f) => Array.isArray(f) && f.length === 2 && isInt(f[0], 0, 1e6) && inRange(f[1], 0, 60))) return null;

    if (!Array.isArray(raw.platforms) || raw.platforms.length < 1 || raw.platforms.length > RUN_MAX_PLATFORMS) return null;
    const platforms = [];
    for (const q of raw.platforms) {
      const clean = cleanPlatform(q);
      if (!clean) return null;
      platforms.push(clean);
    }

    // Nuvens são só decoração: se vierem estragadas, perde-se apenas elas.
    const clouds = [];
    if (Array.isArray(raw.clouds) && raw.clouds.length <= RUN_MAX_CLOUDS && raw.clouds.every((x) => inRange(x, -1000, 3000))) {
      for (const x of raw.clouds) clouds.push(round(x));
    }

    return {
      v: RUN_VERSION,
      status: 'playing',
      savedAt: Math.round(raw.savedAt),
      score: raw.score, height: raw.height, maxHeight: round(raw.maxHeight), time: round(raw.time),
      camY: round(raw.camY), lastCx: round(raw.lastCx), markIdx: raw.markIdx,
      reached: raw.reached.slice(),
      flashes: raw.flashes.map((f) => [f[0], round(f[1])]),
      rows: raw.rows, lastBoostRow: raw.lastBoostRow, lastBreakRow: raw.lastBreakRow,
      segmentEndRow: raw.segmentEndRow, segmentLeft: raw.segmentLeft, inSegment: raw.inSegment,
      last: { type: l.type, cx: round(l.cx), y: round(l.y), w: round(l.w) },
      player: {
        x: round(p.x), y: round(p.y), vx: round(p.vx), vy: round(p.vy),
        facing: p.facing, tilt: round(p.tilt, 4), squash: round(p.squash, 4),
      },
      platforms,
      clouds,
    };
  }

  // Grava a partida em andamento. O objeto recebido é só o "retrato" do jogo (sem v/status/savedAt,
  // que são colocados aqui). Tudo vai numa única chave, de uma só vez: o snapshot é sempre coerente.
  function saveRun(run) {
    const clean = cleanRun({ ...run, v: RUN_VERSION, status: 'playing', savedAt: Date.now() });
    if (!clean) return false;
    return writeRaw(KEYS.run, JSON.stringify(clean));
  }

  // Devolve a partida salva (já validada) ou null. Dado inválido é apagado.
  // Ler NÃO apaga uma partida válida: ela só some no Game Over (clearRun).
  function loadRun() {
    const raw = readRaw(KEYS.run);
    if (raw === null) return null;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (error) { parsed = null; }
    const clean = cleanRun(parsed);
    if (!clean) clearRun();
    return clean;
  }

  function clearRun() {
    delete memory[KEYS.run];
    try { window.localStorage.removeItem(KEYS.run); } catch (error) { /* nada a fazer */ }
  }

  window.JumpyStorage = Object.freeze({ KEYS, DEFAULTS, isMuted, setMuted, getBest, setBest, saveRun, loadRun, clearRun });
})();