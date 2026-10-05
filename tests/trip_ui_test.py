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
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/google/chrome/chrome', args=['--no-sandbox'])
    for name, w, h, scheme in [('pixel10pro', 412, 915, 'dark'), ('pixel8pro', 448, 998, 'light')]:
        pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=2.6, color_scheme=scheme, is_mobile=True, has_touch=True)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'tile' not in m.text and 'ERR_' not in m.text and errors.append(m.text))
        pg.goto(URL); pg.evaluate('setInsets(44, 24, 0, 0)'); pg.wait_for_timeout(400)
        pg.fill('#apiKey', 'AIzaSyTESTKEY0123456789abcdefghijklmnop'); pg.check('input[data-k=debug]', force=True); pg.select_option('#logLevel', '4'); pg.click('#sDone'); pg.wait_for_timeout(600)
        pg.evaluate(MOCKS)
        pg.click('#btnTrip'); pg.wait_for_timeout(300)
        pg.fill('#tLink', LINK); pg.wait_for_timeout(700)
        print(name, 'parsed:', pg.inner_text('#tParsed').replace('\n', ' | '))
        assert 'avoid tolls' in pg.inner_text('#tParsed') and 'route option 2' in pg.inner_text('#tParsed')
        assert 'North Little Rock, AR 72114' in pg.inner_text('#tParsed'), 'full address shown'
        # EPA lookup
        # ---- garage: your two cars are there, EPA numbers read-only, the rest behind Edit ----
        chips = pg.inner_text('#gCars'); head = pg.inner_text('.g-head'); tiles = pg.inner_text('.epa-tiles')
        print('  cars:', chips.replace('\n', ' | '), '||', head.replace('\n', ' | '), '||', tiles.replace('\n', ' '))
        assert '2020 Corolla Hybrid' in chips and '2012 Venza' in chips and 'Hybrid' in head and '11.3 gal tank' in head and '54' in tiles and '50' in tiles
        assert pg.locator('.epa-tiles input').count() == 0 and pg.locator('#gTank').count() == 0, 'EPA not editable; tank only after Edit'
        pg.click('.epa-note summary'); pg.wait_for_timeout(100)
        assert '48 mph' in pg.inner_text('.epa-note') and '21 mph' in pg.inner_text('.epa-note')
        pg.click('#gEdit'); pg.wait_for_timeout(150)
        assert pg.input_value('#gTank') == '11.3' and pg.input_value('#gType') == 'hybrid'
        pg.screenshot(path=f'{OUT}/{name}-g1-edit.png')
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
        print('  speed card (collapsed):', pg.inner_text('#tSpeed').replace('\n', ' | '))
        pg.click('details.spd-card > summary'); pg.wait_for_timeout(200)
        sp = pg.inner_text('#tSpeed'); print('  speed card:', sp.replace('\n', ' | ')[:420])
        assert 'best cruising speed · 2016 corolla' in sp.lower() and '70mph' in sp and 'the recommended speed' in sp and 'Not calibrated yet' in sp
        assert pg.locator('#gChart .zone').count() == 1
        x0 = pg.get_attribute('#gChart .sel-l', 'x1')
        pg.fill('#gTripMi', '1300'); pg.dispatch_event('#gTripMi', 'change')
        pg.evaluate("() => { const r = document.getElementById('gTry'); r.value = 78; r.dispatchEvent(new Event('input')); }"); pg.wait_for_timeout(100)
        out = pg.inner_text('#gTryOut'); print('  try 78:', out)
        assert '78 mph instead of 70' in out and 'sooner' in out and '+$' in out and '1,300 mi' in out
        assert pg.get_attribute('#gChart .sel-l', 'x1') != x0 and pg.text_content('#gChart .sel-t') == '78', 'line follows the slider'
        # log an observed tank with the speed you held -> calibrates
        pg.fill('#lMpg', '52'); pg.select_option('#lKind', 'highway'); pg.fill('#lSpeed', '72'); pg.click('#lAdd'); pg.wait_for_timeout(400)
        lg = pg.inner_text('.log-list'); sp = pg.inner_text('#tSpeed'); print('  log:', lg.replace('\n', ' | '), '||', [l for l in sp.split('\n') if 'Calibrated' in l])
        assert '52.0 mpg' in lg and 'at 72 mph' in lg and 'Calibrated from 1 of your entries' in sp
        pg.fill('#lMpg', '61'); pg.select_option('#lKind', 'mixed'); pg.click('#lAdd'); pg.wait_for_timeout(300)   # no speed: still fine
        assert pg.locator('.log-row').count() == 2 and 'Calibrated from 1 of' in pg.inner_text('#tSpeed')
        pg.evaluate("document.getElementById('tSpeed').scrollIntoView()"); pg.wait_for_timeout(150)
        pg.screenshot(path=f'{OUT}/{name}-g2-speed.png')
        # with a time value
        pg.click('.spd-set summary'); pg.fill('#sTime', '10'); pg.dispatch_event('#sTime', 'change'); pg.wait_for_timeout(200)
        sp = pg.inner_text('#tSpeed'); print('  at $10/hr:', sp.split('\n')[0:4])
        assert '84 mph' in sp and 'gas never outweighs' in sp
        pg.fill('#sTime', '0'); pg.dispatch_event('#sTime', 'change'); pg.wait_for_timeout(200)
        pg.fill('#sPrice', '3.50'); pg.dispatch_event('#sPrice', 'change'); pg.wait_for_timeout(200)
        assert '$3.50 (yours)' in pg.inner_text('.spd-set summary')
        pg.fill('#sPrice', ''); pg.dispatch_event('#sPrice', 'change'); pg.wait_for_timeout(200)
        # the Venza: its own card
        pg.click('[data-car="venza12"]'); pg.wait_for_timeout(300)
        sp = pg.inner_text('#tSpeed'); print('  Venza:', sp.split('\n')[0:3])
        assert 'venza' in sp.lower() and '65 mph' in sp and '20 gal tank' in pg.inner_text('.g-head')
        pg.screenshot(path=f'{OUT}/{name}-g3-venza.png')
        # add a car from the EPA (the trip tests below use it)
        pg.click('[data-car="+"]'); pg.wait_for_timeout(400)
        pg.select_option('#eYear', '2021'); pg.wait_for_timeout(200)
        pg.select_option('#eMake', 'Honda'); pg.wait_for_timeout(200)
        pg.select_option('#eModel', 'Accord'); pg.wait_for_timeout(600)
        print('  car:', pg.inner_text('.g-head').replace('\n', ' | '), '|', pg.inner_text('.epa-tiles').replace('\n', ' '), '|', pg.inner_text('#eMsg'))
        assert 'Accord' in pg.inner_text('.g-head') and '30' in pg.inner_text('.epa-tiles') and "doesn't publish it" in pg.inner_text('#eMsg')
        pg.fill('#gTank', '12'); pg.dispatch_event('#gTank', 'change'); pg.wait_for_timeout(200); pg.click('#gEdit')
        pg.fill('#tMiles', '80'); pg.fill('#tBuffer', '30')
        pg.fill('#tMinSave', '1'); pg.fill('#tMaxMin', '10')
        pg.evaluate("document.getElementById('tMinSave').scrollIntoView({block:'center'})"); pg.wait_for_timeout(150)
        pg.screenshot(path=f'{OUT}/{name}-t1-setup.png')
        pg.click('#tGo'); pg.wait_for_timeout(600)
        body = pg.evaluate('window.__routeBody')
        assert body['routeModifiers']['avoidTolls'] is True and body['origin']['location']['latLng']['latitude'] == 34.7695, body
        print('  route:', pg.inner_text('#tRouteInfo').replace('\n', ' | '))
        assert pg.evaluate('window.__finds') is None, 'link stops had exact coordinates: no lookups'
        assert 'matches your link' in pg.inner_text('.alts-pick button.on'), 'route option from the link pre-selected'
        pg.evaluate("document.querySelector('.alts-pick').scrollIntoView({block:'center'})"); pg.wait_for_timeout(150)
        pg.screenshot(path=f'{OUT}/{name}-t1b-routes.png')
        pg.click('.alts-pick [data-alt="0"]'); pg.wait_for_timeout(150)
        assert '318 mi' in pg.inner_text('.rc-top')
        pg.click('.alts-pick [data-alt="1"]'); pg.wait_for_timeout(150)
        assert '330 mi' in pg.inner_text('.rc-top')
        pg.click('#tGo'); pg.wait_for_timeout(1500)
        print('  notes:', pg.evaluate('JSON.stringify(window.__trip.state().result && window.__trip.state().result.notes)'), pg.evaluate('typeof window.__siteMock'))
        print('  google jobs:', len(pg.evaluate('window.__jobs')), '| walmart price ids:', pg.evaluate('window.__wmPriceIds'))
        assert pg.evaluate('window.__wmPriceIds') == ['777'], 'only on-route Walmart priced'
        txt = pg.inner_text('#tripSheet')
        print('  RESULT:', txt.replace('\n', ' | ')[:900])
        pg.screenshot(path=f'{OUT}/{name}-t2-result.png')
        # cruising speed per leg: limits from the (mock) FHWA inventory, sliders start at $0
        pg.wait_for_selector('#tsSpeed .leg', timeout=5000)
        pg.evaluate("document.getElementById('tsSpeed').scrollIntoView({block:'start'})"); pg.wait_for_timeout(200)
        ts = pg.inner_text('#tsSpeed'); print('  trip speed:', ts.replace('\n', ' | ')[:700])
        nroads = pg.locator('#tsSpeed .leg[data-leg]').count()
        assert nroads == 3 and ts.index('US-67 S') < ts.index('I-30 W') and '2 speed limits' in ts and 'At the limit — 75 mph' in ts and 'about 7' not in ts, ts
        assert 'At the limit' in ts and '$0.00' in ts and pg.locator('#lgTot.zero').count() == 1 and 'FHWA road inventory' in ts and 'All roads' in ts
        assert pg.evaluate('window.__hpms.length') > 5 and all('HPMS_FULL_' in u for u in pg.evaluate('window.__hpms'))
        pg.screenshot(path=f'{OUT}/{name}-s1-trip-speed.png')
        # scroll so the first leg is under the chart: the chart stays pinned under the map
        pos = pg.evaluate('''() => { const sh = document.getElementById('tripSheet'), box = document.getElementById('tsSpeed'), stick = box.querySelector('.spd-stick');
          sh.scrollTop += box.getBoundingClientRect().top - sh.getBoundingClientRect().top + 220;
          return [sh.getBoundingClientRect().top, stick.getBoundingClientRect().top, box.getBoundingClientRect().top]; }''')
        pg.wait_for_timeout(150); print('  sticky (sheet top, chart top, box top):', [round(x) for x in pos])
        assert abs(pos[1] - pos[0]) < 2 and pos[2] < pos[0] - 100, pos
        pg.screenshot(path=f'{OUT}/{name}-s1b-pinned.png')
        pos = pg.evaluate('''() => { const sh = document.getElementById('tripSheet'), box = document.getElementById('tsSpeed'), stick = box.querySelector('.spd-stick');
          sh.scrollTop += box.getBoundingClientRect().bottom - sh.getBoundingClientRect().top - 60;
          return [sh.getBoundingClientRect().top, stick.getBoundingClientRect().top, stick.getBoundingClientRect().bottom, box.getBoundingClientRect().bottom]; }''')
        pg.wait_for_timeout(150); print('  past the last leg (sheet top, chart top, chart bottom, box bottom):', [round(x) for x in pos])
        assert pos[1] < pos[0] - 5 and 0 <= pos[3] - pos[2] < 20, 'chart scrolls away with the last leg'
        x0 = pg.get_attribute('#tChart .sel-l', 'x1')
        pg.evaluate("() => { const r = document.getElementById('lgR1'); r.value = 6; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); }"); pg.wait_for_timeout(150)
        pg.evaluate("() => { const r = document.getElementById('lgR0'); r.value = -5; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); }"); pg.wait_for_timeout(150)
        ts = pg.inner_text('#tsSpeed'); print('  after sliding:', [l for l in ts.split('\n') if 'sooner' in l or 'later' in l or 'Time-saving' in l or l.startswith(('+', '−'))])
        tot = pg.inner_text('#lgTot'); print('  total:', tot.replace('\n', ' | '))
        assert 'Time-saving cost' in tot and pg.get_attribute('#tChart .sel-l', 'x1') != x0
        assert pg.inner_text('#lgSub1').startswith('+$') and pg.inner_text('#lgSub0').startswith('−$')
        pg.screenshot(path=f'{OUT}/{name}-s2-trip-speed-slid.png')
        rep_speed = pg.evaluate("JSON.parse(window.__tripReport()).speed")
        assert rep_speed['offsets']['1'] == 6 and rep_speed['stats']['hpms'] > 0 and [r['name'] for r in rep_speed['roads']] == ['US-67 S', 'I-30 W'], rep_speed['roads']
        # the "all roads" slider moves every road
        pg.evaluate("() => { const r = document.getElementById('lgAll'); r.value = 5; r.dispatchEvent(new Event('input')); }"); pg.wait_for_timeout(100)
        assert pg.input_value('#lgR0') == '5' and pg.input_value('#lgR1') == '5' and pg.input_value('#lgR2') == '5' and pg.inner_text('#lgAllSub').startswith('+$')
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
        pg.evaluate("window.__shared = null"); pg.click('#tsShare'); pg.wait_for_timeout(200)
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
        # default speed rule: +9 over the limit but never above 74 -> 70 roads get +4, 75 roads stay at 75
        pg.click('#tsEdit'); pg.wait_for_timeout(300)
        pg.check('#tRule', force=True); pg.fill('#tRuleOver', '9'); pg.fill('#tRuleCap', '74'); pg.dispatch_event('#tRuleCap', 'change'); pg.wait_for_timeout(100)
        pg.click('#tGo'); pg.wait_for_timeout(1500); pg.wait_for_selector('#lgR2', timeout=5000)
        vals = [pg.input_value('#lgR%d' % i) for i in range(3)]; rl = pg.inner_text('.rule-line'); print('  rule +9 up to 74:', vals, '|', rl)
        assert vals == ['4', '4', '0'] and 'never above 74 mph' in rl and pg.inner_text('#lgTot').find('+$') >= 0
        pg.click('#tsEdit'); pg.wait_for_timeout(300); pg.uncheck('#tRule', force=True); pg.dispatch_event('#tRule', 'change'); pg.click('#tGo'); pg.wait_for_timeout(1500)
        # finding stops again on the same route reuses the saved search (no Google lookups); "Get fresh prices" searches again
        pg.evaluate("window.__jobs = null"); pg.click('#tsEdit'); pg.wait_for_timeout(300); pg.click('#tGo'); pg.wait_for_timeout(1500)
        assert pg.evaluate('window.__jobs') is None, 'saved search reused'
        sv = pg.inner_text('.note.saved'); print('  second search:', sv)
        assert 'saved' in sv and 'Get fresh prices' in sv
        pg.click('#tsRefresh'); pg.wait_for_timeout(1800)
        assert pg.evaluate('window.__jobs') and pg.locator('.note.saved').count() == 0, 'fresh search'
        print('  refreshed with', len(pg.evaluate('window.__jobs')), 'Google lookups')
        # buffer slider: checks other buffers in the background, marks where a smaller one saves money
        pg.wait_for_selector('#tsBuf', timeout=5000)
        pg.evaluate("document.getElementById('tsBufBox').scrollIntoView({block:'center'})"); pg.wait_for_timeout(200)
        bt = pg.inner_text('#tsBufBox'); print('  buffer box:', bt.replace('\n', ' | '))
        sweep = pg.evaluate("window.__trip.state().result.sweep.map(x => [x.mi, x.ok, x.net && +x.net.toFixed(2), x.mark])")
        print('  sweep:', sweep)
        assert pg.input_value('#tsBuf') == '30' and 'Buffer for this trip' in bt
        pg.screenshot(path=f'{OUT}/{name}-t2b-buffer.png')
        marks = [x for x in sweep if x[3] and x[0] < 30]
        if marks:
            m = marks[-1][0]
            pg.evaluate("(v) => { const i = document.getElementById('tsBuf'); i.value = v; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); }", m)
            pg.wait_for_timeout(300)
            bt2 = pg.inner_text('#tsBufBox'); print('  after slide to', m, ':', bt2.replace('\n', ' | '))
            assert pg.evaluate('window.__trip.state().result.bufMi') == m and 'For this trip only' in bt2
        # too much buffer: refused, stays put
        cur = pg.evaluate('window.__trip.state().result.bufMi')
        pg.evaluate("() => { const i = document.getElementById('tsBuf'); i.value = i.max; i.dispatchEvent(new Event('change')); }"); pg.wait_for_timeout(300)
        print('  max buffer ->', pg.evaluate('window.__trip.state().result.bufMi'), '| ok at max:', sweep[-1][1])
        if not sweep[-1][1]: assert pg.evaluate('window.__trip.state().result.bufMi') == cur
        # other routes: plan the trip on I-30 too, where (in this test) gas is 35c cheaper
        pg.click('#tsEdit'); pg.wait_for_timeout(300)
        pg.check('#tAltCmp', force=True); pg.fill('#tAltSave', '2'); pg.dispatch_event('#tAltSave', 'change'); pg.wait_for_timeout(200)
        info = pg.inner_text('#tRouteInfo'); print('  with other routes:', info.replace('\n', ' | ')[-160:])
        assert 'your route + 1 other' in info, info
        pg.evaluate("window.__cheapI30 = true; window.__alongRoutes = {}"); pg.click('#tGo'); pg.wait_for_timeout(2500)
        assert pg.evaluate('window.__alongRoutes') == {'I-30': True, 'US-67': True}, pg.evaluate('window.__alongRoutes')
        rb = pg.inner_text('.routebox'); print('  route box:', rb.replace('\n', ' | '))
        assert 'Cheaper route: via I-30 W' in rb, rb
        pg.evaluate("document.querySelector('.routebox').scrollIntoView({block:'center'})"); pg.wait_for_timeout(150)
        pg.screenshot(path=f'{OUT}/{name}-t2c-otherroute.png')
        pg.click('.routebox [data-route="0"]'); pg.wait_for_timeout(400)
        sub = pg.inner_text('#tripSheet .sub'); after = pg.inner_text('#tripSheet'); print('  switched:', sub, '|', [l for l in after.split('\n') if 'Also checked' in l])
        assert '318 mi' in sub and 'via US-67 S and I-30 W' in after and 'Cheaper route' not in after
        assert "isn't the route you picked in Google Maps" in after
        pg.evaluate("window.__cheapI30 = false"); pg.click('#tsEdit'); pg.wait_for_timeout(300); pg.uncheck('#tAltCmp', force=True)
        pg.click('.alts-pick [data-alt="1"]'); pg.wait_for_timeout(150)
        # with 140 mi in the tank a smaller buffer reaches cheaper gas: marks show up on the slider
        pg.fill('#tMiles', '140'); pg.click('#tGo'); pg.wait_for_timeout(1500)
        pg.wait_for_selector('#tsBuf', timeout=5000); pg.wait_for_timeout(300)
        pg.evaluate("document.getElementById('tsBufBox').scrollIntoView({block:'center'})"); pg.wait_for_timeout(200)
        bt = pg.inner_text('#tsBufBox'); print('  140 mi buffer box:', bt.replace('\n', ' | '))
        assert pg.locator('.buf-marks .bm').count() >= 1 and 'saves' in bt, bt
        pg.screenshot(path=f'{OUT}/{name}-t2d-buffer-marks.png')
        mk = pg.evaluate("Math.max(...window.__trip.state().result.sweep.filter(x => x.mark && x.mi < 30).map(x => x.mi))")
        before = pg.evaluate('window.__trip.state().result.plan.totals.net')
        pg.evaluate("(v) => { const i = document.getElementById('tsBuf'); i.value = v; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); }", mk); pg.wait_for_timeout(300)
        after = pg.evaluate('window.__trip.state().result.plan.totals.net'); print('  slid to', mk, 'net', round(before, 2), '->', round(after, 2))
        assert after < before - 0.2
        pg.evaluate("document.getElementById('tsBufBox').scrollIntoView({block:'center'})"); pg.wait_for_timeout(200)
        pg.screenshot(path=f'{OUT}/{name}-t2e-buffer-slid.png')
        pg.click('#tsEdit'); pg.wait_for_timeout(300); pg.fill('#tMiles', '80'); pg.click('#tGo'); pg.wait_for_timeout(1500)
        assert '330 mi' in pg.inner_text('#tripSheet .sub')
        pg.evaluate("document.getElementById('tripSheet').scrollTop = 99999"); pg.wait_for_timeout(200)
        pg.screenshot(path=f'{OUT}/{name}-t3-result-bottom.png')
        pg.click('#tsExport'); url = pg.evaluate('window.__lastUrl'); print('  export:', url)
        assert url.startswith('https://www.google.com/maps/dir/?api=1') and 'waypoints=' in url
        assert 'trip cost' in txt and 'round trip cost' in txt, 'trip + round trip cost shown'
        # arrive with the most gas, then top up within 1.0 mi of the destination
        pg.click('#tsEdit'); pg.wait_for_timeout(300)
        pg.click('#tArrive [data-a="full"]'); pg.fill('#tTopMi', '1.0'); pg.fill('#tTankPrice', '3.10')
        pg.screenshot(path=f'{OUT}/{name}-t4-arrive-setup.png', full_page=True)
        pg.click('#tGo'); pg.wait_for_timeout(1500)
        pg.evaluate("document.querySelector('.topbox').scrollIntoView()"); pg.wait_for_timeout(150)
        print('  TOP-UP:', pg.inner_text('.topbox').replace('\n', ' | '))
        pg.click('[data-top="0"]'); pg.wait_for_timeout(300)
        pg.evaluate("document.querySelector('.topbox').scrollIntoView()"); pg.wait_for_timeout(150)
        pg.screenshot(path=f'{OUT}/{name}-t5-topup.png')
        print('  KPIs:', ' / '.join(pg.locator('#tripSheet .kpis').first.inner_text().split('\n')))
        print('  ROUND:', pg.locator('.topbox').nth(1).inner_text().replace('\n', ' | '))
        pg.click('#tsExport'); url2 = pg.evaluate('window.__lastUrl'); print('  export with top-up:', url2)
        assert url2.count('%7C') == url.count('%7C') + 1 or 'waypoints=' in url2
        pg.fill('#tsTopMi', '0.5'); pg.dispatch_event('#tsTopMi', 'change'); pg.wait_for_timeout(300)
        assert 'No priced station that close' in pg.inner_text('.topbox'), 'radius in tenths respected'
        pg.click('[data-why="0"]'); pg.wait_for_timeout(150)
        pg.click('#tsDone'); pg.wait_for_timeout(200)
        assert not pg.evaluate("document.body.classList.contains('trip-on')")
        # typed addresses: "100 Main St" exists in two towns -> you pick; Dallas is unambiguous
        pg.click('#btnTrip'); pg.wait_for_timeout(300)
        pg.fill('#tLink', ''); pg.wait_for_timeout(500)
        pg.click('.alt-entry summary'); pg.fill('#tFrom', '100 Main St'); pg.fill('#tTo', 'Dallas, TX')
        pg.click('#tGo'); pg.wait_for_timeout(700)
        txt = pg.inner_text('#tParsed'); print('  typed:', txt.replace('\n', ' | '))
        assert 'Which one?' in txt and 'Conway, AR 72032' in txt and 'North Little Rock, AR 72114' in txt
        pg.screenshot(path=f'{OUT}/{name}-t6-pick.png')
        pg.click('[data-choice="1"]'); pg.wait_for_timeout(200)
        assert '100 N Main St, Conway, AR 72032, USA' in pg.inner_text('#tParsed') and 'Which one?' not in pg.inner_text('#tParsed')
        pg.click('#tGo'); pg.wait_for_timeout(700)
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
        txt = pg.inner_text('#tParsed'); print('  phone link:', txt.replace('\n', ' | '))
        assert PHONE in pg.evaluate('window.__gmapsUrls'), 'opened the phone link in the hidden Google Maps page'
        assert '100 Main St, North Little Rock, AR 72114 ✓' in txt and 'via US-67 S and I-30 W' in txt, txt
        pg.screenshot(path=f'{OUT}/{name}-t7-phonelink.png')
        pg.fill('#tMiles', '80'); pg.click('#tGo'); pg.wait_for_timeout(700)
        body = pg.evaluate('window.__routeBody')
        assert body['origin']['location']['latLng']['latitude'] == 34.7690 and body['computeAlternativeRoutes'] is True, body
        assert pg.evaluate('window.__finds') is None, 'no guessing by street name'
        sel = pg.inner_text('.alts-pick button.on'); print('  picked route:', sel.replace('\n', ' | '))
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
        ld = pg.inner_text('#tParsed'); print('  while reading the link:', ld.replace('\n', ' | '))
        assert 'Loading…' in ld and pg.locator('.parse-load .pbar i').count() == 1
        pg.screenshot(path=f'{OUT}/{name}-t8-loading.png')
        pg.wait_for_timeout(2600); pg.evaluate('window.__gmapsDelay = 0')
        urls = pg.evaluate('window.__gmapsUrls'); print('  Maps scan:', urls)
        assert urls == ['https://www.google.com/maps/dir/34.7464809%2C-92.2895948/41.7640350%2C-72.6823870/'], 'route options read by exact spots'
        txt = pg.inner_text('#tParsed'); print('  after reading the link:', txt.replace('\n', ' | '))
        assert '500 Woodlane St, Little Rock, AR 72201, USA' in txt and '210 Capitol Ave, Hartford, CT 06106, USA' in txt, txt
        assert 'Google Maps shows 3 routes' in txt and pg.locator('#tOptMap .rlabel').count() == 3 and pg.locator('#tOptMap .rlabel.on').count() == 1, txt
        pg.evaluate("document.getElementById('tOptMap').scrollIntoView({block:'center'})"); pg.wait_for_timeout(300)
        pg.screenshot(path=f'{OUT}/{name}-t8b-optmap.png')
        pg.click('#tOptMap [data-opt="1"]', timeout=5000); pg.wait_for_timeout(300)
        sel = pg.inner_text('.opt-sel'); print('  tapped route 2 on the map:', sel)
        assert 'I-71 N and I-86 E' in sel and '1,406 mi' in sel
        pg.screenshot(path=f'{OUT}/{name}-t8a-cities.png')
        finds = len(pg.evaluate('window.__finds') or [])
        pg.fill('#tMiles', '300'); pg.click('#tGo'); pg.wait_for_timeout(1800)
        info = pg.inner_text('.alts-pick'); print('  3 routes:', info.replace('\n', ' | '), '| rebuilt with', pg.evaluate('window.__viaCalls'), 'pass-through points')
        assert len(pg.evaluate('window.__gmapsUrls')) == 1, 'Get route reused the scan'
        assert len(pg.evaluate('window.__finds') or []) == finds, 'addresses were already done'
        assert pg.locator('.alts-pick button').count() == 3 and info.index('via I-71 N\n') < info.index('I-86') < info.index('I-81'), info
        assert '1404 mi' in info and '1324 mi' in info and pg.evaluate('window.__viaCalls') == [8], info
        assert 'I-86' in pg.inner_text('.alts-pick button.on') and pg.locator('#tRmap .rlabel').count() == 3, 'the route tapped on the map is the one picked'
        pg.click('#tRmap [data-opt="2"]'); pg.wait_for_timeout(300)
        assert 'I-81' in pg.inner_text('.alts-pick button.on'), 'tapping a route on the map after Get route switches to it'
        pg.screenshot(path=f'{OUT}/{name}-t9-three-routes.png')
        pg.evaluate("window.__mocks.route = window.__origRoute; window.__gmapsAnswer = null")
        txt = pg.inner_text('#tParsed'); print('  real link:', txt.replace('\n', ' | '))
        assert '500 Woodlane St, Little Rock, AR 72201, USA' in txt and '210 Capitol Ave, Hartford, CT 06106, USA' in txt, txt
        body = pg.evaluate('window.__routeBody'); print('  route from:', body['origin'], 'to:', body['destination'])
        assert body['origin']['location']['latLng'] == {'latitude': 34.7464809, 'longitude': -92.2895948}, body
        assert body['destination']['location']['latLng'] == {'latitude': 41.7640350, 'longitude': -72.6823870}, body
        pg.screenshot(path=f'{OUT}/{name}-t8-reallink.png')
        pg.click('#tClose'); pg.wait_for_timeout(200)
        # pasting a shared Fuel+ trip restores the route, no Google lookups or link opening
        pg.evaluate("window.__finds = null; window.__gmapsUrl = null; window.__mocks.link = {error: 'should not be used'}; onSharedText(%s)" % json.dumps(SHARED_TRIP))
        pg.wait_for_timeout(600)
        txt = pg.inner_text('#tParsed'); print('  imported shared trip:', txt.replace('\n', ' | '))
        assert 'Dallas' in txt and 'error' not in txt.lower(), txt
        pg.click('#tGo'); pg.wait_for_timeout(700)
        assert pg.evaluate('window.__routeBody')['destination'], 'route from the imported trip'
        pg.click('#tClose'); pg.wait_for_timeout(200)
        # debug log: on at level 4, records the trip steps, never the key
        lg = pg.evaluate('FLog.text()')
        print('  log lines:', lg.count('\n'), '| areas:', sorted(set(e['a'] for e in pg.evaluate('FLog.entries()'))))
        assert '[route] Route ready' in lg and '[plan] Planned' in lg and '[route] Google Maps route options' in lg, lg[-1500:]
        assert 'AIzaSyTESTKEY' not in lg and 'AIzaSyTESTKEY' not in rtxt, 'key leaked'
        # share intent path with a short link that resolves
        pg.evaluate("window.__mocks.link = {url: %s}; onSharedText('Directions to Dallas\\nhttps://maps.app.goo.gl/AbCdEf')" % json.dumps(LINK))
        pg.wait_for_timeout(800)
        assert 'Dallas' in pg.inner_text('#tParsed'), pg.inner_text('#tParsed')
        pg.close()
    b.close()
print('JS errors:', errors or 'none')
