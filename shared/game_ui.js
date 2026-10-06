/* shared/game_ui.js - peças de interface compartilhadas pelos jogos (sem dependências)

   GameUI.isTyping(e)             -> true se a tecla veio de um campo de texto (input/textarea/select/contenteditable)
   GameUI.menu.mount(opts)        -> menu inicial em tela cheia, para jogos sem tela inicial própria
   GameUI.levels.mount(el, opts)  -> grade de fases (concluída / atual / desbloqueada / bloqueada)

   Este arquivo também instala uma proteção global: teclas digitadas em campos de texto nunca chegam aos
   atalhos dos jogos. Carregue-o ANTES do script do jogo (a proteção roda na fase de captura). */
(function (root) {
  'use strict';
  var doc = root.document;

  function isTyping(e) {
    var t = e && e.target;
    if (!t || !t.tagName) return false;
    var n = t.tagName;
    return n === 'INPUT' || n === 'TEXTAREA' || n === 'SELECT' || !!t.isContentEditable;
  }
  doc.addEventListener('keydown', function (e) { if (isTyping(e)) e.stopImmediatePropagation(); }, true);
  doc.addEventListener('keyup', function (e) { if (isTyping(e)) e.stopImmediatePropagation(); }, true);

  /* ---------- Menu inicial ---------- */
  var current = null;

  // opts: { el: '#game-menu' | Element, onPlay(): void, onOpen(): void, openOnMount: true }
  function mountMenu(opts) {
    var el = typeof opts.el === 'string' ? doc.querySelector(opts.el) : opts.el;
    if (!el) return null;
    var playBtn = el.querySelector('[data-menu-play]');
    var open = false;

    function place() {
      var bar = doc.querySelector('.topbar');
      el.style.setProperty('--gmenu-top', (bar ? bar.getBoundingClientRect().bottom : 0) + 'px');
    }
    function openMenu() {
      open = true; el.hidden = false; doc.body.classList.add('menu-open'); place();
      if (opts.onOpen) opts.onOpen();
      if (playBtn) playBtn.focus({ preventScroll: true });
    }
    function closeMenu() { open = false; el.hidden = true; doc.body.classList.remove('menu-open'); }
    function play() { closeMenu(); if (opts.onPlay) opts.onPlay(); }

    if (playBtn) playBtn.addEventListener('click', play);
    // Enquanto o menu está aberto, o jogo não recebe teclas (só Tab/Enter/Espaço do próprio menu).
    doc.addEventListener('keydown', function (e) {
      if (!open) return;
      if (e.key === 'Tab') return;
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
        var onBtn = e.target && e.target.closest && e.target.closest('button');
        if (!onBtn || !el.contains(onBtn)) { e.preventDefault(); play(); }
      }
      e.stopImmediatePropagation();
    }, true);
    doc.addEventListener('keyup', function (e) { if (open) e.stopImmediatePropagation(); }, true);
    root.addEventListener('resize', function () { if (open) place(); });
    ['pointerdown', 'mousedown', 'touchstart', 'click'].forEach(function (t) { el.addEventListener(t, function (e) { e.stopPropagation(); }); });

    current = { open: openMenu, close: closeMenu, isOpen: function () { return open; }, el: el };
    if (opts.openOnMount !== false) openMenu();
    return current;
  }

  // Espelha botões de opção que já existem na página (ex.: dificuldade) dentro do menu.
  // Clicar na cópia aciona o botão original, então a lógica do jogo continua sendo uma só.
  function mirror(sourceSelector, targetEl) {
    var sources = Array.prototype.slice.call(doc.querySelectorAll(sourceSelector));
    var copies = sources.map(function (src) {
      var b = doc.createElement('button');
      b.type = 'button'; b.className = 'gmenu-opt'; b.setAttribute('role', 'radio'); b.innerHTML = src.innerHTML;
      b.addEventListener('click', function () { src.click(); sync(); });
      targetEl.appendChild(b); return b;
    });
    function isOn(s) {
      return s.getAttribute('aria-checked') === 'true' || s.getAttribute('aria-pressed') === 'true' || /\b(is-on|active|selected)\b/.test(s.className);
    }
    function sync() { copies.forEach(function (c, i) { c.setAttribute('aria-checked', String(isOn(sources[i]))); }); }
    if (root.MutationObserver) {
      var mo = new MutationObserver(sync);
      sources.forEach(function (s) { mo.observe(s, { attributes: true, attributeFilter: ['aria-checked', 'aria-pressed', 'class'] }); });
    }
    sync();
    return { sync: sync };
  }

  /* ---------- Grade de fases ---------- */
  var LOCK = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="2" fill="currentColor"/><path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

  // opts: { total, unlocked, completed: number[] | Set, current, selected?, onPick(n), legend: true }
  // Fases são numeradas a partir de 1. "unlocked" é a maior fase jogável. Fases > unlocked ficam bloqueadas.
  function mountLevels(el, opts) {
    var o = opts;
    function render() {
      var done = o.completed instanceof Set ? o.completed : new Set(o.completed || []);
      var html = '<div class="lvl-grid" role="list" aria-label="Fases">';
      for (var n = 1; n <= o.total; n++) {
        var locked = n > o.unlocked, cls = 'lvl';
        if (locked) cls += ' is-locked'; else if (n === o.current) cls += ' is-current'; else if (done.has(n)) cls += ' is-done';
        if (o.selected === n) cls += ' is-selected';
        var state = locked ? 'bloqueada' : n === o.current ? 'próxima' : done.has(n) ? 'concluída' : 'disponível';
        html += '<button type="button" role="listitem" class="' + cls + '" data-lvl="' + n + '"' + (locked ? ' disabled' : '') +
          ' aria-label="Fase ' + n + ', ' + state + '">' + (locked ? LOCK : n) + '</button>';
      }
      html += '</div>';
      if (o.legend !== false) html += '<p class="lvl-legend"><span class="k-current">atual</span><span class="k-done">concluída</span><span>disponível</span><span class="k-locked">bloqueada</span></p>';
      el.classList.add('lvl-wrap'); el.innerHTML = html;
    }
    el.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.lvl');
      if (!b || b.disabled) return;
      var n = Number(b.dataset.lvl);
      if (n >= 1 && n <= o.unlocked && o.onPick) o.onPick(n);
    });
    render();
    return { update: function (next) { for (var k in next) o[k] = next[k]; render(); } };
  }

  // Montagem automática: <div id="game-menu" class="gmenu" hidden> ... </div>
  // - [data-menu-play]        botão que fecha o menu e começa;
  // - [data-mirror="seletor"] contêiner que recebe cópias dos botões de opção do jogo (ex.: dificuldade);
  // - data-manual             o jogo monta o menu sozinho (usa GameUI.menu.mount com onPlay).
  doc.addEventListener('DOMContentLoaded', function () {
    var el = doc.getElementById('game-menu');
    if (!el || el.hasAttribute('data-manual')) return;
    Array.prototype.forEach.call(el.querySelectorAll('[data-mirror]'), function (box) { mirror(box.getAttribute('data-mirror'), box); });
    mountMenu({ el: el });
  });

  root.GameUI = { isTyping: isTyping, menu: { mount: mountMenu, mirror: mirror, get current() { return current; } }, levels: { mount: mountLevels } };
})(window);
