const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const timers=[],ctx={setTimeout:fn=>{timers.push(fn);return timers.length;},addEventListener(){}};vm.runInNewContext(fs.readFileSync('assets/web/log.js','utf8'),ctx);
const L=ctx.FLog;let saved='';L.configure(5,{load:()=>'',save:s=>saved=s},['secret-api-key-123']);
// Synthetically generated VIN-shaped token, not a user's vehicle.
L.trace('test','secret-api-key-123 1ABCDEFG234567890',{url:'?key=secret-api-key-123'});assert(!L.text().includes('secret-api-key'));assert(L.text().includes('[VIN]'));
for(let i=0;i<5000;i++)L.trace('test','entry '+i,'x'.repeat(2000));
assert(L.entries().length<600,'bounded immediately, without waiting for a quiet period');assert.equal(timers.length,1,'one pending flush under continuous logging');timers.shift()();assert(saved.length<1100000);L.clear();assert.equal(L.entries().length,0);L.configure(0);L.trace('test','disabled');assert.equal(L.entries().length,0);
console.log('Verbose logger redacts secrets/VINs, bounds live memory, coalesces writes and honors disable.');
