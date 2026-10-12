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
// trailers: a saved list, the hooked-up ones count in tow mode (two at once: chained)
const tr = four(8, 8, 8, 8); tr.towMode = true;
tr.trailers = [{ id: 'b', name: 'Boat', hooked: true, axles: 2, per: 4 }, { id: 'u', name: 'Utility', hooked: false, axles: 1, per: 2 }];
tr.corners['b:a2ro'] = { depth: 2 };
assert.equal(T.positions(tr).length, 12); assert.equal(T.positions(tr)[11].name, 'Boat, axle 2, passenger side outer');
assert.equal(T.estimate(tr).depth, 2, 'a hooked-up trailer\'s tire counts');
tr.trailers[1].hooked = true; assert.equal(T.positions(tr).length, 14, 'two hooked up: both count'); assert.equal(T.positions(tr)[13].name, 'Utility, passenger side');
tr.towMode = false; assert.equal(T.positions(tr).length, 4); assert.equal(T.estimate(tr).depth, 8, 'tow mode off: trailer tires don\'t count');
// older saves: free-listed dual and trailer tires, and 0.0.75's one trailer, become the dually's inner tires and the first trailer
const old = four(8, 8, 8, 8, [{ id: 'w1', kind: 'dual', name: 'Dual inner rear', depth: 5 }, { id: 'w2', kind: 'trailer', name: 'Trailer tire', depth: 4 }]);
assert.deepEqual(T.positions(old).map(p => p.k), ['lf', 'rf', 'lr', 'lri', 'rri', 'rr', 'tr1:a1l', 'tr1:a1r']);
assert.equal(old.corners.lri.depth, 5); assert.equal(old.corners['tr1:a1l'].depth, 4); assert.equal(T.estimate(old).depth, 4); assert.ok(old.towMode && old.trailers[0].hooked);
const v75 = four(8, 8, 8, 8); v75.corners.trailer = { on: true, axles: 2, per: 2 }; v75.corners.t2r = { depth: 3 };
assert.equal(T.estimate(v75).depth, 3); assert.equal(v75.trailers.length, 1); assert.ok(!v75.corners.trailer && v75.corners['tr1:a2r']);
// by mileage: each tire needs its miles, a warranty (its own, or its car's / trailer's) and whether it's been rotated
const mi = four(0, 0, 0, 0); mi.corners.mode = 'miles'; mi.warrantyMi = 60000; mi.type = 'Grand Touring All-Season';
assert.equal(T.missing(mi).length, 4, 'nothing filled in: all four missing');
['lf', 'rf', 'lr'].forEach(k => { mi.corners[k] = { miles: 30000, rotated: 'yes' }; });
assert.deepEqual(T.missing(mi).map(p => p.k), ['rr']); assert.deepEqual(T.needs(mi, T.positions(mi)[3]), ['miles', 'rotated']);
mi.corners.rr = { miles: 30000, rotated: 'no', warrantyMi: 80000 };
assert.equal(T.missing(mi).length, 0);
assert.equal(T.depthAt(mi, T.positions(mi)[0]), 6, 'halfway through the car\'s 60k warranty: 6/32');
assert.equal(T.estimate(mi).measured, false, 'estimated, not measured');
delete mi.warrantyMi; assert.deepEqual(T.missing(mi).map(p => p.k), ['lf', 'rf', 'lr'], 'no warranty anywhere: still needed (rr has its own)');
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

// ---- matching a car to Tire Rack's names (real lists, as Tire Rack's vehicle picker gave them on Oct 11 2026) ----
{
  const V = (a) => a.map((x) => ({ model: x[0], clar: x[1] }));
  const pick = (car, vs) => { const p = T.pickVersion(car, V(vs)); return { sure: p.sure, best: p.best && p.best.model + '/' + p.best.clar }; };
  const PRIUS = [['Prius', 'Four'], ['Prius', 'Four Touring'], ['Prius', 'Three'], ['Prius', 'Three Touring'], ['Prius', 'Two'], ['Prius', 'Two Eco'], ['Prius c', 'Four'], ['Prius c', 'One'], ['Prius c', 'Three'], ['Prius c', 'Two'], ['Prius v', 'Five'], ['Prius v', 'Two']];
  const SIENNA = [['Sienna AWD', 'LE V6'], ['Sienna AWD', 'Limited'], ['Sienna AWD', 'XLE'], ['Sienna FWD', 'LE 4cyl'], ['Sienna FWD', 'LE V6'], ['Sienna FWD', 'Limited'], ['Sienna FWD', 'SE'], ['Sienna FWD', 'XLE']];
  const CHARGER = [['Charger Daytona R/T', ''], ['Charger R/T', 'AWD'], ['Charger R/T', 'RWD'], ['Charger SE', ''], ['Charger SXT', 'AWD'], ['Charger SXT', 'RWD'], ['Charger SXT DUB Edition', ''], ['Charger Super Bee', '']];
  const MUSTANG = [['Mustang Convertible', ''], ['Mustang Coupe', ''], ['Mustang GT Convertible', ''], ['Mustang GT Coupe', '']];
  assert.deepStrictEqual(pick({ model: 'Prius', trim: 'Two', info: { drive: 'fwd', engine: '1.8L Inline 4 Cyl' } }, PRIUS), { sure: true, best: 'Prius/Two' }, 'not the Two Eco, not the Prius c');
  assert.deepStrictEqual(pick({ model: 'Sienna 2WD', trim: 'LE', info: { drive: 'fwd', engine: '3.5L V6 (2GR-FE)' } }, SIENNA), { sure: true, best: 'Sienna FWD/LE V6' }, 'drive and engine pick the right LE');
  assert.strictEqual(pick({ model: 'Sienna 2WD', trim: 'LE', info: {} }, SIENNA).sure, false, 'an LE with no drive or engine known: you pick');
  assert.deepStrictEqual(pick({ model: 'Charger', trim: 'SXT', info: { drive: 'rwd' } }, CHARGER), { sure: true, best: 'Charger SXT/RWD' }, 'the trim can be in Tire Rack\'s model name');
  assert.deepStrictEqual(pick({ model: 'Mustang', trim: '', name: '2005 Ford Mustang · Auto 5-spd, 6 cyl, 4.0 L', info: {} }, MUSTANG), { sure: false, best: 'Mustang Coupe/' }, 'no trim: never guessed, plainest first');
  assert.deepStrictEqual(pick({ model: 'Mustang', trim: 'GT', info: { body: 'Convertible' } }, MUSTANG), { sure: true, best: 'Mustang GT Convertible/' });
  assert.deepStrictEqual(pick({ model: 'Fit', trim: 'Sport', info: {} }, [['Fit', 'LX'], ['Fit', 'Sport']]), { sure: true, best: 'Fit/Sport' });
  assert.deepStrictEqual(pick({ model: 'Model Y', trim: '', info: {} }, [['Model Y', '255/40-20']]), { sure: true, best: 'Model Y/255/40-20' }, 'only one version: no question');
  // which models to ask about (each is a request, so only the likely ones)
  const ask = (car, models) => T.modelsToAsk(T.rankModels(car, models));
  assert.deepStrictEqual(ask({ model: 'Sienna 2WD', trim: 'LE', info: { drive: 'fwd' } }, ['Sequoia', 'Sienna AWD', 'Sienna FWD']), ['Sienna FWD'], 'never the AWD for a FWD car');
  assert.deepStrictEqual(ask({ model: 'Charger', trim: 'SXT', info: { drive: 'rwd' } }, ['Charger Daytona R/T', 'Charger R/T', 'Charger SE', 'Charger SXT', 'Charger SXT DUB Edition', 'Charger Super Bee']), ['Charger SXT', 'Charger SXT DUB Edition']);
  assert.deepStrictEqual(ask({ model: 'Xterra 4WD', trim: 'Off-Road', info: { drive: '4wd' } }, ['Xterra Off-Road 2wd', 'Xterra Off-Road 4wd', 'Xterra S 2wd', 'Xterra S 4wd']), ['Xterra Off-Road 4wd']);
  assert.deepStrictEqual(T.rankModels({ model: 'Corolla Hybrid', trim: 'LE' }, ['Corolla', 'Corolla Cross Hybrid', 'Corolla Hybrid']).map((r) => r.model), ['Corolla Hybrid', 'Corolla Cross Hybrid'], 'every word of the model, the plainest first');
  assert.deepStrictEqual(T.rankModels({ model: 'Escalade' }, ['Corolla']), [], 'not listed: nothing');
}
console.log('tire version matching ok');

// ---- the spare from Brave's answer: clauses that say what the car has, read by the model (keywords when it can't load) ----
{
  const kitAnswer = 'The 2019 Honda Insight EX does not come with a spare tire from the factory; instead, it is equipped with a tire repair kit (often referred to as a "fix-a-flat" kit). Standard Equipment: The vehicle includes a sealant canister and an air compressor designed to temporarily repair minor punctur';
  const compactAnswer = 'Yes, the 2014 Ford Edge SE comes with a spare tire. It is a compact, temporary spare tire (often called a "donut"), not a full-size spare or a tire repair kit. This compact spare is located under ';
  const kia = 'No, the 2021 Kia Niro does not have a spare tire. It comes with a Tire Mobility Kit (sealant and compressor) instead of a spare.';
  const tesla = 'The 2022 Tesla Model 3 does not come with a spare tire or a tire repair kit. Tesla recommends calling roadside assistance for a flat.';
  let sc = T.spareClauses(kitAnswer);
  assert.ok(sc.negSpare && !sc.pos.some((c) => /does not come/.test(c)) && sc.pos.some((c) => /repair kit/.test(c)), JSON.stringify(sc));
  assert.equal(T.pickSpare(null, sc).kind, 'kit', 'no model: keywords in what it has (it used to read this as compact)');
  sc = T.spareClauses(compactAnswer);
  assert.ok(!sc.pos.some((c) => /full-size/.test(c)), 'what it is not is set aside');
  assert.equal(T.pickSpare(null, sc).kind, 'compact');
  sc = T.spareClauses(kia); assert.ok(sc.negSpare && !sc.pos.join(' ').includes('instead'), JSON.stringify(sc));
  assert.equal(T.pickSpare(null, sc).kind, 'kit');
  assert.equal(T.pickSpare(null, T.spareClauses(tesla)).kind, 'none', 'all it says is what it doesn\'t have');
  // with the model's scores (like the real ones for these answers)
  const s = (o) => Object.assign({ full: 0.4, compact: 0.4, kit: 0.4, runflat: 0.4, generic: 0.5 }, o);
  assert.deepEqual(T.pickSpare([s({ compact: 0.796, generic: 0.624 }), s({ full: 0.52 })], T.spareClauses(compactAnswer)), { kind: 'compact', by: 'ai', score: 0.796 });
  assert.equal(T.pickSpare([s({ compact: 0.59, generic: 0.595 })], { pos: ['includes a temporary compact spare tire, a jack and lug wrench'], negSpare: false }).kind, 'compact', 'close to "it has a spare" is still fine');
  assert.deepEqual(T.pickSpare([s({ full: 0.542, generic: 0.563 })], { pos: ['Yes, it comes with a spare tire located in the trunk'], negSpare: false }), { kind: null, by: null, score: null }, 'just "it has a spare": you pick');
  assert.equal(T.pickSpare([s({ kit: 0.644, generic: 0.507 })], T.spareClauses(kia)).by, 'ai');
  console.log('spare tire reading ok');
}
