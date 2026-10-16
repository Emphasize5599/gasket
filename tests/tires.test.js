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
r = T.rotation({ lf: 9, rf: 6, lr: 8, rr: 8 }, 'awd'); assert.ok(r.notes.some(n => /alignment/.test(n)) && T.treadDiff({ lf: 9, rf: 6, lr: 8, rr: 8 }, 'awd').some(x => /within about 2\/32/.test(x.text)), 'the AWD limit moved to treadDiff');
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
  // "doesn't come with a spare" outweighs a mention of one (room for it, buy one separately); those become the tip
  const corolla = 'The 2020 Toyota Corolla Hybrid LE does not come with a spare tire from the factory. Instead, it is equipped with a tire repair kit (often referred to as "fix-a-flat") stored in the trunk. While the vehicle has a designated space and threaded receptor for a spare tire in the trunk, Toyota omitted the tire itself to reduce weight and cost. Owners who desire a spare can purchase one separately, with the correct temporary spare size being T125/70D17. Compatible donor parts can often be sourced from other Toyota models, such as the 12th-generation Corolla or the 2012–2023 Prius.';
  sc = T.spareClauses(corolla);
  assert.ok(sc.noSpare && sc.opt.length === 3 && !sc.pos.some((c) => /designated|purchase|donor/.test(c)), JSON.stringify(sc));
  assert.equal(T.pickSpare(null, sc).kind, 'kit');
  // the model scored "room for a spare" as full-size (0.672): that clause is set aside, and full / compact can't win anyway
  assert.equal(T.pickSpare(sc.pos.map(() => s({ kit: 0.7, generic: 0.4 })), sc).kind, 'kit');
  assert.equal(T.pickSpare([s({ full: 0.672, generic: 0.6 })], { pos: ['it has a designated space for a spare tire'], opt: [], noSpare: true, negSpare: true }).kind, 'none', 'no spare: a full-size score is not the answer');
  assert.equal(T.pickSpare([s({ full: 0.66, optional: 0.71, generic: 0.6 })], { pos: ['a spare can be bought'], opt: [], noSpare: false, negSpare: false }).kind, null, 'the model reads it as optional: not what it has');
  // the tip: short, in the app's own words, from the facts the answer states (a built-in spot, not "space in the trunk")
  assert.equal(T.spareTip(sc), 'The trunk has a built-in spot for a spare, just no tire in it. You can add a temporary spare (T125/70D17), or a matching one from another model.');
  // the model's reading decides which facts (here it reads the accessory clause as "buy", not as a built-in spot)
  assert.equal(T.spareTip({ opt: ['A spare tire is available as an optional accessory'] }, [{ well: 0.726, buy: 0.933, donor: 0.583 }]), '', 'an optional spare alone gives no useful storage advice');
  const mustang = 'The 2005 Ford Mustang does not come standard with a spare tire; instead, it is typically equipped with a tire repair and inflator kit. A spare tire is available as an optional accessory, but it is excluded if the vehicle is equipped with the Performance Package.';
  sc = T.spareClauses(mustang); assert.equal(T.pickSpare(null, sc).kind, 'kit', 'it used to read the optional spare as compact'); assert.equal(T.spareTip(sc), '');
  assert.equal(T.pickSpare(null, T.spareClauses('The 2020 BMW 330i comes with run-flat tires and no spare tire. A spare tire kit is available as a dealer accessory.')).kind, 'runflat');
  sc = T.spareClauses(compactAnswer); assert.equal(sc.noSpare, false, '"not a full-size spare" is not "no spare"'); assert.equal(T.spareTip(sc), '');
  // the question asks Brave's AI for a fixed first phrase and a short sentence about adding one: read those first
  assert.equal(T.spareLead('Compact spare. It comes with a temporary donut spare under the floor.'), 'compact');
  assert.equal(T.spareLead('**Repair kit.** The car has a tire repair kit.'), 'kit');
  assert.equal(T.spareLead('The 2012 Venza comes with a compact spare.'), null, 'not in the format: read the old way');
  assert.equal(T.leadTip('No spare. It comes with a tire repair kit instead. A temporary spare (T125/70D17) can be added, since the trunk has a dedicated spare tire well.'), 'A temporary spare (T125/70D17) can be added, since the trunk has a dedicated spare tire well.');
  assert.equal(T.leadTip('Compact spare. It sits under the floor.'), '');
  assert.equal(T.leadTip('No spare. A dealer sells an optional spare tire separately.'), '', 'no tip without a dedicated location');
  // a real answer to the question (Brave Search, 2020 Corolla Hybrid LE): headings on their own lines are skipped
  const live = 'Repair kit. The 2020 Toyota Corolla Hybrid LE does not come with a spare tire from the factory; it is equipped with a tire repair kit (often referred to as "fix-a-flat") and an air compressor. \n\nAdding a Spare Tire\n\nOwners can add a spare tire to the 2020 Hybrid LE, as the trunk well has sufficient space.\n\nFull-size option: A full-size spare (matching the stock tire size, typically 195/65R15 for the LE trim) fits in the compartment, though it reduces cargo space.';
  assert.equal(T.spareLead(live), 'kit'); assert.equal(T.leadTip(live), 'Owners can add a spare tire to the 2020 Hybrid LE, as the trunk well has sufficient space.');
  console.log('spare tire reading ok');
}

{
  const tr={id:'example',hooked:true,axles:3,per:2}, t={towMode:true,trailers:[tr]};
  const keys=T.positions(t).map(p=>p.k);
  assert.equal(T.axlePositions(tr).length,3);
  for(let i=0;i<3;i++)for(const v of [-100,100,NaN]){const p=T.moveAxle(tr,i,v),g=T.trailerGeometry(tr);assert.ok(p[0]>=0&&p[2]<=1);assert.ok(g.centers[1]-g.centers[0]>=g.gaps[1]-1e-8&&g.centers[2]-g.centers[1]>=g.gaps[2]-1e-8);assert.deepEqual(T.positions(t).map(p=>p.k),keys);}
  tr.axlePositions=[1,-1,1];assert.ok(T.axlePositions(tr)[1]>T.axlePositions(tr)[0]);
  tr.axles=1;assert.equal(T.axlePositions(tr).length,1);tr.axles=3;assert.equal(T.axlePositions(tr).length,3);
  console.log('Trailer axle bounds, spacing and stable tire identities passed');
}

{
  const valid=(tr,C={})=>{const g=T.trailerGeometry(tr,C);assert.ok(g.geometry.lengthFt>=g.minLength-1e-8);g.axles.forEach((a,i)=>{assert.ok(g.centers[i]-a.diameter/2>=g.padding-1e-8);assert.ok(g.centers[i]+a.diameter/2<=g.geometry.lengthFt-g.padding+1e-8);if(i)assert.ok(g.centers[i]-g.centers[i-1]>=g.gaps[i]-1e-8);});return g;};
  const tr={id:'layout',hooked:true,axles:3,per:4,size:'205/75R15',split:true,geometry:{lengthFt:12,leftFt:3,rightFt:3,symmetric:true},axlePositions:[0,0,0]};
  T.normalizeTrailer(tr,{});T.moveAxle(tr,1,0);T.moveAxle(tr,2,0);const old=valid(tr),keys=T.positions({towMode:true,trailers:[tr]}).map(p=>p.k);
  tr.size='395/95R24';T.normalizeTrailer(tr,{});const grown=valid(tr);assert.ok(grown.gaps[1]>old.gaps[1]);assert.ok(grown.geometry.lengthFt>12);assert.match(tr.geometryNote,/increased/);
  assert.deepEqual(T.positions({towMode:true,trailers:[tr]}).map(p=>p.k),keys);
  const C={'layout:a2li':{size:'445/95R26'}};T.normalizeTrailer(tr,C);const single=valid(tr,C);assert.ok(single.axles[1].diameter>single.axles[0].diameter);
  for(let n=1;n<=3;n++)for(const length of [.25,3,10,30,200])for(const size of ['','155/50R12','205/75R15','395/95R24']){
    const q={id:'bounds',axles:n,per:4,size,geometry:{lengthFt:length,leftFt:1,rightFt:7,symmetric:false},axlePositions:[1,-1,NaN]};T.normalizeTrailer(q);valid(q);
    for(let i=0;i<n;i++)for(const v of [-99,0,.5,1,99]){T.moveAxle(q,i,v);valid(q);}
  }
  const asym={id:'width',axles:1,geometry:{lengthFt:12,leftFt:2,rightFt:4,symmetric:false}};
  assert.equal(T.trailerGeometry(asym).geometry.rightFt,4);asym.geometry.symmetric=true;assert.equal(T.trailerGeometry(asym).geometry.rightFt,2);
  assert.equal(T.tireFootprint('').known,false);assert.equal(T.tireFootprint('000/00R00').known,false);assert.ok(T.tireFootprint('315/85R22').diameter>T.tireFootprint('205/75R15').diameter);
  console.log('Wheel-scaled clearance, crowded growth, individual sizes, minimum body length and asymmetric geometry passed');
}

{
  const first={id:'first',axles:2,per:4,split:true,hooked:true},other={id:'other',axles:1,per:2,split:true,hooked:true};
  const source={size:'205/75R15',brand:'Example',model:'Touring',type:'Touring',warrantyMi:40000,miles:1000,rotated:'yes'};
  const t={towMode:true,trailers:[first,other],corners:{'first:a1lo':source,'first:a1li':{miles:2000},'first:a2ri':{size:'225/75R15',brand:'Existing'},'other:a1l':{size:'195/65R15',model:'Keep'},lf:{size:'195/65R15'}}};
  const outside=JSON.stringify([other,t.corners['other:a1l'],t.corners.lf]);
  assert.ok(T.fillTrailerSizes(t,first,'first:a1lo','205/75R15'));
  assert.deepEqual(t.corners['first:a1li'],{miles:2000,size:'205/75R15'});
  assert.deepEqual(t.corners['first:a1ro'],{size:'205/75R15'});
  assert.equal(t.corners['first:a2ri'].size,'225/75R15');assert.equal(first.size,'205/75R15');
  assert.equal(JSON.stringify([other,t.corners['other:a1l'],t.corners.lf]),outside);assert.equal(t.corners['other:a1r'],undefined);
  assert.equal(T.fillTrailerSizes(t,first,'first:a1lo',''),false);
  first.hooked=false;delete t.corners['first:a2lo'];T.fillTrailerSizes(t,first,'first:a1lo','205/75R15');assert.deepEqual(t.corners['first:a2lo'],{size:'205/75R15'});
  console.log('Size-only autofill remains scoped to one trailer and preserves existing answers');
}
{
  // tread differences the drivetrain can't take; the fix points at the axle that just rolls along
  const D = (lf, rf, lr, rr) => ({ lf, rf, lr, rr });
  assert.deepEqual(T.treadDiff(D(8, 8, 7, 7), 'awd'), [], 'AWD within 2/32: fine');
  let w = T.treadDiff(D(11, 8, 6, 6), 'awd'); assert.equal(w.length, 1); assert.equal(w[0].level, 'warn'); assert.match(w[0].text, /5\/32 in/); assert.match(w[0].fix, /replace all four|shaved/);
  assert.equal(T.treadDiff(D(9, 8, 6, 6), 'awd')[0].level, 'info', '3/32 over the 2/32 limit: a note; well past it: a warning');
  assert.deepEqual(T.treadDiff(D(9, 8, 6, 6), 'aawd'), [], 'on-demand AWD takes about 3/32');
  w = T.treadDiff(D(9, 4, 7, 7), 'fwd'); assert.equal(w.length, 1); assert.match(w[0].text, /front tires, the ones that drive/); assert.match(w[0].fix, /on the rear, which just rolls along/);
  assert.deepEqual(T.treadDiff(D(8, 8, 9, 3), 'fwd'), [], 'FWD: the rear just rolls along');
  w = T.treadDiff(D(8, 8, 9, 3), 'rwd'); assert.match(w[0].fix, /on the front, which just rolls along/);
  w = T.treadDiff(D(10, 10, 4, 4), '4wd'); assert.match(w[0].text, /transfer case/); assert.match(w[0].fix, /front axle just rolls along/);
  assert.match(T.treadDiff(D(10, 10, 4, 4), '')[0].text, /Add your drive/);
  assert.deepEqual(T.treadDiff(null, 'awd'), []);
  // a fuel rating from every tire: mixed types count each for its share
  const touring = { type: 'Standard Touring All-Season', brand: 'X', model: 'Y' }, hwy = { type: 'Highway All-Season', brand: 'X', model: 'Z' };
  const a = T.fuelScore(touring).score, b = T.fuelScore(hwy).score;
  let f = T.fuelOf([touring, touring, hwy, hwy]); assert.equal(f.score, Math.round((a + b) / 2)); assert.equal(f.mixed, true); assert.deepEqual(f.kinds, { 'Standard Touring All-Season': 2, 'Highway All-Season': 2 });
  f = T.fuelOf([touring, touring, touring, touring]); assert.equal(f.score, a); assert.equal(f.mixed, false);
  f = T.fuelOf([touring, {}, {}, {}]); assert.equal(f.n, 1); assert.equal(f.of, 4);
  assert.equal(T.fuelOf([{}, {}]), null);
  console.log('Tread differences by drivetrain and a mixed-tire fuel rating');
}
{
  // "No spare" first, then "a spare was optional on this trim": that sentence is the tip
  const t = 'No spare. The 2008 Dodge Charger SXT came with a tire inflator kit as standard. A compact spare tire was optional on the SXT trim [1]. Check under the trunk floor.';
  assert.equal(T.spareLead(t), 'none');
  assert.equal(T.optTip(t), 'A compact spare tire was optional on the SXT trim.');
  assert.equal(T.optTip('No spare. Tesla does not include one.'), '');
  console.log('An optional spare in Brave\'s answer becomes the tip');
}
{
  // "No spare", a repair kit, and a spare that can be added: the kit is what it has
  const t = 'No spare. The 2020 Toyota Corolla Hybrid LE comes with a tire repair kit instead of a spare tire. The trunk has a spare tire well, so you can add a compact spare (T125/70D17).';
  assert.equal(T.spareLead(t), 'none'); assert.equal(T.parseSpare(t), 'compact', 'the general reader sees the addable compact first');
  assert.equal(T.instead(t), 'kit');
  assert.equal(T.instead('No spare. It has no repair kit either.'), null);
  assert.equal(T.instead('No spare. It comes with run-flat tires.'), 'runflat');
  console.log('"No spare" with a repair kit reads as the kit');
}

// 0.0.168: an opener ("Compact spare.") the answer's own body contradicts: the body wins (2025 Blazer LT, Brave)
{
  const T = require('../assets/web/tires.js');
  const blazer = 'Compact spare. Located inside the rear cargo area. The 2025 Chevrolet Blazer LT does not come with a spare tire as standard equipment; instead, it is equipped with a tire inflator kit (sealant and air compressor). A 16-inch compact spare tire with a mechanical jack and tools is available as a factory-installed standalone option for $195. The RS trim features self-sealing tires rather than a spare or repair kit.';
  assert.equal(T.leadOverruled(blazer, 'compact'), 'kit', 'not standard + an inflator kit instead = kit');
  assert.equal(T.leadOverruled('Compact spare. Located under the cargo floor. The 2021 Toyota RAV4 comes with a compact temporary spare and a jack.', 'compact'), null, 'a real compact spare stands');
  assert.equal(T.leadOverruled('Compact spare. Inside the vehicle. The car does not come with a full-size spare; it has a compact one.', 'compact'), null, '"not a full-size spare" is not "no spare"');
  assert.equal(T.leadOverruled('Full-size spare. Under the vehicle. Note: the base model does not come with a spare tire as standard.', 'full'), 'none', 'not standard, nothing named instead = none');
  assert.equal(T.leadOverruled(blazer, 'kit'), null, 'only spare openers are checked');
  console.log('spare opener overruled by the answer body');
}

// 0.0.169: an answer about the model's other versions too (Brave, 2025 Blazer 2LT): "No spare." was the EV's opener
{
  const T = require('../assets/web/tires.js');
  const both = "No spare. The 2025 Chevrolet Blazer 2LT (gasoline model) comes with a compact spare tire as standard equipment, located under the vehicle. This is consistent with GM's policy for 2027 models where the standard Blazer (non-EV) retains a compact spare, unlike the Blazer EV which relies on a repair kit.\n\nFor the 2025 Chevrolet Blazer EV 2LT, the answer is No spare.  It comes with a tire inflator kit (sealant and compressor) stored inside the cargo area under the floor panel. A spare tire is not standard and is not currently available as a factory-installed option for the EV. Owners have noted that adding a spare is difficult due to the floor-mounted battery pack; aftermarket solutions like a hitch-mounted spare or securing a full-size wheel in the cargo area are the only practical methods, though specific compact spare kits for the Blazer EV were not widely available as of late 2024.\n\nKey Distinction:\n\n2025 Gas Blazer 2LT: Standard compact spare under the vehicle.\n2025 Blazer EV 2LT: No spare; standard inflator kit inside. Optional aftermarket full-size or compact spares can be added, but they must be secured manually (e.g., in cargo or on a hitch) as they do not fit under the floor.";
  for (const text of [both, both.replace(/\s+/g, ' ')]) {   // saved answers lose their line breaks
    const gas = T.forThisCar(text, 'gas'), ev = T.forThisCar(text, 'ev');
    assert.equal(gas.mixed, true); assert.equal(gas.kind, 'compact', 'the gas Blazer: compact');
    assert.ok(!/inflator|battery/.test(gas.text), 'the EV sentences are dropped');
    assert.equal(T.spareLocation(gas.text), 'under');
    assert.equal(ev.kind, 'kit', 'the Blazer EV: inflator kit');
  }
  // one version only, or an "unlike the hybrid" aside: read as before
  assert.equal(T.forThisCar('Compact spare. The 2021 Toyota RAV4 has a compact spare, unlike the RAV4 Hybrid which has a kit.', 'gas').mixed, false);
  assert.equal(T.forThisCar('Repair kit. The 2020 Toyota Corolla Hybrid LE does not come with a spare tire; it has a repair kit.', 'hybrid').mixed, false);
  assert.equal(T.variantOf('the standard Blazer (non-EV) retains a compact spare'), 'gas');
  assert.equal(T.sentenceKind('It has a compact spare, not a full-size spare.'), 'compact');
  console.log('a mixed gas / EV answer is read for this car only');
}
