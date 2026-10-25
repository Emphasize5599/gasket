// An EV's fastest DC charging rate read from Brave's answer: the car's peak, not a charger's rating, AC, motor or battery.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),E=require('../assets/web/evspecs.js');
const kw=t=>{const r=E.parseDcKw(t);return r&&r.kw;};
assert.equal(kw('The 2024 Tesla Model Y Long Range can DC fast charge at up to 250 kW at Superchargers.'),250);
assert.equal(kw('It has a 75 kWh battery and a peak DC charging rate of 250 kW.'),250,'kWh is not a kW figure');
assert.equal(kw('The Ioniq 5 supports 350-kW chargers, but its maximum DC charging rate is about 235 kW.'),235,'a charger rating loses to the car\'s');
assert.equal(kw('Its 11 kW onboard AC charger takes 7 hours; DC fast charging peaks at 150kW.'),150,'AC onboard charger ignored');
assert.equal(kw('The dual motors make 340 kW (456 hp). Fast charging maxes out at 190 kW.'),190,'motor output ignored');
assert.equal(kw('Bolt EV: DC fast charging up to 55 kW.'),55);
assert.equal(kw('The battery is 82 kWh.'),null,'no kW figure = nothing');
assert.equal(kw('It has a 300 kW motor.'),null,'only a motor figure = nothing, never a guess');
assert.equal(kw('Charging speed: 1000 kW'),null,'out of range');
assert.match(E.parseDcKw('Peak DC charging is 250 kW on V3 Superchargers.').text,/250 kW/);
// the worker returns the answer text for kind dckw (the app reads the number)
const source=fs.readFileSync('assets/brave_worker.js','utf8');
async function run({text='',ai='',url='https://search.brave.com/ask?q=2024%20Tesla%20Model%20Y%20maximum%20DC%20fast%20charging%20rate%20in%20kW%3F&source=llmSuggest'}){let now=0,result;const ctx={document:{title:'',body:{innerText:text},querySelectorAll:()=>ai?[{innerText:ai}]:[]},GasketSite:{result:(_,s)=>result=JSON.parse(s)},Date:{now:()=>now},URLSearchParams,location:new URL(url),setTimeout:f=>{now+=500;f();},Promise};ctx.window=ctx;await vm.runInNewContext('('+source+')',ctx)(1,{kind:'dckw',bg:true});return result;}
(async()=>{
 let r=await run({text:'2024 Tesla Model Y maximum DC fast charging rate in kW? The Model Y charges at up to 250 kW. AI-generated answer',ai:'2024 Tesla Model Y maximum DC fast charging rate in kW? The Model Y charges at up to 250 kW. AI-generated answer'});
 assert.equal(r.src,'ai');assert.equal(kw(r.text),250);assert.doesNotMatch(r.text,/maximum DC fast charging rate in kW\?/,'the echoed question is removed');
 r=await run({text:'2024 Tesla Model Y maximum DC fast charging rate in kW? Thinking…'});assert(r.error,'the echo alone is no answer');
 r=await run({text:'Results: Model Y specs — Supercharging max 250 kW, range 320 miles',url:'https://search.brave.com/search?q=x&summary=1'});assert.equal(r.src,'results');assert.equal(kw(r.text),250);
 console.log('DC charging rate: parser ranks the car\'s peak over chargers/AC/motor/battery, no figure = null; Brave worker dckw answers, echo-only and results fallback');
})().catch(e=>{console.error(e);process.exitCode=1;});
