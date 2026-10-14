"""Phone layout smoke: overview, isolated vehicle submenus, and mirrored dually pairs."""
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1])
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=os.environ.get('CHROME'))
    for width in [320, 448]:
        page = browser.new_page(viewport={'width': width, 'height': 900}, is_mobile=True, has_touch=True)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto((ROOT / 'assets/web/index.html').as_uri())
        page.evaluate('() => __app.S.setupDone=true')
        page.click('#sDone')
        page.evaluate((ROOT / 'tests/trip_mocks.js').read_text(encoding='utf-8'))
        page.click('#btnTrip')
        page.evaluate("""() => {
          setInsets(24,48);const c=Garage.car();c.info.drw='yes';
          c.tires={size:'235/80R17',sizeSrc:'user',corners:{split:true,dually:true,mode:'miles'},
          list:{size:'235/80R17',items:[]},spare:{kind:'none'},towMode:true,
          trailers:[{id:'layout-trailer',name:'Trailer label must not appear on graphic',hooked:true,axles:2,per:4,split:true}]};
          Garage.redraw();
        }""")
        page.click('#gTires summary')
        assert page.locator('#gTires [data-tire],#gTires [data-corner],#gTires [data-tr-tire],#gTires #tzSame,#gTires #tzDually').count() == 0
        assert page.locator('.tz-overview .tz-w').count() == 14
        assert page.locator('.tz-overview .tz-trn').count() == 0
        page.locator('.tz-overview').evaluate('(e)=>e.scrollIntoView({block:"center"})')
        page.screenshot(path=str(OUT / f'tire-overview-{width}.png'))
        page.click('#tzDet')
        assert page.locator('.sub-page .tz-car-visual .tz-w').count() == 6
        assert page.locator('.sub-page [data-tr-tire],.sub-page [data-tr-axle]').count() == 0
        assert page.locator('.sub-page [data-tire]').count() == 6
        page.evaluate("""() => {const es=[...document.querySelectorAll('.sub-page *')],sizes=es.map(e=>parseFloat(getComputedStyle(e).fontSize));es.forEach((e,i)=>{if(sizes[i])e.style.fontSize=sizes[i]*1.3+'px';});}""")
        sides = page.locator('.tz-car-tires .tz-tr-side')
        assert sides.nth(2).locator('[data-tire]').evaluate_all('(es)=>es.map(e=>e.dataset.tire)') == ['lr', 'lri']
        assert sides.nth(3).locator('[data-tire]').evaluate_all('(es)=>es.map(e=>e.dataset.tire)') == ['rri', 'rr']
        assert [s.replace('*', '') for s in sides.nth(3).locator('.nf > span').all_text_contents()] == ['Inner', 'Outer']
        rects = sides.nth(3).locator('[data-tire]').evaluate_all('(es)=>es.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,clip:e.scrollWidth>e.clientWidth};})')
        assert abs(rects[0]['top'] - rects[1]['top']) < 1 and rects[0]['right'] < rects[1]['left']
        assert all(not r['clip'] for r in rects)
        assert not page.locator('.sub-body').evaluate('(e)=>e.scrollWidth>e.clientWidth')
        page.locator('.tz-car-tires').evaluate('(e)=>e.scrollIntoView({block:"center"})')
        page.screenshot(path=str(OUT / f'car-dually-{width}.png'))
        page.click('[data-tire="rri"]')
        page.wait_for_selector('#tpMiles')
        assert 'Passenger rear, inner' in page.locator('.sub-bar h2').inner_text()
        page.click('.sub-back')
        page.wait_for_selector('#tzSame')
        page.uncheck('#tzDually')
        assert page.locator('.sub-page [data-tire]').count() == 4
        page.click('.sub-back')
        page.click('[data-sub="tr:layout-trailer"]')
        assert page.locator('.sub-page [data-tr-tire]').count() == 8
        assert page.locator('.sub-page [data-tire],.sub-page #tzDually').count() == 0
        page.fill('input[id$="_Name"]', 'Keep this trailer')
        page.dispatch_event('input[id$="_Name"]', 'change')
        page.click('.sub-back')
        page.click('#tzDet')
        page.click('#tzDiscard')
        page.click('#cfmYes')
        assert page.evaluate('Garage.car().tires.trailers[0].name') == 'Keep this trailer', 'car-only discard preserves trailer edits'
        assert not errors, errors
        page.close()
    browser.close()
print('Overview, car-only illustration, mirrored dual pairs, nested return, and trailer isolation passed at 320/448px with large text')
