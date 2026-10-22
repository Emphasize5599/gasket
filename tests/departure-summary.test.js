const assert=require('node:assert/strict'),T=require('../assets/web/trip.js');
const m=T.restoreModel({pts:[],cum:[],totalMi:300,durationSec:30000,legEnds:[100,200,300],cityGpm:.1,hwyGpm:.1,combGpm:.1,segs:[{from:0,to:300,gpm:.1,t0:0,t1:30000}]});
const p={stops:[{c:{d:50,price:4,kw:50},arriveGal:25,departGal:35,buyGal:10},{c:{d:250,price:3,kw:50},arriveGal:35,departGal:45,buyGal:10}],destinationCharges:[{d:200,index:1,arriveGal:20,buyGal:20,cost:2,minutes:60}],arriveGal:40};
for(const top of [null,{c:{d:280,price:2,kw:50,detourMi:.2},arriveGal:42,buyGal:5,endGal:45}]){
 const rows=T.legSummaries(m,p,30,2,top),purchases=T.purchases(p);if(top)purchases.push({arriveGal:top.arriveGal,buyGal:top.buyGal,price:top.c.price});
 const whole=T.account(30,2,[{stops:purchases,arriveGal:top?top.endGal:p.arriveGal}]).legs[0];
 for(const k of ['burnGal','cost','bought','spend'])assert(Math.abs(rows.reduce((s,r)=>s+r[k],0)-whole[k])<1e-8,k+' reconciles to the whole trip');
 assert.deepEqual(rows.map(r=>r.miles),[100,100,100]);assert.equal(rows.reduce((s,r)=>s+r.drivingSec,0),30000);
 assert.deepEqual(rows.map(r=>r.stops),[1,0,top?2:1]);assert.deepEqual(rows.map(r=>r.chargingMin),[12,60,top?18:12]);
 assert.equal(rows[1].spend,2,'destination charging is charged to the arriving leg');assert(rows.every(r=>r.cost>=0&&r.burnGal>=0));
}
// No stops, an exact-boundary stop, and differing road energy rates.
const empty=T.legSummaries(m,{stops:[],arriveGal:0},30,2);assert.deepEqual(empty.map(r=>r.cost),[20,20,20]);
const edge=T.legSummaries(m,{stops:[{c:{d:100,price:4},arriveGal:20,buyGal:10}],arriveGal:10},30,2);assert.deepEqual(edge.map(r=>r.stops),[1,0,0]);
for(const kind of ['gas','diesel','h2']){
 const top={c:{d:280,price:2,detourMi:.2},arriveGal:42,buyGal:5,endGal:45};
 const fuelPlan={...p,destinationCharges:[],arriveGal:20},rows=T.legSummaries(m,fuelPlan,30,2,top,kind),rate=kind==='h2'?1:8;
 assert.equal(rows.reduce((n,r)=>n+r.refuelingMin,0),25/rate,'purchase and top-up amounts, not tank capacity');
 assert.equal(rows.reduce((n,r)=>n+r.chargingMin,0),0,'refueling is not labeled charging');
 assert.deepEqual(rows.map(r=>r.refuelingMin),[10/rate,0,15/rate]);
 assert.equal(T.serviceMinutes({buyGal:0,c:{}},kind),0);assert.equal(T.serviceMinutes({buyGal:-1,c:{}},kind),0);
 assert.equal(T.stopDelay({fuelKind:kind,stopMinutes:3},{buyGal:8,c:{detourMin:2}}),5+8/rate,'setup, dispensing and detour each counted once');
}
assert.equal(T.serviceMinutes({buyGal:10,c:{kw:50}},'ev'),12,'EV average-kW estimate unchanged');
// The route comparison uses the same complete stop durations as arrival estimates.
{
 const fs=require('node:fs'),vm=require('node:vm'),src=fs.readFileSync('assets/web/tripui.js','utf8'),ctx={T};
 vm.runInNewContext(src.match(/  function routeMin\(e\) \{[^\n]+/)[0],ctx);
 assert.equal(ctx.routeMin({model:{durationSec:3600},res:{opts:{fuelKind:'gas',stopMinutes:3},plan:{ok:true,stops:[{buyGal:16,c:{detourMin:2}}]}}}),67);
}
console.log('Per-leg distance, duration, stops, charging, destination purchases, top-ups and weighted fuel costs reconcile to whole-trip totals');
