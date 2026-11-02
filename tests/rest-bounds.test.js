const assert=require('node:assert/strict'),N=require('../assets/web/overnight'),R=require('../assets/web/resttiming');
const site={lat:40.71,lng:-74,timeZone:'America/New_York',parkingHours:'24/7'},day='2026-11-01';
const c=N.defaults({minimum:360,preferred:480,arrivalStart:{kind:'sunset'},arrivalEnd:{kind:'clock',time:'23:00'},leaveStart:{kind:'dawn'},leaveEnd:{kind:'sunriseEnd'}});
assert.equal(N.validate(c),null);let w=N.windowFor(day,site.timeZone,c,site);
assert(!w.invalid);assert(w.start<w.arrivalEnd&&w.arrivalEnd<w.leaveStart&&w.leaveStart<w.end);
assert.equal(N.local(w.start,site.timeZone).date,day);assert.equal(N.local(w.end,site.timeZone).date,'2026-11-02');
assert(N.fit(site,w.start,w,c));assert.equal(N.fit(site,w.arrivalEnd+1,w,c),null);
const polar={lat:78.22,lng:15.65,timeZone:'Arctic/Longyearbyen'};
assert(N.windowFor('2026-06-21',polar.timeZone,c,polar).invalid,'no solar crossing never becomes a valid window');
assert(N.windowFor('2026-12-21',polar.timeZone,c,polar).invalid);
const clocks=N.defaults({minimum:360,preferred:480,arrivalStart:{kind:'clock',time:'20:00'},arrivalEnd:{kind:'clock',time:'23:00'},leaveStart:{kind:'clock',time:'07:00'},leaveEnd:{kind:'clock',time:'09:00'}});
w=N.windowFor('2026-10-31',site.timeZone,clocks,site);assert.equal((w.end-w.start)/3600000,14,'DST fall-back is elapsed time, not wall-clock subtraction');
const fit=N.fit(site,w.start,w,clocks);assert(fit.leave>=w.leaveStart);assert.equal(N.local(fit.leave,site.timeZone).minute,420);
(async()=>{let active=0,peak=0;const out=await R.map([4,3,2,1],2,async(n)=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,n));active--;return n*2;},()=>true);assert.deepEqual(out,[8,6,4,2]);assert.equal(peak,2);let valid=true,started=0;await assert.rejects(R.map([1,2,3],1,async()=>{started++;valid=false;},()=>valid),/cancel/i);assert.equal(started,1);console.log('Four solar/clock bounds, DST, polar missing events and bounded cancellable ordered sampling passed');})().catch(e=>{console.error(e);process.exitCode=1;});

// Exercise the actual UI validator after a rest was inserted before a timed destination.
const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('assets/web/tripui.js','utf8'),fragment=source.slice(source.indexOf('function restWindowIssues('),source.indexOf('// The flexible-time departure window has closed'));
const ctx={S:{trip:{legDepartures:[]}},route:{stops:[{label:'Start'},{rest:{}},{label:'Destination'}]},windows:{enabled:()=>true,arrivals:()=>[null,{end:200000}]},windowDestination:i=>i===1?{leaveStart:'1970-01-01T00:00:00Z',leaveEnd:'1970-01-01T00:03:20Z'}:{},stopName:s=>s.label};vm.createContext(ctx);vm.runInContext(fragment,ctx);
assert(ctx.restWindowIssues([{}, {arrive:300001}, {depart:300001}]).some(s=>/arrival window ends/.test(s)),'destination bound follows the shifted point slot');
assert.equal(ctx.restWindowIssues([{}, {arrive:100000}, {depart:100000}]).length,0);
ctx.S.trip.legDepartures=[0,null,120000];assert(ctx.restWindowIssues([{}, {arrive:100000}, {depart:180000}]).some(s=>/chosen departure/.test(s)),'an original chosen departure stays an anchor even before the outer window ends');ctx.S.trip.legDepartures=[];

// Refresh consent is resolved before discovery, including areas whose expired prices are not yet loaded.
(async()=>{
 const start=source.indexOf('  async function planningPreflight('),end=source.indexOf('  if(window.KeylessGas&&KeylessGas.askRefresh)',start),owner={},asked=[];
 const c={queueWorking:false,KIND:()=> 'gas',S:{priceRefreshMode:'ask',staleHours:24},priceAsk:{owner:null,answer:true},route:owner,replay:null,savedPriceReplay:()=>false,restSeedRows:()=>[],result:null,gradeOf:()=> 'regular',window:{KeylessGas:{needsPriceRefresh:()=>true}},A:{confirmDel:async q=>{asked.push(q);return false;}},LG:{info:()=>{}}};
 vm.createContext(c);vm.runInContext(source.slice(start,end),c);
 await c.planningPreflight();assert.equal(asked.length,1);assert.match(asked[0].body,/If this trip uses expired/);
 assert.equal(await c.askPriceRefresh({stations:10}),false);assert.equal(asked.length,1,'later discovered prices reuse the preflight answer');
 c.route={};c.priceAsk={owner:null};c.replay={};await c.planningPreflight();assert.equal(asked.length,1,'reopening saved trips does not prompt');
 await c.planningPreflight('rest');assert.equal(asked.length,2,'new rest timing work resolves refresh consent before forecasts');
 console.log('Refresh preflight handles unknown coverage, preserves the decision and leaves saved replay uninterrupted');
})().catch(e=>{console.error(e);process.exitCode=1;});

(async()=>{
 const fragment=source.slice(source.indexOf('  async function restCommit('),source.indexOf('  function localStamp(')),calls=[];
 const c={route:{},restRows:()=>[],restPlanPromise:null,restSeedRows:()=>[],result:null,LG:{info:()=>{}},restPlanIssues:()=>[],restReplan:async(_seed,_previous,_quick,recover)=>{calls.push(!!recover);return {plan:{ok:false},cands:[],opts:{}};}};
 vm.createContext(c);vm.runInContext(fragment,c);
 await assert.rejects(c.restCommit(),/after checking remembered stations and missing coverage/);assert.deepEqual(calls,[false,true],'untimed fuel failure attempts station discovery once');
 calls.length=0;c.restReplan=async()=>{calls.push(false);return {plan:{ok:false,restTimingInvalid:true},opts:{}};};
 await assert.rejects(c.restCommit());assert.deepEqual(calls,[false],'timing violations do not trigger pointless station discovery');
 const rest=fs.readFileSync('assets/web/restui.js','utf8'),legs=[],r={C:{forecast:()=>{},trafficEnabled:()=>true,snapshot:()=>({})},state:{token:7},endsOf:()=>[10,20,30],legSites:()=>[{}],reco:new Map(),recoKey:(_s,i)=>i,startReco:async i=>legs.push(i)};
 vm.createContext(r);vm.runInContext(rest.slice(rest.indexOf('  async function autoReco('),rest.indexOf('  function recoNote(')),r);
 await r.autoReco({model:{}},7);assert.deepEqual(legs,[0,1,2],'suggestions start for every original leg');
 legs.length=0;await r.autoReco({model:{}},6);assert.equal(legs.length,0,'superseded searches stop automatic recommendations');
 console.log('Missing-station recovery runs once; timing failures skip it; automatic rest recommendations cover all legs and respect cancellation');
})().catch(e=>{console.error(e);process.exitCode=1;});
