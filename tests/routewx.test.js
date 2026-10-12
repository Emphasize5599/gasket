// Weather and air along the route: where you'll be and when, what the forecast means for driving, stretches, advice.
const assert = require('node:assert/strict');
global.window = global;
require('../assets/web/states.js');
const L = require('../assets/web/limits.js'), T = require('../assets/web/trip.js'), W = require('../assets/web/routewx.js');

// a 300-mile route west from Little Rock, 5 hours of driving
const line = []; for (let i = 0; i <= 300; i++) line.push({ lat: 34.75 - 0.3 * i / 300, lng: -92.29 - 4.5 * i / 300 });
const m = T.buildRoute({ distanceMeters: 300 * 1609.344, duration: '18000s', polyline: { encodedPolyline: T.encodePolyline(line) }, legs: [] }, { city: 30, hwy: 38, comb: 33 });
const t0 = Date.parse('2026-10-14T12:00:00Z');
const pts = W.samples(m, { depart: t0, stops: [{ mi: 150, min: 15 }] });
assert.equal(pts.length, 16, 'every 20 miles: ' + pts.length);
assert.equal(pts[0].eta, t0); assert.equal(pts[pts.length - 1].eta, t0 + 5 * 3600e3 + 15 * 60e3, 'driving time plus the stop');
assert.ok(pts[7].eta < t0 + 2.5 * 3600e3 && pts[8].eta > t0 + 2.5 * 3600e3 + 15 * 60e3 - 1, 'the stop only delays what comes after it');
assert.ok(W.samples(m, { max: 5 }).length <= 6, 'long trips: farther apart');

// what the forecast means
assert.deepEqual(W.classify({ code: 65, tF: 60, precip: 0.5, snow: 0, visM: 9000, gust: 10 }), { rain: 2 });
assert.deepEqual(W.classify({ code: 61, tF: 31, precip: 0.05, snow: 0, visM: 9000, gust: 10 }), { ice: 2 }, 'rain below freezing = ice');
assert.deepEqual(W.classify({ code: 73, tF: 25, precip: 0.1, snow: 0.3, visM: 3000, gust: 10 }), { snow: 1 });
assert.deepEqual(W.classify({ code: 95, tF: 80, precip: 0.4, snow: 0, visM: 9000, gust: 45 }), { storm: 2, rain: 2, wind: 1 });
assert.deepEqual(W.classify({ code: 45, tF: 50, precip: 0, snow: 0, visM: 300, gust: 3 }), { fog: 2 });
assert.deepEqual(W.classify({ code: 0, tF: 101, precip: 0, snow: 0, visM: 30000, gust: 5 }), { heat: 2 });
assert.deepEqual(W.classify(null, { aqi: 120 }), { air: 1 }); assert.deepEqual(W.classify(null, { aqi: 40 }), {});
assert.equal(W.airCause({ pm25: 160, ozone: 60 }), 'smoke or fine particles'); assert.equal(W.airCause({ pm25: 50, ozone: 120 }), 'smog (ozone)'); assert.equal(W.airCause({ dust: 80 }), 'dust');

// stretches: consecutive points, a one-point gap bridged, two gaps split
const P = (mi, flags, extra) => Object.assign({ mi, eta: t0 + mi * 60e3, flags }, extra);
const xs = W.stretches([P(0, {}), P(20, { rain: 1 }, { wx: { precip: 0.1 } }), P(40, {}), P(60, { rain: 2 }, { wx: { precip: 0.5 } }), P(80, {}), P(100, {}), P(120, { rain: 1 }, { wx: { precip: 0.05 } }),
  P(140, { air: 2 }, { aq: { aqi: 170, pm25: 170, ozone: 50 } }), P(160, { air: 1 }, { aq: { aqi: 110, pm25: 110, ozone: 50 } })]);
assert.deepEqual(xs.map((x) => [x.kind, x.level, x.fromMi, x.toMi]), [['rain', 2, 20, 60], ['rain', 1, 120, 120], ['air', 2, 140, 160]]);
assert.deepEqual(xs[2].peak, { aqi: 170, cause: 'smoke or fine particles' }); assert.equal(xs[0].peak.precip, 0.5);

// advice: tread, tire type, presets, recirculate
const heavy = { kind: 'rain', level: 2, from: t0, to: t0 + 30 * 60e3, peak: {}, events: [] };
assert.match(W.advice(heavy, { tread: 3 }).join(' '), /about 3\/32.*hydroplanes/);
assert.match(W.advice(heavy, { tread: 8 }).join(' '), /Heavy rain: slow down/);
assert.match(W.advice({ kind: 'snow', level: 1, from: t0, to: t0, peak: {}, events: [] }, { tireType: 'Max Performance Summer' }).join(' '), /Summer tires/);
assert.match(W.advice({ kind: 'snow', level: 1, from: t0, to: t0, peak: {}, events: [] }, { tireType: 'Grand Touring All-Season', tread: 5 }).join(' '), /below the ~6\/32/);
const smoke = { kind: 'air', level: 2, from: t0, to: t0 + 2 * 3600e3, peak: { aqi: 170, cause: 'smoke or fine particles' }, events: [] };
const sa = W.advice(smoke, { preset: { title: 'If it\'s smoky or polluted', line: '70° · Recirculate', notes: '' } }).join(' ');
assert.match(sa, /Recirculate through it \(AQI up to 170, mostly smoke/); assert.match(sa, /over an hour/); assert.match(sa, /Your “If it's smoky or polluted” climate preset: 70° · Recirculate/);
assert.match(W.advice({ kind: 'fog', level: 1, from: t0, to: t0, peak: {}, events: [] }, {}).join(' '), /set up what you'd do “If it's foggy”/);

// National Weather Service alerts: driving-relevant only, with their times
assert.equal(W.alertOf({ properties: { event: 'Rip Current Statement' } }), null);
assert.equal(W.alertOf({ properties: { event: 'Red Flag Warning' } }), null);
const a = W.alertOf({ properties: { id: 'x', event: 'Tropical Storm Warning', severity: 'Severe', onset: '2026-10-14T10:00:00Z', ends: '2026-10-15T10:00:00Z' } });
assert.equal(a.level, 2); assert.equal(a.from, Date.parse('2026-10-14T10:00:00Z'));
assert.equal(W.alertOf({ properties: { event: 'Winter Weather Advisory', severity: 'Moderate' } }).level, 1);

// the bundled county outlines: each city is in its own county and not the next one
require('../assets/web/counties.js');
for (const [fips, lat, lng, name] of [['48113', 32.7767, -96.797, 'Dallas'], ['05119', 34.7465, -92.2896, 'Little Rock'], ['17031', 41.8781, -87.6298, 'Chicago'], ['06037', 34.0522, -118.2437, 'Los Angeles'],
  ['15003', 21.3069, -157.8583, 'Honolulu'], ['02020', 61.2181, -149.9003, 'Anchorage'], ['12086', 25.7617, -80.1918, 'Miami'], ['36061', 40.7831, -73.9712, 'Manhattan']]) {
  assert.ok(W.inPolys(US_COUNTIES[fips], lat, lng), name + ' in ' + fips);
  assert.ok(!W.inPolys(US_COUNTIES['48113'], lat, lng) || fips === '48113', name + ' not in Dallas County');
}
assert.ok(Object.keys(US_COUNTIES).length > 3200, 'all 50 states');
// alerts: what they are (by name, or read from their text), and where they are (outline or counties)
assert.deepEqual(W.digestKnown('Flash Flood Warning'), { kind: 'flood', label: 'Flash flooding' });
assert.deepEqual(W.digestKnown('Winter Storm Watch'), { kind: 'snow', label: 'Snow and ice' });
assert.equal(W.digestKnown('Special Weather Statement'), null, 'vague: read its text');
assert.deepEqual(W.digestWords('At 3 PM, dense fog was reducing visibility to a quarter mile.'), { kind: 'fog', label: 'Dense fog' });
assert.equal(W.alertOf({ properties: { event: 'Special Weather Statement', geocode: { SAME: ['005119'] } } }).counties[0], '05119', 'SAME code -> county FIPS');

(async () => {
  // the rating model reads a vague alert; without it, its words
  const sws = W.alertOf({ properties: { event: 'Special Weather Statement', headline: 'Strong thunderstorms', description: 'A strong thunderstorm will impact the area with gusts to 50 mph and pea size hail.' } });
  await W.digest(sws, async (t, g) => { assert.ok(g.storm && g.fog); return { storm: 0.62, fog: 0.2, snow: 0.1 }; });
  assert.deepEqual([sws.kind, sws.label, sws.by], ['storm', 'Strong storms', 'ai']);
  const sws2 = W.alertOf({ properties: { event: 'Special Weather Statement', description: 'Patchy dense fog this morning.' } });
  await W.digest(sws2, null); assert.deepEqual([sws2.kind, sws2.by], ['fog', 'words']);

  // where: a county alert, a storm-based outline, and one that's over before you get there
  const box = (x0, y0, x1, y1) => [[[x0, y0, x1, y0, x1, y1, x0, y1, x0, y0]]];
  const counties = { '05119': box(-93.0, 34.0, -92.5, 35.0), '05125': box(-92.5, 34.0, -92.0, 35.0) };
  const dense = W.samples(m, { depart: t0, everyMi: 1, max: 4000 });
  const st = W.alertStretches(dense, [
    { id: 'c', kind: 'snow', label: 'Snow and ice', event: 'Winter Storm Warning', level: 2, from: t0, to: t0 + 864e5, counties: ['05119'] },
    { id: 'p', kind: 'storm', label: 'Severe storms', event: 'Severe Thunderstorm Warning', level: 2, from: t0, to: t0 + 864e5, polys: W.polysOf({ type: 'Polygon', coordinates: [[[-95, 34], [-94.5, 34], [-94.5, 35], [-95, 35], [-95, 34]]] }) },
    { id: 'old', kind: 'fog', label: 'Dense fog', event: 'Dense Fog Advisory', level: 1, from: t0 - 5 * 3600e3, to: t0 - 3 * 3600e3, counties: ['05125'] }
  ], (f) => counties[f]);
  const mi = (lng) => (-92.29 - lng) / 4.5 * 300;
  assert.deepEqual(st.map((x) => x.id), ['c', 'p'], 'the fog was over before you got there');
  assert.ok(Math.abs(st[0].fromMi - mi(-92.5)) <= 1.5 && Math.abs(st[0].toMi - mi(-93.0)) <= 1.5, JSON.stringify(st[0]));
  assert.ok(Math.abs(st[1].fromMi - mi(-94.5)) <= 1.5 && Math.abs(st[1].toMi - mi(-95)) <= 1.5, JSON.stringify(st[1]));
  assert.ok(st[0].from > t0 && st[0].to > st[0].from, 'when you\'d be in it');

  // a whole route: one weather and one air request per 50 points, each state once, no per-point lookups
  const urls = [], now = Date.now();
  const hourly = (n, f) => { const t = new Date(); t.setUTCHours(0, 0, 0, 0); return { time: Array.from({ length: n }, (_, i) => new Date(t.getTime() + i * 3600e3).toISOString().slice(0, 16)), ...f(n) }; };
  const fill = (n, v) => Array(n).fill(v);
  let loaded = 0;
  const res = await W.forRoute(m, async (u) => {
    urls.push(u);
    const lngs = (new URLSearchParams(u.split('?')[1]).get('longitude') || '').split(',');
    if (/air-quality/.test(u)) return { body: JSON.stringify(lngs.map((g) => ({ hourly: hourly(120, (n) => ({ us_aqi: fill(n, +g < -95 ? 155 : 30), us_aqi_pm2_5: fill(n, +g < -95 ? 155 : 30), us_aqi_ozone: fill(n, 20), dust: fill(n, 0) })) }))) };
    if (/open-meteo/.test(u)) return { body: JSON.stringify(lngs.map((g) => ({ hourly: hourly(48, (n) => ({ weather_code: fill(n, +g > -93 ? 65 : 1), temperature_2m: fill(n, 70), precipitation: fill(n, +g > -93 ? 0.4 : 0), snowfall: fill(n, 0), visibility: fill(n, 20000), wind_gusts_10m: fill(n, 10) })) }))) };
    if (/area=OK/.test(u)) return { body: JSON.stringify({ features: [{ properties: { id: 'tw', event: 'Tornado Warning', severity: 'Extreme', onset: new Date(now).toISOString(), ends: new Date(now + 864e5).toISOString(), geocode: { SAME: ['040001'] } } }] }) };
    if (/area=/.test(u)) return { body: JSON.stringify({ features: [{ properties: { event: 'Rip Current Statement', onset: new Date(now).toISOString(), ends: new Date(now + 864e5).toISOString() } }] }) };
    return { error: 'offline' };
  }, { depart: now + 3600e3, stateAt: L.stateAt, countyOf: (f) => f === '40001' ? box(-96, 34, -94.4, 35.5) : null, counties: async () => { loaded++; } });
  const states = [...new Set(W.samples(m, { everyMi: 1, max: 4000 }).map((p) => L.stateAt(p.lat, p.lng)).filter(Boolean))];
  assert.equal(urls.filter((u) => /v1\/forecast/.test(u)).length, 1); assert.equal(urls.filter((u) => /air-quality/.test(u)).length, 1);
  assert.equal(urls.filter((u) => /area=/.test(u)).length, states.length, 'each state once: ' + states);
  assert.equal(urls.filter((u) => /point=/.test(u)).length, 0, 'no per-point lookups');
  assert.equal(loaded, 1, 'county outlines loaded only because an alert needed them');
  const tw = res.hazards.find((x) => x.src === 'nws');
  assert.ok(tw && tw.kind === 'tornado' && tw.label === 'Tornado' && tw.event === 'Tornado Warning', JSON.stringify(tw));
  const rain = res.hazards.find((x) => x.kind === 'rain');
  assert.equal(rain.fromMi, 0, 'widened to cover the road between forecast points');
  assert.equal(W.title(rain), 'Heavy rain'); assert.equal(W.title(tw), 'Tornado');
  assert.ok(W.COLORS.tornado && W.COLORS.rain !== W.COLORS.snow);
  console.log('route hazards: ' + urls.length + ' requests (' + states.join(', ') + '); ' + res.hazards.map((x) => x.kind + ' ' + Math.round(x.fromMi) + '–' + Math.round(x.toMi)).join(', '));
})().catch((e) => { console.error(e); process.exitCode = 1; });
