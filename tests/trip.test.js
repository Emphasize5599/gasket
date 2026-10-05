const T = require('../assets/web/trip.js');
const assert = require('assert');

// ---- link parsing (data= counts below are exact, as Google writes them) ----
// two stops, coordinates per stop, driving
let r = T.parseMapsUrl('https://www.google.com/maps/dir/North+Little+Rock,+AR/Memphis,+TN/@35.1,-91.0,8z/data=!3m1!4b1!4m14!4m13!1m5!1m1!1s0x87d3:0x1!2m2!1d-92.2671!2d34.7695!1m5!1m1!1s0x87d5:0x2!2m2!1d-90.0490!2d35.1495!3e0');
assert.equal(r.stops.length, 2); assert.equal(r.stops[0].address, 'North Little Rock, AR'); assert.equal(r.stops[0].lat, 34.7695); assert.equal(r.stops[1].lng, -90.049);
assert.equal(r.mode, 'drive'); assert.equal(r.avoidDetected, false); assert.equal(r.routeIndex, undefined);
// same street name in two towns: each stop keeps ITS OWN coordinates and full address
r = T.parseMapsUrl('https://www.google.com/maps/dir/100+Main+St,+North+Little+Rock,+AR+72114/100+Main+St,+Conway,+AR+72032/@34.9,-92.3,10z/data=!4m14!4m13!1m5!1m1!1s0xA:0xB!2m2!1d-92.2680!2d34.7699!1m5!1m1!1s0xC:0xD!2m2!1d-92.4421!2d35.0887!3e0');
assert.equal(r.stops[0].address, '100 Main St, North Little Rock, AR 72114'); assert.equal(r.stops[1].address, '100 Main St, Conway, AR 72032');
assert.equal(r.stops[0].lat, 34.7699); assert.equal(r.stops[1].lat, 35.25);
assert.equal(r.stops[0].short, '100 Main St, North Little Rock'); assert.equal(r.stops[1].short, '100 Main St, Conway');
// your location -> place (empty block for the current location) with avoid tolls and the 2nd route picked (!5i1)
r = T.parseMapsUrl('https://www.google.com/maps/dir//Hot+Springs,+AR/data=!4m14!4m13!1m0!1m5!1m1!1s0x1!2m2!1d-93.05!2d34.50!2m3!1b0!2b1!3b0!3e0!5i1');
assert.equal(r.stops[0].current, true); assert.equal(r.stops[0].lat, undefined); assert.equal(r.stops[1].lat, 34.5);
assert.equal(r.avoid.tolls, true); assert.equal(r.avoid.highways, false); assert.equal(r.routeIndex, 1);
assert.equal(T.parseMapsUrl('https://www.google.com/maps/dir//Hot+Springs,+AR/data=!4m13!4m12!1m0!1m5!1m1!1s0x1!2m2!1d-93.05!2d34.50!2m3!1b0!2b1!3b0!3e0!5i2').routeIndex, 2, 'route number just outside the stops element');
// three stops where only some blocks carry coordinates: coordinates go to the right stops, by position
r = T.parseMapsUrl('https://www.google.com/maps/dir/34.7695,-92.2671/Little+Rock,+AR/Hot+Springs,+AR/data=!4m11!4m10!1m0!1m0!1m5!1m1!1s0x1!2m2!1d-93.05!2d34.50!3e0');
assert.equal(r.stops[0].lat, 34.7695); assert.equal(r.stops[1].lat, undefined, 'no coordinates for Little Rock -> not guessed'); assert.equal(r.stops[2].lat, 34.5);
// the real phone share link from Oct 5 (maps.app.goo.gl/ReAlTrIp42): street-only names, coordinates as !8m2!3d!4d
r = T.parseMapsUrl('https://www.google.com/maps/dir/500+Woodlane+St/210+Capitol+Ave/data=!4m14!4m13!1m5!1m4!1s0x5:0x6!8m2!3d34.7464809!4d-92.2895948!1m5!1m4!1s0x7:0x8!8m2!3d41.7640350!4d-72.6823870!3e0?utm_source=mstt_0&skid=test');
assert.equal(r.stops[0].address, '500 Woodlane St'); assert.equal(r.stops[0].lat, 34.7464809); assert.equal(r.stops[0].lng, -92.2895948);
assert.equal(r.stops[1].lat, 41.7640350); assert.equal(r.stops[1].lng, -72.6823870); assert.equal(r.mode, 'drive');
// exporting a street-only stop uses its exact spot, never the bare street name
assert.ok(/origin=34\.746481%2C-92\.289595/.test(T.exportUrl(r, [], { legEnds: [1300] }).url), T.exportUrl(r, [], { legEnds: [1300] }).url);
// garbage data: nothing is guessed
r = T.parseMapsUrl('https://www.google.com/maps/dir/A+St,+X/B+St,+Y/data=!zz!1d1!2d2');
assert.equal(r.stops[0].lat, undefined);
r = T.parseMapsUrl('https://www.google.com/maps/dir/?api=1&origin=North%20Little%20Rock%2C%20AR&destination=Dallas%2C%20TX&waypoints=Texarkana%2C%20TX&avoid=tolls');
assert.equal(r.stops.length, 3); assert.equal(r.avoid.tolls, true);
assert.equal(T.parseMapsUrl('https://www.google.com/maps/place/Walmart'), null);
assert.equal(T.extractUrl('Directions from North Little Rock to Memphis\nhttps://maps.app.goo.gl/AbC123xyz'), 'https://maps.app.goo.gl/AbC123xyz');
assert.ok(T.isShortLink('https://maps.app.goo.gl/AbC123xyz'));
// ---- polyline ----
const pts = [{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }];
assert.equal(T.encodePolyline(pts), '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
assert.deepEqual(T.decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), pts);

// ---- synthetic trip: due east along lat 35, ~283 road miles, all highway ----
const line = []; for (let i = 0; i <= 500; i++) line.push({ lat: 35, lng: -92 + 5 * i / 500 });
const totalMi = 283.5;
const steps = [];
for (let k = 0; k < 10; k++) steps.push({ distanceMeters: totalMi / 10 * 1609.344, staticDuration: Math.round(totalMi / 10 / 65 * 3600) + 's' });
const route = { distanceMeters: totalMi * 1609.344, duration: '15700s', polyline: { encodedPolyline: T.encodePolyline(line) }, legs: [{ steps }] };
const car = { city: 25, hwy: 35, comb: 29 };
const m = T.buildRoute(route, car);
assert.ok(Math.abs(m.totalMi - totalMi) < 0.01);
assert.ok(Math.abs(m.galTo(totalMi) - totalMi / 35) < 0.01, 'highway gpm used at 65 mph');
const pr = T.project(m, { lat: 35.02, lng: -91 });
assert.ok(Math.abs(pr.along - totalMi / 5) < 1 && Math.abs(pr.offset - 1.38) < 0.05, JSON.stringify(pr));
assert.equal(T.chunks(m, 100).length, 3);

const at = (mi, price, det, id) => { const p = m.pointAt(mi); return { id, d: mi, detourMi: det, detourMin: det * 2, price, lat: p.lat, lng: p.lng }; };
const base = { model: m, capGal: 12, bufferGal: 30 / 29, arriveGal: 30 / 29, fillUp: false, stopPenalty: 1, timeValue: 0, stopMinutes: 8 };

// 1) start with 100 mi of range: one stop is needed; the cheap one 2 mi off the road wins over the on-road pricey one
let o = Object.assign({}, base, { startGal: 100 / 29, cands: [at(40, 3.30, 0.1, 'onroad'), at(45, 2.90, 2, 'cheap'), at(150, 3.40, 0.1, 'late')] });
let p = T.plan(o);
assert.ok(p.ok); assert.equal(p.stops.length, 1); assert.equal(p.stops[0].c.id, 'cheap');
assert.ok(p.savings > 0, 'beats the convenient plan');
assert.equal(p.easy.stops[0].c.id, 'onroad');
assert.ok(p.arriveMi >= 30 - 0.5);

// 2) a big detour for a tiny saving is not worth it
o = Object.assign({}, base, { startGal: 100 / 29, cands: [at(40, 3.30, 0.1, 'onroad'), at(45, 3.28, 9, 'far')] });
p = T.plan(o);
assert.equal(p.stops[0].c.id, 'onroad');

// 3) enough gas to finish: no stop unless it pays for itself
o = Object.assign({}, base, { startGal: 11, cands: [at(100, 3.30, 0.2, 'meh')], refPrice: 3.30 });
p = T.plan(o);
assert.equal(p.stops.length, 0); assert.ok(p.noStopGal > base.arriveGal);

// 4) unreachable gap -> not ok, and says how far you get
o = Object.assign({}, base, { capGal: 5, startGal: 60 / 29, cands: [at(20, 3, 0.1, 'a')] }); // full 5 gal ~175 mi can't cover mile 20 -> 283
p = T.plan(o);
assert.equal(p.ok, false); assert.equal(p.reachMi, 20);

// 5) never arrives anywhere under the buffer, and buys no more than the tank holds
o = Object.assign({}, base, { startGal: 50 / 29, cands: [10, 60, 110, 160, 210, 260].map((mi, i) => at(mi, 3 + (i % 2) * 0.2, 0.3, 's' + i)) });
p = T.plan(o);
assert.ok(p.ok);
p.stops.forEach(s => { assert.ok(s.arriveGal >= base.bufferGal - 0.1, 'buffer kept'); assert.ok(s.departGal <= 12 + 1e-9); });
// fill-up mode always departs full
p = T.plan(Object.assign({}, o, { fillUp: true }));
p.stops.forEach(s => assert.ok(Math.abs(s.departGal - 12) < 1e-9));

// 6) already under the buffer at the start: still finds the nearest stop
o = Object.assign({}, base, { startGal: 15 / 29, cands: [at(8, 3.5, 0.2, 'near'), at(60, 2.9, 0.2, 'far')] });
p = T.plan(o);
assert.ok(p.ok); assert.equal(p.stops[0].c.id, 'near');

// 7) "arrive with the most gas": you must stop, and the last stop fills the tank; closeness to the end is rewarded
o = Object.assign({}, base, { startGal: 11, lastFull: true, refPrice: 3.30, cands: [at(100, 3.10, 0.2, 'early'), at(250, 3.20, 0.2, 'late'), at(275, 3.60, 0.1, 'pricey')] });
p = T.plan(o);
assert.ok(p.ok); const lastStop = p.stops[p.stops.length - 1];
assert.ok(Math.abs(lastStop.departGal - 12) < 1e-9, 'last stop fills up');
assert.equal(lastStop.c.id, 'late', 'cheap-ish and close to the end beats cheap-but-early and close-but-pricey');
assert.ok(p.arriveGal > 10.9, 'arrives nearly full: ' + p.arriveGal);
// without the option no stop is made
assert.equal(T.plan(Object.assign({}, o, { lastFull: false })).stops.length, 0);

// 7b) the final fill-up doesn't need to clear the "must save $X" bar: late & cheapest wins even when it's a thin call
o = Object.assign({}, base, { startGal: 6, lastFull: true, stopPenalty: 0.25, refPrice: 3.10, cands: [at(120, 2.93, 0.2, 'mid'), at(260, 2.92, 0.3, 'lateCheap')] });
p = T.plan(o);
assert.equal(p.stops[p.stops.length - 1].c.id, 'lateCheap');

// 8) top-ups near the destination
o = Object.assign({}, base, { startGal: 11, lastFull: true, refPrice: 3.30, cands: [at(100, 3.10, 0.2, 'early'), at(250, 3.20, 0.2, 'late'), at(275, 3.60, 0.1, 'pricey')] });
p = T.plan(o);
const tops = T.topUps(o, p, 10);
assert.equal(tops.length, 1); assert.equal(tops[0].c.id, 'pricey');
assert.ok(Math.abs(tops[0].toDestMi - (283.5 - 275 + 0.05)) < 0.01);
assert.ok(tops[0].buyGal > 0.5 && tops[0].buyGal < 1, 'tops up what it burned since the last stop: ' + tops[0].buyGal);
assert.ok(Math.abs(tops[0].endGal - (12 - (8.5 / 35 + 0.05 * m.cityGpm))) < 0.01);
assert.ok(Math.abs(tops[0].extraPerGal - 0.40) < 1e-9);
assert.equal(T.topUps(o, p, 5).length, 0);
assert.equal(T.topUps(o, p, 8.6).length, 1);   // tenths matter

// 9) trip cost accounting (average cost of the gas you burn)
const acc = T.account(10, 3.00, [{ stops: [{ arriveGal: 4, buyGal: 8, price: 2.50 }], arriveGal: 6 }]);
assert.ok(Math.abs(acc.legs[0].cost - 34) < 1e-9, acc.legs[0].cost); assert.equal(acc.legs[0].spend, 20);
assert.ok(Math.abs(acc.endValue - 16) < 1e-9); assert.equal(acc.endGal, 6);
const acc2 = T.account(10, 3.00, [{ stops: [{ arriveGal: 4, buyGal: 8, price: 2.50 }], arriveGal: 6 }, { stops: [], arriveGal: 2 }]);
assert.ok(Math.abs(acc2.legs[1].cost - 4 * 32 / 12) < 1e-9);

// 10) the drive back on the same roads
const rm = T.reverseModel(m);
assert.ok(Math.abs(rm.galTo(rm.totalMi) - m.galTo(m.totalMi)) < 1e-9);
assert.ok(Math.abs(rm.galTo(50) - (m.galTo(m.totalMi) - m.galTo(m.totalMi - 50))) < 1e-9);
assert.ok(Math.abs(rm.pointAt(0).lng - m.pointAt(m.totalMi).lng) < 1e-9);
const back = T.mirror([at(40, 3, 0.1, 'x')], m.totalMi);
assert.ok(Math.abs(back[0].d - (283.5 - 40)) < 1e-9);

// 11) "save at least $X for up to Y extra minutes"
o = Object.assign({}, base, { startGal: 100 / 29, stopPenalty: 1, detourPenalty: 1,
  cands: [at(40, 3.30, 0.1, 'onroad'), Object.assign(at(42, 3.24, 1.2, 'offroad'), { detourMin: 3 })] });
assert.equal(T.plan(o).stops[0].c.id, 'onroad', '6c/gal on ~9 gal (~$0.55) does not clear $1');
assert.equal(T.plan(Object.assign({}, o, { stopPenalty: 0.25, detourPenalty: 0.25 })).stops[0].c.id, 'offroad', 'clears $0.25');
let far = T.plan(Object.assign({}, o, { stopPenalty: 0, detourPenalty: 0, maxDetourMin: 2 }));
assert.equal(far.stops[0].c.id, 'onroad'); assert.equal(far.tooFar, 1, 'over the minute limit -> not considered');

// 12) why the pricier station was picked
o = Object.assign({}, base, { startGal: 100 / 29, stopPenalty: 1, detourPenalty: 1,
  cands: [at(40, 3.30, 0.1, 'onroad'), Object.assign(at(42, 3.24, 1.2, 'offroad'), { detourMin: 3, station: { name: 'Murphy USA' } })] });
p = T.plan(o);
assert.equal(p.stops[0].c.id, 'onroad');
assert.ok(/Murphy USA \(2 mi later\) is 6¢\/gal cheaper, but it's 1\.2 mi off the route, and leaving the route has to save at least \$1\.00/.test(p.stops[0].why), p.stops[0].why);
// detour costs more than it saves
o = Object.assign({}, base, { startGal: 100 / 29, stopPenalty: 0, detourPenalty: 0,
  cands: [at(40, 3.30, 0.1, 'onroad'), Object.assign(at(41, 3.29, 6, 'far'), { detourMin: 15, station: { name: 'Exxon' } })] });
p = T.plan(o);
assert.ok(/burns about \$0\.\d\d of gas, more than the \$0\.\d\d it would save/.test(p.stops[0].why), p.stops[0].why);
// over the minute limit
p = T.plan(Object.assign({}, o, { maxDetourMin: 10 }));
assert.ok(/15 min out of the way — over your 10-minute limit/.test(p.stops[0].why), p.stops[0].why);
// can't reach the cheaper one above the buffer
o = Object.assign({}, base, { startGal: 50 / 29, stopPenalty: 1, cands: [at(10, 3.40, 0.1, 'near'), Object.assign(at(30, 3.35, 0.1, 'beyond'), { station: { name: 'CITGO' } })] });
p = T.plan(o);
assert.equal(p.stops[0].c.id, 'near');
assert.ok(/less than your 30-mile buffer/.test(p.stops[0].why), p.stops[0].why);
// cheapest station chosen -> no explanation
o = Object.assign({}, base, { startGal: 100 / 29, cands: [at(40, 3.10, 0.1, 'best'), at(45, 3.30, 0.1, 'worse')] });
assert.equal(T.plan(o).stops[0].why, null);

// ---- export: full addresses, place IDs when every stop has one ----
const rt = { stops: [{ current: true, label: 'Your location' }, { address: '100 Main St, Conway, AR 72032' }, { address: 'Dallas, TX', lat: 32.77, lng: -96.79 }] };
const fake = { legEnds: [50, 283] };
const stA = { d: 120, lat: 35.1, lng: -91.2, station: { id: 'ChIJexxon', address: '12 Hwy 67, Malvern, AR 72104, USA' } };
const stB = { d: 20, lat: 35.0, lng: -91.9, station: { id: 'mu-501', address: '96 Hwy 67, Malvern, AR 72104' } };
let ex = T.exportUrl(rt, [{ c: stA }, { c: stB }], fake);
assert.ok(!/origin=/.test(ex.url));
assert.ok(/waypoints=96%20Hwy%2067%2C%20Malvern%2C%20AR%2072104%7C100%20Main%20St%2C%20Conway%2C%20AR%2072032%7C12%20Hwy%2067/.test(ex.url), ex.url);
assert.ok(!/waypoint_place_ids/.test(ex.url), 'not every stop has a place id');
assert.ok(/destination=Dallas%2C%20TX/.test(ex.url));
const rt2 = { stops: [{ address: 'A full, AR', placeId: 'P0' }, { address: 'B full, TX', placeId: 'P9' }] };
ex = T.exportUrl(rt2, [{ c: stA }], fake);
assert.ok(/origin_place_id=P0/.test(ex.url) && /destination_place_id=P9/.test(ex.url) && /waypoint_place_ids=ChIJexxon/.test(ex.url), ex.url);

// ---- speed: 300 candidates over a 1,000-mile trip ----
const big = []; for (let i = 0; i <= 2000; i++) big.push({ lat: 35, lng: -100 + 17.6 * i / 2000 });
const m2 = T.buildRoute({ distanceMeters: 1000 * 1609.344, duration: '55000s', polyline: { encodedPolyline: T.encodePolyline(big) }, legs: [{ steps }] }, car);
const many = []; for (let i = 0; i < 300; i++) { const mi = 1 + i * 3.3; const pt = m2.pointAt(mi); many.push({ id: 'x' + i, d: mi, detourMi: (i % 5) * 0.4, detourMin: i % 5, price: 3 + ((i * 37) % 50) / 100, lat: pt.lat, lng: pt.lng }); }
const t0 = Date.now();
p = T.plan({ model: m2, capGal: 15, bufferGal: 1.2, arriveGal: 1.2, startGal: 5, cands: many, stopPenalty: 1, stopMinutes: 8 });
const ms = Date.now() - t0;
assert.ok(p.ok); assert.ok(ms < 3000, 'planner took ' + ms + 'ms');
console.log('trip tests passed (1,000-mile / 300-station plan in ' + ms + ' ms, ' + p.stops.length + ' stops, saves $' + p.savings.toFixed(2) + ')');
