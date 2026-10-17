const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../assets/web/pricing.js');
const source=fs.readFileSync(require.resolve('../assets/web/keylessgas.js'),'utf8');
async function run(block){
  const cache=new Map(),active=new Set(),pending=[],calls=[];
  let peak=0;
  const window={document:{},__app:{P,S:{keylessWorkers:4},KV:{get:(_,k)=>cache.get(k),put:(_,k,v)=>cache.set(k,{t:Date.now(),v})}},__trip:{call:(name,key,json)=>{
    assert.equal(name,'siteRead');assert(!active.has(key),'one request per native reader');
    active.add(key);peak=Math.max(peak,active.size);calls.push(key);
    const args=JSON.parse(json);assert(args.targets.length);
    return new Promise(resolve=>pending.push(r=>{active.delete(key);resolve(r);}));
  }}};
  let now=Date.now();class Clock extends Date{static now(){return now;}}
  vm.runInNewContext(source,{window,console,setTimeout,setInterval,clearInterval,Date:Clock});
  const known=Array.from({length:231},(_,i)=>({id:'saved'+i,brand:'exxon',lat:35+Math.floor(i/16)*0.4,lng:-110+(i%16)*0.4,prices:{regular:{price:4}}}));
  const progress=[];
  const task=window.KeylessGas.refreshKnown(known,(f,label,detail)=>progress.push({f,label,...detail}));
  assert.equal(calls.length,4,'start four areas before waiting for any');
  pending.shift()(block?{blocked:true,error:'Check required'}:{stores:[]});
  await new Promise(resolve=>setImmediate(resolve));
  if(block)assert.equal(calls.length,4,'restriction prevents scheduling another area');
  while(pending.length){now+=45000;pending.shift()({stores:[]});await new Promise(resolve=>setImmediate(resolve));}
  const result=await task;
  assert.equal(peak,4);assert.equal(result.apiCalls,0);assert.equal(result.stations.length,231);
  assert.equal(result.websiteLoads,block?4:231);assert.equal(result.blocked,block);
  if(!block){assert.equal(progress.at(-1).completed,231);assert.equal(progress.at(-1).f,1);assert(progress.some(p=>p.remainingSeconds>0),'ETA from measured durations');}
  if(!block){const cached=await window.KeylessGas.refreshKnown(known);assert.equal(cached.websiteLoads,0);}
}
async function cancelled(){
  const callbacks=[],calls=[],cache=new Map(),cancelled=[],observations=[];
  const window={document:{},__app:{P,S:{keylessWorkers:4},KV:{get:(_,k)=>cache.get(k),put:(_,k,v)=>cache.set(k,{v,t:Date.now()})},N:{cancelSiteRead:k=>cancelled.push(k)}},__trip:{call:(fn,key,args)=>{calls.push(key);return new Promise(resolve=>callbacks.push(resolve));}}};
  vm.runInNewContext(source,{window,console,setTimeout,setInterval,clearInterval,Date});
  window.PriceHistory={observe:stations=>observations.push(...stations)};
  const known=Array.from({length:4},(_,i)=>({id:'saved'+i,brand:'exxon',lat:34+i,lng:-92,prices:{regular:{price:4}}}));
  const task=window.KeylessGas.refreshKnown(known);
  let finished=false;task.then(()=>finished=true);
  callbacks.shift()({stores:[{placeId:'saved0',name:'Exxon',lat:34,lng:-92,prices:{regular:{price:3.12}}},{id:'unrelated',name:'Exxon',lat:0,lng:0,prices:{regular:{price:1.99}}}]});
  await new Promise(r=>setImmediate(r));
  assert.equal(finished,false);assert(observations.some(s=>s.prices.regular&&s.prices.regular.price===3.12),'persist completed prices while other areas still run');
  assert.equal(Array.from(cache.values()).find(x=>x.v.stores).v.stores.length,1,'retain only known-station neighbors, not an ever-growing unrelated catalog');
  window.KeylessGas.cancel();const result=await task;
  assert.equal(result.cancelled,true);assert.equal(result.updated,1);assert.equal(result.stations[0].prices.regular.price,3.12);
  assert.equal(calls.length,4);assert.deepEqual(cancelled,['gasweb','gasweb2','gasweb3','gasweb4','walmart','murphy']);
  callbacks.forEach(resolve=>resolve({stores:[{placeId:'saved0',name:'Exxon',lat:34,lng:-92,prices:{regular:{price:1.12}}}]}));
  await new Promise(r=>setImmediate(r));assert.equal(result.stations[0].prices.regular.price,3.12,'late cancelled results ignored');
}
const native=fs.readFileSync('src/com/bensanzone/fuelmap/MainActivity.java','utf8');
async function pausedScan(discovery,cancelPaused){
 const active=new Map(),calls=[],checks=[],progress=[],cache=new Map();
 const window={document:{},__app:{P,S:{keylessWorkers:4},siteOn:()=>false,showSiteCheck:k=>checks.push(k),KV:{get:(n,k)=>cache.get(n+'|'+k),put:(n,k,v)=>cache.set(n+'|'+k,{v,t:Date.now()})},N:{cancelSiteRead:k=>{const x=active.get(k);if(x){active.delete(k);x.resolve({cancelled:true});}}}},__trip:{call:(fn,key,json)=>{assert(!active.has(key),'same native reader overlaps');const args=JSON.parse(json);calls.push(args.url);return new Promise(resolve=>active.set(key,{resolve,args}));}}};
 vm.runInNewContext(source,{window,Date,setTimeout,clearTimeout,setInterval,clearInterval});
 const known=Array.from({length:9},(_,i)=>({id:'saved'+i,brand:'exxon',lat:34+i*.5,lng:-92,prices:{regular:{price:4}}}));
 const K=window.KeylessGas,task=discovery?K.discover(known.map(s=>({lat:s.lat,lng:s.lng,radius:8})),(f,t)=>progress.push(t),'regular',true):K.refreshKnown(known,(f,t)=>progress.push(t));
 const flush=()=>new Promise(r=>setImmediate(r));await flush();
 function reply(key,r){const x=active.get(key);assert(x);active.delete(key);x.resolve(r);return x;}
 const first=[...active.keys()][0],doneUrl=active.get(first).args.url;reply(first,{stores:[],detail:{exhausted:true}});await flush();
 const blockedKey=[...active.keys()][0];reply(blockedKey,{blocked:true,error:'Unusual traffic'});await flush();
 assert.equal(K.isPaused(),true);assert.equal(checks.length,1);assert.equal(checks[0],blockedKey);assert.equal(active.size,0,'all native reads stop, not just new admissions');assert.match(progress.at(-1),/Paused.*unusual traffic/);
 const before=calls.length;await flush();assert.equal(calls.length,before,'no scanning while challenge is pending');assert.equal(K.onVerified('wrong-site'),false);
 if(cancelPaused){K.cancel();const r=await task;assert(r.cancelled);assert.equal(r.completedAreas,1,'blocked/in-flight areas never counted as completed');assert.equal(calls.length,before);return;}
 assert.equal(K.onVerified(blockedKey),true);await flush();assert(active.size>0,'Done retries unfinished work');
 // A closed but unsolved challenge must pause again rather than looping through remaining areas.
 const again=[...active.keys()][0];reply(again,{blocked:true,error:'Unusual traffic'});await flush();assert.equal(checks.length,2);assert.equal(active.size,0);assert.equal(K.isPaused(),true);K.onVerified(again);await flush();
 let safety=0;while(active.size){assert(++safety<20);for(const key of [...active.keys()])reply(key,{stores:[],detail:{exhausted:true}});await flush();}
 const r=await task;assert.equal(r.completedAreas,9);assert.equal(r.blocked,false);assert.equal(r.cancelled,false);assert.equal(calls.filter(u=>u===doneUrl).length,1,'completed areas stay complete, even for a forced scan');assert.equal(K.isBusy(),false);
}
async function officialCheck(site){
 const active=new Map(),checks=[];let checked=false,reads=0;
 const window={document:{},__app:{P,S:{keylessWorkers:4},siteOn:k=>k===site,showSiteCheck:k=>checks.push(k),KV:{get:()=>null,put:()=>true},N:{cancelSiteRead:k=>{const r=active.get(k);if(r){active.delete(k);r({cancelled:true});}}}},__trip:{call:async(fn,key,json)=>{reads++;if(key===site&&!checked)return {blocked:true,error:site==='walmart'?'Robot or human?':'Access denied'};return {stores:[],nodes:[],detail:{exhausted:true}};}}};
 vm.runInNewContext(source,{window,Date,setTimeout,clearTimeout,setInterval,clearInterval});
 const K=window.KeylessGas,task=K.refreshKnown([{id:site,brand:site,lat:34,lng:-92,prices:{regular:{price:4}}}]);
 await new Promise(r=>setImmediate(r));assert.equal(K.isPaused(),true);assert.deepEqual(checks,[site]);const n=reads;await new Promise(r=>setImmediate(r));assert.equal(reads,n);
 checked=true;assert.equal(K.onVerified(site),true);const result=await task;assert.equal(result.completedAreas,1);assert.equal(result.blocked,false);assert.equal(result.stations[0].prices.regular.price,4,'old prices survive a check with no replacement price');
}
assert.equal((native.match(/public boolean onRenderProcessGone/g)||[]).length,2,'both UI and hidden views handle renderer exit');
assert(/completedReads % 4/.test(native),'recycle hidden views every four reads');assert(!/old\.view\.clearCache\(false\)/.test(native),'keep shared HTTP resources warm when recycling views');assert(/old\.view\.destroy\(\)/.test(native));assert(/if \(isGasWorker\(key\)\) ws\.setBlockNetworkImage\(true\)/.test(native),'invisible gas readers do not download images');
assert.match(native,/view\.loadUrl\("about:blank"\); view\.clearHistory\(\)/);
// Pages that fail to load (a burst of readers, a check's aftermath) are read again after the pass, on at most
// eight lanes, until they load or have failed three times; before, each became a permanent hole in the route.
async function lostPages(){
 const active=new Map(),attempts={},cache=new Map();let peak=0;
 const window={document:{},__app:{P,S:{keylessWorkers:12},siteOn:()=>false,showSiteCheck:()=>{},KV:{get:(n,k)=>cache.get(n+'|'+k),put:(n,k,v)=>cache.set(n+'|'+k,{v,t:Date.now()})},N:{}},__trip:{call:(fn,key,json)=>{const args=JSON.parse(json);return new Promise(resolve=>{active.set(key,{resolve,args});peak=Math.max(peak,active.size);});}}};
 vm.runInNewContext(source,{window,Date,setTimeout,clearTimeout,setInterval,clearInterval});
 const areas=Array.from({length:20},(_,i)=>({lat:34+i*.5,lng:-92,radius:8})),K=window.KeylessGas;
 const fails={2:1,5:2,7:1,9:9};   // area -> how many times its page fails before it loads
 const task=K.discover(areas,null,'regular',true),flush=()=>new Promise(r=>setImmediate(r));
 const areaOf=url=>areas.findIndex(a=>url.includes('@'+a.lat.toFixed(5)+','));
 let retryPeak=0,safety=0;
 while(K.isBusy()&&++safety<400){
   await flush();await new Promise(r=>setTimeout(r,20));
   for(const [key,x] of [...active]){
     active.delete(key);const i=areaOf(x.args.url);attempts[i]=(attempts[i]||0)+1;
     if(attempts[i]>1)retryPeak=Math.max(retryPeak,active.size+1);
     if(attempts[i]<=(fails[i]||0))x.resolve(i===7?{stores:[],error:'Search response timed out',code:'reader'}:{stores:[],error:'Page could not load',code:'network'});
     else x.resolve({stores:[{placeId:'p'+i,name:'Exxon',brand:'exxon',lat:areas[i].lat,lng:-92,prices:{regular:{price:3}}}],detail:{exhausted:true,stopReason:'end'}});
   }
 }
 const r=await task;
 assert(Object.keys(attempts).length===20&&areas.every((_,i)=>attempts[i]>=1),'every area read');
 assert.equal(attempts[2],2);assert.equal(attempts[5],3);assert.equal(attempts[7],2,'a reader timeout is read again too');assert.equal(attempts[9],3,'three tries at most');
 assert.equal(r.completedAreas,20);assert.equal(r.stations.filter(s=>/^p/.test(s.placeId)).length,19,'every page that loaded on a retry adds its stations');
 assert(retryPeak<=8,'retries run on at most eight readers ('+retryPeak+')');
 assert.deepEqual(K.retryable({stores:[],error:'Google gas results could not be read',code:'unreadable'}),true);
 assert.equal(K.retryable({stores:[],blocked:true,error:'Site access restricted'}),false,'a check pauses, it is not retried');
 assert.equal(K.retryable({stores:[{}],error:'Search response timed out',code:'reader'}),false,'a page that found stations keeps them');
 assert.equal(K.retryable({stores:[],code:'no_prices',error:'Google provided no matching prices'}),false);
}
// Just after a check closes, only eight readers take new areas for 45 s, so fifty pages don't bring it straight back.
async function calmAfterCheck(){
 const active=new Map();let now=Date.now();class Clock extends Date{static now(){return now;}}
 const window={document:{},__app:{P,S:{keylessWorkers:16},siteOn:()=>false,showSiteCheck:()=>{},KV:{get:()=>null,put:()=>{}},N:{cancelSiteRead:k=>{const x=active.get(k);if(x){active.delete(k);x.resolve({cancelled:true});}}}},__trip:{call:(fn,key,json)=>new Promise(resolve=>active.set(key,{resolve,args:JSON.parse(json)}))}};
 vm.runInNewContext(source,{window,Date:Clock,setTimeout,clearTimeout,setInterval,clearInterval});
 const K=window.KeylessGas,task=K.discover(Array.from({length:60},(_,i)=>({lat:30+i*.3,lng:-92,radius:8})),null,'regular',true),flush=()=>new Promise(r=>setImmediate(r));
 await flush();assert.equal(active.size,16);
 const key=[...active.keys()][0],x=active.get(key);active.delete(key);x.resolve({blocked:true,error:'Unusual traffic'});await flush();
 assert.equal(K.isPaused(),true);assert.equal(K.onVerified(key),true);await flush();await new Promise(r=>setTimeout(r,50));
 assert(active.size<=8,'right after the check only eight readers ('+active.size+')');
 now+=46000;await new Promise(r=>setTimeout(r,1200));await flush();
 assert(active.size>8,'after the calm period every reader works again ('+active.size+')');
 K.cancel();await task;
}
(async()=>{await lostPages();await calmAfterCheck();await run(false);await run(true);await cancelled();await pausedScan(true,false);await pausedScan(false,false);await pausedScan(true,true);await pausedScan(false,true);await officialCheck('walmart');await officialCheck('murphy');console.log('Uncapped 231-area refresh, ETA, four readers, cancellation, partial results, restrictions and cache passed');})().catch(e=>{console.error(e);process.exit(1);});
