// Best-cruising-speed model: ORNL band drops, anchoring, calibration, marginal cost per hour saved.
const assert = require('assert');
const S = require('../assets/web/speed.js');
const near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, (m || '') + ' ' + a + ' vs ' + b);

// car: anchored at EPA highway at 55; each 10-mph band loses ORNL's average, compounded evenly per mph
let c = S.curve('car', 30, 1, 40, 90);
near(c[55], 30, 1e-9, 'anchor');
near(c[60] / c[50], 1 - 0.124, 1e-9, '50→60');
near(c[70] / c[60], 1 - 0.140, 1e-9, '60→70');
near(c[80] / c[70], 1 - 0.154, 1e-9, '70→80');
near(c[61] / c[60], Math.pow(0.86, 0.1), 1e-9, 'even per mph');
near(c[84] / c[80], Math.pow(1 - 0.154, 0.4), 1e-9, 'above 80 keeps the 70–80 rate');
// hybrid: steady 55 is well above the EPA highway label
c = S.curve('hybrid', 50, 1, 40, 90);
near(c[55], 65, 1e-9); near(c[65], 57.2, 0.1, 'close to Consumer Reports’ 59 mpg at 65 (2020 Corolla Hybrid)');
// type from an EPA record
assert.equal(S.typeFromEpa({ atvType: 'Hybrid', VClass: 'Midsize Cars' }), 'hybrid');
assert.equal(S.typeFromEpa({ VClass: 'Minivan - 2WD', cylinders: 6 }), 'suv');
assert.equal(S.typeFromEpa({ VClass: 'Standard Pickup Trucks 4WD', cylinders: 8, eng_dscr: 'CYL DEACT' }), 'v8deact');
assert.equal(S.typeFromEpa({ VClass: 'Standard Pickup Trucks 2WD', cylinders: 6 }), 'truck');
// calibration: entries with a speed scale the curve; entries without one are ignored
let cal = S.calibrate('car', 30, [{ mpg: 26.0 * 1.1, speed: 65 }, { mpg: 40 }, { mpg: 20, speed: 20 }]);
assert.equal(cal.used, 1); near(cal.scale, 1.1, 0.002);
cal = S.calibrate('car', 30, [{ mpg: 26.0 * 1.2, speed: 65 }, { mpg: 26.0, speed: 65 }]);
near(cal.scale, Math.sqrt(1.2), 0.003, 'geometric mean');
// marginal cost per hour saved
let r = S.recommend({ type: 'car', epaHwy: 30, scale: 1, min: 55, max: 84, price: 3, timeValue: 0 });
const row = r.rows[70 - 55];
const expect = (1 / r.curve[70] - 1 / r.curve[69]) * 3 / (1 / 69 - 1 / 70);
near(row.costPerHour, expect, 1e-9, 'cost/hr formula');
assert.ok(r.rows.slice(2).every((x, i) => x.costPerHour >= r.rows[i + 1].costPerHour - 1e-9), 'rises with speed');
assert.equal(r.mode, 'balanced'); assert.equal(r.speed, 65);
// with a time value: highest speed where every step up costs <= that, kept in min..max
r = S.recommend({ type: 'suv', epaHwy: 24, scale: 1, min: 55, max: 84, price: 2.8, timeValue: 10 });
assert.equal(r.mode, 'time');
assert.ok(r.rows[r.speed - 55].costPerHour <= 10 && r.rows[r.speed - 55 + 1].costPerHour > 10, 'stops at the crossing: ' + r.speed);
r = S.recommend({ type: 'car', epaHwy: 30, scale: 1, min: 55, max: 70, price: 3, timeValue: 1000 });
assert.equal(r.speed, 70, 'never past max');
r = S.recommend({ type: 'car', epaHwy: 30, scale: 1, min: 60, max: 84, price: 3, timeValue: 0.01 });
assert.equal(r.speed, 60, 'never below min');
// 5-mph summary
const up = r.between(65, 70);
near(up.minPer100, (1 / 65 - 1 / 70) * 6000, 1e-9); near(up.perHour, up.per100 / (up.minPer100 / 60), 1e-9);
const show = (t, h) => { const x = S.recommend({ type: t, epaHwy: h, scale: 1, min: 55, max: 84, price: 2.8, timeValue: 0 }); return t + ' ' + h + ' → ' + x.speed + ' mph (+5: $' + x.up.perHour.toFixed(2) + '/hr saved)'; };
console.log('speed tests passed —', show('hybrid', 50), '|', show('suv', 24), '|', show('car', 30), '|', show('v8deact', 20));
