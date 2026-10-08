"""Rural stretch: no priced station in reach, so a station with no posted price is planned in at an estimate."""
import sys, os
from playwright.sync_api import sync_playwright
import fastwait  # noqa: F401  (waits end once the page settles; SLOW_WAITS=1 for fixed sleeps)
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
URL = 'file://' + os.path.join(ROOT, 'assets', 'web', 'index.html')
MOCKS = open(os.path.join(ROOT, 'tests', 'trip_mocks.js')).read()
LINK = ('https://www.google.com/maps/dir/North+Little+Rock,+AR+72114/Dallas,+TX/@34,-94,7z/data=!4m19!4m18!1m5!1m1!1s0x1:0x2!2m2!1d-92.2671!2d34.7695'
        '!1m5!1m1!1s0x3:0x4!2m2!1d-96.797!2d32.7767!2m3!1b0!2b1!3b0!3e0!5i1')
errors = []
def idle(pg, t=900):
    pg.wait_for_timeout(t); pg.wait_for_function("!window.__trip.state().busy", timeout=20000); pg.wait_for_timeout(300)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME', '/opt/google/chrome/chrome'), args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 412, 'height': 915}, device_scale_factor=2.6, is_mobile=True, has_touch=True)
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(URL); pg.evaluate('setInsets(44, 24, 0, 0)'); pg.wait_for_timeout(400)
    pg.fill('#apiKey', 'AIzaSyTESTKEY0123456789abcdefghijklmnop'); pg.click('#sDone'); pg.wait_for_timeout(500)
    pg.evaluate(MOCKS)
    # every Google station without a price except the ones past mile 150; no Walmart / Murphy
    pg.evaluate('''(() => { const al = window.__mocks.along; window.__mocks.along = (jobs) => { const r = al(jobs); r.results.forEach(x => x.places.forEach(pl => { if (+pl.id.replace(/\\D/g, '') < 150) pl.fuelOptions = { fuelPrices: [] }; })); return r; };
      window.__siteMock = () => ({ stores: [], nodes: [] }); })(); 0''')
    pg.click('#btnTrip'); pg.wait_for_timeout(400); pg.click('#tNext'); pg.wait_for_timeout(500)
    pg.fill('#tLink', LINK); pg.wait_for_timeout(800)
    pg.click('#tGetRoutes'); idle(pg)
    pg.click('#tNext'); pg.wait_for_timeout(400)
    pg.fill('#tMiles', '70'); pg.fill('#tBuffer', '20')
    pg.click('#tNext'); idle(pg, 1500)
    st = pg.evaluate("(() => { const r = window.__trip.state().result; return { ok: r.plan.ok, est: r.estUsed, stops: r.plan.stops.map(s => [s.c.station.name, Math.round(s.c.d), s.c.price, !!s.c.est]) }; })()")
    print('plan:', st)
    assert st['ok'] and st['est'] >= 1 and any(s[3] for s in st['stops']), st
    pg.click('#tNext'); idle(pg, 600)   # Adjustments -> Stops
    w = pg.inner_text('.warns.pre'); print('warning:', w.replace('\n', ' | ')); assert 'no posted price' in w
    pg.click('#tsStopsH'); pg.wait_for_timeout(300)
    assert pg.locator('.stop .est-tag').count() >= 1
    pg.screenshot(path=f'{OUT}/est-stops.png')
    b.close()
print('JS errors:', errors or 'none')
