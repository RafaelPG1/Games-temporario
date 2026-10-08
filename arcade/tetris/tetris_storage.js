/* ==========================================================================
   arcade/tetris/tetris_storage.js - persistência exclusiva do Tetris

   Script clássico (sem módulos ES). Carregue ANTES de tetris.js.
   Expõe um único objeto global: TetrisStorage.

   Dados guardados (chaves iguais às que o jogo já usava):
     tetris:best  -> recorde: maior score já alcançado (inteiro >= 0)
     tetris:muted -> '1' = som desligado, '0' = som ligado
     tetris:save  -> partida em andamento (JSON); removida no Game Over

   Garantias:
     - nunca lança exceção (modo privado, cookies bloqueados, cota cheia...);
     - sem armazenamento persistente, os valores ficam em memória na sessão;
     - dado ausente ou inválido vira o padrão seguro (recorde 0, som ligado);
     - o recorde salvo nunca diminui por engano.
   ========================================================================== */
(() => {
  'use strict';

  const KEYS = Object.freeze({ best: 'tetris:best', muted: 'tetris:muted', save: 'tetris:save' });
  const DEFAULTS = Object.freeze({ best: 0, muted: false });
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

  // Partida em andamento. loadGame devolve o objeto salvo ou null (ausente/corrompido);
  // quem chama valida o conteúdo. clearGame torna a partida não restaurável (Game Over).
  function saveGame(snapshot) {
    try { return writeRaw(KEYS.save, JSON.stringify(snapshot)); }
    catch (error) { return false; }
  }

  function loadGame() {
    const raw = readRaw(KEYS.save);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      return data && typeof data === 'object' ? data : null;
    } catch (error) { return null; }
  }

  function clearGame() {
    delete memory[KEYS.save];
    try { window.localStorage.removeItem(KEYS.save); } catch (error) { /* ignora */ }
  }

  window.TetrisStorage = Object.freeze({ KEYS, DEFAULTS, getBest, setBest, isMuted, setMuted, saveGame, loadGame, clearGame });
})();