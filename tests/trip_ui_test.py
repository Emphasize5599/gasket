"""Trip planner end to end in a headless browser at Pixel 10 Pro / Pixel 8 Pro sizes, with stand-in APIs."""
import sys, os, json
from playwright.sync_api import sync_playwright
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
URL = 'file://' + os.path.join(ROOT, 'assets', 'web', 'index.html')
MOCKS = open(os.path.join(ROOT, 'tests', 'trip_mocks.js')).read()
LINK = ('https://www.google.com/maps/dir/North+Little+Rock,+AR+72114/Dallas,+TX/@34,-94,7z/data=!4m19!4m18!1m5!1m1!1s0x1:0x2!2m2!1d-92.2671!2d34.7695'
        '!1m5!1m1!1s0x3:0x4!2m2!1d-96.797!2d32.7767!2m3!1b0!2b1!3b0!3e0!5i1')
errors = []
def ft(pg, sel):
    # visible text plus whatever sits behind (?) buttons
    return pg.evaluate('''(s) => { const e = document.querySelector(s); if (!e) throw new Error('no ' + s);
      return e.innerText + '\\n' + [...e.querySelectorAll('.qi')].map(b => decodeURIComponent(b.dataset.q).replace(/<[^>]+>/g, '')).join('\\n'); }''', sel)
def idle(pg, t=900):
    # settings changes re-plan on their own (after a short pause): wait for that to finish
    pg.wait_for_timeout(t)
    pg.wait_for_function("!window.__trip.state().busy", timeout=15000); pg.wait_for_timeout(250)
def nxt(pg, t=700):
    pg.click('#tNext'); pg.wait_for_timeout(t)
    pg.wait_for_function("!window.__trip.state().busy", timeout=15000); pg.wait_for_timeout(200)
OVER = '''() => { const W = innerWidth, out = [];
  document.querySelectorAll('#trip *, #tripPick *').forEach(e => {
    if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') return;
    if (e.closest('.leaflet-container') && !e.classList.contains('leaflet-container')) return;
    let p = e.parentElement, scroller = false;
    while (p && p.id !== 'trip') { const ox = getComputedStyle(p).overflowX; if ((ox === 'auto' || ox === 'scroll') && p.id !== 'tpBody') { scroller = true; break; } p = p.parentElement; }
    if (scroller) return;
    const r = e.getBoundingClientRect(); if (!r.width) return;
    if (r.right > W + 0.5 || r.left < -0.5) out.push((e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + String(e.className).split(' ').join('.')) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
  });
  const b = document.getElementById('tpBody'); if (b && b.scrollWidth > b.clientWidth + 1) { out.unshift('tpBody scrollWidth ' + b.scrollWidth + ' > ' + b.clientWidth);
    let culprit = null; b.querySelectorAll('.tp-step:not(.hidden) *').forEach(e => { const d = e.style.display; e.style.display = 'none'; if (b.scrollWidth <= b.clientWidth + 1) culprit = e; e.style.display = d; });
    if (culprit) out.push('culprit: ' + culprit.outerHTML.slice(0, 160));
    b.querySelectorAll('*').forEach(e => { if (e.closest('.leaflet-container')) return; const r = e.getBoundingClientRect(); if (r.width && r.right > W + 0.5 && out.length < 12) out.push('~' + (e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + String(e.className).split(' ').join('.')) + ' ' + Math.round(r.left) + '..' + Math.round(r.right) + ' ' + getComputedStyle(e).position); }); }
  return out.slice(0, 12); }'''
WIDE = []
BIG = '''() => { const els = [...document.querySelectorAll('#trip .tp-head *, #trip .tp-nav *, #trip .tp-step:not(.hidden) *')].filter(e => !e.dataset.big && !e.closest('.leaflet-container'));
  const fs = els.map(e => parseFloat(getComputedStyle(e).fontSize)); els.forEach((e, i) => { e.style.fontSize = (fs[i] * 1.3) + 'px'; e.dataset.big = 1; }); }'''
def stress(pg, label):
    # long place names and a 130% font size (Android's font-size setting scales WebView text): still no sideways scrolling
    pg.evaluate('''() => { const r = window.__trip.state().route; r.stops.forEach((s, i) => { s.short = ['500 Woodlane Street, Little Rock, Arkansas', '210 Capitol Ave, Hartford, Connecticut', '1600 Pennsylvania Avenue NW, Washington'][i % 3]; }); }''')
    for k in [1, 2, 3, 4, 5]:
        goto(pg, k); wide(pg, label + ' step %d long names' % k)
        pg.evaluate(BIG); pg.wait_for_timeout(150); wide(pg, label + ' step %d big text' % k)
        if k == 5: pg.screenshot(path=f'{OUT}/{name}-z4-stress.png')
def wide(pg, label):
    o = pg.evaluate(OVER)
    if o: print('  TOO WIDE at', label, o); WIDE.append((label, o))
def setchk(pg, sel, on):
    pg.evaluate("([s, on]) => { const e = document.querySelector(s); e.checked = on; e.dispatchEvent(new Event('change')); }", [sel, on])
def getr(pg, t=700):
    pg.click('#tGetRoutes'); pg.wait_for_timeout(t)
    pg.wait_for_function("!window.__trip.state().busy", timeout=15000); pg.wait_for_timeout(200)
def step(pg): return pg.evaluate('window.__trip.state().step')
def goto(pg, k): pg.evaluate('(k) => window.__trip.step(k)', k); pg.wait_for_timeout(250)
def settings(pg): goto(pg, 3)          # Parameters
def stops(pg, t=900): goto(pg, 4); idle(pg, t)   # back to Stops: re-planned from the saved stations
def mi(pg): return round(pg.evaluate('window.__trip.state().model.totalMi'))
def replan(pg):
    idle(pg, 300); pg.evaluate('window.__trip.find()'); idle(pg, 400)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/google/chrome/chrome', args=['--no-sandbox'])
    for name, w, h, scheme in ([(n, int(W), 915, 'dark') for n, W in [os.environ['ONLY'].split(':')]] if os.environ.get('ONLY') else [('pixel10pro', 412, 915, 'dark'), ('pixel8pro', 448, 998, 'light')]):
        pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=2.6, color_scheme=scheme, is_mobile=True, has_touch=True)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'tile' not in m.text and 'ERR_' not in m.text and errors.append(m.text))
        pg.goto(URL); pg.evaluate('setInsets(44, 24, 0, 0)'); pg.wait_for_timeout(400)
        pg.fill('#apiKey', 'AIzaSyTESTKEY0123456789abcdefghijklmnop'); setchk(pg, 'input[data-k=debug]', True); pg.select_option('#logLevel', '4'); pg.click('#sDone'); pg.wait_for_timeout(600)
        pg.evaluate("window.__app.S.citgoUsed = { tuesday: window.__app.P.monthKey(), friday: window.__app.P.monthKey() }")  # CITGO day bonuses off: results don't depend on the weekday
        pg.evaluate(MOCKS)
        pg.click('#btnTrip'); pg.wait_for_timeout(300)
        assert pg.locator('#tripPick').count() == 0 and step(pg) == 1, 'no saved trips: straight to a new trip'
        steps = pg.text_content('#tpSteps'); print(name, 'steps:', steps.replace('\n', ' '))
        assert all(x in steps for x in ['Garage', 'Route', 'Stops', 'Departure']) and pg.locator('#tBack').count() == 0 and pg.locator('#tNext').count() == 1
        cnt = ft(pg, '#apiCount'); print('  lookup counter:', cnt); assert ' / 900' in cnt
        pg.screenshot(path=f'{OUT}/{name}-w1-garage.png'); wide(pg, 'garage')
        # EPA lookup
        # ---- garage: your two cars are there, EPA numbers read-only, the rest behind Edit ----
        chips = ft(pg, '#gCars'); head = ft(pg, '.g-head'); tiles = ft(pg, '.epa-tiles')
        print('  cars:', chips.replace('\n', ' | '), '||', head.replace('\n', ' | '), '||', tiles.replace('\n', ' '))
        assert '2020 Corolla Hybrid' in chips and '2012 Venza' in chips and 'Corolla Hybrid' in head and 'gal tank' not in head and 'Hybrid' not in head and '54' in tiles and '50' in tiles
        assert pg.locator('.epa-tiles input').count() == 0 and pg.locator('#gTank').count() == 0, 'EPA not editable; tank only after Edit'
        assert pg.locator('.g-car').count() == 1 and pg.locator('.g-econ').count() == 1 and pg.locator('.epa-note').count() == 0
        assert pg.locator('.epa-tiles .qi').count() == 3, 'a (?) in each of city / highway / combined'
        pg.click('.epa-tiles > div:first-child .qi'); pg.wait_for_timeout(150)
        qp = pg.evaluate("document.querySelector('.qpop') ? document.querySelector('.qpop').innerText : ''"); print('  city (?):', qp[:90])
        assert '21 mph' in qp; pg.evaluate('window.__closeQ && window.__closeQ()')
        assert pg.locator('#gObs[open]').count() == 0, 'observed mileage starts collapsed'
        pg.screenshot(path=f'{OUT}/{name}-g0-tiles.png')
        pg.click('#gObs summary'); pg.wait_for_timeout(150)
        pg.click('#gEdit'); pg.wait_for_timeout(150)
        assert pg.input_value('#gTank') == '11.3' and pg.input_value('#gType') == 'hybrid'
        pg.screenshot(path=f'{OUT}/{name}-g1-edit.png'); wide(pg, 'garage edit')
        pg.click('#gEdit'); pg.wait_for_timeout(150)
        # observed mileage <-> % of EPA
        pg.fill('#oHwy', '45'); pg.wait_for_timeout(100)
        print('  obs hwy 45 -> pct', pg.input_value('#oPct'))
        assert pg.input_value('#oPct') == '95', pg.input_value('#oPct')
        pg.fill('#oPct', '110'); pg.wait_for_timeout(100)
        assert pg.input_value('#oCity') == '59.4' and pg.input_value('#oHwy') == '55', (pg.input_value('#oCity'), pg.input_value('#oHwy'))
        pg.fill('#oPct', '100'); pg.wait_for_timeout(400)
        assert pg.input_value('#oCity') == '' and pg.input_value('#oHwy') == ''
        # best cruising speed: hybrid, balanced (no time value)
        assert pg.locator('details.spd-card[open]').count() == 0, 'general speed card starts collapsed'
        print('  speed card (collapsed):', ft(pg, '#tSpeed').replace('\n', ' | '))
        pg.click('details.spd-card > summary'); pg.wait_for_timeout(200)
        sp = ft(pg, '#tSpeed'); print('  speed card:', sp.replace('\n', ' | ')[:420])
        assert 'best cruising speed · 2016 corolla' in sp.lower() and '70mph' in sp and 'recommended' in sp and 'Not calibrated yet' in sp
        assert pg.locator('#gChart .zone').count() == 1
        x0 = pg.get_attribute('#gChart .sel-l', 'x1')
        pg.fill('#gTripMi', '1300'); pg.dispatch_event('#gTripMi', 'change')
        pg.evaluate("() => { const r = document.getElementById('gTry'); r.value = 78; r.dispatchEvent(new Event('input')); }"); pg.wait_for_timeout(100)
        out = ft(pg, '#gTryOut'); print('  try 78:', out)
        assert '78 mph instead of 70' in out and 'sooner' in out and '+$' in out and '1,300 mi' in out
        assert pg.get_attribute('#gChart .sel-l', 'x1') != x0 and pg.text_content('#gChart .sel-t') == '78', 'line follows the slider'
        # log an observed tank with the speed you held -> calibrates
        pg.fill('#lMpg', '52'); pg.select_option('#lKind', 'highway'); pg.fill('#lSpeed', '72'); pg.click('#lAdd'); pg.wait_for_timeout(400)
        lg = ft(pg, '.log-list'); sp = ft(pg, '#tSpeed'); print('  log:', lg.replace('\n', ' | '), '||', [l for l in sp.split('\n') if 'Calibrated' in l])
        assert '52.0 mpg' in lg and 'at 72 mph' in lg and 'Calibrated from 1 of your entries' in sp
        pg.fill('#lMpg', '61'); pg.select_option('#lKind', 'mixed'); pg.click('#lAdd'); pg.wait_for_timeout(300)   # no speed: still fine
        assert pg.locator('.log-row').count() == 2 and 'Calibrated from 1 of' in ft(pg, '#tSpeed')
        pg.evaluate("document.getElementById('tSpeed').scrollIntoView()"); pg.wait_for_timeout(150)
        pg.screenshot(path=f'{OUT}/{name}-g2-speed.png'); wide(pg, 'garage speed')
        # with a time value
        pg.click('.spd-set summary'); pg.fill('#sTime', '10'); pg.dispatch_event('#sTime', 'change'); pg.wait_for_timeout(200)
        sp = ft(pg, '#tSpeed'); print('  at $10/hr:', sp.split('\n')[0:4])
        assert '84 mph' in sp and 'gas never outweighs' in sp
        pg.fill('#sTime', '0'); pg.dispatch_event('#sTime', 'change'); pg.wait_for_timeout(200)
        pg.fill('#sPrice', '3.50'); pg.dispatch_event('#sPrice', 'change'); pg.wait_for_timeout(200)
        assert '$3.50/gal' in ft(pg, '.spd-set summary')
        pg.fill('#sPrice', ''); pg.dispatch_event('#sPrice', 'change'); pg.wait_for_timeout(200)
        # the Venza: its own card
        pg.click('[data-car="venza12"]'); pg.wait_for_timeout(300)
        sp = ft(pg, '#tSpeed'); print('  Venza:', sp.split('\n')[0:3])
        assert 'venza' in sp.lower() and '65 mph' in sp and 'Venza' in ft(pg, '.g-head')
        pg.screenshot(path=f'{OUT}/{name}-g3-venza.png')
        # add a car from the EPA (the trip tests below use it)
        pg.click('[data-car="+"]'); pg.wait_for_timeout(400)
        pg.click('#tNext'); pg.wait_for_timeout(250)
        assert step(pg) == 1 and pg.locator('#eYear.pulse').count() == 1, 'Next points at the car lookup (pulse)'
        pg.screenshot(path=f'{OUT}/{name}-w2-need-pick.png'); wide(pg, 'new car')
        pg.select_option('#eYear', '2021'); pg.wait_for_timeout(200)
        pg.select_option('#eMake', 'Honda'); pg.wait_for_timeout(200)
        pg.select_option('#eModel', 'Accord'); pg.wait_for_timeout(600)
        print('  car:', ft(pg, '.g-head').replace('\n', ' | '), '|', ft(pg, '.epa-tiles').replace('\n', ' '), '|', ft(pg, '#eMsg'))
        assert 'Accord' in ft(pg, '.g-head') and '30' in ft(pg, '.epa-tiles') and "doesn't publish it" in ft(pg, '#eMsg')
        pg.click('#tNext'); pg.wait_for_timeout(250)
        assert step(pg) == 1 and pg.locator('#gTank.need').count() == 1, 'Next outlines the empty tank box'
        pg.screenshot(path=f'{OUT}/{name}-w3-need-box.png')
        pg.fill('#gTank', '12'); pg.dispatch_event('#gTank', 'change'); pg.wait_for_timeout(200); pg.click('#gEdit')
        nxt(pg); assert step(pg) == 2
        # ---- Route ----
        print('  gate:', pg.locator('#tNext.dim').count(), pg.locator('#tpSteps [data-step="3"].dim').count(), pg.evaluate('!!window.__trip.state().model'), pg.locator('#tGetRoutes').count()); assert pg.locator('#tNext.dim').count() == 1 and pg.locator('#tpSteps [data-step="3"].dim').count() == 1, 'no routes yet: Next and later steps grayed'; pg.click('#tNext'); pg.wait_for_timeout(250);
        assert step(pg) == 2 and pg.locator('#tLink.need').count() == 1, 'no link: the link box is outlined'
        pg.fill('#tLink', LINK); pg.wait_for_timeout(700)
        print(name, 'parsed:', ft(pg, '#tParsed').replace('\n', ' | '))
        assert pg.locator('#tParsed .nlist li').count() == 2 and [x.strip() for x in pg.locator('#tParsed .nlist .nn').all_inner_texts()] == ['1', '2']
        assert all(x not in ft(pg, '#tParsed') for x in ['START', 'Start', 'END', '✓', 'route option']), 'numbered list only'
        assert pg.locator('#tAvoid [data-av="tolls"].on').count() == 1, 'avoid tolls from the link'
        assert 'North Little Rock, AR 72114' in ft(pg, '#tParsed'), 'full address shown'
        pg.screenshot(path=f'{OUT}/{name}-t1-setup.png'); wide(pg, 'route')
        getr(pg)
        assert step(pg) == 2 and pg.locator('#tNext.dim').count() == 0 and pg.locator('.rt-ready #tRefreshRoutes').count() == 1, 'routes in: Next available'
        body = pg.evaluate('window.__routeBody')
        assert body['routeModifiers']['avoidTolls'] is True and body['origin']['location']['latLng']['latitude'] == 34.7695, body
        print('  route:', ft(pg, '#tRouteInfo').replace('\n', ' | '))
        assert pg.evaluate('window.__finds') is None, 'link stops had exact coordinates: no lookups'
        assert 'matches your link' in ft(pg, '.alts-pick button.on'), 'route option from the link pre-selected'
        pg.evaluate("document.querySelector('.alts-pick').scrollIntoView({block:'center'})"); pg.wait_for_timeout(150)
        pg.screenshot(path=f'{OUT}/{name}-t1b-routes.png'); wide(pg, 'route options')
        pg.click('.alts-pick [data-alt="0"]'); pg.wait_for_timeout(150)
        assert mi(pg) == 318 and pg.locator('.rc-top').count() == 0
        pg.click('.alts-pick [data-alt="1"]'); pg.wait_for_timeout(150)
        assert mi(pg) == 330
        assert pg.locator('#tRmap .rmap-fit.hidden').count() == 1, 'Route button hidden until you move the map'
        pg.evaluate("(() => { const m = document.getElementById('tRmap'); m.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, clientX: 200, clientY: 120})); })()")
        box = pg.locator('#tRmap').bounding_box(); pg.mouse.move(box['x'] + 150, box['y'] + 120); pg.mouse.down(); pg.mouse.move(box['x'] + 80, box['y'] + 60, steps=5); pg.mouse.up(); pg.wait_for_timeout(200)
        assert pg.locator('#tRmap .rmap-fit:not(.hidden)').count() == 1, 'shows after you drag the small map'
        pg.click('#tRmap .rmap-fit'); pg.wait_for_timeout(500)
        assert pg.locator('#tRmap .rmap-fit.hidden').count() == 1, 'and goes away once it re-centers'
        # ---- Parameters ----
        pg.evaluate("window.__app.S.trip.milesLeft = ''")
        nxt(pg); assert step(pg) == 3 and pg.locator('#trip.full').count() == 1, 'Parameters: full screen'
        pg.click('#tNext'); pg.wait_for_timeout(250)
        assert step(pg) == 3 and pg.locator('#tMiles.need').count() == 1, 'miles left outlined'
        pg.screenshot(path=f'{OUT}/{name}-w3b-need-miles.png')
        pg.fill('#tMiles', '80'); pg.fill('#tBuffer', '30')
        pg.fill('#tMinSave', '1'); pg.fill('#tMaxMin', '10')
        pg.screenshot(path=f'{OUT}/{name}-p1-params.png'); wide(pg, 'parameters')
        # ---- Stops ----
        nxt(pg, 1500); assert step(pg) == 4; idle(pg)
        ph = pg.evaluate("document.getElementById('trip').getBoundingClientRect().height / innerHeight"); print('  Stops panel height:', round(ph, 2))
        assert abs(ph - 0.75) < 0.03, 'Stops opens at 75% of the screen'
        assert pg.locator('.tp-step:not(.hidden) .res-head').count() == 0, 'no trip title on Stops'
        sh0 = ft(pg, '#tsStopsH'); print('  stops header:', sh0.replace('\n', ' | ')); assert 'chosen from' in sh0 and 'stations' in sh0
        arr = ft(pg, '.gas-tiles').lower(); print('  gas tiles:', arr.replace('\n', ' | ')); assert pg.locator('.gas-tiles .ideal').count() == 2 and 'gas when you arrive' in arr and 'mi of range' in arr and 'buffer' not in arr
        print('  notes:', pg.evaluate('JSON.stringify(window.__trip.state().result && window.__trip.state().result.notes)'), pg.evaluate('typeof window.__siteMock'))
        print('  google jobs:', len(pg.evaluate('window.__jobs')), '| walmart price ids:', pg.evaluate('window.__wmPriceIds'))
        assert pg.evaluate('window.__wmPriceIds') == ['777'], 'only on-route Walmart priced'
        xo = pg.evaluate("(() => { const c = window.__trip.state().result.cands; const f = (n, mi) => c.filter(x => x.station.name === n && Math.abs(x.d - mi) < 8)[0]; const m = f('Mobil', 205), e = f('Exxon', 38); return { urls: (window.__xomUrls || []).length, mobil205: m && [m.price, m.station.wplus], exxon38: e && [e.price, e.station.wplus] }; })()")
        print('  Walmart+ at Exxon/Mobil:', xo)
        assert xo['urls'] >= 1 and xo['mobil205'] == [3.199, False] and xo['exxon38'][1] is True and abs(xo['exxon38'][0] - 3.199) < 0.001, 'not-in-program Mobil loses the 10c'
        txt = ft(pg, '.tp-step:not(.hidden)')
        print('  RESULT:', txt.replace('\n', ' | ')[:900])
        pg.screenshot(path=f'{OUT}/{name}-t2-result.png'); wide(pg, 'stops')
        rb0 = pg.evaluate("Math.max(...[...document.querySelectorAll('.leaflet-overlay-pane path')].map(p => p.getBoundingClientRect().width))"); assert rb0 > 60, 'route drawn and framed on Stops'
        pg.wait_for_timeout(600)
        idl = ft(pg, '#tsIdeal'); print('  gas to leave with:', idl.replace('\n', ' | ')[:200])
        # it comes from the plan itself: if stop 1 is at the start, that's what to add; never a different station
        st1 = pg.evaluate("(r => r.plan.stops[0] && [r.plan.stops[0].c.d, +r.plan.stops[0].buyGal.toFixed(1), r.plan.stops[0].c.station.name])(window.__trip.state().result)")
        if st1 and st1[0] <= 5: assert ('Add %.1f gal' % st1[1]) in idl and st1[2] in idl, idl
        else: assert 'Nothing to add' in idl, idl
        if 'gal' in idl:
            pg.evaluate("document.getElementById('tsIdeal').scrollIntoView({block:'center'})"); pg.wait_for_timeout(150)
            pg.screenshot(path=f'{OUT}/{name}-t2i-ideal.png')
        # cruising speed per leg: limits from the (mock) FHWA inventory, sliders start at $0
        pg.wait_for_selector('#tsSpeed .leg', timeout=5000)
        assert pg.locator('#tsSpeed .leg[data-leg]').count() == 0 and pg.locator('#tsSpeed.exp').count() == 0, 'road sliders start collapsed'
        assert pg.evaluate("getComputedStyle(document.querySelector('#tsSpeed .spd-stick')).position") != 'sticky', 'not pinned while collapsed'
        pg.click('#lgTog'); pg.wait_for_timeout(300)
        assert pg.locator('#tsSpeed.exp').count() == 1 and pg.evaluate("getComputedStyle(document.querySelector('#tsSpeed .spd-stick')).position") == 'sticky'
        assert pg.evaluate("getComputedStyle(document.querySelector('#tsSpeed .adj-tools')).position") == 'sticky', 'filters pinned while open'
        order = pg.evaluate("[...document.querySelectorAll('#tsSpeed .leg.all, #tsSpeed .road-tog, #tsSpeed .adj-tools, #tsSpeed .road-g')].map(e => e.className.split(' ')[0])")
        print('  speed card order:', order[:4]); assert order[:3] == ['leg', 'road-tog', 'adj-tools'] and order[3] == 'road-g'
        pg.evaluate("document.getElementById('tsSpeed').scrollIntoView({block:'start'})"); pg.wait_for_timeout(200)
        ts = ft(pg, '#tsSpeed'); print('  trip speed:', ts.replace('\n', ' | ')[:700])
        nroads = pg.locator('#tsSpeed .leg[data-leg]').count()
        assert nroads == 3 and ts.index('US-67 S') < ts.index('I-30 W') and '2 speed limits' in ts and 'about 7' not in ts, ts
        assert 'All roads' in ts and '$0.00' in ts and pg.locator('#lgTot.zero').count() == 1 and 'FHWA road inventory' in ts and 'All roads' in ts
        assert pg.evaluate('window.__hpms.length') > 5 and all('HPMS_FULL_' in u for u in pg.evaluate('window.__hpms'))
        pg.evaluate("document.getElementById('tpBody').scrollTop = 0"); pg.wait_for_timeout(1000)   # roads below the selector: the whole route again
        assert pg.locator('#spdSel:not(.hidden)').count() == 0
        frame = "(() => { const sh = document.getElementById('trip').getBoundingClientRect(); let lo = 1e9, hi = -1e9, l = 1e9, r = -1e9; document.querySelectorAll('.leaflet-overlay-pane path').forEach(p => { const b = p.getBoundingClientRect(); if (b.width + b.height < 5) return; lo = Math.min(lo, b.top); hi = Math.max(hi, b.bottom); l = Math.min(l, b.left); r = Math.max(r, b.right); }); return {sheetTop: Math.round(sh.top), sheetH: Math.round(sh.height), routeTop: Math.round(lo), routeBottom: Math.round(hi), left: Math.round(l), right: Math.round(r), W: innerWidth, tall: document.getElementById('trip').classList.contains('tall')}; })()"
        fr = pg.evaluate(frame); print('  route framing (speed section):', fr)
        assert fr['sheetH'] > 0.6 * pg.evaluate('innerHeight'), 'Stops panel at 75%'
        assert fr['routeBottom'] <= fr['sheetTop'] + 2 and fr['routeTop'] >= 0 and fr['left'] >= 0 and fr['right'] <= fr['W'], 'whole route visible above the sheet'
        pg.screenshot(path=f'{OUT}/{name}-s1-trip-speed.png'); wide(pg, 'stops speed')
        # moving the map yourself: it stops re-framing, and a button brings the route back
        pg.evaluate("window.__app.map.fire('dragstart'); window.__app.map.panBy([200, 200], {animate: false})"); pg.wait_for_timeout(200)
        assert pg.locator('#btnFit:not(.hidden)').count() == 1, 'fit button shows after you move the map'
        pg.click('#btnFit'); pg.wait_for_timeout(700)
        fr2 = pg.evaluate(frame); print('  after the Route button:', fr2)
        assert pg.locator('#btnFit.hidden').count() == 1 and fr2['routeBottom'] <= fr2['sheetTop'] + 2 and fr2['routeTop'] >= 0
        # scroll so the first leg is under the chart: the chart stays pinned under the map
        pos = pg.evaluate('''() => { const sh = document.getElementById('tpBody'), box = document.getElementById('tsSpeed'), stick = box.querySelector('.spd-stick');
          sh.scrollTop += box.getBoundingClientRect().top - sh.getBoundingClientRect().top + 220;
          return [sh.getBoundingClientRect().top, stick.getBoundingClientRect().top, box.getBoundingClientRect().top]; }''')
        pg.wait_for_timeout(150); print('  sticky (sheet top, chart top, box top):', [round(x) for x in pos])
        assert abs(pos[1] - pos[0]) < 2 and pos[2] < pos[0] - 100, pos
        pg.wait_for_timeout(350)
        gap = pg.evaluate("(() => { const a = document.querySelector('#tsSpeed .spd-stick').getBoundingClientRect(), b = document.querySelector('#tsSpeed .adj-tools').getBoundingClientRect(); return [Math.round(a.bottom), Math.round(b.top)]; })()")
        print('  pinned chart bottom / filters top:', gap); assert gap[1] >= gap[0] - 1, 'filters not under the chart'
        pg.screenshot(path=f'{OUT}/{name}-s1b-pinned.png')
        # the green selector: the road under it is drawn in green on the map and framed
        pg.wait_for_timeout(700)
        sel = pg.evaluate('''() => ({ band: !!document.querySelector('#spdSel:not(.hidden)'), insel: document.querySelectorAll('#tsSpeed .leg.insel').length,
          green: [...document.querySelectorAll('.leaflet-overlay-pane path')].filter(p => p.getAttribute('stroke') === '#18a957').length })''')
        print('  road selector:', sel); assert sel['band'] and sel['insel'] == 1 and sel['green'] == 1, sel
        pg.screenshot(path=f'{OUT}/{name}-s1c-selector.png')
        print('  pins:', pg.evaluate("[...document.querySelectorAll('.leaflet-tooltip.stopbub')].map(e => { const b = e.getBoundingClientRect(); return [e.className.replace('leaflet-tooltip spin ', ''), Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height), getComputedStyle(e).opacity]; })"), pg.evaluate("window.__app.map.getSize()"))
        pos = pg.evaluate('''() => { const sh = document.getElementById('tpBody'), box = document.getElementById('tsSpeed'), stick = box.querySelector('.spd-stick');
          sh.scrollTop += box.getBoundingClientRect().bottom - sh.getBoundingClientRect().top - 60;
          return [sh.getBoundingClientRect().top, stick.getBoundingClientRect().top, stick.getBoundingClientRect().bottom, box.getBoundingClientRect().bottom, sh.scrollTop + sh.clientHeight >= sh.scrollHeight - 2]; }''')
        pg.wait_for_timeout(150); print('  past the last leg (sheet top, chart top, chart bottom, box bottom):', [round(x) for x in pos])
        assert (pos[4] and pos[2] <= pos[3] + 1) or (pos[1] < pos[0] - 5 and 0 <= pos[3] - pos[2] < 20), 'chart scrolls away with the last leg (or the sheet ends first)'
        x0 = pg.get_attribute('#tChart .sel-l', 'x1')
        pg.evaluate("() => { const r = document.getElementById('lgR1'); r.value = 6; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); }"); pg.wait_for_timeout(150)
        pg.evaluate("() => { const r = document.getElementById('lgR0'); r.value = -5; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); }"); pg.wait_for_timeout(150)
        ts = ft(pg, '#tsSpeed'); print('  after sliding:', [l for l in ts.split('\n') if 'sooner' in l or 'later' in l or 'Time-saving' in l or l.startswith(('+', '−'))])
        tot = ft(pg, '#lgTot'); print('  total:', tot.replace('\n', ' | '))
        assert 'Time-saving cost' in tot and pg.get_attribute('#tChart .sel-l', 'x1') != x0
        assert ft(pg, '#lgSub1').startswith('+$') and ft(pg, '#lgSub0').startswith('−$')
        pg.screenshot(path=f'{OUT}/{name}-s2-trip-speed-slid.png')
        rep_speed = pg.evaluate("JSON.parse(window.__tripReport()).speed")
        assert rep_speed['offsets']['1'] == 6 and rep_speed['stats']['hpms'] > 0 and [r['name'] for r in rep_speed['roads']] == ['US-67 S', 'I-30 W'], rep_speed['roads']
        # the "all roads" slider moves every road
        pg.evaluate("() => { const r = document.getElementById('lgAll'); r.value = 5; r.dispatchEvent(new Event('input')); }"); pg.wait_for_timeout(100)
        assert pg.input_value('#lgR0') == '5' and pg.input_value('#lgR1') == '5' and pg.input_value('#lgR2') == '5' and ft(pg, '#lgAllSub').startswith('+$')
        mk0 = pg.get_attribute('#tChart .mk[data-i="2"]', 'x1')
        pg.evaluate("() => { const r = document.getElementById('lgAll'); r.value = 12; r.dispatchEvent(new Event('input')); }"); pg.wait_for_timeout(100)
        assert pg.get_attribute('#tChart .mk[data-i="2"]', 'x1') != mk0, 'section markers follow the All roads slider'
        # a touch that starts away from the knob (scrolling past) doesn't change the slider
        before = pg.input_value('#lgR1')
        pg.evaluate('''() => { const r = document.getElementById('lgR1'), b = r.getBoundingClientRect();
          r.dispatchEvent(new PointerEvent('pointerdown', { clientX: b.left + 4, clientY: b.top + 5, bubbles: true }));
          r.value = -10; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); }''')
        pg.wait_for_timeout(50)
        assert pg.input_value('#lgR1') == before, 'stray touch ignored'
        pg.evaluate('''() => { const r = document.getElementById('lgR1'), b = r.getBoundingClientRect(), f = (+r.value - +r.min) / (+r.max - +r.min);
          r.dispatchEvent(new PointerEvent('pointerdown', { clientX: b.left + 14 + f * (b.width - 28), clientY: b.top + 5, bubbles: true }));
          r.value = 3; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); }''')
        pg.wait_for_timeout(50)
        assert pg.input_value('#lgR1') == '3', 'dragging the knob works'
        pg.click('#lgReset'); pg.wait_for_timeout(150)
        assert pg.locator('#lgTot.zero').count() == 1
        seen = pg.evaluate('window.__progSeen') or []
        print('  progress seen:', seen[:3], '...')
        assert any('%' in (x or '') for x in seen), seen
        pg.evaluate("document.getElementById('tsSpeed').scrollIntoView({block:'start'})"); pg.wait_for_timeout(300)
        assert pg.locator('#trip.tall').count() == 1
        pg.click('#lgTog'); pg.wait_for_timeout(400)
        assert pg.locator('#trip.tall').count() == 0, 'speed by road closed: back to your height'
        pg.click('#lgTog'); pg.wait_for_timeout(300)
        nxt(pg); assert step(pg) == 5 and pg.locator('.kpis.four #tShare').count() == 1 and pg.locator('#tsDone, #tsEdit, #tsExport').count() == 0
        dep = ft(pg, '.tp-step:not(.hidden)'); print('  departure:', dep.replace('\n', ' | ')[:500])
        assert pg.locator('.tp-step:not(.hidden) .nlist li').count() == 2 and 'trip cost' in dep and 'Trip cost is the' not in pg.inner_text('.tp-step:not(.hidden)')
        assert pg.locator('#tpNav #tOpen').count() == 1 and 'Google Maps' in ft(pg, '#tOpen')
        pg.screenshot(path=f'{OUT}/{name}-w4-departure.png')
        ms = pg.evaluate('''() => { const t = []; for (const k of [4, 3, 2, 1, 2, 3, 4, 5]) { const a = performance.now(); window.__trip.step(k); t.push(Math.round(performance.now() - a)); } return t; }''')
        print('  step switch ms (4,3,2,1,2,3,4,5):', ms); pg.wait_for_timeout(300); wide(pg, 'departure')
        pg.evaluate("window.__shared = null"); pg.click('#tShare'); pg.wait_for_timeout(200)
        sh = pg.evaluate('window.__shared')
        shtxt = sh['text'] if isinstance(sh, dict) else str(sh)
        print('  shared trip:', shtxt[:300].replace('\n', ' | '))
        assert 'Open in Google Maps: https://www.google.com/maps/dir/' in shtxt and '-----FUEL+ TRIP-----' in shtxt, shtxt
        pg.evaluate("window.__shared = null; window.__saved = null"); pg.click('#tsReport'); pg.wait_for_timeout(200)
        rep = pg.evaluate('window.__shared'); rtxt = rep['text'] if isinstance(rep, dict) else str(rep)
        rj = json.loads(rtxt)
        assert rj['fuelPlusReport'] == 1 and rj['plan']['stops'] and 'apiKey' not in rj['settings'] and 'AIza' not in rtxt, list(rj.keys())
        assert pg.evaluate('window.__saved'), 'saved to downloads'
        print('  report keys:', list(rj.keys()), 'candidates', len(rj['candidates']))
        SHARED_TRIP = shtxt
        pg.click('#tBack'); pg.wait_for_timeout(300); assert step(pg) == 4
        # default speed rule: +9 over the limit but never above 74 -> 70 roads get +4, 75 roads stay at 75
        settings(pg)
        setchk(pg, '#tRule', True); pg.fill('#tRuleOver', '9'); pg.fill('#tRuleCap', '74'); pg.dispatch_event('#tRuleCap', 'change'); stops(pg)
        if not pg.locator('#tsSpeed.exp').count(): pg.click('#lgTog'); pg.wait_for_timeout(300)
        pg.wait_for_selector('#lgR2', timeout=5000)
        vals = [pg.input_value('#lgR%d' % i) for i in range(3)]; rl = ft(pg, '.leg.all .leg-h'); print('  rule +9 up to 74:', vals, '|', rl)
        assert vals == ['4', '4', '0'] and 'rule: +9, up to 74 mph' in rl and 'change rule' in rl and pg.locator('.rule-line').count() == 0 and ft(pg, '#lgTot').find('+$') >= 0
        settings(pg); setchk(pg, '#tRule', False); stops(pg)
        # buffer <-> speed: stops are planned at your speeds, so every station (and the end) is reached with at least the buffer
        tank0 = pg.evaluate("(() => { const S = window.__app.S, c = S.cars.filter(c => c.id === S.carId)[0] || S.cars[0]; const t = c.tank; c.tank = 3; return t; })()")
        replan(pg)     # re-plan with a 3-gal tank: stations ~110 mi of range apart matter
        arrive_ok = "(() => { const r = window.__trip.state().result, p = r.plan, b = r.opts.bufferGal; return p.ok && (p.firstDip || p.stops.every(s => s.arriveGal >= b - 0.11)) && p.arriveGal >= r.opts.arriveGal - 0.11; })()"
        if not pg.locator('#tsSpeed.exp').count(): pg.click('#lgTog'); pg.wait_for_timeout(300)
        pg.wait_for_selector('#lgAll', timeout=5000); pg.wait_for_timeout(600)
        probe = pg.evaluate("(() => { const G = window.__trip.guard(), r = window.__trip.state().result; return {maxAll: G.maxAll(), buf: r.bufMi, sweep: (r.sweep||[]).map(x => x.mi + (x.ok ? '' : 'x')).join(' ')}; })()")
        print('  speed/buffer probe (linked):', probe)
        pg.evaluate("(() => { const i = document.getElementById('lgAll'); i.value = 15; i.dispatchEvent(new Event('input')); })()"); pg.wait_for_timeout(200)
        v = int(pg.input_value('#lgAll')); print('  All roads dragged to +15 ->', v)
        assert v == probe['maxAll'], 'slider stops at the edge of the gray'
        pg.evaluate("(() => { const i = document.getElementById('lgAll'); i.dispatchEvent(new Event('change')); })()"); pg.wait_for_timeout(1500)
        r2 = pg.evaluate("(() => { const r = window.__trip.state().result; return {buf: r.bufMi, all: r.speedState.all, stops: r.plan.stops.length, net: +r.plan.totals.net.toFixed(2)}; })()"); print('  after release (linked):', r2)
        assert pg.evaluate(arrive_ok), 'every station reached with at least the buffer, at these speeds'
        # a bigger buffer at fast speeds: linked -> slows down (or stays) so a plan still exists
        try: pg.wait_for_selector('#tsBuf', timeout=8000)
        except Exception: print('  JS errors so far:', errors[-3:], '| box:', ft(pg, '#tsBufBox')[:200]); raise
        pg.wait_for_timeout(400)
        pg.evaluate("(() => { const i = document.getElementById('tsBuf'); i.value = i.max; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); })()"); pg.wait_for_timeout(1500)
        r3 = pg.evaluate("(() => { const r = window.__trip.state().result; return {buf: r.bufMi, all: r.speedState.all}; })()"); print('  linked: buffer to the top ->', r3)
        assert pg.evaluate(arrive_ok)
        pg.wait_for_selector('#tsBufBox', timeout=5000); pg.wait_for_timeout(300)
        print('  buffer box:', ft(pg, '#tsBufBox').replace('\n', ' | ')[:260], '| gray bands:', pg.locator('.buf-marks .bgray').count())
        pg.evaluate("document.getElementById('tsSpeed').scrollIntoView({block:'start'})"); pg.wait_for_timeout(200)
        pg.screenshot(path=f'{OUT}/{name}-c1-speed-linked.png')
        # unlinked, big buffer: the speed slider stops at the gray, with a warning on both sides; the buffer's gray shows too
        settings(pg)
        setchk(pg, '#tLinkSl', False); pg.fill('#tBuffer', '60'); pg.dispatch_event('#tBuffer', 'input'); pg.wait_for_timeout(200)
        pg.evaluate("document.getElementById('tLinkSl').scrollIntoView({block:'center'})"); pg.wait_for_timeout(150)
        pg.screenshot(path=f'{OUT}/{name}-c0-settings.png'); wide(pg, 'stop settings')
        stops(pg, 1200)
        if not pg.locator('#tsSpeed.exp').count(): pg.click('#lgTog'); pg.wait_for_timeout(300)
        pg.wait_for_selector('#lgAll', timeout=5000); pg.wait_for_timeout(800)
        buf0 = pg.evaluate('window.__trip.state().result.bufMi'); mx = pg.evaluate("window.__trip.guard().maxAll()")
        pg.evaluate("(() => { const i = document.getElementById('lgAll'); i.value = 15; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); })()"); pg.wait_for_timeout(1500)
        print('  unlinked,', buf0, '-mi buffer: All roads max', mx, '| slider at', pg.input_value('#lgAll'), '| buffer', pg.evaluate('window.__trip.state().result.bufMi'))
        assert int(pg.input_value('#lgAll')) == mx and pg.evaluate('window.__trip.state().result.bufMi') == buf0, 'unlinked: buffer stays, speed stops'
        assert pg.evaluate(arrive_ok)
        if mx < 15:
            assert 'buffer keeps this' in ft(pg, '#lgWarnAll'), ft(pg, '#lgWarnAll')
        pg.wait_for_selector('#tsBuf', timeout=5000); pg.wait_for_timeout(600)
        bb = ft(pg, '#tsBufBox'); nb = pg.locator('.buf-marks .bgray').count(); print('  unlinked buffer box:', bb.replace('\n', ' | ')[:240], '| gray bands:', nb)
        pg.evaluate("document.getElementById('tsSpeed').scrollIntoView({block:'start'})"); pg.wait_for_timeout(200)
        pg.screenshot(path=f'{OUT}/{name}-c3-speed-unlinked.png')
        pg.evaluate("document.getElementById('tsBufBox').scrollIntoView({block:'center'})"); pg.wait_for_timeout(200)
        pg.screenshot(path=f'{OUT}/{name}-c2-buffer-unlinked.png')
        # road filters and sorting
        pg.evaluate("document.getElementById('lgShow').scrollIntoView({block:'center'})")
        n_all = pg.locator('#tsSpeed .road-g').count()
        pg.click('#lgShow [data-cls="interstate"]'); pg.wait_for_timeout(300)
        n_f = pg.locator('#tsSpeed .road-g').count(); print('  roads shown:', n_all, '-> without Interstates', n_f)
        assert n_f < n_all and 'hidden' in ft(pg, '#tsSpeed')
        pg.click('#lgShow [data-cls="interstate"]'); pg.wait_for_timeout(300)
        pg.select_option('#lgSort', 'limit'); pg.wait_for_timeout(300)
        pg.click('#lgDir'); pg.wait_for_timeout(300)
        lims = pg.evaluate("[...document.querySelectorAll('#tsSpeed .leg[data-leg] .lim')].map(e => +e.textContent)"); print('  sorted by limit, descending:', lims)
        assert lims == sorted(lims, reverse=True), lims
        pg.select_option('#lgSort', 'route'); pg.wait_for_timeout(200)
        settings(pg); setchk(pg, '#tLinkSl', True); pg.fill('#tBuffer', '30'); pg.dispatch_event('#tBuffer', 'input')
        stops(pg, 1200)
        pg.evaluate("(() => { const r = window.__trip.state().result; r.speedState.offsets = {}; r.speedState.all = 0; })()")
        pg.evaluate("(t) => { const S = window.__app.S, c = S.cars.filter(c => c.id === S.carId)[0] || S.cars[0]; c.tank = t; }", tank0)
        replan(pg)
        # finding stops again on the same route reuses the saved search (no Google lookups); "Get fresh prices" searches again
        pg.evaluate("window.__jobs = null"); replan(pg)
        assert pg.evaluate('window.__jobs') is None, 'saved search reused'
        sv = ft(pg, '.note.saved'); print('  second search:', sv)
        assert 'Prices from' in sv and 'Get fresh prices' in sv
        pg.click('#tsRefresh'); idle(pg, 600)
        assert pg.evaluate('window.__jobs') and pg.locator('.note.saved').count() == 0, 'fresh search'
        print('  refreshed with', len(pg.evaluate('window.__jobs')), 'Google lookups')
        # buffer slider: checks other buffers in the background, marks where a smaller one saves money
        pg.wait_for_selector('#tsBuf', timeout=5000)
        pg.evaluate("document.getElementById('tsBufBox').scrollIntoView({block:'center'})"); pg.wait_for_timeout(200)
        bt = ft(pg, '#tsBufBox'); print('  buffer box:', bt.replace('\n', ' | '))
        sweep = pg.evaluate("window.__trip.state().result.sweep.map(x => [x.mi, x.ok, x.net && +x.net.toFixed(2), x.mark])")
        print('  sweep:', sweep)
        assert pg.input_value('#tsBuf') == '30' and 'Buffer for this trip' in bt
        pg.screenshot(path=f'{OUT}/{name}-t2b-buffer.png')
        marks = [x for x in sweep if x[3] and x[0] < 30]
        if marks:
            m = marks[-1][0]
            pg.evaluate("(v) => { const i = document.getElementById('tsBuf'); i.value = v; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); }", m)
            pg.wait_for_timeout(300)
            bt2 = ft(pg, '#tsBufBox'); print('  after slide to', m, ':', bt2.replace('\n', ' | '))
            assert pg.evaluate('window.__trip.state().result.bufMi') == m and 'For this trip only' in bt2
        # too much buffer: refused, stays put
        cur = pg.evaluate('window.__trip.state().result.bufMi')
        pg.evaluate("() => { const i = document.getElementById('tsBuf'); i.value = i.max; i.dispatchEvent(new Event('change')); }"); pg.wait_for_timeout(300)
        print('  max buffer ->', pg.evaluate('window.__trip.state().result.bufMi'), '| ok at max:', sweep[-1][1])
        if not sweep[-1][1]: assert pg.evaluate('window.__trip.state().result.bufMi') == cur
        # other routes: plan the trip on I-30 too, where (in this test) gas is 35c cheaper
        pg.evaluate("window.__cheapI30 = true; window.__alongRoutes = {}")
        settings(pg); setchk(pg, '#tAltCmp', True); pg.fill('#tAltSave', '2'); pg.dispatch_event('#tAltSave', 'input'); stops(pg, 1500)
        assert pg.evaluate('window.__alongRoutes') == {'I-30': True, 'US-67': True}, pg.evaluate('window.__alongRoutes')
        print('  compare:', pg.evaluate("JSON.stringify((window.__trip.state().result.routes||[]).map(e=>[e.k, e.res.plan.ok, e.res.plan.totals && e.res.plan.totals.net]))"), pg.evaluate("document.querySelector('.tp-step:not(.hidden)') && document.querySelector('.tp-step:not(.hidden)').innerText.slice(0,300)"))
        rb = ft(pg, '.routebox'); print('  route box:', rb.replace('\n', ' | '))
        assert 'Cheaper route: via I-30 W' in rb, rb
        pg.evaluate("document.querySelector('.routebox').scrollIntoView({block:'center'})"); pg.wait_for_timeout(150)
        pg.screenshot(path=f'{OUT}/{name}-t2c-otherroute.png')
        pg.click('.routebox [data-route="0"]'); pg.wait_for_timeout(400)
        after = ft(pg, '.tp-step:not(.hidden)'); print('  switched:', mi(pg), '|', [l for l in after.split('\n') if 'Also checked' in l])
        assert mi(pg) == 318 and 'via US-67 S and I-30 W' in after and 'Cheaper route' not in after
        goto(pg, 5); dn = ft(pg, '.tp-step:not(.hidden) .warns'); print('  departure notes:', dn.replace('\n', ' | ')); assert 'avoid tolls' in dn and len(dn) < 200; goto(pg, 4)
        pg.evaluate("window.__cheapI30 = false"); settings(pg); setchk(pg, '#tAltCmp', False)
        goto(pg, 2); pg.click('.alts-pick [data-alt="1"]'); pg.wait_for_timeout(150); stops(pg)
        # with 140 mi in the tank a smaller buffer reaches cheaper gas: marks show up on the slider
        settings(pg); pg.fill('#tMiles', '140'); stops(pg, 1200)
        pg.wait_for_selector('#tsBuf', timeout=5000); pg.wait_for_timeout(300)
        pg.evaluate("document.getElementById('tsBufBox').scrollIntoView({block:'center'})"); pg.wait_for_timeout(200)
        bt = ft(pg, '#tsBufBox'); print('  140 mi buffer box:', bt.replace('\n', ' | '))
        assert pg.locator('.buf-marks .bm.good').count() >= 1 and pg.locator('.buf-marks .bm.base').count() == 1 and 'saves' in bt, bt
        labels = pg.evaluate("[...document.querySelectorAll('.buf-marks .bm')].map(b => b.className.replace('bm ', '') + ':' + b.textContent)"); print('  markers:', labels)
        assert any(l.startswith('good') and '−$' in l for l in labels) and any(l.startswith('base') for l in labels)
        pg.screenshot(path=f'{OUT}/{name}-t2d-buffer-marks.png')
        mk = pg.evaluate("Math.max(...window.__trip.state().result.sweep.filter(x => x.mark && x.mi < 30).map(x => x.mi))")
        before = pg.evaluate('window.__trip.state().result.plan.totals.net')
        pg.evaluate("(v) => { const i = document.getElementById('tsBuf'); i.value = v; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); }", mk); pg.wait_for_timeout(300)
        after = pg.evaluate('window.__trip.state().result.plan.totals.net'); print('  slid to', mk, 'net', round(before, 2), '->', round(after, 2))
        assert after < before - 0.2
        pg.evaluate("document.getElementById('tsBufBox').scrollIntoView({block:'center'})"); pg.wait_for_timeout(200)
        pg.screenshot(path=f'{OUT}/{name}-t2e-buffer-slid.png')
        settings(pg); pg.fill('#tMiles', '80'); stops(pg, 1200)
        assert mi(pg) == 330
        pg.evaluate("document.getElementById('tpBody').scrollTop = 99999"); pg.wait_for_timeout(200)
        pg.screenshot(path=f'{OUT}/{name}-t3-result-bottom.png')
        nxt(pg); txt = ft(pg, '.tp-step:not(.hidden)')
        pg.click('#tOpen'); url = pg.evaluate('window.__lastUrl'); print('  export:', url)
        assert url.startswith('https://www.google.com/maps/dir/?api=1') and 'waypoints=' in url
        assert 'trip cost' in txt and 'round trip cost' not in txt, 'no more drive-back estimate'
        # arrive with the most gas, then top up within 1.0 mi of the destination
        settings(pg)
        pg.click('#tArrive [data-a="full"]'); pg.fill('#tTopMi', '1.0'); pg.fill('#tTankPrice', '3.10')
        pg.screenshot(path=f'{OUT}/{name}-t4-arrive-setup.png')
        stops(pg, 1500)
        pg.evaluate("document.querySelector('.topbox').scrollIntoView()"); pg.wait_for_timeout(150)
        print('  TOP-UP:', ft(pg, '.topbox').replace('\n', ' | '))
        pg.click('[data-top="0"]'); pg.wait_for_timeout(300)
        pg.evaluate("document.querySelector('.topbox').scrollIntoView()"); pg.wait_for_timeout(150)
        pg.screenshot(path=f'{OUT}/{name}-t5-topup.png')
        nxt(pg)
        print('  KPIs:', ' / '.join(pg.locator('.tp-step:not(.hidden) .kpis').first.inner_text().split('\n')))
        pg.click('#tOpen'); url2 = pg.evaluate('window.__lastUrl'); print('  export with top-up:', url2)
        assert url2.count('%7C') == url.count('%7C') + 1 or 'waypoints=' in url2
        pg.click('#tBack'); pg.wait_for_timeout(300)
        pg.fill('#tsTopMi', '0.5'); pg.dispatch_event('#tsTopMi', 'change'); pg.wait_for_timeout(300)
        assert 'No priced station that close' in ft(pg, '.topbox'), 'radius in tenths respected'
        assert pg.locator('.tp-step:not(.hidden) .stop').count() == 0, 'fuel stops start collapsed'
        pg.click('#tsStopsH'); pg.wait_for_timeout(200)
        assert pg.locator('#stop0.open').count() == 0 and pg.locator('[data-why="0"]').count() == 0, 'each stop starts collapsed'
        pg.click('[data-open="0"]'); pg.wait_for_timeout(150)
        assert pg.locator('#stop0.open').count() == 1 and 'Price breakdown' in ft(pg, '#stop0')
        pg.click('[data-why="0"]'); pg.wait_for_timeout(150)
        assert pg.locator('#why0:not(.hidden)').count() == 1
        pg.evaluate("document.getElementById('stop0').scrollIntoView({block:'center'})"); pg.wait_for_timeout(150)
        pg.screenshot(path=f'{OUT}/{name}-t5b-stop-open.png'); wide(pg, 'stop open')
        pg.click('#tsStopsH'); pg.wait_for_timeout(200)
        assert pg.locator('.tp-step:not(.hidden) .stop').count() == 0, 'whole stop list collapses'
        # drag the panel: it stays at the height you leave it (no growing as you scroll)
        g = pg.locator('#tpGrab').bounding_box(); h0 = pg.evaluate("document.getElementById('trip').getBoundingClientRect().height")
        pg.mouse.move(g['x'] + g['width'] / 2, g['y'] + 8); pg.mouse.down(); pg.mouse.move(g['x'] + g['width'] / 2, g['y'] - 200, steps=6); pg.mouse.up(); pg.wait_for_timeout(400)
        h1 = pg.evaluate("document.getElementById('trip').getBoundingClientRect().height"); print('  dragged panel:', round(h0), '->', round(h1))
        assert h1 > h0 + 150
        pg.evaluate("document.getElementById('tpBody').scrollTop = 400"); pg.wait_for_timeout(400)
        assert abs(pg.evaluate("document.getElementById('trip').getBoundingClientRect().height") - h1) < 3, 'scrolling keeps your height'
        pg.screenshot(path=f'{OUT}/{name}-w5-dragged.png')
        pg.click('#tClose'); pg.wait_for_timeout(200)
        assert not pg.evaluate("document.body.classList.contains('trip-on')")
        # trip history: reopening a saved trip uses no Google lookups at all (no route call, no station search)
        pg.click('#btnTrip'); pg.wait_for_timeout(400)
        assert pg.locator('#tripPick').count() == 1, 'Trip asks: new or saved'
        ht = ft(pg, '#tripPick'); print('  picker:', ht.replace('\n', ' | '))
        assert 'New trip' in ht and 'Continue' in ht
        assert 'Dallas' in ht and 'mi' in ht
        pg.screenshot(path=f'{OUT}/{name}-h1-history.png')
        pg.evaluate("window.__jobs = null; window.__routeBody = null; window.__gmapsUrls = []")
        pg.click('[data-hist]'); idle(pg, 1200)
        assert step(pg) == 4 and pg.locator('#tripPick').count() == 0
        assert pg.evaluate('window.__jobs') is None and pg.evaluate('window.__routeBody') is None and not pg.evaluate('window.__gmapsUrls'), 'no lookups'
        sv = ft(pg, '.note.saved'); print('  reopened:', sv)
        assert 'Saved trip' in sv and 'no lookups' in sv and pg.locator('#tsStopsH').count() == 1
        goto(pg, 2); assert pg.locator('#tRefreshRoutes').count() == 1 and pg.locator('#tNext.dim').count() == 0, 'saved trip: routes remembered'
        assert pg.evaluate('window.__routeBody') is None
        pg.click('#tRefreshRoutes'); pg.wait_for_timeout(600); pg.wait_for_function("!window.__trip.state().busy", timeout=15000)
        assert pg.evaluate('window.__routeBody') is not None and pg.locator('#tRefreshRoutes').count() == 1, 'refresh asks Google again'
        pg.evaluate("window.__routeBody = null"); stops(pg, 1200)
        pg.click('#tClose'); pg.wait_for_timeout(200)
        # remove from history
        pg.click('#btnTrip'); pg.wait_for_timeout(400); n0 = pg.locator('[data-hdel]').count()
        pg.screenshot(path=f'{OUT}/{name}-h0-picker.png'); wide(pg, 'picker')
        pg.click('[data-hdel]'); pg.wait_for_timeout(100)
        assert pg.locator('[data-hdel]').count() == n0 - 1
        # typed addresses: "100 Main St" exists in two towns -> you pick; Dallas is unambiguous
        pg.click('#tpNew'); pg.wait_for_timeout(300)
        assert step(pg) == 1 and pg.locator('#tripPick').count() == 0
        nxt(pg); assert step(pg) == 2
        pg.click('#tSrc [data-src="typed"]'); pg.wait_for_timeout(200)
        assert pg.locator('#tSrcLink.hidden').count() == 1 and pg.locator('#tSrcTyped:not(.hidden)').count() == 1
        pg.fill('#tFrom', ''); pg.fill('#tTo', 'Dallas, TX'); pg.click('#tGetRoutes'); pg.wait_for_timeout(400)
        assert pg.locator('#tFrom.need').count() == 1 and step(pg) == 2, 'missing start outlined'
        pg.screenshot(path=f'{OUT}/{name}-t6a-typed.png')
        pg.fill('#tFrom', '100 Main St'); pg.fill('#tTo', 'Dallas, TX')
        getr(pg)
        txt = ft(pg, '#tParsed'); print('  typed:', txt.replace('\n', ' | '))
        assert 'Which one?' in txt and 'Conway, AR 72032' in txt and 'North Little Rock, AR 72114' in txt
        pg.screenshot(path=f'{OUT}/{name}-t6-pick.png')
        pg.click('[data-choice="1"]'); pg.wait_for_timeout(200)
        assert '100 N Main St, Conway, AR 72032, USA' in ft(pg, '#tParsed') and 'Which one?' not in ft(pg, '#tParsed')
        getr(pg)
        body = pg.evaluate('window.__routeBody')
        assert body['origin'] == {'placeId': 'P-main-conway'} and body['destination'] == {'placeId': 'P-dallas'}, body
        print('  typed route body:', body['origin'], body['destination'])
        pg.click('#tClose'); pg.wait_for_timeout(200)
        # phone share link: street-only names + Google place IDs + route option 2 (what Android Maps sends)
        PHONE = ('https://www.google.com/maps/dir/100+Main+St/Dallas/data=!4m9!4m8!1m2!1m1!1s0x1a:0x1b'
                 '!1m2!1m1!1s0x3c:0x3d!3e0!5i1')
        FULL = ('https://www.google.com/maps/dir/100+Main+St,+North+Little+Rock,+AR+72114/Dallas,+TX/@34,-94,7z/data=!3m1!4b1!4m15!4m14!1m5!1m1!1s0x1a:0x1b'
                '!2m2!1d-92.2680!2d34.7690!1m5!1m1!1s0x3c:0x3d!2m2!1d-96.797!2d32.7767!3e0!5i1?entry=ttu')
        pg.evaluate("window.__finds = null; window.__mocks.link = {url: %s}; window.__gmapsAnswer = {href: %s, routes: [{via:'I-30 W', miles:318, minutes:293}, {via:'US-67 S and I-30 W', miles:330, minutes:305}]};"
                    " onSharedText('Directions from 100 Main St to Dallas\\nhttps://maps.app.goo.gl/PhOnE123?g_st=ac')" % (json.dumps(PHONE), json.dumps(FULL)))
        pg.wait_for_timeout(900)
        txt = ft(pg, '#tParsed'); print('  phone link:', txt.replace('\n', ' | '))
        assert PHONE in pg.evaluate('window.__gmapsUrls'), 'opened the phone link in the hidden Google Maps page'
        assert '100 Main St, North Little Rock, AR 72114' in txt and '✓' not in txt, txt
        pg.screenshot(path=f'{OUT}/{name}-t7-phonelink.png')
        assert step(pg) == 2, 'a shared link opens on Route'
        getr(pg)
        body = pg.evaluate('window.__routeBody')
        assert body['origin']['location']['latLng']['latitude'] == 34.7690 and body['computeAlternativeRoutes'] is True, body
        assert pg.evaluate('window.__finds') is None, 'no guessing by street name'
        sel = ft(pg, '.alts-pick button.on'); print('  picked route:', sel.replace('\n', ' | '))
        assert 'US-67 S and I-30 W' in sel and 'same as in Google Maps' in sel
        pg.click('#tClose'); pg.wait_for_timeout(200)
        # A real-world share link (Oct 5): street-only names, exact spots as !8m2!3d!4d -- start must not be guessed
        REAL = ('https://www.google.com/maps/dir/500+Woodlane+St/210+Capitol+Ave/data=!4m14!4m13!1m5!1m4!1s0x5:0x6'
                '!8m2!3d34.7464809!4d-92.2895948!1m5!1m4!1s0x7:0x8!8m2!3d41.7640350!4d-72.6823870!3e0?utm_source=mstt_0')
        # what Google Maps really listed for this trip on Oct 5; the Routes API only returns 2 of them
        pg.evaluate('''() => {
          window.__origRoute = window.__mocks.route; window.__viaCalls = [];
          const enc = window.Trip.encodePolyline, A = [34.746, -92.29], B = [41.764, -72.682];
          const lineOf = (bend) => { const line = []; for (let i = 0; i <= 300; i++) { const t = i / 300; line.push({ lat: A[0] + (B[0] - A[0]) * t + Math.sin(t * Math.PI) * bend, lng: A[1] + (B[1] - A[1]) * t }); } return line; };
          const mk = (desc, mi, bend, minutes) => {
            const steps = []; for (let k = 0; k < 20; k++) steps.push({ distanceMeters: mi / 20 * 1609.344, staticDuration: Math.round(mi / 20 / 66 * 3600) + 's' });
            return { description: desc, distanceMeters: mi * 1609.344, duration: (minutes * 60) + 's', polyline: { encodedPolyline: enc(lineOf(bend)) }, legs: [{ distanceMeters: mi * 1609.344, steps }] };
          };
          const turns = (bend) => lineOf(bend).filter((p, i) => i % 8 === 0).map((p) => [p.lat, p.lng]);
          window.__mocks.route = (body) => {
            window.__routeBody = body;
            const v = (body.intermediates || []).filter((x) => x.via);
            if (v.length) {                      // pass-through points well north of the line -> the I-71/I-86 route
              window.__viaCalls.push(v.length);
              const north = v.some((x) => { const t = (x.location.latLng.longitude - A[1]) / (B[1] - A[1]); return x.location.latLng.latitude - (A[0] + (B[0] - A[0]) * t) > 1.7; });
              return { routes: [north ? mk('', 1404, 2.4, 1318) : mk('', 1460, -2.5, 1330)] };
            }
            return { routes: [mk('I-40 E and I-81 N', 1306.9, 0, 1202), mk('I-64 E', 1323.6, 1.0, 1216)] };
          };
          window.__gmapsAnswer = { href: null, routes: [{ via: 'I-71 N', miles: 1324, minutes: 1216, pts: turns(1.0) }, { via: 'I-71 N and I-86 E', miles: 1406, minutes: 1322, pts: turns(2.4) },
            { via: 'I-40 E and I-81 N', miles: 1308, minutes: 1222, pts: turns(0) }] };
          window.__gmapsUrls = []; window.__finds = null; window.__osm = null; window.__gmapsDelay = 1200;
        }''')
        pg.evaluate("window.__mocks.link = {url: %s}; onSharedText('https://maps.app.goo.gl/ReAlTrIp42')" % json.dumps(REAL))
        pg.wait_for_timeout(150)
        ld = ft(pg, '#tParsed'); print('  while reading the link:', ld.replace('\n', ' | '))
        assert 'Loading…' in ld and pg.locator('.parse-load .pbar i').count() == 1
        pg.screenshot(path=f'{OUT}/{name}-t8-loading.png')
        pg.wait_for_timeout(2600); pg.evaluate('window.__gmapsDelay = 0')
        urls = pg.evaluate('window.__gmapsUrls'); print('  Maps scan:', urls)
        assert urls == ['https://www.google.com/maps/dir/34.7464809%2C-92.2895948/41.7640350%2C-72.6823870/'], 'route options read by exact spots'
        txt = ft(pg, '#tParsed'); print('  after reading the link:', txt.replace('\n', ' | '))
        assert '500 Woodlane St, Little Rock, AR 72201, USA' in txt and '210 Capitol Ave, Hartford, CT 06106, USA' in txt, txt
        assert 'Pick a route' in txt and pg.locator('#tOptMap .rlabel').count() == 3 and pg.locator('#tOptMap .rlabel.on').count() == 1, txt
        pg.evaluate("document.getElementById('tOptMap').scrollIntoView({block:'center'})"); pg.wait_for_timeout(300)
        pg.screenshot(path=f'{OUT}/{name}-t8b-optmap.png'); wide(pg, 'opt map')
        pg.click('#tOptMap [data-opt="1"]', timeout=5000); pg.wait_for_timeout(300)
        sel = ft(pg, '.opt-sel'); print('  tapped route 2 on the map:', sel)
        assert 'I-71 N and I-86 E' in sel and '1,406 mi' in sel
        pg.screenshot(path=f'{OUT}/{name}-t8a-cities.png')
        finds = len(pg.evaluate('window.__finds') or [])
        getr(pg, 1500)
        info = ft(pg, '.alts-pick'); print('  3 routes:', info.replace('\n', ' | '), '| rebuilt with', pg.evaluate('window.__viaCalls'), 'pass-through points')
        assert len(pg.evaluate('window.__gmapsUrls')) == 1, 'Get route reused the scan'
        assert len(pg.evaluate('window.__finds') or []) == finds, 'addresses were already done'
        assert pg.locator('.alts-pick button').count() == 3 and info.index('via I-71 N\n') < info.index('I-86') < info.index('I-81'), info
        assert '1404 mi' in info and '1324 mi' in info and pg.evaluate('window.__viaCalls') == [8], info
        assert 'I-86' in ft(pg, '.alts-pick button.on') and pg.locator('#tRmap .rlabel').count() == 3, 'the route tapped on the map is the one picked'
        pg.click('#tRmap [data-opt="2"]'); pg.wait_for_timeout(300)
        assert 'I-81' in ft(pg, '.alts-pick button.on'), 'tapping a route on the map after Get route switches to it'
        pg.screenshot(path=f'{OUT}/{name}-t9-three-routes.png')
        pg.evaluate("window.__mocks.route = window.__origRoute; window.__gmapsAnswer = null")
        txt = ft(pg, '#tParsed'); print('  real link:', txt.replace('\n', ' | '))
        assert '500 Woodlane St, Little Rock, AR 72201, USA' in txt and '210 Capitol Ave, Hartford, CT 06106, USA' in txt, txt
        body = pg.evaluate('window.__routeBody'); print('  route from:', body['origin'], 'to:', body['destination'])
        assert body['origin']['location']['latLng'] == {'latitude': 34.7464809, 'longitude': -92.2895948}, body
        assert body['destination']['location']['latLng'] == {'latitude': 41.7640350, 'longitude': -72.6823870}, body
        pg.screenshot(path=f'{OUT}/{name}-t8-reallink.png')
        pg.click('#tClose'); pg.wait_for_timeout(200)
        # pasting a shared Fuel+ trip restores the route, no Google lookups or link opening
        pg.evaluate("window.__finds = null; window.__gmapsUrl = null; window.__mocks.link = {error: 'should not be used'}; onSharedText(%s)" % json.dumps(SHARED_TRIP))
        pg.wait_for_timeout(600)
        txt = ft(pg, '#tParsed'); print('  imported shared trip:', txt.replace('\n', ' | '))
        assert 'Dallas' in txt and 'error' not in txt.lower(), txt
        getr(pg)
        assert pg.evaluate('window.__routeBody')['destination'], 'route from the imported trip'
        pg.click('#tClose'); pg.wait_for_timeout(200)
        # a round trip as one link (North Little Rock -> Dallas -> North Little Rock): each leg routed on its own with its own options, joined for the plan
        LOOP = ('https://www.google.com/maps/dir/North+Little+Rock,+AR+72114/Dallas,+TX/North+Little+Rock,+AR+72114/data=!4m20!4m19!1m5!1m1!1s0x1:0x2!2m2!1d-92.2671!2d34.7695'
                '!1m5!1m1!1s0x3:0x4!2m2!1d-96.797!2d32.7767!1m5!1m1!1s0x1:0x2!2m2!1d-92.2671!2d34.7695!3e0')
        pg.evaluate("window.__gmapsAnswer = {error: 'scan off'}; window.__routeBodies = []; window.__mocks.link = {url: %s}; onSharedText('https://maps.app.goo.gl/LoOp1')" % json.dumps(LOOP))
        pg.wait_for_timeout(900)
        txt = ft(pg, '#tParsed'); print('  round trip link:', txt.replace('\n', ' | '))
        assert pg.locator('#tParsed .nlist li').count() == 3 and 'legs' not in txt, txt
        getr(pg, 1200)
        bodies = pg.evaluate('window.__routeBodies')
        print('  leg requests:', [(b['origin'].get('location', b['origin']), b.get('computeAlternativeRoutes')) for b in bodies][:4])
        assert len([b for b in bodies if b.get('computeAlternativeRoutes')]) == 2 and not any(b.get('intermediates') for b in bodies), 'one request per leg, with options'
        print('  leg view:', step(pg), pg.locator('.leg-pick').count(), pg.locator('.leg-pick').nth(1).locator('.alts-pick button').count(), pg.locator('#tRmap0 .rlabel').count(), pg.locator('#tRmap1').count())
        assert pg.locator('.leg-pick').count() == 2 and pg.locator('.leg-pick').nth(1).locator('.alts-pick button').count() == 2 and pg.locator('#tRmap0 .rlabel').count() == 2 and pg.locator('#tRmap1').count() == 1
        info = ft(pg, '#tRouteInfo'); print('  legs:', info.replace('\n', ' | ')[:400])
        assert mi(pg) == 636, mi(pg)
        pg.click('[data-leg="1"][data-lk="1"]'); pg.wait_for_timeout(300)
        assert mi(pg) == 648 and 'I-30 E and US-67 N' in pg.locator('.leg-pick').nth(1).locator('button.on').inner_text(), ft(pg, '#tRouteInfo')
        pg.evaluate("document.querySelector('.leg-pick').scrollIntoView({block:'start'})"); pg.wait_for_timeout(200)
        pg.screenshot(path=f'{OUT}/{name}-l1-legs.png'); wide(pg, 'legs')
        assert step(pg) == 2
        pg.evaluate("window.__app.S.trip.milesLeft = '80'")
        nxt(pg, 600); assert step(pg) == 3; nxt(pg, 1200); assert step(pg) == 4; idle(pg)
        arr = ft(pg, '.gas-tiles').lower(); print('  round trip tiles:', arr.replace('\n', ' | '))
        assert pg.locator('.gas-tiles .ideal').count() == 3 and 'gas at dallas' in arr and 'enough for the cheapest return trip' in arr and 'buffer' not in arr
        pg.evaluate("document.querySelector('.gas-tiles').scrollIntoView({block:'start'})"); pg.wait_for_timeout(200); pg.screenshot(path=f'{OUT}/{name}-l1b-tiles.png')
        assert pg.evaluate('window.__trip.state().result.back') is None, 'no "drive back" on a trip that already comes back'
        nxt(pg); assert step(pg) == 5
        assert [x.strip() for x in pg.locator('.tp-step:not(.hidden) .nlist .nn').all_inner_texts()] == ['1', '2', '3']
        pg.click('#tOpen'); one = pg.evaluate('window.__lastUrl'); pg.wait_for_timeout(200)
        assert pg.locator('#tLegs').count() == 0 and 'waypoints=' in one, 'up to 9 stops: one tap opens Maps'
        # over Google's 9-stop limit: the legs slide up from the button
        pg.evaluate("(() => { window.__exp0 = window.Trip.exportUrl; window.Trip.exportUrl = (r, st, m) => { const x = window.__exp0(r, st, m); if (r && r.stops.length > 2) x.tooMany = true; return x; }; })()")
        goto(pg, 5); pg.evaluate("window.__lastUrl = null"); pg.click('#tOpen'); pg.wait_for_timeout(500)
        assert pg.evaluate('window.__lastUrl') is None and pg.locator('#tLegs.on [data-legurl]').count() == 2
        lp = ft(pg, '#tLegs'); print('  legs popup:', lp.replace('\n', ' | ')); assert "Over Google's limit of 9 stops. Use the individual links instead." in lp
        pg.screenshot(path=f'{OUT}/{name}-l2-leglinks.png'); wide(pg, 'leg links')
        pg.click('[data-legurl="1"]'); leg2 = pg.evaluate('window.__lastUrl'); print('  one link:', one[:160], '\n  leg 2 link:', leg2[:200])
        assert 'origin=32.7767' in leg2 or 'origin=Dallas' in leg2, leg2
        assert leg2 != one and pg.locator('#tLegs [data-legurl="1"].done').count() == 1
        pg.click('.tp-step:not(.hidden) .dep-sum'); pg.wait_for_timeout(300); assert pg.locator('#tLegs').count() == 0, 'tap outside closes it'
        pg.evaluate("window.Trip.exportUrl = window.__exp0; 0")
        stress(pg, 'legs')
        pg.click('#tClose'); pg.wait_for_timeout(200)
        # the Round trip switch on a one-way link: adds the way back as its own leg, just like importing a round trip
        ONEWAY = ('https://www.google.com/maps/dir/North+Little+Rock,+AR+72114/Dallas,+TX/data=!4m14!4m13!1m5!1m1!1s0x1:0x2!2m2!1d-92.2671!2d34.7695'
                  '!1m5!1m1!1s0x3:0x4!2m2!1d-96.797!2d32.7767!3e0')
        pg.evaluate("window.__routeBodies = []; window.__mocks.link = {url: %s}; onSharedText('https://maps.app.goo.gl/OnEwAy1')" % json.dumps(ONEWAY))
        pg.wait_for_timeout(900)
        assert pg.locator('#tParsed .nlist li').count() == 2, ft(pg, '#tParsed')
        setchk(pg, '#tRound', True); pg.wait_for_timeout(300)
        txt = ft(pg, '#tParsed'); print('  round trip switch on:', txt.replace('\n', ' | '))
        assert pg.locator('#tParsed .nlist li').count() == 3 and 'Back to start' not in txt, txt
        getr(pg, 1200)
        assert pg.locator('.leg-pick').count() == 2 and mi(pg) == 636, ft(pg, '#tRouteInfo')
        pg.evaluate("document.querySelector('#tRound').scrollIntoView({block:'center'})"); pg.wait_for_timeout(150)
        pg.screenshot(path=f'{OUT}/{name}-l3-roundswitch.png')
        setchk(pg, '#tRound', False); pg.wait_for_timeout(300)
        assert pg.locator('#tParsed .nlist li').count() == 2 and pg.locator('.leg-pick').count() == 0, 'switch off: one way again'
        pg.click('#tClose'); pg.wait_for_timeout(200)
        pg.evaluate("window.__gmapsAnswer = null")
        # debug log: on at level 4, records the trip steps, never the key
        lg = pg.evaluate('FLog.text()')
        print('  log lines:', lg.count('\n'), '| areas:', sorted(set(e['a'] for e in pg.evaluate('FLog.entries()'))))
        assert '[route] Route ready' in lg and '[plan] Planned' in lg and '[route] Google Maps route options' in lg, lg[-1500:]
        assert 'AIzaSyTESTKEY' not in lg and 'AIzaSyTESTKEY' not in rtxt, 'key leaked'
        # share intent path with a short link that resolves
        pg.evaluate("window.__mocks.link = {url: %s}; onSharedText('Directions to Dallas\\nhttps://maps.app.goo.gl/AbCdEf')" % json.dumps(LINK))
        pg.wait_for_timeout(800)
        assert 'Dallas' in ft(pg, '#tParsed'), ft(pg, '#tParsed')
        pg.close()
    b.close()
print('JS errors:', errors or 'none')
print('Too wide:', WIDE or 'none')
