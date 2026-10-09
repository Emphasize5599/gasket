const P = require('../assets/web/pricing.js');
const assert = require('assert');
const now = new Date('2026-10-03T15:00:00Z');
function st(brand, name, price, state = 'AR', upd = '2026-10-03T12:00:00Z') {
  const u = Math.floor(price);
  return P.normalize({ id: brand + state, displayName: { text: name }, location: { latitude: 35, longitude: -92 },
    formattedAddress: '1 A St, Town, ' + state + ' 72114, USA', addressComponents: [{ shortText: state, types: ['administrative_area_level_1'] }],
    businessStatus: 'OPERATIONAL', fuelOptions: { fuelPrices: [{ type: 'REGULAR_UNLEADED', price: { units: String(u), nanos: Math.round((price - u) * 1e9) }, updateTime: upd }] } });
}
const S = Object.assign({}, P.DEFAULTS);
const w = (o) => Object.assign({}, S, o);
const tk = P.todayKey(now);

// brand detection
assert.equal(P.detectBrand("Sam's Club Gas Station"), 'sams');
assert.equal(P.detectBrand('Sam’s Club Fuel'), 'sams');
assert.equal(P.detectBrand('Walmart Fuel Station'), 'walmart');
assert.equal(P.detectBrand('Murphy Express'), 'murphy');
assert.equal(P.detectBrand('ExxonMobil'), 'exxon');
assert.equal(P.detectBrand('Mobil'), 'mobil');
assert.equal(P.detectBrand('Automobile Club'), null);
assert.equal(P.detectBrand('CITGO'), 'citgo');
assert.equal(P.detectBrand('Shell'), null);

// Walmart+ 10¢; Alabama 5¢
assert.equal(P.compute(st('exxon', 'Exxon', 2.999), 'regular', S, now).final, 2.899);
assert.equal(P.compute(st('murphy', 'Murphy USA', 2.799), 'regular', S, now).final, 2.699);
assert.equal(P.compute(st('walmart', 'Walmart Fuel Station', 2.799, 'AL'), 'regular', S, now).final, 2.749);
// Sam's: member price as-is, or optional extra 10¢
assert.equal(P.compute(st('sams', "Sam's Club Gas", 2.699), 'regular', S, now).final, 2.699);
assert.equal(P.compute(st('sams', "Sam's Club Gas", 2.699), 'regular', w({ samsMode: 'minus10' }), now).final, 2.599);
// CITGO: Walmart+ 10¢ + Club 3¢
let c = P.compute(st('citgo', 'CITGO', 2.959), 'regular', S, now);
assert.equal(c.final, 2.829); assert.equal(c.steps.length, 3);
// Club CITGO monthly bonuses apply by day: Tue 2026-10-06 (Triple Tuesday), Fri 2026-10-09 (Friday Savings), Sat = none
const tue = new Date(2026, 9, 6, 12), fri = new Date(2026, 9, 9, 12), sat = new Date(2026, 9, 3, 12);
assert.equal(P.citgoBonus(S, tue), 'tuesday'); assert.equal(P.citgoBonus(S, fri), 'friday'); assert.equal(P.citgoBonus(S, sat), 'none');
assert.equal(P.compute(st('citgo', 'CITGO', 2.959), 'regular', w({ citgoTier: 'premier' }), tue).final, 2.679);    // 10 + 18
assert.equal(P.compute(st('citgo', 'CITGO', 2.959), 'regular', w({ citgoTier: 'premier' }), sat).final, 2.799);    // 10 + 6
// used this month: back to the everyday reward; next month it's back
assert.equal(P.compute(st('citgo', 'CITGO', 2.959), 'regular', w({ citgoTier: 'premier', citgoUsed: { tuesday: '2026-10' } }), tue).final, 2.799);
assert.equal(P.citgoBonus(w({ citgoUsed: { tuesday: '2026-10' } }), new Date(2026, 10, 3, 12)), 'tuesday');
// Club + Friday Savings (3+2 = 5¢)
assert.equal(P.compute(st('citgo', 'CITGO', 2.959), 'regular', S, fri).final, 2.809);
// an Exxon / Mobil that ExxonMobil's station finder lists without Walmart+: no 10¢
const notWp = Object.assign(st('mobil', 'Mobil', 3.099), { wplus: false });
c = P.compute(notWp, 'regular', S, now);
assert.equal(c.final, 3.099); assert.ok(c.notes.some((n) => /Not a Walmart\+ station/.test(n)));
assert.equal(P.compute(Object.assign(st('exxon', 'Exxon', 3.099), { wplus: true }), 'regular', S, now).final, 2.999);
// CITGO: the full Walmart+ discount, except on your bad list or (by default) on diesel
assert.ok(P.compute(st('citgo', 'CITGO', 2.959), 'regular', S, sat).steps.some((x) => x.label === 'Walmart+ discount' && x.amount === -0.1));
const bad = Object.assign(st('citgo', 'CITGO', 2.959), { id: 'bad1', lat: 35, lng: -92 });
const SB = Object.assign({}, S, { blacklist: [{ id: 'bad1', brand: 'citgo', lat: 35, lng: -92 }] });
c = P.compute(bad, 'regular', SB, sat); assert.ok(!c.steps.some((x) => x.amount === -0.1) && c.notes.some((n) => /bad CITGO list/.test(n)));
const nearBad = Object.assign(st('citgo', 'CITGO', 2.959), { id: 'other-id', lat: 35.0003, lng: -92 });
assert.ok(P.isBad(nearBad, SB), 'a shared list matches the same spot');
const dsl = Object.assign(st('citgo', 'CITGO', 2.959), { id: 'd1' }); dsl.prices.diesel = dsl.prices.regular;
c = P.compute(dsl, 'diesel', S, sat); assert.ok(!c.steps.some((x) => x.amount === -0.1) && c.notes.some((n) => /diesel/.test(n)));
c = P.compute(dsl, 'diesel', Object.assign({}, S, { dieselRisk: { d1: true } }), sat); assert.ok(c.steps.some((x) => x.amount === -0.1), 'own-risk override');
// Walmart+ off
assert.equal(P.compute(st('mobil', 'Mobil', 3.099), 'regular', w({ walmartPlus: false }), now).final, 3.099);
// 2% cash back on post-discount price: 2.999 * 0.98 = 2.939
assert.equal(P.compute(st('mobil', 'Mobil', 3.099), 'regular', w({ cashbackPct: 2 }), now).final, 2.939);
// stale + missing grade
assert.equal(P.compute(st('mobil', 'Mobil', 3.099, 'AR', '2026-10-01T12:00:00Z'), 'regular', S, now).stale, true);
assert.equal(P.compute(st('mobil', 'Mobil', 3.099), 'regular', S, now).stale, false);
assert.equal(P.compute(st('mobil', 'Mobil', 3.099), 'diesel', S, now), null);
// formatting
assert.deepEqual(P.fmtSign(2.699), { main: '$2.69', tenth: '9' });
assert.deepEqual(P.fmtSign(2.7), { main: '$2.70', tenth: '' });
assert.equal(P.fmt3(0.1), '0.10'); assert.equal(P.fmt3(2.899), '2.899');
// breakdown always adds up to the final price
c = P.compute(st('citgo', 'CITGO', 3.159), 'regular', w({ cashbackPct: 1.5 }), now);
assert.ok(Math.abs(c.steps.reduce((a, s) => a + s.amount, 0) - c.final) < 0.0011);
console.log('all pricing tests passed');

// Walmart official prices (shape captured from walmart.com/store/1234, Oct 2026)
const wmRaw = { id: '1234', name: 'Testville Supercenter', geo: { latitude: 34.765651, longitude: -92.270412 },
  address: { addressLineOne: '100 Main St', city: 'Testville', state: 'AR', postalCode: '72114' },
  fuel: { metadata: { dateCreated: '2026-10-03T07:20:35.994Z' }, prices: [
    { price: 3.879, name: 'UNLEAD', displayName: 'Unleaded' }, { price: 4.229, name: 'MIDGRAD', displayName: 'Mid-Grade' },
    { price: 4.579, name: 'PREMIUM', displayName: 'Premium' }, { price: 5.829, name: 'DIESEL', displayName: 'Diesel' }] } };
const wm = P.normalizeWalmart(wmRaw);
assert.equal(wm.prices.regular.price, 3.879); assert.equal(wm.prices.diesel.price, 5.829); assert.equal(wm.source, 'walmart.com');
const wc = P.compute(wm, 'regular', S, now);
assert.equal(wc.final, 3.779); assert.equal(wc.steps[0].label, 'Posted price (walmart.com)');
// merge onto a nearby Google "Walmart Fuel Station" (keeps Google location/place id, takes Walmart prices)
const g = st('walmart', 'Walmart Fuel Station', 3.999); g.lat = 34.7662; g.lng = -92.2710; g.id = 'gplace1';
let merged = P.mergeWalmart([g, st('exxon', 'Exxon', 3.9)], [wm]);
assert.equal(merged.length, 2); assert.equal(merged[0].id, 'gplace1'); assert.equal(merged[0].prices.regular.price, 3.879); assert.equal(merged[0].wmStoreId, '1234');
assert.equal(g.prices.regular.price, 3.999); // original not mutated
// no Google match -> Walmart station added on its own
merged = P.mergeWalmart([st('exxon', 'Exxon', 3.9)], [wm]);
assert.equal(merged.length, 2); assert.equal(merged[1].id, 'wm-1234');
assert.equal(P.normalizeWalmart({ id: 1, geo: null }), null);
console.log('walmart tests passed');

// Murphy USA official prices (shape captured from Murphy's store finder, Testville AR, Oct 2026)
const muRaw = { id: 1111, storeNumber: 2222, chainName: 'Murphy USA', address: '1 Test Dr', city: 'Testville', state: 'AR', zip: '72000',
  latitude: 34.6789390563965, longitude: -92.3373992919922, closeDate: '', gasPrices: [
    { fuelType: 'Regular', price: 3.8690, lastUpdateUtc: '2026-10-03T13:42:19.46Z' }, { fuelType: 'Midgrade', price: 4.5290, lastUpdateUtc: '2026-10-03T13:42:19.46Z' },
    { fuelType: 'Premium', price: 4.6790, lastUpdateUtc: '2026-10-03T13:42:19.46Z' }, { fuelType: 'Diesel', price: 5.8690, lastUpdateUtc: '2026-10-03T13:42:19.46Z' },
    { fuelType: 'PremiumNoEthanol', price: 4.9290, lastUpdateUtc: '2026-10-03T13:42:19.46Z' }] };
const mu = P.normalizeMurphy(muRaw);
assert.equal(mu.prices.regular.price, 3.869); assert.equal(mu.prices.premium.price, 4.679); assert.equal(mu.extra.price, 4.929);
const mc = P.compute(mu, 'regular', S, now);
assert.equal(mc.final, 3.769); assert.equal(mc.steps[0].label, 'Posted price (murphyusa.com)'); assert.equal(mc.stale, false);
assert.equal(P.normalizeMurphy(Object.assign({}, muRaw, { closeDate: '01/01/2026' })), null);
// Murphy matches the Google Murphy pin but NOT the Walmart pin next door
const gm = st('murphy', 'Murphy USA', 3.999); gm.lat = 34.6791; gm.lng = -92.3371; gm.id = 'gm';
const gw = st('walmart', 'Walmart Fuel Station', 3.999); gw.lat = 34.6790; gw.lng = -92.3374; gw.id = 'gw';
merged = P.mergeOfficial([gm, gw], [mu]);
assert.equal(merged.length, 2);
assert.equal(merged.find(x => x.id === 'gm').prices.regular.price, 3.869);
assert.equal(merged.find(x => x.id === 'gw').prices.regular.price, 3.999);
// two official sources at once
merged = P.mergeOfficial([gm, gw], [mu, wm]);
assert.equal(merged.length, 3); // walmart store 1234 is far from these test pins -> added
console.log('murphy tests passed');

// brand from website when the name is the owner's
assert.equal(P.detectBrand('Owner Fuel 2', 'http://www.exxon.com/en/'), 'exxon');
assert.equal(P.detectBrand('Owner Fuel 2', 'https://mobil.com'), 'mobil');
assert.equal(P.detectBrand('Mobil', 'http://exxon.com'), 'mobil');            // name wins
assert.equal(P.detectBrand('Quick Stop', 'https://www.citgo.com/x'), 'citgo');
assert.equal(P.detectBrand('Quick Stop', 'https://notexxon.com'), null);
assert.equal(P.detectBrand('Quick Stop', ''), null);
// a station Google lists by owner name but links to exxon.com is still picked up as Exxon/Mobil
const ownerFuel = P.normalize({ id: 'ownerfuel', displayName: { text: 'Owner Fuel 2' }, websiteUri: 'http://www.exxon.com/', location: { latitude: 34.80, longitude: -92.20 },
  formattedAddress: '100 Main St, Testville, AR 72000, USA', businessStatus: 'OPERATIONAL' });
assert.equal(ownerFuel.brand, 'exxon'); assert.equal(P.compute(ownerFuel, 'regular', S, now), null); // no price anywhere -> shown as no price
console.log('brand tests passed');

// Settings -> Show prices to the cent: rounded UP, display only
{
  const P = require('../assets/web/pricing.js');
  P.setCents(true);
  assert.equal(P.fmt3(3.199), '3.20'); assert.equal(P.fmt3(3.191), '3.20'); assert.equal(P.fmt3(3.20), '3.20'); assert.equal(P.fmt3(2.8901), '2.90');
  assert.deepEqual(P.fmtSign(3.149), { main: '$3.15', tenth: '' });
  P.setCents(false);
  assert.equal(P.fmt3(3.199), '3.199'); assert.deepEqual(P.fmtSign(3.149), { main: '$3.14', tenth: '9' });
  console.log('cents tests passed');
}
