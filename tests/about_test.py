"""Licenses & credits (Settings -> About) and the "Google Maps" credit Google's terms ask for beside its content."""
import sys, os
from playwright.sync_api import sync_playwright
import fastwait  # noqa: F401  (waits end once the page settles; SLOW_WAITS=1 for fixed sleeps)

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
URL = 'file://' + os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'assets', 'web', 'index.html'))
errors = []
KEY = 'AIzaSyTESTKEY0123456789abcdefghijklmnop'   # fake
# Google-shaped answers: the demo generator's stations under Places-style ids (demo ids get no credit, these do)
GOOGLE = '''() => { window.__mocks = window.__mocks || {}; window.__mocks.search = (q, box) => {
  const ps = window.demoPlaces((box[0] + box[2]) / 2, (box[1] + box[3]) / 2).map((p, i) => Object.assign({}, p, { id: 'ChIJtest' + i }));
  return { places: ps, errors: [], calls: 1 }; }; }'''
WIDE = '''(el) => { const r = []; const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) r.push('page ' + document.documentElement.scrollWidth);
  if (el && el.scrollWidth > el.clientWidth + 1) r.push('#' + el.id + ' ' + el.scrollWidth + '>' + el.clientWidth);
  return r; }'''

def gattr_style(pg, sel):
    return pg.evaluate('''(sel) => { const e = document.querySelector(sel); if (!e) return null; const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect(); return { text: e.textContent, size: parseFloat(cs.fontSize), weight: cs.fontWeight, color: cs.color, visible: r.width > 0 && r.height > 0 }; }''', sel)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME', '/opt/google/chrome/chrome'), args=['--no-sandbox'])
    for name, w, h, scheme in fastwait.viewports([('pixel10pro', 412, 915, 'dark'), ('narrow', 320, 800, 'light')]):
        pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=2.6, color_scheme=scheme, is_mobile=True, has_touch=True)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'tile' not in m.text and 'ERR_' not in m.text and errors.append(m.text))
        pg.goto(URL); pg.evaluate('setInsets(44, 24, 0, 0)'); pg.wait_for_timeout(400)
        # ---- Google stations: the credit in the list, a station's details and the map ----
        pg.evaluate(GOOGLE)
        if pg.locator('#settings:not(.hidden)').count() == 0: pg.click('#btnSettings'); pg.wait_for_timeout(300)
        pg.fill('#apiKey', KEY); pg.click('#sDone')
        pg.wait_for_timeout(600)
        if pg.locator('#rows .row').count() == 0: pg.click('#btnRefresh'); pg.wait_for_timeout(900)
        assert pg.locator('#rows .row').count() > 3, 'Google stations listed'
        st = gattr_style(pg, '#rows .gattr'); print(' ', name, 'list credit:', st)
        assert st and st['text'] == 'Google Maps' and 12 <= st['size'] <= 16 and st['weight'] == '400', st
        assert 'Google Maps' in pg.inner_text('.leaflet-control-attribution'), 'credit on the map'
        assert gattr_style(pg, '.leaflet-control-attribution .gattr')['size'] >= 12, 'map credit at least 12px'
        pg.evaluate("document.querySelector('#rows .row').click()"); pg.wait_for_timeout(400)
        st = gattr_style(pg, '#detail .gattr'); assert st and st['text'] == 'Google Maps' and st['visible'], st
        pg.screenshot(path=f'{OUT}/{name}-g-detail.png')
        pg.click('#dClose'); pg.wait_for_timeout(300)
        # ---- Settings -> About -> Licenses & credits ----
        pg.click('#btnSettings'); pg.wait_for_timeout(300)
        assert pg.locator('#licOpen').count() == 1, 'About card'
        pg.click('#licOpen'); pg.wait_for_timeout(300)
        t = pg.inner_text('#licPage').lower()     # card headings are styled in capitals
        for want in ['Leaflet 1.9.4', 'BSD 2-Clause License', 'Volodymyr Agafonkin', 'us-atlas', 'Michael Bostock', 'OpenStreetMap', 'Open Database License',
                     'Google Maps', 'Source First License 1.1', 'Benjamin Sanzone']:
            assert want.lower() in t, want + ' missing from Licenses & credits'
        assert pg.locator('#licPage a[data-url]').count() >= 3, 'links open in the browser'
        wide = pg.evaluate(WIDE, pg.query_selector('#licPage'))
        pg.evaluate('''() => { document.querySelectorAll('#licPage *').forEach(e => { e.style.fontSize = (parseFloat(getComputedStyle(e).fontSize) * 1.3) + 'px'; }); }''')
        wide += pg.evaluate(WIDE, pg.query_selector('#licPage'))
        assert not wide, 'sideways scrolling: ' + str(wide)
        pg.screenshot(path=f'{OUT}/{name}-licenses.png')
        pg.click('#licBack'); pg.wait_for_timeout(200)
        assert pg.locator('#licPage.hidden').count() == 1 and pg.locator('#settings:not(.hidden)').count() == 1, 'back to Settings'
        # ---- demo data is made up: no Google credit ----
        pg.click('#sDemo'); pg.wait_for_timeout(900)
        assert pg.locator('#rows .row').count() > 3 and pg.locator('#rows .gattr').count() == 0, 'no Google credit on demo stations'
        assert 'Google Maps' not in pg.inner_text('.leaflet-control-attribution'), 'no map credit with demo stations'
        pg.close()
    b.close()
print('JS errors:', errors or 'none')
assert not errors
print('about tests passed')
