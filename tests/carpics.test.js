// Car pictures: Fuel API trim matching, its paint colors, NHTSA's photo, when to look again, the body to draw.
const assert = require('assert');
const C = require('../assets/web/carpics.js');
assert.equal(C.baseModel('Venza AWD'), 'Venza'); assert.equal(C.baseModel('Corolla Hybrid'), 'Corolla Hybrid'); assert.equal(C.driveOf('Venza AWD'), 'AWD'); assert.equal(C.driveOf('Camry'), '');
const L = [{ id: '1', trim: 'LE', drivetrain: 'FWD' }, { id: '2', trim: 'LE', drivetrain: 'AWD' }, { id: '3', trim: 'XSE V6', drivetrain: 'FWD' }, { id: '4', trim: '', drivetrain: 'FWD' }];
assert.deepEqual(C.matchTrim(L, 'le', ''), { v: L[0], exact: true });
assert.deepEqual(C.matchTrim(L, 'LE', 'AWD'), { v: L[1], exact: true }, 'the drive breaks the tie');
assert.deepEqual(C.matchTrim(L, 'XSE', ''), { v: L[2], exact: false }, 'part of the trim');
assert.deepEqual(C.matchTrim(L, 'Nightshade', ''), { v: L[0], exact: false }, 'unknown trim: the first');
assert.equal(C.matchTrim([], 'LE'), null);
const V = { products: [{ productFormats: [{ code: 'color_0640_032_png', assets: [
  { url: 'https://i.fuelapi.com/x/a_070.png', shotCode: { color: { code: '070', oem_name: 'Blizzard Pearl', simple_name: 'White', rgb1: 'FFFFFF' } } },
  { url: 'https://i.fuelapi.com/x/a_218.png', shotCode: { color: { code: '218', oem_name: 'Midnight Black Metallic', simple_name: 'Black', rgb1: '000417' } } },
  { url: 'https://i.fuelapi.com/x/a_218b.png', shotCode: { color: { code: '218', oem_name: 'Midnight Black Metallic' } } }] },
  { code: 'color_1280_001', assets: [{ url: 'x', shotCode: { color: { code: '1G3' } } }] }] }] };
const cols = C.colorsOf(V, 'color_0640_032_png');
assert.deepEqual(cols.map(c => c.code), ['070', '218'], 'one per paint, this format only');
assert.deepEqual(cols[1], { code: '218', name: 'Midnight Black Metallic', simple: 'Black', rgb: '#000417', url: 'https://i.fuelapi.com/x/a_218.png' });
assert.equal(C.pickColor(cols, { code: '218' }).code, '218'); assert.equal(C.pickColor(cols, { name: 'blizzard pearl' }).code, '070'); assert.equal(C.pickColor(cols, { name: 'Red' }).code, '070', 'not one of its colors: the first');
assert.equal(C.nhtsaPic({ results: [{ vehiclePicture: null }, { vehiclePicture: 'https://static.nhtsa.gov/images/vehicles/1_st0640_046.png' }] }), 'https://static.nhtsa.gov/images/vehicles/1_st0640_046.png');
assert.equal(C.nhtsaPic({ results: [] }), '');
const car = { year: 2020, make: 'Toyota', model: 'Camry AWD', trim: 'LE' };
assert.equal(C.sig(car, 'fuel'), 'fuel|2020|toyota|camry|le'); assert.equal(C.sig(car, 'nhtsa'), 'nhtsa|2020|toyota|camry|', 'NHTSA has one photo per model: the trim doesn\'t matter');
// NHTSA's photo by default; Fuel API's when you pick one of its paints, or when NHTSA has none (and there's a key)
const nh = { url: 'n' }, fu = { colors: [{ code: '070' }, { code: '218' }] };
assert.equal(C.which({ nhtsa: nh, fuel: fu }, null, true), 'nhtsa');
assert.equal(C.which({ nhtsa: nh, fuel: fu }, { code: '218' }, true), 'fuel');
assert.equal(C.which({ nhtsa: nh, fuel: fu }, { code: '218' }, false), 'nhtsa', 'no key: NHTSA');
assert.equal(C.which({ nhtsa: nh, fuel: fu }, { name: 'Red', code: '' }, true), 'nhtsa', 'a common color: still the photo');
assert.equal(C.which({ nhtsa: nh, fuel: fu }, { code: '1G3' }, true), 'nhtsa', 'not one of this trim\'s paints');
assert.equal(C.which({ nhtsa: { fail: 1 }, fuel: fu }, null, true), 'fuel', 'NHTSA has none: Fuel API');
assert.equal(C.which({ nhtsa: { fail: 1 }, fuel: { fail: 1 } }, null, true), null, 'neither: draw it');
assert.equal(C.which({ nhtsa: { fail: 1 } }, null, false), null);
assert.equal(C.bodyOf({ type: 'truck' }), 'truck'); assert.equal(C.bodyOf({ type: 'suv' }), 'suv'); assert.equal(C.bodyOf({ type: 'hybrid' }), 'car');
console.log('car picture tests passed');
