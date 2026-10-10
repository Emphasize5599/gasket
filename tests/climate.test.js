// Climate presets: the season by month, starting points (fresh air), what to warn about, the one-line summary.
const assert = require('assert');
const C = require('../assets/web/climate.js');
assert.equal(C.season(new Date(2026, 0, 5)), 'winter'); assert.equal(C.season(new Date(2026, 3, 5)), 'spring');
assert.equal(C.season(new Date(2026, 6, 5)), 'summer'); assert.equal(C.season(new Date(2026, 9, 10)), 'fall'); assert.equal(C.season(new Date(2026, 11, 31)), 'winter');
// starting points: fresh air everywhere but smoke; only the controls the car has
const caps = { auto: true, seatHeat: true, wheelHeat: true, rearDefrost: true, fanMax: 8 };
['spring', 'summer', 'fall', 'winter'].forEach(k => assert.equal(C.starter('season', k, caps).air, 'fresh', k));
C.WEATHER.filter(w => w[0] !== 'smoke').forEach(w => assert.equal(C.starter('weather', w[0], caps).air, 'fresh', w[0]));
assert.equal(C.starter('weather', 'smoke', caps).air, 'recirc');
const frost = C.starter('weather', 'frost', caps);
assert.ok(frost.ac === 'on' && frost.flow === 'defrost' && frost.frontDef && frost.rearDef && frost.fan === 8 && frost.mode === 'manual', 'frost: clear the glass');
assert.equal(C.starter('weather', 'frost', {}).rearDef, false, 'no rear defroster: off');
assert.equal(C.starter('season', 'winter', {}).seatD, 0, 'no heated seats: off');
assert.equal(C.starter('season', 'spring', {}).fan, 3, 'manual: a fan step, not auto');
// warnings
assert.deepEqual(C.warnings({ air: 'fresh', ac: 'on' }), []);
assert.deepEqual(C.warnings({ air: 'recirc', ac: 'off' }), ['recirc']);
assert.deepEqual(C.warnings({ air: 'recirc', ac: 'on' }), ['recirc', 'dry'], 'recirculate with the A/C: dry air too');
assert.deepEqual(C.warnings({ key: 'smoke', air: 'recirc', ac: 'off' }), ['recircShort'], 'smoke: only for a few minutes');
assert.deepEqual(C.warnings({ air: 'auto' }), ['autoAir']);
// the line
const p = Object.assign(C.starter('season', 'winter', caps), { mode: 'manual', fan: 4, tempP: 75 });
assert.equal(C.line(p, { dual: true }), '72° / 75° · Fan 4 · A/C off · Fresh air · Feet & windshield · Heated seat 2 · Heated wheel');
assert.equal(C.line(p, {}), '72° · Fan 4 · A/C off · Fresh air · Feet & windshield · Heated seat 2 · Heated wheel', 'one zone: one temperature');
assert.equal(C.label({ kind: 'weather', key: 'snow' }), 'Snow & ice'); assert.equal(C.label({ kind: 'custom', name: 'Road trip' }), 'Road trip');
console.log('climate tests passed');
