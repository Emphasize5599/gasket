// A station search can run in the background: leaving it (✕, Back, phone Back) asks "cancel or run in the background";
// in the background its status bar shows progress with a ✕, everything that would change its data is grayed out
// (step tabs, grades, fuel mode, refresh, settings, other trips), it finishes with "Open", and the screen stays smooth.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url'), { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined }); try {
    const shots = process.env.SHOT, p = await b.newPage({ viewport: { width: 360, height: 800 } }), errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href); await require('./onboarding-ui')(p);
    await p.waitForFunction(() => !document.body.classList.contains('job-on'), null, { timeout: 20000 });   // the map's first look around
    await p.evaluate(fs.readFileSync('tests/trip_mocks.js', 'utf8'));
    await p.evaluate(() => {
      const A = __app, S = A.S; S.apiKey = ''; S.keylessWorkers = 4; S.trip.fuel = { mode: 'miles', miles: '180' }; S.trip.milesLeft = '180'; S.trip.bufferMi = 30; S.brands = { exxon: true, other: true };
      const alts = __mocks.route({ origin: { placeId: 'P-start' }, destination: { placeId: 'P-end' }, computeAlternativeRoutes: true }).routes.map((a) => Object.assign(a, { websiteApproximate: true }));
      const m = Trip.buildRoute(alts[0], Garage.carModel());
      const stations = [60, 120, 180, 240, 300].map((mi, i) => { const pt = m.pointAt(mi); return { id: 'test:' + i, name: 'Exxon', brand: 'exxon', lat: pt.lat, lng: pt.lng, address: i + ' Main St', state: 'AR', prices: { regular: { price: 3.1 + i * .1, updated: new Date().toISOString() } }, detourMi: 1, detourExact: true }; });
      const saved = { route: { stops: [{ label: 'Start', address: '100 Main St', lat: m.pts[0].lat, lng: m.pts[0].lng }, { label: 'End', address: '200 Main St', lat: m.pts.at(-1).lat, lng: m.pts.at(-1).lng }] }, alts, altSel: 0, trip: { fuel: S.trip.fuel, milesLeft: '180', bufferMi: 30, avoid: {} }, stations: { official: [], google: [{ k: 0, list: stations }] }, savedT: Date.now() };
      A.KV.put('trips', 'trip|bg', saved); A.KV.put('trips', 'index', [{ id: 'bg', title: 'Start → End', t: saved.savedT, mi: 318, via: 'Test route', n: 5 }]);
      // the website readers wait for the test: held ('hold'), one area at a time ('slow'), or all at once ('go')
      window.__gate = 'hold'; window.__held = []; window.__cancels = 0;
      const answer = (id, a) => onNativeResult(id, { stores: [{ id: 'web:' + a.lat.toFixed(3), name: 'Exxon', lat: a.lat, lng: a.lng + 0.001, address: 'Main St, Testville', prices: { regular: { price: 3.05 } }, source: 'Google Maps web' }], detail: { exhausted: true, stopReason: 'end', read: 1 } });
      A.N.siteRead = (id, key, json) => {
        if (!/^gasweb/.test(key)) return setTimeout(() => onNativeResult(id, { error: 'mock skip' }), 1);
        const a = JSON.parse(json), m2 = /@(-?[\d.]+),(-?[\d.]+)/.exec(a.url) || [0, 34, -92]; const area = { lat: +m2[1], lng: +m2[2] };
        if (__gate === 'go') return setTimeout(() => answer(id, area), 5);
        __held.push(() => answer(id, area));
      };
      A.N.cancelSiteRead = (key) => { window.__cancels++; };
      setInterval(() => { if (__gate === 'slow' && __held.length) __held.shift()(); else if (__gate === 'go') while (__held.length) __held.shift()(); }, 60);
    });
    const st = () => p.evaluate(() => { const s = __trip.state(); return { step: s.step, busy: s.busy, job: !!(__app.job() && __app.job().kind), open: !document.getElementById('trip').classList.contains('hidden') }; });
    const discover = async () => { await p.click('#taResults [data-split]'); await p.click('#taResults [data-trip-refresh="discover"]'); await p.waitForFunction(() => __trip.state().busy && __app.job()); };
    await p.click('#btnTrip'); await p.click('[data-hist="bg"]'); await p.waitForFunction(() => __trip.state().model && !__trip.state().busy);
    await p.waitForFunction(()=>!Tasks.list().some(t=>t.id==='trip-draw'),'saved-trip opening status must settle');
    await p.evaluate(() => { __app.S.trip.departNow = true; });   // (a reopened trip asks when you're leaving: now)
    await p.evaluate(() => __trip.step(6)); await p.waitForFunction(() => __trip.state().result && !__trip.state().busy);

    // 1. a search on its own screen: no status bar (the step shows it); the steps that would change it are closed
    await discover();
    await p.waitForSelector('#jobBar:not(.hidden)',{timeout:2000}).catch(()=>{});   // the dock paints on the next animation frame
    assert.equal(await p.locator('#jobBar:not(.hidden)').count(), 1, 'The global status bar remains visible above Adjustments');
    assert.equal(await p.locator('#taResults .prog-load').count(),0,'no duplicate progress inside the menu');assert.equal(await p.locator('#jobBar [data-cancel="stations"]').count(),1,'cancellation stays available in the dock');assert.equal(await p.isDisabled('#tNext'),true);assert.equal(await p.innerText('#tNext'),'Next');
    assert.equal(await p.locator('#taResults .card.skel .prog-load').count(),0,'buffer/detour skeletons do not repeat station discovery progress');
    assert.equal(await p.locator('#taResults .price-refresh-card .prog-load').count(),0,'refresh tile only shows CSS placeholders');assert.equal(await p.locator('#taResults .scan-pending').count(),1);
    assert.deepEqual(await p.evaluate(() => [1, 2, 3, 4, 5, 7, 8, 9].map((k) => document.querySelector('#tpSteps [data-step="' + k + '"]').disabled)), [true, false, true, false, true, true, false, true],
      'Garage, Route, Hazards (they would change it) and Stops, Departure (it is about to change them) closed while it runs');
    await p.click('#tpSteps [data-step="8"]');await p.waitForSelector('#tCompare');
    assert.equal(await p.locator('#vcCompare').isDisabled(),true);assert.equal(await p.locator('#vcAdd').isDisabled(),true);
    assert.equal(await p.locator('[data-vc-edit]:enabled,[data-vc-plan]:enabled,[data-vc-use]:enabled').count(),0,'Compare is read-only while discovery runs');
    await p.click('#tpSteps [data-step="6"]');await p.waitForFunction(()=>__trip.state().step===6);
    // Advice and Parameters still open, and Advice's tab row goes on to Parameters
    await p.click('#tpSteps [data-step="2"]'); await p.waitForFunction(() => __trip.state().step === 2);
    await p.click('#tpSteps [data-step="4"]'); await p.waitForFunction(() => __trip.state().step === 4);
    assert.ok((await st()).busy, 'still searching'); await p.click('#tpSteps [data-step="6"]'); await p.waitForFunction(() => __trip.state().step === 6);
    await p.click('#tpSteps [data-step="3"]', { force: true }); assert.equal((await st()).step, 6, 'a closed step cannot be opened');

    // 2. ✕ asks; a tap outside the question keeps you here, with the search still running
    await p.click('#tClose'); await p.waitForSelector('#cfm.on');
    assert.deepEqual(await p.evaluate(() => [document.getElementById('cfmNo').textContent, document.getElementById('cfmYes').textContent]), ['Cancel search', 'Run in background']);
    if (shots) await p.screenshot({ path: shots + '/bg-ask.png' });
    await p.mouse.click(10, 10); await p.waitForSelector('#cfm', { state: 'detached' });
    assert.deepEqual(await st(), { step: 6, busy: true, job: true, open: true }, 'stayed, still searching');

    // 3. run in the background: the trip closes, the status bar shows progress and a ✕, and what would change it is grayed out
    await p.click('#tClose'); await p.waitForSelector('#cfm.on'); await p.click('#cfmYes'); await p.waitForSelector('#cfm', { state: 'detached' });
    await p.waitForSelector('#jobBar:not(.hidden) .pbar');
    assert.deepEqual(await st(), { step: 6, busy: true, job: true, open: false });
    const locks = await p.evaluate(() => ({
      disabled: ['btnSettings', 'btnRefresh', 'btnMode'].map((id) => document.getElementById(id).disabled),
      grades: getComputedStyle(document.getElementById('grades')).pointerEvents, gray: +getComputedStyle(document.getElementById('btnSettings')).opacity,
      trip: document.getElementById('btnTrip').disabled, map: !document.querySelector('.ld-wrap.fixed, .loader.fixed'),
      bar: document.querySelector('#jobBar .jb-t').textContent }));
    console.log('  background:', JSON.stringify(locks));
    assert.deepEqual(locks.disabled, [true, true, true], 'settings, refresh and fuel mode grayed out'); assert.equal(locks.grades, 'none', 'grades grayed out');
    assert.ok(locks.gray < 0.6); assert.equal(locks.trip, false, 'the trip itself can be reopened');
    assert.match(locks.bar, /^Preparing… · \d+ areas to search$/, 'nothing done yet: Preparing…, not a stuck 0');
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('#jobBar .jb-t')).whiteSpace), 'normal', 'the main-map status wraps');
    if (shots) await p.screenshot({ path: shots + '/bg-map.png' });
    // the map stays usable: pan it
    const c0 = await p.evaluate(() => __app.map.getCenter()); await p.mouse.move(180, 400); await p.mouse.down(); await p.mouse.move(120, 330, { steps: 5 }); await p.mouse.up();
    assert.notDeepEqual(await p.evaluate(() => __app.map.getCenter()), c0, 'the map pans while it runs');
    // other trips can't be started; this one can be continued
    await p.click('#btnTrip'); await p.waitForSelector('#tripPick.on');
    assert.deepEqual(await p.evaluate(() => [getComputedStyle(document.getElementById('tpNew')).pointerEvents, getComputedStyle(document.querySelector('.hist-row')).pointerEvents, getComputedStyle(document.getElementById('tpCont')).pointerEvents]), ['none', 'none', 'auto']);
    await p.click('#tpCont'); await p.waitForFunction(() => !document.getElementById('trip').classList.contains('hidden'));
    assert.equal((await st()).step, 6); await p.waitForSelector('#jobBar:not(.hidden)');

    // 4. Back to Parameters (asks, runs on), where the status bar shows; Back from there is closed (Hazards would change it)
    await p.click('#tBack'); await p.waitForSelector('#cfm.on'); await p.click('#cfmYes'); await p.waitForSelector('#cfm', { state: 'detached' });
    await p.waitForFunction(() => __trip.state().step === 4); await p.waitForSelector('#jobBar:not(.hidden)');
    assert.equal(await p.isDisabled('#tBack'), false, 'Parameters can return to Advice while the search runs');
    // in a full-screen menu the bar sits in the empty space above the step tabs
    await p.evaluate(() => { document.getElementById('trip').classList.add('full'); document.body.classList.add('trip-full'); __app.jobDraw(); });
    const fit = await p.evaluate(() => { const r = document.getElementById('jobBar').getBoundingClientRect(), h = document.querySelector('.tp-head').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, tabs: h.top }; });
    const short = await p.evaluate(() => [document.querySelector('#jobBar .jb-t').textContent, getComputedStyle(document.querySelector('#jobBar .jb-t')).whiteSpace]);
    assert.match(short[0], /^Preparing… · \d+ areas$/); assert.equal(short[1], 'nowrap', 'full screen: one short line');
    console.log('  full screen:', JSON.stringify(fit)); assert.ok(fit.top >= 0 && fit.bottom <= fit.tabs - 8, 'above the step tabs, with room between');
    if (shots) await p.screenshot({ path: shots + '/bg-full.png' });
    await p.evaluate(() => { document.getElementById('trip').classList.remove('full'); document.body.classList.remove('trip-full'); });

    // 5. it finishes while you're elsewhere, smoothly: no long freezes while the areas come in; then "Open"
    await p.evaluate(() => { window.__long = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => __long.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: false }); __gate = 'slow'; });
    await p.waitForFunction(() => __held.length === 0 && !__trip.state().busy, null, { timeout: 60000 });
    const long = await p.evaluate(() => __long); console.log('  long tasks while it ran (ms):', JSON.stringify(long));
    assert.ok(long.filter((d) => d > 250).length === 0, 'no freeze over 250 ms while the search ran in the background');
    await p.waitForSelector('#jobBar.done .jb-go'); assert.match(await p.innerText('#jobBar'), /stops are ready/i);
    assert.equal(await p.evaluate(() => document.body.classList.contains('job-on')), false); assert.equal(await p.isDisabled('#btnSettings'), false, 'unlocked');
    await p.click('#jobBar .jb-go'); await p.waitForFunction(() => __trip.state().step === 6 && document.querySelector('#taResults .price-refresh-card'));
    assert.equal(await p.isDisabled('#tpSteps [data-step="3"]'), false);

    // 6. phone Back → Cancel search: it stops (the readers are told), and Back still goes back
    await p.evaluate(() => { __gate = 'hold'; __cancels = 0; __app.KV.clear('gasweb'); }); await discover();   // (the first search's areas are cached for 15 min)
    await p.evaluate(() => window.onBack()); await p.waitForSelector('#cfm.on'); await p.click('#cfmNo'); await p.waitForSelector('#cfm', { state: 'detached' });
    await p.waitForFunction(() => !__trip.state().busy, null, { timeout: 20000 });
    const c = await p.evaluate(() => ({ step: __trip.state().step, cancels: __cancels, job: !!__app.job(), bar: document.getElementById('jobBar').className }));
    console.log('  cancelled:', JSON.stringify(c));
    assert.equal(c.step, 4); assert.ok(c.cancels > 0, 'the website readers were cancelled'); assert.equal(c.job, false);

    // 7. the status bar's ✕ cancels a background search
    await p.evaluate(() => __trip.step(6)); await p.waitForFunction(() => !__trip.state().busy && document.querySelector('#taResults .price-refresh-card'));
    await p.evaluate(() => __app.KV.clear('gasweb')); await discover(); await p.click('#tClose'); await p.waitForSelector('#cfm.on'); await p.click('#cfmYes'); await p.waitForSelector('#cfm', { state: 'detached' }); await p.waitForSelector('#jobBar:not(.hidden) .jb-x');
    await p.click('#jobBar .jb-x'); await p.waitForFunction(() => !__trip.state().busy, null, { timeout: 20000 });
    await p.waitForSelector('#jobBar.done'); assert.match(await p.innerText('#jobBar'), /cancelled/i);
    assert.equal(await p.evaluate(() => document.body.classList.contains('job-on')), false);

    // 8. a map search: the same bar and ✕, and settings / grades wait for it (the trip doesn't)
    await p.evaluate(() => __trip.step(6)); await p.click('#tClose');
    await p.evaluate(() => { __gate = 'hold'; __app.KV.clear('gasweb'); }); await p.click('#btnRefresh'); await p.click('[data-refresh="discover"]');
    await p.waitForSelector('#jobBar:not(.hidden) .jb-x'); assert.equal(await p.isDisabled('#btnSettings'), true); assert.equal(await p.isDisabled('#btnTrip'), false);
    await p.click('#jobBar .jb-x'); await p.waitForFunction(() => !document.body.classList.contains('job-on'), null, { timeout: 20000 });
    // and a trip search takes over from a map search
    await p.click('#btnRefresh'); await p.click('[data-refresh="discover"]'); await p.waitForFunction(() => __app.job() && __app.job().kind === 'map');
    await p.click('#btnTrip'); await p.click('#tpCont'); await p.evaluate(() => { __gate = 'go'; }); await discover();
    await p.waitForFunction(() => __app.job() && __app.job().kind === 'trip'); await p.waitForFunction(() => !__trip.state().busy, null, { timeout: 30000 });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Background search: ask on leaving, status bar with progress and cancel, grayed-out locks, reopen, finish with Open, Back/✕ cancel, map search, no freezes');
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
