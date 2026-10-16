// argv: outputs.json -> each answer through the app's own output guard, with the findings it chose
const TM = require('../../assets/web/tires.js'), TP = require('../../assets/web/tirepolicy.js');
const cars = require('./cars.js'), outs = JSON.parse(require('fs').readFileSync(process.argv[2]));
outs.forEach(o => { const c = cars.find(c => c.name === o.name), pack = TP.prepare(c, TM), r = TP.check(o.text, pack);
  console.log('\n## ' + o.name + ' (' + o.sec + ' s) ' + (r.ok ? 'ACCEPTED' : 'REJECTED: ' + r.reason));
  let a; try { a = JSON.parse(o.text.replace(/^```(json)?|```$/g, '')); } catch (e) { console.log(o.text); return; }
  console.log('SUMMARY: ' + a.summary); (a.top || []).forEach(t => console.log(' * [' + t.n + '] ' + t.why));
});
