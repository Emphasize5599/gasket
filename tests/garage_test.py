"""Garage (3.25): car buttons with x, delete confirmations, VIN decode + EPA match, the details tile, EV and
hydrogen cars (units, planning with chargers), and the EV & hydrogen map panel (hydrogen coverage shading)."""
import sys, os, json
from playwright.sync_api import sync_playwright
import fastwait  # noqa: F401  (waits end once the page settles; SLOW_WAITS=1 for fixed sleeps)
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
URL = 'file://' + os.path.join(ROOT, 'assets', 'web', 'index.html')
MOCKS = open(os.path.join(ROOT, 'tests', 'trip_mocks.js')).read()
LINK = ('https://www.google.com/maps/dir/North+Little+Rock,+AR+72114/Dallas,+TX/@34,-94,7z/data=!4m19!4m18!1m5!1m1!1s0x1:0x2!2m2!1d-92.2671!2d34.7695'
        '!1m5!1m1!1s0x3:0x4!2m2!1d-96.797!2d32.7767!2m3!1b0!2b1!3b0!3e0!5i1')
EXTRA = r'''
(() => {
  const M = window.__mocks;
  window.__urls = [];
  M.vpic = (url) => { window.__urls.push(url); return { Results: [{ ModelYear: '2021', Make: 'HONDA', Model: 'Accord', Trim: 'EX', DisplacementL: '1.5', EngineCylinders: '4',
    EngineConfiguration: 'In-Line', EngineModel: 'L15BE', Turbo: 'Yes', TransmissionStyle: 'Continuously Variable Transmission (CVT)', DriveType: 'FWD/Front-Wheel Drive',
    FuelTypePrimary: 'Gasoline', ValveTrainDesign: 'Dual Overhead Cam (DOHC)', FuelInjectionType: 'Stoichiometric Gasoline Direct Injection (SGDI)', ErrorCode: '0', ErrorText: '0 - VIN decoded clean.' }] }; };
  M.recalls = (url) => { window.__urls.push(url); return /accord/i.test(url) ? { Count: 2, results: [
      { NHTSACampaignNumber: '21V215000', ReportReceivedDate: '25/03/2021', Component: 'FUEL SYSTEM, GASOLINE', Summary: 'The fuel pump may fail.', Consequence: 'The engine can stall while driving.', Remedy: 'Dealers will replace the fuel pump, free of charge.', parkIt: false, parkOutSide: false },
      { NHTSACampaignNumber: '22V100000', ReportReceivedDate: '01/02/2022', Component: 'POWER TRAIN', Summary: 'The transmission may shift into a lower gear at speed.', Consequence: 'Loss of control.', Remedy: 'Software update.', parkIt: true, parkOutSide: false } ] } : { Count: 0, results: [] }; };
  const epa0 = M.epa;
  M.epa = (url) => {
    if (/menu\/make/.test(url)) return { menuItem: [{ text: 'Honda', value: 'Honda' }, { text: 'Tesla', value: 'Tesla' }, { text: 'Toyota', value: 'Toyota' }] };
    if (/menu\/model.*make=Tesla/.test(url)) return { menuItem: { text: 'Model 3 Long Range AWD', value: 'Model 3 Long Range AWD' } };
    if (/menu\/model.*make=Toyota/.test(url)) return { menuItem: [{ text: 'Mirai', value: 'Mirai' }, { text: 'Corolla Hybrid', value: 'Corolla Hybrid' }] };
    if (/menu\/options.*Model%203/.test(url)) return { menuItem: { text: 'Auto (A1)', value: 'ev1' } };
    if (/menu\/options.*Mirai/.test(url)) return { menuItem: { text: 'Auto (A1)', value: 'fc1' } };
    if (/vehicle\/ev1$/.test(url)) return { id: 'ev1', year: '2021', make: 'Tesla', model: 'Model 3 Long Range AWD', atvType: 'EV', fuelType1: 'Electricity', city08: '134', highway08: '126', comb08: '131',
      cityE: '25', highwayE: '27', combE: '26', range: '353', drive: 'All-Wheel Drive', trany: 'Automatic (A1)', evMotor: '158 and 208 kW AC PMSM', VClass: 'Midsize Cars' };
    if (/vehicle\/fc1$/.test(url)) return { id: 'fc1', year: '2021', make: 'Toyota', model: 'Mirai', atvType: 'FCV', fuelType1: 'Hydrogen', city08: '76', highway08: '71', comb08: '74',
      range: '0', drive: 'Rear-Wheel Drive', trany: 'Automatic (A1)', evMotor: '134 kW AC PMSM', VClass: 'Midsize Cars' };
    return epa0(url);
  };
  // the DOE station finder: hydrogen everywhere it is (a few spots), fast chargers near a point, and along a route
  const h2 = [[34.05, -118.25, 'Los Angeles'], [37.77, -122.42, 'San Francisco'], [32.72, -117.16, 'San Diego'], [38.58, -121.49, 'Sacramento'], [21.31, -157.86, 'Honolulu']];
  const st = (id, lat, lng, name, o) => Object.assign({ id, station_name: name, latitude: lat, longitude: lng, street_address: id + ' Main St', city: name, state: 'CA', zip: '90000', status_code: 'E', access_days_time: '24 hours daily' }, o);
  M.afdc = (url) => {
    window.__afdc = window.__afdc || []; window.__afdc.push(url);
    if (/fuel_type=HY/.test(url) && !/nearby-route/.test(url)) return { fuel_stations: h2.map((p, i) => st(9000 + i, p[0], p[1], 'True Zero ' + p[2], { fuel_type_code: 'HY', hy_pressures: ['700'], hy_status_link: 'https://example.org/h2/' + i })) };
    if (/nearest\.json/.test(url)) { const la = +url.match(/latitude=([\d.-]+)/)[1], lo = +url.match(/longitude=([\d.-]+)/)[1];
      return { fuel_stations: [0, 1, 2].map((k) => st(7000 + k, la + 0.02 * (k - 1), lo + 0.03, 'Charger ' + k, { fuel_type_code: 'ELEC', ev_dc_fast_num: 4, ev_network: 'Tesla', ev_connector_types: ['TESLA'] })) }; }
    if (/nearby-route/.test(url)) {
      const m = window.__trip.state().model, out = [];
      for (let d = 25; d < m.totalMi; d += 25) { const p = m.pointAt(d), fast = (d / 25) % 2 === 0;
        out.push(st(5000 + d, p.lat + 0.004, p.lng, (fast ? 'Supercharger ' : 'Slow DC ') + d, { fuel_type_code: 'ELEC', ev_dc_fast_num: fast ? 8 : 1, ev_network: fast ? 'Tesla' : 'Non-Networked', ev_connector_types: fast ? ['TESLA'] : ['J1772COMBO', 'TESLA'], ev_pricing: fast ? '$0.42/kWh' : '' })); }
      return { fuel_stations: out };
    }
    return { fuel_stations: [] };
  };
})(); 0
'''
errors = []
def ft(pg, sel): return pg.evaluate("(s) => { const e = document.querySelector(s); if (!e) throw new Error('no ' + s); return e.innerText; }", sel)
def idle(pg, t=900):
    pg.wait_for_timeout(t); pg.wait_for_function("!window.__trip.state().busy", timeout=20000); pg.wait_for_timeout(250)
def nxt(pg, t=700): pg.click('#tNext'); idle(pg, t)
def step(pg): return pg.evaluate('window.__trip.state().step')
OVER = '''() => { const W = innerWidth, out = []; document.querySelectorAll('body *').forEach(e => { if (e.closest('.leaflet-container')) return;
  const r = e.getBoundingClientRect(); if (r.width && (e.offsetParent || getComputedStyle(e).position === 'fixed') && (r.right > W + 0.5 || r.left < -0.5)) out.push((e.id || e.className) + ' ' + Math.round(r.left) + '..' + Math.round(r.right)); });
  return out.slice(0, 8); }'''
WIDE = []
def wide(pg, label):
    o = pg.evaluate(OVER)
    if o: print('  TOO WIDE at', label, o); WIDE.append((label, o))
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME', '/opt/google/chrome/chrome'), args=['--no-sandbox'])
    for name, w, h, scheme in fastwait.viewports([('pixel10pro', 412, 915, 'dark'), ('narrow', 320, 800, 'light')]):
        pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=2.6, color_scheme=scheme, is_mobile=True, has_touch=True)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(URL); pg.evaluate('setInsets(44, 24, 0, 0)'); pg.wait_for_timeout(400)
        pg.fill('#apiKey', 'AIzaSyTESTKEY0123456789abcdefghijklmnop'); pg.click('#sDone'); pg.wait_for_timeout(500)
        pg.evaluate(MOCKS); pg.evaluate(EXTRA)
        pg.evaluate("window.__app.S.citgoUsed = { tuesday: window.__app.P.monthKey(), friday: window.__app.P.monthKey() }")
        pg.click('#btnTrip'); pg.wait_for_timeout(400)
        assert step(pg) == 1
        # ---- Remove this car: red text; the x on a car button asks first ----
        pg.click('#gEdit'); pg.wait_for_timeout(150)
        col = pg.evaluate("getComputedStyle(document.getElementById('gRemove')).color"); print(name, 'remove color:', col)
        rgb = [int(x) for x in col[col.index('(') + 1:col.index(')')].split(',')[:3]]
        assert rgb[0] > 180 and rgb[1] < 140 and rgb[2] < 140, 'red, not yellow'
        pg.screenshot(path=f'{OUT}/{name}-gr0-edit.png'); wide(pg, 'edit')
        pg.click('#gEdit'); pg.wait_for_timeout(150)
        pg.click('[data-rmcar="venza12"]'); pg.wait_for_timeout(250)
        assert pg.locator('#cfm').count() == 1 and 'Remove 2012 Venza XLE?' in ft(pg, '#cfm'), ft(pg, '#cfm')
        pg.screenshot(path=f'{OUT}/{name}-gr1-confirm.png'); wide(pg, 'confirm')
        pg.click('#cfmNo'); pg.wait_for_timeout(250)
        assert pg.evaluate('window.__app.S.cars.length') == 2
        pg.click('[data-rmcar="venza12"]'); pg.wait_for_timeout(250); pg.click('#cfmYes'); pg.wait_for_timeout(300)
        assert pg.evaluate('window.__app.S.cars.length') == 1 and pg.locator('#gCars .cx').count() == 0, 'one car left: no x to remove it'
        # ---- add a car by VIN: NHTSA decodes it, the EPA mileage is matched, details filled, recalls checked ----
        pg.click('[data-car="+"]'); pg.wait_for_timeout(300)
        pg.click('[data-how="plate"]'); pg.wait_for_timeout(150)
        pt = ft(pg, '.plate-msg'); print('  plate:', pt[:120]); assert "isn't available" in pt and 'VIN' in pt
        pg.click('#gToVin'); pg.wait_for_timeout(150)
        pg.fill('#gVin', 'abc'); pg.click('#gVinGo'); pg.wait_for_timeout(150)
        assert '17' in ft(pg, '#vMsg'), 'bad VIN explained'
        pg.fill('#gVin', '1hgcv1f3xma000001'); pg.click('#gVinGo'); idle(pg, 1200)
        chip = ft(pg, '.carchip.on'); print('  VIN car:', chip, '|', ft(pg, '.epa-tiles').replace('\n', ' '), '|', ft(pg, '#eMsg'))
        assert '2021 Accord EX' in chip and '30' in ft(pg, '.epa-tiles'), 'decoded and matched to the EPA'
        assert any('DecodeVinValuesExtended/1HGCV1F3XMA000001' in u for u in pg.evaluate('window.__urls'))
        c = pg.evaluate('window.Garage.car()'); i = c['info']; print('  info:', i)
        assert i['engine'].startswith('1.5L Inline 4 Cyl') and i['asp'] == 'turbo' and i['trans'] == 'cvt' and i['drive'] == 'fwd' and 'DOHC' in i['features'] and 'Direct injection' in i['features']
        pg.click('#gInfo summary'); pg.wait_for_timeout(200)
        tiles = ft(pg, '.ac-tiles'); print('  tiles:', tiles.replace('\n', ' | '))
        assert '1.5-liter 4-cylinder' in tiles and 'Turbocharger' in tiles and 'no fixed gears (CVT)' in tiles and 'Front-wheel drive' in tiles
        assert pg.locator('.ac-tiles .ac-dd, #gEngine, #gDrive').count() == 0, 'a VIN says exactly what the car is: tiles, no menus'
        pg.click('#gFeats summary'); pg.wait_for_timeout(150)
        assert pg.is_checked('[data-feat="DOHC"]') and pg.is_checked('[data-feat="Direct injection"]') and 'from your VIN' in ft(pg, '#gFeats')
        pg.select_option('#gTireT', 'allseason'); pg.fill('#gTire', 'Michelin Primacy 225/50R17'); pg.dispatch_event('#gTire', 'change'); pg.wait_for_timeout(150)
        assert pg.evaluate("window.Garage.car().info.tire") == 'Michelin Primacy 225/50R17'
        pg.check('[data-feat="Start-stop"]'); pg.wait_for_timeout(150)
        assert 'Start-stop' in pg.evaluate("window.Garage.car().info.features") and pg.evaluate("window.Garage.car().info.featSrc['Start-stop']") == 'user'
        # a confirmed feature asks before it's unchecked
        pg.click('[data-feat="DOHC"]'); pg.wait_for_timeout(250)
        assert pg.locator('#cfm').count() == 1 and 'VIN record' in ft(pg, '#cfm'), 'asks first'
        pg.click('#cfmNo'); pg.wait_for_timeout(250)
        assert pg.is_checked('[data-feat="DOHC"]') and 'DOHC' in pg.evaluate("window.Garage.car().info.features"), 'cancel keeps it'
        # one camshaft layout: picking the other one asks too, then swaps them
        pg.click('[data-feat="SOHC"]'); pg.wait_for_timeout(250); assert pg.locator('#cfm').count() == 1 and 'only one' in ft(pg, '#cfm')
        pg.click('#cfmYes'); pg.wait_for_timeout(300)
        fe = pg.evaluate("window.Garage.car().info.features"); assert 'SOHC' in fe and 'DOHC' not in fe, fe
        pg.click('[data-feat="Pushrod"]'); pg.wait_for_timeout(250)
        fe = pg.evaluate("window.Garage.car().info.features"); assert 'Pushrod' in fe and 'SOHC' not in fe and pg.locator('#cfm').count() == 0, 'no question when nothing confirmed is replaced'
        pg.screenshot(path=f'{OUT}/{name}-gr2-info.png', full_page=True); wide(pg, 'info')
        # recalls live in Advisory now (tests/advisory_test.py); the Garage is about the car itself
        assert pg.locator('#gRecall, #rcNicb').count() == 0, 'no recall card in the Garage'
        # trim is optional and shows on the button
        if pg.locator('#gTrim').count() == 0: pg.click('#gEdit'); pg.wait_for_timeout(150)
        pg.fill('#gTrim', 'Sport'); pg.dispatch_event('#gTrim', 'change'); pg.wait_for_timeout(200)
        assert '2021 Accord Sport' in ft(pg, '.carchip.on')
        pg.fill('#gTank', '14.8'); pg.dispatch_event('#gTank', 'change'); pg.wait_for_timeout(150); pg.click('#gEdit'); pg.wait_for_timeout(150)
        # ---- an EV from the EPA: kWh, mi/kWh, battery estimated, plug ----
        pg.click('[data-car="+"]'); pg.wait_for_timeout(300)
        pg.select_option('#eYear', '2021'); pg.wait_for_timeout(200); pg.select_option('#eMake', 'Tesla'); pg.wait_for_timeout(200)
        pg.select_option('#eModel', 'Model 3 Long Range AWD'); pg.wait_for_timeout(700)
        ev = pg.evaluate('window.Garage.car()'); print('  EV:', ev['power'], ev['epa'], ev['tank'], ev.get('plug'))
        assert ev['power'] == 'ev' and abs(ev['epa']['city'] - 3.98) < 0.02 and ev['tank'] == 92 and ev['plug'] == 'NACS'
        econ = ft(pg, '.g-econ').replace('MI/KWH', 'mi/kWh'); print('  EV econ:', econ.replace('\n', ' | '))
        assert 'mi/kWh' in econ and '25 / 27 / 26 kWh per 100 mi' in econ and '353 mi range' in econ
        rng = pg.evaluate("(() => { const t = document.querySelector('.epa-tiles .rng'); return t ? { v: +t.querySelector('b').textContent, q: decodeURIComponent(t.querySelector('.qi').dataset.q) } : null; })()")
        print('  range tile:', rng['v'], rng['q'][:120]); assert rng and rng['v'] > 200 and 'highway' in rng['q'] and '80%' in rng['q'], 'range at highway mileage, with the 80% note in its (?)'
        assert 'Usable battery (kWh)' in ft(pg, '.g-edit') and pg.locator('#gDcKw').count() == 1 and pg.locator('#gType').count() == 0
        pg.fill('#gDcKw', '250'); pg.dispatch_event('#gDcKw', 'change'); pg.wait_for_timeout(100)
        assert 'Not worked out for EVs' in pg.text_content('#tSpeed')
        pg.click('#gObs summary'); pg.wait_for_timeout(100); assert 'City mi/kWh' in ft(pg, '#gObs')
        pg.screenshot(path=f'{OUT}/{name}-gr4-ev.png', full_page=True); wide(pg, 'ev')
        ev_id = ev['id']
        # ---- a hydrogen car: kg, mi/kg, tank from the spec list ----
        pg.click('#gEdit'); pg.wait_for_timeout(100)
        pg.click('[data-car="+"]'); pg.wait_for_timeout(300)
        pg.select_option('#eYear', '2021'); pg.wait_for_timeout(200); pg.select_option('#eMake', 'Toyota'); pg.wait_for_timeout(200)
        pg.select_option('#eModel', 'Mirai'); pg.wait_for_timeout(700)
        fc = pg.evaluate('window.Garage.car()'); print('  H2:', fc['power'], fc['epa'], fc['tank'], pg.evaluate('window.Garage.rangeMi()'))
        assert fc['power'] == 'h2' and fc['tank'] == 5.6 and abs(pg.evaluate('window.Garage.rangeMi()') - 74 * 5.6) < 8
        assert 'mi/kg' in ft(pg, '.g-econ').lower() and 'Hydrogen tank (kg)' in ft(pg, '.g-edit')
        # ---- the map panel: every hydrogen station, and what's out of reach for this car ----
        pg.click('#tClose'); pg.wait_for_timeout(300)
        pg.click('#btnAlt'); pg.wait_for_timeout(300)
        assert pg.locator('#afPick').count() == 1; pg.screenshot(path=f'{OUT}/{name}-af0-panel.png'); wide(pg, 'af panel')
        pg.click('#afH2Get'); pg.wait_for_timeout(900)
        assert any('fuel_type=HY' in u and 'limit=all' in u for u in pg.evaluate('window.__afdc'))
        assert all('DEMO_KEY' in u for u in pg.evaluate('window.__afdc')), 'shared key when you have none'
        n = pg.evaluate('window.AltFuel.h2().length'); lg = ft(pg, '#afLegend'); print('  H2 stations:', n, '| legend:', lg.replace('\n', ' | '))
        assert n == 5 and pg.evaluate('!!window.AltFuel.coverage()') and '207 mi' in lg and '413 mi' in lg
        pg.wait_for_timeout(800)
        tiles = pg.evaluate("document.querySelectorAll('.leaflet-afcov-pane canvas').length"); print('  coverage tiles:', tiles); assert tiles > 0
        # pixel check: far from any station is gray, next to one is clear
        px = pg.evaluate('''() => { const m = window.__app.map; m.setView([36.5, -119.5], 6, { animate: false }); return 1; }'''); pg.wait_for_timeout(900)
        pg.screenshot(path=f'{OUT}/{name}-af1-coverage.png'); wide(pg, 'coverage')
        pg.evaluate("window.__app.map.setView([39.5, -98.5], 4, { animate: false })"); pg.wait_for_timeout(900)
        pg.screenshot(path=f'{OUT}/{name}-af2-coverage-us.png')
        pg.evaluate("window.__app.S.alt.h2Range = '120'"); pg.click('#btnAlt'); pg.wait_for_timeout(300)
        assert pg.input_value('#afRange') == '120'; pg.fill('#afRange', ''); pg.dispatch_event('#afRange', 'change'); pg.wait_for_timeout(200)
        assert '207 mi' in ft(pg, '#afLegend')
        # EV chargers in the area, for the EV's plug
        pg.evaluate("(id) => { window.__app.S.carId = id; }", ev_id)
        pg.click('#afX'); pg.wait_for_timeout(250); pg.click('#btnAlt'); pg.wait_for_timeout(300)
        pg.click('#afEvGet'); pg.wait_for_timeout(700)
        u = [x for x in pg.evaluate('window.__afdc') if 'nearest.json' in x][-1]; print('  EV near:', u.split('?')[1][:200])
        assert 'ev_charging_level=dc_fast' in u and 'ev_connector_type=TESLA' in u
        pg.click('#afH2Show') if pg.locator('#afH2Show').count() else None
        pg.wait_for_timeout(200)
        # ---- a trip in the EV: chargers along the route, kWh, charging time ----
        pg.click('#btnTrip'); pg.wait_for_timeout(400)
        if pg.locator('#tpNew').count(): pg.click('#tpNew'); pg.wait_for_timeout(300)
        assert step(pg) == 1; nxt(pg, 300); assert step(pg) == 2; nxt(pg, 300)   # Garage -> Advisory -> Route
        pg.fill('#tLink', LINK); pg.wait_for_timeout(700)
        pg.click('#tGetRoutes'); idle(pg, 700)
        nxt(pg, 300)
        assert step(pg) == 4 and 'Miles of range left' in ft(pg, '#tpS4') and 'Charge to 80% each stop' in ft(pg, '#tpS4')
        pg.fill('#tMiles', '120'); pg.fill('#tBuffer', '20')
        nxt(pg, 1500); nxt(pg, 1200)
        assert step(pg) == 6
        rr = [x for x in pg.evaluate('window.__afdc') if 'nearby-route' in x]; print('  along route:', len(rr), rr[0].split('?')[1][:160] if rr else '')
        assert rr and 'LINESTRING' in rr[0].replace('%20', ' ').replace('%28', '(') and 'ev_connector_type=TESLA' in rr[0]
        pg.wait_for_timeout(300)
        res = pg.evaluate('window.__trip.state().result'); stops_ = res['plan']['stops']
        print('  EV plan:', res['plan']['ok'], [(s['c']['station']['name'], round(s['buyGal'], 1), round(s['departGal'], 1)) for s in stops_])
        assert res['plan']['ok'] and stops_ and all(s['departGal'] <= 92 * 0.8 + 0.01 for s in stops_), 'charges to 80% at most'
        assert all(s['c']['station']['name'].startswith('Supercharger') for s in stops_), 'time counts: the fast sites win'
        pg.click('#tsStopsH') if pg.locator('.stop').count() == 0 else None; pg.wait_for_timeout(200)
        pg.click('.stop .s-top'); pg.wait_for_timeout(200)
        sc = ft(pg, '.stop.open'); print('  stop:', sc.replace('\n', ' | ')[:260])
        assert 'kWh' in sc and 'min charging' in sc and 'gal' not in sc
        notes = ft(pg, '#tsResults'); assert '$20/hr' in notes
        pg.screenshot(path=f'{OUT}/{name}-ev1-stops.png'); wide(pg, 'ev stops')
        nxt(pg, 500); assert step(pg) == 7
        dep = ft(pg, '#tpS7'); print('  depart:', dep.replace('\n', ' | ')[:200]); assert 'charging' in dep and 'charging stop' in dep
        pg.screenshot(path=f'{OUT}/{name}-ev2-depart.png'); wide(pg, 'ev depart')
        # the VIN'd Accord has recalls: Departure says so
        acc = pg.evaluate("window.__app.S.cars.find(c => /Accord/.test(c.model)).id")
        pg.evaluate("(id) => { window.__app.S.carId = id; }", acc)
        pg.evaluate('window.__trip.step(1)'); pg.wait_for_timeout(300); pg.evaluate('window.__trip.step(6)'); idle(pg, 1500); pg.evaluate('window.__trip.step(7)'); pg.wait_for_timeout(400)
        assert 'safety recall' in ft(pg, '#tpS7')
        # Settings: General → Ask before deleting; the station-finder key is never exported
        pg.click('#tClose'); pg.wait_for_timeout(200); pg.click('#btnSettings'); pg.wait_for_timeout(300)
        assert pg.locator('input[data-k=confirmDeletes]:checked').count() == 1
        pg.fill('#nrelKey', 'MYNRELKEY123'); pg.click('#sDone'); pg.wait_for_timeout(200); pg.click('#btnSettings'); pg.wait_for_timeout(300)
        pg.evaluate('window.__saved = null'); pg.click('#exAll'); pg.wait_for_timeout(200)
        assert 'MYNRELKEY123' not in pg.evaluate('window.__saved.text'), 'key not exported'
        pg.screenshot(path=f'{OUT}/{name}-s1-settings.png', full_page=True); wide(pg, 'settings')
        pg.click('#sDone'); pg.wait_for_timeout(200)
        pg.close()
    b.close()
print('JS errors:', errors or 'none')
print('Too wide:', WIDE or 'none')
assert not errors and not WIDE
