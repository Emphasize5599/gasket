// Car pictures: NHTSA's photo, picking a Wikimedia Commons photo by file name, photo vs doodle, the body to draw.
const assert = require('assert');
const C = require('../assets/web/carpics.js');
assert.equal(C.baseModel('Venza AWD'), 'Venza'); assert.equal(C.baseModel('Corolla Hybrid'), 'Corolla Hybrid');
assert.deepEqual(C.nhtsaPic({ results: [{ vehiclePicture: null }, { vehiclePicture: 'https://static.nhtsa.gov/images/vehicles/1_st0640_046.png', trim: '5 HB', vehicleModel: 'PRIUS' }] }), { url: 'https://static.nhtsa.gov/images/vehicles/1_st0640_046.png', body: '5 HB PRIUS' });
assert.equal(C.nhtsaPic({ results: [] }), null);
// Commons: the make and model in the file name, the year (or near it) and "front" count; interiors, rear views, other cars are out
const pg = (title, index, w, h) => ({ title: 'File:' + title, index, imageinfo: [{ width: w || 1600, height: h || 1000, thumburl: 'https://upload.wikimedia.org/thumb/' + index + '.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:' + index,
  extmetadata: { Artist: { value: '<a href="x">Test Photographer</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] });
const prius = [pg('Toyota Prius inside.jpg', 1), pg('Toyota Prius 2005 (Chile).jpg', 2), pg('2005 Toyota Prius T Spirit 1.5 Rear.jpg', 3), pg('2005 Toyota Prius T Spirit 1.5 Front.jpg', 4),
  pg('2016 Toyota Prius Two.jpg', 5), pg('Toyota Prius 2005.jpg', 6), pg('Toyota logo.svg', 7)];
const r = C.wikiPick(prius, { year: 2005, make: 'Toyota', model: 'Prius' });
assert.deepEqual(r, { title: '2005 Toyota Prius T Spirit 1.5 Front.jpg', url: 'https://upload.wikimedia.org/thumb/4.jpg', page: 'https://commons.wikimedia.org/wiki/File:4', artist: 'Test Photographer', license: 'CC BY-SA 4.0' });
const civic = [pg('1992 Honda CR-X Del-Sol VXi.jpg', 1), pg('Honda CR-X del Sol 002.JPG', 2), pg('1998 Honda Civic EX coupe, front left, 06-21-2022.jpg', 3)];
assert.equal(C.wikiPick(civic, { year: 1998, make: 'Honda', model: 'Civic' }).title, '1998 Honda Civic EX coupe, front left, 06-21-2022.jpg', 'another model is skipped');
assert.equal(C.wikiPick([pg('2003 Subaru Outback wagon front.jpg', 1)], { year: 2003, make: 'Subaru', model: 'Outback' }).title, '2003 Subaru Outback wagon front.jpg', '"Outback" isn\'t a rear view');
assert.equal(C.wikiPick([pg('2016 Toyota Prius Two.jpg', 1)], { year: 2005, make: 'Toyota', model: 'Prius' }), null, 'another generation: none');
assert.equal(C.wikiPick([pg('Ford Ranger dashboard.jpg', 1), pg('Ford Ranger engine.jpg', 2)], { year: 1994, make: 'Ford', model: 'Ranger' }), null);
assert.equal(C.wikiPick([pg('Toyota Town Ace.jpg', 1)], { year: 2008, make: 'Chrysler', model: 'Town and Country' }), null, 'every word of the model');
// photo vs doodle
const car = { year: 2005, make: 'Toyota', model: 'Prius', pic: { nhtsa: { url: 'n' }, wiki: { url: 'w' } } };
assert.equal(C.which(car), 'nhtsa'); assert.equal(C.which(Object.assign({}, car, { pic: { nhtsa: { fail: 1 }, wiki: { url: 'w' } } })), 'wiki');
assert.equal(C.which(Object.assign({}, car, { pic: { nhtsa: { fail: 1 }, wiki: { fail: 1 } } })), null, 'no photo: the doodle');
assert.equal(C.which(Object.assign({}, car, { picMode: 'doodle' })), null, 'doodle mode: always the drawing');
assert.equal(C.sig({ year: 2020, make: 'Toyota', model: 'Camry AWD', trim: 'LE' }), '2020|toyota|camry', 'one photo per model');
// the body to draw
assert.equal(C.bodyOf({ info: { body: 'Hatchback/Liftback/Notchback' } }), 'hatch');
assert.equal(C.bodyOf({ info: { body: 'Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)' } }), 'suv');
assert.equal(C.bodyOf({ epa: { vclass: 'Minivan - 2WD' } }), 'minivan'); assert.equal(C.bodyOf({ epa: { vclass: 'Small Station Wagons' } }), 'wagon');
assert.equal(C.bodyOf({ epa: { vclass: 'Standard Pickup Trucks 4WD' } }), 'pickup'); assert.equal(C.bodyOf({ epa: { vclass: 'Vans, Passenger Type' } }), 'van');
assert.equal(C.bodyOf({ epa: { vclass: 'Two Seaters' } }), 'coupe'); assert.equal(C.bodyOf({ epa: { vclass: 'Midsize Cars' } }), 'sedan');
assert.equal(C.bodyOf({ pic: { nhtsa: { body: '5 HB PRIUS' } } }), 'hatch'); assert.equal(C.bodyOf({ type: 'truck' }), 'pickup'); assert.equal(C.bodyOf({}), 'sedan');
console.log('car picture tests passed');
