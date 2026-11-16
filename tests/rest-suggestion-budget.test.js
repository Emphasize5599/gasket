const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(process.env.GASKET_RECO_SOURCE||'assets/web/restui.js','utf8'),Timing=require('../assets/web/resttiming'),Plan=require('../assets/web/restplan'),Access=require('../assets/web/restaccess');
const tick=()=>new Promise(r=>setImmediate(r));
const defer=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
function setup(rows,readAccess,readForecast){
 const c={RECO_SITES:8,RECO_TIMES:+/RECO_TIMES=(\d+)/.exec(src)[1],C:{access:true,tolerance:()=>20,forecast:readForecast},root:{},focusedTraffic:0,resumeAccess:new Set(),accessCache:new Map(),accessKey:(_s,x)=>x.site.id,nightly:()=>null,legStart:()=>0,legSites:()=>rows,spread:(x,n)=>x.length<=n?x:Array.from({length:n},(_,i)=>x[Math.round(i*(x.length-1)/(n-1))]),checkAccess:readAccess,effective:p=>p,siteArrival:()=>0,freeOf:q=>q.baseSeconds/60,RestPlan:Plan,RestTiming:{...Timing,samples:()=>[10,20,30,40,50,60]},RestAccess:Access};
 vm.createContext(c);vm.runInContext(src.slice(src.indexOf('  async function recommendLeg('),src.indexOf('  function pendingGroup(')),c);return c;
}
const rows=n=>Array.from({length:n},(_,i)=>({x:{site:{id:String(i),name:'Stop '+i},d:i+1},k:i}));
const okay={ok:true,access:{backSeconds:0}},forecast={seconds:600,baseSeconds:600,coverage:1,at:Date.now()};
(async()=>{
 // A slow pair of access requests cannot occupy every sampler lane.
 const slow=defer(),published=[],started=[];
 let c=setup(rows(10),async(_s,x)=>+x.site.id<2?slow.promise:okay,async(d,t)=>{started.push([d,t]);return forecast;});
 const work=c.recommendLeg({route:{stops:[]}},0,()=>true,()=>{},null,x=>published.push(x));await tick();
 assert(published.some(x=>x.items.length),'verified stops publish while two access requests are blocked');
 assert(!published.some(x=>x.items.some(i=>+i.id<2)),'unverified access is never suggested');slow.resolve(okay);await work;
 // A blocked onward forecast cannot hold an access-check lane; network fan-out is bounded.
 const road=defer();let accesses=0,active=0,peak=0,calls=0;const phases=[];
 c=setup(rows(8),async()=>{accesses++;return okay;},async(d,t)=>{calls++;active++;peak=Math.max(peak,active);if(d===1)await road.promise;await tick();active--;return forecast;});
 const result=c.recommendLeg({route:{stops:[]}},0,()=>true,(_i,_n,p)=>phases.push(p),null,()=>{});await tick();await tick();
 assert.equal(accesses,8,'traffic forecasts do not serialize the access stage');assert(phases.includes('Departure forecasts'),'status changes when forecasts start, before one finishes');
 road.resolve();const final=await result;assert.equal(calls,24,'eight candidates use beginning/middle/end samples, rather than 48 forecasts');assert.equal(final.items.length,8);assert.equal(final.forecastChecked,24);assert(peak<=2,'at most two onward forecasts per leg');
 c.C.forecast=async()=>({...forecast,coverage:.8});assert.equal((await c.recommendLeg({route:{stops:[]}},0,()=>true,()=>{},null,()=>{})).items.length,0,'partial coverage remains unknown');
 c.C.forecast=async()=>{throw Error('Provider unavailable');};const failed=await c.recommendLeg({route:{stops:[]}},0,()=>true,()=>{},null,()=>{});assert.equal(failed.unavailable,24);assert.equal(failed.failures['Provider unavailable'],24);
 // Do not immediately spend another batch of requests on records already known to be missing.
 const failures=new Map([['0',{at:Date.now(),reason:'HTTP 404'}]]);c=setup(rows(2),async()=>okay,async()=>forecast);c.accessCache=failures;const kept=await c.recommendLeg({route:{stops:[]}},0,()=>true,()=>{},null,()=>{});assert.equal(kept.checked,1);assert.equal(kept.items.length,1);

 // A failed details-only campground check already answers full access: do not fetch it again.
 {const held={factsOnly:true,pending:false,at:Date.now()-120000,reason:'HTTP 404'},c={vehicleIssue:()=>null,screen:{hidden:()=>false},accessKey:()=> 'missing',accessCache:new Map([['missing',held]]),state:{token:1},RestAccess:Access};vm.createContext(c);vm.runInContext(src.slice(src.indexOf('  function checkAccess('),src.indexOf('  function accessCounts(')),c);assert.equal(await c.checkAccess({}, {site:{}},false,true),held,'recent failed metadata is reused by full-access screening');}
 console.log('Sampling: 48 → 24 forecasts per leg (50% fewer); bounded concurrency, independent access, early phase reporting and explicit failures passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
