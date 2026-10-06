"""tests/e2e_browser.py - teste de navegador (Playwright/Chromium). Uso (na raiz): python3 tests/e2e_browser.py
Parte do catálogo, abre CADA jogo pelo card, e confere: destino, erros de console, recursos 404, menu inicial,
botão Jogar, tecla de som (M) gravando só no registro do próprio jogo e volta ao catálogo."""
import json, subprocess, sys, time, os
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PORT = 8790
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(.8)
base = f'http://127.0.0.1:{PORT}/'
fails, rows = [], []
def check(c, m):
    if not c: fails.append(m)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1100, 'height': 760}); pg = ctx.new_page()
        pg.goto(base + 'index.html'); pg.wait_for_selector('a[href$=".html"]')
        hrefs = pg.eval_on_selector_all('a[href$=".html"]', 'els => els.map(e => e.getAttribute("href"))')
        check(len(hrefs) == 16, f'catálogo mostra {len(hrefs)} links (esperado 16)')
        for href in hrefs:
            gid = href.rsplit('/', 1)[-1][:-5]
            errs, bad = [], []
            gctx = b.new_context(viewport={'width': 1100, 'height': 760})   # contexto limpo: sem dados de outros jogos
            g = gctx.new_page()
            g.on('pageerror', lambda e, errs=errs: errs.append('pageerror: ' + str(e)))
            g.on('console', lambda m, errs=errs: errs.append(m.text) if m.type == 'error' else None)
            g.on('response', lambda r, bad=bad: bad.append(f'{r.status} {r.url}') if r.status >= 400 else None)
            g.goto(base + 'index.html'); g.wait_for_selector(f'a[href="{href}"]')
            g.click(f'a[href="{href}"]'); g.wait_for_load_state(); g.wait_for_timeout(700)   # clique real no card
            check(g.url == base + href, f'{gid}: card abriu {g.url}')
            hasmenu = g.evaluate("""() => {
              const m = document.getElementById('game-menu');
              if (m) return !m.hidden && getComputedStyle(m).display !== 'none';
              const s = document.querySelector('.screen-ready, .screen-title'); if (!s) return false;
              return getComputedStyle(s).visibility !== 'hidden' && Number(getComputedStyle(s).opacity) > 0.5; }""")
            check(hasmenu, f'{gid}: menu inicial não visível ao abrir')
            check(g.evaluate("!!document.querySelector('.menu-keys')"), f'{gid}: menu sem lista de comandos')
            check(g.evaluate("document.querySelector('.topbar .keys') === null"), f'{gid}: cabeçalho ainda tem instruções')
            check(g.evaluate("document.querySelector('link[rel=icon]').href.endsWith('favicon.svg')") , f'{gid}: favicon')
            # menu aberto: teclas do jogo não vazam (M não deve gravar nada)
            g.keyboard.press('KeyM'); g.wait_for_timeout(100)
            leak = g.evaluate("localStorage.length")
            # inicia: botão principal do menu
            btn = g.query_selector('#game-menu [data-menu-play]') or g.query_selector('#start-button')
            check(btn is not None, f'{gid}: sem botão principal')
            if btn: btn.click(); g.wait_for_timeout(500)
            started = g.evaluate("""() => { const m = document.getElementById('game-menu'); if (m) return m.hidden;
              const s = document.querySelector('.screen-ready, .screen-title'); return !s || getComputedStyle(s).visibility === 'hidden' || Number(getComputedStyle(s).opacity) < .5; }""")
            check(started, f'{gid}: menu continua aberto após clicar em Jogar')
            # digitação em campo de texto não aciona atalhos: injeta input, foca e digita M/R/P
            g.evaluate("""() => { const i = document.createElement('input'); i.id='__t'; document.body.appendChild(i); i.focus(); }""")
            before = g.evaluate("JSON.stringify(Object.keys(localStorage).sort())")
            g.keyboard.type('mrpz'); g.wait_for_timeout(100)
            after = g.evaluate("JSON.stringify(Object.keys(localStorage).sort())")
            check(before == after, f'{gid}: digitar em campo de texto acionou atalhos')
            g.evaluate("document.getElementById('__t').remove(); document.activeElement.blur()")
            # tecla M (som) -> só o registro do próprio jogo
            g.keyboard.press('KeyM'); g.wait_for_timeout(150)
            keys = g.evaluate("Object.keys(localStorage).sort()")
            others = [k for k in keys if k.startswith('arcadia:game:') and k != f'arcadia:game:{gid}']
            check(not others, f'{gid}: gravou em registro de outro jogo: {others}')
            legacy = [k for k in keys if not k.startswith('arcadia:game:')]
            check(not legacy, f'{gid}: chaves fora do padrão no localStorage: {legacy}')
            check(not errs, f'{gid}: erros de console: {errs[:2]}')
            check(not bad, f'{gid}: recursos com erro: {bad[:2]}')
            # voltar ao catálogo
            g.click('a.back'); g.wait_for_load_state()
            check(g.url == base + 'index.html', f'{gid}: voltar abriu {g.url}')
            rows.append((gid, 'ok' if not [f for f in fails if f.startswith(gid + ':')] else 'FALHA', keys))
            gctx.close()
        b.close()
finally:
    srv.terminate()
for r in rows: print(f'{r[0]:15s} {r[1]:6s} {r[2]}')
print(f'\n{len(rows)} jogos testados, {len(fails)} falha(s).')
for f in fails: print(' -', f)
sys.exit(1 if fails else 0)
