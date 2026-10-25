// Charging curves: matching/scaling (chargecurve.js) and the planner charging by the curve (trip.js chargeTimes):
// exact against brute force on a small route, more / shorter stops low in the battery on a Model Y-like curve.
const assert=require('node:assert/strict'),C=require('../assets/web/chargecurve.js'),T=require('../assets/web/trip.js'),D=require('../assets/web/evcurves-data.js');
// the owner's Model Y figures: ~250 kW 10–30%, ~150 at 50%, ~75 at 70%, under 40 past 85%
const MY=[[0,250],[30,250],[50,150],[70,75],[85,40],[100,20]];
// --- curves ---
assert.equal(C.at(MY,.5),150);assert.equal(C.at(MY,.6),112.5);assert.equal(C.at(MY,1.2),20);
assert.equal(C.clean([[0,5]]),null,'one point is no curve');assert.equal(C.clean([[0,5],[50,2000]]),null,'over 1000 kW');
assert.deepEqual(C.clean([[50,100],[0,200],[50,90]]),[[0,200],[50,100]],'sorted, duplicate SOC dropped');
let r=C.forCar({make:'Tesla',model:'Model Y Long Range AWD',year:2024,tank:75});assert.equal(r.src,'data');assert.match(r.label,/Open EV Data: Tesla Model Y Long Range Dual Motor/);assert.equal(r.peak,250);
r=C.forCar({make:'Tesla',model:'Model Y Long Range AWD',year:2024,tank:75,dcKw:200});assert.equal(r.peak,200);assert.match(r.label,/scaled to your 200 kW peak/);assert.equal(C.peak(r.points),200);
r=C.forCar({make:'Ford',model:'Mustang Mach-E AWD',trim:'Premium',year:2023,tank:91});assert.match(r.label,/Mustang Mach/);assert(!C.tokens('Mustang Mach-E Premium').includes('long'),'Premium means Long Range only for Tesla');assert(C.tokens('Model Y Premium',true).includes('long'));
r=C.forCar({make:'Hyundai',model:'Ioniq 5 Long range AWD',year:2023,tank:74});assert.match(r.label,/IONIQ 5 Long Range AWD/);
r=C.forCar({make:'Rivian',model:'R1T',year:2023,tank:128,dcKw:220});assert.equal(r.src,'generic');assert.equal(r.peak,220);assert(C.at(r.points,.8)<.35*220,'the generic curve tapers hard by 80%');
r=C.forCar({make:'Tesla',model:'Model Y Long Range AWD',year:2024,tank:75,dcKw:250,dcCurve:MY});assert.equal(r.src,'user');assert.deepEqual(r.points,MY,'a typed curve is used as typed');
assert.equal(C.rows11(MY).length,11);assert(D.rows.length>300&&D.rows.every(x=>x[5].length>=4),'bundled curves');
assert(!D.rows.some(x=>x[4]&&Math.abs(Math.max(...x[5].filter((_,i)=>i%2))-x[4])<.05),'no rows whose "peak" is the battery size');
// --- the planner charges by the curve: exact (brute force over every buy at three chargers) ---
function route(mi,mpkwh){const raw={distanceMeters:mi*1609.344,duration:(mi*60)+'s',polyline:{encodedPolyline:T.encodePolyline([{lat:35,lng:-92},{lat:35,lng:-92+mi/57}])},legs:[]};return T.buildRoute(raw,{city:mpkwh,hwy:mpkwh,comb:mpkwh});}
function brute(o,ds){
  const step=o.step,L=Math.round(o.capGal/step),gpm=o.model.combGpm,stations=o.cands;let best=Infinity;
  const table=c=>{const t=[0];for(let l=0;l<L;l++){const soc=(l+.5)*step/o.capGal,pw=Math.min(C.at(o.chargeCurve.points,soc),c.stationKw*.98);t.push(t[l]+step/(pw*.93)*60);}return t;};
  const Ts=stations.map(table),n=stations.length;
  (function go(k,fuel,at,time){
    const burn=Math.ceil((o.model.galTo(k<n?ds[k]:o.model.totalMi)-o.model.galTo(at))/step-1e-9);fuel-=burn;if(fuel<0)return;
    if(k===n){best=Math.min(best,time);return;}
    go(k+1,fuel,ds[k],time);
    for(let g=fuel+1;g<=L;g++)go(k+1,g,ds[k],time+Ts[k][g]-Ts[k][fuel]+o.stopMinutes);
  })(0,Math.round(o.startGal/step),0,0);
  return best;
}
const small={model:route(100,5),capGal:10,startGal:6,bufferGal:0,arriveGal:0,step:1,fuelKind:'ev',stopMinutes:5,maxDetourMin:30,objective:'time',chargeCurve:{points:[[0,40],[40,40],[70,15],[100,4]]},
  cands:[{id:'a',d:25,price:.4,stationKw:50,chargeLevel:'dc_fast',kw:28},{id:'b',d:50,price:.4,stationKw:20,chargeLevel:'dc_fast',kw:14},{id:'c',d:75,price:.4,stationKw:150,chargeLevel:'dc_fast',kw:28}]};
for(const start of [5,6,8,10]){for(const stop of [0,5,15]){const o={...small,startGal:start,stopMinutes:stop},p=T.plan(o);assert(p.ok);
  const mins=p.stops.reduce((s,x)=>s+x.curveMin+stop,0);assert(Math.abs(mins-brute(o,[25,50,75]))<1e-6,'start '+start+', stop '+stop+': '+mins+' vs '+brute(o,[25,50,75]));
  p.stops.forEach(s=>assert(Math.abs(T.serviceMinutes(s,'ev')-s.curveMin)<1e-9,'stop minutes come from the curve'));}}
// --- a Model Y-like trip: chargers every 40 mi, 250 kW; fastest charges low and often, not to 80% ---
const trip={model:route(600,4),capGal:75,startGal:60,bufferGal:5,arriveGal:5,step:.5,fuelKind:'ev',stopMinutes:5,maxDetourMin:30,fillCap:75,objective:'time',
  cands:Array.from({length:14},(_,i)=>({id:'sc'+i,d:40*(i+1),price:.45,stationKw:250,chargeLevel:'dc_fast',kw:175}))};
const flat=T.plan({...trip}),curve=T.plan({...trip,chargeCurve:{points:MY}});assert(flat.ok&&curve.ok);
const onCurve=p=>{return p.stops.reduce((s,x)=>{let t=0;for(let g=x.arriveGal;g<x.departGal-1e-9;g+=.5){const soc=(g+.25)/75;t+=.5/(Math.min(C.at(MY,soc),245)*.93)*60;}return s+t+5;},0);};
const flatOnCurve=onCurve(flat),curveMin=onCurve(curve);
assert(curve.stops.length>flat.stops.length,'more stops: '+curve.stops.length+' vs '+flat.stops.length);
assert(curveMin<flatOnCurve-5,'faster on the real curve: '+curveMin.toFixed(1)+' vs '+flatOnCurve.toFixed(1)+' min');
assert(curve.stops.every(s=>s.departGal/75<=.62),'no stop charges into the slow part: '+curve.stops.map(s=>Math.round(s.departGal/75*100)).join(','));
// cheapest overall is unchanged in what it pays; the curve only breaks ties toward less time
const cheap=T.plan({...trip,objective:undefined}),cheapCurve=T.plan({...trip,objective:undefined,chargeCurve:{points:MY}});
assert(Math.abs(cheap.totals.net-cheapCurve.totals.net)<1e-6,'same net cost: '+cheap.totals.net+' vs '+cheapCurve.totals.net);assert(onCurve(cheapCurve)<=onCurve(cheap)+1e-6,'equal-cost plan with no more charging time');
console.log('Charging curves: dataset match/scale/generic/typed, planner exact vs brute force on the curve, Model Y '+curve.stops.length+' short stops ('+curveMin.toFixed(0)+' min) vs '+flat.stops.length+' ('+flatOnCurve.toFixed(0)+' min on the curve), cost unchanged');
