"""Your cars, one at a time (Garage): the picture (NHTSA's photo; with a Fuel API key, the trim in its factory paints),
arrows / keys / swipe for the next car, the paint picker in Edit, pictures kept once downloaded, no sideways scrolling."""
import sys, os
from playwright.sync_api import sync_playwright
import fastwait  # noqa: F401

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
URL = 'file://' + os.path.join(ROOT, 'assets', 'web', 'index.html')
MOCKS = open(os.path.join(ROOT, 'tests', 'trip_mocks.js')).read()
PICS = r'''() => {
  const svg = (fill) => 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="' + fill + '"/></svg>');
  window.__pic = { nhtsa: [], fuel: [], img: [] };
  window.__mocks.nhtsaPic = (url) => { window.__pic.nhtsa.push(url); return /model=Venza/.test(url) ? { results: [{ vehiclePicture: 'https://static.nhtsa.gov/images/vehicles/22_st0640_046.png' }] } : { results: [{ vehiclePicture: 'https://static.nhtsa.gov/images/vehicles/11_st0640_046.png' }] }; };
  window.__mocks.image = (url) => { window.__pic.img.push(url); return { body: svg(/_218/.test(url) ? '#000417' : /_070/.test(url) ? '#ffffff' : /22_/.test(url) ? '#3a6' : '#88a') }; };
  window.__mocks.fuel = (path, key) => {
    window.__pic.fuel.push([path, key]);
    if (/^vehicles\?/.test(path)) return { body: JSON.stringify([{ id: '501', trim: 'LE', drivetrain: 'FWD' }, { id: '502', trim: 'XLE', drivetrain: 'FWD' }]) };
    const a = (code, name, rgb) => ({ url: 'https://i.fuelapi.com/x/501_cc0640_032_' + code + '.png', shotCode: { color: { code, oem_name: name, simple_name: name.split(' ')[0], rgb1: rgb } } });
    return { body: JSON.stringify({ id: '501', products: [{ productFormats: [{ code: 'color_0640_032_png', assets: [a('070', 'Blizzard Pearl', 'FFFFFF'), a('218', 'Midnight Black Metallic', '000417')] }] }] }) };
  };
}'''
errors = []
def ft(pg, sel): return pg.evaluate("(s) => { const e = document.querySelector(s); if (!e) throw new Error('no ' + s); return e.innerText; }", sel)
def cid(pg): return pg.evaluate('window.Garage.car().id')
OVER = '''() => { const W = innerWidth, out = []; document.querySelectorAll('body *').forEach(e => { if (e.closest('.leaflet-container')) return;
  const r = e.getBoundingClientRect(); if (r.width && (e.offsetParent || getComputedStyle(e).position === 'fixed') && (r.right > W + 0.5 || r.left < -0.5)) out.push((e.id || e.className) + ' ' + Math.round(r.left) + '..' + Math.round(r.right)); });
  return out.slice(0, 8); }'''
BIG = '''(sel) => { document.querySelectorAll(sel).forEach(e => { if (!e.dataset.big) { e.style.fontSize = (parseFloat(getComputedStyle(e).fontSize) * 1.3) + 'px'; e.dataset.big = 1; } }); }'''

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME', '/opt/google/chrome/chrome'), args=['--no-sandbox'])
    for name, w, h, scheme in fastwait.viewports([('pixel10pro', 412, 915, 'dark'), ('narrow', 320, 800, 'light')]):
        pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=2.6, color_scheme=scheme, is_mobile=True, has_touch=True)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(URL); pg.evaluate('setInsets(44, 24, 0, 0)'); pg.wait_for_timeout(400)
        pg.fill('#apiKey', 'AIzaSyTESTKEY0123456789abcdefghijklmnop'); pg.click('#sDone'); pg.wait_for_timeout(400)
        pg.evaluate(MOCKS); pg.evaluate(PICS)
        pg.evaluate("() => { window.__app.S.carId = 'corolla20'; }")
        pg.click('#btnTrip'); pg.wait_for_timeout(400)
        if pg.locator('#tpNew').count(): pg.click('#tpNew'); pg.wait_for_timeout(300)
        # ---- no key: NHTSA's photo of the model, kept ----
        pg.wait_for_selector('#gcPic img'); pg.wait_for_timeout(200)
        assert cid(pg) == 'corolla20' and 'model=Corolla%20Hybrid' in pg.evaluate('window.__pic.nhtsa[0]') and 'Photo: NHTSA' in ft(pg, '#gcSub')
        assert pg.evaluate('window.__pic.img').count('https://static.nhtsa.gov/images/vehicles/11_st0640_046.png') == 1
        pg.screenshot(path=f'{OUT}/{name}-k1-car.png')
        # ---- the next car: arrow, keys, swipe (wraps around) ----
        pg.click('#gcNext'); pg.wait_for_timeout(400)
        assert cid(pg) == 'venza12' and 'Venza' in ft(pg, '.gc-name') and pg.locator('.gc-dot.on[data-car="venza12"]').count() == 1
        pg.wait_for_selector('#gcPic img'); assert 'model=Venza&' in ' '.join(pg.evaluate('window.__pic.nhtsa')), 'the EPA\'s "Venza AWD" is "Venza" at NHTSA'
        pg.focus('#gcStage'); pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(400); assert cid(pg) == 'corolla20', 'wraps around'
        pg.focus('#gcStage'); pg.keyboard.press('ArrowLeft'); pg.wait_for_timeout(400); assert cid(pg) == 'venza12'
        bb = pg.locator('#gcStage').bounding_box(); y = bb['y'] + bb['height'] / 2
        pg.mouse.move(bb['x'] + bb['width'] * 0.8, y); pg.mouse.down(); pg.mouse.move(bb['x'] + bb['width'] * 0.2, y, steps=6); pg.mouse.up(); pg.wait_for_timeout(400)
        assert cid(pg) == 'corolla20', 'swiped left: the next car'
        n_img = len(pg.evaluate('window.__pic.img'))
        pg.click('#gcNext'); pg.wait_for_timeout(400); pg.click('#gcPrev'); pg.wait_for_timeout(400)
        assert len(pg.evaluate('window.__pic.img')) == n_img, 'pictures are kept: nothing downloaded again'
        # ---- the paint picker (no key: common colors, which color the drawing) ----
        pg.click('#gEdit'); pg.wait_for_timeout(200)
        assert pg.locator('.gc-paint').count() == 12 and 'colors%20the%20picture' in pg.inner_html('#gPaints')
        pg.click('.gc-paint[data-paint="Red"]'); pg.wait_for_timeout(200)
        assert pg.evaluate('window.Garage.car().paint.name') == 'Red' and 'Red' in ft(pg, '#gcSub')
        pg.click('#gEdit'); pg.wait_for_timeout(200)
        # ---- a Fuel API key: the trim, in its factory paints; the key goes to the bridge, never into the log ----
        pg.evaluate("() => { window.__app.S.fuelKey = 'test-fuel-key'; window.CarPics.keyChanged(); window.Garage.redraw(); }")
        pg.wait_for_function("window.Garage.car().pic && window.Garage.car().pic.src === 'fuel'", timeout=4000); pg.wait_for_timeout(300)
        calls = pg.evaluate('window.__pic.fuel'); print(' ', name, 'fuel calls:', [c[0] for c in calls])
        assert calls[0][0] == 'vehicles?year=2020&make=Toyota&model=Corolla%20Hybrid' and all(c[1] == 'test-fuel-key' for c in calls)
        pc = pg.evaluate('window.Garage.car().pic'); assert pc['vid'] == '501' and pc['exact'] and [c['code'] for c in pc['colors']] == ['070', '218'], pc
        pg.wait_for_selector('#gcPic img'); assert 'EVOX via Fuel API' in ft(pg, '#gcSub')
        pg.click('#gEdit'); pg.wait_for_timeout(200)
        assert pg.locator('.gc-paint').count() == 2 and 'factory%20colors' in pg.inner_html('#gPaints')
        pg.click('.gc-paint[data-code="218"]'); pg.wait_for_timeout(400)
        assert pg.evaluate('window.Garage.car().paint') == {'name': 'Midnight Black Metallic', 'code': '218', 'rgb': '#000417'}
        assert any('_218.png' in u for u in pg.evaluate('window.__pic.img')) and 'Midnight Black Metallic' in ft(pg, '#gcSub')
        pg.screenshot(path=f'{OUT}/{name}-k2-paint.png', full_page=True)
        log = pg.evaluate("window.FLog ? FLog.text ? FLog.text() : '' : ''")
        assert 'test-fuel-key' not in (log or '') and 'test-fuel-key' not in pg.evaluate("JSON.stringify(window.__app.exportData ? window.__app.exportData() : {})")
        # no sideways scrolling, also at 130% text
        o = pg.evaluate(OVER); pg.evaluate(BIG, '#gCars *, .gc-dots *, #gPaints *'); pg.wait_for_timeout(100); o += pg.evaluate(OVER)
        assert not o, 'sideways: ' + str(o)
        pg.close()
    assert not errors, errors
    print('JS errors: none')
    b.close()
print('car picture tests passed')
