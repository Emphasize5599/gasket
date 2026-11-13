// Toyota / Lexus parts-catalog trims (0.0.477): the grade parser, the page reader on replies shaped like the stores' real
// ones (autoparts.toyota.com / parts.lexus.com, read 2026-11-13 with public dealer-inventory VINs), and the native wiring.
const assert = require('node:assert/strict'), fs = require('node:fs');
const T = require('../assets/web/trims.js');

// grades the stores returned for dealer VINs whose trims the listings name
assert.equal(T.oemGrade('TWO SEDAN', 'toyota'), 'Two', '2016 Prius Two');
assert.equal(T.oemGrade('LE', 'toyota'), 'LE', 'Sienna LE');
assert.equal(T.oemGrade('XSE SEDAN', 'toyota'), 'XSE', 'Camry XSE');
assert.equal(T.oemGrade('TRD OFFROAD DOUBLE CAB', 'toyota'), 'TRD Off-Road', 'Tacoma TRD Off-Road');
assert.equal(T.oemGrade('TRD PRO DOUBLE CAB', 'toyota'), 'TRD Pro', 'Tacoma TRD Pro');
assert.equal(T.oemGrade('SR5 ACCESS CAB', 'toyota'), 'SR5');
assert.equal(T.oemGrade('XLE PREMIUM', 'toyota'), 'XLE Premium');
assert.equal(T.oemGrade('F-SPORT SUV', 'lexus'), 'F-Sport', 'RX 350 F Sport');
assert.equal(T.oemGrade('F-SPORT SUV', 'lexus', ['Base', 'F Sport', 'Luxury']), 'F Sport', "the trim list's own spelling wins");
assert.equal(T.oemGrade('TRD OFFROAD DOUBLE CAB', 'toyota', ['SR', 'TRD Off-Road', 'TRD Pro']), 'TRD Off-Road');
// Lexus sells Premium / Luxury outside the grade: a bare STANDARD / BASE / body says nothing
for (const g of ['STANDARD SUV', 'BASE SUV', 'SUV', '', null]) assert.equal(T.oemGrade(g, 'lexus'), '', 'no Lexus trim from ' + g);
assert.equal(T.oemGrade('STANDARD', 'toyota'), '');
assert.equal(T.oemGrade('X'.repeat(40), 'toyota'), '', 'not a trim');

// the page reader, run as the hidden WebView would, against store-shaped replies
const src = fs.readFileSync('assets/oemvin_worker.js', 'utf8');
async function run(vin, reply, page) {
  let out, asked;
  const doc = { title: (page && page.title) || 'Toyota Autoparts', body: { innerText: (page && page.text) || 'Shop by VIN' } };
  const fetch = async (url, o) => { asked = { url, o }; return { status: reply.status || 200, ok: (reply.status || 200) < 400, text: async () => reply.body }; };
  const fn = Function('GasketSite', 'document', 'fetch', 'AbortController', 'setTimeout', 'clearTimeout', 'return (' + src + ')')(
    { result: (id, j) => { out = JSON.parse(j); } }, doc, fetch, AbortController, setTimeout, clearTimeout);
  await fn(1, { vin });
  return { out, asked };
}
(async () => {
  const ok = JSON.stringify({ data: { vehicleData: { message: 'Success', allRecords: [{ model_year: 2011, make: 'TOYOTA', model_name: 'SIENNA', grade: 'LE', driveline: '2WD 3.5L 6-CYL 6AT' }] } } });
  let r = await run('5TDKK3DC9BS006257', { body: ok });
  assert.deepEqual(r.out.records, [{ year: 2011, make: 'TOYOTA', model: 'SIENNA', grade: 'LE', driveline: '2WD 3.5L 6-CYL 6AT' }]);
  assert.equal(r.asked.url, '/graphql?getVehicleDataByVin', "the store's own same-origin lookup");
  assert.equal(r.asked.o.method, 'POST');
  assert.match(JSON.parse(r.asked.o.body).query, /vehicleData\(vin:"5TDKK3DC9BS006257"\)/);
  r = await run('2T2HZMAA3NC249635', { body: JSON.stringify({ data: { vehicleData: { message: 'No data found', allRecords: [null] } } }) });
  assert.deepEqual(r.out.records, [], 'unknown VIN = no records');
  r = await run('5TDKK3DC9BS006257', { status: 403, body: '<HTML><TITLE>ERROR: The request could not be satisfied</TITLE>Request blocked.' });
  assert.equal(r.out.blocked, true, 'a refusal is reported, never got around');
  r = await run('5TDKK3DC9BS006257', { body: ok }, { title: 'Access Denied' });
  assert.equal(r.out.blocked, true);
  assert.equal(r.asked, undefined, 'a check on the page stops before any lookup');
  r = await run('5TDKK3DC9BS0062', { body: ok });
  assert.equal(r.out.error, 'Invalid VIN');
  assert.equal(r.asked, undefined);
  r = await run('5TDKK3DC9BS006257', { body: '{"data":{}}' });
  assert.ok(r.out.error, 'a malformed answer is an error, not "no trim"');

  // native: fixed pages only, the shared reader, refusals become a visible check, late replies ignored, never a map search
  const java = fs.readFileSync('src/com/bensanzone/fuelmap/MainActivity.java', 'utf8');
  assert.ok(java.includes('("toyotaparts".equals(key) && url.equals("https://autoparts.toyota.com/"))'));
  assert.ok(java.includes('("lexusparts".equals(key) && url.equals("https://parts.lexus.com/"))'));
  assert.ok(/isOemVin\(key\) \? "oemvin"/.test(java));
  assert.ok(/"xom"\.equals\(key\) \|\| isOemVin\(key\)\) && view != null/.test(java), 'a check page can be shown to the user');
  const app = fs.readFileSync('assets/web/app.js', 'utf8');
  assert.ok(/brave\|nhtsa\|tirerack\|toyotaparts\|lexusparts\)\$\/\.test\(key\)\)return;/.test(app), 'closing a parts-store check never searches stations');
  const garage = fs.readFileSync('assets/web/garage.js', 'utf8');
  assert.ok(/if \(!d\.trim\) oemTrim\(c, vin\)/.test(garage), 'asked only when NHTSA has no clean trim');
  assert.ok(/c\.trimSrc = 'vin'; c\.trimBy = brand/.test(garage), 'a catalog trim is locked like a VIN trim');
  console.log('Toyota / Lexus parts-catalog trims parse, read and stay inside their stores');
})().catch((e) => { console.error(e); process.exit(1); });
