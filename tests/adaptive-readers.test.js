const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),P=require('../assets/web/pricing'),K=require('../assets/web/keylessgas');
(async()=>{
 let now=100000,available=2500,sequence=0;const active=new Map(),timers=new Map(),intervals=new Set(),released=[],logs=[];
 class Clock extends Date{static now(){return now;}}
 const later=(fn,ms)=>{const id=++sequence;timers.set(id,{fn,at:now+ms});return id;};
 const window={document:{},FLog:{info:(cat,msg,data)=>logs.push({msg,data}),debug:()=>{}},PriceHistory:{observe:()=>{}},__app:{P,S:{keylessWorkers:8},siteOn:()=>false,N:{memoryInfo:()=>JSON.stringify({totalMem:16*2**30,availMem:available*2**20,lowMemory:available<300}),releaseGasReader:k=>released.push(k),releaseGasReaders:()=>{},cancelSiteRead:()=>{}},KV:{get:()=>null,put:()=>true}},__trip:{call:(fn,key)=>new Promise(resolve=>{assert(!active.has(key));active.set(key,resolve);})}};
 vm.runInNewContext(fs.readFileSync('assets/web/keylessgas.js','utf8'),{window,Date:Clock,setTimeout:later,clearTimeout:id=>timers.delete(id),setInterval:f=>{intervals.add(f);return f;},clearInterval:f=>intervals.delete(f)});
 const task=window.KeylessGas.discover(Array.from({length:100},()=>K.area(34,-92,8)),null,'regular');
 const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
 assert.equal(active.size,4,'memory-capable phones ramp up instead of bursting all 20 WebViews at once');
 async function round(ms){now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}const pending=[...active.values()];active.clear();pending.forEach(r=>r({stores:[],detail:{exhausted:true}}));await flush();}
 await round(2000);assert(active.size>=5);await round(2000);assert(active.size>=6);
 available=100;await round(2000);assert.equal(active.size,4,'pressure reduces admission without cancelling completed/in-flight results');
 available=2500;await round(11000);await round(2000);await round(2000);
 assert(active.size>4,'paused lanes resume once headroom recovers');assert(logs.some(x=>x.msg==='Website reader resumes'));assert(released.length>0);
 window.KeylessGas.cancel();const result=await task;assert(result.cancelled);assert(result.completedAreas>0);assert.equal(timers.size,0);assert.equal(intervals.size,0);
 console.log('Actual discovery pool: staggered startup, pressure pause, headroom recovery, four-reader floor and prompt cancellation of paused lanes passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
