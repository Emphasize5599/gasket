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

// Subaru / Kia store descriptions (parts.subaru.com / parts.kia.com, read 2026-11-16 in the emulator's Chrome with public
// dealer-inventory VINs; each listing named the trim on the right)
const desc = [
  ['2021 Subaru Outback 2.5L CVT Limited', 'Limited'], ['2021 Outback 2.5L Limited', 'Limited'],
  ['2021 Subaru Outback 2.5L CVT Premium', 'Premium'], ['2021 Subaru Forester 2.5L CVT Sport w/EyeSight', 'Sport'],
  ['2019 Crosstrek 2.0L CVT Premium', 'Premium'], ['2021 Sorento 2.5L AT LX', 'LX'], ['2020 Forte 2.0L AT LXS', 'LXS'],
  ['2021 Sportage 2.4L AT 4 DOOR LX', 'LX'], ['2021 Sportage 2.4L AT 4WD 4 DOOR S', 'S'],
  // Mazda (parts.mazdausa.com) and Audi (parts.audiusa.com), same day, same way
  ['2020 Mazda3 2.5L AT 2WD SEDAN PREFERRED (VIN Begins: JM1)', 'Preferred'], ['2021 Mazda3 2.5L AT 2WD SEDAN SELECT (VIN Begins: JM1)', 'Select'],
  ['2020 Mazda3 2.5L AT 4WD HATCHBACK PREMIUM', 'Premium'], ['2020 Mazda3 2.5L AT 4WD HATCHBACK PREFERRED', 'Preferred'],
  ['2021 CX-30 2.5L AT 4WD S PREMIUM', 'S Premium'], ['2021 CX-5 2.5L AT 4WD Touring', 'Touring'],
  ['2020 A4 2.0L A/T FWD Premium Sedan', 'Premium'], ['2020 A4 2.0L A/T FWD Premium Plus Sedan', 'Premium Plus'],
  ['2021 Q5 2.0L MILD HYBRID EV-GAS (MHEV) A/T Premium Plus Sport Utility', 'Premium Plus']
];
for (const [d, t] of desc) assert.equal(T.descTrim(d, null), t, d);
assert.equal(T.descTrim('2021 Outback 2.5L Limited', 2021, ['Base', 'Premium', 'Limited']), 'Limited');
assert.equal(T.descTrim('2021 Outback 2.5L Limited', 2020), '', 'another model year says nothing');
assert.equal(T.descTrim('2021 Outback Limited', 2021), '', 'no engine size, no trim');
assert.equal(T.descTrim('2021 Outback 2.5L CVT', 2021), '', 'nothing after the engine and transmission');
// VW's store answer for a Tiguan VIN lists every possible trim: they disagree, so the app keeps none
const vw = ['2021 Tiguan 2.0L A/T AWD SEL Sport Utility', '2021 Tiguan 2.0L A/T AWD SE Sport Utility', '2021 Tiguan 2.0L A/T AWD SE R-Line Black Sport Utility'].map((d) => T.descTrim(d, 2021));
assert.deepEqual(vw, ['SEL', 'SE', 'SE R-Line Black']);

// the page reader, run as the hidden WebView would, against store-shaped replies
const src = fs.readFileSync('assets/oemvin_worker.js', 'utf8');
async function run(vin, reply, page, store) {
  let out, asked;
  const doc = { title: (page && page.title) || 'Toyota Autoparts', body: { innerText: (page && page.text) || 'Shop by VIN' } };
  const fetch = async (url, o) => { asked = { url, o }; return { status: reply.status || 200, ok: (reply.status || 200) < 400, text: async () => reply.body }; };
  const fn = Function('GasketSite', 'document', 'fetch', 'AbortController', 'setTimeout', 'clearTimeout', 'return (' + src + ')')(
    { result: (id, j) => { out = JSON.parse(j); } }, doc, fetch, AbortController, setTimeout, clearTimeout);
  await fn(1, { vin, store });
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
  // Subaru / Kia store platform: the reply shape captured from parts.subaru.com
  const sp = JSON.stringify({ d: JSON.stringify([{ vehicleDescription: '2021 Subaru Outback 2.5L CVT Limited', vechicleHref: '/Subaru_2021_Outback-25L-CVT-Limited.html' }, { vehicleDescription: '2021 Outback 2.5L Limited', vechicleHref: '/Subaru_2021_Outback-25L-Limited.html' }]) });
  r = await run('4S4BTANC5M3183887', { body: sp }, null, 'simplepart');
  assert.deepEqual(r.out.descriptions, ['2021 Subaru Outback 2.5L CVT Limited', '2021 Outback 2.5L Limited']);
  assert.equal(r.asked.url, '/wm.aspx/CreateVinLinks', "the store's own same-origin VIN lookup");
  assert.equal(JSON.parse(r.asked.o.body).VinNumber, '4S4BTANC5M3183887');
  r = await run('4S4BTANC5M3183887', { body: JSON.stringify({ d: '[]' }) }, null, 'simplepart');
  assert.deepEqual(r.out.descriptions, [], 'unknown VIN = no descriptions');
  r = await run('4S4BTANC5M3183887', { status: 403, body: '<html><title>Just a moment...</title>Verify you are human' }, null, 'simplepart');
  assert.equal(r.out.blocked, true, 'a Cloudflare refusal is reported, never got around');
  r = await run('4S4BTANC5M3183887', { body: sp }, { title: 'Just a moment...', text: 'Verify you are human' }, 'simplepart');
  assert.equal(r.out.blocked, true); assert.equal(r.asked, undefined, 'a check on the page stops before any lookup');
  r = await run('4S4BTANC5M3183887', { body: '{"x":1}' }, null, 'simplepart');
  assert.ok(r.out.error, 'a malformed answer is an error');

  // native: fixed pages only, the shared reader, refusals become a visible check, late replies ignored, never a map search
  const java = fs.readFileSync('src/com/bensanzone/fuelmap/MainActivity.java', 'utf8');
  assert.ok(java.includes('("toyotaparts".equals(key) && url.equals("https://autoparts.toyota.com/"))'));
  assert.ok(java.includes('("lexusparts".equals(key) && url.equals("https://parts.lexus.com/"))'));
  assert.ok(java.includes('("subaruparts".equals(key) && url.equals("https://parts.subaru.com/"))'));
  assert.ok(java.includes('("kiaparts".equals(key) && url.equals("https://parts.kia.com/"))'));
  assert.ok(java.includes('("mazdaparts".equals(key) && url.equals("https://parts.mazdausa.com/"))'));
  assert.ok(java.includes('("audiparts".equals(key) && url.equals("https://parts.audiusa.com/"))'));
  assert.ok(/"subaruparts"\.equals\(key\) \|\| "kiaparts"\.equals\(key\)/.test(java), 'Subaru / Kia use the shared parts-store reader');
  assert.ok(/isOemVin\(key\) \? "oemvin"/.test(java));
  assert.ok(/"xom"\.equals\(key\) \|\| isOemVin\(key\)\) && view != null/.test(java), 'a check page can be shown to the user');
  const app = fs.readFileSync('assets/web/app.js', 'utf8');
  assert.ok(/brave\|nhtsa\|tirerack\|toyotaparts\|lexusparts\|subaruparts\|kiaparts\|mazdaparts\|audiparts\)\$\/\.test\(key\)\)return;/.test(app), 'closing a parts-store check never searches stations');
  const garage = fs.readFileSync('assets/web/garage.js', 'utf8');
  assert.ok(/if \(!d\.trim\) oemTrim\(c, vin\)/.test(garage), 'asked only when NHTSA has no clean trim');
  assert.ok(/c\.trimSrc = 'vin'; c\.trimBy = brand/.test(garage), 'a catalog trim is locked like a VIN trim');
  assert.ok(/subaru: \{ key: 'subaruparts'[^}]*store: 'simplepart' \}/.test(garage) && /kia: \{ key: 'kiaparts'[^}]*store: 'simplepart' \}/.test(garage));
  assert.ok(/mazda: \{ key: 'mazdaparts'[^}]*generic: \/\^base\$\/i \}/.test(garage), "Mazda's BASE (said for CX-5 Grand Tourings) is never a trim");
  assert.ok(/audi: \{ key: 'audiparts'[^}]*store: 'simplepart' \}/.test(garage));
  assert.ok(/trims\.some\(function \(x\) \{ return !x; \}\)\) trims = \[\]/.test(garage), 'an unreadable description keeps no trim');
  console.log('Toyota / Lexus / Subaru / Kia / Mazda / Audi parts-catalog trims parse, read and stay inside their stores');
})().catch((e) => { console.error(e); process.exit(1); });
