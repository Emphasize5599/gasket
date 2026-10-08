"""About this car: read-only tiles, a ▾ only on what differs between the model's versions (none with a VIN), picking a
version from the EPA, the features checklist (collapsed, alphabetical, confirmed ones from the EPA), custom cars' menus,
plain words, and no sideways scrolling."""
import sys, os
from playwright.sync_api import sync_playwright
import fastwait  # noqa: F401  (waits end once the page settles; SLOW_WAITS=1 for fixed sleeps)

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
URL = 'file://' + os.path.join(ROOT, 'assets', 'web', 'index.html')
MOCKS = open(os.path.join(ROOT, 'tests', 'trip_mocks.js')).read()
# fueleconomy.gov answers, as the real service gives them for these cars
EPA = r'''() => {
  window.__epaUrls = [];
  const rec = {
    32199: { id: '32199', year: '2011', make: 'Toyota', model: 'Venza', baseModel: 'Venza', trany: 'Automatic (S6)', drive: 'Front-Wheel Drive', displ: '3.5', cylinders: '6', eng_dscr: '', atvType: '', startStop: '', fuelType1: 'Regular Gasoline', city08: '18', highway08: '24', comb08: '20', VClass: 'Minivan - 2WD' },
    32198: { id: '32198', year: '2011', make: 'Toyota', model: 'Venza', baseModel: 'Venza', trany: 'Automatic (S6)', drive: 'Front-Wheel Drive', displ: '2.7', cylinders: '4', eng_dscr: '', atvType: '', startStop: '', fuelType1: 'Regular Gasoline', city08: '19', highway08: '24', comb08: '21', VClass: 'Minivan - 2WD' },
    32203: { id: '32203', year: '2011', make: 'Toyota', model: 'Venza AWD', baseModel: 'Venza', trany: 'Automatic (S6)', drive: 'All-Wheel Drive', displ: '3.5', cylinders: '6', eng_dscr: '', atvType: '', startStop: '', fuelType1: 'Regular Gasoline', city08: '16', highway08: '22', comb08: '18', VClass: 'Minivan - 4WD' },
    41214: { id: '41214', year: '2016', make: 'Toyota', model: 'Corolla Hybrid', baseModel: 'Corolla Hybrid', trany: 'Automatic (variable gear ratios)', drive: 'Front-Wheel Drive', displ: '1.8', cylinders: '4', eng_dscr: '', atvType: 'Hybrid', startStop: 'Y', fuelType1: 'Regular Gasoline', city08: '54', highway08: '50', comb08: '52', VClass: 'Midsize Cars' }
  };
  window.__mocks.epa = (url) => {
    window.__epaUrls.push(url);
    if (/menu\/model\?year=2011&make=Toyota/.test(url)) return { menuItem: [{ text: 'Camry', value: 'Camry' }, { text: 'Venza', value: 'Venza' }, { text: 'Venza AWD', value: 'Venza AWD' }] };
    if (/menu\/model\?year=2016&make=Toyota/.test(url)) return { menuItem: [{ text: 'Corolla Hybrid', value: 'Corolla Hybrid' }, { text: 'Corolla Hybrid c', value: 'Corolla Hybrid c' }, { text: 'Corolla Hybrid Eco', value: 'Corolla Hybrid Eco' }] };
    if (/menu\/options.*model=Venza/.test(url)) return { menuItem: [{ text: 'Auto (S6), 6 cyl, 3.5 L', value: '32199' }, { text: 'Auto (S6), 4 cyl, 2.7 L', value: '32198' }] };
    if (/menu\/options.*model=Venza%20AWD/.test(url)) return { menuItem: { text: 'Auto (S6), 6 cyl, 3.5 L', value: '32203' } };
    if (/menu\/options.*model=Corolla Hybrid$/.test(url)) return { menuItem: { text: 'Auto (variable gear ratios), 4 cyl, 1.8 L', value: '41214' } };
    const m = /vehicle\/(\d+)$/.exec(url); if (m && rec[m[1]]) return rec[m[1]];
    return { menuItem: [] };
  };
}'''
errors = []
def ft(pg, sel): return pg.evaluate("(s) => { const e = document.querySelector(s); if (!e) throw new Error('no ' + s); return e.innerText; }", sel)
def car(pg): return pg.evaluate('window.Garage.car()')
def pick(pg, id_):
    pg.evaluate("(id) => { window.__app.S.carId = id; window.Garage.redraw(); }", id_); pg.wait_for_timeout(300)
    if pg.locator('#gInfo[open]').count() == 0: pg.click('#gInfo summary'); pg.wait_for_timeout(300)
OVER = '''() => { const W = innerWidth, out = []; document.querySelectorAll('body *').forEach(e => { if (e.closest('.leaflet-container')) return;
  const r = e.getBoundingClientRect(); if (r.width && (e.offsetParent || getComputedStyle(e).position === 'fixed') && (r.right > W + 0.5 || r.left < -0.5)) out.push((e.id || e.className) + ' ' + Math.round(r.left) + '..' + Math.round(r.right)); });
  return out.slice(0, 8); }'''
BIG = '''() => { document.querySelectorAll('#gInfo *').forEach(e => { if (!e.dataset.big) { e.style.fontSize = (parseFloat(getComputedStyle(e).fontSize) * 1.3) + 'px'; e.dataset.big = 1; } }); }'''

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME', '/opt/google/chrome/chrome'), args=['--no-sandbox'])
    for name, w, h, scheme in fastwait.viewports([('pixel10pro', 412, 915, 'dark'), ('narrow', 320, 800, 'light')]):
        pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=2.6, color_scheme=scheme, is_mobile=True, has_touch=True)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(URL); pg.evaluate('setInsets(44, 24, 0, 0)'); pg.wait_for_timeout(400)
        pg.fill('#apiKey', 'AIzaSyTESTKEY0123456789abcdefghijklmnop'); pg.click('#sDone'); pg.wait_for_timeout(400)
        pg.evaluate(MOCKS); pg.evaluate(EPA)
        pg.click('#btnTrip'); pg.wait_for_timeout(400)
        if pg.locator('#tpNew').count(): pg.click('#tpNew'); pg.wait_for_timeout(300)
        # ---- the Venza: the EPA lists three versions (2WD V6, 2WD 4-cylinder, AWD V6) ----
        pick(pg, 'venza12')
        assert car(pg)['epaId'] == '32199', 'the seeded Venza knows its EPA record'
        pg.wait_for_function("window.Garage.car().variants && window.Garage.car().variants.list.length === 3", timeout=5000); pg.wait_for_timeout(200)
        tiles = ft(pg, '.ac-tiles'); print(' ', name, 'Venza tiles:', tiles.replace('\n', ' | '))
        assert '3.5-liter V6' in tiles and 'Automatic, 6 speeds' in tiles and 'Front-wheel drive' in tiles and 'Gas engine' in tiles
        dd = pg.evaluate("[...document.querySelectorAll('.ac-tiles .ac-dd')].map(b => b.dataset.ver)")
        assert dd == ['engine', 'drive'], 'a ▾ only on what differs between versions: ' + str(dd)
        assert pg.locator('#gEngine, #gDrive, #gTrans').count() == 0, 'no menus for a car from the EPA'
        pg.click('[data-ver="engine"]'); pg.wait_for_timeout(250)
        vers = ft(pg, '#gVers'); print('  versions:', vers.replace('\n', ' | '))
        assert '2.7-liter 4-cylinder · automatic, 6 speeds · two-wheel drive' in vers and '3.5-liter 6-cylinder · automatic, 6 speeds · all-wheel drive' in vers
        assert pg.locator('#gVers [data-vid="32199"].on').count() == 1, 'yours is marked'
        pg.screenshot(path=f'{OUT}/{name}-ac1-versions.png')
        pg.click('#gVers [data-vid="32203"]'); pg.wait_for_timeout(500)
        c = car(pg); print('  picked:', c['model'], c['info']['engine'], c['info']['drive'], c['epa'])
        assert c['epaId'] == '32203' and c['model'] == 'Venza AWD' and c['info']['drive'] == 'awd' and c['epa']['city'] == 16 and c['info']['src']['drive'] == 'epa'
        assert 'All-wheel drive' in ft(pg, '.ac-tiles') and pg.locator('#gVers').count() == 0
        # a VIN settles it: no ▾
        pg.evaluate("() => { window.Garage.car().vin = '4T3ZK3BB0CU000001'; window.Garage.redraw(); }"); pg.wait_for_timeout(250)
        assert pg.locator('.ac-tiles .ac-dd').count() == 0 and 'From your VIN' in ft(pg, '.ac-src')
        # ---- the Corolla Hybrid: one version, so plain tiles ----
        pick(pg, 'corolla20')
        pg.wait_for_function("window.Garage.car().variants && window.Garage.car().variants.list.length === 1", timeout=5000); pg.wait_for_timeout(200)
        tiles = ft(pg, '.ac-tiles'); print('  Corolla Hybrid tiles:', tiles.replace('\n', ' | '))
        assert '1.8-liter 4-cylinder' in tiles and 'Hybrid automatic' in tiles and 'Hybrid (gas + electric)' in tiles and pg.locator('.ac-tiles .ac-dd').count() == 0
        # features: collapsed, alphabetical, plain words, a (?) on each
        assert pg.locator('#gFeats[open]').count() == 0, 'Features collapsed at first'
        pg.click('#gFeats summary'); pg.wait_for_timeout(150)
        labels = pg.evaluate("[...document.querySelectorAll('.ac-f label span')].map(s => s.firstChild.textContent)")
        print('  features:', labels)
        assert labels == sorted(labels, key=str.lower), 'alphabetical'
        assert pg.locator('.ac-f .qi').count() == len(labels), 'a (?) for every feature'
        assert 'Regenerative braking' in labels and 'Heat pump for cabin heat' in labels, 'hybrid: the electric ones too'
        for acr in ['DOHC', 'SOHC', 'OHV', 'GDI', 'CVT', 'AWD', 'FWD', 'VVT']:
            assert acr not in ft(pg, '#gInfo').replace('(?)', ''), 'plain words: ' + acr
        # the (?) explains the technical term
        q = '.ac-f:has([data-feat="DOHC"]) .qi'; pg.evaluate("(s) => document.querySelector(s).scrollIntoView({ block: 'center' })", q); pg.wait_for_timeout(300)
        pg.click(q); pg.wait_for_timeout(200); assert 'dual overhead cam' in ft(pg, '.qpop'); pg.evaluate('window.__closeQ && window.__closeQ()')
        pg.screenshot(path=f'{OUT}/{name}-ac2-corolla.png', full_page=True)
        o = pg.evaluate(OVER); pg.evaluate(BIG); pg.wait_for_timeout(100); o += pg.evaluate(OVER)
        assert not o, 'sideways: ' + str(o)
        # ---- a car you build yourself keeps the menus ----
        pg.evaluate('''() => { const S = window.__app.S; S.cars.push({ id: 'cx', name: 'My kit car', year: 1990, make: 'Kit', model: 'Roadster', power: 'gas', grade: 'regular', epa: null, obs: {}, entries: [], info: { src: {}, featSrc: {} } }); S.carId = 'cx'; window.Garage.redraw(); }''')
        pg.wait_for_timeout(250)
        if pg.locator('#gInfo[open]').count() == 0: pg.click('#gInfo summary'); pg.wait_for_timeout(200)
        assert pg.locator('#gPower, #gEngine, #gTrans, #gDrive').count() == 4 and pg.locator('.ac-tiles').count() == 0, 'custom car: menus'
        pg.select_option('#gDrive', 'rwd'); pg.wait_for_timeout(150)
        assert car(pg)['info']['drive'] == 'rwd' and car(pg)['info']['src']['drive'] == 'user'
        pg.close()
    b.close()
print('JS errors:', errors or 'none')
assert not errors
print('about-this-car tests passed')
