const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),TireMath=require('../assets/web/tires'),TirePolicy=require('../assets/web/tirepolicy');
const source=fs.readFileSync('assets/web/gemma.js','utf8'),store=new Map();
const cars=[2,3,4].map((depth,i)=>({id:'car'+i,name:'Car '+i,info:{drive:'fwd'},tires:{type:'Touring',tread:{mode:'measure',depth},spare:{kind:'kit'}}}));
function boot(){const timers=new Map(),events={},pending=[],commands=[],prompts=[];let tid=0,total=0,active=0,max=0;const state={enabled:true,supported:true,ready:true,phase:'idle',busy:false,revision:'fixture'};
 const ctx={console,TextEncoder,Map,Set,Date,Promise,TireMath,TirePolicy,Event:function(t){this.type=t;},setTimeout:f=>{timers.set(++tid,f);return tid;},clearTimeout:i=>timers.delete(i),addEventListener:(n,f)=>(events[n]||(events[n]=[])).push(f),dispatchEvent:e=>(events[e.type]||[]).forEach(f=>f()),document:{getElementById:()=>null,addEventListener(){}},Tasks:{upsert(){},remove(){}},__app:{S:{cars,carId:cars[0].id,aiDefaultsVersion:2},N:{aiCommand(){},aiStatus:()=>JSON.stringify(state)},save(){},esc:s=>s,KV:{get:(n,k)=>store.get(n+'|'+k),put:(n,k,v)=>store.set(n+'|'+k,{v})}}};ctx.window=ctx;ctx.Garage={car:()=>cars.find(c=>c.id===ctx.__app.S.carId)};
 ctx.__trip={call:async(fn,arg)=>{if(fn==='aiGenerate'){prompts.push(arg);total++;active++;max=Math.max(max,active);state.busy=true;return new Promise(resolve=>pending.push(resolve));}commands.push(arg);return state;}};
 vm.runInNewContext(source,ctx);
 async function tick(){for(const [id,f]of [...timers]){timers.delete(id);f();}await new Promise(setImmediate);}
 async function complete(result){const resolve=pending.shift();assert(resolve);active--;state.busy=false;resolve(result||{text:JSON.stringify({summary:'The checked tread needs attention.',top:[{n:1,why:'Tread affects grip.'}]})});ctx.onGemmaStatus({...state});await new Promise(setImmediate);await tick();}
 const taskEvents=[];ctx.Tasks={upsert:(id,v)=>taskEvents.push(['upsert',id,v]),remove:id=>taskEvents.push(['remove',id])};
 return {ctx,tick,complete,pending,commands,prompts,taskEvents,total:()=>total,max:()=>max};
}
async function retries(){
 // Reproduce the empty-storage/demo queue transition: the dock must not vanish between cars.
 store.clear();const queued=boot();await queued.tick();await queued.tick();queued.taskEvents.length=0;
 await queued.complete();assert.equal(queued.total(),2);
 assert(!queued.taskEvents.some(e=>e[0]==='remove'&&e[1]==='gemma-advice'),'keep the same status dock through idle → next car');
 await queued.complete();await queued.complete();assert(queued.taskEvents.some(e=>e[0]==='remove'&&e[1]==='gemma-advice'),'remove dock when every car is finished');
 assert.equal(queued.commands.filter(c=>c==='releaseIdle').length,1,'release the warm engine once the batch drains');
 await queued.tick();assert.equal(queued.commands.filter(c=>c==='releaseIdle').length,1,'no idle-release status loop');
 store.clear();store.set('aiexplanations|other-car',{v:{raw:'unrelated'}});
 const x=boot();x.ctx.__app.S.cars=[cars[0]];await x.tick();await x.tick();
 const bad={text:JSON.stringify({summary:'Tread is below the level for safe wet stopping.',top:[{n:1,why:'Grip is reduced.'}]})};
 await x.complete(bad);assert.equal(x.total(),2);assert.match(x.prompts[1],/CORRECTION.*promises safety/);assert.equal(x.ctx.Gemma.answer(cars[0]),null);
 assert.equal(store.get('aiexplanations|other-car').v.raw,'unrelated','retry clears only affected answer');
 await x.complete({error:'runtime failed'});assert.equal(x.total(),3);await x.complete(bad);await x.tick();x.ctx.dispatchEvent(new x.ctx.Event('garagechange'));await x.tick();assert.equal(x.total(),3,'failed attempts are bounded, not an infinite loop');assert.match(x.ctx.Gemma.card(cars[0]),/after 3 attempts/);
 x.ctx.Gemma.retry();await x.tick();assert.equal(x.total(),4);await x.complete();assert.match(x.ctx.Gemma.card(cars[0]),/AI-written/);assert(x.ctx.Gemma.answer(cars[0]));
 const key=[...store.keys()].find(k=>k!=='aiexplanations|other-car'&&store.get(k).v);store.get(key).v.raw=bad.text;
 const y=boot();y.ctx.__app.S.cars=[cars[0]];await y.tick();await y.tick();assert.equal(y.total(),1,'invalid stored answer regenerates');assert.equal(store.get(key).v,null,'invalid persistent answer tombstoned');await y.complete();assert.match(y.ctx.Gemma.card(cars[0]),/AI-written/);
 const z=boot();z.ctx.__app.S.cars=[cars[0]];await z.tick();await z.tick();assert.equal(z.total(),0,'accepted retry survives restart');
}
async function scanCoordination(){
 store.clear();const x=boot();let scanning=true,avail=1024;
 x.ctx.KeylessGas={isBusy:()=>scanning};x.ctx.__app.N.memoryInfo=()=>JSON.stringify({availMem:avail*2**20,lowMemory:false});
 await x.tick();await x.tick();assert.equal(x.total(),0,'low-headroom scan defers optional model loads');
 await x.tick();assert.deepEqual(x.commands,['releaseIdle'],'release idle model only once; never cancel/download/disable');
 avail=6000;await x.tick();assert.equal(x.total(),0,'latch prevents reload thrash when unloading frees memory');
 scanning=false;x.ctx.dispatchEvent(new x.ctx.Event('keylessscanchange'));await x.tick();assert.equal(x.total(),1,'resume automatically when scan ends');
 scanning=true;avail=1024;x.ctx.dispatchEvent(new x.ctx.Event('keylessscanchange'));await x.tick();assert.equal(x.commands.length,1,'never interrupt active generation');
 await x.complete();assert(x.ctx.Gemma.answer(cars[0]),'in-flight result is retained');assert.equal(x.total(),1,'next queued car waits');
 await x.tick();assert.equal(x.commands.filter(c=>c==='releaseIdle').length,2);
 scanning=false;x.ctx.dispatchEvent(new x.ctx.Event('keylessscanchange'));await x.tick();await x.complete();await x.complete();assert.equal(x.total(),3);
 store.clear();const y=boot();y.ctx.KeylessGas={isBusy:()=>true};y.ctx.__app.N.memoryInfo=()=>JSON.stringify({availMem:6*2**30,lowMemory:false});await y.tick();await y.tick();assert.equal(y.total(),1,'ample headroom allows background AI');
}
(async()=>{let x=boot();await x.tick();await x.tick();assert.equal(x.total(),1,'startup begins work without visiting Garage');x.ctx.__app.S.carId=cars[2].id;x.ctx.dispatchEvent(new x.ctx.Event('garagechange'));await x.tick();await x.complete();assert(x.ctx.Gemma.answer(cars[0]),'switching cars must not discard the completed result');await x.complete();await x.complete();assert.equal(x.total(),3,'all cars prepared serially');assert.equal(x.max(),1);for(const c of cars)assert(x.ctx.Gemma.answer(c));
 x=boot();await x.tick();await x.tick();assert.equal(x.total(),0,'restart restores validated explanations without generation');for(const c of cars){assert(x.ctx.Gemma.answer(c));assert.match(x.ctx.Gemma.card(c),/AI-written/);}cars[1].tires.tread.depth=1;x.ctx.dispatchEvent(new x.ctx.Event('garagechange'));await x.tick();assert.equal(x.total(),1,'only changed setup regenerates');assert.equal(x.ctx.Gemma.answer(cars[1]),null);await x.complete();store.clear();x.ctx.dispatchEvent(new x.ctx.Event('cacheclear'));await x.tick();assert.equal(x.total(),2,'clearing cache invalidates memory too');await scanCoordination();await retries();console.log('Startup all-car queue, non-current completion, restart persistence, changed-only invalidation and cache clearing.');})().catch(e=>{console.error(e);process.exitCode=1;});
