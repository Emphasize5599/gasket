const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(process.env.GASKET_RECO_SOURCE||'assets/web/restui.js','utf8'),Timing=require('../assets/web/resttiming'),Plan=require('../assets/web/restplan'),Access=require('../assets/web/restaccess');
const tick=()=>new Promise(r=>setImmediate(r));
const defer=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
function setup(rows,readAccess,readForecast){
 const c={extensiveForecasts:()=>false,RECO_SITES:8,RECO_TIMES:+/RECO_TIMES=(\d+)/.exec(src)[1],C:{access:true,tolerance:()=>20,forecast:readForecast},root:{},focusedTraffic:0,resumeAccess:new Set(),accessCache:new Map(),accessKey:(_s,x)=>x.site.id,nightly:()=>null,legStart:()=>0,legSites:()=>rows,spread:(x,n)=>x.length<=n?x:Array.from({length:n},(_,i)=>x[Math.round(i*(x.length-1)/(n-1))]),checkAccess:readAccess,effective:p=>p,siteArrival:()=>0,freeOf:q=>q.baseSeconds/60,RestPlan:Plan,RestTiming:{...Timing,samples:()=>[10,20,30,40,50,60]},RestAccess:Access};
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

 // Extensive screening covers the entire eligible pool and every departure, including chargers.
 for(const charger of [null,{}]){
  const all=rows(30),seen=new Map();c=setup(all,async()=>okay,async(d,t)=>{seen.set(d,(seen.get(d)||[]).concat(t));return forecast;});c.extensiveForecasts=()=>true;c.clocks={get:()=> 'UTC'};c.restSampleTimes=(_p,_at,start,end)=>c.RestTiming.samples(start,end);c.chargerDirectoryRows=()=>all;c.siteLeg=()=>0;
  const full=await c.recommendLeg({route:{stops:[]}},0,()=>true,()=>{},charger,()=>{});assert.equal(full.items.length,30);assert.equal(full.forecastChecked,180);assert.equal(seen.size,30,'no eight-site cap in extensive mode');for(const times of seen.values())assert.deepEqual(times,[10,20,30,40,50,60]);
 }
 // The extensive summary keeps the complete-range baseline, including later slower/unknown samples.
 c=setup(rows(1),async()=>okay,async(_d,t)=>t===10?{...forecast,seconds:600,baseSeconds:600}:{...forecast,seconds:1200,baseSeconds:60,coverage:t===60?.8:1});c.extensiveForecasts=()=>true;c.clocks={get:()=> 'UTC'};c.restSampleTimes=(_p,_a,start,end)=>c.RestTiming.samples(start,end);const summarized=await c.recommendLeg({route:{stops:[]}},0,()=>true,()=>{},null,()=>{});assert.equal(summarized.items[0].zone,'yellow');assert.equal(summarized.items[0].delay,9);assert.equal(summarized.items[0].checked,5);assert.equal(summarized.unavailable,1);
 // Final timing has no coarse-sampling cap, regardless of background depth.
 for(const extensive of [false,true]){
  const at=Date.parse('2030-11-13T00:00Z'),site={id:'test',name:'Rest',hours:'24/7'},stop={rest:{site,minimumRest:30,maximumStay:480}},snapshot={model:{},route:{stops:[{},stop,{}]}},seen=[];
  const f={extensiveForecasts:()=>extensive,root:{},C:{snapshot:()=>snapshot,arrival:()=>at,tolerance:()=>20,forecast:async(_d,t)=>{seen.push(t);return {seconds:600,baseSeconds:600,coverage:1,arrival:t+600000};}},endsOf:()=>[10,20],effective:p=>p,clocks:{load:async()=>{},get:()=> 'UTC'},RestTiming:Timing,RestPlan:Plan,StopClock:{hours:()=>({state:'open'})},RestPlaces:{stayHours:()=> '24/7'},freeOf:q=>q.baseSeconds/60};vm.createContext(f);vm.runInContext(src.slice(src.indexOf('  function restSampleTimes('),src.indexOf('  function sampleRest('))+'\n'+src.slice(src.indexOf('  async function sampleRest0('),src.indexOf('  function verifySavedPrice(')),f);const full=await f.sampleRest0(snapshot,1,()=>true,()=>{});assert.equal(full.samples.length,91);assert.deepEqual(seen.slice().sort((a,b)=>a-b),Timing.samples(at+30*60000,at+480*60000),'every five-minute final departure is forecast in both modes');
 }

 // A failed details-only campground check already answers full access: do not fetch it again.
 {const held={factsOnly:true,pending:false,at:Date.now()-120000,reason:'HTTP 404'},c={vehicleIssue:()=>null,screen:{hidden:()=>false},accessKey:()=> 'missing',accessCache:new Map([['missing',held]]),state:{token:1},RestAccess:Access};vm.createContext(c);vm.runInContext(src.slice(src.indexOf('  function checkAccess('),src.indexOf('  function accessCounts(')),c);assert.equal(await c.checkAccess({}, {site:{}},false,true),held,'recent failed metadata is reused by full-access screening');}
 console.log('Sampling: 48 → 24 forecasts per leg (50% fewer); bounded concurrency, independent access, early phase reporting and explicit failures passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
