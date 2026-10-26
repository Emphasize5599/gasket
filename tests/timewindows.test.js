const assert=require('node:assert/strict'),W=require('../assets/web/timewindows'),T=require('../assets/web/trip'),P=require('../assets/web/propulsion');
const h=W.HOUR,start=Date.UTC(2026,9,27,12),clear={hazards:[],stats:{errors:0}},rain={hazards:[{kind:'rain',level:2,fromMi:2,toMi:8,event:'Rain'}],stats:{errors:0}};
assert.deepEqual(W.hours(start,start+2*h+15*60000),[start,start+h,start+2*h]);assert.throws(()=>W.hours(start,start-1));
const rows=[0,1,2,4].map(i=>({leg:0,routeKey:'road',depart:start+i*h,arrive:start+i*h+20*60000,reading:i<2?clear:rain})).map(r=>({...r,signature:W.signature(r.reading)}));
const groups=W.group(rows);assert.equal(groups.length,3);assert.equal(groups[0].rows.length,2,'only consecutive identical conditions group');assert.notEqual(W.signature(clear),W.signature({hazards:[],stats:{errors:1}}),'missing forecasts are not clear conditions');
const consent=W.create();consent.answer(groups[0],true);assert(!consent.allowed(rows[0]),'time approval cannot substitute for road approval');consent.road(0,'road',true);assert(consent.allowed(rows[0]));assert(!consent.allowed(rows[2]));consent.answer(groups[1],false);assert(!consent.allowed(rows[2]));
const raw={distanceMeters:120*1609.344,duration:'7200s',polyline:{encodedPolyline:T.encodePolyline([{lat:35,lng:-92},{lat:36,lng:-92}])},legs:[]},m=T.buildRoute(raw,{city:30,hwy:40,comb:35});m.legEnds=[60,120];
const o={model:m,rewardDepartAt:start,stopMinutes:3,fuelKind:'gas',legDepartures:[start,start+3*h]},p={stops:[],destinationCharges:[]};const timeline=T.scheduleTimeline(o,p);assert.equal(timeline[0].arrive,start+h);assert.equal(timeline[1].depart,start+3*h);assert.equal(timeline[1].waitMinutes,120);assert.equal(timeline[1].arrive,start+4*h);assert.equal(m.durationSec,7200,'waiting never becomes driving time');
assert.equal(T.travelClock(m,90,start,[],[{d:60,at:start+3*h}],o),start+3.5*h);
const projected=P.project(m,{kind:'ev',capacity:60},{startGal:60,waits:[{d:60,at:start+3*h}],departAt:start});assert(projected.stopMinutes>=119,'destination waits advance the EV thermal/weather clock');
(async()=>{
 let reads=0;const state=W.create();assert.deepEqual(await W.readings({rows,consent:state,read:async()=>{reads++;return clear;}}),[]);assert.equal(reads,0,'declined roads never trigger hourly hazard work');state.road(0,'road',true);const loaded=await W.readings({rows,consent:state,read:async r=>{reads++;return r.reading;}});W.group(loaded).forEach(g=>state.answer(g,true));assert.equal(reads,4);
 const evaluate=async path=>({cost:path[0].depart===start?20:10,minutes:path[0].depart===start?60:90,depart:path[0].depart,legs:path.map(r=>({routeKey:r.routeKey,depart:r.depart,arrive:r.arrive,signature:r.signature}))});
 const cheap=await W.search({legs:[loaded],consent:state,evaluate,priority:'cost'}),fast=await W.search({legs:[loaded],consent:state,evaluate,priority:'time'});assert.equal(cheap.best.cost,10);assert.equal(fast.best.minutes,60);
 const changed=await W.search({legs:[[loaded[0]]],consent:state,evaluate:async path=>({...await evaluate(path),legs:[{routeKey:'road',depart:start,arrive:start+20*60000,signature:W.signature(rain),reading:rain}]})});assert.equal(changed.best,null);assert.equal(changed.review.length,1,'new hazards need another explicit decision');state.answer(W.group(changed.review)[0],false);const refused=await W.search({legs:[[loaded[0]]],consent:state,evaluate:async path=>({...await evaluate(path),legs:[{routeKey:'road',depart:start,arrive:start+20*60000,signature:W.signature(rain)}]})});assert.equal(refused.best,null);assert.equal(refused.review.length,0,'declined changed conditions cannot reappear as repeated questions');
 const wrongWindow=await W.search({legs:[[loaded[0]]],consent:state,arrivals:[{start:start+h,end:start+2*h}],evaluate});assert.equal(wrongWindow.best,null,'actual arrival must fit destination window');
 let alive=true;assert.equal(await W.search({legs:[[loaded[0]]],consent:state,valid:()=>alive,evaluate:async path=>{alive=false;return evaluate(path);}}),null);
 // Cached answers must still let input/cancel timers run between hourly jobs.
 let responsive=true,cachedReads=0,timerRan=false;const cancelTimer=setTimeout(()=>{timerRan=true;responsive=false;},0);
 const interrupted=await W.readings({rows:Array.from({length:100},(_,i)=>({...loaded[0],depart:start+i*h})),consent:state,valid:()=>responsive,read:async()=>{cachedReads++;return clear;}});
 clearTimeout(cancelTimer);assert(timerRan,'cached hourly reads yield to input events');assert.equal(interrupted,null);assert(cachedReads<100,'cancellation stops queued hours');
 console.log('Hourly consent, grouped hazards, missing data, changed-condition screening, actual timing/arrival constraints, cost/time choice, destination waits and cancellation.');
})().catch(e=>{console.error(e);process.exitCode=1;});

// Every supported hazard obeys the user's exclusions; incomplete readings never auto-approve.
{
 const W=require('../assets/web/timewindows.js'),kinds=Object.fromEntries(['alert','tornado','tropical','flood','storm','ice','snow','rain','fog','wind','heat','cold','air'].map(k=>[k,true]));
 const complete=hazards=>({hazards,stats:{points:2,weather:2,errors:0}}),rules={enabled:true,ask:Object.keys(kinds)};
 assert(W.autoAllowed(complete([]),rules,kinds));
 for(const kind of Object.keys(kinds)){assert(!W.autoAllowed(complete([{kind}]),rules,kinds));assert(W.autoAllowed(complete([{kind}]),{enabled:true,ask:[]},kinds));}
 assert(!W.autoAllowed(complete([{kind:'unknown'}]),{enabled:true,ask:[]},kinds));
 for(const flag of ['errors','beyondWeather','beyondAir','aiPending']){const r=complete([]);r.stats[flag]=1;assert(!W.autoAllowed(r,rules,kinds));}
 for(const r of [null,{hazards:[]},Object.assign(complete([]),{error:'unavailable'}),{hazards:[],stats:{points:2,weather:1}},complete([{kind:'rain',aiPending:true}]),complete([{kind:'rain',areaUncertain:true}])])assert(!W.autoAllowed(r,{enabled:true,ask:[]},kinds));
 assert(!W.autoAllowed(complete([]),{enabled:false,ask:[]},kinds));
 assert(!W.autoAllowed(complete([{kind:'rain'},{kind:'storm'}]),{enabled:true,ask:['storm']},kinds));
}

{
 const path=[{depart:0},{depart:2*W.HOUR}],end=[null,{start:3*W.HOUR,end:4*W.HOUR}];
 assert(W.canFit([{depart:0,arrive:W.HOUR},{depart:2*W.HOUR,arrive:2.5*W.HOUR}],path,end),'early arrival can become valid after stops; do not prune');
 assert(!W.canFit([{depart:0,arrive:4*W.HOUR},{depart:4*W.HOUR,arrive:5*W.HOUR}],path,end),'cannot reach the selected next hour even without stops');
 assert(!W.canFit([{depart:0,arrive:W.HOUR},{depart:2*W.HOUR,arrive:5*W.HOUR}],path,end),'already misses arrival deadline before adding stops');
 assert(W.canFit([{depart:0,arrive:W.HOUR},{depart:2*W.HOUR,arrive:4*W.HOUR}],path,end),'inclusive arrival deadline');
}
