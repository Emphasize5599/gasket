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
// tires that aren't all the same: the shallowest one counts
const four = (lf, rf, lr, rr, extra) => ({ corners: { split: true, lf: { depth: lf }, rf: { depth: rf }, lr: { depth: lr }, rr: { depth: rr }, extra: extra || [] }, tread: { mode: 'miles', miles: 1000, rotated: 'yes' } });
assert.deepEqual(T.estimate(four(8, 7, 6, 9)), { depth: 6, measured: true, corner: 'lr' });
const duallyT = Object.assign(four(8, 7, 6, 9), {}); duallyT.corners.dually = true; duallyT.corners.lri = { depth: 3 };
assert.deepEqual(T.estimate(duallyT), { depth: 3, measured: true, corner: 'lri' }, 'a dually\'s inner tire counts too');
// every position: a car, a dually, a trailer with 2 axles of 4 tires
assert.deepEqual(T.positions(four(8, 8, 8, 8)).map(p => p.k), ['lf', 'rf', 'lr', 'rr']);
assert.deepEqual(T.positions(duallyT).map(p => p.k), ['lf', 'rf', 'lr', 'lri', 'rri', 'rr']);
const tr = four(8, 8, 8, 8); tr.corners.trailer = { on: true, axles: 2, per: 4 }; tr.corners.t2ro = { depth: 2 };
assert.equal(T.positions(tr).length, 12); assert.equal(T.positions(tr)[11].name, 'Trailer axle 2, passenger side outer');
assert.equal(T.estimate(tr).depth, 2, 'a trailer tire counts');
tr.corners.trailer.on = false; assert.equal(T.estimate(tr).depth, 8, 'trailer off: its tires don\'t count');
// older saves: free-listed dual and trailer tires become the dually's inner tires and a trailer axle
const old = four(8, 8, 8, 8, [{ id: 'w1', kind: 'dual', name: 'Dual inner rear', depth: 5 }, { id: 'w2', kind: 'trailer', name: 'Trailer tire', depth: 4 }]);
assert.deepEqual(T.positions(old).map(p => p.k), ['lf', 'rf', 'lr', 'lri', 'rri', 'rr', 't1l', 't1r']);
assert.equal(old.corners.lri.depth, 5); assert.equal(old.corners.t1l.depth, 4); assert.equal(T.estimate(old).depth, 4);
// duals that don't match
const dr = T.rotation({ lf: 8, rf: 8, lr: 9, rr: 9 }, 'rwd', { lri: 6, rri: 9 });
assert.ok(dr.notes.some(n => /driver-side rear duals differ by 3\/32/.test(n)) && !dr.notes.some(n => /passenger-side rear duals differ/.test(n)));
assert.equal(T.worst({ corners: { split: false, lf: { depth: 3 } } }), null, 'all the same: no corners');
assert.equal(T.estimate({ corners: { split: true }, tread: { mode: 'measure', depth: 5 } }).depth, 5, 'no corners filled in: the single answer');
// where they go: the better pair on the rear
let r = T.rotation({ lf: 8, rf: 8, lr: 6, rr: 6 }, 'fwd');
assert.equal(r.kind, 'move'); assert.deepEqual(r.moves.map(m => m.from + '>' + m.to).sort(), ['lf>lr', 'lr>lf', 'rf>rr', 'rr>rf']);
r = T.rotation({ lf: 6, rf: 6, lr: 8, rr: 8 }, 'fwd'); assert.equal(r.kind, 'even', 'better ones already on the rear'); assert.ok(/already on the rear/.test(r.notes[0]));
r = T.rotation({ lf: 7, rf: 7, lr: 7, rr: 6 }, 'rwd'); assert.equal(r.kind, 'even'); assert.ok(/rear tires go straight forward/.test(r.pattern));
r = T.rotation({ lf: 4, rf: 3, lr: 7, rr: 7 }, 'fwd');
assert.equal(r.kind, 'replace'); assert.deepEqual(r.replace.sort(), ['lf', 'rf']); assert.ok(/instead of rotating them to the back/.test(r.notes[0]), 'FWD worn fronts: replace, not rotate');
r = T.rotation({ lf: 7, rf: 7, lr: 3, rr: 6 }, 'rwd'); assert.deepEqual(r.replace.sort(), ['lr', 'rr'], 'replaced as an axle pair'); assert.ok(/New tires always go on the rear/.test(r.notes[0]));
r = T.rotation({ lf: 9, rf: 6, lr: 8, rr: 8 }, 'awd'); assert.ok(r.notes.some(n => /alignment/.test(n)) && r.notes.some(n => /within about 2\/32/.test(n)));
assert.equal(T.rotation({ lf: 8, rf: null, lr: 6, rr: 6 }, 'fwd'), null, 'all four needed');
// fuel economy out of 10
assert.equal(T.fuelScore({ type: 'Mud-Terrain' }).score, 1);
assert.equal(T.fuelScore({ type: 'Standard Touring All-Season' }).score, 7);
assert.equal(T.fuelScore({ type: 'Standard Touring All-Season', brand: 'Bridgestone', model: 'ECOPIA EP422 PLUS', utqg: { tw: 680 }, size: '195/65R15' }).score, 10, 'eco line, narrow: top');
assert.equal(T.fuelScore({ type: 'All-Terrain', size: '275/65R18' }).score, 3, 'wide: rounds down');
assert.equal(T.fuelScore({ type: 'Grand Touring All-Season' }, -1).score, 5, 'the model can nudge it a point');
assert.equal(T.fuelScore({}), null);
// colors: red (bad) -> yellow -> green (good)
assert.equal(T.hue(0), 'hsl(0, 72%, 48%)'); assert.equal(T.hue(1), 'hsl(120, 72%, 48%)'); assert.equal(T.hue(0.5), 'hsl(60, 72%, 48%)');
assert.equal(T.twGood(700), 1); assert.equal(T.twGood(200), 0); assert.equal(T.depthGood(2), 0); assert.equal(T.depthGood(7), 1); assert.equal(T.tracGood('AA'), 1);
// the spare, from Brave's answer
assert.equal(T.parseSpare('The 2020 Corolla Hybrid LE comes with a compact spare tire (temporary) under the cargo floor.'), 'compact');
assert.equal(T.parseSpare('It does not come with a full-size spare; instead it has a temporary spare.'), 'compact');
assert.equal(T.parseSpare('Most trims include a full-size matching spare mounted under the bed.'), 'full');
assert.equal(T.parseSpare('No spare tire is included; a tire repair kit with sealant and an inflator is provided.'), 'kit');
assert.equal(T.parseSpare('The car rides on run-flat tires, so there is no spare.'), 'runflat');
assert.equal(T.parseSpare('The model does not come with a spare tire.'), 'none');
assert.equal(T.parseSpare('Tire pressure is 35 psi.'), null);
console.log('tire math tests passed');
