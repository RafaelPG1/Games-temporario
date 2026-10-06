"""tests/controls_browser.py - pausa (P) e som (M) nos jogos que os implementam: o estado visual precisa refletir o estado real.
Uso (na raiz): python3 tests/controls_browser.py"""
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'); PORT = 8792
PAUSE = ['classicos/snake/snake', 'arcade/piano_tap/piano_tap', 'arcade/flappy_bird/flappy_bird', 'arcade/jumpy/jumpy', 'arcade/stack_tower/stack_tower',
         'arcade/breakout/breakout', 'arcade/tetris/tetris', 'arcade/pac_man/pac_man', 'puzzle/slide_puzzle/slide_puzzle']
MUTE = PAUSE + ['puzzle/memory_match/memory_match', 'puzzle/sokoban/sokoban', 'puzzle/water_sort/water_sort', 'classicos/jogo_velha/jogo_velha', 'casual/solitario/solitario']
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(.8)
fails = []
def start(pg):
    btn = pg.query_selector('#game-menu [data-menu-play]') or pg.query_selector('#start-button')
    btn.click(); pg.wait_for_timeout(400)
    pg.evaluate("document.activeElement && document.activeElement.blur()")
paused_js = """() => {
  const vis = (el) => { if (!el) return false; const c = getComputedStyle(el); return c.visibility !== 'hidden' && c.display !== 'none' && Number(c.opacity) > .5; };
  const root = document.querySelector('.stage, #stage, .play, main, body');
  const cls = [document.body, root, ...document.querySelectorAll('[class*=is-]')].some(e => e && /\\bis-paused\\b|\\bpaused\\b/.test(e.className));
  return cls || vis(document.querySelector('.screen-paused')) || vis(document.querySelector('#pause-overlay')); }"""
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for path in PAUSE:
            ctx = b.new_context(viewport={'width': 1100, 'height': 780}); pg = ctx.new_page()
            pg.goto(f'http://127.0.0.1:{PORT}/{path}.html'); pg.wait_for_timeout(500); start(pg)
            name = path.split('/')[-1]
            pg.keyboard.press('KeyP'); pg.wait_for_timeout(350)
            a = pg.evaluate(paused_js)
            pg.keyboard.press('KeyP'); pg.wait_for_timeout(350)
            r = pg.evaluate(paused_js)
            esc_ok = None
            if name not in ('tetris',):    # Tetris só declara P
                pg.keyboard.press('Escape'); pg.wait_for_timeout(350); esc_ok = pg.evaluate(paused_js); pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
            ok = a and not r and (esc_ok in (True, None))
            print(f'{name:14s} pausa(P)={a} retoma={not r} Esc={esc_ok}', 'ok' if ok else 'FALHA')
            if not ok: fails.append(f'{name}: pausa/retomada não reflete o estado (P={a}, retomou={not r}, Esc={esc_ok})')
            ctx.close()
        for path in MUTE:
            ctx = b.new_context(viewport={'width': 1100, 'height': 780}); pg = ctx.new_page()
            pg.goto(f'http://127.0.0.1:{PORT}/{path}.html'); pg.wait_for_timeout(500); start(pg)
            name = path.split('/')[-1]
            btn = pg.query_selector('#mute-button, #mute, [id*=mute], [aria-label*=Som i], [aria-label*=som i]')
            before = pg.evaluate("(JSON.parse(localStorage.getItem('arcadia:game:%s')||'{}').data||{}).muted===true" % name)
            pg.keyboard.press('KeyM'); pg.wait_for_timeout(250)
            after = pg.evaluate("(JSON.parse(localStorage.getItem('arcadia:game:%s')||'{}').data||{}).muted===true" % name)
            ui = pg.evaluate("""() => { const b = document.querySelector('#mute-button, #mute, [id*=mute]'); return b ? [b.getAttribute('aria-pressed'), b.getAttribute('aria-label'), b.title] : null; }""")
            ok = (before != after) and btn is not None
            print(f'{name:14s} M alterna={before}->{after} botão={ui}', 'ok' if ok else 'FALHA')
            if not ok: fails.append(f'{name}: tecla M não alterna o som gravado ou não há botão (antes={before}, depois={after})')
            # recarregar mantém a preferência
            pg.reload(); pg.wait_for_timeout(500)
            kept = pg.evaluate("(JSON.parse(localStorage.getItem('arcadia:game:%s')||'{}').data||{}).muted===true" % name)
            if kept != after: fails.append(f'{name}: preferência de som não persistiu')
            ctx.close()
        b.close()
finally: srv.terminate()
print(f'\n{len(fails)} falha(s).'); [print(' -', f) for f in fails]; sys.exit(1 if fails else 0)
