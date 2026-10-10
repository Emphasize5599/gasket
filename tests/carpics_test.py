"""Your cars, one at a time (Garage): the picture (NHTSA's photo, else a Wikimedia Commons photo with its credit, else a
doodle), arrows / keys / swipe for the next car, Photo / Doodle in Edit (colors only for the doodle), pictures kept once
downloaded, no sideways scrolling."""
import sys, os
from playwright.sync_api import sync_playwright
import fastwait  # noqa: F401

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
URL = 'file://' + os.path.join(ROOT, 'assets', 'web', 'index.html')
MOCKS = open(os.path.join(ROOT, 'tests', 'trip_mocks.js')).read()
PICS = r'''() => {
  const svg = (fill) => 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="' + fill + '"/></svg>');
  window.__pic = { nhtsa: [], commons: [], img: [] };
  window.__mocks.nhtsaPic = (url) => { window.__pic.nhtsa.push(url); if (window.__noNhtsa && /model=Venza/.test(url)) return { results: [{ vehiclePicture: null }] }; return /model=Venza/.test(url) ? { results: [{ vehiclePicture: 'https://static.nhtsa.gov/images/vehicles/22_st0640_046.png', trim: 'SUV', vehicleModel: 'VENZA' }] } : { results: [{ vehiclePicture: 'https://static.nhtsa.gov/images/vehicles/11_st0640_046.png', trim: '4 DR', vehicleModel: 'COROLLA HYBRID' }] }; };
  window.__mocks.commons = (url) => { window.__pic.commons.push(url); return { query: { pages: {
    '1': { title: 'File:2012 Toyota Venza interior.jpg', index: 1, imageinfo: [{ width: 1600, height: 1000, thumburl: 'https://upload.wikimedia.org/x/1.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:1', extmetadata: {} }] },
    '2': { title: 'File:2012 Toyota Venza XLE front.jpg', index: 2, imageinfo: [{ width: 1600, height: 1000, thumburl: 'https://upload.wikimedia.org/x/2.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:2', extmetadata: { Artist: { value: 'Test Photographer' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] } } } }; };
  window.__mocks.image = (url) => { window.__pic.img.push(url); return { body: svg(/upload\.wikimedia/.test(url) ? '#a63' : /22_/.test(url) ? '#3a6' : '#88a') }; };
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
        # ---- Photo / Doodle (in Edit): colors only for the doodle ----
        pg.click('#gEdit'); pg.wait_for_timeout(200)
        assert pg.locator('#gPicMode [data-pm="photo"].on').count() == 1 and pg.locator('.gc-paint').count() == 0, 'photo: no colors'
        pg.click('#gPicMode [data-pm="doodle"]'); pg.wait_for_timeout(200)
        assert pg.locator('#gcPic img').count() == 0 and pg.locator('#gcPic .gc-draw').count() == 1 and 'Doodle' in ft(pg, '#gcSub') and pg.locator('.gc-paint').count() == 12
        assert pg.get_attribute('#gcPic .gc-draw', 'aria-label') == 'Sedan doodle', 'NHTSA lists it as a 4-door: a sedan'
        pg.click('.gc-paint[data-paint="Red"]'); pg.wait_for_timeout(200)
        assert pg.evaluate('window.Garage.car().paint.name') == 'Red' and 'Red' in ft(pg, '#gcSub') and pg.get_attribute('#gcPic .gc-body', 'fill') == '#a3161c', 'colored red'
        pg.screenshot(path=f'{OUT}/{name}-k2-doodle.png', full_page=True)
        pg.click('#gPicMode [data-pm="photo"]'); pg.wait_for_timeout(300)
        assert pg.locator('#gcPic img').count() == 1 and 'Photo: NHTSA' in ft(pg, '#gcSub') and 'Red' not in ft(pg, '#gcSub'), 'back to the photo'
        pg.click('#gEdit'); pg.wait_for_timeout(200)
        # ---- NHTSA has no photo: the Commons photo, credited, linked to its page ----
        pg.evaluate("() => { window.__noNhtsa = true; const v = window.__app.S.cars.find(c => c.id === 'venza12'); delete v.pic; }")
        pg.click('#gcNext'); pg.wait_for_timeout(300)
        pg.wait_for_function("(() => { const c = window.Garage.car(); return c.id === 'venza12' && c.pic && c.pic.wiki && c.pic.wiki.url; })()", timeout=4000)
        pg.wait_for_selector('#gcPic img'); sub = ft(pg, '#gcSub'); print(' ', name, 'credit:', sub)
        assert 'Test Photographer' in sub and 'CC BY-SA 4.0' in sub and 'Wikimedia Commons' in sub and pg.get_attribute('#gcSub a', 'data-url') == 'https://commons.wikimedia.org/wiki/File:2'
        assert 'gsrsearch=2012%20Toyota%20Venza' in pg.evaluate('window.__pic.commons[0]') and 'https://upload.wikimedia.org/x/2.jpg' in pg.evaluate('window.__pic.img'), 'the front photo, not the interior'
        pg.click('#gcPrev'); pg.wait_for_timeout(300)
        # the old Fuel API key is gone
        assert pg.evaluate('window.__app.S.fuelKey') is None and pg.locator('#fuelKey').count() == 0
        # no sideways scrolling, also at 130% text
        o = pg.evaluate(OVER); pg.click('#gEdit'); pg.wait_for_timeout(200); pg.evaluate(BIG, '#gCars *, .gc-dots *, #gPaints *'); pg.wait_for_timeout(100); o += pg.evaluate(OVER)
        assert not o, 'sideways: ' + str(o)
        pg.close()
    assert not errors, errors
    print('JS errors: none')
    b.close()
print('car picture tests passed')
