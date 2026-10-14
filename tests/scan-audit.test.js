const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),P=require('../assets/web/pricing');
const source=fs.readFileSync('assets/web/keylessgas.js','utf8');
async function scan(mode){
 let time=100000,memReads=0,reads=0,writes=0;const timers=new Set(),logs=[],cache=new Map(),pending=[];
 cache.set('gasmeta|last-scan',{v:{id:'old',kind:'refresh',status:'running',completed:3,total:90,elapsedMs:15000}});
 class Clock extends Date{static now(){return time;}}
 const window={document:{},FLog:{info:(a,m,v)=>logs.push({m,v}),debug:()=>{}},__app:{P,S:{keylessWorkers:8},siteOn:()=>false,N:{memoryInfo:()=>{memReads++;return JSON.stringify({totalMem:8*2**30,availMem:(mode==='low'?500:2000-memReads)*2**20,appHeapUsed:(20+memReads)*2**20,appHeapMax:256*2**20,readerRecycles:4,rendererLosses:mode==='renderer'?1:0});},releaseGasReaders:()=>{},cancelSiteRead:()=>{}},KV:{get:(ns,k)=>cache.get(ns+'|'+k),put:(ns,k,v)=>{if(k==='last-scan')writes++;cache.set(ns+'|'+k,{v});}}},PriceHistory:{observe:()=>{}},__trip:{call:async(fn,key,json)=>{
   reads++;time+=5000;timers.forEach(fn=>fn());const args=JSON.parse(json),s=args.targets[0];
   if(mode==='renderer')return {cancelled:true,code:'renderer',error:'renderer stopped'};
   if(mode==='cancel')return new Promise(r=>pending.push(r));
   return {stores:[{placeId:s.id,name:'Exxon',lat:s.lat,lng:s.lng,prices:{regular:{price:3}}}]};
 }}};
 vm.runInNewContext(source,{window,FLog:window.FLog,Date:Clock,setInterval:f=>{timers.add(f);return f;},clearInterval:f=>timers.delete(f),setTimeout});
 const known=Array.from({length:24},(_,i)=>({id:'s'+i,brand:'exxon',lat:34+i*.1,lng:-100,prices:{regular:{price:4}}}));
 const task=window.KeylessGas.refreshKnown(known,null,[],'regular');if(mode==='cancel')window.KeylessGas.cancel();const result=await task,summary=cache.get('gasmeta|last-scan').v;
 assert.equal(summary.status,mode==='renderer'||mode==='cancel'?'cancelled':'finished');assert.equal(timers.size,0,'interval always cleaned up');
 assert(logs.some(x=>x.m==='Previous scan was unfinished'));assert(logs.some(x=>x.m==='Scan diagnostics'));assert(summary.peakAppJavaHeapMB>=21);assert(summary.minSystemAvailableMB>0);assert.equal(summary.memory.readerRecycles,4);
 if(mode==='ok'){assert.equal(result.updated,24);assert.equal(summary.checkpoints,24);assert.equal(summary.completed,24);assert(logs.some(x=>x.m==='Scan heartbeat'&&x.v.oldestActiveMs>=15000));assert(writes<reads,'checkpoint writes are time-throttled, not per area');}
 if(mode==='low'){assert.equal(summary.retired,4);assert.equal(result.completedAreas,24);}
 assert(!JSON.stringify(summary).includes('Exxon'));assert(!JSON.stringify(summary).includes('-100'),'audit has no route coordinates');
}
(async()=>{for(const mode of ['ok','low','renderer','cancel'])await scan(mode);console.log('Scan heartbeat/checkpoints, restart audit, sampled memory, refresh low-memory retirement and renderer/cancel cleanup passed');})().catch(e=>{console.error(e);process.exitCode=1;});
