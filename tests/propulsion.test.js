const assert=require('node:assert/strict'),P=require('../assets/web/propulsion.js'),T=require('../assets/web/trip.js');
const close=(a,b,t=1e-6)=>assert(Math.abs(a-b)<t,`${a} != ${b}`);
const measured={profile:'tum-m3-lfp',capacity:55.4,dcKw:170},warm={profile:measured,soc:.2,target:.8,temperature:35,kw:150,basis:'dc_meter',ambient:()=>20};
assert(!P.config({}).measured);assert(!P.config({kind:'h2',profile:'tum-m3-lfp'}).measured);assert(P.config(measured).measured);
let r=P.charge(warm);assert(r.ok);assert(r.minutes>15&&r.minutes<40);close(r.storedKWh,55.4*.6);assert(r.billedKWh>r.storedKWh);
// Independent Python v3 reference, after the inlet-budget correction.
close(r.minutes,24.33893005277979,.0001);close(r.billedKWh,37.004743764291526,.00001);
close(P.drivePower(P.config(measured),100/1.609344,20,.25,60,[],0).power,13.85892764771278,1e-10);
let cold=P.charge({...warm,temperature:0});assert(cold.ok);assert(cold.minutes>r.minutes);assert(cold.flags.includes('charging_temperature_extrapolated'));
let hot=P.charge({...warm,temperature:45,kw:22});assert(hot.ok);assert(hot.billedKWh<=22*hot.minutes/60+1e-6,'cooling and HVAC share inlet budget');
let times=[];P.charge({...warm,ambient:t=>{times.push(t);return t>600?-10:20;}});assert(times.some(t=>t>600),'weather clock advances during charging');
assert.equal(P.charge({...warm,cap:.7}).reason,'target_above_cap');assert.equal(P.charge({...warm,timeout:1}).reason,'charge_timeout');assert.equal(P.charge({...warm,kw:0}).reason,'charger_power_insufficient');
const unknown={kind:'ev',capacity:60,dcKw:150},flags=[];const a=P.drivePower(P.config(unknown),60,20,.25,60,flags,0),b=P.drivePower(P.config(unknown),60,-10,.25,60,[],0);close(a.gpm,.25);assert(b.gpm>a.gpm);assert(flags.includes('vehicle_profile_estimated'));
const h=P.drivePower(P.config({kind:'h2'}),60,20,.012,60,[],0);close(h.gpm,.012);
const m=T.restoreModel({pts:[],cum:[],totalMi:240,durationSec:14400,legEnds:[120,240],cityGpm:.25,hwyGpm:.25,combGpm:.25,segs:[{from:0,to:240,t0:0,t1:14400,mph:60,gpm:.25}]});
const options=()=>({model:m,cands:[{id:'one',d:120,price:.4,kw:105,stationKw:150,detourMi:0,detourMin:0}],startGal:48,capGal:60,fillCap:48,bufferGal:5,arriveGal:5,step:.1,fuelKind:'ev',stopMinutes:5,propulsion:unknown,propulsionContext:{departAt:Date.UTC(2026,9,22),weather:[]}});
let o=options(),p=T.plan(o);assert(p.ok,JSON.stringify(p));assert(p.stops[0].propulsion.ok);assert(p.stops[0].cost>p.stops[0].buyGal*p.stops[0].c.price,'metered losses are billed');
let ledger=T.account(o.startGal,.2,[{stops:T.purchases(p),arriveGal:p.arriveGal}]);close(ledger.legs[0].spend,p.totals.cost);
const legCosts=T.legSummaries(o.model,p,o.startGal,.2,null,'ev');close(legCosts.reduce((n,l)=>n+l.cost,0),ledger.legs[0].cost);close(legCosts.reduce((n,l)=>n+l.chargingMin,0),p.stops.reduce((n,s)=>n+T.serviceMinutes(s,'ev'),0));
const hm=T.restoreModel({...m,totalMi:600,durationSec:36000,legEnds:[600],cityGpm:.018,hwyGpm:.015,combGpm:.015,segs:[{from:0,to:600,t0:0,t1:36000,mph:60,gpm:.015}]});
const ho={model:hm,cands:[220,440].map((d,i)=>({id:'h'+i,d,price:30,detourMi:2,detourMin:3})),startGal:4.48,capGal:5.6,bufferGal:.3,arriveGal:.3,step:.05,fuelKind:'h2',stopMinutes:3,propulsion:{kind:'h2',capacity:5.6},propulsionContext:{departAt:Date.UTC(2026,9,22),weather:[]}};
const hydrogen=T.plan(ho);assert(hydrogen.ok,JSON.stringify(hydrogen));assert(hydrogen.propulsion.flags.includes('hydrogen_speed_unvalidated'));hydrogen.stops.forEach(s=>close(T.serviceMinutes(s,'h2'),s.buyGal));close(T.account(ho.startGal,30,[{stops:T.purchases(hydrogen),arriveGal:hydrogen.arriveGal}]).legs[0].spend,hydrogen.totals.cost);
const first=JSON.stringify(p);assert.equal(JSON.stringify(T.plan(o)),first,'replanning does not apply weather twice');
let slow=options();slow.propulsionContext={...slow.propulsionContext,limits:[{from:0,to:240,limit:55}],offset:-5};let sp=T.plan(slow);assert(sp.ok);assert(slow.model.durationSec>o.model.durationSec);assert(slow.model.galTo(240)<o.model.galTo(240));
let urban=P.project(m,unknown,{startGal:60,limits:[{from:0,to:240,limit:20}],offset:0});assert(urban.model.segs.every(s=>s.mph<=20));
let faster=P.project(m,unknown,{startGal:60,limits:[{from:0,to:240,limit:60}],offset:10,allowAbove:true,speedCap:65});assert(faster.model.segs.every(s=>s.mph<=65));assert(faster.model.durationSec<m.durationSec,'explicit over-limit rule changes modeled time');
let highLimit=P.project(m,unknown,{startGal:60,limits:[{from:0,to:240,limit:70}],offset:10,allowAbove:true,speedCap:65});close(highLimit.model.durationSec,m.durationSec);
let perRoad=P.project(m,unknown,{startGal:60,limits:[{from:0,to:120,limit:60,road:'one'},{from:120,to:240,limit:60,road:'two'}],offset:0,roadOffsets:{one:-10}});
assert(perRoad.model.segs.filter(s=>s.to<=120).every(s=>s.mph<=50),'only the selected road slows down');assert(perRoad.model.segs.filter(s=>s.from>=120).every(s=>s.mph===60),'other roads keep their setting');
let cappedRoad=P.project(m,unknown,{startGal:60,limits:[{from:0,to:120,limit:60,road:'one'},{from:120,to:240,limit:60,road:'two'}],offset:0,roadOffsets:{one:15},allowAbove:true,speedCap:65});assert(cappedRoad.model.segs.filter(s=>s.to<=120).every(s=>s.mph<=65));
let illegalRoad=P.project(m,unknown,{startGal:60,limits:[{from:0,to:240,limit:60,road:'one'}],offset:0,roadOffsets:{one:15},allowAbove:false});assert(illegalRoad.model.segs.every(s=>s.mph<=60));
close(p.propulsion.chargingMinutes,p.stops.reduce((n,s)=>n+s.propulsion.minutes,0));assert(p.propulsion.stopMinutes>=p.propulsion.chargingMinutes,'setup and detours are separate from active charging');
const hp={...unknown,heatPump:true},weather=[{mi:0,hours:[[Date.UTC(2026,9,22),-10],[Date.UTC(2026,9,22,1),30],[Date.UTC(2026,9,22,2),30],[Date.UTC(2026,9,22,3),30]]}];
let dynamic=P.project(m,hp,{startGal:60,weather,departAt:Date.UTC(2026,9,22)}),noHeat=P.project(m,hp,{startGal:60,weather:[{mi:0,hours:weather[0].hours.map(x=>[x[0],20])}],departAt:Date.UTC(2026,9,22)});assert(dynamic.model.segs[0].gpm>noHeat.model.segs[0].gpm);assert(dynamic.model.segs[120].gpm<dynamic.model.segs[0].gpm);
let parked=P.project({...m,segs:[],totalMi:0},{...measured,initialTempC:40},{startGal:40,departAt:Date.UTC(2026,9,22),weather:[{mi:0,hours:Array.from({length:7},(_,i)=>[Date.UTC(2026,9,22,i),0])}],waitAt:{d:0,at:Date.UTC(2026,9,22,6)}});assert(parked.temperature<20&&parked.temperature>0,'a long dwell cools the pack, rather than resetting it instantly');
const start=Date.UTC(2026,9,22),soakHours=P.SOAK_HOURS,localWeather=[{mi:0,hours:Array.from({length:soakHours+1},(_,i)=>[start+i*3600000,0])},{mi:1,hours:Array.from({length:soakHours+1},(_,i)=>[start+i*3600000,i===soakHours?7:2])}];
const stationary={...m,segs:[],totalMi:0};
const ambientStart=P.project(stationary,{...measured,ambientStart:true,initialTempC:40},{startGal:40,departAt:start,weather:localWeather});
close(ambientStart.temperature,0);
const soaked=P.project({...stationary,totalMi:1,segs:[{from:0,to:1,t0:0,t1:60,mph:60,gpm:.25}]},{...measured,initialTempC:40},{startGal:40,departAt:start,weather:localWeather,waits:[{d:1,at:start+soakHours*3600000+60000}]});
close(soaked.temperature,7);
close(parked.stopMinutes,360);assert.equal(parked.chargingMinutes,0,'scheduled waiting is not active charging');
let missing=[];P.weather([],0,0,missing);assert(missing.includes('weather_missing'));
let future=[];P.weather([{mi:0,hours:[[1000,10],[3601000,20]]}],0,9000000,future);assert(future.includes('weather_outside_forecast'));
const timed=options(),tariff={currency:'USD',uom:'kwh',fee:.99,complete:true,zone:'UTC',blocks:[{rate:.1,start:0,end:60},{rate:.7,start:60,end:1440}]};
timed.cands=timed.cands.map(c=>({...c,tariffOffer:tariff,price:.1,sessionFee:.99}));const priced=T.plan(timed);assert(priced.ok,JSON.stringify(priced));assert.equal(priced.stops[0].c.price,.7,'arrival after the cheap window is repriced before returning a plan');close(priced.stops[0].propulsion.cost,priced.stops[0].propulsion.billedKWh*.7+.99);close(priced.totals.cost,priced.stops[0].propulsion.cost);
// Synthetic final-leg gap: an efficiency target must not become a physical battery limit.
const gapModel=T.restoreModel({pts:[],cum:[],totalMi:300,durationSec:18000,legEnds:[300],cityGpm:.25,hwyGpm:.25,combGpm:.25,segs:[{from:0,to:300,t0:0,t1:18000,mph:60,gpm:.25}]});
const gap=()=>({model:gapModel,cands:[{id:'last-priced',d:80,price:.4,priceKnown:true,kw:105,stationKw:150,detourMi:0,detourMin:0}],startGal:60,capGal:75,fillCap:60,bufferGal:10,arriveGal:10,step:.1,fuelKind:'ev',stopMinutes:5,requireKnownPrice:true,priceAgeHours:24,propulsion:{kind:'ev',capacity:75,dcKw:150},propulsionContext:{departAt:Date.UTC(2026,9,22),weather:[]}});
assert(!T.plan(gap()).ok,'explicit 80% mode remains a hard ceiling');
const expanded=T.plan({...gap(),fillCap:75,preferredFillCap:60});assert(expanded.ok,JSON.stringify(expanded));assert(expanded.higherChargeFallback);assert(expanded.stops.some(s=>s.departGal>60));assert(expanded.stops.every(s=>s.departGal<=75+1e-6));assert(expanded.arriveGal>=10-1e-6);assert(expanded.propulsion.chargingMinutes>0,'higher charge retains thermal/taper timing');
const feasible=options(),preferred=T.plan({...feasible,fillCap:60,preferredFillCap:48});assert(preferred.ok);assert(!preferred.higherChargeFallback);assert(preferred.stops.every(s=>s.departGal<=48+1e-6),'keep the efficient target when it already works');
const unknownGap=gap();unknownGap.cands[0].priceKnown=false;assert(!T.plan({...unknownGap,fillCap:75,preferredFillCap:60}).ok,'higher charging never enables unknown prices');
assert(!T.plan({...gap(),startGal:5,fillCap:75,preferredFillCap:60}).ok,'cannot fix an unreachable first charger by increasing a later target');
console.log('Propulsion: weather, billing, arrival tariffs, preferred versus strict charge targets, reserves, repeat planning and legal caps passed');
{// 0.0.413: per-mile energy scales by power/speed. Ratios against the DOE 2013 Leaf steady-state dyno sheet (AC Wh/mi
 // 50 mph 236.0, 60 285.4, 70 343.8, 80 397.8): the old formula gave ×1.82 for 60→80 and ×0.27 for 65→30.
 const ev=P.config({kind:'ev'}),g=(mph,base)=>P.drivePower(ev,mph,20,.25,base,[],0).gpm/.25;
 // 0.0.416: the default (untested) curve is the cautious 80th-percentile one: at least the dyno's speed penalty, far from the old ×1.82
 assert(g(80,60)>=397.8/285.4-.01&&g(80,60)<1.6,'60→80 mph '+g(80,60));assert(g(60,70)<=285.4/343.8+.01&&g(60,70)>.7,'70→60 mph '+g(60,70));
 assert(Math.abs(g(65,65)-1)<1e-9,'baseline unchanged');assert(g(30,65)>.5&&g(30,65)<.65,'slow traffic keeps about half the per-mile energy '+g(30,65));
 console.log('EV speed shape follows per-mile energy (Leaf dyno ratios)');}
{// 0.0.416: EPA label efficiencies hold at a steady ~65 mph for the median car (Nyland 90/120 km/h vs label: 0.848 and
 // 1.187 median, p90 0.997 and 1.34, wall basis); the planner uses the cautious 61 mph (20th percentile). Typed
 // efficiencies stay at the route speed. Per-car EPA coast-down road load shapes the curve.
 const leaf={a:31.911,b:.11588,c:.0177568},flags=[];
 const ev=P.config({kind:'ev',labelAnchor:true,roadLoad:leaf}),at=(mph,base)=>P.drivePower(ev,mph,20,.25,base,flags,0).gpm/.25;
 assert.equal(P.LABEL_MPH,61);assert(Math.abs(at(61,61)-1)<1e-9,'the label holds at the cautious 61 mph');
 assert(at(70,70)>1.12&&at(70,70)<1.25,'a 70 mph road uses more than the label '+at(70,70));
 assert(at(75,75)>1.187&&at(75,75)<1.36,'75 mph: above the Nyland median, near its 90th percentile '+at(75,75));
 assert(at(56,56)>.848&&at(56,56)<1,'56 mph: above the Nyland 90 km/h median '+at(56,56));
 assert(Math.abs(at(20,20)-1)<1e-9,'city stretches stay at the city rating');
 assert(!flags.includes('road_load_typical'),'own coast-down used');
 const typed=P.config({kind:'ev',labelAnchor:false,roadLoad:leaf});assert(Math.abs(P.drivePower(typed,70,20,.25,70,[],0).gpm/.25-1)<1e-9,'typed efficiencies stay at the route speed');
 const r=(mph,base)=>P.drivePower(typed,mph,20,.25,base,[],0).gpm/.25;
 assert(Math.abs(r(80,60)-397.8/285.4)<.08,'Leaf coast-down 60→80 '+r(80,60));assert(r(30,65)>.5&&r(30,65)<.62,'Leaf coast-down 65→30 '+r(30,65));
 const f2=[];P.drivePower(P.config({kind:'ev'}),70,20,.25,70,f2,0);assert(f2.includes('road_load_typical'),'no coast-down: typical EV curve, flagged');
 const steep=(m,b)=>P.drivePower(P.config({kind:'ev'}),m,20,.25,b,[],0).gpm/.25;assert(steep(75,61)>at(75,61),'the untested fallback is a speed-sensitive (80th percentile) curve, steeper than the Leaf');
 const C=require('../assets/web/chargecurve.js'),est=C.selected({addMode:'evNone',make:'Nobody',model:'Nothing',dcKw:100});assert(est.estimated&&est.peak===85&&/15% slower/.test(est.label),'estimated charging is 15% slower '+JSON.stringify(est));
 const pk=(y,mk,m)=>C.packs({year:y,make:mk,model:m},true).map(x=>x.id);assert.deepEqual(pk(2020,'Tesla','Model 3 Long Range'),[],'a 2020 Model 3 Long Range has no established curve: not in the menu');assert.deepEqual(pk(2020,'Tesla','Model 3 Standard Range Plus'),['m3-sr-2020']);assert.deepEqual(pk(2021,'Tesla','Model 3 Performance AWD'),[]);assert.deepEqual(pk(2022,'Tesla','Model S'),['ms-refresh']);assert.deepEqual(pk(2022,'Tesla','Model S Plaid (19 inch wheels)'),['ms-plaid']);assert.deepEqual(pk(2022,'Chevrolet','Bolt EUV'),[]);assert.deepEqual(pk(2020,'Tesla',''),['m3-sr-2020'],'make level still lists the year');
 const R=require('../assets/web/roadload.js'),m3=R.forCar({year:2021,make:'Tesla',model:'Model 3 Long Range AWD'});
 assert(m3&&m3.a===34.98&&m3.c===.0149,'2021 Model 3 LR AWD EPA coast-down');
 assert.equal(R.of({year:2022,make:'Chevrolet',model:'Bolt EV'}).coef.a,30.51);
 for(const y of [2022,2025]){const s=R.forCar({year:y,make:'Tesla',model:'Model S'}),x=R.forCar({year:y,make:'Tesla',model:'Model X'}),pl=R.forCar({year:y,make:'Tesla',model:y===2022?'Model S Plaid (19 inch wheels)':'Model S Plaid (19in wheels)'});assert(s&&s.a<30&&x&&pl&&s.a!==pl.a,'plain Model S/X use the Long Range test car, not the Plaid ones ('+y+'): '+JSON.stringify([s,x,pl]));}
 assert.equal(R.forCar({year:2025,make:'Tesla',model:'Model S'}).a,26.37);assert.equal(R.forCar({year:2022,make:'Toyota',model:'Corolla'}),null,'not an EV');
 assert(R.any({year:2022},r=>!!r.coef)&&R.any({year:2022,make:'Tesla'},r=>!!r.coef));
 console.log('EV label at 65 mph, EPA road-load speed curve, typical fallback');}
