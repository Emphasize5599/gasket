const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
 const tasks=new Map();let active=0,peak=0,terminated=0,workers=0,hang=false,anchorCalls=0;
 let warns=0,logs=[];const root={FLog:{info:(a,b)=>logs.push(b),warn:(a,b)=>{warns++;logs.push(b);}},Tasks:{upsert:(id,x)=>tasks.set(id,x),remove:id=>tasks.delete(id)},__app:{S:{},KV:{get:()=>({v:Object.fromEntries(Object.entries(root.Severity.EXAMPLES).map(([k,rows])=>[k,rows.map(t=>({t,v:[1,0]}))]))})}}};
 let readyMsg={type:'ready'};class Worker{constructor(){workers++;}terminate(){terminated++;}postMessage(m){if(m.type==='init')return queueMicrotask(()=>this.onmessage({data:readyMsg}));active++;peak=Math.max(peak,active);if(m.texts.includes('Example one'))anchorCalls++;if(hang)return;setTimeout(()=>{active--;this.onmessage({data:{type:'emb',id:m.id,n:m.texts.length,data:m.texts.flatMap(()=>[1,0])}});},2);}}
 let skew=0;class D extends Date{static now(){return Date.now()+skew;}}
 vm.runInNewContext(fs.readFileSync('assets/web/lightweightgpu.js','utf8')+'\n'+fs.readFileSync('assets/web/severity.js','utf8'),{Date:D,window:root,Worker,Blob,URL,setTimeout:(fn,ms)=>setTimeout(fn,ms>=20000?ms/100:ms),clearTimeout,console});
 const groups={hazard:['Example one','Example two']};
 const results=await Promise.all(Array.from({length:5},(_,i)=>root.Severity.compare('Query '+i,groups)));
 assert(results.every(r=>r.hazard===1));assert.equal(peak,1,'only one inference at a time');assert.equal(anchorCalls,1,'example embeddings shared across comparisons');assert.equal(tasks.size,0);
 hang=true;assert.equal(await root.Severity.compare('Hung inference',groups),null);assert.equal(root.Severity.state(),'failed');assert.equal(tasks.size,0,'hung request releases status bar');assert.equal(terminated,1);
 assert.equal(await root.Severity.compare('Retry immediately',groups),null);assert.equal(workers,1,'cooldown prevents an automatic restart loop');assert.equal(tasks.size,0);
 assert.equal(root.Severity.device(),'wasm','no WebGPU offered: the CPU, and it says so');assert(logs.some(l=>/Recall rating model on the CPU/.test(l)));
 // the 0.0.217 storm: during the cooldown a rating ask failed at once, its redraw asked again, ~every 30 ms for two minutes
 let redraws=0;const w0=warns,list=[{id:'R1',cons:'Fire risk',sum:'Wiring can short'}];const again=()=>{redraws++;if(redraws<50)root.Severity.rate(list,again);};
 root.Severity.rate(list,again);await new Promise(r=>setTimeout(r,60));
 assert.equal(redraws,0,'no redraw loop while the model rests');assert.equal(warns,w0,'no warning per ask during the rest');assert.equal(workers,1,'and no new worker yet');
 hang=false;skew=60000;await new Promise(r=>setTimeout(r,900));   // the rest (60 s, scaled 1/100 here) ends: one retry, rated, one redraw
 assert.equal(workers,2,'one retry after the rest');assert.equal(redraws,1);assert(root.Severity.get(list[0]),'rated after the retry');
 console.log('Serialized, shared-anchor inference, hung-request termination, status cleanup and retry cooldown passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
