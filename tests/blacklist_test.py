"""Bad CITGO list: mark / undo / remove, the settings page, jumping to a station, diesel own-risk, export and import (merge only)."""
import sys, os, json
from playwright.sync_api import sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
URL = 'file://' + os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'assets', 'web', 'index.html'))
errors = []

def wplus(pg):
    # is the Walmart+ 10c in this station's breakdown?
    return pg.evaluate("[...document.querySelectorAll('#detail .bd .ln')].some(l => /Walmart\\+ discount/.test(l.innerText) && /−\\$0\\.10\\b/.test(l.innerText))")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME', '/opt/google/chrome/chrome'), args=['--no-sandbox'])
    for name, w, h, scheme in [('pixel10pro', 412, 915, 'dark'), ('pixel8pro', 448, 998, 'light')]:
        pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=2.6, color_scheme=scheme, is_mobile=True, has_touch=True)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'tile' not in m.text and 'ERR_' not in m.text and errors.append(m.text))
        pg.goto(URL); pg.evaluate('setInsets(44, 24, 0, 0)'); pg.wait_for_timeout(500)
        pg.click('#sDemo'); pg.wait_for_timeout(900)
        cid = pg.evaluate("(() => { const S = window.__app; return null; })()")
        # a CITGO with a regular price
        cit = pg.evaluate("(() => { const st = [...document.querySelectorAll('.pin-in')]; return null; })()")
        ids = pg.evaluate("window.__data ? 1 : 0"); assert ids == 1
        target = pg.evaluate("(() => { const list = window.__app.__stations ? window.__app.__stations() : null; return list; })()")
        # open a CITGO from the list sheet
        pg.evaluate("(() => { const r = [...document.querySelectorAll('#rows .row')].find(x => /CITGO/.test(x.innerText)); r.click(); })()")
        pg.wait_for_timeout(400)
        assert 'CITGO' in pg.inner_text('#detail h2')
        assert wplus(pg), 'CITGO gets the full Walmart+ 10c'
        assert pg.locator('#dBlAdd').count() == 1
        assert pg.locator('#dBlRisk').count() == 0, 'no diesel checkbox when buying regular'
        pg.screenshot(path=f'{OUT}/{name}-b1-citgo.png')
        # mark it bad: undo bar for a few seconds, Undo puts it back
        pg.click('#dBlAdd'); pg.wait_for_timeout(200)
        assert pg.is_visible('#undoBar') and 'bad CITGO list' in pg.inner_text('#undoBar')
        assert not wplus(pg) and pg.locator('#dBlRm').count() == 1, 'marked: no 10c'
        pg.screenshot(path=f'{OUT}/{name}-b2-marked.png')
        pg.click('#undoBtn'); pg.wait_for_timeout(200)
        assert pg.evaluate('window.__app.S.blacklist.length') == 0 and wplus(pg), 'undo'
        pg.click('#dBlAdd'); pg.wait_for_timeout(5600)
        assert pg.locator('#undoBar.hidden').count() == 1, 'undo bar goes away'
        assert pg.evaluate('window.__app.S.blacklist.length') == 1
        bad_name = pg.inner_text('#detail h2')
        # diesel: not counted at CITGO unless you take the risk (on another CITGO)
        pg.click('#dClose'); pg.wait_for_timeout(200)
        pg.evaluate("window.__app.S.grade = 'diesel'")
        other = pg.evaluate("""(() => { const r = [...document.querySelectorAll('#rows .row')].filter(x => /CITGO/.test(x.innerText)); return r.length; })()""")
        # settings: the list
        pg.click('#btnSettings'); pg.wait_for_timeout(200)
        assert '1 station' in pg.inner_text('#blCount')
        pg.click('#blOpen'); pg.wait_for_timeout(200)
        assert pg.locator('.bl-row').count() == 1 and bad_name.split('\n')[0] in pg.inner_text('#blPage')
        pg.screenshot(path=f'{OUT}/{name}-b3-list.png')
        # export the list; then remove it; import it back; import again = skipped
        pg.evaluate('window.__saved = null'); pg.click('#blExp'); pg.wait_for_timeout(200)
        sv = pg.evaluate('window.__saved'); data = json.loads(sv['text'])
        assert sv['name'].startswith('gasket-bad-citgos') and data['gasketData'] == 1 and 'fuelPlusData' not in data and len(data['blacklist']) == 1 and 'apiKey' not in sv['text']
        pg.click('[data-blrm="0"]'); pg.wait_for_timeout(250)
        assert pg.locator('#cfm').count() == 1 and pg.evaluate('window.__app.S.blacklist.length') == 1, 'asks before removing'
        pg.click('#cfmYes'); pg.wait_for_timeout(250)
        assert pg.locator('.bl-row').count() == 0 and pg.evaluate('window.__app.S.blacklist.length') == 0
        pg.evaluate('(t) => { window.__mocks = window.__mocks || {}; window.__mocks.pick = t; }', sv['text'])
        pg.click('#blImp'); pg.wait_for_timeout(300)
        assert pg.locator('.bl-row').count() == 1 and '1 bad station added' in pg.inner_text('#toast')
        pg.click('#blImp'); pg.wait_for_timeout(300)
        assert pg.locator('.bl-row').count() == 1 and '0 bad stations added (1 already on your list)' in pg.inner_text('#toast'), pg.inner_text('#toast')
        # a shared list naming the same spot under another id is still a duplicate
        dup = dict(data); dup['blacklist'] = [dict(data['blacklist'][0], id='someone-elses-id', lat=data['blacklist'][0]['lat'] + 0.0002)]
        pg.evaluate('(t) => { window.__mocks.pick = t; }', json.dumps(dup)); pg.click('#blImp'); pg.wait_for_timeout(300)
        assert pg.locator('.bl-row').count() == 1, 'same station, other id: skipped'
        # a file exported by Fuel+ Map (before the rename) is still accepted
        old = dict(data); del old['gasketData']; old['fuelPlusData'] = 1
        pg.evaluate('(t) => { window.__mocks.pick = t; }', json.dumps(old)); pg.click('#blImp'); pg.wait_for_timeout(300)
        assert '0 bad stations added (1 already on your list)' in pg.inner_text('#toast'), 'old Fuel+ export read: ' + pg.inner_text('#toast')
        not_ours = dict(data); del not_ours['gasketData']
        pg.evaluate('(t) => { window.__mocks.pick = t; }', json.dumps(not_ours)); pg.click('#blImp'); pg.wait_for_timeout(300)
        assert "isn't a Gasket data file" in pg.inner_text('#toast'), pg.inner_text('#toast')
        # tap it: the station on the main map
        pg.click('.bl-go'); pg.wait_for_timeout(500)
        assert pg.locator('#blPage.hidden').count() == 1 and pg.locator('#settings.hidden').count() == 1 and pg.is_visible('#detail')
        assert pg.locator('#dBlRm').count() == 1, 'remove from the map'
        c = pg.evaluate("window.__app.map.getCenter()"); e0 = data['blacklist'][0]
        assert abs(c['lat'] - e0['lat']) < 0.01 and abs(c['lng'] - e0['lng']) < 0.01
        pg.screenshot(path=f'{OUT}/{name}-b4-onmap.png')
        pg.click('#dBlRm'); pg.wait_for_timeout(250); pg.click('#cfmYes'); pg.wait_for_timeout(300)
        assert pg.evaluate('window.__app.S.blacklist.length') == 0 and 'Removed' in pg.inner_text('#undoBar')
        pg.click('#undoBtn'); pg.wait_for_timeout(200)
        assert pg.evaluate('window.__app.S.blacklist.length') == 1, 'undo a removal too'
        # export everything: no API key; importing it adds nothing new
        pg.evaluate("window.__app.S.apiKey = 'AIzaSECRET'")
        pg.click('#btnSettings'); pg.wait_for_timeout(200)
        pg.evaluate('window.__saved = null'); pg.click('#exAll'); pg.wait_for_timeout(200)
        all_t = pg.evaluate('window.__saved.text'); ad = json.loads(all_t)
        assert ad['kind'] == 'all' and 'AIzaSECRET' not in all_t and 'apiKey' not in ad['settings'] and ad['settings']['cars']
        pg.evaluate('(t) => { window.__mocks.pick = t; }', all_t); pg.click('#imAll'); pg.wait_for_timeout(300)
        t = pg.inner_text('#toast'); print(name, 'import all again:', t)
        assert '0 bad stations added (1 already on your list)' in t and 'car' not in t
        # a new car and a setting you've never set come in; your own settings stay
        ad2 = json.loads(all_t); ad2['settings']['cars'].append({'id': 'imported-car', 'name': 'Friend car', 'year': 2019, 'make': 'Honda', 'model': 'Fit', 'obs': {}, 'entries': []})
        ad2['settings']['radiusMi'] = 99; ad2['settings']['someNewSetting'] = 'x'
        pg.evaluate('(t) => { window.__mocks.pick = t; }', json.dumps(ad2)); pg.click('#imAll'); pg.wait_for_timeout(300)
        assert pg.evaluate("window.__app.S.cars.some(c => c.id === 'imported-car')") and pg.evaluate('window.__app.S.radiusMi') != 99 and pg.evaluate("window.__app.S.someNewSetting") == 'x'
        pg.screenshot(path=f'{OUT}/{name}-b5-settings.png')
        # delete the whole list (Undo restores it), clear the cache, erase everything (two taps)
        n0 = pg.evaluate('window.__app.S.blacklist.length')
        pg.click('#blDelAll'); pg.wait_for_timeout(250); pg.click('#cfmYes'); pg.wait_for_timeout(250)
        assert pg.evaluate('window.__app.S.blacklist.length') == 0 and 'Deleted' in pg.inner_text('#undoBar')
        pg.click('#undoBtn'); pg.wait_for_timeout(200)
        assert pg.evaluate('window.__app.S.blacklist.length') == n0
        pg.evaluate("window.__app.KV.put('xom', 'k', [1]); window.__app.KV.put('trips', 'index', [{id: 'x'}])")
        pg.click('#kvClear'); pg.wait_for_timeout(250)
        assert pg.evaluate("window.__app.KV.get('xom', 'k')") is not None, 'nothing cleared before you say so'
        pg.click('#cfmYes'); pg.wait_for_timeout(250)
        assert pg.evaluate("window.__app.KV.get('xom', 'k')") is None and pg.evaluate("window.__app.KV.get('trips', 'index')") is not None, 'cache only'
        pg.evaluate('window.__eraseNoReload = true')
        pg.click('#eraseAll'); pg.wait_for_timeout(250)
        print(name, 'erase asks:', pg.inner_text('#cfm').replace('\n', ' | ')); pg.screenshot(path=f'{OUT}/{name}-b6-erase.png')
        assert pg.evaluate('!window.__erased') and pg.locator('#cfm').count() == 1
        pg.click('#cfmNo'); pg.wait_for_timeout(250); assert pg.evaluate('!window.__erased'), 'Cancel erases nothing'
        # confirmations off (Settings → General): erase falls back to its two taps
        pg.evaluate("document.querySelector('input[data-k=confirmDeletes]').click(); window.__app.S.confirmDeletes = false")
        pg.click('#eraseAll'); pg.wait_for_timeout(150)
        assert pg.evaluate('!window.__erased') and pg.locator('#cfm').count() == 0 and 'again' in pg.inner_text('#eraseAll'), 'first tap only asks'
        pg.click('#eraseAll'); pg.wait_for_timeout(150)
        assert pg.evaluate('window.__erased') and pg.evaluate("window.__app.KV.get('trips', 'index')") is None, 'erased'
        pg.evaluate('window.__eraseNoReload = false; window.__erased = false')
        pg.click('#sDone'); pg.wait_for_timeout(300)
        # diesel at a CITGO: not counted, unless you take the risk
        pg.evaluate("window.__app.S.grade = 'diesel'; window.__app.S.blacklist = []")
        pg.evaluate("document.querySelector('#grades [data-g=\"diesel\"]') && document.querySelector('#grades [data-g=\"diesel\"]').click()"); pg.wait_for_timeout(300)
        opened = pg.evaluate("(() => { const r = [...document.querySelectorAll('#rows .row')].find(x => /CITGO/.test(x.innerText)); if (!r) return false; r.click(); return true; })()")
        pg.wait_for_timeout(400)
        if opened and pg.locator('#dBlRisk').count():
            assert not wplus(pg), 'diesel: not counted by default'
            pg.check('#dBlRisk'); pg.wait_for_timeout(300)
            assert wplus(pg), 'diesel: counted at your own risk'
            pg.screenshot(path=f'{OUT}/{name}-b6-diesel.png')
            print(name, 'diesel own-risk ok')
        else:
            print(name, 'no CITGO diesel price in demo data; diesel checked in unit tests')
        pg.close()
    b.close()
print('JS errors:', errors or 'none')
