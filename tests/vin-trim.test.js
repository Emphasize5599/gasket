const assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('assets/web/garage.js','utf8'),start=source.indexOf('function fromVpic(R)'),end=source.indexOf('/** How well an EPA',start);
const decode=Function('titleCase',source.slice(start,end)+';return fromVpic;')(s=>s);
assert.equal(decode({Trim:'LE'}).trim,'LE');
assert.equal(decode({Trim:'',Trim2:'Sport'}).trim,'Sport');
assert.equal(decode({Trim:'',Trim2:'E grade',Series:'XYZ/ABC'}).trim,'');
assert.equal(decode({Trim:'Two/Three',Trim2:'Sport'}).trim,'','ambiguous primary trim is not overridden');
assert.equal(decode({Trim:'',Series:'LE'}).trim,'','series is not blindly treated as marketing trim');
console.log('Primary/secondary trim handling rejects ambiguous and internal grade codes');
