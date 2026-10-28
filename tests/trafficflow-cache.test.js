// Persistent Google forecast cache: answers survive a restart (new TrafficFlow over the same storage), the index keeps
// the newest 1,024 forecasts and reuses evicted slots, the hot layer stays bounded, and one timezone lookup is shared.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const web=path.join(__dirname,'..','assets','web');
function load(store){
  const listeners={},ctx={console,Intl,Date,Math,JSON,Promise,setTimeout,clearTimeout,setInterval,clearInterval,Map,Set,WeakMap,Error,Number,String,Array,Object,BigInt};
  ctx.window=ctx;ctx.root=ctx;ctx.document={hidden:false};ctx.addEventListener=(n,f)=>{(listeners[n]=listeners[n]||[]).push(f);};ctx.dispatch=n=>(listeners[n]||[]).forEach(f=>f({}));
  vm.createContext(ctx);['trip.js','traffic.js','googletraffic.js','trafficflow.js'].forEach(f=>vm.runInContext(fs.readFileSync(path.join(web,f),'utf8'),ctx,{filename:f}));
  ctx.WorkerSettings={trafficCount:()=>4};
  const KV={get:(ns,k,ttl)=>{const r=store.get(ns+'|'+k);return r&&(!ttl||Date.now()-r.t<ttl)?r:null;},put:(ns,k,v)=>store.set(ns+'|'+k,{v,t:Date.now()})};
  const A={KV,S:{trip:{trafficForecast:true,avoid:{}},googleTraffic:true},esc:String,showSiteCheck(){throw Error('no check expected');}};
  const calls={google:0,zone:0};
  async function call(name,q){
    if(name==='fetchJson'){calls.zone++;await new Promise(r=>setTimeout(r,5));return {body:JSON.stringify({timezone:'America/Chicago'})};}
    if(name!=='fetchGoogleTraffic')throw Error('unexpected '+name);calls.google++;
    const m=[...q.matchAll(/!3m2!3d(-?[\d.]+)!4d(-?[\d.]+)/g)],a={lat:+m[0][1],lng:+m[0][2]},b={lat:+m[1][1],lng:+m[1][2]},meters=ctx.Trip.hav(a,b)*1609.344,seconds=meters/1609.344/50*3600,clock=+(/!3j(\d+)/.exec(q)[1]),r=[],root=[];
    r[0]=[];r[0][1]='Generic road';r[0][2]=[meters];r[0][10]=[[seconds],null,3,null,[seconds*.9,seconds*1.2]];r[3]=[[[0,0],[meters,seconds]]];root[1]=[r];
    root[7]=[[[Math.round(a.lat*1e7),Math.round((b.lat-a.lat)*1e7)],[Math.round(a.lng*1e7),Math.round((b.lng-a.lng)*1e7)]]];root[11]='!8j'+clock+'!3e0';return {body:JSON.stringify([root])};
  }
  const flow=ctx.TrafficFlow.init(A,call,{invalidate(){}});return {flow,calls,ctx};
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
  const index=store.get('traffic|google-index').v;assert.equal(index.length,1024,'index keeps 1,024 forecasts');assert.equal(new Set(index.map(e=>e.slot)).size,1024,'evicted slots are reused, not duplicated');
  assert(![...store.keys()].some(k=>/google-slot\|(\d+)$/.test(k)&&+/google-slot\|(\d+)$/.exec(k)[1]>=1024),'no slot beyond the cap');
  const g2=x.calls.google;await x.flow.forecast(m,t0);assert.equal(x.calls.google,g2+1,'the oldest forecast was evicted and is read again');
  x=load(store);await x.flow.forecast(m,t0+1029*600000);assert.equal(x.calls.google,0,'the newest survive a restart');
  console.log('Traffic forecast cache: restart reuse, 1,024-entry index with slot reuse and shared timezone lookup passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
