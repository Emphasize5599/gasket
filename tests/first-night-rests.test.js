const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('assets/web/restui.js','utf8');
const snap={route:{},model:{}},road={ok:true,access:{outSeconds:40,backSeconds:40}},state={token:1};
const a={site:{id:'a'},d:1},b={site:{id:'b'},d:2},charger={site:{id:'charger'},d:3},next={site:{id:'next'},d:4};
let task,seen=[],recos=[],warm=false;
const ctx={
 root:{Tasks:true},Tasks:{begin:(name,o)=>{assert.equal(name,'first-night-forecasts');task=o;return ()=>{};},upsert(){}},
 C:{snapshot:()=>snap,access:true,previewRoad:(_s,x)=>x,previewForecast:async(x,t)=>{seen.push([x.site.id,t]);return {coverage:1};}},
 nightly:()=>({}),A:{S:{trip:{windowPlan:{autoFirstNight:true}}}},state,
 directoryGroups:()=>[{from:0},{from:1}],nightPlan:(_s,i)=>({leg:i===1?2:i,required:true,skips:[]}),
 chargerRestTypes:()=>['dc_fast'],recoKey:(_s,i,e)=>i+'|'+(e?'ev':'regular'),
 recoEntry:(_s,_i,e)=>recos.includes(!!e)?{items:[{zone:'green',k:e?2:1}]}:null,
 startReco:async(_i,e)=>recos.push(!!e),loadChargerDirectory:()=>({promise:Promise.resolve()}),
 legSites:(_s,i)=>i?[{x:next,k:3}]:[{x:a,k:0},{x:b,k:1}],
 chargerDirectoryRows:()=>[{x:charger,k:2}],nightVisible:()=>true,siteLeg:()=>0,
 bgAccess:async()=>{warm=true;},checkAccess:async(_s,x)=>{if(x===a)assert(warm);return road;},
 screen:{hidden:()=>false},overnightFit:()=>({minimum:6,leaveEarliest:0,windowEnd:1200000}),
 effective:p=>p,siteArrival:()=>0,clocks:{get:()=>'UTC'},restSampleTimes:()=>[600000,900000,1200000],
 RestTiming:require('../assets/web/resttiming'),laterRender(){},focusedTraffic:0,resumeAccess:new Set()
};
vm.createContext(ctx);
vm.runInContext(code.slice(code.indexOf('  function autoFirstNight('),code.indexOf('  async function runRestFollowups(')),ctx);
(async()=>{
 await ctx.prepareFirstNight(snap,1);
 assert(task.cancel);
 assert.deepEqual(recos,[false,true]);
 assert.deepEqual(seen.map(x=>x[0]),['b','b','b','charger','charger','charger','a','a','a']);
 const originalNightPlan=ctx.nightPlan;ctx.nightPlan=()=>({leg:0,required:true,skips:['2030-11-04'],window:{date:'2030-11-03'}});assert(ctx.initialNight(snap,{from:0}),'skipping a later night must not disable forecasts for the kept first rest');ctx.nightPlan=originalNightPlan;
 const count=seen.length;
 await ctx.prepareFirstNight(snap,1);
 assert.equal(seen.length,count,'opening the same directory should not restart work');
 console.log('First-night pass prepares suggested normal and charger stops, then all eligible stops, without restarting or precomputing a later night');
})().catch(e=>{console.error(e);process.exitCode=1;});
