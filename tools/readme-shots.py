"""Takes the README screenshots (docs/screenshots/) with demo data in desktop Chrome: python3 tools/readme-shots.py [out-dir]
The map sits by the Arkansas State Capitol (the browser stand-in's location) and every price is invented demo data. Uses the browser at $CHROME."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'tests'))
from playwright.sync_api import sync_playwright
import fastwait  # noqa: F401  (waits end once the page settles)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'docs', 'screenshots')
URL = 'file://' + os.path.join(ROOT, 'assets', 'web', 'index.html')
os.makedirs(OUT, exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME', '/opt/google/chrome/chrome'), args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 412, 'height': 915}, device_scale_factor=2, color_scheme='dark', is_mobile=True, has_touch=True)
    pg.goto(URL)
    pg.evaluate('setInsets(44, 24, 0, 0)')
    pg.wait_for_timeout(600)
    pg.click('#sDone')
    pg.wait_for_timeout(900)
    pg.click('#btnSettings'); pg.wait_for_timeout(200)
    pg.click('#sDemo')
    pg.wait_for_selector('.leaflet-tooltip.mbub')
    pg.wait_for_timeout(1500)
    pg.screenshot(path=f'{OUT}/map.png')
    x = pg.locator('.leaflet-tooltip.mbub[data-brand="exxon"]:not([style*="hidden"])')   # an Exxon shows the Walmart+ discount
    (x.first if x.count() else pg.locator('.leaflet-tooltip.mbub:not([style*="hidden"])').first).click(force=True)
    pg.wait_for_timeout(800)
    pg.screenshot(path=f'{OUT}/station.png')
    pg.click('#dClose')
    pg.click('#bestLine')
    pg.wait_for_timeout(600)
    pg.screenshot(path=f'{OUT}/list.png')
    b.close()
print('wrote', OUT)
