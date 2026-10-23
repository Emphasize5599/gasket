const assert=require('node:assert/strict'),Auto=require('../assets/web/autotrip'),T=require('../assets/web/trip');
(async()=>{
 let calls=0;const config={floor:15,buffer:40,detour:7.5,detours:[1,5,10,30],width:3,valid:()=>true,evaluate:async x=>{calls++;assert(x.buffer>=15);return {cost:50-x.detour/2+x.buffer/10,minutes:100+x.detour-x.buffer/10};}};
 const cheap=await Auto.search({...config,priority:'cost'}),fast=await Auto.search({...config,priority:'time'});assert.equal(cheap.detour,30);assert.equal(cheap.buffer,15);assert.equal(fast.detour,1);assert(fast.buffer>15);assert(calls<100);
 let alive=true;assert.equal(await Auto.search({...config,valid:()=>alive,evaluate:async()=>{alive=false;return {cost:1,minutes:1};}}),null,'cancelled results cannot win');
 const raw={distanceMeters:100*1609.344,duration:'6000s',polyline:{encodedPolyline:T.encodePolyline([{lat:35,lng:-92},{lat:35,lng:-90}])},legs:[]},model=T.buildRoute(raw,{city:10,hwy:10,comb:10});
 const opts={model,capGal:10,startGal:5,bufferGal:.5,arriveGal:.5,step:.1,fuelKind:'gas',stopMinutes:3,maxDetourMin:30,cands:[{id:'cheap',d:40,price:2,detourMin:20},{id:'fast',d:40,price:5,detourMin:1}]};
 const cost=T.plan({...opts}),time=T.plan({...opts,objective:'time'});assert(cost.ok&&time.ok);assert.equal(cost.stops[0].c.id,'cheap');assert.equal(time.stops[0].c.id,'fast','time objective chooses minutes, not dollars');assert(time.totals.cost>cost.totals.cost);
 console.log('Automatic cost/time ranking, buffer/detour adjustment, floor, cancellation and actual planner time objective.');
})().catch(e=>{console.error(e);process.exitCode=1;});
