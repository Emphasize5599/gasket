"""Advisory (trip step 2): recalls on record, the VIN check read from NHTSA's page (shown to the user), the step's dot,
engine-friendly advice (cylinder shut-off, engine stop at red lights; not for hybrids), and the NHTSA page reader itself."""
import sys, os, json, time
from playwright.sync_api import sync_playwright
import fastwait  # noqa: F401  (waits end once the page settles; SLOW_WAITS=1 for fixed sleeps)

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
URL = 'file://' + os.path.join(ROOT, 'assets', 'web', 'index.html')
MOCKS = open(os.path.join(ROOT, 'tests', 'trip_mocks.js')).read()
READER = open(os.path.join(ROOT, 'assets', 'nhtsa_worker.js')).read()
VIN = 'JTDEBRBE0LJ000001'   # made up
EXTRA = r'''() => {
  const M = window.__mocks;
  M.recalls = (url) => /corolla/i.test(url) ? { Count: 2, results: [
      { NHTSACampaignNumber: '21V100000', ReportReceivedDate: '01/02/2021', Component: 'ELECTRICAL SYSTEM', Summary: 'A sensor may fail.', Consequence: 'A warning light may come on.', Remedy: 'Dealers will replace the sensor.' },
      { NHTSACampaignNumber: '22V200000', ReportReceivedDate: '05/06/2022', Component: 'POWER TRAIN', Summary: 'The car may lose drive power.', Consequence: 'A crash risk at speed.', Remedy: 'Software update.', parkIt: false }] }
    : { Count: 0, results: [] };
}'''
errors = []
def ft(pg, sel): return pg.evaluate("(s) => { const e = document.querySelector(s); if (!e) throw new Error('no ' + s); return e.innerText; }", sel)
def idle(pg, t=600):
    pg.wait_for_timeout(t); pg.wait_for_function("!window.__trip.state().busy", timeout=20000); pg.wait_for_timeout(150)
def nxt(pg, t=500): pg.click('#tNext'); idle(pg, t)
def step(pg): return pg.evaluate('window.__trip.state().step')
def dot(pg): return pg.locator('#tpSteps [data-step="2"].attn').count() == 1
OVER = '''() => { const W = innerWidth, out = []; document.querySelectorAll('body *').forEach(e => { if (e.closest('.leaflet-container')) return;
  const r = e.getBoundingClientRect(); if (r.width && (e.offsetParent || getComputedStyle(e).position === 'fixed') && (r.right > W + 0.5 || r.left < -0.5)) out.push((e.id || e.className) + ' ' + Math.round(r.left) + '..' + Math.round(r.right)); });
  return out.slice(0, 8); }'''
BIG = '''() => { document.querySelectorAll('#tAdvisory *').forEach(e => { if (!e.dataset.big) { e.style.fontSize = (parseFloat(getComputedStyle(e).fontSize) * 1.3) + 'px'; e.dataset.big = 1; } }); }'''

def reader(pg, html, wait_ms=1500):
    """Run the NHTSA page reader on a stand-in page; -> what it reported, or None if it's still waiting."""
    pg.set_content(html)
    pg.evaluate('''(src) => { window.__got = null; window.GasketSite = { result: (id, j) => { window.__got = JSON.parse(j); } }; (0, eval)('(' + src + ')')(1, {}); }''', READER)
    pg.wait_for_timeout(wait_ms)
    return pg.evaluate('window.__got')

FAQ = '''<h2>What will the license plate and VIN search show?</h2><p>If the vehicle has no unrepaired recalls, you will see the message: "0 unrepaired recalls associated with this VIN."</p>
<h2>Where's my VIN?</h2><p>Look on the lower left of your car's windshield.</p>'''

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME', '/opt/google/chrome/chrome'), args=['--no-sandbox'])
    for name, w, h, scheme in fastwait.viewports([('pixel10pro', 412, 915, 'dark'), ('narrow', 320, 800, 'light')]):
        pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=2.6, color_scheme=scheme, is_mobile=True, has_touch=True)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(URL); pg.evaluate('setInsets(44, 24, 0, 0)'); pg.wait_for_timeout(400)
        pg.fill('#apiKey', 'AIzaSyTESTKEY0123456789abcdefghijklmnop'); pg.click('#sDone'); pg.wait_for_timeout(400)
        pg.evaluate(MOCKS); pg.evaluate(EXTRA)
        pg.click('#btnTrip'); pg.wait_for_timeout(400)
        if pg.locator('#tpNew').count(): pg.click('#tpNew'); pg.wait_for_timeout(300)
        assert step(pg) == 1
        steps = pg.evaluate("[...document.querySelectorAll('#tpSteps [data-step] .lf')].map(e => e.textContent)")
        assert steps == ['Garage', 'Advisory', 'Route', 'Parameters', 'Adjustments', 'Stops', 'Departure'], steps
        nxt(pg); assert step(pg) == 2, 'Garage -> Advisory'
        car = pg.evaluate('window.Garage.car()'); print(' ', name, 'car:', car['year'], car['make'], car['model'], car.get('power'))
        # ---- no VIN: the recalls on record for the model, and how to check yours ----
        rc = ft(pg, '#advRecall'); print('  recalls, no VIN:', rc.replace('\n', ' | ')[:200])
        assert '2 recalls on record' in rc and 'Add your VIN' in rc and 'Corolla' in rc
        assert pg.evaluate("Object.keys(((window.__app.S.recallSev || {}).r) || {}).length") == 0, 'no VIN check: nothing rated until you open the list'
        pg.click('#advList summary'); pg.wait_for_timeout(150)
        assert pg.evaluate("Object.keys(((window.__app.S.recallSev || {}).r) || {}).length") == 2, 'opened: rated'
        # a tile each, most serious first: how serious (and why), the part, one line; tap for the sections
        tiles = pg.locator('#advList .rc-tile')
        assert tiles.count() == 2 and 'sev3' in tiles.nth(0).get_attribute('class') and 'Power train' in tiles.nth(0).inner_text() and 'Serious' in tiles.nth(0).inner_text(), tiles.nth(0).inner_text()
        assert 'sev1' in tiles.nth(1).get_attribute('class') and 'Minor' in tiles.nth(1).inner_text()
        assert 'Software update.' not in ft(pg, '#advList'), 'details stay folded until you tap'
        tiles.nth(0).locator('summary').first.click(); pg.wait_for_timeout(150)
        t0 = tiles.nth(0).inner_text(); print('  tile:', t0.replace('\n', ' | '))
        assert 'Rated serious by the small AI model' in t0 and all(x in t0 for x in ["What's wrong", 'The risk', 'The fix', 'When it began'])
        tiles.nth(0).locator('.rc-sec:has-text("The fix") summary').click(); pg.wait_for_timeout(150); tiles.nth(0).locator('.rc-sec:has-text("When it began") summary').click()
        pg.wait_for_function("(() => { const t = document.querySelector('#advList .rc-tile'); return t && t.innerText.includes('Software update.') && t.innerText.includes('22V200000'); })()", timeout=3000)
        t0 = pg.evaluate("document.querySelector('#advList .rc-tile').innerText"); assert 'Software update.' in t0 and 'Jun 5, 2022' in t0 and '22V200000' in t0, t0
        pg.screenshot(path=f'{OUT}/{name}-a0-tiles.png', full_page=True)
        # not rated yet: "Rating…" and a bar along the bottom of each tile (the model's progress)
        pg.evaluate("() => { window.__rate0 = Severity.rate; Severity.rate = () => {}; window.__sev0 = window.__app.S.recallSev; window.__app.S.recallSev = null; window.dispatchEvent(new Event('garagechange')); }")
        pg.wait_for_timeout(150)
        assert pg.locator('#advList .rc-tile .rc-bar').count() == 2 and 'Rating' in tiles.nth(0).inner_text(), 'a progress bar on each tile being rated'
        pg.screenshot(path=f'{OUT}/{name}-a0b-rating.png')
        pg.evaluate("() => { Severity.rate = window.__rate0; window.__app.S.recallSev = window.__sev0; window.dispatchEvent(new Event('garagechange')); }")
        pg.wait_for_timeout(150)
        assert pg.locator('#advList .rc-bar').count() == 0
        # recalls and their ratings are cache (Android's "Clear cache" empties them), not settings
        sp = pg.evaluate("(() => { window.__app.save(); const N = window.__app.N; return [N.loadSettings(), N.kvGet('lookups', 'cars')]; })()")
        assert '"recalls"' not in sp[0] and '"recallSev"' not in sp[0] and '"recalls"' in sp[1] and '*sev' in sp[1], 'lookups saved apart from the settings'
        assert pg.evaluate("window.Garage.car().recalls != null"), 'still there while the app runs'
        assert not dot(pg), 'nothing to act on without a VIN'
        # a hybrid isn't told to turn off engine stop: that's how a hybrid drives
        pg.evaluate("() => { const c = window.Garage.car(); c.info = Object.assign({}, c.info, { features: (c.info && c.info.features || []).concat(['Start-stop']) }); window.dispatchEvent(new Event('garagechange')); }")
        pg.wait_for_timeout(200)
        assert 'Nothing to change' in ft(pg, '#tAdvisory') and pg.locator('[data-adv]').count() == 0, 'no start-stop advice for a hybrid'
        # ---- with a VIN: check at NHTSA (the page is shown; the app reads the answer) ----
        pg.evaluate("(v) => { window.Garage.car().vin = v; window.dispatchEvent(new Event('garagechange')); }", VIN); pg.wait_for_timeout(200)
        assert pg.locator('#advCheck').count() == 1 and 'Check my car at NHTSA' in ft(pg, '#advCheck') and dot(pg), 'the background check got no answer here: the page, shown to you (dot on the step)'
        # closed before NHTSA answered: nothing recorded; an error is shown, nothing recorded
        pg.evaluate("() => { window.__mocks.siteShow = () => ({ closed: true }); }"); pg.click('#advCheck'); pg.wait_for_timeout(300)
        assert not pg.evaluate('window.Garage.car().recallCheck')
        pg.evaluate("() => { window.__mocks.siteShow = () => ({ error: 'NHTSA couldn\\'t check that VIN right now.' }); }"); pg.click('#advCheck'); pg.wait_for_timeout(300)
        assert "couldn't check" in pg.inner_text('#toast') and not pg.evaluate('window.Garage.car().recallCheck')
        pg.evaluate('''() => { window.__mocks.siteShow = (key, args) => ({ open: 1, campaigns: ['22V200000'], items: ['22V200000 POWER TRAIN The car may lose drive power.'] }); }''')
        pg.click('#advCheck'); pg.wait_for_timeout(400)
        shown = pg.evaluate('window.__siteShown'); print('  opened:', shown)
        assert shown['key'] == 'nhtsa' and shown['url'] == 'https://www.nhtsa.gov/recalls?vymm=' + VIN
        rc = ft(pg, '#advRecall'); print('  1 open:', rc.replace('\n', ' | ')[:220])
        assert '1 open recall on your car' in rc and 'for free' in rc and 'Power train' in rc and 'Serious' in rc
        # the open one is outside the folded list; the other recall on record is inside it ("1 more on record")
        assert pg.locator('#advRecall > .rc-tile').count() == 1 and 'Power train' in ft(pg, '#advRecall > .rc-tile')
        assert pg.locator('#advList .rc-tile').count() == 1 and 'Electrical' in pg.inner_html('#advList') and '1 more on record' in ft(pg, '#advList summary')
        assert pg.locator('#advRecall.warn').count() == 1 and dot(pg)
        assert pg.locator('#advCheck').count() == 0, 'checked: no button, it checks again by itself'
        assert 'open safety recall' in pg.evaluate('window.Advisory.departureNote()'), 'Departure mentions it'
        pg.screenshot(path=f'{OUT}/{name}-a1-open.png')
        # fixed: a week later the background check runs again and finds none open
        pg.evaluate("() => { window.__mocks.siteRead = () => ({ open: 0, campaigns: [], items: [] }); const c = window.Garage.car(); c.recallCheck.t = Date.now() - 8 * 864e5; c.recallAuto = null; window.dispatchEvent(new Event('garagechange')); }")
        pg.wait_for_function("window.Garage.car().recallCheck.open === 0", timeout=5000); pg.wait_for_timeout(200)
        rc = ft(pg, '#advRecall'); assert 'No open recalls on your car' in rc and 'every week' in rc and pg.locator('#advRecall.ok').count() == 1 and not dot(pg) and pg.locator('#advCheck').count() == 0, rc
        assert pg.evaluate('window.Advisory.departureNote()') == ''
        # a new VIN: the old check doesn't count; the new one is checked in the background, no button
        pg.evaluate("() => { window.Garage.car().vin = 'JTDEBRBE0LJ000002'; window.dispatchEvent(new Event('garagechange')); }")
        pg.wait_for_function("window.Garage.car().recallCheck.vin === 'JTDEBRBE0LJ000002'", timeout=5000); pg.wait_for_timeout(200)
        assert pg.locator('#advCheck').count() == 0 and 'No open recalls on your car' in ft(pg, '#advRecall')
        # ---- the VIN is checked by itself in the background (siteRead), at most weekly ----
        pg.evaluate('''() => { window.__siteRead = []; window.__mocks.siteRead = (key, args) => ({ open: 1, campaigns: ['22V200000'], items: [] }); }''')
        pg.evaluate("() => { window.Garage.car().vin = 'JTDEBRBE0LJ000003'; window.dispatchEvent(new Event('garagechange')); }")
        pg.wait_for_function("window.Garage.car().recallCheck && window.Garage.car().recallCheck.vin === 'JTDEBRBE0LJ000003'", timeout=5000); pg.wait_for_timeout(200)
        reads = pg.evaluate('window.__siteRead'); print('  automatic:', reads)
        assert len(reads) == 1 and reads[0]['key'] == 'nhtsa' and reads[0]['url'].endswith('vymm=JTDEBRBE0LJ000003')
        assert '1 open recall on your car' in ft(pg, '#advRecall'), 'read without a tap'
        pg.evaluate("() => window.dispatchEvent(new Event('garagechange'))"); pg.wait_for_timeout(300)
        assert len(pg.evaluate('window.__siteRead')) == 1, 'not again within a week'
        # a try that never finished (the app was closed while it ran) doesn't hold the next one back
        pg.evaluate('''() => { window.__siteRead = []; const c = window.Garage.car(); c.recallCheck = null; c.recallAuto = { vin: c.vin, t: Date.now() - 60000 }; window.dispatchEvent(new Event('garagechange')); }''')
        pg.wait_for_function("window.Garage.car().recallCheck && window.Garage.car().recallCheck.vin === window.Garage.car().vin", timeout=5000)
        assert len(pg.evaluate('window.__siteRead')) == 1, 'an unfinished try is run again'
        # no answer (a blocked page): said in one line, and the button opens the page
        pg.evaluate('''() => { window.__siteRead = []; window.__mocks.siteRead = () => ({ blocked: true }); window.Garage.car().vin = 'JTDEBRBE0LJ000004'; window.dispatchEvent(new Event('garagechange')); }''')
        pg.wait_for_function("window.Garage.car().recallAuto && window.Garage.car().recallAuto.failed", timeout=5000); pg.wait_for_timeout(200)
        assert "didn't answer the automatic check" in ft(pg, '#advRecall') and 'Check my car at NHTSA' in ft(pg, '#advCheck')
        pg.evaluate("() => window.dispatchEvent(new Event('garagechange'))"); pg.wait_for_timeout(300)
        assert len(pg.evaluate('window.__siteRead')) == 1, 'a failed try waits half an hour'
        # ---- engine-friendly advice on a car with both features ----
        pg.evaluate('''() => { const S = window.__app.S, c = S.cars.find(x => x.id === 'venza12'); S.carId = c.id;
          c.info = Object.assign({}, c.info, { features: (c.info.features || []).concat(['Cylinder deactivation', 'Start-stop']) }); window.dispatchEvent(new Event('garagechange')); }''')
        pg.wait_for_timeout(300)
        ad = ft(pg, '#tAdvisory'); print('  advice:', ad.replace('\n', ' | ')[:300])
        assert 'Cylinder shut-off' in ad and 'Engine stop at red lights' in ad and pg.locator('[data-adv]').count() == 4 and dot(pg)
        for acr in ['AFM', 'MDS', 'VCM', 'OBD', 'DOHC', 'VIN check']:
            assert acr not in ad.replace('(?)', ''), 'plain language: ' + acr
        pg.click('[data-adv="0"][data-v="off"]'); pg.wait_for_timeout(150); pg.click('[data-adv="1"][data-v="keep"]'); pg.wait_for_timeout(150)
        ad = ft(pg, '#tAdvisory'); assert 'Turned off' in ad and 'Kept on' in ad and not dot(pg), ad
        assert pg.evaluate("window.Garage.car().advice") == {'Cylinder deactivation': 'off', 'Start-stop': 'keep'}
        pg.click('[data-adv="0"][data-v=""]'); pg.wait_for_timeout(150)
        assert pg.locator('[data-adv="0"][data-v="off"]').count() == 1 and dot(pg), 'Change brings the choice back'
        # (?) explains in full, technical names included
        pg.click('.adv-item .qi'); pg.wait_for_timeout(200)
        assert 'Active Fuel Management' in pg.inner_text('body'), 'the (?) names the brand terms'
        pg.keyboard.press('Escape') if pg.locator('.pop').count() else None
        pg.screenshot(path=f'{OUT}/{name}-a2-advice.png', full_page=True)
        # no sideways scrolling, also at 130% text
        o = pg.evaluate(OVER); pg.evaluate(BIG); pg.wait_for_timeout(100); o += pg.evaluate(OVER)
        assert not o, 'sideways: ' + str(o)
        pg.close()
    # ---- the NHTSA page reader (stand-in pages) ----
    pg = b.new_page()
    r = reader(pg, FAQ, 1200)
    assert r is None, 'the help text\'s quoted "0 unrepaired recalls" is not an answer: ' + str(r)
    r = reader(pg, '<div><h1>2020 TOYOTA COROLLA HYBRID</h1><p>0 Unrepaired Recalls associated with this VIN</p></div>' + FAQ)
    assert r == {'open': 0, 'campaigns': [], 'items': []}, r
    r = reader(pg, '<div><h1>2020 TOYOTA COROLLA HYBRID</h1><p>2 Unrepaired Recalls Associated with this VIN</p><div>NHTSA Campaign Number: 22V200000 Power train: may lose drive power</div>'
                   '<div>NHTSA Campaign Number: 23V300000 Air bags: may not deploy</div></div>' + FAQ)
    print('  reader:', r)
    assert r['open'] == 2 and r['campaigns'] == ['22V200000', '23V300000'] and 'drive power' in r['items'][0]
    # the page as it really reads (the number and the words are separate elements, so the text runs together)
    r = reader(pg, '<div><p>2016 TOYOTA PRIUS</p><p>VIN: JTDEBRBE0LJ000001</p><p>Recall data refreshed on Oct 09, 2026</p><div><span>0</span><span>Unrepaired Recalls</span></div><p>associated with this VIN</p></div>' + FAQ)
    assert r == {'open': 0, 'campaigns': [], 'items': []}, r
    r = reader(pg, '<div><p>Recall data refreshed on Oct 09, 2026</p><b>2</b>Unrepaired Recalls<p>associated with this VIN</p><div>NHTSA Campaign Number: 22V200000</div></div>' + FAQ)
    assert r['open'] == 2 and r['campaigns'] == ['22V200000'], r
    # today's wording: "N Unrepaired Recalls Found", with the recalls listed under it
    r = reader(pg, '<div><p>VIN Lookup: 17/17</p><h2>0 Unrepaired Recalls Found</h2></div>' + FAQ)
    assert r == {'open': 0, 'campaigns': [], 'items': []}, r
    r = reader(pg, '<div><h2>1 Unrepaired Recall Found</h2><div>NHTSA Campaign Number: 22V200000 Power train: may lose drive power</div></div>' + FAQ)
    assert r['open'] == 1 and r['campaigns'] == ['22V200000'], r
    r = reader(pg, '<p>An unknown error occurred.</p>' + FAQ)
    assert r and 'error' in r and "couldn't check" in r['error'], r
    # the answer can arrive later (the page fetches it): the reader waits for it
    pg.set_content(FAQ)
    pg.evaluate('''(src) => { window.__got = null; window.GasketSite = { result: (id, j) => { window.__got = JSON.parse(j); } }; (0, eval)('(' + src + ')')(1, {});
      setTimeout(() => { const d = document.createElement('p'); d.textContent = '1 Unrepaired Recall Associated with this VIN'; document.body.prepend(d); }, 1000); }''', READER)
    pg.wait_for_timeout(2500)
    assert pg.evaluate('window.__got') == {'open': 1, 'campaigns': [], 'items': []}, pg.evaluate('window.__got')
    pg.close()
    b.close()
print('JS errors:', errors or 'none')
assert not errors
print('advisory tests passed')
