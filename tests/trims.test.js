// TrimMath: trim names read from a Brave answer.
const assert = require('node:assert/strict');
const T = require('../assets/web/trims.js');
const accord = { year: 2021, make: 'Honda', model: 'Accord' };

assert.deepEqual(T.parse('Trims: LX, Sport, Sport Special Edition, EX-L, Touring.', accord), ['LX', 'Sport', 'Sport Special Edition', 'EX-L', 'Touring']);
assert.deepEqual(T.parse('Trims: LX, Sport 2.0T, EX-L and Touring 2.0T', accord), ['LX', 'Sport 2.0T', 'EX-L', 'Touring 2.0T']);
// the car's own name and year come off each name; a following sentence is not part of the list
assert.deepEqual(T.parse('Trims: 2021 Honda Accord LX, Accord Sport, Accord Touring. The Sport adds 19-inch wheels.', accord), ['LX', 'Sport', 'Touring']);
// no "Trims:" lead: "trim levels are"
assert.deepEqual(T.parse('The 2020 Ford Mustang trim levels are EcoBoost, EcoBoost Premium, GT, GT Premium, Bullitt, Shelby GT350 and Shelby GT500.', { year: 2020, make: 'Ford', model: 'Mustang' }),
  ['EcoBoost', 'EcoBoost Premium', 'GT', 'GT Premium', 'Bullitt', 'Shelby GT350', 'Shelby GT500']);
// bullets, parentheses and prices are not names
assert.deepEqual(T.parse('Trims: • L (base) • LE • XLE • XSE • Limited ($35,000 starting price)', { year: 2019, make: 'Toyota', model: 'Camry' }), ['L', 'LE', 'XLE', 'XSE', 'Limited']);
assert.deepEqual(T.parse('Trims: LE, XLE, LE, le', accord), ['LE', 'XLE'], 'each name once');
// no list at all
assert.deepEqual(T.parse('The Accord is a midsize sedan sold since 1976.', accord), []);
assert.deepEqual(T.parse('', accord), []);
// merging sources, and finding a typed trim in the list
assert.deepEqual(T.merge(['LX', 'Sport'], ['sport', 'EX-L'], null), ['LX', 'Sport', 'EX-L']);
assert.equal(T.find(['LX', 'EX-L'], 'ex l'), 'EX-L');
assert.equal(T.find(['LX'], 'Touring'), '');
console.log('trims: parse, merge, find');
