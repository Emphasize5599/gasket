const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../assets/web/pricing.js');
const source=fs.readFileSync(require.resolve('../assets/web/keylessgas.js'),'utf8');
async function run(block){
  const cache=new Map(),active=new Set(),pending=[],calls=[];
  let peak=0;
  const window={document:{},__app:{P,KV:{get:(_,k)=>cache.get(k),put:(_,k,v)=>cache.set(k,{t:Date.now(),v})}},__trip:{call:(name,key,json)=>{
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
  const window={document:{},__app:{P,KV:{get:(_,k)=>cache.get(k),put:(_,k,v)=>cache.set(k,{v,t:Date.now()})},N:{cancelSiteRead:k=>cancelled.push(k)}},__trip:{call:(fn,key,args)=>{calls.push(key);return new Promise(resolve=>callbacks.push(resolve));}}};
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
assert.equal((native.match(/public boolean onRenderProcessGone/g)||[]).length,2,'both UI and hidden views handle renderer exit');
assert(/completedReads % 4/.test(native),'recycle hidden views every four reads');assert(!/old\.view\.clearCache\(false\)/.test(native),'keep shared HTTP resources warm when recycling views');assert(/old\.view\.destroy\(\)/.test(native));assert(/if \(isGasWorker\(key\)\) ws\.setBlockNetworkImage\(true\)/.test(native),'invisible gas readers do not download images');
assert.match(native,/view\.loadUrl\("about:blank"\); view\.clearHistory\(\)/);
(async()=>{await run(false);await run(true);await cancelled();console.log('Uncapped 231-area refresh, ETA, four readers, cancellation, partial results, restrictions and cache passed');})().catch(e=>{console.error(e);process.exit(1);});
