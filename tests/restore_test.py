"""Full backup / restore: a backup saved by Fuel+ Map 0.0.47 (com.ben.gasmap) restores in Gasket, and the restart after it
searches nothing (no Google lookups) even when the restored settings say to search on opening."""
import sys, os, json, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
URL = 'file://' + os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'assets', 'web', 'index.html'))
errors = []
KEY = 'AIzaSyTESTKEY0123456789abcdefghijklmnop'   # a fake key, as in the other tests
month = time.strftime('%Y-%m')
now = int(time.time() * 1000)

# the shape MainActivity.writeBackup produced in Fuel+ Map 0.0.47
settings = {'apiKey': KEY, 'autoRefresh': True, 'radiusMi': 10, 'grade': 'regular',
            'cars': [{'id': 'c-restored', 'year': 2020, 'make': 'Toyota', 'model': 'Corolla', 'type': 'car', 'tank': 13.2,
                      'grade': 'regular', 'epa': {'city': 31, 'hwy': 40}, 'obs': {}, 'log': []}],
            'carId': 'c-restored'}
cache = {'g': [], 'o': {}, 'lastFetch': {'ts': now - 3600 * 1000, 'lat': 34.7695, 'lng': -92.2671, 'demo': False}}
FUEL_PLUS_BACKUP = json.dumps({
    'fullBackup': 1, 'fromPackage': 'com.ben.gasmap', 'appVersion': '0.0.47', 'created': now,
    'prefs': {'settings': {'t': 's', 'v': json.dumps(settings)}, 'cache': {'t': 's', 'v': json.dumps(cache)},
              'calls_' + month: {'t': 'i', 'v': 900}, 'rcalls_' + month: {'t': 'i', 'v': 12}},
    'kv': {'trips': {'0' * 40: json.dumps({'t': now, 'v': []})}, 'routes': {'a' * 40: '{}', 'b' * 40: '{}'}},
    'files': {'debug-log.json': '[]'}})

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME', '/opt/google/chrome/chrome'), args=['--no-sandbox'])
    for name, w, h, scheme in [('pixel10pro', 412, 915, 'dark'), ('pixel8pro', 448, 998, 'light')]:
        pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=2.6, color_scheme=scheme, is_mobile=True, has_touch=True)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'tile' not in m.text and 'ERR_' not in m.text and errors.append(m.text))
        pg.goto(URL); pg.evaluate('setInsets(44, 24, 0, 0)'); pg.wait_for_timeout(500)
        if pg.locator('#bkRestore').count() == 0:
            pg.click('#btnSettings'); pg.wait_for_timeout(300)
        assert pg.locator('#bkRestore').count() == 1, 'Restore full backup is in Settings'
        # not a backup: refused, nothing restarts
        pg.evaluate('(t) => { window.__mocks = window.__mocks || {}; window.__mocks.restoreFile = t; }', json.dumps({'fuelPlusData': 1}))
        pg.click('#bkRestore'); pg.wait_for_timeout(250)
        if pg.locator('#cfmYes').count(): pg.click('#cfmYes')
        pg.wait_for_timeout(300)
        assert "isn't a full backup file" in pg.inner_text('#toast'), pg.inner_text('#toast')
        assert not pg.evaluate('window.__restoring'), 'a refused file changes nothing'
        # the Fuel+ backup
        pg.evaluate('(t) => { window.__mocks.restoreFile = t; }', FUEL_PLUS_BACKUP)
        pg.click('#bkRestore'); pg.wait_for_timeout(250)
        assert pg.locator('#cfm').count() == 1, 'asks before replacing everything'
        print(' ', name, 'asks:', pg.inner_text('#cfm').replace('\n', ' | '))
        with pg.expect_navigation(timeout=5000):
            pg.click('#cfmYes')
            pg.wait_for_timeout(300)
            toast = pg.inner_text('#toast'); print('  toast:', toast)
            assert 'Restored 4 settings and 3 saved items' in toast, toast
            assert pg.evaluate('window.__restoring') is True
            pg.evaluate("window.__app.S.radiusMi = 3; window.__app.save && window.__app.save()")   # nothing writes the old settings back
        pg.wait_for_timeout(1500)
        # after the restart: the restored settings and prices are there, and nothing was searched
        S = pg.evaluate('window.__app.S')
        assert S['apiKey'] == KEY and S['autoRefresh'] is True and S['radiusMi'] == 10, {k: S.get(k) for k in ('autoRefresh', 'radiusMi')}
        assert [c['id'] for c in S['cars']] == ['c-restored'] and S['carId'] == 'c-restored', 'car from the Fuel+ backup'
        assert pg.evaluate('window.__searchCalls || 0') == 0, 'no search (Google lookups) on the first start after a restore'
        assert 'restored' not in pg.evaluate('location.hash'), 'the restart marker is cleared'
        st = pg.inner_text('#status'); print('  status after restart:', st)
        assert 'tap ↻' in st, st
        pg.screenshot(path=f'{OUT}/{name}-restored.png')
        assert KEY not in json.dumps(pg.evaluate('window.FLog ? FLog.entries() : []')), 'the API key never reaches the log'
        pg.close()
    b.close()
print('JS errors:', errors or 'none')
assert not errors
print('restore tests passed')
