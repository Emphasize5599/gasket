"""Tires (Garage): the factory size from Tire Rack for the trim, type -> brand -> model from Tire Rack's list for that size
(wear rating and warranty filled in), tread left (estimated or measured), Advisory's tire card, a blocked or unknown lookup,
typed sizes, a trim with several factory sizes, no sideways scrolling, and the Tire Rack page reader itself."""
import sys, os, json
from playwright.sync_api import sync_playwright
import fastwait  # noqa: F401  (waits end once the page settles; SLOW_WAITS=1 for fixed sleeps)

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
URL = 'file://' + os.path.join(ROOT, 'assets', 'web', 'index.html')
MOCKS = open(os.path.join(ROOT, 'tests', 'trip_mocks.js')).read()
READER = open(os.path.join(ROOT, 'assets', 'tirerack_worker.js')).read()
# Tire Rack's answers (made-up tires in its format)
TR = r'''() => {
  window.__tr = [];
  window.__trMode = 'ok';
  const LIST = [
    { name: 'BRIDGESTONE ECOPIA EP422 PLUS', type: 'Standard Touring All-Season', size: '195/65R15', utqg: { tw: 680, trac: 'A', temp: 'B' }, warrantyMi: 65000 },
    { name: 'CONTINENTAL SECURECONTACT AW', type: 'Grand Touring All-Season', size: '195/65R15', utqg: { tw: 700, trac: 'A', temp: 'A' }, warrantyMi: 60000 },
    { name: 'MICHELIN DEFENDER2', type: 'Standard Touring All-Season', size: '195/65R15', utqg: { tw: 820, trac: 'A', temp: 'B' }, warrantyMi: 80000 },
    { name: 'BRIDGESTONE BLIZZAK WS90', type: 'Studless Ice & Snow', size: '195/65R15', utqg: null, warrantyMi: 0 } ];
  window.__brave = [];
  window.__mocks.siteRead = (key, args) => {
    if (key === 'brave' && args.kind === 'spare') { window.__brave.push(args); return { text: 'The ' + new URL(args.url).searchParams.get('q').replace(/^Does the /,'').split(' have a factory spare tire?')[0] + ' comes with a compact temporary spare tire under the cargo floor.', src: 'ai' }; }
    if (key !== 'tirerack') return { error: 'No Native bridge' };
    window.__tr.push(args);
    if (window.__trMode === 'blocked') return { blocked: true };
    // Tire Rack's vehicle picker: its model names per make and year, then each model's versions ("clarifiers")
    if (args.step === 'models') return { make: args.make, models: { Toyota: ['Corolla', 'Corolla Hatchback', 'Corolla Hybrid', 'Sequoia', 'Venza AWD', 'Venza FWD'], Honda: ['Civic Sedan', 'Fit'] }[args.make] || [] };
    if (args.step === 'clars') { const C = { 'Corolla Hybrid': ['LE'], 'Venza FWD': ['LE 4cyl', 'XLE V6', 'Limited V6'], 'Venza AWD': ['XLE V6'], 'Fit': ['LX', 'EX', 'Sport w/Honda Sensing'] }, out = {}; args.models.forEach((m) => { out[m] = C[m] || []; }); return { clars: out }; }
    if (args.step === 'size') return /autoModel=Fit&autoModClar=Sport%20w%2FHonda%20Sensing/.test(args.url) ? { factory: ['185/55R16'], optional: [] } : /autoModel=Corolla%20Hybrid&autoModClar=LE$/.test(args.url) ? { factory: ['195/65R15'], optional: ['215/45R17'] } : /autoModel=Venza%20FWD&autoModClar=XLE%20V6$/.test(args.url) ? { factory: ['245/55R19', '245/50R20'], optional: [] } : { unknown: true };
    if (args.step === 'oesize') return args.model === 'Sequoia' && args.clar === '' ? { factory: ['275/55R20'], optional: ['275/65R18'] } : { unknown: true };
    if (args.step === 'list') return /width=195\/&ratio=65&diameter=15/.test(args.url) ? { tires: LIST } : { tires: [] };
    return { error: '?' };
  };
}'''
errors = []
def ft(pg, sel): return pg.evaluate("(s) => { const e = document.querySelector(s); if (!e) throw new Error('no ' + s); return e.innerText; }", sel)
def T(pg): return pg.evaluate('window.Garage.car().tires')
def opts(pg, sel): return pg.evaluate("(s) => [...document.querySelectorAll(s + ' option')].map(o => o.textContent)", sel)
def show(pg, id_):
    pg.evaluate("(id) => { window.__app.S.carId = id; window.Garage.redraw(); }", id_); pg.wait_for_timeout(300)
    if pg.locator('#gTires[open]').count() == 0: pg.click('#gTires summary'); pg.wait_for_timeout(300)
OVER = '''() => { const W = innerWidth, out = []; document.querySelectorAll('body *').forEach(e => { if (e.closest('.leaflet-container')) return;
  const r = e.getBoundingClientRect(); if (r.width && (e.offsetParent || getComputedStyle(e).position === 'fixed') && (r.right > W + 0.5 || r.left < -0.5)) out.push((e.id || e.className) + ' ' + Math.round(r.left) + '..' + Math.round(r.right)); });
  return out.slice(0, 8); }'''
BIG = '''() => { document.querySelectorAll('#gTires *').forEach(e => { if (!e.dataset.big) { e.style.fontSize = (parseFloat(getComputedStyle(e).fontSize) * 1.3) + 'px'; e.dataset.big = 1; } }); }'''

def reader(pg, html, args, wait_ms=1500):
    pg.set_content(html)
    pg.evaluate('''([src, a]) => { window.__got = null; window.GasketSite = { result: (id, j) => { window.__got = JSON.parse(j); } }; (0, eval)('(' + src + ')')(1, a); }''', [READER, args])
    pg.wait_for_function('window.__got !== null', timeout=max(10000, wait_ms))
    return pg.evaluate('window.__got')

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME', '/opt/google/chrome/chrome'), args=['--no-sandbox'])
    for name, w, h, scheme in fastwait.viewports([('pixel10pro', 412, 915, 'dark'), ('narrow', 320, 800, 'light')]):
        pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=2.6, color_scheme=scheme, is_mobile=True, has_touch=True)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(URL); pg.evaluate('setInsets(44, 24, 0, 0)'); pg.wait_for_timeout(400)
        pg.fill('#apiKey', 'AIzaSyTESTKEY0123456789abcdefghijklmnop'); pg.click('#sDone'); pg.wait_for_timeout(400)
        pg.evaluate(MOCKS); pg.evaluate(TR)
        pg.click('#btnTrip'); pg.wait_for_timeout(400)
        if pg.locator('#tpNew').count(): pg.click('#tpNew'); pg.wait_for_timeout(300)
        # ---- the Corolla Hybrid LE: factory size from Tire Rack, then the tires in that size ----
        show(pg, 'corolla20')
        pg.wait_for_function("window.Garage.car().tires && window.Garage.car().tires.list && window.Garage.car().tires.list.items.length === 4", timeout=5000); pg.wait_for_timeout(200)
        # the scroll button: just above the Back / Next bar going down; an up arrow near the end and when heading back up
        hint = "(() => { const sc = document.getElementById('tpBody'), h = sc._hint, r = h.getBoundingClientRect(); return { cls: h.className, bottom: r.bottom, nav: document.getElementById('tNext').getBoundingClientRect().top, sc: sc.getBoundingClientRect().bottom } })()"
        o = pg.evaluate(hint); assert 'hidden' not in o['cls'] and 'up' not in o['cls'] and o['bottom'] <= o['sc'] and o['bottom'] < o['nav'], o
        pg.evaluate("document.getElementById('tpBody').scrollTop = 1e6"); pg.wait_for_timeout(200); assert ' up' in pg.evaluate(hint)['cls'], 'at the end: back to the top'
        pg.evaluate("(() => { const sc = document.getElementById('tpBody'); sc.scrollTop = sc.scrollHeight - sc.clientHeight - 40; })()"); pg.wait_for_timeout(200)
        assert ' up' in pg.evaluate(hint)['cls'], 'a little short of the end: still up'
        pg.evaluate("(() => { const sc = document.getElementById('tpBody'); sc.scrollTop = 0; })()"); pg.wait_for_timeout(200); assert ' up' not in pg.evaluate(hint)['cls']
        reads = pg.evaluate('window.__tr'); print(' ', name, 'Tire Rack reads:', [r['url'] for r in reads])
        assert [r['step'] for r in reads] == ['models', 'clars', 'size', 'list'], 'models, then the likely model\'s versions, then the size, then the tires'
        assert reads[0]['make'] == 'Toyota' and reads[0]['year'] == 2020 and reads[1]['models'] == ['Corolla Hybrid'], 'only the model that is this car is asked about'
        assert reads[2]['url'] == 'https://www.tirerack.com/tires/SelectTireSize.jsp?autoMake=Toyota&autoYear=2020&autoModel=Corolla%20Hybrid&autoModClar=LE'
        assert 'width=195/&ratio=65&diameter=15' in reads[3]['url'] and 'autoModel=' not in reads[3]['url'], 'replacement tires are listed by size without vehicle/OE filters'
        assert T(pg)['trVer']['auto'] is True, 'matched from the trim'
        pg.click('#tzDet'); pg.wait_for_selector('.sub-page #tzSize')
        assert ft(pg, '.sub-page h2') == 'Tire details'
        assert pg.input_value('#tzSize') == '195/65R15' and 'from Tire Rack' in ft(pg, '.sub-page')
        types = opts(pg, '#tzType'); print('  types:', types)
        assert types == ['Type', 'Grand Touring All-Season', 'Standard Touring All-Season', 'Studless Ice & Snow', 'Other…']
        pg.select_option('#tzType', 'Standard Touring All-Season'); pg.wait_for_timeout(200)
        assert opts(pg, '#tzBrand') == ['Brand', 'Bridgestone', 'Continental', 'Michelin', 'Other…'], 'all brands remain available regardless of type'
        pg.select_option('#tzBrand', 'Bridgestone'); pg.wait_for_timeout(200)
        assert opts(pg, '#tzModel') == ['Model', 'BLIZZAK WS90', 'ECOPIA EP422 PLUS', 'Other…'], 'snow and touring models remain available'
        pg.select_option('#tzModel', 'ECOPIA EP422 PLUS'); pg.wait_for_timeout(250)
        t = T(pg); print('  picked:', t['brand'], t['model'], t['utqg'], t['warrantyMi'])
        assert t['utqg'] == {'tw': 680, 'trac': 'A', 'temp': 'B'} and t['utqgSrc'] == 'tirerack' and t['warrantyMi'] == 65000
        assert pg.input_value('#tzTw') == '680' and 'Wear rating and warranty from Tire Rack' in ft(pg, '.sub-page') and pg.input_value('#tzWarranty') == '65000'
        line = ft(pg, '#gTiresLine'); print('  summary line:', line)
        assert line.startswith('Standard Touring All-Season · Fuel 10/10 · UTQG 680 A B'), 'the line under Tires: type, fuel /10, wear rating'
        assert 'Fuel economy' in ft(pg, '.sub-page') and 'a fuel-saving line' in ft(pg, '.tz-fuel')
        pg.screenshot(path=f'{OUT}/{name}-t0-details.png')
        o = pg.evaluate(OVER); pg.evaluate(BIG.replace('#gTires *', '.sub-page *')); pg.wait_for_timeout(100); o += pg.evaluate(OVER)
        assert not o, 'details page sideways: ' + str(o)
        pg.click('.sub-back'); pg.wait_for_timeout(200)
        assert '195/65R15 · Bridgestone ECOPIA EP422 PLUS' in ft(pg, '#tzDet'), 'size and tire under Tire details'
        col = pg.evaluate("[...document.querySelectorAll('#gTiresLine .gr')].map(e => e.textContent + ' ' + getComputedStyle(e).color)"); print('  graded:', col)
        assert col[0].startswith('10/10 rgb(') and col[3].startswith('B rgb('), col
        # the spare: Brave Search's answer, to confirm
        pg.wait_for_function("window.__brave.length > 0", timeout=4000); pg.wait_for_timeout(200)
        assert 'Does%20the%202020%20Toyota%20Corolla%20Hybrid%20LE%20have%20a%20factory%20spare%20tire' in pg.evaluate('window.__brave[0].url')
        assert 'Compact (temporary) spare' in ft(pg, '.tz-guess') and pg.locator('.tz-air').count() == 0, 'Brave\'s guess alone: no air check yet'
        pg.click('#tzSpareYes'); pg.wait_for_timeout(200)
        assert T(pg)['spare']['kind'] == 'compact' and pg.locator('.tz-guess').count() == 0 and pg.input_value('#tzSpare') == 'compact'
        assert "hasn't been checked" in ft(pg, '.tz-air'), 'picked: now its air is asked for'
        # ---- tread: estimated from miles and rotation, or measured ----
        pg.fill('#tzMiles', '30000'); pg.dispatch_event('#tzMiles', 'change'); pg.wait_for_timeout(150)
        pg.select_option('#tzRot', 'yes'); pg.wait_for_timeout(200)
        out = ft(pg, '.tz-out'); print('  estimate:', out.replace('\n', ' | '))
        assert 'About 6.5/32 in left' in out and 'Plenty left' in out and '65,000-mile warranty' in out, out
        pg.select_option('#tzRot', 'no'); pg.wait_for_timeout(200)
        assert 'About 5/32 in left' in ft(pg, '.tz-out') and 'Plan new tires' in ft(pg, '.tz-out') and 'skipped rotations' in ft(pg, '.tz-out')   # 10 - 8 x 30k / (65k x 0.75)
        pg.screenshot(path=f'{OUT}/{name}-t1-tires.png', full_page=True)
        pg.click('#tzMode [data-mode="measure"]'); pg.wait_for_timeout(200)
        pg.select_option('#tzDepth', '3'); pg.wait_for_timeout(200)
        assert '3/32 in left' in ft(pg, '.tz-out') and 'Replace them soon' in ft(pg, '.tz-out') and 'About' not in ft(pg, '.tz-out').split('\n')[0]
        # the (?) explains the coin test
        pg.evaluate("document.querySelector('#tzDepth').closest('label').querySelector('.qi').scrollIntoView({ block: 'center' })"); pg.wait_for_timeout(300)
        pg.click('#tzDepth >> xpath=ancestor::label//button[contains(@class,"qi")]'); pg.wait_for_timeout(200)
        assert 'Lincoln' in ft(pg, '.qpop') and 'Washington' in ft(pg, '.qpop'); pg.evaluate('window.__closeQ && window.__closeQ()')
        # ---- Advisory: replace soon (red dot); a B traction grade is mentioned ----
        pg.click('#tzDet'); pg.wait_for_selector('.sub-page #tzTrac')
        pg.select_option('#tzTrac', 'B'); pg.wait_for_timeout(200); pg.click('.sub-back'); pg.wait_for_timeout(200)
        pg.evaluate('window.__trip.step(2)'); pg.wait_for_timeout(400)
        at = ft(pg, '#advTires'); print('  advisory:', at.replace('\n', ' | '))
        assert 'Tires: replace soon' in at and '3/32 in' in at and 'traction grade is B' in at and pg.locator('#advTires.warn').count() == 1
        assert pg.locator('#tpSteps [data-step="2"].attn').count() == 1
        pg.evaluate('window.__trip.step(1)'); pg.wait_for_timeout(300); show(pg, 'corolla20')
        pg.select_option('#tzDepth', '8'); pg.click('#tzDet'); pg.wait_for_selector('.sub-page #tzTrac')
        pg.select_option('#tzTrac', 'A'); pg.wait_for_timeout(200); pg.click('.sub-back'); pg.wait_for_timeout(200)
        # ---- Advisory: the tires' cold pressure, ticked once a month; Next waits for it ----
        pg.evaluate("window.__mocks.tireAir = false"); pg.evaluate('window.__trip.step(2)'); pg.wait_for_timeout(300)
        assert 'Tire pressure' in ft(pg, '#advTires') and 'driver\'s door jamb' in ft(pg, '#advTires') and pg.locator('[data-tchk="tires"]:checked').count() == 0
        pg.click('#tNext'); pg.wait_for_timeout(100)
        assert pg.evaluate('window.__trip.state().step') == 2 and pg.locator('#advTires .adv-chk.pulse [data-tchk="tires"]').count() == 1, 'Next waits for the tire pressure (its box pulses first)'
        pg.check('[data-tchk="tires"]'); pg.wait_for_timeout(250)
        assert T(pg)['airedAt'] > 0 and 'Set ' in ft(pg, '#advTires')
        # ---- Advisory: the spare's air, ticked once a month (until then: a red dot) ----
        pg.evaluate('window.__trip.step(2)'); pg.wait_for_timeout(300)
        at = ft(pg, '#advTires'); print('  advisory, spare:', at.replace('\n', ' | '))
        assert 'Tires: replace' not in at and 'Spare tire air' in at and '60 psi' in at and pg.locator('#tpSteps [data-step="2"].attn').count() == 1
        pg.check('[data-tchk="spare"]'); pg.wait_for_timeout(250)
        assert pg.locator('[data-tchk="spare"]:checked').count() == 1 and pg.locator('#tpSteps [data-step="2"].attn').count() == 0 and 'Checked ' in ft(pg, '#advTires')
        assert T(pg)['spare']['aired'] > 0
        pg.evaluate("() => { window.Garage.car().tires.spare.aired = Date.now() - 31 * 864e5; window.dispatchEvent(new Event('garagechange')); }"); pg.wait_for_timeout(250)
        assert pg.locator('[data-tchk="spare"]:checked').count() == 0 and pg.locator('#tpSteps [data-step="2"].attn').count() == 1, 'a month later: again'
        # until it's ticked, Advisory's Next doesn't go on (the box pulses) and the later steps are grayed out
        assert pg.locator('#tpSteps [data-step="3"].dim').count() == 1
        pg.click('#tNext'); pg.wait_for_timeout(300)
        assert pg.evaluate('window.__trip.state().step') == 2, 'Next waits for the spare'
        pg.check('[data-tchk="spare"]'); pg.wait_for_timeout(250)
        assert pg.locator('#tpSteps [data-step="3"].dim').count() == 0, 'ticked: the steps open up'
        pg.evaluate('window.__trip.step(1)'); pg.wait_for_timeout(300); show(pg, 'corolla20')
        assert 'Air checked' in ft(pg, '.tz-air')
        # a car without a spare, whose answer says you can buy one: the tip under "What your car has" (and no air check)
        pg.evaluate("() => { const sp = window.Garage.car().tires.spare; window.__sp0 = JSON.stringify(sp); sp.kind = 'kit'; sp.lookup = Object.assign({}, sp.lookup, { guess: 'kit', tip: 'Owners who desire a spare can purchase one separately, with the correct temporary spare size being T125/70D17.' }); window.dispatchEvent(new Event('garagechange')); }")
        pg.evaluate('window.__trip.step(2)'); pg.wait_for_timeout(200); pg.evaluate('window.__trip.step(1)'); pg.wait_for_timeout(300); show(pg, 'corolla20')
        assert 'T125/70D17' in ft(pg, '.tz-tip') and pg.locator('.tz-air.ok').count() == 0, ft(pg, '#gTiresIn')
        pg.evaluate("() => { Object.assign(window.Garage.car().tires.spare, JSON.parse(window.__sp0)); window.dispatchEvent(new Event('garagechange')); }")
        pg.evaluate('window.__trip.step(2)'); pg.wait_for_timeout(200); pg.evaluate('window.__trip.step(1)'); pg.wait_for_timeout(300); show(pg, 'corolla20')
        # ---- tires that aren't all the same: each corner, where they should go (front-wheel drive) ----
        pg.check('#tzSplit'); pg.wait_for_timeout(200)
        for k, d in (('lf', '8'), ('rf', '8'), ('lr', '6'), ('rr', '6')): pg.select_option('[data-corner="%s"]' % k, d); pg.wait_for_timeout(120)
        rot = ft(pg, '.tz-rot'); print('  rotation:', rot.replace('\n', ' | '))
        assert 'Move these tires' in rot and 'Driver front → Driver rear' in rot and 'two best tires on the rear' in rot
        assert '6/32 in left' in ft(pg, '.tz-out') and 'Driver rear' in ft(pg, '.tz-out'), 'the shallowest tire counts'
        pg.select_option('[data-corner="lf"]', '4'); pg.select_option('[data-corner="rf"]', '3'); pg.select_option('[data-corner="lr"]', '7'); pg.select_option('[data-corner="rr"]', '7'); pg.wait_for_timeout(200)
        rot = ft(pg, '.tz-rot'); assert 'Replace before rotating' in rot and 'instead of rotating them to the back' in rot, rot
        # an EPA-rated hybrid can't be a dually: no switch
        assert pg.locator('#tzDually').count() == 0 and pg.locator('.tz-pic .tz-w').count() == 4
        # ---- tow mode: "Car tire details", and a tile for each trailer; the hooked-up ones' tires count ----
        pg.check('#tzTow'); pg.wait_for_selector('.sub-page [data-axles]')
        assert ft(pg, '.sub-page h2') == 'Trailer tire details · Trailer' and pg.locator('.sub-page [id$="_Hooked"]').count() == 0, 'a new trailer is hooked up: it opens to fill in, no switch'
        assert [ft(pg, '.tz-trbtns .btn:nth-child(%d)' % i) for i in (1, 2, 3)] == ['Delete', 'Unhook', 'Discard changes']
        tid = pg.evaluate("window.Garage.car().tires.trailers[0].id")
        pg.click('[data-tr="%s"][data-axles="2"]' % tid); pg.wait_for_timeout(150); pg.click('[data-tr="%s"][data-per="4"]' % tid); pg.wait_for_timeout(150)
        pg.screenshot(path=f'{OUT}/{name}-t2a-trailer-page.png')
        pg.click('.sub-back'); pg.wait_for_timeout(200)
        assert 'Car tire details' in ft(pg, '#tzDet') and pg.locator('#tzTr_%s' % tid).count() == 1 and '2 axles × 4 tires' in ft(pg, '#tzTr_%s' % tid), 'Back keeps the changes'
        assert pg.locator('#tzSaved').count() == 0, 'nothing unhooked: no Saved trailers'
        assert pg.locator('.tz-pic .tz-w').count() == 12 and pg.locator('[data-corner]').count() == 12, 'two axles of four'
        assert pg.locator('[aria-label="Trailer, axle 2, passenger side outer"]').count() == 1
        # its tires aren't filled in: the Garage won't go on (fill them in, or discard the tire changes); Advice warns
        assert 'missing a tread depth' in ft(pg, '#tzMiss') and 'Discard tire changes' in ft(pg, '#tzMiss')
        assert 'Your tires could be unsafe' in pg.evaluate("Tires.advice(window.Garage.car()).map(x => x.title).join('|')")
        pg.click('#tNext'); pg.wait_for_timeout(300); assert pg.evaluate('window.__trip.state().step') == 1, 'Garage waits for the tires'
        assert pg.locator('#tpSteps [data-step="2"].dim').count() == 1
        for k in ['%s:a1lo', '%s:a1li', '%s:a1ri', '%s:a1ro', '%s:a2lo', '%s:a2li', '%s:a2ri']: pg.select_option('[data-corner="%s"]' % (k % tid), '8'); pg.wait_for_timeout(60)
        pg.select_option('[data-corner="%s:a2ro"]' % tid, '2'); pg.wait_for_timeout(200)
        assert pg.locator('#tzMiss').count() == 0 and 'At the legal limit' in ft(pg, '.tz-out') and 'Trailer, axle 2, passenger side outer' in ft(pg, '.tz-out')
        fill = pg.evaluate("[...document.querySelectorAll('.tz-pic .tz-w rect')].map(r => r.style.fill)[11]"); assert 'rgb' in fill or 'hsl' in fill, fill
        assert pg.locator('#tpSteps [data-step="2"].dim').count() == 0, 'all filled in: on you go'
        # a second trailer, hooked up too: chained behind; its tires missing: discard brings back the last complete set
        pg.click('#tzAddTr'); pg.wait_for_selector('.sub-page #ttUnhook')
        t2 = pg.evaluate("window.Garage.car().tires.trailers[1].id")
        pg.click('#ttUnhook'); pg.wait_for_timeout(200)
        assert pg.locator('.sub-page').count() == 0 and pg.locator('#tzTr_%s' % t2).count() == 0 and '1 not hooked up' in ft(pg, '#tzSaved')
        bar = pg.evaluate("(() => { const a = document.querySelector('#tzAddTr').getBoundingClientRect(), b = document.querySelector('#tzSaved').getBoundingClientRect(), p = document.querySelector('.tz-trbar').getBoundingClientRect(); return [Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2), p.right - b.right]; })()")
        assert bar[0] < 2 and bar[1] < 1, ('Saved trailers: in line with Add, on the right', bar)
        pg.click('#tzSaved'); pg.wait_for_selector('.sub-page [data-hook]')
        pg.click('[data-hook="%s"]' % t2); pg.wait_for_timeout(200)
        assert pg.locator('.sub-page').count() == 0, 'the last one hooked up: the list closes'
        assert pg.locator('.tz-pic .tz-w').count() == 14 and pg.locator('#tzMiss').count() == 1
        pg.screenshot(path=f'{OUT}/{name}-t2b-trailer.png')
        pg.click('#tzDiscard'); pg.click('#cfmYes'); pg.wait_for_timeout(200)
        assert pg.locator('#tzMiss').count() == 0 and pg.locator('.tz-pic .tz-w').count() == 12 and pg.locator('#tzSaved').count() == 1, 'back to the last complete set (the second trailer, unhooked)'
        assert pg.evaluate("window.Garage.car().tires.trailers[1].hooked") is False
        # Discard changes: back to how it was when the page opened
        pg.click('#tzTr_%s' % tid); pg.wait_for_selector('.sub-page [data-axles]')
        pg.click('[data-tr="%s"][data-axles="1"]' % tid); pg.wait_for_timeout(150)
        assert pg.locator('.tz-pic .tz-w').count() == 8
        o = pg.evaluate(OVER); pg.evaluate(BIG.replace('#gTires *', '.sub-page *')); pg.wait_for_timeout(100); o += pg.evaluate(OVER)
        assert not o, 'trailer page sideways: ' + str(o)
        pg.click('#ttDiscard'); pg.click('#cfmYes'); pg.wait_for_timeout(200)
        assert pg.evaluate("window.Garage.car().tires.trailers[0].axles") == 2 and pg.locator('.tz-pic .tz-w').count() == 12 and pg.evaluate("window.Garage.car().tires.corners['%s:a2ro'].depth" % tid) == 2
        # Delete: from Saved trailers → Edit
        pg.click('#tzSaved'); pg.wait_for_selector('.sub-page [data-edit]'); pg.click('[data-edit="%s"]' % t2); pg.wait_for_selector('.sub-page #ttDel')
        pg.click('#ttDel'); pg.wait_for_timeout(200)
        if pg.locator('.cfm-go').count(): pg.click('.cfm-go'); pg.wait_for_timeout(250)
        assert pg.evaluate("window.Garage.car().tires.trailers.length") == 1 and pg.locator('#tzSaved').count() == 0 and pg.locator('.sub-page').count() == 0
        pg.evaluate("document.querySelector('.tz-pic').scrollIntoView({block:'start'})"); pg.wait_for_timeout(150)
        pg.uncheck('#tzTow'); pg.wait_for_timeout(200)
        assert pg.locator('.tz-pic .tz-w').count() == 4 and 'Car tire details' not in ft(pg, '#tzDet')
        # ---- by mileage: each tire opens its own page; miles, warranty (from the car's tire details) and rotation ----
        pg.click('[data-by="miles"]'); pg.wait_for_timeout(200)
        assert pg.locator('[data-tire]').count() == 4 and pg.locator('[data-tire].need').count() == 4 and 'missing details' in ft(pg, '#tzMiss')
        pg.click('[data-tire="lf"]'); pg.wait_for_selector('.sub-page #tpMiles')
        assert pg.input_value('#tpWarranty') == '65000', 'the warranty from the car\'s tire details'
        pg.fill('#tpMiles', '30000'); pg.dispatch_event('#tpMiles', 'change'); pg.wait_for_timeout(100)
        pg.select_option('#tpRot', 'yes'); pg.wait_for_timeout(150)
        assert 'About 6.5/32 in left' in ft(pg, '.sub-page .tz-out'), ft(pg, '.sub-page')
        pg.screenshot(path=f'{OUT}/{name}-t2d-tire.png')
        pg.click('.sub-back'); pg.wait_for_timeout(200)
        assert '30,000 mi · 65k warranty' in ft(pg, '[data-tire="lf"]') and pg.locator('[data-tire].need').count() == 3
        pg.click('#tzDiscard'); pg.click('#cfmYes'); pg.wait_for_timeout(200)
        assert pg.locator('[data-tire]').count() == 0 and pg.locator('[data-corner]').count() == 4, 'discarded: back to the measured set'
        # ---- dual rear wheels: a heavy pickup nothing settles shows the switch; a VIN that says DRW turns it on ----
        pg.evaluate("() => { const c = window.Garage.car(); window.__keep = { type: c.type, epaId: c.epaId, epa: c.epa }; c.type = 'truck'; delete c.epaId; c.epa = null; window.Garage.redraw(); }"); pg.wait_for_timeout(300)
        if pg.locator('#gTires[open]').count() == 0: pg.click('#gTires summary'); pg.wait_for_timeout(200)
        assert pg.locator('#tzDually').count() == 1
        pg.check('#tzDually'); pg.wait_for_timeout(200)
        assert pg.locator('[data-corner="lri"]').count() == 1 and pg.locator('[data-corner="rri"]').count() == 1 and pg.locator('.tz-pic .tz-w').count() == 6
        pg.select_option('[data-corner="rri"]', '7'); pg.select_option('[data-corner="lri"]', '3'); pg.wait_for_timeout(200)
        assert 'rear duals differ by 4/32' in ft(pg, '.tz-rot'), ft(pg, '.tz-rot')
        pg.evaluate("document.querySelector('.tz-pic').scrollIntoView({block:'start'})"); pg.wait_for_timeout(150)
        pg.screenshot(path=f'{OUT}/{name}-t2c-dually.png')
        pg.uncheck('#tzDually'); pg.wait_for_timeout(200)
        pg.evaluate("() => { const c = window.Garage.car(); Object.assign(c, window.__keep); c.info = Object.assign({}, c.info, { drw: 'yes' }); window.Garage.redraw(); }"); pg.wait_for_timeout(300)
        if pg.locator('#gTires[open]').count() == 0: pg.click('#gTires summary'); pg.wait_for_timeout(200)
        assert pg.locator('#tzDually').count() == 1 and 'VIN%20says' in pg.inner_html('#gTiresIn'), 'the VIN says DRW: shown even with an EPA record'
        pg.evaluate("() => { const c = window.Garage.car(); c.info.drw = 'no'; window.Garage.redraw(); }"); pg.wait_for_timeout(300)
        if pg.locator('#gTires[open]').count() == 0: pg.click('#gTires summary'); pg.wait_for_timeout(200)
        assert pg.locator('#tzDually').count() == 0, 'the VIN rules it out: hidden'
        pg.evaluate("document.getElementById('tzSplit').scrollIntoView({block:'start'})"); pg.wait_for_timeout(150)
        pg.screenshot(path=f'{OUT}/{name}-t2-corners.png')
        # ---- the "why" pictures: submenus that play an animation ----
        pg.click('[data-why="tread"]'); pg.wait_for_selector('.sub-page #anStop svg')
        pg.wait_for_timeout(1200); pg.screenshot(path=f'{OUT}/{name}-t3a-why-moving.png')
        # it loops, with the rain falling all the time: drops keep moving
        y0 = pg.evaluate("document.querySelector('#anStop .rn-drop').getAttribute('y1')"); pg.wait_for_timeout(300)
        assert pg.evaluate("document.querySelector('#anStop .rn-drop').getAttribute('y1')") != y0, 'continuous rain'
        # a moment after they've all stopped (the animation jumped there and held)
        pg.evaluate("document.getElementById('anStop').__anim.at(4.2)")
        nose = pg.evaluate(r'''() => [...document.querySelectorAll('#anStop .an-car')].map(g => +/translate\(([\d.]+)/.exec(g.getAttribute('transform'))[1])''')
        line = pg.evaluate("+document.querySelector('#anStop .il-stop').getAttribute('x1')"); print('  cars stopped at', nose, '| stop sign at', line)
        assert abs(nose[0] - line) < 0.6 and nose[1] > line + 20 and nose[2] > nose[1] + 20, 'new tires stop at the sign (on its near side); worn ones slide past it'
        car0 = pg.evaluate("(() => { const b = document.querySelector('#anStop .an-car').getBBox(); return [b.x, b.x + b.width]; })()")
        assert car0[1] <= 0.6, 'the car is drawn behind its nose: left of the stop line'
        brake = pg.evaluate("+document.querySelector('#anStop .an-brake').getAttribute('x')"); assert brake < -30, 'brake light at the back'
        assert '68 ft past the sign' in pg.inner_html('#anStop') and pg.locator('#anStop .an-sign').count() == 1 and 'started braking' in pg.inner_html('#anStop')
        assert 'Treadwell' in ft(pg, '.sub-page') and pg.locator('#tpBody #anStop').count() == 0
        pg.screenshot(path=f'{OUT}/{name}-t3-why.png')
        pg.evaluate("document.getElementById('anStop').__anim.at(4.95)")
        op = pg.evaluate("[...document.querySelectorAll('#anStop .an-car')].map(g => +g.getAttribute('opacity'))"); assert all(0 < o < 1 for o in op), ('fading out', op)
        pg.click('.sub-back'); pg.wait_for_timeout(150); assert pg.locator('.sub-page').count() == 0, 'Back closes it'
        pg.click('[data-why="back"]'); pg.wait_for_selector('.sub-page #anSteer svg')
        pg.wait_for_timeout(2600); pg.screenshot(path=f'{OUT}/{name}-t4a-steer-moving.png')
        pg.evaluate("document.getElementById('anSteer').__anim.at(5.9)")
        under = pg.evaluate("[...document.querySelectorAll('#anSteer .an-under')].map(u => u.style.display !== 'none')"); print('  upside down:', under)
        assert under == [False, False, True], 'understeer twice: still on its wheels; oversteer: rolled onto its roof'
        bubs = pg.evaluate("[...document.querySelectorAll('#anSteer .an-bub')].map(b => b.textContent + ' ' + b.getAttribute('opacity'))"); print('  bubbles:', bubs)
        assert bubs == ['Phew! 1.00', "I'm okay! 1.00", 'Not okay! Help! 1.00'], bubs
        assert pg.evaluate("+document.querySelector('#anSteer .an-fire').getAttribute('opacity')") > 0.9, 'the rolled car is on fire'
        # understeer 1 ends back on the road; understeer 2 off it
        off = pg.evaluate(r'''() => [...document.querySelectorAll('#anSteer .an-tcar')].slice(0, 2).map(c => {
          const g = c.parentNode, road = g.querySelector('.il-road'), m = /translate\(([\d.]+) ([\d.]+)\)/.exec(c.getAttribute('transform'));
          const x = +m[1], y = +m[2], L = road.getTotalLength(); let best = 1e9;
          for (let s = 0; s <= L; s += 1) { const p = road.getPointAtLength(s); best = Math.min(best, Math.hypot(p.x - x, p.y - y)); }
          return Math.round(best); })''')
        print('  understeer cars from the road center:', off); assert off[0] <= 6 and off[1] >= 18, off
        pg.screenshot(path=f'{OUT}/{name}-t4-steer.png')
        assert pg.evaluate('window.onBack()') and pg.locator('.sub-page').count() == 0, "the phone's Back button closes it too"
        pg.uncheck('#tzSplit'); pg.wait_for_timeout(200)
        assert '8/32 in left' in ft(pg, '.tz-out'), 'all the same again: the single answer'
        # no sideways scrolling, also at 130% text
        o = pg.evaluate(OVER); pg.evaluate(BIG); pg.wait_for_timeout(100); o += pg.evaluate(OVER)
        assert not o, 'sideways: ' + str(o)
        # ---- the Venza XLE: two factory sizes -> pick one ----
        show(pg, 'venza12')
        pg.wait_for_function("window.Garage.car().tires && window.Garage.car().tires.sizeLookup && window.Garage.car().tires.sizeLookup.found", timeout=5000); pg.wait_for_timeout(200)
        pg.click('#tzDet'); pg.wait_for_selector('.sub-page #tzSize')
        assert pg.locator('#tzPick [data-size]').count() == 2 and pg.input_value('#tzSize') == '' and 'came with 2 sizes' in ft(pg, '.sub-page')
        reads = pg.evaluate('window.__tr'); print('  Venza reads:', [r.get('models') or r.get('url', '')[-60:] for r in reads[-3:]])
        assert any('autoModel=Venza%20FWD&autoModClar=XLE%20V6' in r.get('url', '') for r in reads), 'Tire Rack files it as "Venza FWD" + "XLE V6": matched from trim, drive and engine'
        assert any(r['step'] == 'clars' and r['models'] == ['Venza FWD'] for r in reads), 'the AWD model is never asked about for a FWD car'
        assert 'Your version at Tire Rack' in ft(pg, '.sub-page') and pg.input_value('#tzVerSel') == 'v:Venza FWD\u001fXLE V6', 'the match shows, to change if it is wrong'
        pg.click('#tzPick [data-size="245/50R20"]'); pg.wait_for_timeout(300)
        assert T(pg)['size'] == '245/50R20' and pg.input_value('#tzSize') == '245/50R20', 'picked: the page shows it'
        pg.click('.sub-back'); pg.wait_for_timeout(200)
        # ---- a model with no versions at Tire Rack (its size page won't show those): read through its vehicle menu ----
        pg.evaluate('''() => { const S = window.__app.S; S.cars.push({ id: 'cq', name: '2020 Toyota Sequoia', year: 2020, make: 'Toyota', model: 'Sequoia', trim: '', epaId: '1', power: 'gas', grade: 'regular', epa: { city: 13, hwy: 17, comb: 15 }, obs: {}, entries: [], info: { src: {}, featSrc: {} } }); }''')
        show(pg, 'cq'); pg.wait_for_timeout(300)
        pg.click('#tzDet'); pg.wait_for_selector('.sub-page #tzSize')
        pg.wait_for_function("window.Garage.car().tires.size === '275/55R20'", timeout=5000)
        oe = [r for r in pg.evaluate('window.__tr') if r['step'] == 'oesize']
        assert oe and oe[-1]['model'] == 'Sequoia' and oe[-1]['clar'] == '' and oe[-1]['url'].endswith('/tires/brands'), oe
        assert not any(r['step'] == 'size' and 'Sequoia' in r.get('url', '') for r in pg.evaluate('window.__tr')), 'never the size page that only says "currently unavailable"'
        pg.click('.sub-back'); pg.wait_for_timeout(200)
        # ---- a trim Tire Rack doesn't know; a blocked lookup; typed sizes ----
        pg.evaluate('''() => { const S = window.__app.S; S.cars.push({ id: 'cz', name: '2019 Honda Fit', year: 2019, make: 'Honda', model: 'Fit', trim: 'Sport', epaId: '1', power: 'gas', grade: 'regular', epa: { city: 33, hwy: 40, comb: 36 }, obs: {}, entries: [], info: { src: {}, featSrc: {} } }); }''')
        show(pg, 'cz'); pg.wait_for_timeout(300)
        pg.click('#tzDet'); pg.wait_for_selector('.sub-page #tzSize')
        pg.wait_for_selector('.sub-page #tzVerSel option[value="v:Fit\u001fLX"]', state='attached')
        assert pg.input_value('#tzSize') == '' and 'Pick your version' in ft(pg, '.sub-page'), 'the trim "Sport" isn\'t one of Tire Rack\'s names: you pick'
        opts_ = pg.evaluate("[...document.querySelectorAll('#tzVerSel option')].map(o => (o.parentElement.label || '') + ':' + o.textContent)")
        print('  Fit versions:', opts_)
        assert opts_[0] == ':Choose…' and opts_[1] == 'As Tire Rack names them:Fit Sport w/Honda Sensing' and len(opts_) == 4, 'yours first: it has your trim word'
        assert [r['models'] for r in pg.evaluate('window.__tr') if r['step'] == 'clars'][-1] == ['Fit'], 'Civic Sedan is another car'
        pg.select_option('#tzVerSel', 'v:Fit\u001fSport w/Honda Sensing'); pg.wait_for_function("window.Garage.car().tires.size === '185/55R16'", timeout=4000)
        assert T(pg)['trVer'] == {'key': 'v3|2019|Honda|Fit', 'model': 'Fit', 'clar': 'Sport w/Honda Sensing', 'auto': False} and pg.evaluate('window.Garage.car().trim') == 'Sport', 'the car keeps its own trim'
        assert 'Factory size for the 2019 Honda Fit Sport w/Honda Sensing, from Tire Rack' in ft(pg, '.sub-page') and pg.input_value('#tzVerSel') == 'v:Fit\u001fSport w/Honda Sensing', 'picked: its factory size; the menu stays to change it'
        # another version: its own size (Tire Rack has none for the EX here)
        pg.select_option('#tzVerSel', 'v:Fit\u001fEX'); pg.wait_for_timeout(400)
        assert not T(pg).get('size') and 'Tire Rack has no sizes for the 2019 Honda Fit EX' in ft(pg, '.sub-page'), 'a version without sizes says so'
        pg.evaluate("() => { const t = window.Garage.car().tires; t.size = ''; t.sizeSrc = ''; t.trVer = null; }")
        pg.click('.sub-back'); pg.wait_for_timeout(200); pg.click('#tzDet'); pg.wait_for_selector('.sub-page #tzSize')
        pg.fill('#tzSize', '185 55 16'); pg.dispatch_event('#tzSize', 'change'); pg.wait_for_timeout(250)
        assert 'looks like 195/65R15' in pg.inner_text('#toast') and not T(pg).get('size')
        pg.evaluate("window.__trMode = 'blocked'")
        pg.fill('#tzSize', 'p185/55-16'); pg.dispatch_event('#tzSize', 'change'); pg.wait_for_timeout(400)
        t = T(pg); assert t['size'] == '185/55R16' and t['sizeSrc'] == 'user'
        assert "Couldn't get Tire Rack's list" in ft(pg, '.sub-page') and pg.locator('#tzBrandT, #tzModelT').count() == 2, 'blocked: type the brand and model'
        types = opts(pg, '#tzType'); assert 'Winter' in types and 'All-weather (snow-rated)' in types, 'the general types without a list'
        n = len(pg.evaluate('window.__tr')); pg.evaluate("window.dispatchEvent(new Event('garagechange'))"); pg.wait_for_timeout(300)
        assert len(pg.evaluate('window.__tr')) == n, 'a failed lookup waits a few hours before trying again'
        pg.close()
    # ---- the Tire Rack page reader (stand-in pages in Tire Rack's text layout) ----
    pg = b.new_page()
    SIZEPAGE = '<h1>See all tire sizes for: 2020 TOYOTA COROLLA HYBRID LE</h1><p>WHAT TIRE SIZE IS ON YOUR VEHICLE?</p><p>Factory Tire Size Optional Tire Sizes Custom Tire Size</p><h2>Factory Tire Size</h2><p>15"</p><p>195/65-15</p><a>View Results</a><h2>Optional Tire Sizes</h2><p>17"</p><p>215/45-17</p><p>Need help?</p>'
    r = reader(pg, SIZEPAGE, {'step': 'size'}); print('  size reader:', r)
    assert r == {'factory': ['195/65R15'], 'optional': ['215/45R17']}, r
    # Tire Rack's vehicle picker, asked from its own page (stand-in answers in its XML format)
    PICKERPAGE = ('<h1>Tires for Sale</h1>' + 'x' * 300 + '<script>window.__asked = []; window.fetch = async (u) => { window.__asked.push(u); const xml = /autoModel=/.test(u)'
                  ' ? (/Sienna%20FWD/.test(u) ? "<clarifiers><clar>LE 4cyl</clar><clar>LE V6</clar></clarifiers>" : "<clarifiers></clarifiers>")'
                  ' : /autoMake=toyota/.test(u) ? "<models></models>" : /autoMakesNeeded/.test(u) ? "<makes><make>Ford</make><make>Toyota</make></makes>"'
                  ' : "<models><model>Sienna AWD</model><model>Sienna FWD</model></models>";'
                  ' return { ok: true, status: 200, headers: { get: () => "text/xml" }, text: async () => xml }; };</script>')
    r = reader(pg, PICKERPAGE, {'step': 'models', 'make': 'Toyota', 'year': 2011}, 2500); print('  models reader:', r)
    assert r == {'make': 'Toyota', 'models': ['Sienna AWD', 'Sienna FWD']}, r
    assert pg.evaluate('window.__asked') == ['/survey/ValidationServlet?autoYear=2011&autoMake=Toyota&newDesktop=true']
    r = reader(pg, PICKERPAGE, {'step': 'models', 'make': 'toyota', 'year': 2011}, 4000); print('  models reader (make spelled differently):', r)
    assert r == {'make': 'Toyota', 'models': ['Sienna AWD', 'Sienna FWD']} and len(pg.evaluate('window.__asked')) == 3, 'asks for the makes, then the models as Tire Rack spells the make'
    r = reader(pg, PICKERPAGE, {'step': 'clars', 'make': 'Toyota', 'year': 2011, 'models': ['Sienna FWD', 'Sienna AWD']}, 3000); print('  clarifiers reader:', r)
    assert r == {'clars': {'Sienna FWD': ['LE 4cyl', 'LE V6'], 'Sienna AWD': []}}, r
    assert pg.evaluate('window.__asked')[0] == '/survey/ValidationServlet?autoYear=2011&autoMake=Toyota&autoModel=Sienna%20FWD&newDesktop=true'
    BUSY = PICKERPAGE.replace('const xml =', 'const xml = "<html><body>We\'re sorry. This page is currently unavailable.</body></html>"; const _x =')
    assert reader(pg, BUSY, {'step': 'models', 'make': 'Toyota', 'year': 2011}, 2500).get('blocked'), 'Tire Rack saying "slow down" is a block, never retried in a loop'
    assert reader(pg, "<p>We're sorry. This page is currently unavailable.</p>", {'step': 'clars', 'make': 'Toyota', 'year': 2011, 'models': ['Sienna FWD']}).get('blocked')
    # a model with no versions: set the vehicle the way Tire Rack's menu does, then read its tire-size panel
    OEPAGE = ('<h1>Tires for Sale</h1>' + 'x' * 300 + '<script>window.__asked = []; window.fetch = async (u) => { window.__asked.push(u); const body = /SetCurrentVehicle/.test(u)'
              ' ? (/Nonsense/.test(u) ? \'{"vehicleZipSet":"redirect","redirect":"/tires"}\' : \'{"vehicleZipSet":"success"}\')'
              ' : \'<div>Select the correct tire size for your \' + (/Stale/.test(u) ? "2016 Toyota Prius Two" : "2005 Ford Mustang Coupe") + \' &nbsp; Change Factory Tire Size 16" 215/65-16 Don\\\'t see your tire size? Optional Size(s) The optional sizes listed below fit most vehicles. 17" 235/55-17 18" 255/45-18 Front Size 18" 255/45-18 Rear Size 18" 285/40-18 Custom Tire Size Warning</div>\';'
              ' return { ok: true, status: 200, text: async () => body }; };</script>')
    r = reader(pg, OEPAGE, {'step': 'oesize', 'make': 'Ford', 'year': 2005, 'model': 'Mustang Coupe', 'clar': ''}, 3000); print('  vehicle-menu size reader:', r)
    assert r == {'factory': ['215/65R16'], 'optional': ['235/55R17', '255/45R18', '285/40R18']}, r
    asked = pg.evaluate('window.__asked')
    assert asked[0].startswith('/SetCurrentVehicleServlet?ajax=true&') and 'autoModel=Mustang%20Coupe&autoModClar=&' in asked[0] and asked[1].startswith('/modalPopups/selectOETireSize.jsp?'), asked
    assert reader(pg, OEPAGE, {'step': 'oesize', 'make': 'Ford', 'year': 2005, 'model': 'Mustang Nonsense', 'clar': ''}, 3000).get('unknown'), 'a vehicle Tire Rack sends elsewhere'
    assert reader(pg, OEPAGE, {'step': 'oesize', 'make': 'Ford', 'year': 2005, 'model': 'Mustang Stale', 'clar': ''}, 3000).get('unknown'), 'a panel for another vehicle (the last one set) is never read as this one'
    assert reader(pg, "<p>We're sorry. This page is currently unavailable.</p>", {'step': 'oesize', 'make': 'Ford', 'year': 2005, 'model': 'Mustang Coupe', 'clar': ''}).get('blocked')
    LISTPAGE = ('<div><p>GRAND TOURING ALL-SEASON</p><p>Category Ratings Charts</p>'
                '<p>CONTINENTAL SECURECONTACT AW</p><p>Grand Touring All-Season</p><p>Reviews (28)</p><p>$153.99</p><p>Size: 195/65R15 91H</p><p>Load Range: SL</p><p>UTQG: 700 A A</p><p>More information on UTQG</p><p>60K Mile Manufacturer\'s Warranty</p>'
                '<p>BRIDGESTONE BLIZZAK WS90</p><p>Studless Ice &amp; Snow</p><p>Size: 195/65R15 91T</p><p>Free Road Hazard Protection</p>'
                '<p>MICHELIN DEFENDER2</p><p>Standard Touring All-Season</p><p>Size: 195/65R15 91H</p><p>UTQG: 820 A B</p><p>80K Mile Manufacturer\'s Warranty</p></div>')
    r = reader(pg, LISTPAGE, {'step': 'list'}); print('  list reader:', r)
    tz = {x['name']: x for x in r['tires']}
    assert list(tz) == ['CONTINENTAL SECURECONTACT AW', 'BRIDGESTONE BLIZZAK WS90', 'MICHELIN DEFENDER2'], list(tz)
    assert tz['CONTINENTAL SECURECONTACT AW'] == {'name': 'CONTINENTAL SECURECONTACT AW', 'type': 'Grand Touring All-Season', 'size': '195/65R15', 'serviceDesc': '', 'loadRange': 'SL', 'utqg': {'tw': 700, 'trac': 'A', 'temp': 'A'}, 'warrantyMi': 60000}
    assert tz['BRIDGESTONE BLIZZAK WS90']['utqg'] is None and tz['BRIDGESTONE BLIZZAK WS90']['type'] == 'Studless Ice & Snow'
    assert tz['MICHELIN DEFENDER2']['utqg'] == {'tw': 820, 'trac': 'A', 'temp': 'B'} and tz['MICHELIN DEFENDER2']['warrantyMi'] == 80000
    assert reader(pg, "<p>We're sorry. This page is currently unavailable.</p>", {'step': 'list'}).get('blocked')
    assert reader(pg, "<p>We're sorry. This page is currently unavailable.</p>", {'step': 'size'}).get('blocked')
    pg.close()
    b.close()
print('JS errors:', errors or 'none')
assert not errors
print('tire tests passed')
