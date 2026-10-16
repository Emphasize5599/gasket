// Builds prompts from TirePolicy for test setups. argv: out.json
const TM = require('../../assets/web/tires.js'), TP = require('../../assets/web/tirepolicy.js');
const cars = require('./cars.js');
const out = cars.map(c => { const pack = TP.prepare(c, TM); return { name: c.name, prompt: TP.prompt(pack), facts: pack.facts.map(f => f.id + ': ' + f.text) }; });
require('fs').writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
out.forEach(o => console.log('##', o.name, o.prompt.length, 'chars\n  ' + o.facts.join('\n  ')));
