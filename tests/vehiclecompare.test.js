const assert=require('node:assert/strict'),T=require('../assets/web/trip.js'),V=require('../assets/web/vehiclecompare.js');
const model=T.restoreModel({pts:[],cum:[],totalMi:200,durationSec:12000,legEnds:[100,200],cityGpm:.1,hwyGpm:.1,combGpm:.1,segs:[{from:0,to:200,gpm:.1,t0:0,t1:12000}]});
function session(startGal=30){return {id:'a',kind:'gas',model,trip:{},tolls:[{has:false},{has:false}],result:{opts:{model,stopMinutes:3,fuelKind:'gas'},startGal,startPrice:4,plan:{ok:true,stops:[],arriveGal:startGal-20}}};}
let a=session();assert.equal(V.metrics(a).cost,80);assert.equal(V.metrics(a).spend,0,'full tank is not a free trip');assert.equal(V.metrics(session(25)).cost,80,'same consumption is fair across starting fuel amounts');
assert.equal(V.metrics(a,0).cost+V.metrics(a,1).cost,V.metrics(a).cost);assert.equal(V.metrics(a,0).minutes+V.metrics(a,1).minutes,V.metrics(a).minutes);
a.speedTiming=[{from:100,to:200,limit:60,offset:10,lo:25,hi:90}];assert.equal(V.metrics(a,0).minutes,100);assert(Math.abs(V.metrics(a,1).minutes-(100-100*(1/60-1/70)*60))<1e-8,'speed savings stay on the road/leg actually adjusted');assert(Math.abs(V.metrics(a,0).minutes+V.metrics(a,1).minutes-V.metrics(a).minutes)<1e-8);delete a.speedTiming;
a.tolls[0]={has:true,cost:null};assert.equal(V.metrics(a).cost,null,'unknown toll is not zero');a.tolls[0]={has:true,cost:5};assert.equal(V.metrics(a).cost,85);
a=session();a.result.plan.stops=[{c:{d:100,price:3,detourMin:4,detourMi:0},arriveGal:20,buyGal:8}];a.result.plan.arriveGal=18;
assert.equal(V.metrics(a).minutes,200+4+3+1,'driving, detour, setup, actual fuel amount');assert.equal(V.metrics(a).stops,1);assert.equal(V.metrics(a,0).stops,1);
a.result.plan.stops[0].c.price=0;assert.equal(V.metrics(a).cost,null,'zero without a verified free flag is missing');a.kind='ev';a.result.plan.stops[0].c.freeCharging=true;assert.notEqual(V.metrics(a).cost,null,'verified free electricity is valid');
a.startEstimated=true;assert.equal(V.metrics(a).estimated,true);a.needsReview=true;assert.equal(V.metrics(a).ready,false);
a=session();const adapted=V.metrics(a,null,{price:(s,i,q)=>({...q,energy:10,tolls:2,fees:1}),time:()=>15});assert.equal(adapted.cost,13);assert.equal(adapted.minutes,15);
const rows=[{id:'unknown',order:0,metrics:{ready:true,cost:null,minutes:10}},{id:'b',order:1,metrics:{ready:true,cost:20,minutes:40}},{id:'a',order:2,metrics:{ready:true,cost:10,minutes:50}},{id:'pending',order:3,metrics:{ready:false,cost:1,minutes:1}}];
assert.deepEqual(V.sorted(rows,'cost').map(r=>r.id),['a','b','unknown','pending']);assert.equal(V.sorted(rows,'time')[0].id,'unknown');
a.trip.routeChoices={secret:{consider:true}};const saved=V.portable(a);assert.equal(saved.trip.routeChoices,undefined);assert.equal(saved.needsReview,true);assert.equal(saved.result,undefined);assert.equal(saved.reviewedAt,undefined);
assert.equal(V.profile({id:'a',tank:10,nick:'A',pic:'a'}),V.profile({id:'a',tank:10,nick:'B',pic:'b'}));assert.notEqual(V.profile({tank:10}),V.profile({tank:20}));
const ev=session();ev.kind='ev';ev.trip={returnTrip:true,backAuto:false,backAt:new Date(3*3600000).toISOString()};ev.result.opts.rewardDepartAt=1;ev.result.plan.destinationCharges=[{d:100,index:0,arriveGal:20,buyGal:5,cost:2,minutes:60}];ev.result.plan.arriveGal=15;
assert.equal(V.metrics(ev).overlap,60,'scheduled dwell absorbs destination charging, not road charging');assert.equal(V.metrics(ev).minutes,200);
console.log('Vehicle comparison: fair consumed-energy costs, missing/free rates, leg reconciliation, times, adapters, consent and profiles passed');
