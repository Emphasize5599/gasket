"""Climate control (Garage): your car's controls, season / weather / custom presets on their own pages (new ones go away
on Discard changes), the recirculate warning in place, Advice's climate card, and no sideways scrolling."""
import sys, os
from playwright.sync_api import sync_playwright
import fastwait  # noqa: F401

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
URL = 'file://' + os.path.join(ROOT, 'assets', 'web', 'index.html')
MOCKS = open(os.path.join(ROOT, 'tests', 'trip_mocks.js')).read()
errors = []
def ft(pg, sel): return pg.evaluate("(s) => { const e = document.querySelector(s); if (!e) throw new Error('no ' + s); return e.innerText; }", sel)
def CL(pg): return pg.evaluate('window.Garage.car().climate')
OVER = '''() => { const W = innerWidth, out = []; document.querySelectorAll('body *').forEach(e => { if (e.closest('.leaflet-container')) return;
  const r = e.getBoundingClientRect(); if (r.width && (e.offsetParent || getComputedStyle(e).position === 'fixed') && (r.right > W + 0.5 || r.left < -0.5)) out.push((e.id || e.className) + ' ' + Math.round(r.left) + '..' + Math.round(r.right)); });
  return out.slice(0, 8); }'''
BIG = '''(sel) => { document.querySelectorAll(sel).forEach(e => { if (!e.dataset.big) { e.style.fontSize = (parseFloat(getComputedStyle(e).fontSize) * 1.3) + 'px'; e.dataset.big = 1; } }); }'''
def nosideways(pg, sel, what):
    o = pg.evaluate(OVER); pg.evaluate(BIG, sel); pg.wait_for_timeout(100); o += pg.evaluate(OVER)
    assert not o, what + ' sideways: ' + str(o)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME', '/opt/google/chrome/chrome'), args=['--no-sandbox'])
    for name, w, h, scheme in fastwait.viewports([('pixel10pro', 412, 915, 'dark'), ('narrow', 320, 800, 'light')]):
        pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=2.6, color_scheme=scheme, is_mobile=True, has_touch=True)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(URL); pg.evaluate('setInsets(44, 24, 0, 0)'); pg.wait_for_timeout(400)
        pg.fill('#apiKey', 'AIzaSyTESTKEY0123456789abcdefghijklmnop'); pg.click('#sDone'); pg.wait_for_timeout(400)
        pg.evaluate(MOCKS)
        pg.click('#btnTrip'); pg.wait_for_timeout(400)
        if pg.locator('#tpNew').count(): pg.click('#tpNew'); pg.wait_for_timeout(300)
        now = pg.evaluate('ClimateMath.season()')
        pg.evaluate("document.querySelector('#gClimate').scrollIntoView()"); pg.click('#gClimate summary'); pg.wait_for_selector('#clCaps')
        assert pg.locator('#gClimLine').count() == 0 and pg.locator('.cl-row.empty').count() == 5 and pg.locator('.cl-wx').count() == 4, 'controls and the four seasons: not set up; special weather under each season'
        assert '(now)' in ft(pg, '#clS_' + now)
        emo = pg.evaluate("['spring','summer','fall','winter'].map(k => document.querySelector('#clS_' + k + ' b').textContent.split(' ')[0])")
        assert emo == ['🌷', '☀️', '🍂', '❄️'], emo
        assert pg.locator('.cl-row.now').count() == 1 and pg.locator('#clS_' + now + '.now').count() == 1, 'this season: outlined'
        glow = pg.evaluate("(() => { const s = getComputedStyle(document.querySelector('.cl-row.now'), '::before'); return [s.animationName, s.position]; })()")
        assert glow == ['clRun', 'absolute'], glow
        # ---- your car's controls ----
        pg.click('#clCaps'); pg.wait_for_selector('.sub-page [data-cap]')
        for k in ('auto', 'dual', 'seatHeat', 'rearDefrost'): pg.check('[data-cap="%s"]' % k); pg.wait_for_timeout(50)
        pg.fill('#clFanMax', '8'); pg.dispatch_event('#clFanMax', 'change')
        nosideways(pg, '.sub-page *', 'controls page')
        pg.click('.sub-back'); pg.wait_for_timeout(200)
        assert 'Automatic climate control, Dual-zone' in ft(pg, '#clCaps') and CL(pg)['caps']['fanMax'] == 8
        # ---- the winter preset: a page with a starting point; only the car's controls ----
        pg.click('#clS_winter'); pg.wait_for_selector('.sub-page #cpTemp')
        assert ft(pg, '.sub-page h2') == 'Winter' and pg.input_value('#cpTemp') == '72' and pg.locator('#cpTempP').count() == 1, 'dual-zone: a passenger temperature'
        assert pg.locator('[data-k="seatD"]').count() == 1 and pg.locator('[data-k="coolD"]').count() == 0 and pg.locator('[data-sw="wheel"]').count() == 0
        assert pg.locator('[data-k="fan"]').count() == 0, 'auto mode: no fan steps'
        pg.click('[data-k="mode"] [data-v="manual"]'); pg.wait_for_timeout(100)
        assert pg.locator('[data-k="fan"] button').count() == 8 and pg.locator('[data-k="flow"]').count() == 1
        pg.click('[data-k="fan"] [data-v="4"]'); pg.fill('#cpTempP', '75'); pg.dispatch_event('#cpTempP', 'change'); pg.wait_for_timeout(100)
        # recirculate: the warning shows in place; with the A/C on, the dry air too
        pg.click('[data-k="air"] [data-v="recirc"]'); pg.wait_for_timeout(100)
        assert 'drowsy' in ft(pg, '.cl-warn') and 'dry' not in ft(pg, '.cl-warn')
        pg.click('[data-k="ac"] [data-v="on"]'); pg.wait_for_timeout(100)
        assert 'very dry' in ft(pg, '.cl-warn')
        assert [ft(pg, '.tz-trbtns .btn:nth-child(%d)' % i) for i in (1, 2)] == ['Delete', 'Discard changes']
        pg.screenshot(path=f'{OUT}/{name}-c1-preset.png', full_page=True)
        nosideways(pg, '.sub-page *', 'preset page')
        pg.click('.sub-back'); pg.wait_for_timeout(200)
        wi = [x for x in CL(pg)['presets'] if x['key'] == 'winter'][0]
        assert wi['fan'] == 4 and wi['tempP'] == 75 and wi['air'] == 'recirc' and wi['ac'] == 'on', wi
        assert '72° / 75° · Fan 4 · A/C on · Recirculate' in ft(pg, '#clS_winter') and pg.locator('#clS_winter.warn').count() == 1
        # ---- Advice: fresh air, louder for a preset that recirculates ----
        pg.evaluate('window.__trip.step(2)'); pg.wait_for_timeout(300)
        a = ft(pg, '#advClimate'); print(' ', name, 'advice:', a.replace('\n', ' | '))
        assert '>Cabin climate<' in pg.inner_html('#advClimate') and 'Use fresh air, not recirculate' in a and 'Your Winter preset uses recirculate' in a and 'drowsy' in a and 'very dry' in a
        assert pg.locator('#advClimate .adv-item.due').count() == 1
        ps = pg.evaluate("[...document.querySelectorAll('#advClimate .adv-item.due p')].map(p => p.innerText)")
        assert len(ps) == 3 and ps[1].startswith('With the A/C') and 'harsh allergens' in ps[2] and 'without a cabin air filter' in ps[2] and 'fog the inside of your windows' in ps[2], ps
        # acknowledged before going on: untick it and Next waits (the tab gets a dot), tick it and on you go
        pg.uncheck('[data-cchk="recirc"]'); pg.wait_for_timeout(200)
        assert pg.locator('#tpSteps [data-step="2"].attn').count() == 1 and pg.locator('#tpSteps [data-step="3"].dim').count() == 1
        pg.click('#tNext'); pg.wait_for_timeout(300); assert pg.evaluate('window.__trip.state().step') == 2, 'Next waits for the tick'
        pg.check('[data-cchk="recirc"]'); pg.wait_for_timeout(200)
        assert pg.locator('#tpSteps [data-step="3"].dim').count() == 0 and pg.evaluate('window.__app.S.recircAck') > 0
        pg.evaluate('window.__trip.step(1)'); pg.wait_for_timeout(300)
        # ---- a weather preset; Discard changes on a new one: gone. Back to fresh air: Advice quiets down ----
        # each season: "Adjust for special weather conditions" opens what you'd do in the weather it brings
        assert 'Adjust for special weather conditions' in ft(pg, '#clX_winter') and '0 of 4 answered' in ft(pg, '#clX_winter')
        assert pg.evaluate("document.querySelector('#clS_winter').nextElementSibling.id") == 'clX_winter', 'right under its season'
        pg.click('#clX_winter'); pg.wait_for_selector('.sub-page [data-key]')
        assert ft(pg, '.sub-page h2') == '❄️ Winter: special weather' and "What would you do if it's" in ft(pg, '.sub-page')
        assert pg.evaluate("[...document.querySelectorAll('.sub-page [data-key]')].map(b => b.dataset.key)") == ['snow', 'ice', 'frost', 'fog'] and pg.locator('.sub-page .cl-row.empty').count() == 4
        nosideways(pg, '.sub-page *', 'special weather page')
        pg.click('.sub-page #clW_fog'); pg.wait_for_selector('.sub-page #cpTemp')
        assert ft(pg, '.sub-page h2') == "If it's foggy" and 'on' in pg.get_attribute('[data-k="flow"] [data-v="defrost"]', 'class')
        assert pg.inner_text('#cpSeasonDefaults') == 'Use Winter defaults'
        assert pg.evaluate("document.querySelector('#cpSeasonDefaults').getBoundingClientRect().top < document.querySelector('#cpTemp').getBoundingClientRect().top")
        winter = [x for x in CL(pg)['presets'] if x['kind'] == 'season' and x['key'] == 'winter'][0]
        pg.click('#cpSeasonDefaults')
        weather = [x for x in CL(pg)['presets'] if x['kind'] == 'weather' and x['key'] == 'fog'][0]
        assert weather['temp'] == winter['temp'] and weather['air'] == winter['air'] and weather['kind'] == 'weather' and weather['key'] == 'fog'
        pg.click('#cpDiscard'); pg.wait_for_timeout(300)
        assert ft(pg, '.sub-page h2') == '❄️ Winter: special weather', 'closing an answer goes back to the season\'s list'
        assert not any(x['key'] == 'fog' for x in CL(pg)['presets']) and pg.locator('.sub-page #clW_fog.empty').count() == 1
        pg.click('.sub-page #clW_frost'); pg.wait_for_selector('.sub-page #cpTemp'); pg.click('.sub-back'); pg.wait_for_timeout(300)
        assert pg.locator('.sub-page #clW_frost.empty').count() == 0 and 'Defrost' in ft(pg, '.sub-page #clW_frost'), 'answered'
        pg.click('.sub-back'); pg.wait_for_timeout(300)
        assert pg.locator('.sub-page').count() == 0 and '1 of 4 answered' in ft(pg, '#clX_winter') and '1 of 4 answered' in ft(pg, '#clX_fall'), 'frosty comes with fall too: the same answer'
        assert '0 of ' in ft(pg, '#clX_summer')
        pg.click('#clX_summer'); pg.wait_for_selector('.sub-page #clW_heat'); pg.click('#clW_heat'); pg.wait_for_selector('#cpSeasonDefaults')
        assert pg.inner_text('#cpSeasonDefaults') == 'Use Summer defaults'
        pg.click('#cpSeasonDefaults')
        heat = [x for x in CL(pg)['presets'] if x['kind'] == 'weather' and x['key'] == 'heat'][0]
        assert heat['temp'] == 70 and heat['ac'] == 'on' and heat['flow'] == 'face', 'summer starter when no summer preset exists'
        nosideways(pg, '.sub-page *', 'season defaults button')
        pg.click('#cpDiscard'); pg.wait_for_timeout(200); pg.click('.sub-back'); pg.wait_for_timeout(200)
        pg.click('#clS_winter'); pg.wait_for_selector('.sub-page #cpTemp')
        pg.click('[data-k="air"] [data-v="fresh"]'); pg.wait_for_timeout(100); assert pg.locator('.cl-warn').count() == 0
        pg.click('[data-k="air"] [data-v="recirc"]'); pg.click('#cpDiscard'); pg.wait_for_timeout(200)
        assert [x for x in CL(pg)['presets'] if x['key'] == 'winter'][0]['air'] == 'recirc', 'Discard changes: back to how it was when the page opened'
        pg.click('#clS_winter'); pg.wait_for_selector('.sub-page #cpTemp'); pg.click('[data-k="air"] [data-v="fresh"]'); pg.click('.sub-back'); pg.wait_for_timeout(200)
        # ---- a custom preset, renamed, then deleted ----
        pg.click('#clAddC'); pg.wait_for_selector('.sub-page #cpName')
        pg.fill('#cpName', 'Road trip'); pg.dispatch_event('#cpName', 'change'); pg.wait_for_timeout(100)
        assert ft(pg, '.sub-page h2') == 'Road trip'
        pg.click('.sub-back'); pg.wait_for_timeout(200)
        cid = [x for x in CL(pg)['presets'] if x['kind'] == 'custom'][0]['id']
        assert 'Road trip' in ft(pg, '#clC_' + cid)
        nosideways(pg, '#gClimate *', 'climate card')
        pg.click('#clC_' + cid); pg.wait_for_selector('.sub-page #cpDel'); pg.click('#cpDel'); pg.wait_for_timeout(200)
        if pg.locator('.cfm-go').count(): pg.click('.cfm-go'); pg.wait_for_timeout(250)
        assert len(CL(pg)['presets']) == 2 and pg.locator('.sub-page').count() == 0
        pg.evaluate('window.__trip.step(2)'); pg.wait_for_timeout(300)
        a = ft(pg, '#advClimate')
        assert 'Your Winter preset' not in a and pg.locator('#advClimate .adv-item.due').count() == 0
        if now == 'winter': assert 'This season: Winter' in a
        if now in ('fall', 'winter', 'spring'): assert 'Frosty:' in a and 'Defrost' in a, 'this time of year\'s weather answers in Advice'
        pg.close()
    assert not errors, errors
    print('JS errors: none')
    b.close()
print('climate tests passed')
