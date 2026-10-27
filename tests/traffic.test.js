const assert=require('node:assert/strict'),T=require('../assets/web/trip'),Traffic=require('../assets/web/traffic'),Speed=require('../assets/web/speed'),P=require('../assets/web/propulsion');
const close=(a,b,t=1e-4)=>assert(Math.abs(a-b)<t,`${a} != ${b}`);
assert.deepEqual(Traffic.decode('BFoz5xJ67i1B1B7PzIhaxL7Y'),[{lat:50.10228,lng:8.69821},{lat:50.10201,lng:8.69567},{lat:50.10063,lng:8.69150},{lat:50.09878,lng:8.68752}]);
for(const bad of ['', 'B', 'BF!', 'CFAA'])assert.throws(()=>Traffic.decode(bad));
function encode(pts){const a='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';let out='BF',lat=0,lng=0;function num(v){v=v<0?-v*2-1:v*2;while(v>=32){out+=a[(v%32)+32];v=Math.floor(v/32);}out+=a[v];}for(const p of pts){let x=Math.round(p.lat*1e5),y=Math.round(p.lng*1e5);num(x-lat);num(y-lng);lat=x;lng=y;}return out;}
const pts=[{lat:0,lng:0},{lat:0,lng:.1},{lat:0,lng:.2}],mi=T.hav(pts[0],pts[2]),raw={distanceMeters:mi*1609.344,duration:(mi/40*3600)+'s',polyline:{encodedPolyline:T.encodePolyline(pts)},legs:[]},base=T.buildRoute(raw,{city:30,hwy:40,comb:35});
function answer(m,speed=20){const points=[m.pointAt(0),m.pointAt(m.totalMi/2),m.pointAt(m.totalMi)],length=m.totalMi*1609.344;return {routes:[{sections:[{polyline:encode(points),summary:{length},spans:[0,1].map(i=>({offset:i,length:length/2,duration:m.totalMi/2/speed*3600,dynamicSpeedInfo:{trafficSpeed:speed/2.2369362921,baseSpeed:40/2.2369362921}}))}]}]};}
const profile=Traffic.read(answer(base),base),m=Traffic.overlay(base,profile);close(m.durationSec,mi/20*3600);close(m.galTo(mi),mi/30);assert(m.traffic);close(base.durationSec,mi/40*3600);assert(!base.traffic,'base is not mutated');
const query=Traffic.query(base,Date.UTC(2026,10,1,12),[{d:mi/2,seconds:300}],{tolls:true});assert(query.includes('departureTime=2026-11-01T12%3A00%3A00.000Z'));assert(query.includes('!stopDuration=300'));assert(!query.includes('departureTime=any'));assert(query.includes('avoid%5Bfeatures%5D=tollRoad'));assert(/^[A-Za-z0-9=&%,._!\-]+$/.test(query),'query fits native bridge allowlist');assert.throws(()=>Traffic.query(base,0,[{d:1,seconds:50000}]));
const wrong=answer(base);wrong.routes[0].sections[0].polyline=encode(pts.map(p=>({lat:1,lng:p.lng})));assert.throws(()=>Traffic.read(wrong,base),/matched only 0%/);
const missing=answer(base);delete missing.routes[0].sections[0].spans[0].dynamicSpeedInfo;const partialSpeed=Traffic.read(missing,base);assert.equal(partialSpeed.match.speedsMissing,1);close(partialSpeed.coverage,.5);assert.equal(partialSpeed.rows[0].forecast,false);assert(partialSpeed.rows[1].trafficMph>0);
const noSpeeds=answer(base);noSpeeds.routes[0].sections[0].spans.forEach(s=>delete s.dynamicSpeedInfo);assert.throws(()=>Traffic.read(noSpeeds,base),e=>e.details.speedsMissing===2&&e.details.coverage===0);
const zeroSpan=answer(base);zeroSpan.routes[0].sections[0].spans[0].duration=0;const zeroProfile=Traffic.read(zeroSpan,base);assert.equal(zeroProfile.match.speedsMissing,1);assert.equal(zeroProfile.rows[0].forecast,false);assert(Number.isFinite(zeroProfile.seconds));
const malformed=answer(base);malformed.routes[0].sections[0].spans[1].offset=500;assert.throws(()=>Traffic.read(malformed,base));
const secs=[{from:0,to:mi,limit:65,traffic:profile.rows}],rates=T.speedRates(secs,[10],v=>v,25,90);assert(rates.every(r=>r.rate===0),'requesting faster cannot bypass congestion');assert.equal(secs[0].limit,65,'posted speed limit is not changed');assert.equal(Speed.leg([{mi,limit:65,trafficMph:20,cruise:true}],10,v=>v,4,25,90).minSaved,0);

// Partial matching (0.0.280 log: every long-trip forecast was thrown away at HERE's second point, 239 ft off at the start).
{const line=[0,.1,.2,.3,.4].map(lng=>({lat:0,lng})),lm=T.hav(line[0],line[4]),lraw={distanceMeters:lm*1609.344,duration:(lm/40*3600)+'s',polyline:{encodedPolyline:T.encodePolyline(line)},legs:[]},long=T.buildRoute(lraw,{city:30,hwy:40,comb:35});
 const ft=f=>f/5280/69.05;   // feet as degrees of latitude
 const reply=(points,lengths,speed=20)=>({routes:[{sections:[{polyline:encode(points),summary:{length:lengths.reduce((a,b)=>a+b,0)*1609.344},spans:lengths.map((mi,i)=>({offset:i,length:mi*1609.344,duration:mi/speed*3600,dynamicSpeedInfo:{trafficSpeed:speed/2.2369362921,baseSpeed:40/2.2369362921}}))}]}]});
 const seg=(a,b)=>T.hav(a,b);
 // HERE leaves the origin by a street 239 ft over for the first stretch, then follows the route
 const off={lat:ft(239),lng:.05},startPts=[line[0],off,line[1],line[2],line[3],line[4]],start=Traffic.read(reply(startPts,startPts.slice(1).map((p,i)=>seg(startPts[i],p))),long);
 assert(start.coverage>.7&&start.coverage<1,'start mismatch keeps the rest: '+start.coverage);assert.equal(start.rows[0].forecast,false,'first stretch uses the route estimate');assert(start.rows.slice(1).every(r=>r.forecast!==false));
 close(start.rows[0].to,seg(line[0],line[1]),.01);close(start.seconds,seg(line[0],line[1])/40*3600+(lm-seg(line[0],line[1]))/20*3600,2);
 const ov=Traffic.overlay(long,start);close(ov.durationSec,start.seconds,1);assert.equal(ov.segs[0].trafficMph,null);assert(Math.abs(ov.segs.at(-1).trafficMph-20)<.01);
 // a detour in the middle: only that stretch falls back
 const det={lat:ft(900),lng:.25},midPts=[line[0],line[1],line[2],det,line[3],line[4]],mid=Traffic.read(reply(midPts,midPts.slice(1).map((p,i)=>seg(midPts[i],p))),long);
 assert.deepEqual(mid.rows.map(r=>r.forecast!==false),[true,true,false,true]);assert.equal(mid.match.stretchesOff,1);assert(mid.match.maxOffsetFeet>800);
 // a shortcut between two matching points (its length is far shorter than the road it skips) is never used
 const sc=Traffic.read(reply(line,[seg(line[0],line[1]),seg(line[1],line[2])*.5,seg(line[2],line[3]),seg(line[3],line[4])]),long);assert.deepEqual(sc.rows.map(r=>r.forecast!==false),[true,false,true,true]);assert.equal(sc.match.spansSkipped,1);
 // mostly other roads: rejected, with the numbers in the log details
 const far=[line[0],{lat:ft(2000),lng:.1},{lat:ft(2000),lng:.2},{lat:ft(2000),lng:.3},line[3],line[4]];assert.throws(()=>Traffic.read(reply(far,far.slice(1).map((p,i)=>seg(far[i],p))),long),e=>/matched only \d+%/.test(e.message)&&e.details.coverage<.5&&e.details.maxOffsetFeet>1500);
 // whole forecast reports coverage across legs
 (async()=>{const svc=Traffic.create({fetch:async()=>reply(startPts,startPts.slice(1).map((p,i)=>seg(startPts[i],p)))});const f=await svc.forecast(long,Date.UTC(2026,10,1,12));assert(f.coverage>.7&&f.coverage<1);assert.equal(f.legs[0].match.stretchesOff,1);})().catch(e=>{console.error(e);process.exitCode=1;});
}
assert.deepEqual(Traffic.times(0,7200000,60),[0,3600000,7200000]);assert.throws(()=>Traffic.times(0,49*3600000,60));assert.throws(()=>Traffic.times(0,25*3600000,60));assert.throws(()=>Traffic.times(0,3600000,0));
(async()=>{
 const cache=new Map(),queries=[];let target=base;
 const service=Traffic.create({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v),fetch:async q=>{queries.push(q);return {body:JSON.stringify(answer(target))};}});
 const depart=Date.UTC(2026,10,1,12),first=await service.forecast(base,depart);assert.equal(queries.length,1);const warm=await service.forecast(base,depart);assert.equal(queries.length,1);assert(warm.cached);assert.equal(warm.at,first.at,'cache reads retain source age');close(first.seconds,mi/20*3600);
 let alive=false;await assert.rejects(service.forecast(base,depart+3600000,{valid:()=>alive}),/cancelled/);assert.equal(queries.length,1);
 let rejectedCalls=0;const unavailable=Traffic.create({fetch:async()=>{rejectedCalls++;return wrong;}});await assert.rejects(unavailable.forecast(base,depart),/matched only/);await assert.rejects(unavailable.forecast(base,depart),e=>e.cachedFailure&&e.details.maxOffsetFeet>100&&e.details.coverage===0);assert.equal(rejectedCalls,1,'rejected geometry does not repeatedly spend HERE calls');unavailable.retryFailures();await assert.rejects(unavailable.forecast(base,depart));assert.equal(rejectedCalls,2,'explicit retry can ask again');
 const outback=T.restoreModel(Object.assign({},base,{pts:[...pts,...pts.slice(0,-1).reverse()],cum:[0,mi/2,mi,mi*1.5,mi*2],segs:[{from:0,to:mi*2,t0:0,t1:mi*2/40*3600,gpm:1/35,mph:40}],totalMi:mi*2,legEnds:[mi,mi*2],durationSec:mi*2/40*3600}));
 const timed=[];const multi=Traffic.create({fetch:async q=>{const params=new URLSearchParams(q),origin=params.get('origin').split(',').map(Number),dest=params.get('destination').split(',').map(Number);timed.push(+new Date(params.get('departureTime')));const leg=Traffic.slice(outback,origin[1]<dest[1]?0:mi,origin[1]<dest[1]?mi:mi*2);return answer(leg);}});
 const stop=900,back=await multi.forecast(outback,depart,{stops:[{d:mi,seconds:stop}]});close(timed[1],Math.ceil((depart+(mi/20*3600+stop)*1000)/60000)*60000,3);close(back.arrival,depart+(mi*2/20*3600+stop)*1000,3);assert.equal(back.rows.length,4);assert(back.rows[2].from>=mi-.001,'return leg offsets stay on return leg');
 const immediate=await multi.forecast(outback,depart);close(immediate.arrival,depart+mi*2/20*3600000,3);assert.equal(immediate.legs.length,2,'immediate return considers both directions');await assert.rejects(multi.forecast(outback,depart,{waitAt:{d:mi,at:depart+60000},strictWait:true}),/before you reach/);
 const projected=P.project(m,{kind:'ev',capacity:100},{startGal:100,limits:[{from:0,to:mi,limit:65}],offset:15,allowAbove:true});assert(projected.model.segs.every(s=>s.mph<=20.001),'EV offsets cannot override forecast congestion');
 console.log('Forecast geometry validation (partial matching: mismatched start, middle detour, shortcut, low coverage), flexible polyline, cache reuse, cancellation, posted-limit separation, congestion caps, departure bounds and stop-aware return timing.');
})().catch(e=>{console.error(e);process.exitCode=1;});
