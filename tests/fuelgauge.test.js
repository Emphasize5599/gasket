// FuelGauge.math: how much is in the tank, from a gauge reading, a percentage or the miles on the dash.
const assert = require('assert');
const M = require('../assets/web/fuelgauge.js').math;
const near = (a, b, e, m) => assert.ok(Math.abs(a - b) <= (e || 1e-9), (m || '') + ' ' + a + ' vs ' + b);

// which way a new trip starts: gas -> the gauge, EV -> percent, an old trip with miles left -> miles
assert.equal(M.norm(null, 'gas', '').mode, 'gauge');
assert.equal(M.norm(null, 'ev', '').mode, 'pct');
assert.deepEqual(M.norm(undefined, 'gas', '80'), { mode: 'miles', miles: '80' }, 'trips saved before the gauge keep their miles');
assert.equal(M.norm({ mode: 'gauge', eighths: 4 }, 'ev', '').mode, 'pct', 'an EV has no gauge');
assert.equal(M.norm({ mode: 'pct', pct: '40' }, 'gas', '300').pct, '40', 'a set choice is kept');

// gauge: eighths of a tank
const g = { mode: 'gauge', eighths: 3 };
near(M.frac(g, 12, 40), 0.375); near(M.amount(g, 12, 40), 4.5); near(M.miles(g, 12, 40), 180);
assert.equal(M.frac({ mode: 'gauge' }, 12, 40), null, 'not set yet');
assert.equal(M.miles({ mode: 'gauge', eighths: '' }, 12, 40), null);
near(M.frac({ mode: 'gauge', eighths: 9 }, 12, 40), 1, 0, 'clamped to F');
// percent
near(M.amount({ mode: 'pct', pct: '50' }, 60, 3.5), 30); near(M.miles({ mode: 'pct', pct: '50' }, 60, 3.5), 105);
assert.equal(M.frac({ mode: 'pct', pct: '' }, 12, 40), null);
near(M.frac({ mode: 'pct', pct: '130' }, 12, 40), 1, 0, 'clamped to 100%');
// miles from the dash
const m = { mode: 'miles', miles: '120' };
near(M.miles(m, 12, 40), 120); near(M.amount(m, 12, 40), 3); near(M.frac(m, 12, 40), 0.25);
assert.equal(M.miles({ mode: 'miles', miles: '' }, 12, 40), null);
near(M.miles({ mode: 'miles', miles: '0' }, 12, 40), 0, 0, 'empty is a real answer');

// the needle: angles on the arc (E at 200°, F at 340°, SVG angles) snap to eighths; below the dial goes to the near end
assert.equal(M.eighthsAt(200), 0); assert.equal(M.eighthsAt(270), 4); assert.equal(M.eighthsAt(340), 8);
assert.equal(M.eighthsAt(270 + 17.5 * 1.4), 5, 'just past halfway');
assert.equal(M.eighthsAt(-90), 4, 'negative angles from atan2');
assert.equal(M.eighthsAt(170), 0); assert.equal(M.eighthsAt(10), 8); assert.equal(M.eighthsAt(95), 0); assert.equal(M.eighthsAt(85), 8);
assert.equal(M.label(0), 'Empty'); assert.equal(M.label(8), 'Full'); assert.equal(M.label(3), '⅜ tank');
console.log('fuel gauge tests passed');
