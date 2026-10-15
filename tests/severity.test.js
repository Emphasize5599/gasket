const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
 const tasks=new Map();let active=0,peak=0,terminated=0,workers=0,hang=false,anchorCalls=0;
 const root={Tasks:{upsert:(id,x)=>tasks.set(id,x),remove:id=>tasks.delete(id)},__app:{KV:{get:()=>({v:Object.fromEntries(Object.entries(root.Severity.EXAMPLES).map(([k,rows])=>[k,rows.map(t=>({t,v:[1,0]}))]))})}}};
 class Worker{constructor(){workers++;}terminate(){terminated++;}postMessage(m){if(m.type==='init')return queueMicrotask(()=>this.onmessage({data:{type:'ready'}}));active++;peak=Math.max(peak,active);if(m.texts.includes('Example one'))anchorCalls++;if(hang)return;setTimeout(()=>{active--;this.onmessage({data:{type:'emb',id:m.id,n:m.texts.length,data:m.texts.flatMap(()=>[1,0])}});},2);}}
 vm.runInNewContext(fs.readFileSync('assets/web/severity.js','utf8'),{window:root,Worker,Blob,URL,setTimeout:(fn,ms)=>setTimeout(fn,ms>=20000?ms/100:ms),clearTimeout,console});
 const groups={hazard:['Example one','Example two']};
 const results=await Promise.all(Array.from({length:5},(_,i)=>root.Severity.compare('Query '+i,groups)));
 assert(results.every(r=>r.hazard===1));assert.equal(peak,1,'only one inference at a time');assert.equal(anchorCalls,1,'example embeddings shared across comparisons');assert.equal(tasks.size,0);
 hang=true;assert.equal(await root.Severity.compare('Hung inference',groups),null);assert.equal(root.Severity.state(),'failed');assert.equal(tasks.size,0,'hung request releases status bar');assert.equal(terminated,1);
 assert.equal(await root.Severity.compare('Retry immediately',groups),null);assert.equal(workers,1,'cooldown prevents an automatic restart loop');assert.equal(tasks.size,0);
 console.log('Serialized, shared-anchor inference, hung-request termination, status cleanup and retry cooldown passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
