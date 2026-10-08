// EV / hydrogen planning: the same optimizer in kWh with a coarser grain, an 80% charge cap at stops, and charging
// time counted per kWh (slower chargers cost more of your time).
const T = require('../assets/web/trip.js');
const G = (() => { global.window = {}; return null; })();
const assert = require('assert');
const pts = []; for (let i = 0; i <= 600; i++) pts.push({ lat: 35, lng: -100 + i * 0.0175 });   // ~600 miles east
const raw = { distanceMeters: 600 * 1609.344, duration: '32400s', polyline: { encodedPolyline: T.encodePolyline(pts) }, legs: [] };
const m = T.buildRoute(raw, { city: 4.0, hwy: 3.3, comb: 3.6 });      // mi per kWh
assert.ok(Math.abs(m.totalMi - 600) < 1);
const cands = [];
for (let d = 40; d < 600; d += 40) {
  // every 80 mi a fast 250 kW site, in between a slow 50 kW one at the same price
  const fast = d % 80 === 0, kw = fast ? 175 : 35;
  cands.push({ id: 'c' + d, d, detourMi: 0.3, detourMin: 1, price: 0.45, kw, timeCost: 20 / kw, station: { name: (fast ? 'Fast ' : 'Slow ') + d } });
}
const cap = 75, o = { model: m, cands, startGal: 70, capGal: cap, fillCap: cap * 0.8, step: 0.5, bufferGal: 20 / 3.3, arriveGal: 20 / 3.3,
  stopPenalty: 0.5, detourPenalty: 0.5, timeValue: 20, stopMinutes: 5 };
const t0 = Date.now(), p = T.plan(o);
assert.ok(p.ok, 'an EV plan exists');
p.stops.forEach((s) => {
  assert.ok(s.departGal <= cap * 0.8 + 1e-9, 'never charges above 80%: ' + s.departGal);
  assert.ok(/^Fast/.test(s.c.station.name), 'picks the fast chargers when time counts: ' + s.c.station.name);
});
// starting above 80% is fine (charged at home to 100%)
assert.ok(T.plan(Object.assign({}, o, { startGal: 75 })).ok);
// time off: price is all that counts (all equal) -> still a valid plan
assert.ok(T.plan(Object.assign({}, o, { cands: cands.map((c) => Object.assign({}, c, { timeCost: 0 })) })).ok);
// reachability uses the 80% cap: stations 220 mi apart can't be bridged on 60 kWh at 3.3 mi/kWh with a buffer
const far = [{ id: 'a', d: 150, detourMi: 0, price: 0.45 }, { id: 'b', d: 370, detourMi: 0, price: 0.45 }, { id: 'c', d: 560, detourMi: 0, price: 0.45 }];
assert.equal(T.reachable(Object.assign({}, o, { cands: far, startGal: 60 })), false);
assert.equal(T.reachable(Object.assign({}, o, { cands: far, fillCap: null, startGal: 60 })), true, 'a full 75 kWh could (so the cap matters)');
// top-ups fill to the cap
const tops = T.topUps(Object.assign({}, o, { cands: p.cands || cands }), p, 600);
tops.forEach((t) => assert.ok(t.arriveGal + t.buyGal <= cap * 0.8 + 1e-9));
console.log('ev tests passed (' + p.stops.length + ' charging stops, ' + (Date.now() - t0) + ' ms): ' + p.stops.map((s) => s.c.station.name + ' +' + s.buyGal.toFixed(1)).join(', '));
