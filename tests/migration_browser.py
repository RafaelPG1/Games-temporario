"""tests/migration_browser.py - semeia as chaves ANTIGAS de cada jogo, abre a página e confere a migração para o game_storage.
Uso (na raiz): python3 tests/migration_browser.py"""
import json, subprocess, sys, time, os
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'); PORT = 8791
# jogo -> (página, {chave antiga: valor}, {chave nova no registro: valor esperado})
CASES = {
 'snake': ('classicos/snake/snake.html', {'snake:best': '37', 'snake:muted': '1'}, {'best': 37, 'muted': True}),
 'piano_tap': ('arcade/piano_tap/piano_tap.html', {'piano-tap:best': '12', 'piano-tap:muted': '0'}, {'best': 12, 'muted': False}),
 'stack_tower': ('arcade/stack_tower/stack_tower.html', {'stacktower:best': '21', 'stacktower:muted': '1'}, {'best': 21, 'muted': True}),
 'jumpy': ('arcade/jumpy/jumpy.html', {'jumpy:muted': '1'}, {'muted': True}),
 'breakout': ('arcade/breakout/breakout.html', {'breakout:muted': '1'}, {'muted': True}),
 'flappy_bird': ('arcade/flappy_bird/flappy_bird.html', {'flappy-bird:best': '9', 'flappy-bird:muted': '1'}, {'best': 9, 'muted': True}),
 'tetris': ('arcade/tetris/tetris.html', {'tetris:best': '4200', 'tetris:muted': '1'}, {'best': 4200, 'muted': True}),
 'pac_man': ('arcade/pac_man/pac_man.html', {'pac_man:best': '1500', 'pac_man:muted': '1'}, {'best': 1500, 'muted': True}),
 'memory_match': ('puzzle/memory_match/memory_match.html', {'memory:best': '7', 'memory:muted': '1'}, {'best': 7, 'muted': True}),
 'slide_puzzle': ('puzzle/slide_puzzle/slide_puzzle.html', {'slide_puzzle:level': 'hard', 'slide_puzzle:muted': '1', 'slide_puzzle:best:hard': '{"moves":88,"time":91000}'}, {'level': 'hard', 'muted': True, 'best_hard': {'moves': 88, 'time': 91000}}),
 'campo_minado': ('puzzle/campo_minado/campo_minado.html', {'campo_minado:level': 'hard'}, {'level': 'hard'}),
 'sokoban': ('puzzle/sokoban/sokoban.html', {'sokoban:progress:v2': '{"unlocked":6,"best":{"0":12}}', 'sokoban:last': '4', 'sokoban:muted': '1'}, {'progress': {'unlocked': 6, 'best': {'0': 12}}, 'last': 4, 'muted': True}),
 'water_sort': ('puzzle/water_sort/water_sort.html', {'arcadia.water_sort.muted': '1'}, {'muted': True}),
 'jogo_velha': ('classicos/jogo_velha/jogo_velha.html', {'jogo_velha:mode': 'ai', 'jogo_velha:level': 'hard', 'jogo_velha:starter': 'O', 'jogo_velha:muted': '1'}, {'mode': 'ai', 'level': 'hard', 'starter': 'O', 'muted': True}),
 'batalha_naval': ('estrategia/batalha_naval/batalha_naval.html', {'batalha_naval:level': 'hard', 'batalha_naval:muted': '1', 'batalha_naval:vol': '35'}, {'level': 'hard', 'muted': True, 'vol': 35}),
 'solitario': ('casual/solitario/solitario.html', {'solitaire:best': '55', 'solitaire:muted': '1', 'solitaire:mode': '3'}, {'best': 55, 'muted': True, 'mode': 3}),
}
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(.8)
fails = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for gid, (page, old, expect) in CASES.items():
            ctx = b.new_context(); pg = ctx.new_page(); errs = []
            pg.on('pageerror', lambda e, errs=errs: errs.append(str(e)))
            pg.goto(f'http://127.0.0.1:{PORT}/{page}')
            pg.evaluate('(o) => { localStorage.clear(); for (const k in o) localStorage.setItem(k, o[k]); }', old)
            pg.reload(); pg.wait_for_timeout(600)
            rec = pg.evaluate(f"JSON.parse(localStorage.getItem('arcadia:game:{gid}') || 'null')")
            data = (rec or {}).get('data', {})
            for k, v in expect.items():
                if data.get(k) != v: fails.append(f'{gid}: {k} = {data.get(k)!r}, esperado {v!r}')
            left = pg.evaluate('(ks) => ks.filter(k => localStorage.getItem(k) !== null)', list(old))
            if left: fails.append(f'{gid}: chaves antigas não removidas: {left}')
            # idempotência: recarregar não muda nada
            pg.reload(); pg.wait_for_timeout(400)
            rec2 = pg.evaluate(f"JSON.parse(localStorage.getItem('arcadia:game:{gid}') or 'null')".replace(' or ', ' || '))
            if (rec2 or {}).get('data') != data: fails.append(f'{gid}: dados mudaram ao recarregar')
            if errs: fails.append(f'{gid}: erros {errs[:1]}')
            print(f'{gid:14s}', 'ok' if not [f for f in fails if f.startswith(gid)] else 'FALHA', data)
            ctx.close()
        # dado corrompido não derruba o jogo nem é perdido
        ctx = b.new_context(); pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(f'http://127.0.0.1:{PORT}/classicos/snake/snake.html'); pg.evaluate("localStorage.setItem('arcadia:game:snake','{quebrado')"); pg.reload(); pg.wait_for_timeout(500)
        if errs: fails.append(f'snake corrompido: erros {errs}')
        if pg.evaluate("localStorage.getItem('arcadia:game:snake')") != '{quebrado': fails.append('snake corrompido: leitura destruiu o texto original')
        print('snake com registro corrompido: abre sem erro e preserva o texto original' if not errs else 'FALHA corrompido')
        ctx.close(); b.close()
finally:
    srv.terminate()
print(f'\n{len(CASES)} jogos, {len(fails)} falha(s).'); [print(' -', f) for f in fails]; sys.exit(1 if fails else 0)
