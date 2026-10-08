// Tire math: tread left from miles and rotation (or a measurement), what it means, names and sizes.
const assert = require('assert');
const T = require('../assets/web/tires.js');
// new depth by type
assert.equal(T.newDepth('Grand Touring All-Season'), 10); assert.equal(T.newDepth('Studless Ice & Snow'), 12);
assert.equal(T.newDepth('Ultra High Performance Summer'), 9); assert.equal(T.newDepth('All-Terrain'), 13); assert.equal(T.newDepth('Mud-Terrain'), 15);
// life: warranty, else treadwear x 100 (25k..90k), else 50k
assert.equal(T.lifeMiles({ warrantyMi: 60000, utqg: { tw: 700 } }), 60000);
assert.equal(T.lifeMiles({ utqg: { tw: 700 } }), 70000); assert.equal(T.lifeMiles({ utqg: { tw: 200 } }), 25000); assert.equal(T.lifeMiles({ utqg: { tw: 1000 } }), 90000);
assert.equal(T.lifeMiles({}), 50000);
// estimate: 10/32 new, worn to 2/32 at the end of life
const t = (miles, rotated, extra) => Object.assign({ type: 'Grand Touring All-Season', warrantyMi: 60000, tread: { mode: 'miles', miles, rotated } }, extra || {});
assert.equal(T.estimate(t(0, 'yes')).depth, 10);
assert.equal(T.estimate(t(30000, 'yes')).depth, 6);                 // halfway: 10 - 8 * 0.5
assert.equal(T.estimate(t(60000, 'yes')).depth, 2);                 // end of life: the legal minimum
assert.ok(T.estimate(t(30000, 'no')).depth < T.estimate(t(30000, 'sometimes')).depth && T.estimate(t(30000, 'sometimes')).depth < 6, 'skipped rotations: faster wear');
assert.equal(T.estimate(t(30000, '')).factor, T.ROT.unsure, 'not said: treated as not sure');
assert.equal(T.estimate(t(200000, 'yes')).depth, 0, 'never below zero');
assert.equal(T.estimate(t('', 'yes')), null, 'no miles: no estimate');
assert.deepEqual(T.estimate({ tread: { mode: 'measure', depth: 5 } }), { depth: 5, measured: true });
assert.equal(T.estimate({ tread: { mode: 'measure', depth: '' } }), null);
// what it means
assert.equal(T.status(8), 'good'); assert.equal(T.status(6), 'good'); assert.equal(T.status(5), 'ok'); assert.equal(T.status(4), 'ok');
assert.equal(T.status(3), 'low'); assert.equal(T.status(2), 'worn'); assert.equal(T.status(0), 'worn');
// names and sizes
assert.deepEqual(T.split('CONTINENTAL SECURECONTACT AW'), { brand: 'Continental', model: 'SECURECONTACT AW' });
assert.deepEqual(T.split('BF GOODRICH ADVANTAGE CONTROL'), { brand: 'BFGoodrich', model: 'ADVANTAGE CONTROL' });
assert.equal(T.normSize('195/65-15'), '195/65R15'); assert.equal(T.normSize('P195/65 R15 91H'), '195/65R15'); assert.equal(T.normSize('235/40ZR18'), '235/40R18');
assert.equal(T.normSize('195 65 15'), ''); assert.equal(T.normSize(''), '');
console.log('tire math tests passed');
