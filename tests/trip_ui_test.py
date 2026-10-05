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
        pg.click('#tEpa summary'); pg.wait_for_timeout(300)
        pg.select_option('#eYear', '2021'); pg.wait_for_timeout(200)
        pg.select_option('#eMake', 'Honda'); pg.wait_for_timeout(200)
        pg.select_option('#eModel', 'Accord'); pg.wait_for_timeout(500)
        print('  car:', pg.inner_text('#tCarSum').replace('\n', ' | '), '| city/hwy', pg.input_value('#cCity'), pg.input_value('#cHwy'))
        assert pg.input_value('#cCity') == '30'
        pg.fill('#cTank', '12'); pg.fill('#tMiles', '80'); pg.fill('#tBuffer', '30')
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
        assert pg.evaluate('window.__gmapsUrl') == PHONE, 'opened the phone link in the hidden Google Maps page'
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
        pg.evaluate("window.__finds = null; window.__gmapsUrl = null; window.__osm = null; window.__mocks.link = {url: %s}; onSharedText('https://maps.app.goo.gl/ReAlTrIp42')" % json.dumps(REAL))
        pg.wait_for_timeout(2600)
        assert pg.evaluate('window.__gmapsUrl') is None, 'link already had exact spots: no hidden page needed'
        txt = pg.inner_text('#tParsed'); print('  cities before Get route:', txt.replace('\n', ' | '))
        assert '500 Woodlane St, Little Rock, AR 72201' in txt and '210 Capitol Ave, Hartford, CT 06106' in txt, txt
        assert pg.evaluate('window.__finds') is None, 'city preview used no Google lookups'
        pg.screenshot(path=f'{OUT}/{name}-t8a-cities.png')
        pg.fill('#tMiles', '300'); pg.click('#tGo'); pg.wait_for_timeout(900)
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
        assert '[route] Route ready' in lg and '[plan] Planned' in lg and '[osm] City for stop' in lg, lg[-1500:]
        assert 'AIzaSyTESTKEY' not in lg and 'AIzaSyTESTKEY' not in rtxt, 'key leaked'
        # share intent path with a short link that resolves
        pg.evaluate("window.__mocks.link = {url: %s}; onSharedText('Directions to Dallas\\nhttps://maps.app.goo.gl/AbCdEf')" % json.dumps(LINK))
        pg.wait_for_timeout(800)
        assert 'Dallas' in pg.inner_text('#tParsed'), pg.inner_text('#tParsed')
        pg.close()
    b.close()
print('JS errors:', errors or 'none')
