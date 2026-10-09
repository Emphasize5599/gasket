"""How long the screen freezes on a long trip (1,500 mi, ~60,000 route points, ~250 stations) at phone speed (CPU x4).
Prints the longest main-thread block for: getting routes, picking another route, entering Stops, reopening a saved trip."""
import sys, os, json, math
from playwright.sync_api import sync_playwright
import fastwait  # noqa: F401  (waits end once the page settles; SLOW_WAITS=1 for fixed sleeps)
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
URL = 'file://' + os.path.join(ROOT, 'assets', 'web', 'index.html')
MOCKS = open(os.path.join(ROOT, 'tests', 'trip_mocks.js')).read()
LINK = ('https://www.google.com/maps/dir/North+Little+Rock,+AR+72114/Hartford,+CT/@34,-94,7z/data=!4m19!4m18!1m5!1m1!1s0x1:0x2!2m2!1d-92.2671!2d34.7695'
        '!1m5!1m1!1s0x3:0x4!2m2!1d-72.68239!2d41.76404!2m3!1b0!2b0!3b0!3e0')
BIG = r'''
(() => {
  const A = [34.7695, -92.2671], B = [41.76404, -72.68239], N = 60000, total = 1420;
  const mk = (bend, dl) => { const l = []; for (let i = 0; i <= N; i++) { const t = i / N; l.push({ lat: A[0] + (B[0] - A[0]) * t + Math.sin(t * 7) * bend + dl, lng: A[1] + (B[1] - A[1]) * t }); } return l; };
  const lines = [mk(0.4, 0), mk(-0.5, 0.01), mk(0.9, -0.01)];
  const enc = window.Trip.encodePolyline;
  const at = (l, mi) => l[Math.min(N, Math.round(mi / total * N))];
  const steps = []; for (let k = 0; k < 40; k++) steps.push({ distanceMeters: total / 40 * 1609.344, staticDuration: Math.round(total / 40 / 66 * 3600) + 's', navigationInstruction: { maneuver: 'STRAIGHT', instructions: 'Continue on I-' + (40 + k % 3 * 20) + ' E' } });
  window.__mocks.route = (body) => {
    const r = lines.map((l, k) => ({ description: ['I-40 E', 'I-81 N', 'I-70 E'][k], distanceMeters: (total + k * 25) * 1609.344, duration: (80000 + k * 1500) + 's', polyline: { encodedPolyline: enc(l) }, legs: [{ distanceMeters: total * 1609.344, steps }] }));
    return { routes: body.computeAlternativeRoutes ? r : [r[0]] };
  };
  const money = (v) => ({ currencyCode: 'USD', units: String(Math.floor(v)), nanos: Math.round((v - Math.floor(v)) * 1e9) });
  const now = new Date().toISOString();
  window.__mocks.along = (jobs) => {
    const results = [];
    jobs.forEach((j, idx) => {
      const places = [], sums = [];
      for (let mi = Math.ceil(j.fromMi / 6) * 6; mi < j.toMi; mi += 6) {
        if ((Math.round(mi / 6) + j.q.length) % 4) continue;
        const p = { lat: j.lat, lng: j.lng };
        let best = null; for (const l of lines) { const q = at(l, mi); if (!best) best = q; }
        const price = 3.0 + ((mi * 37) % 70) / 100;
        places.push({ id: 'g-' + j.q.replace(/\W/g, '') + mi, displayName: { text: j.q + ((mi % 5) ? '' : ' Quick Stop') }, location: { latitude: best.lat + 0.002, longitude: best.lng },
          formattedAddress: mi + ' Hwy, Somewhere, TN 37' + mi + ', USA', addressComponents: [{ shortText: 'TN', types: ['administrative_area_level_1'] }],
          businessStatus: 'OPERATIONAL', fuelOptions: { fuelPrices: (mi % 7) ? [{ type: 'REGULAR_UNLEADED', price: money(price), updateTime: now }] : [] } });
        const chunk = (j.toMi - j.fromMi) * 1609.344, l0 = (mi - j.fromMi) * 1609.344;
        sums.push({ legs: [{ distanceMeters: Math.round(l0 + 200), duration: '60s' }, { distanceMeters: Math.round(chunk - l0 + 200), duration: '60s' }] });
      }
      if (places.length) results.push({ job: idx, places, routingSummaries: sums });
    });
    return { results, errors: [], calls: jobs.length };
  };
  window.__siteMock = () => ({ stores: [], nodes: [] });
})(); 0
'''
LT = '''(() => { window.__lt = []; new PerformanceObserver((l) => { l.getEntries().forEach(e => window.__lt.push([Math.round(e.startTime), Math.round(e.duration)])); }).observe({ entryTypes: ['longtask'] }); })(); 0'''
PROF = {}
def mark(pg):
    if os.environ.get('PROF'): PROF['cdp'].send('Profiler.start')
    return pg.evaluate('performance.now()')
def top(prof, label):
    nodes = {n['id']: n for n in prof['nodes']}; self_t = {}
    dt = prof['timeDeltas']; samples = prof['samples']
    for i, sid in enumerate(samples):
        n = nodes[sid]; cf = n['callFrame']; k = (cf['functionName'] or '(anon)') + ' ' + cf['url'].split('/')[-1] + ':' + str(cf['lineNumber'] + 1)
        self_t[k] = self_t.get(k, 0) + (dt[i] if i < len(dt) else 0)
    # inclusive: walk parents
    parent = {}
    for n in prof['nodes']:
        for c in n.get('children', []): parent[c] = n['id']
    inc = {}
    for i, sid in enumerate(samples):
        seen = set(); x = sid
        while x is not None:
            cf = nodes[x]['callFrame']; k = (cf['functionName'] or '(anon)') + ' ' + cf['url'].split('/')[-1] + ':' + str(cf['lineNumber'] + 1)
            if k not in seen: inc[k] = inc.get(k, 0) + (dt[i] if i < len(dt) else 0); seen.add(k)
            x = parent.get(x)
    print('    self:', ', '.join('%s %dms' % (k, v / 1000) for k, v in sorted(self_t.items(), key=lambda x: -x[1])[:12]))
    print('    incl:', ', '.join(['%s %dms' % (k, v / 1000) for k, v in sorted(inc.items(), key=lambda x: -x[1]) if '.js' in k][:25]))
def worst(pg, t0, label):
    if os.environ.get('PROF'): top(PROF['cdp'].send('Profiler.stop')['profile'], label)
    lt = [d for s, d in pg.evaluate('window.__lt') if s + d >= t0]
    print('  %-28s longest block %5d ms   (%d blocks over 50 ms, total %d ms)' % (label, max(lt or [0]), len(lt), sum(lt)))
    return max(lt or [0])
def idle(pg, t=900):
    pg.wait_for_timeout(t); pg.wait_for_function("!window.__trip.state().busy", timeout=120000); pg.wait_for_timeout(400)
res = {}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME', '/opt/google/chrome/chrome'), args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 412, 'height': 915}, device_scale_factor=2.6, is_mobile=True, has_touch=True)
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.evaluate('setInsets(44, 24, 0, 0)'); pg.wait_for_timeout(400)
    pg.fill('#apiKey', 'AIzaSyTESTKEY0123456789abcdefghijklmnop'); pg.click('#sDone'); pg.wait_for_timeout(500)
    pg.evaluate(MOCKS); pg.evaluate(BIG); pg.evaluate(LT)
    cdp = pg.context.new_cdp_session(pg); PROF['cdp'] = cdp; cdp.send('Profiler.enable'); cdp.send('Emulation.setCPUThrottlingRate', {'rate': float(os.environ.get('CPU', '4'))})
    pg.click('#btnTrip'); pg.wait_for_timeout(500)
    pg.click('#tNext'); pg.wait_for_timeout(600); pg.click('#tNext'); pg.wait_for_timeout(600)   # Garage -> Advisory -> Route
    pg.fill('#tLink', LINK); pg.wait_for_timeout(1500)
    t0 = mark(pg); pg.click('#tGetRoutes'); idle(pg, 2000); res['get routes'] = worst(pg, t0, 'get routes')
    t0 = mark(pg); pg.click('.alts-pick [data-alt="1"]'); pg.wait_for_timeout(2500); res['pick route'] = worst(pg, t0, 'pick another route')
    t0 = mark(pg); pg.click('.alts-pick [data-alt="0"]'); pg.wait_for_timeout(2500); res['pick back'] = worst(pg, t0, 'pick route 1 again')
    pg.click('#tNext'); pg.wait_for_timeout(600)
    pg.click('#tFuelMode [data-fm="miles"]'); pg.fill('#tMiles', os.environ.get('MILES', '200')); pg.fill('#tBuffer', os.environ.get('BUF', '40'))
    t0 = mark(pg); pg.click('#tNext'); idle(pg, 3000); res['stops'] = worst(pg, t0, 'enter Stops (find stops)')
    pg.screenshot(path=f'{OUT}/perf-stops.png')
    print('  placing the stop bubbles:', pg.evaluate('window.__trip.placeMs()'), 'ms (CPU x4)')
    pc = pg.evaluate('window.__trip.pins()'); print('  pins: over route', pc['overRoute'], 'crossings', pc['crossings'], 'short', sum(1 for x in pc['pins'] if x['mini']), 'of', len(pc['pins']))
    assert pc['overRoute'] == 0 and pc['crossings'] == 0
    n = pg.evaluate('window.__trip.state().result.cands.length'); print('  candidates:', n)
    t0 = mark(pg); pg.click('#tClose'); pg.wait_for_timeout(800); res['close'] = worst(pg, t0, 'close the trip (main map)')
    pg.click('#btnTrip'); pg.wait_for_timeout(500)
    t0 = mark(pg); pg.click('[data-hist]'); idle(pg, 3000); res['reopen'] = worst(pg, t0, 'reopen saved trip')
    pg.screenshot(path=f'{OUT}/perf-reopen.png')
    print('JS errors:', errs or 'none')
    b.close()
print(json.dumps(res))
