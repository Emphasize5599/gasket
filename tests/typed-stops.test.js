// Typed addresses with stops in between: "+ Add a stop" adds a box between From and To, each stop is its own leg
// (like a Maps link with stops), ✕ takes one out, and the stops are kept with a saved trip.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url'), { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined }); try {
    const p = await b.newPage({ viewport: { width: 320, height: 900 } }), errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);
    await p.fill('#apiKey', 'AIzaSyTESTKEY0123456789abcdefghijklmnop'); await p.click('#sDone');
    await p.evaluate(fs.readFileSync('tests/trip_mocks.js', 'utf8'));
    await p.evaluate(() => {   // the three places, as Google's lookup would find them
      const find = __mocks.find, P = { 'Arkansas State Capitol, Little Rock, AR': ['P-cap-ar', 34.7465, -92.2890], '100 Main St, Testville, AR': ['P-test-ar', 34.1, -93.0], 'Texas State Capitol, Austin, TX': ['P-cap-tx', 30.2747, -97.7404] };
      __mocks.find = (q, ...a) => P[q.trim()] ? { places: [{ id: P[q.trim()][0], displayName: { text: q }, formattedAddress: q + ', USA', location: { latitude: P[q.trim()][1], longitude: P[q.trim()][2] } }] } : find(q, ...a);
    });
    await p.evaluate(() => { window.__bodies = []; const f = __app.N.computeRoute; __app.N.computeRoute = function (id, key, body) { __bodies.push(JSON.parse(body)); return f.apply(this, arguments); }; });
    await p.click('#btnTrip'); if (await p.locator('#tpNew').count()) await p.click('#tpNew');
    await p.evaluate(() => __trip.step(4)); await p.click('#tSrc [data-src="typed"]');
    await p.fill('#tFrom', 'Arkansas State Capitol, Little Rock, AR');
    assert.equal(await p.locator('#tVia .via-in').count(), 0); await p.click('#tViaAdd');
    assert.equal(await p.locator('#tVia .via-in').count(), 1, 'a stop box between From and To');
    assert.ok(await p.evaluate(() => { const v = document.querySelector('#tVia .via-in').getBoundingClientRect(), f = document.getElementById('tFrom').getBoundingClientRect(), t = document.getElementById('tTo').getBoundingClientRect(); return v.top > f.top && v.top < t.top; }), 'in between');
    await p.fill('#tVia .via-in', '100 Main St, Testville, AR'); await p.click('#tViaAdd'); await p.fill('#tVia .via-in >> nth=1', '200 Main St, Testville, TX');
    await p.click('[data-via-x="1"]'); assert.equal(await p.locator('#tVia .via-in').count(), 1, '✕ takes one out');
    await p.fill('#tTo', 'Texas State Capitol, Austin, TX'); await p.dispatchEvent('#tTo', 'change');
    await p.waitForFunction(() => __trip.state().model, null, { timeout: 15000 }).catch(() => {});
    if (!(await p.evaluate(() => !!__trip.state().model)) && await p.locator('#tGetRoutes').count()) { await p.click('#tGetRoutes'); await p.waitForFunction(() => __trip.state().model, null, { timeout: 15000 }); }
    const st = await p.evaluate(() => ({ stops: __trip.state().route.stops.map((s) => s.address || s.label), legs: __trip.state().legs, via: __app.S.trip.via }));
    console.log('  typed route:', JSON.stringify(st));
    assert.equal(st.stops.length, 3); assert.match(st.stops[1], /100 Main St/); assert.deepEqual(st.via, ['100 Main St, Testville, AR']);
    assert.equal(st.legs, 2, 'each stop its own leg');
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Typed stops: add, remove, in order, one leg each');
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
