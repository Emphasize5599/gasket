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
assert.equal(p.limit, null); // truck limits (state law; no road database carries them): I-57 in Arkansas is posted 75, trucks 70
assert.equal(L.truckLimit('AR', 'interstate', 1, 75), 70, 'I-57 Arkansas: trucks 70');
assert.equal(L.truckLimit('AR', 'us', 2, 75), 70, 'Arkansas freeways too');
assert.equal(L.truckLimit('AR', 'us', 3, 65), 65, 'other Arkansas roads: same as cars');
assert.equal(L.truckLimit('IL', 'interstate', 1, 70), 70, 'I-57 Illinois: trucks 70 too');
assert.equal(L.truckLimit('CA', 'state', 3, 65), 55); assert.equal(L.truckLimit('MI', 'interstate', 1, 75), 65); assert.equal(L.truckLimit('TX', 'interstate', 1, 75), 75);
const secT = L.sections([{ from: 0, to: 5, mi: 5, limit: 75, truck: 70, src: 'hpms', st: 'AR' }, { from: 5, to: 10, mi: 5, limit: 75, truck: 70, src: 'hpms', st: 'AR' }, { from: 10, to: 15, mi: 5, limit: 70, truck: 70, src: 'hpms', st: 'MO' }]);
assert.equal(secT.length, 2); assert.equal(secT[0].truck, 70); assert.equal(secT[1].truck, 70);
assert.equal(L.stateMax('AR', p.a, 70), 75, 'rural interstate max in Arkansas');
assert.equal(L.stateMax('AR', { f_system: 1, urban_id: 4100 }, 60), 65, 'urban');
assert.equal(L.stateMax('TX', { f_system: 3, urban_id: 99999 }, 52), 60, 'capped near Google speed (52 + 8 -> 60, under the 75 max)');
assert.equal(L.stateMax('ZZ', null, 60), null);

// road names from Google's instructions, grouped into major stretches
assert.deepEqual(L.roadOf('Use the right 2 lanes to take exit 1A to merge onto I-81 N toward Roanoke'), { key: 'I-81', name: 'I-81 N', cls: 'interstate', num: '81' });
assert.equal(L.roadOf('Turn left onto Main St'), null);
assert.equal(L.roadOf('Turn right onto AR-367 N').cls, 'state');
assert.equal(L.roadOf('Turn right onto County Rd 12').cls, 'county');
assert.equal(L.roadOf('Take exit 45 toward Downtown'), null);
const fakeSegs = [['Head east on Main St', 0, 1], ['Merge onto US-67 S', 1, 40], ['Continue onto US-67 S', 40, 60], ['Take exit 1A to merge onto I-30 W', 60, 61],
  ['Take exit 2 for I-440', 61, 62], ['Merge onto I-30 W', 62, 200], ['Turn right onto Elm St', 200, 201]].map(([instr, from, to]) => ({ instr, from, to }));
const rs = L.roads({ segs: fakeSegs });
assert.deepEqual(rs.map(r => [r.name, r.from, r.to]), [['US-67 S', 1, 60], ['I-30 W', 60, 200]], JSON.stringify(rs));
// matching the HPMS segment for that road (not the crossing one)
assert.equal(L.pickFor([{ attributes: { speed_limit: 55, route_number: 67, route_signing: 3 } }, { attributes: { speed_limit: 70, route_number: 30, route_signing: 2 } }], { cls: 'interstate', num: '30' }, 50).limit, 70);

// along(): a synthetic 300-mile route across AR, with an answer for every point
const line = []; for (let i = 0; i <= 400; i++) line.push({ lat: 34.77 - 0.4 * i / 400, lng: -92.27 - 2.0 * i / 400 });
const steps = [{ distanceMeters: 10 * 1609.344, staticDuration: Math.round(10 / 35 * 3600) + 's', navigationInstruction: { instructions: 'Head west on Main St' } },
  { distanceMeters: 290 * 1609.344, staticDuration: Math.round(290 / 68 * 3600) + 's', navigationInstruction: { instructions: 'Merge onto I-30 W' } }];
const route = { distanceMeters: 300 * 1609.344, duration: '16000s', polyline: { encodedPolyline: T.encodePolyline(line) }, legs: [{ steps }] };
const m = T.buildRoute(route, { city: 30, hwy: 38, comb: 33 });
const urls = [];
L.along(m, async (u) => { urls.push(u); return { body: JSON.stringify({ features: urls.length % 3 ? [{ attributes: { speed_limit: 70, f_system: 1, route_signing: 2, route_number: 30 } }] : [{ attributes: { f_system: 1, urban_id: 99999 } }] }) }; }, {}).then((res) => {
  assert.equal(res.roads.length, 1); assert.equal(res.roads[0].name, 'I-30 W');
  const cruise = res.roads[0].pieces.map(p => Object.assign({ cruise: true }, p));
  assert.ok(res.roads[0].from >= 9.9, 'town streets left out');
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
