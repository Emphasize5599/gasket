"""Headless check of the web UI at Pixel 10 Pro / Pixel 8 Pro viewport sizes, using demo data."""
import sys, os
from playwright.sync_api import sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
URL = 'file://' + os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'assets', 'web', 'index.html'))
errors = []

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/google/chrome/chrome', args=['--no-sandbox'])
    for name, w, h, scheme in [('pixel10pro', 412, 915, 'dark'), ('pixel8pro', 448, 998, 'light')]:
        pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=2.6, color_scheme=scheme, is_mobile=True, has_touch=True)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'tile' not in m.text and 'ERR_' not in m.text and errors.append(m.text))
        pg.goto(URL)
        pg.evaluate('setInsets(44, 24, 0, 0)')
        pg.wait_for_timeout(600)
        pg.screenshot(path=f'{OUT}/{name}-0-onboarding.png')
        assert pg.locator('input[data-k=autoRefresh]').count() == 1 and not pg.is_checked('input[data-k=autoRefresh]') and pg.evaluate('window.__app.S.autoRefresh') is False, 'no price search on opening by default'
        pg.click('#sDone')   # no Google key: Walmart-only mode (mocked walmart.com answer)
        pg.wait_for_timeout(900)
        pg.screenshot(path=f'{OUT}/{name}-0b-walmart-only.png')
        wm_pins = pg.locator('.pin-in').count()
        print(name, 'walmart-only pins:', wm_pins, '| status:', pg.inner_text('#status'))
        assert wm_pins == 2, wm_pins
        for label in ['W', 'M']:
            pg.locator('.pin-in', has=pg.locator('.b', has_text=label)).first.click(force=True); pg.wait_for_timeout(500)
            print('  ' + label + ' breakdown:', ' / '.join(l.replace('\n', ' ') for l in pg.locator('.bd .ln').all_inner_texts()),
                  '|', ' '.join(pg.locator('#detail .note').all_inner_texts())[-70:])
            if label == 'M': pg.screenshot(path=f'{OUT}/{name}-0c-murphy.png')
            pg.click('#dClose')
        pg.evaluate("window.__wmMock={blocked:true}; window.__app.fetchAround(34.77,-92.27)")
        pg.wait_for_timeout(500)
        assert pg.is_visible('#wmCheck'), 'verify banner'
        assert 'Walmart' in pg.inner_text('#wmCheckTitle')
        pg.click('#wmCheckGo'); assert pg.evaluate('window.__verifyOpened') == 'walmart'
        # the refresh button spins (icon only), keeping its size and look
        pg.evaluate("document.getElementById('btnRefresh').classList.add('spin')")
        rb = pg.evaluate("(() => { const b = document.getElementById('btnRefresh'), cs = getComputedStyle(b), sv = getComputedStyle(b.querySelector('svg')); return [Math.round(b.getBoundingClientRect().width), cs.borderTopWidth, cs.animationName, sv.animationName]; })()")
        print('  refresh spinning:', rb); assert rb[0] >= 36 and rb[1] == '0px' and rb[2] == 'none' and rb[3] == 'spin', rb
        pg.evaluate("document.getElementById('btnRefresh').classList.remove('spin')")
        pg.evaluate("window.__wmMock=null")
        pg.click('#btnSettings'); pg.wait_for_timeout(200)
        pg.click('#sDemo')
        pg.wait_for_timeout(800)
        pg.screenshot(path=f'{OUT}/{name}-1-map.png')
        n_pins = pg.locator('.pin-in').count()
        assert n_pins >= 10, n_pins
        # tap a CITGO pin
        pg.locator('.pin-in', has_text='C$').first.click(force=True) if pg.locator('.pin-in', has_text='C$').count() else pg.locator('.pin-in').first.click(force=True)
        pg.wait_for_timeout(700)
        pg.screenshot(path=f'{OUT}/{name}-2-detail.png')
        lines = pg.locator('.bd .ln').all_inner_texts()
        print(name, 'pins', n_pins, '| breakdown:', ' / '.join(l.replace('\n', ' ') for l in lines))
        pg.click('#dNav')
        print('  navigate ->', pg.evaluate('window.__lastNav'))
        pg.click('#dClose')
        pg.click('#bestLine')
        pg.wait_for_timeout(500)
        pg.screenshot(path=f'{OUT}/{name}-3-list.png')
        pg.click('#btnSettings')
        pg.wait_for_timeout(300)
        pg.screenshot(path=f'{OUT}/{name}-4-settings.png', full_page=True)
        pg.close()
    b.close()
print('JS errors:', errors or 'none')
