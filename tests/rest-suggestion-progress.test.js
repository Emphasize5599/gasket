const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('assets/web/restui.js','utf8'),Timing=require('../assets/web/resttiming'),Plan=require('../assets/web/restplan');
const tick=()=>new Promise(r=>setImmediate(r));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function progressive(){
 const access=deferred(),forecast=deferred(),published=[],a={site:{id:'a',name:'Verified stop'},d:10},b={site:{id:'b',name:'Slow access'},d:20},record={ok:true,access:{backSeconds:0}},s={route:{stops:[{},{}]}};
 const c={RECO_SITES:8,RECO_TIMES:6,C:{access:true,tolerance:()=>20,forecast:async(d,t)=>{if(d===10&&t!==10)await forecast.promise;return {seconds:600,baseSeconds:600,coverage:1,at:Date.now()};}},root:{},focusedTraffic:0,resumeAccess:new Set(),accessCache:new Map([['a',record]]),accessKey:(_s,x)=>x.site.id,nightly:()=>null,legStart:()=>0,legSites:()=>[{x:a,k:0},{x:b,k:1}],spread:(x,n)=>x.slice(0,n),checkAccess:(_s,x)=>x===a?Promise.resolve(record):access.promise,effective:p=>p,siteArrival:()=>0,freeOf:q=>q.baseSeconds/60,RestPlan:Plan,RestTiming:{...Timing,samples:()=>[10,20,30]}};
 vm.createContext(c);vm.runInContext(src.slice(src.indexOf('  async function recommendLeg('),src.indexOf('  function pendingGroup(')),c);
 let finished=false;const work=c.recommendLeg(s,0,()=>true,()=>{},null,x=>published.push(x)).then(r=>{finished=true;return r;});
 await tick();assert(!finished);assert(published.some(p=>p.items.some(x=>x.id==='a'&&x.zone==='green')),'a verified green stop appears while another access check and later departure samples are still pending');
 assert(!published.some(p=>p.items.some(x=>x.id==='b')),'no stop is highlighted before access succeeds');
 access.resolve(record);forecast.resolve();const result=await work;assert.equal(result.items.length,2);assert(result.items.every(x=>x.checked===3));
 c.C.forecast=async()=>({seconds:600,baseSeconds:600,coverage:.8,at:Date.now()});const incomplete=await c.recommendLeg(s,0,()=>true,()=>{},null,()=>{});assert.equal(incomplete.items.length,0,'incomplete forecasts must not produce green suggestions');
}
async function parallel(){
 const blocked=deferred(),started=[],s={model:{},route:{}};
 const c={state:{token:1,busy:false},screen:{holding:()=>false},focusedTraffic:0,C:{snapshot:()=>s,forecast(){},trafficEnabled:()=>true},endsOf:()=>[1,2],legSites:()=>[{}],recoEntry:()=>null,startReco:i=>{started.push(i);return i===0?blocked.promise:Promise.resolve();}};
 vm.createContext(c);vm.runInContext(src.slice(src.indexOf('  async function autoReco('),src.indexOf('  function recoNote(')),c);
 const work=c.autoReco(s,1);await tick();assert.deepEqual(started,[0,1],'a slow first leg must not prevent second-leg screening from starting');blocked.resolve();await work;
}
async function fullParallel(){
 const blocked=deferred(),started=[],s={route:{},model:{}};
 const c={root:{},A:{S:{trip:{windowPlan:{autoFirstNight:true}}}},C:{snapshot:()=>s,forecast(){}},state:{token:1},nightly:()=>({}),directoryGroups:()=>[{from:0},{from:1}],nightPlan:(_s,i)=>({leg:i,required:true,skips:[]}),chargerRestTypes:()=>null,recoKey:(_s,i)=>String(i),recoEntry:()=>null,startReco:i=>{started.push(i);return i===0?blocked.promise:Promise.resolve();},legSites:()=>[],bgAccess:async()=>{},screen:{hidden:()=>false},focusedTraffic:0,laterRender(){},RestTiming:Timing};
 vm.createContext(c);vm.runInContext(src.slice(src.indexOf('  function autoFirstNight('),src.indexOf('  async function runRestFollowups(')),c);
 const work=c.prepareFirstNight(s,1);await tick();assert.deepEqual(started,[0,1],'full first-night mode also starts second-leg suggestions before the first leg finishes');blocked.resolve();await work;
}
async function lateEnable(){
 let enabled=false;const events=[],s={};const c={state:{token:1,sites:[{}]},screen:{holding:()=>false},focusedTraffic:0,C:{forecast(){},snapshot:()=>s,trafficEnabled:()=>enabled},root:{},autoFirstNight:()=>true,bgAccess:async()=>{await tick();enabled=true;},autoReco:async()=>{if(enabled)events.push('suggestions');},prepareFirstNight:async()=>events.push('previews'),autoChargerDirectories:async()=>{},warmNightTraffic:async()=>{}};
 vm.createContext(c);vm.runInContext(src.slice(src.indexOf('  async function runRestFollowups('),src.indexOf('  async function autoReco(')),c);await c.runRestFollowups(s,1);assert.deepEqual(events,['suggestions','previews'],'restored trips retry quick suggestions after access enables traffic, before full previews');
 enabled=false;events.length=0;c.C.prepareForecasts=()=>{events.push('enabled');enabled=true;};await c.runRestFollowups(s,2); // cancelled generation does no work
 assert.deepEqual(events,[]);await c.runRestFollowups(s,1);assert.equal(events[0],'enabled','provider preparation runs before deciding whether forecasts are enabled');
 enabled=false;events.length=0;c.state.sites=[];c.bgAccess=async()=>{};await c.runRestFollowups(s,1);assert.deepEqual(events,[],'no rest candidates must not change traffic configuration or trigger previews');
}
Promise.all([progressive(),parallel(),fullParallel(),lateEnable()]).then(()=>console.log('Progressive verified highlights, independent legs and restored-trip forecast startup passed')).catch(e=>{console.error(e);process.exitCode=1;});
