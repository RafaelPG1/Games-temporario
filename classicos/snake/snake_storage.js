/* ==========================================================================
   classicos/snake/snake_storage.js - persistência exclusiva da Cobrinha

   Script clássico (sem módulos ES). Carregue ANTES de snake.js.
   Expõe um único objeto global: SnakeStorage.

   Dados guardados (chaves iguais às que o jogo já usava):
     snake:best  -> recorde: maior score já alcançado (inteiro >= 0)
     snake:muted -> '1' = som desligado, '0' = som ligado
     snake:save  -> instantâneo completo da partida em andamento (JSON); apagado ao reiniciar/terminar

   Garantias:
     - nunca lança exceção (modo privado, cookies bloqueados, cota cheia...);
     - sem armazenamento persistente, os valores ficam em memória na sessão;
     - dado ausente ou inválido vira o padrão seguro (recorde 0, som ligado);
     - o recorde salvo nunca diminui por engano;
     - o salvamento da partida é opaco aqui: quem valida o conteúdo é snake.js (dado corrompido => null).
   ========================================================================== */
(() => {
  'use strict';

  const KEYS = Object.freeze({ best: 'snake:best', muted: 'snake:muted', save: 'snake:save' });
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

  function removeRaw(key) {
    delete memory[key];
    try { window.localStorage.removeItem(key); } catch (error) { /* nada a remover */ }
  }

  // Partida em andamento: objeto simples serializável. Devolve true se gravou de fato no navegador.
  function saveGame(data) {
    try { return writeRaw(KEYS.save, JSON.stringify(data)); }
    catch (error) { return false; }
  }

  // Devolve o objeto salvo ou null (ausente, ilegível ou não-objeto; nesse caso o lixo é apagado).
  function loadGame() {
    const raw = readRaw(KEYS.save);
    if (raw === null) return null;
    try {
      const data = JSON.parse(raw);
      if (data && typeof data === 'object' && !Array.isArray(data)) return data;
    } catch (error) { /* cai no descarte abaixo */ }
    removeRaw(KEYS.save);
    return null;
  }

  function clearGame() { removeRaw(KEYS.save); }

  window.SnakeStorage = Object.freeze({ KEYS, DEFAULTS, getBest, setBest, isMuted, setMuted, saveGame, loadGame, clearGame });
})();