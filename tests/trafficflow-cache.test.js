// Persistent Google forecast cache: answers survive a restart (new TrafficFlow over the same storage), the larger index keeps
// earlier routes rather than evicting them during a large departure-window scan, the hot layer stays bounded, and one timezone lookup is shared.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const web=path.join(__dirname,'..','assets','web');
function load(store,at,speed=50){
  const clock=()=>at==null?Date.now():at;class Clock extends Date{static now(){return clock();}}
  const listeners={},ctx={console,Intl,Date:Clock,Math,JSON,Promise,setTimeout,clearTimeout,setInterval,clearInterval,Map,Set,WeakMap,Error,Number,String,Array,Object,BigInt};
  ctx.window=ctx;ctx.root=ctx;ctx.document={hidden:false};ctx.addEventListener=(n,f)=>{(listeners[n]=listeners[n]||[]).push(f);};ctx.dispatch=n=>(listeners[n]||[]).forEach(f=>f({}));
  vm.createContext(ctx);['trip.js','trafficpolicy.js','traffic.js','googletraffic.js','trafficcache.js','trafficflow.js'].forEach(f=>vm.runInContext(fs.readFileSync(path.join(web,f),'utf8'),ctx,{filename:f}));
  ctx.WorkerSettings={trafficCount:()=>4};
  const KV={get:(ns,k,ttl)=>{const r=store.get(ns+'|'+k);return r&&(!ttl||clock()-r.t<ttl)?r:null;},put:(ns,k,v)=>store.set(ns+'|'+k,{v,t:clock()})};
  const A={KV,S:{trip:{trafficForecast:true,trafficPreset:'weekend',avoid:{}},googleTraffic:true},esc:String,showSiteCheck(){throw Error('no check expected');}};
  const calls={google:0,zone:0,queries:[]};
  async function call(name,q){
    if(name==='fetchJson'){calls.zone++;await new Promise(r=>setTimeout(r,5));return {body:JSON.stringify({timezone:'America/Chicago'})};}
    if(name!=='fetchGoogleTraffic')throw Error('unexpected '+name);calls.google++;calls.queries.push(q);
    const m=[...q.matchAll(/!3m2!3d(-?[\d.]+)!4d(-?[\d.]+)/g)],a={lat:+m[0][1],lng:+m[0][2]},b={lat:+m[1][1],lng:+m[1][2]},meters=ctx.Trip.hav(a,b)*1609.344,seconds=meters/1609.344/speed*3600,clock=+(/!3j(\d+)/.exec(q)[1]),r=[],root=[];
    r[0]=[];r[0][1]='Generic road';r[0][2]=[meters];r[0][10]=[[seconds],null,3,null,[seconds*.9,seconds*1.2]];r[3]=[[[0,0],[meters,seconds]]];root[1]=[r];
    root[7]=[[[Math.round(a.lat*1e7),Math.round((b.lat-a.lat)*1e7)],[Math.round(a.lng*1e7),Math.round((b.lng-a.lng)*1e7)]]];root[11]='!8j'+clock+'!3e0';return {body:JSON.stringify([root])};
  }
  const flow=ctx.TrafficFlow.init(A,call,{invalidate(){}});return {flow,calls,ctx,settings:A.S,KV};
}
(async()=>{
  const store=new Map(),T=require('../assets/web/trip.js'),pts=[{lat:34.01,lng:-92.01},{lat:34.06,lng:-92.01}],mi=T.hav(pts[0],pts[1]);
  const m=T.buildRoute({distanceMeters:mi*1609.344,duration:'300s',polyline:{encodedPolyline:T.encodePolyline(pts)},legs:[]},{city:30,hwy:40,comb:35});
  const t0=Date.UTC(2027,0,4,15); // a span with no daylight-saving change
  let x=load(store);const first=await Promise.all([x.flow.forecast(m,t0),x.flow.forecast(m,t0+600000)]);assert(first.every(p=>p.coverage>.99));assert.equal(x.calls.zone,1,'concurrent forecasts share one timezone lookup');
  const g1=x.calls.google;await x.flow.forecast(m,t0);assert.equal(x.calls.google,g1,'same departure reuses the answer');
  await new Promise(r=>setTimeout(r,350));assert(store.get('traffic|google-index').v.length>=2,'index written after a short delay');
  x=load(store);await x.flow.forecast(m,t0);assert.equal(x.calls.google,0,'a restart reuses stored forecasts');assert.equal(x.calls.zone,0,'and the stored timezone');
  for(let i=2;i<1030;i++)await x.flow.forecast(m,t0+i*600000);x.ctx.dispatch('pagehide');
  const index=store.get('traffic|google-index').v;assert.equal(index.length,1030,'more than 1,024 forecasts survive a large window scan');assert.equal(new Set(index.map(e=>e.slot)).size,1030,'all slots are distinct');
  assert(![...store.keys()].some(k=>/google-slot\|(\d+)$/.test(k)&&+/google-slot\|(\d+)$/.exec(k)[1]>=8192),'no slot beyond the cap');
  const g2=x.calls.google;await x.flow.forecast(m,t0);assert.equal(x.calls.google,g2,'earlier routes still reuse stored forecasts');
  x=load(store);await x.flow.forecast(m,t0+1029*600000);assert.equal(x.calls.google,0,'the newest survive a restart');
  // Future forecasts last across days, but tighten as departure approaches.
  const days=new Map(),D=86400000,H=3600000,depart=Date.UTC(2027,1,8,15),initial=depart-10*D;
  let y=load(days,initial);await y.flow.forecast(m,depart);y.ctx.dispatch('pagehide');
  y=load(days,initial+2*D);const reused=await y.flow.forecast(m,depart);assert(reused.cachedPieces>0&&reused.fetchedPieces===0);assert.equal(y.calls.google,0,'two-day-old distant-future forecast remains reusable');
  const raw={description:'same roads'},second=T.restoreModel(Object.assign({},m,{cityGpm:1/15,hwyGpm:1/20}));const a=await y.flow.prepare(raw,m,depart),b=await y.flow.prepare(raw,second,depart);assert.equal(y.calls.google,0,'different vehicle/energy setup needs no new traffic read');assert.equal(a.durationSec,b.durationSec);assert(b.segs[0].gpm>a.segs[0].gpm,'energy is recalculated from current vehicle, not cached fuel use');
  const isolated=new Map([...days].map(([k,v])=>[k,JSON.parse(JSON.stringify(v))]));let short=load(isolated,initial+2*D);short.settings.trip.trafficPreset='commute';await short.flow.forecast(m,depart);assert(short.calls.google>0,'commute retention is honored');short.ctx.dispatch('pagehide');
  y.settings.trip.avoid={tolls:true};await y.flow.forecast(m,depart);assert(y.calls.google>0,'changed avoid settings do not borrow incompatible shared observations');y.ctx.dispatch('pagehide');
  y=load(days,initial+8*D);await y.flow.forecast(m,depart);assert(y.calls.google>0,'future forecast refreshes after seven days');y.ctx.dispatch('pagehide');
  y=load(days,depart-12*H);await y.flow.forecast(m,depart);assert.equal(y.calls.google,0,'weekend retention does not shorten as departure approaches');y.ctx.dispatch('pagehide');
  y=load(days,depart-30*60000);await y.flow.forecast(m,depart);assert.equal(y.calls.google,0,'near-term pieces retain the same weekend policy');y.ctx.dispatch('pagehide');
  y=load(days,depart-25*60000);await y.flow.forecast(m,depart);assert.equal(y.calls.google,0,'the same planning snapshot is reused');
  await y.flow.forecast(m,depart+600000);assert(y.calls.google>0,'different planned time cannot borrow another hour/date');y.ctx.dispatch('pagehide');
  {// the status total is the caller's queue (time-window screening), not a count that grows as routes start
   const q=load(new Map());const texts=[];q.ctx.Tasks={upsert:(id,o)=>{if(id==='traffic-work')texts.push(o.text);},begin:()=>()=>{}};const raw=i=>({description:'Route '+i,polyline:{encodedPolyline:T.encodePolyline(pts)}});
   const t0=Date.UTC(2027,1,1,15),jobs=[];for(let i=0;i<4;i++)jobs.push(q.flow.prepare(raw(i),m,t0+i*3600000,{queue:{index:i,total:10},label:'Route '+i}));await Promise.all(jobs);
   const totals=texts.map(t=>+(/ \/ (\d+) routes checked/.exec(t)||[])[1]).filter(Number.isFinite);assert(totals.length&&totals.every(n=>n===10),'every status names the queue total of 10: '+totals.join(','));}
  {// New stop/leg boundaries can require several old profiles, with only an expired/missing middle fetched again.
   const origin=Date.UTC(2027,0,4,12),when=origin+86400000,ps=[{lat:34.01,lng:-92.01},{lat:34.31,lng:-92.01}],distance=T.hav(ps[0],ps[1]);
   const whole=T.buildRoute({distanceMeters:distance*1609.344,duration:'1500s',polyline:{encodedPolyline:T.encodePolyline(ps)},legs:[]},{city:30,hwy:40,comb:35});
   const split=T.restoreModel({...whole,legEnds:[distance/3,distance*2/3,distance]}),data=new Map();let a=load(data,origin);
   const original=await a.flow.forecast(split,when);a.ctx.dispatch('pagehide');assert.equal(a.calls.google,3);
   let b=load(data,origin+3*3600000);const joined=await b.flow.forecast(whole,when);b.ctx.dispatch('pagehide');
   assert.equal(b.calls.google,0,'all three persisted sections join after a restart and window/leg changes');assert.equal(joined.cachedSections,3);assert.equal(joined.fetchedSections,0);assert(Math.abs(joined.seconds-original.seconds)<.05);assert.equal(joined.at,origin,'stitching does not renew forecast age');
   const notices=[],logs=[];b.ctx.Tasks={upsert:(_id,o)=>notices.push(o.text),begin:()=>()=>{}};b.ctx.FLog={debug:(_a,_m,d)=>logs.push(d),info:(_a,_m,d)=>logs.push(d),warn(){}};
   await b.flow.prepare({description:'Reassembled roads'},whole,when);assert(notices.some(t=>/sections reused/.test(t)),'status distinguishes storage reuse from new reading');assert(logs.some(d=>d.cachedSections===3&&d.fetchedSections===0),'logs report actual reused/new sections');b.ctx.dispatch('pagehide');
   const missing=new Map([...data].map(([k,v])=>[k,JSON.parse(JSON.stringify(v))])),index=missing.get('traffic|google-index').v;
   const mid=index.slice().sort((a,b)=>a.start-b.start)[1];assert(mid,'middle section indexed');
   missing.delete('traffic|google-slot|'+mid.slot);missing.get('traffic|google-index').v=index.filter(e=>e!==mid);
   const delayed=new Map([...missing].map(([k,v])=>[k,JSON.parse(JSON.stringify(v))]));
   b=load(missing,origin+4*3600000);const partial=await b.flow.forecast(whole,when);b.ctx.dispatch('pagehide');
   assert.equal(b.calls.google,1,'only the missing middle section is requested');assert.equal(partial.cachedSections,2);assert.equal(partial.fetchedSections,1);assert(Math.abs(partial.seconds-original.seconds)<.05);
   const requested=[...b.calls.queries[0].matchAll(/!3m2!3d(-?[\d.]+)!4d(-?[\d.]+)/g)];assert(Math.abs(+requested[0][1]-whole.pointAt(distance/3).lat)<.00002);assert(Math.abs(+requested[1][1]-whole.pointAt(distance*2/3).lat)<.00002,'request stops where stored traffic resumes');
   b=load(delayed,origin+4*3600000,25);const slower=await b.flow.forecast(whole,when);b.ctx.dispatch('pagehide');assert.equal(b.calls.google,2,'a slower new middle invalidates the old tail arrival time');assert.equal(slower.cachedSections,1);assert.equal(slower.fetchedSections,2);
   const expired=new Map([...data].map(([k,v])=>[k,JSON.parse(JSON.stringify(v))])),slot=expired.get('traffic|google-slot|'+mid.slot);slot.v.profile.at=origin-8*86400000;expired.get('traffic|google-index').v.find(e=>e.slot===mid.slot).observedAt=slot.v.profile.at;
   b=load(expired,origin+4*3600000);await b.flow.forecast(whole,when);b.ctx.dispatch('pagehide');assert.equal(b.calls.google,1,'only an expired section is refreshed');
   b=load(data,origin+4*3600000);await b.flow.forecast(whole,when+3600000);b.ctx.dispatch('pagehide');assert(b.calls.google>0,'another hour is not silently served the old forecast');
   b=load(data,origin+4*3600000);await b.flow.forecast(whole,when,{force:true});b.ctx.dispatch('pagehide');assert(b.calls.google>0,'explicit refresh still bypasses all stored sections');
  }
  {// Four newer incompatible legacy observations used to hide a valid older shared-road record.
   const data=new Map(),origin=Date.UTC(2027,0,4,12),when=origin+86400000;let a=load(data,origin);await a.flow.forecast(m,when);a.ctx.dispatch('pagehide');
   const cache=a.ctx.TrafficCache.create(a.KV),e=cache.entries()[0],record=JSON.parse(JSON.stringify(cache.get(e.key).v));record.observation.avoidKey='false|true|false';
   for(let i=0;i<6;i++)cache.put('decoy'+i,record);cache.flush();data.get('traffic|google-index').v.forEach(e=>{delete e.avoidKey;delete e.observedAt;});
   a=load(data,origin+3*3600000);const short=require('../assets/web/traffic').slice(m,m.totalMi*.2,m.totalMi*.8);
   // Use the actual forecast's 50 mph clock rather than the original route's normal time.
   const result=await a.flow.forecast(short,when+m.totalMi*.2/50*3600000);a.ctx.dispatch('pagehide');assert.equal(a.calls.google,0,'valid older section found beyond the former four-entry cutoff');assert(result.cachedSections>0);
  }
  {// Turning off immediate return changes only the return's road/time forecasts, not the outward leg.
   const data=new Map(),origin=Date.UTC(2027,0,4,12),when=origin+86400000;
   const round=T.buildRoute({distanceMeters:mi*2*1609.344,duration:'600s',polyline:{encodedPolyline:T.encodePolyline([pts[0],pts[1],pts[0]])},legs:[{distanceMeters:mi*1609.344,duration:'300s',steps:[]},{distanceMeters:mi*1609.344,duration:'300s',steps:[]}]},{city:30,hwy:40,comb:35});
   let a=load(data,origin);await a.flow.forecast(round,when);a.ctx.dispatch('pagehide');
   a=load(data,origin+3*3600000);const moved=await a.flow.forecast(round,when,{waitAt:{d:mi,at:when+4*3600000}});a.ctx.dispatch('pagehide');
   assert.equal(a.calls.google,1,'only the return leg at its new departure needs a forecast');assert.equal(moved.legs.length,2,'almost-identical wait/leg boundaries do not create a zero-length request');assert.equal(moved.cachedSections,1);assert.equal(moved.fetchedSections,1);
   const q=[...a.calls.queries[0].matchAll(/!3m2!3d(-?[\d.]+)!4d(-?[\d.]+)/g)];assert(Math.abs(+q[0][1]-pts[1].lat)<.00002&&Math.abs(+q[1][1]-pts[0].lat)<.00002,'outward and return direction are not interchanged');
  }
  console.log('Traffic forecast cache: restart, mixed stored/missing/expired sections, changed boundaries/return time, older shared roads, bounded index and timezone lookup passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
