"""tests/layout_browser.py - sem rolagem horizontal, cabeçalho cabendo e botão principal do menu visível, em 360x640, 390x740 e 1280x720.
Uso (na raiz): python3 tests/layout_browser.py"""
import subprocess, sys, time, os, re
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'); PORT = 8793
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(.8)
pages = ['index.html'] + [m for m in re.findall(r'`?(?:arcade|puzzle|classicos|estrategia|casual)/[a-z_]+/[a-z_]+\.html', '')]
for d in ('arcade', 'puzzle', 'classicos', 'estrategia', 'casual'):
    for g in sorted(os.listdir(os.path.join(ROOT, d))):
        if os.path.isfile(os.path.join(ROOT, d, g, f'{g}.html')): pages.append(f'{d}/{g}/{g}.html')
fails = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for w, h, mob in ((360, 640, True), (390, 740, True), (1280, 720, False)):
            ctx = b.new_context(viewport={'width': w, 'height': h}, has_touch=mob, is_mobile=mob)
            for path in pages:
                pg = ctx.new_page(); pg.goto(f'http://127.0.0.1:{PORT}/{path}'); pg.wait_for_timeout(900)
                r = pg.evaluate("""() => { const de = document.documentElement;
                  const bar = document.querySelector('.topbar'); const back = document.querySelector('.topbar .back'); const name = document.querySelector('.topbar .game-text');
                  const play = document.querySelector('#game-menu [data-menu-play], #start-button');
                  const pr = play ? play.getBoundingClientRect() : null;
                  const br = bar ? bar.getBoundingClientRect() : null;
                  return { hscroll: de.scrollWidth - de.clientWidth, barH: br && br.height, nameOverflow: name ? name.scrollWidth - name.clientWidth : 0,
                           playVisible: pr ? (pr.top >= 0 && pr.bottom <= innerHeight && pr.left >= 0 && pr.right <= innerWidth && pr.width > 0) : null,
                           backW: back ? back.getBoundingClientRect().width : null }; }""")
                tag = f'{path} @{w}'
                if r['hscroll'] > 1: fails.append(f'{tag}: rolagem horizontal ({r["hscroll"]}px)')
                if path != 'index.html':
                    if r['nameOverflow'] > 1: fails.append(f'{tag}: nome do jogo cortado no cabeçalho')
                    if r['barH'] and r['barH'] > 64: fails.append(f'{tag}: cabeçalho muito alto ({r["barH"]:.0f}px)')
                    if r['playVisible'] is False: fails.append(f'{tag}: botão principal fora da tela')
                    if mob and r['backW'] and r['backW'] < 40: fails.append(f'{tag}: botão voltar pequeno ({r["backW"]:.0f}px)')
                pg.close()
            ctx.close()
        b.close()
finally: srv.terminate()
print(f'{len(pages)} páginas x 3 tamanhos, {len(fails)} problema(s).'); [print(' -', f) for f in fails]; sys.exit(1 if fails else 0)
