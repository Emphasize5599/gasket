const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const workers=[],sent=[],ctx={Map,Set,Promise,Date,Math,Object,Number,Error,setTimeout,Blob:class{},URL:{createObjectURL:()=>''},navigator:{hardwareConcurrency:3}};ctx.window=ctx;
ctx.Trip={workerSource:'',plan:o=>({ok:true,label:o.label})};ctx.Pricing={workerSource:''};
ctx.Worker=class{constructor(){workers.push(this);this.active=0;}postMessage(d){structuredClone(d);assert.equal(this.active,0,'never queue behind a running worker');this.active=1;this.last=d;sent.push(d.options.label);}terminate(){}};
vm.runInNewContext(fs.readFileSync('assets/web/planner.js','utf8'),ctx);const P=ctx.Planner,tick=()=>new Promise(setImmediate),opts=label=>({label,model:{},lite:true});
function finish(w){const d=w.last;w.active=0;w.onmessage({data:{id:d.id,plan:{ok:true,label:d.options.label}}});}
(async()=>{
 let valid=true;const a=P.run(opts('a')),b=P.run(opts('b')),stale=P.run(opts('stale'),{valid:()=>valid}),c=P.run(opts('c'));await tick();assert.deepEqual(sent,['a','b']);assert.equal(P.stats().queued,2);
 const urgent=P.run(opts('interactive'),{priority:100,valid:()=>true});valid=false;finish(workers[0]);await tick();assert.deepEqual(sent,['a','b','interactive']);assert.equal((await stale).cancelled,true);assert.equal(P.stats().dropped,1);
 finish(workers[0]);await tick();assert.equal(sent.at(-1),'c');finish(workers[0]);finish(workers[1]);await Promise.all([a,b,c,urgent]);assert.equal(P.stats().queued,0);assert.equal(P.stats().active,0);
 console.log('Bounded worker dispatch, interactive priority, stale queued-work cancellation, serializable contexts and queue metrics passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
