"""Headless check of the web UI at Pixel 10 Pro / Pixel 8 Pro viewport sizes, using demo data."""
import sys, os
from playwright.sync_api import sync_playwright
import fastwait  # noqa: F401  (waits end once the page settles; SLOW_WAITS=1 for fixed sleeps)

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
URL = 'file://' + os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'assets', 'web', 'index.html'))
errors = []

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME', '/opt/google/chrome/chrome'), args=['--no-sandbox'])
    for name, w, h, scheme in fastwait.viewports([('pixel10pro', 412, 915, 'dark'), ('pixel8pro', 448, 998, 'light')]):
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
        wm_pins = pg.locator('.leaflet-tooltip.mbub').count()
        print(name, 'walmart-only pins:', wm_pins, '| status:', pg.inner_text('#status'))
        assert wm_pins == 2, wm_pins
        for label, brand in [('W', 'walmart'), ('M', 'murphy')]:
            pg.locator('.leaflet-tooltip.mbub[data-brand="%s"]' % brand).first.click(force=True); pg.wait_for_timeout(500)
            print('  ' + label + ' breakdown:', ' / '.join(l.replace('\n', ' ') for l in pg.locator('.bd .ln').all_inner_texts()),
                  '|', ' '.join(pg.locator('#detail .note').all_inner_texts())[-70:])
            if label == 'M': pg.screenshot(path=f'{OUT}/{name}-0c-murphy.png')
            pg.click('#dClose')
        pg.evaluate("window.__wmMock={blocked:true}; window.__app.fetchAround(34.7450,-92.2900)")
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
        n_pins = pg.locator('.leaflet-tooltip.mbub').count()
        vis = pg.evaluate("[...document.querySelectorAll('.leaflet-tooltip.mbub')].filter(e => e.style.visibility !== 'hidden').length")
        # bubbles never overlap each other or the controls
        ov = pg.evaluate('''() => { const bs = [...document.querySelectorAll('.leaflet-tooltip.mbub')].filter(e => e.style.visibility !== 'hidden').map(e => e.getBoundingClientRect());
          let n = 0; for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) { const a = bs[i], b = bs[j]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) n++; }
          const sh = document.getElementById('listSheet').getBoundingClientRect(), top = document.querySelector('.top').getBoundingClientRect();
          const under = bs.filter(r => r.bottom > sh.top + 1 || r.top < top.bottom - 1).length; return [n, under]; }''')
        print(name, 'bubbles:', n_pins, 'shown:', vis, 'overlaps / under controls:', ov)
        assert n_pins >= 10 and vis >= 4 and ov == [0, 0], (n_pins, vis, ov)
        pg.evaluate("window.__app.map.setZoom(9)"); pg.wait_for_timeout(700)
        ov2 = pg.evaluate("[...document.querySelectorAll('.leaflet-tooltip.mbub')].filter(e => e.style.visibility !== 'hidden').length")
        print('  zoomed out: bubbles shown', ov2); pg.screenshot(path=f'{OUT}/{name}-1b-zoomed-out.png')
        pg.evaluate("window.__app.map.setZoom(12)"); pg.wait_for_timeout(700)
        # tap a CITGO bubble
        cb = pg.locator('.leaflet-tooltip.mbub[data-brand="citgo"]:not([style*="hidden"])')
        (cb.first if cb.count() else pg.locator('.leaflet-tooltip.mbub:not([style*="hidden"])').first).click(force=True)
        pg.wait_for_timeout(700)
        pg.screenshot(path=f'{OUT}/{name}-2-detail.png')
        lines = pg.locator('.bd .ln').all_inner_texts()
        print(name, 'pins', n_pins, '| breakdown:', ' / '.join(l.replace('\n', ' ') for l in lines))
        pg.click('#dNav')
        print('  navigate ->', pg.evaluate('window.__lastNav'))
        pg.click('#dClose')
        # brand logos: fetched once (here a stand-in icon), then on the bubbles, the list and the details
        pg.evaluate('''window.__mocks = window.__mocks || {}; window.__iconUrls = []; window.__mocks.icon = (u) => { window.__iconUrls.push(u);
          const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#e33'; x.beginPath(); x.arc(32, 32, 28, 0, 7); x.fill();
          return { body: c.toDataURL(), w: 64, h: 64 }; }; window.__app.reloadLogos(); 0''')
        pg.wait_for_timeout(800)
        lg = pg.evaluate("[document.querySelectorAll('.mbub .lg.img img').length, document.querySelectorAll('#rows .badge.logo img').length, window.__iconUrls.length, window.__app.KV.get('logos', 'citgo') ? 1 : 0]")
        print('  logos (bubbles, rows, fetched, saved):', lg); assert lg[0] >= 3 and lg[1] >= 10 and lg[2] == 6 and lg[3] == 1, lg
        # a station with no price: hidden from the map and list when you ask
        pg.evaluate('''(() => { const st = window.__app.stations(), x = JSON.parse(JSON.stringify(st[0])); x.id = 'demo-noprice'; x.name = 'Kum & Go'; x.prices = {}; st.push(x); window.__app.render(); })(); 0''')
        pg.wait_for_timeout(300)
        n1 = pg.evaluate("[document.querySelectorAll('#rows .row').length, document.querySelectorAll('.mbub').length, [...document.querySelectorAll('#rows .nm')].some(e => e.textContent === 'Kum & Go')]")
        pg.evaluate("window.__app.S.hideUnpriced = true; window.__app.render()"); pg.wait_for_timeout(300)
        n2 = pg.evaluate("[document.querySelectorAll('#rows .row').length, document.querySelectorAll('.mbub').length]")
        print('  no-price station shown / hidden (rows, bubbles):', n1, n2); assert n1[2] and n2[0] == n1[0] - 1 and n2[1] == n1[1] - 1
        pg.evaluate("window.__app.S.hideUnpriced = false; window.__app.render()")
        # drag the list handle up, then back down
        g = pg.locator('#listGrab').bounding_box(); x, y = g['x'] + g['width'] / 2, g['y'] + g['height'] / 2
        pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x, y - 150, steps=6); pg.mouse.move(x, y - 300, steps=6); pg.mouse.up(); pg.wait_for_timeout(450)
        hUp = pg.evaluate("document.getElementById('rows').getBoundingClientRect().height"); op = pg.evaluate("document.getElementById('listSheet').classList.contains('open')")
        g = pg.locator('#listGrab').bounding_box(); x, y = g['x'] + g['width'] / 2, g['y'] + g['height'] / 2
        pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x, y + 200, steps=6); pg.mouse.move(x, y + 420, steps=6); pg.mouse.up(); pg.wait_for_timeout(450)
        cl = pg.evaluate("document.getElementById('listSheet').classList.contains('open')")
        print('  list dragged up to', round(hUp), 'open', op, '| dragged down: open', cl); assert op and 250 < hUp < 340 and not cl
        pg.click('#bestLine')
        pg.wait_for_timeout(500)
        pg.screenshot(path=f'{OUT}/{name}-3-list.png')
        # past the monthly Google lookup cap: the stations on the phone stay, Walmart and Murphy USA (their own sites) still update
        pg.evaluate("() => { window.__mocks = window.__mocks || {}; window.__mocks.search = () => ({ places: [], errors: ['Monthly API-call cap reached (900/900). Showing cached prices. Raise the cap in Settings if you accept possible charges.'] }); }")
        key0 = pg.evaluate("window.__app.S.apiKey"); pg.evaluate("window.__app.S.apiKey = 'AIzaSyTESTKEY0123456789abcdefghijklmnop'; window.__app.setDemo(false)")
        pg.evaluate("window.__app.fetchAround(34.7450,-92.2900)"); pg.wait_for_function("!document.getElementById('btnRefresh').classList.contains('spin')", timeout=5000); pg.wait_for_timeout(200)
        st = pg.inner_text('#status'); print('  at the cap:', st)
        pg.evaluate("(k) => { window.__app.S.apiKey = k; }", key0)
        assert "Monthly Google lookup cap reached (900/900). Only locations already in your phone's storage were updated, for Walmart and Murphy USA." in st, st
        assert pg.evaluate("document.getElementById('status').classList.contains('err')"), 'shown as a warning'
        pg.evaluate("() => { delete window.__mocks.search; }")
        pg.click('#btnSettings')
        pg.wait_for_timeout(300)
        pg.screenshot(path=f'{OUT}/{name}-4-settings.png', full_page=True)
        pg.close()
    b.close()
print('JS errors:', errors or 'none')
