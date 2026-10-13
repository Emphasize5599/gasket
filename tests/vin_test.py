# A VIN looked up on a slow connection (every lookup ~0.7 s, like a phone): the year / make / model / engine boxes
# fill once and stay filled (they used to be emptied and filled again by a redraw, ending half-filled), and looking up
# the same VIN again doesn't redo it.
import os, sys, re, json, time
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
src = open(os.path.join(os.path.dirname(__file__), 'garage_test.py')).read()
ns = {'__file__': os.path.join(os.path.dirname(os.path.abspath(__file__)), 'garage_test.py'), '__name__': 'x'}
exec(src[:src.index("with sync_playwright()")] if "with sync_playwright()" in src else '', ns)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOCKS = open(os.path.join(ROOT, 'tests', 'trip_mocks.js')).read(); EXTRA = ns['EXTRA']
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME'), args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 412, 'height': 915})
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('file://' + os.path.join(ROOT, 'assets/web/index.html')); pg.wait_for_timeout(400)
    pg.click('#sDone'); pg.wait_for_timeout(300)
    pg.evaluate(MOCKS); pg.evaluate(EXTRA)
    delay = int(os.environ.get('DELAY', '700'))
    pg.evaluate("(d) => { const N = window.__app.N, f = N.fetchJson; N.fetchJson = function () { const a = arguments; setTimeout(() => f.apply(N, a), d); }; }", delay)
    pg.click('#btnTrip'); pg.wait_for_timeout(400)
    pg.click('[data-car="+"]'); pg.wait_for_timeout(300)
    pg.evaluate("window.__snaps = []; window.__mut = 0; new MutationObserver(() => window.__mut++).observe(document.getElementById('tGarage'), { childList: true, subtree: true }); setInterval(() => { const v = (id) => { const e = document.getElementById(id); return e ? e.value : '-'; }; window.__snaps.push([v('eYear'), v('eMake'), v('eModel'), v('eOpt'), (document.getElementById('eMsg') || {}).textContent || ''].join('|')); }, 150)")
    pg.fill('#gVin', '2b3lk33g08h000001'); pg.click('#gVinGo'); pg.wait_for_timeout(int(os.environ.get('WAIT', '9000')))
    snaps = pg.evaluate('window.__snaps'); dedup = [s for i, s in enumerate(snaps) if i == 0 or s != snaps[i-1]]
    for s in dedup: print(' ', s[:160])
    vals = [d.split('|')[:4] for d in dedup]
    full = [i for i, v in enumerate(vals) if all(x and x not in ('Make', 'Model', 'Engine / transmission') for x in v)]
    assert full, 'the boxes were filled in'
    assert all(all(vals[j]) for j in range(full[0], len(vals))), 'once filled, never emptied again: ' + str(dedup[full[0]:])
    assert pg.evaluate("document.getElementById('eOpt').value") == '24898'
    n0 = len(pg.evaluate('window.__snaps')); m0 = pg.evaluate('window.__mut')
    pg.click('#gVinGo'); pg.wait_for_timeout(1500)
    assert 'Already looked up' in pg.inner_text('#vMsg'), pg.inner_text('#vMsg')
    assert all(all(s.split('|')[:4]) for s in pg.evaluate('window.__snaps')[n0:]), 'the second click leaves them alone'
    print('mutations', pg.evaluate('window.__mut'), 'errors', errs)
    assert not errs, errs
    print('car', pg.evaluate("JSON.stringify((({year,make,model,epaId,trim})=>({year,make,model,epaId,trim}))(window.Garage.car()))"))
    b.close()
print('VIN lookup on a slow connection: filled once, stays filled; same VIN again does nothing')
