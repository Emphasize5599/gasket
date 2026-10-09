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
        pg.click('#advList summary'); pg.wait_for_timeout(150)
        assert 'The car may lose drive power.' in ft(pg, '#advList') and 'Software update.' in ft(pg, '#advList')
        assert not dot(pg), 'nothing to act on without a VIN'
        # a hybrid isn't told to turn off engine stop: that's how a hybrid drives
        pg.evaluate("() => { const c = window.Garage.car(); c.info = Object.assign({}, c.info, { features: (c.info && c.info.features || []).concat(['Start-stop']) }); window.dispatchEvent(new Event('garagechange')); }")
        pg.wait_for_timeout(200)
        assert 'Nothing to change' in ft(pg, '#tAdvisory') and pg.locator('[data-adv]').count() == 0, 'no start-stop advice for a hybrid'
        # ---- with a VIN: check at NHTSA (the page is shown; the app reads the answer) ----
        pg.evaluate("(v) => { window.Garage.car().vin = v; window.dispatchEvent(new Event('garagechange')); }", VIN); pg.wait_for_timeout(200)
        assert pg.locator('#advCheck').count() == 1 and 'Check my car at NHTSA' in ft(pg, '#advCheck') and dot(pg), 'VIN: check it (dot on the step)'
        pg.evaluate('''() => { window.__mocks.siteShow = (key, args) => ({ open: 1, campaigns: ['22V200000'], items: ['22V200000 POWER TRAIN The car may lose drive power.'] }); }''')
        pg.click('#advCheck'); pg.wait_for_timeout(400)
        shown = pg.evaluate('window.__siteShown'); print('  opened:', shown)
        assert shown['key'] == 'nhtsa' and shown['url'] == 'https://www.nhtsa.gov/recalls?vymm=' + VIN
        rc = ft(pg, '#advRecall'); print('  1 open:', rc.replace('\n', ' | ')[:220])
        assert '1 open recall on your car' in rc and 'for free' in rc and 'The car may lose drive power.' in rc and 'A sensor may fail.' not in rc
        assert pg.locator('#advRecall.warn').count() == 1 and dot(pg)
        assert 'open safety recall' in pg.evaluate('window.Advisory.departureNote()'), 'Departure mentions it'
        pg.screenshot(path=f'{OUT}/{name}-a1-open.png')
        # fixed: checked again, none open
        pg.evaluate("() => { window.__mocks.siteShow = () => ({ open: 0, campaigns: [], items: [] }); }")
        pg.click('#advCheck'); pg.wait_for_timeout(400)
        rc = ft(pg, '#advRecall'); assert 'No open recalls on your car' in rc and pg.locator('#advRecall.ok').count() == 1 and not dot(pg), rc
        assert pg.evaluate('window.Advisory.departureNote()') == ''
        # months later: worth checking again (dot)
        pg.evaluate("() => { window.Garage.car().recallCheck.t = Date.now() - 100 * 864e5; window.dispatchEvent(new Event('garagechange')); }"); pg.wait_for_timeout(200)
        assert "worth checking again" in ft(pg, '#advRecall') and dot(pg)
        # closed before NHTSA answered: nothing recorded; an error is shown, nothing recorded
        t0 = pg.evaluate('window.Garage.car().recallCheck.t')
        pg.evaluate("() => { window.__mocks.siteShow = () => ({ closed: true }); }"); pg.click('#advCheck'); pg.wait_for_timeout(300)
        assert pg.evaluate('window.Garage.car().recallCheck.t') == t0
        pg.evaluate("() => { window.__mocks.siteShow = () => ({ error: 'NHTSA couldn\\'t check that VIN right now.' }); }"); pg.click('#advCheck'); pg.wait_for_timeout(300)
        assert "couldn't check" in pg.inner_text('#toast') and pg.evaluate('window.Garage.car().recallCheck.t') == t0
        # a new VIN: the old check doesn't count
        pg.evaluate("() => { window.Garage.car().vin = 'JTDEBRBE0LJ000002'; window.dispatchEvent(new Event('garagechange')); }"); pg.wait_for_timeout(200)
        assert 'Check my car at NHTSA' in ft(pg, '#advCheck')
        # ---- the VIN is checked by itself in the background (siteRead), at most weekly ----
        pg.evaluate('''() => { window.__siteRead = []; window.__mocks.siteRead = (key, args) => ({ open: 1, campaigns: ['22V200000'], items: [] }); }''')
        pg.evaluate("() => { window.Garage.car().vin = 'JTDEBRBE0LJ000003'; window.dispatchEvent(new Event('garagechange')); }")
        pg.wait_for_function("window.Garage.car().recallCheck && window.Garage.car().recallCheck.vin === 'JTDEBRBE0LJ000003'", timeout=5000); pg.wait_for_timeout(200)
        reads = pg.evaluate('window.__siteRead'); print('  automatic:', reads)
        assert len(reads) == 1 and reads[0]['key'] == 'nhtsa' and reads[0]['url'].endswith('vymm=JTDEBRBE0LJ000003')
        assert '1 open recall on your car' in ft(pg, '#advRecall'), 'read without a tap'
        pg.evaluate("() => window.dispatchEvent(new Event('garagechange'))"); pg.wait_for_timeout(300)
        assert len(pg.evaluate('window.__siteRead')) == 1, 'not again within a week'
        # no answer (a blocked page): said in one line, and the button opens the page
        pg.evaluate('''() => { window.__siteRead = []; window.__mocks.siteRead = () => ({ blocked: true }); window.Garage.car().vin = 'JTDEBRBE0LJ000004'; window.dispatchEvent(new Event('garagechange')); }''')
        pg.wait_for_function("window.Garage.car().recallAuto && window.Garage.car().recallAuto.failed", timeout=5000); pg.wait_for_timeout(200)
        assert "didn't answer the automatic check" in ft(pg, '#advRecall') and 'Check my car at NHTSA' in ft(pg, '#advCheck')
        pg.evaluate("() => window.dispatchEvent(new Event('garagechange'))"); pg.wait_for_timeout(300)
        assert len(pg.evaluate('window.__siteRead')) == 1, 'a failed try waits a few hours'
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
