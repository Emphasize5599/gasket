const assert=require('node:assert/strict'),W=require('../assets/web/routewx'),C=require('../assets/web/climate'),M=require('../assets/web/tires'),TP=require('../assets/web/tirepolicy');
const base={info:{drive:'fwd'},type:'car',tires:{tread:{mode:'measure',depth:8},corners:{},type:'Touring All-Season'}};
const hz=(kind,level=2,fromMi=0,toMi=20)=>({kind,level,fromMi,toMi,from:0,to:7200000,events:[],peak:{aqi:160}});
function fit(car,kind){return W.vehicleFit([hz(kind)],W.vehicleProfile(car),TP.snapshot(car,M),100);}
const worse=(a,b)=>assert(a.key[2]>b.key[2],JSON.stringify({a,b}));
for(const kind of Object.keys(W.KINDS))assert(W.vehicleFit([hz(kind)],W.vehicleProfile(base),TP.snapshot(base,M),100).key.every(Number.isFinite),kind);
const broken={...base,climate:{acBroken:true}},missing={...base,climate:{caps:{noAc:true}}};
for(const kind of ['rain','storm','fog','heat']){worse(fit(broken,kind),fit(base,kind));assert.deepEqual(fit(broken,kind),fit(missing,kind));}
const worn={...base,tires:{...base.tires,tread:{mode:'measure',depth:3}}};
for(const kind of ['rain','storm','snow','ice'])worse(fit(worn,kind),fit(base,kind));
const tall={...base,epa:{vclass:'Passenger Vans'}},tow={...base,tires:{...base.tires,towMode:true,trailers:[{id:'tr',hooked:true,axles:1,per:2}]}};
assert(W.vehicleProfile(tall).high);assert(!W.vehicleProfile({...tall,info:{hazardProfile:'normal'}}).high);
assert(!W.vehicleProfile({epa:{vclass:'Two Seaters'},model:'Sports car'}).low,'class/name is not a clearance measurement');
worse(fit(tall,'wind'),fit(base,'wind'));worse(fit(tow,'wind'),fit(base,'wind'));
assert.deepEqual(fit({...tow,tires:{...tow.tires,towMode:false}},'wind'),fit(base,'wind'),'tow toggle alone / unhooked trailers do not add exposure');
const low={...base,info:{...base.info,hazardProfile:'low'}};worse(fit(low,'rain'),fit(base,'rain'));assert(!W.vehicleProfile(low).clearanceKnown);
// Duplicate / overlapping alerts do not inflate exposure. Splitting a stretch does not change the result.
const one=W.vehicleFit([hz('rain')],{},null,100);
assert.deepEqual(W.vehicleFit([hz('rain'),hz('rain')],{},null,100),one);
assert.deepEqual(W.vehicleFit([hz('rain',2,0,10),hz('rain',2,10,20)],{},null,100),one);
const entry=hazards=>({ready:true,hazards,stats:{points:2,weather:2,air:2},miles:100});
assert.equal(W.rankOptions([entry([hz('flood',1)]),entry([hz('rain',2,0,100)])],base,TP.snapshot(base,M)).rows[1].rank,1,'flood remains more concerning for every profile');
assert.equal(W.rankOptions([entry([hz('heat')]),entry([hz('wind')])],broken,TP.snapshot(broken,M)).rows[1].rank,1,'no A/C can change the preferred comparison');
for(const stats of [{errors:1},{beyondWeather:1},{beyondAir:1},{aiPending:1},{points:2,weather:1}]){
 const ranked=W.rankOptions([entry([]),{...entry([]),stats}],base,null);assert(!ranked.complete);assert(ranked.rows.every(r=>r.rank==null));
}
assert(!W.rankOptions([entry([]),{ready:false,hazards:[]}],base,null).complete);
assert.deepEqual(W.rankOptions([entry([]),entry([])],base,null).rows.map(r=>r.rank),[1,1],'ties are not false precision');
const caps=C.capsFor(broken),raw={...C.starter('season','summer',{auto:true}),notes:'Turn A/C on',frontDef:true};
const before=JSON.stringify(raw);assert.equal(C.effective(raw,caps).ac,'off');assert.equal(C.effective(raw,caps).mode,'manual');
assert.doesNotMatch(C.line(raw,caps),/A\/C on|A\/C auto| · Auto/);assert.match(C.line(raw,caps),/no A\/C drying/);
assert.equal(JSON.stringify(raw),before,'temporary failure never rewrites saved preferences');
for(const key of C.SEASONS.concat(C.WEATHER).map(x=>x[0])){assert.equal(C.starter('weather',key,caps).ac,'off');assert.equal(C.starter('weather',key,{noAc:true}).ac,'off');}
assert(!C.warnings({...raw,air:'recirc'},caps).includes('dry'));
assert(C.acAvailable(base));assert(!C.acAvailable(broken));assert(!C.acAvailable(missing));
for(const kind of Object.keys(W.KINDS))assert.doesNotMatch(W.advice(hz(kind),{acUnavailable:true}).join(' '),/keep the A\/C on/i,kind);
assert.match(W.advice(hz('fog'),{acUnavailable:true}).join(' '),/stop safely/);
console.log('All hazard kinds, vehicle/tread/towing/A-C modifiers, overlap invariance, critical priority, unknown forecasts and non-destructive climate fallbacks passed');
