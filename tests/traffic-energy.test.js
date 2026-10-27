// Pure traffic-energy modules (docs/TRAFFIC_ENERGY_HANDOFF.md sections 4, 5, 7, 10): category priors, section timing,
// D2 guard rails, calibration recovering known ratios and rejecting bad fits, EV auxiliary load per hour with warm-up as
// a state, idle fuel table rows reproduced by the formula, measured rows inside their ranges, start-stop and hybrids.
const assert=require('node:assert/strict'),M=require('../assets/web/trafficmodel'),A=require('../assets/web/auxload'),I=require('../assets/web/idlefuel');
const near=(a,b,t,m)=>assert(Math.abs(a-b)<=t,(m||'')+` ${a} vs ${b}`);
// ---- categories -> timing ----
for(const c of ['NORMAL','SLOW','TRAFFIC_JAM','TRAFFIC_JAM_HEAVY'])for(const k of ['freeway','arterial']){const p=M.prior(c,k);assert(p.r>=p.lo&&p.r<=p.hi,c+k+' prior inside its range');}
assert(M.prior('SLOW','freeway').r<M.prior('SLOW','arterial').r,'freeways take the lower half');assert.equal(M.prior(null).r,1,'uncoloured = free flow (D2)');assert.equal(M.prior('bogus').cat,'NONE');
const green=M.section({len:10,vff:65,cat:'NORMAL'}),dark=M.section({len:2,vff:65,cat:'TRAFFIC_JAM_HEAVY'}),none=M.section({len:10,vff:65});
near(none.seconds,10/65*3600,1e-6);assert.equal(green.tStopped,0);assert(dark.tStopped>0&&dark.vMoving<=65+1e-9&&dark.nStops>9,'dark red: stopped share, moving speed under free flow, stops');
near(dark.seconds,2/(.18*65)*3600,1e-6);const art=M.section({len:1,vff:35,cat:'TRAFFIC_JAM_HEAVY',cls:'arterial'});near(art.nStops,2*1.609344,1e-9);
assert(M.section({len:1,vff:30,cat:'TRAFFIC_JAM_HEAVY'},{['TRAFFIC_JAM_HEAVY|freeway']:{r:.9}}).s<=.1+1e-9,'stopped share shrinks so moving speed never beats free flow');
assert.equal(M.section({len:0,vff:60,cat:'SLOW'}).seconds,0,'zero distance is fine');
// D2 guard rails
assert.equal(M.coverage([{len:5},{len:5,cat:'SLOW'}],true).uncolouredShare,.5);assert.equal(M.coverage([{len:5},{len:5}],true).ok,false,'no colours anywhere = unavailable, not free flow');assert.equal(M.coverage([{len:5,cat:'SLOW'}],false).ok,false,'failed read = unavailable');
// ---- calibration recovers known ratios ----
const truth={'SLOW|freeway':.5,'TRAFFIC_JAM|freeway':.3,'SLOW|arterial':.7},obs=[];let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
for(let i=0;i<30;i++){const sec=[{len:5+rnd()*10,vff:65,cat:'NORMAL'},{len:rnd()*4,vff:65,cat:'SLOW'},{len:rnd()*3,vff:65,cat:'TRAFFIC_JAM'},{len:rnd()*3,vff:35,cat:'SLOW',cls:'arterial'}];
 const tFree=sec.reduce((n,s)=>n+s.len/s.vff*3600,0);let tTraffic=0;sec.forEach(s=>{const r=truth[M.key(s.cat,s.cls)]||1;tTraffic+=s.len/(r*s.vff)*3600;});obs.push({sections:sec,tFree,tTraffic,coverage:.9,matched:true});}
const fit=M.calibrate(obs,{lambda:1e-4});for(const k of Object.keys(truth))near(fit.table[k].r,truth[k],.02,'recovered '+k);
assert.equal(fit.used,30);
// rejections
const bad=M.calibrate([{sections:obs[0].sections,tFree:100,tTraffic:0,coverage:.9},{...obs[1],coverage:.3},{...obs[2],matched:false},{...obs[3],tTraffic:obs[3].tFree*.5},{...obs[4],tTraffic:obs[4].tFree*500}]);
assert.equal(bad.used,0);assert.deepEqual(bad.rejected.map(r=>r.reason.split(' ')[0]),['Missing','Traffic','Google','Needs','Needs']);
// running posterior, persisted
const cal=M.Calibration();cal.add(fit,1);cal.add(fit,2);const saved=JSON.parse(JSON.stringify(cal.save())),back=M.Calibration(saved);near(back.table()['SLOW|freeway'].r,fit.table['SLOW|freeway'].r,1e-9);assert.equal(back.table()['SLOW|freeway'].at,2);
// restart energy: EV regenerates, gas doesn't
assert(M.restart('gas',1600,30).litres>M.restart('hybrid',1600,30).litres);assert(M.restart('ev',1800,30).kWh>0&&M.restart('ev',1800,30).kWh<.05);
// ---- EV auxiliary load (D3) ----
let st=A.start();const mild=A.energy(st,3600,20,{heatPump:true});near(mild.kWh,.25,1e-9,'mild = 12 V / blower only');
const cold=A.energy(A.start(),3600,-8.5,{heatPump:false});assert(cold.kWh>2.6&&cold.kWh<2.6+4,'resistive cold settled + one warm-up');
assert(A.energy(A.start(),3600,-8.5,{heatPump:true}).kWh<cold.kWh,'heat pump uses less');assert(A.energy(A.start(),3600,-8.5,{}).kWh===cold.kWh,'unknown -> resistive column');
// warm-up is a state: once per cold start, not per section; a long park re-arms it; preconditioning removes it
let s1=A.start(),total=0;for(let i=0;i<6;i++){const e=A.energy(s1,600,-8.5,{});total+=e.kWh;s1=e.state;}near(total,cold.kWh,1e-9,'six 10-minute sections = one hour');
const parked=A.park(s1,1800),again=A.energy(parked,600,-8.5,{});assert(again.kWh>A.energy(s1,600,-8.5,{}).kWh,'long park re-arms warm-up');
assert.equal(A.energy(A.park(s1,300),600,-8.5,{}).kWh,A.energy(s1,600,-8.5,{}).kWh,'short stop keeps the cabin warm');
near(A.energy(A.start({preconditioned:true}),3600,-8.5,{}).kWh,A.power(-8.5,{}),1e-9,'preconditioned: no warm-up');
// EV standstill energy = P_aux × t; no divide by zero
near(A.energy(A.start({preconditioned:true}),1800,35,{}).kWh,A.power(35,{})/2,1e-9);assert.equal(A.energy(A.start(),0,-20,{}).kWh,0);
// presets: recirculation and A/C off lower the load, defrost adds
const hot={heatPump:true};assert(A.power(32.5,hot,{recirc:true})<A.power(32.5,hot,{}));near(A.power(32.5,hot,{ac:false}),A.BASE,1e-9);near(A.power(-8.5,hot,{defrost:true})-A.power(-8.5,hot,{}),.5,1e-9);
// ---- idle fuel ----
// derived table rows (handoff 7.3): displacement mid, cylinders -> warm L/h within 5%
for(const [d,c,v] of [[1.1,3,.40],[1.5,4,.51],[1.9,4,.65],[2.45,4,.80],[2.7,6,.80],[3,6,.89],[3.55,6,1.04],[4,6,1.19],[4.8,8,1.32],[5.5,8,1.45],[6.3,8,1.66]])near(I.warm({displ:d,cyl:c}).lph,v,v*.05,`${d} L ${c} cyl`);
for(const [d,c,v] of [[3,6,1.49],[3.55,6,1.69],[4.8,8,2.07]])near(I.idle({displ:d,cyl:c},{acFrac:1}).lph,v,v*.06,`${d} L with A/C`);
// measured rows sit inside their ranges
for(const m of I.MEASURED){const w=I.warm(m);assert(m.warm>=w.lo-1e-9&&m.warm<=w.hi*1.05,m.name+' warm inside the range');if(m.loaded){const l=I.idle(m,{acFrac:1});assert(m.loaded>=l.lo*.9&&m.loaded<=l.hi*1.1,m.name+' loaded near the range');}}
// cold fast idle, start-stop rules, unknown displacement, Sienna / Prius
near(I.idle({displ:2,cyl:4},{cold:true}).lph,I.warm({displ:2,cyl:4}).lph*1.6,1e-9);
assert.equal(I.idle({displ:2,cyl:4,startStop:true},{}).lph,0);assert(I.idle({displ:2,cyl:4,startStop:true},{acFrac:1}).lph>0,'start-stop runs the engine at A/C max');assert(I.idle({displ:2,cyl:4,startStop:true},{defrost:true}).lph>0);
assert.equal(I.warm({}).estimatedDispl,true);near(I.warm({}).lph,.32*2.5,1e-9,'unknown -> 2.5 L default');
const sienna=I.fromText('Auto (S6), 6 cyl, 3.5 L');assert.deepEqual([sienna.displ,sienna.cyl],[3.5,6]);near(I.warm(sienna).lph,1.04,.06);
const prius={displ:1.8,cyl:4,hybrid:true},pm=I.idle(prius,{ambientC:20}),pc=I.idle(prius,{ambientC:-5}),ph=I.idle(prius,{ambientC:35,acFrac:1});
assert(pm.lph<pc.lph,'cold hybrid runs its engine more');assert(ph.lph>=.45&&ph.lph<=.85,'hybrid with A/C 0.5–0.8 L/h effective: '+ph.lph);near(pm.engineOnShare,.2,1e-9);assert(pm.batteryKw>0,'battery drain counted (charge-neutral)');
console.log('Traffic energy modules: priors / timing / D2 guard rails, calibration recovers ratios and rejects bad fits, persisted posterior, EV aux per hour with warm-up state and presets, idle table / measured rows / start-stop / hybrids');
// ---- round 2: wired into Propulsion behind p.auxModel ----
{const T=require('../assets/web/trip'),P=require('../assets/web/propulsion');global.AuxLoad=A;global.TrafficModel=M;
 const pts=Array.from({length:21},(_,i)=>({lat:35,lng:-92+i*.05})),mi=T.hav(pts[0],pts[20]);
 const model=(parts,traffic)=>{const m=T.buildRoute({distanceMeters:mi*1609.344,duration:Math.round(mi/60*3600)+'s',polyline:{encodedPolyline:T.encodePolyline(pts)},legs:[]},{city:4,hwy:3.4,comb:3.7});const seg=m.segs[0],out=[];
  for(let i=0;i<parts;i++){const f=mi*i/parts,t=mi*(i+1)/parts;out.push(Object.assign({},seg,{from:f,to:t,mph:60},traffic?{trafficMph:traffic,freeMph:65}:{}));}return T.restoreModel(Object.assign({},m,{segs:out}));};
 const t0=Date.UTC(2026,0,10,12),wx=c=>[{mi:0,hours:Array.from({length:48},(_,h)=>[t0+h*3600000,c])}];
 const run=(m,c,spec)=>P.project(m,Object.assign({kind:'ev',capacity:80},spec),{startGal:80,weather:wx(c),departAt:t0});
 const used=r=>80-r.arriveGal;
 // flag off = today's model exactly; green at 20 °C with the flag on = the same estimate
 near(used(run(model(1),20,{})),used(run(model(1),20,{auxModel:true})),1e-9,'mild green section unchanged');
 // warm-up is applied once per cold start, not per section boundary
 near(used(run(model(1),-8.5,{auxModel:true})),used(run(model(12),-8.5,{auxModel:true})),1e-6,'section boundaries never restart warm-up');
 assert(used(run(model(1),-8.5,{auxModel:true}))>used(run(model(1),-8.5,{auxModel:true,preconditionedStart:true})),'preconditioning removes the warm-up');
 // crawl: the old road-load ratio dropped traction toward ~13% of highway; the floor holds it at the city rate (section 5.3)
 const crawlOff=run(model(1,10),20,{}),crawlOn=run(model(1,10),20,{auxModel:true});
 assert(used(crawlOn)/mi>=.25-1e-9,'crawl traction never below the EPA city rate: '+(used(crawlOn)/mi).toFixed(3));assert(used(crawlOn)>used(crawlOff));assert(crawlOn.flags.includes('crawl_city_baseline'));
 // dark-red-like forecast ratio (10/65): inferred stops add restart energy; cold crawl costs more per mile than mild (Leaf 342 vs 167 Wh/mi)
 assert(crawlOn.trafficStops>0&&crawlOn.flags.includes('traffic_stops_estimated'));assert(used(run(model(1,10),-8.5,{auxModel:true}))/used(crawlOn)>1.5,'cold crawl much worse per mile');
 assert.equal(M.fromRatio(10/65),'TRAFFIC_JAM_HEAVY');assert.equal(M.fromRatio(.9),'NORMAL');assert.equal(M.fromRatio(0),'NONE');
 // presets feed the aux power: recirculation in heat lowers it
 assert(used(run(model(1,20),35,{auxModel:true,heatPump:true,preset:{air:'recirc',ac:'on'}}))<used(run(model(1,20),35,{auxModel:true,heatPump:true,preset:{ac:'on'}})));
 // the planner worker gets both modules
 assert(A.workerSource.startsWith('(function initAuxLoad')&&M.workerSource.startsWith('(function initTrafficModel'));
 console.log('Round 2: flag off unchanged, mild green unchanged, warm-up once, crawl floor, inferred stops, presets, worker sources');}
