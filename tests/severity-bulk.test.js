const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('assets/web/severity.js','utf8'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<1000;i++){if(fn())return;await sleep(5);}throw Error('Timed out waiting for rating queue');}
function harness(settings={}){
 const tasks=new Map(),logs=[],calls=[],timers=new Set();let workers=0,active=0,peak=0,skew=0,saves=0;
 const root={FLog:Object.fromEntries(['info','warn','debug'].map(level=>[level,(tag,message,data)=>logs.push({level,message,data})])),Tasks:{upsert:(id,v)=>tasks.set(id,v),remove:id=>tasks.delete(id)},__app:{S:settings.state||{},save:()=>saves++,KV:{get:()=>({v:Object.fromEntries(Object.entries(root.Severity.EXAMPLES).map(([k,rows])=>[k,rows.map(t=>({t,v:[1,0]}))]))})}}};
 const config={hang:settings.hang||(()=>false),device:settings.device||'wasm'};
 class Worker{
  constructor(){workers++;this.dead=false;this.flight=false;}
  terminate(){this.dead=true;if(this.flight){this.flight=false;active--;}}
  postMessage(m){if(m.type==='init')return queueMicrotask(()=>this.onmessage({data:{type:'ready',device:config.device,dtype:config.device==='wasm'?'q8':'fp16',gpuWhy:config.device==='wasm'?'no GPU adapter':''}}));
   calls.push(m.texts);active++;peak=Math.max(peak,active);this.flight=true;if(config.hang(m.texts))return;
   setTimeout(()=>{if(this.dead)return;this.flight=false;active--;this.onmessage({data:{type:'emb',id:m.id,n:m.texts.length,data:m.texts.flatMap(()=>[1,0])}});},settings.delay||2);
  }
 }
 class D extends Date{static now(){return Date.now()+skew;}}
 function timeout(fn,ms){const id=setTimeout(()=>{timers.delete(id);if(ms>=20000)skew+=ms;fn();},ms>=20000?ms/1000:ms);timers.add(id);return id;}
 vm.runInNewContext(source,{window:root,Date:D,Worker,Blob,URL,console,setTimeout:timeout,clearTimeout:id=>{timers.delete(id);clearTimeout(id);}});
 return {root,config,tasks,logs,calls,stats:()=>({workers,active,peak,saves}),close:()=>timers.forEach(clearTimeout)};
}
const recalls=Array.from({length:22},(_,i)=>({id:'fixture-recall-'+i,cons:'Recall '+i+' '+('Long official consequence text. '.repeat(30)),sum:'Official summary.'}));
(async()=>{
 // Individual CPU jobs take longer than the old 20s deadline (scaled here),
 // while queued work waits longer than the old 60s enqueue deadline.
 const h=harness({delay:25});try{
  let updates=0;h.root.Severity.rate(recalls,()=>{updates++;h.root.Severity.rate(recalls);});
  const hazards=Promise.all(Array.from({length:24},(_,i)=>h.root.Severity.compare('Hazard '+i,{hazard:['Example A','Example B']})));
  await until(()=>recalls.every(r=>h.root.Severity.get(r))&&!h.root.Severity.busy());assert((await hazards).every(x=>x&&x.hazard===1));
  assert.equal(h.stats().workers,1,'slow but healthy work never restarts the model');assert.equal(h.stats().peak,1,'hazards and recalls share one serialized inference lane');assert(h.calls.every(x=>x.length===1),'CPU always uses single-text inference');assert.equal(h.tasks.size,0);assert(updates>=22);assert(h.stats().saves>=22,'each completed recall is persisted');
  assert.equal(h.logs.filter(x=>x.message==='Recall rating batch completed').at(-1).data.completed,22);assert(h.logs.some(x=>x.message==='Lightweight inference completed'&&x.data.elapsedMs>=20));
  const restored=harness({state:JSON.parse(JSON.stringify(h.root.__app.S))});try{restored.root.Severity.rate(recalls);await sleep(5);assert.equal(restored.stats().workers,0,'cached ratings survive a restart without reloading the model');}finally{restored.close();}
 }finally{h.close();}
 const bad=harness({hang:texts=>texts.some(t=>t.startsWith('Recall 2 '))});try{
  let redraws=0;const redraw=()=>{redraws++;bad.root.Severity.rate(recalls,redraw);};bad.root.Severity.rate(recalls,redraw);
  await until(()=>bad.root.Severity.failure(recalls[2]));assert.equal(bad.stats().workers,2,'one automatic retry, not an endless restart loop');assert(bad.root.Severity.get(recalls[0])&&bad.root.Severity.get(recalls[1]));assert.equal(bad.root.Severity.get(recalls[2]),null,'failed inference is never a fabricated safety rating');assert.equal(bad.tasks.size,0,'no forever-running status');assert(bad.root.Severity.failure(recalls[21]),'unfinished work remains available for manual retry');
  const firstCount=bad.calls.filter(x=>x.some(t=>t.startsWith('Recall 0 '))).length;await sleep(100);assert.equal(bad.stats().workers,2);assert.equal(redraws,4,'two successful batches and two bounded failures, not a redraw storm');
  bad.config.hang=()=>false;bad.root.Severity.retry();await until(()=>recalls.every(r=>bad.root.Severity.get(r))&&!bad.root.Severity.busy());assert.equal(bad.calls.filter(x=>x.some(t=>t.startsWith('Recall 0 '))).length,firstCount,'retry resumes only unfinished recalls');assert.equal(bad.stats().workers,3);assert.equal(bad.tasks.size,0);
 }finally{bad.close();}
 const gpu=harness({device:'webgpu'});try{gpu.root.Severity.rate(recalls);await until(()=>recalls.every(r=>gpu.root.Severity.get(r))&&!gpu.root.Severity.busy());assert(gpu.calls.some(x=>x.length===4));assert(gpu.calls.every(x=>x.length<=4));assert.equal(gpu.stats().peak,1);}finally{gpu.close();}
 console.log('22 slow CPU recalls, concurrent hazard queue, persisted progress, bounded failures, resumable retries and GPU batch sizing passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
