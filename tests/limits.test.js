// Speed limits along a route: state lookup, picking the right HPMS segment, state-max fallback, per-leg cost.
const assert = require('assert');
global.window = global;
require('../assets/web/states.js');
const L = require('../assets/web/limits.js');
const T = require('../assets/web/trip.js');
const SP = require('../assets/web/speed.js');

assert.equal(L.stateAt(34.7695, -92.2671), 'AR', 'North Little Rock');
assert.equal(L.stateAt(32.7767, -96.797), 'TX', 'Dallas');
assert.equal(L.stateAt(41.7640, -72.6824), 'CT', 'Hartford');
assert.equal(L.stateAt(36.1627, -86.7816), 'TN', 'Nashville');
assert.equal(L.stateAt(30.0, -88.5), null, 'Gulf of Mexico');
// overpass: a 45-mph road crosses the interstate; Google says we're doing ~68 -> pick the 70
let p = L.pick([{ attributes: { speed_limit: 45, f_system: 4 } }, { attributes: { speed_limit: 70, f_system: 1, route_signing: 2, route_number: 40 } }, { attributes: { speed_limit: 55, facility_type: 4 } }], 68);
assert.equal(p.limit, 70);
p = L.pick([{ attributes: { speed_limit: null, f_system: 1, urban_id: 99999 } }], 70);
assert.equal(p.limit, null); assert.equal(L.stateMax('AR', p.a, 70), 75, 'rural interstate max in Arkansas');
assert.equal(L.stateMax('AR', { f_system: 1, urban_id: 4100 }, 60), 65, 'urban');
assert.equal(L.stateMax('TX', { f_system: 3, urban_id: 99999 }, 52), 60, 'capped near Google speed (52 + 8 -> 60, under the 75 max)');
assert.equal(L.stateMax('ZZ', null, 60), null);

// along(): a synthetic 300-mile route across AR, with an answer for every point
const line = []; for (let i = 0; i <= 400; i++) line.push({ lat: 34.77 - 0.4 * i / 400, lng: -92.27 - 2.0 * i / 400 });
const steps = [{ distanceMeters: 10 * 1609.344, staticDuration: Math.round(10 / 35 * 3600) + 's' }, { distanceMeters: 290 * 1609.344, staticDuration: Math.round(290 / 68 * 3600) + 's' }];
const route = { distanceMeters: 300 * 1609.344, duration: '16000s', polyline: { encodedPolyline: T.encodePolyline(line) }, legs: [{ steps }] };
const m = T.buildRoute(route, { city: 30, hwy: 38, comb: 33 });
const urls = [];
L.along(m, async (u) => { urls.push(u); return { body: JSON.stringify({ features: urls.length % 3 ? [{ attributes: { speed_limit: 70, f_system: 1, route_signing: 2, route_number: 30 } }] : [{ attributes: { f_system: 1, urban_id: 99999 } }] }) }; }, {}).then((res) => {
  const cruise = res.stretches.filter(s => s.cruise);
  assert.ok(!res.stretches[0].cruise, 'first 10 mi at 35 mph is town driving');
  assert.ok(urls.every(u => /HPMS_FULL_AR_2023\/FeatureServer\/0\/query\?geometry=-9\d\.\d+,3\d\.\d+&geometryType=esriGeometryPoint/.test(u)), urls[0]);
  assert.ok(cruise.every(s => s.limit === 70 || s.limit === 75), cruise.map(s => s.limit));
  assert.ok(res.stats.hpms > 0 && res.stats.state > 0);
  // per-leg cost at +5 over the limits with a 30-mpg car curve
  const cv = SP.curve('car', 38, 1, 30, 95), f = (v) => SP.at(cv, v);
  const legA = SP.leg(cruise, 0, f, 3, 40, 90), legB = SP.leg(cruise, 5, f, 3, 40, 90);
  assert.equal(legA.cost, 0); assert.equal(legA.minSaved, 0);
  assert.ok(legB.cost > 0 && legB.minSaved > 0, JSON.stringify(legB));
  console.log('limits tests passed —', urls.length, 'HPMS lookups;', res.stats, '| +5 mph over', Math.round(legB.mi), 'mi:', Math.round(legB.minSaved), 'min sooner for $' + legB.cost.toFixed(2));
}).catch((e) => { console.error(e); process.exit(1); });
