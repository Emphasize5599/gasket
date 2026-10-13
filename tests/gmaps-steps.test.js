// The Google Maps website's directions answer: each route's turn-by-turn steps (road names, meters, seconds), kept only
// when they add up to the whole route. A small stand-in in the same shape as the page's /maps/preview/directions answer.
const assert = require('node:assert/strict'), fs = require('node:fs');
const src = fs.readFileSync('assets/gmaps_worker.js', 'utf8');
const steps = new Function(src.slice(src.indexOf('  function steps(r, head)'), src.indexOf('  /** DOM list')) + ';return steps;')();
const step = (m, sec, parts) => [[0, '', [m, m + ' m', 1], [sec, sec + ' sec'], null, null, null, null, null, null, null, null, null, null, parts.map((p) => [2, Array.isArray(p) ? p : [p]])]];
const head = [0, 'I-40 W', [10000, '6.2 miles', 1], [420, '7 min']];
const route = [head, [[null, [
  [[0, null, [3000, '1.9 mi', 1]], [step(500, 40, ['Head ', ['south', 1], ' on ', ['Main St', 1]]), step(2500, 120, ['Merge onto ', ['I-30 E', 1]])]],
  [[0, null, [7000, '4.3 mi', 1]], [step(7000, 260, ['Take exit 143A to merge onto ', ['I-40 W/US-65 N', 1], ' toward Testville'])]]]]]];
const got = steps(route, head);
assert.deepEqual(got, [[500, 40, 'Head south on Main St'], [2500, 120, 'Merge onto I-30 E'], [7000, 260, 'Take exit 143A to merge onto I-40 W/US-65 N toward Testville']]);
// only the first few steps sent (an alternative's summary): none, so the route falls back to its points
const partial = [head, [[null, [route[1][0][1][0]]]]];
assert.equal(steps(partial, head), null);
assert.equal(steps([head, null], head), null, 'nothing there');
// the page's whole line: lat/lng × 1e7 as running differences, kept when it's as long as the route, simplified with a
// point at least every quarter mile
const hav = new Function(src.slice(src.indexOf('  const hav ='), src.indexOf('  // The page')) + ';return hav;')();
const line = new Function(src.slice(src.indexOf('  const hav ='), src.indexOf('  // The page')) + src.slice(src.indexOf('  function line(g, head)'), src.indexOf("  /** The route's turn-by-turn")) + ';return line;')();
const raw = []; for (let i = 0; i <= 4000; i++) { const t = i / 4000; raw.push([34.7 + 0.3 * t, -92.3 + 0.6 * t + 0.02 * Math.sin(t * 20)]); }   // a winding road
let L = 0; for (let i = 1; i < raw.length; i++) L += hav(raw[i - 1], raw[i]);
const enc = [[], []]; let pa = 0, pb = 0; raw.forEach(([a, b]) => { const A = Math.round(a * 1e7), B = Math.round(b * 1e7); enc[0].push(A - pa); enc[1].push(B - pb); pa = A; pb = B; });
const got2 = line(enc, [0, 'x', [L * 1609.344]]);
assert.ok(got2 && got2.length > 50 && got2.length < raw.length, 'simplified: ' + (got2 && got2.length));
assert.deepEqual(got2[0], [34.7, -92.3]); assert.deepEqual(got2[got2.length - 1], raw[raw.length - 1].map((v) => +v.toFixed(6)), 'ends where the road ends');
let L2 = 0, gap = 0; for (let i = 1; i < got2.length; i++) { const x = hav(got2[i - 1], got2[i]); L2 += x; gap = Math.max(gap, x); }
assert.ok(Math.abs(L2 - L) < L * 0.01 && gap < 0.3, 'keeps its shape and length (' + L2.toFixed(1) + ' of ' + L.toFixed(1) + ' mi), points every quarter mile (' + gap.toFixed(2) + ')');
assert.equal(line(enc, [0, 'x', [L * 1609.344 * 1.5]]), null, 'a line that is not the whole route is not used');
console.log('Maps website steps and line: road names, meters and seconds read; partial step lists dropped; full line decoded and simplified');
