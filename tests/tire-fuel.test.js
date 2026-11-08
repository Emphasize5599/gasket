// 0.0.424: tire rolling resistance -> mileage (docs/TIRE_FUEL_ECONOMY.md).
const assert = require('assert');
const T = require('../assets/web/tires.js');
const close = (a, b, e, m) => assert(Math.abs(a - b) <= (e || 1e-3), (m || '') + ' ' + a + ' vs ' + b);
// rolling resistance by type, against a typical all-season (1)
close(T.rrOf({ type: 'Grand Touring All-Season' }), 1); close(T.rrOf({ type: 'Highway All-Season' }), 1);
close(T.rrOf({ type: 'All-Terrain' }), 1.2); close(T.rrOf({ type: 'Mud-Terrain' }), 1.45); close(T.rrOf({ type: 'Rugged Terrain' }), 1.3);
close(T.rrOf({ type: 'Studless Ice & Snow' }), 1.2); close(T.rrOf({ type: 'All-Weather' }), 1.1, 1e-3, 'all-weather is not winter');
close(T.rrOf({ type: 'Ultra High Performance Summer' }), 1.2); close(T.rrOf({ type: 'High Performance All-Season' }), 1.12);
assert.equal(T.rrOf({ type: 'Trailer' }), null, 'trailer tires do not count'); assert.equal(T.rrOf({}), null, 'unknown tire');
close(T.rrOf({ type: 'Touring All-Season', brand: 'Michelin', model: 'Energy Saver A/S' }), 0.85, 1e-3, 'fuel-saving line');
close(T.rrOf({ type: 'Touring All-Season', brand: 'Bridgestone', model: 'Turanza RFT' }), 1.2, 1e-3, 'run-flat');
// worn tread rolls easier: 20% less at 2/32 (TRB SR 286 p. 45)
close(T.rrOf({ type: 'Grand Touring All-Season' }, 2), 0.8); close(T.rrOf({ type: 'Grand Touring All-Season' }, 6), 0.9);
// against the factory tires the rating was measured on (0.9; an EV's 0.85)
close(T.rrRatio([{ type: 'Touring All-Season' }, { type: 'Touring All-Season' }, {}, {}], null, false).ratio, 1 / 0.9);
assert.equal(T.rrRatio([{ type: 'Touring All-Season' }, {}], null, false).n, 1); assert.equal(T.rrRatio([{}, {}], null, false), null);
close(T.rrRatio([{ type: 'All-Terrain' }], null, true).ratio, 1.2 / 0.85);
// fuel use changes by 0.10 (city) / 0.18 (highway) x the rolling resistance change (SR 286 Table 3-1)
const m = T.rrMileage(1.2);
close(m.hwy, 1 / 1.036); close(m.city, 1 / 1.02); assert(m.comb < m.city && m.comb > m.hwy);
// all-terrain vs highway tires, same truck: Tire Rack measured 3.2% less mpg (General Grabber HTS60 vs AT2)
const at = T.rrMileage(1.2 / 1.0).hwy; close(1 - at, 0.032, 0.006, 'highway penalty near the measured all-terrain one');
assert.deepEqual(T.rrMileage(0), { city: 1, hwy: 1, comb: 1 });
console.log('tire-fuel ok');
