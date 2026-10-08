// The licenses the app shows must be the repo's current ones, and every bundled third-party library must be credited.
const assert = require('assert'), fs = require('fs'), path = require('path');
const gen = require('../tools/gen-legal.js');
assert.equal(fs.readFileSync(gen.out, 'utf8'), gen.build(), 'assets/web/legal.js is out of date: run node tools/gen-legal.js');
global.window = {}; eval(fs.readFileSync(gen.out, 'utf8'));
const L = global.window.LEGAL;
assert.ok(/Source First License 1\.1/.test(L.license) && /Benjamin Sanzone/.test(L.license), 'Gasket license');
// every file in assets/web/lib is third-party code: its notice must be shipped, with the license text itself
const lib = fs.readdirSync(path.join(__dirname, '..', 'assets', 'web', 'lib'));
for (const f of lib) {
  const head = fs.readFileSync(path.join(__dirname, '..', 'assets', 'web', 'lib', f), 'utf8').slice(0, 400);
  if (/Leaflet/.test(head) || /^leaflet\./.test(f)) assert.ok(/Leaflet 1\.9\.4/.test(L.notices) && /BSD 2-Clause License/.test(L.notices) && /Volodymyr Agafonkin/.test(L.notices), f + ': Leaflet notice');
  else assert.fail(f + ' is bundled but has no entry in THIRD_PARTY_NOTICES.md');
}
assert.ok(/us-atlas/.test(L.notices) && /Michael Bostock/.test(L.notices), 'state outlines (us-atlas, ISC)');
assert.ok(/OpenStreetMap/.test(L.notices) && /Open Database License/.test(L.notices), 'OpenStreetMap (ODbL)');
assert.ok(/Google Maps/.test(L.notices), 'Google Maps Platform');
console.log('legal tests passed (' + lib.length + ' bundled library files credited)');
