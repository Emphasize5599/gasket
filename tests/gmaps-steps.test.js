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
console.log('Maps website steps: road names, meters and seconds read; partial step lists dropped');
