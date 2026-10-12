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
  vm.runInNewContext(source,{window,console,setTimeout,Date});
  const known=Array.from({length:5},(_,i)=>({id:'saved'+i,brand:'exxon',lat:34+i,lng:-92,prices:{regular:{price:4}}}));
  const task=window.KeylessGas.refreshKnown(known);
  assert.equal(calls.length,2,'start two areas before waiting for either');
  pending.shift()(block?{blocked:true,error:'Check required'}:{stores:[]});
  await new Promise(resolve=>setImmediate(resolve));
  if(block)assert.equal(calls.length,2,'restriction prevents scheduling another area');
  while(pending.length){pending.shift()({stores:[]});await new Promise(resolve=>setImmediate(resolve));}
  const result=await task;
  assert.equal(peak,2);assert.equal(result.apiCalls,0);assert.equal(result.stations.length,5);
  assert.equal(result.websiteLoads,block?2:5);assert.equal(result.blocked,block);
  if(!block){const cached=await window.KeylessGas.refreshKnown(known);assert.equal(cached.websiteLoads,0);}
}
(async()=>{await run(false);await run(true);console.log('Two-reader concurrency, per-lane isolation, restriction stop, retained stations and cache passed');})().catch(e=>{console.error(e);process.exit(1);});
