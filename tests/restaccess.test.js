const assert=require('node:assert/strict'),R=require('../assets/web/restaccess');
for(const [reason,key] of [['HTTP 404','missing'],['No usable time-specific Google traffic profiles','traffic'],['Site access road could not be verified','route'],['Campground timezone unavailable','timezone'],['captcha verification required','verification'],['Network timeout','network']])assert.equal(R.failureKind(reason).key,key);
const a={lat:34,lng:-92},b={lat:34.01,lng:-92},t=Date.UTC(2027,0,1,12),value={seconds:60,meters:1000,pts:[a,b]},key=R.identity('google',a,b,t,{});
assert.notEqual(key,R.identity('google',b,a,t,{}));assert.notEqual(key,R.identity('here',a,b,t,{}));assert.notEqual(key,R.identity('google',a,b,t+60000,{}));assert.notEqual(key,R.identity('google',a,b,t,{tolls:true}));assert.notEqual(key,R.identity('google',a,{...b,lng:-92.00001},t,{}));
assert(R.returnTooLong(3601,0,60));assert(!R.returnTooLong(600,1,60));
assert.equal(R.refreshDays({}),7);assert.equal(R.refreshDays({restRefreshDays:14}),14);assert.equal(R.refreshDays({restRefreshDays:0}),1);assert.equal(R.refreshDays({restRefreshDays:999}),365);
const durable=R.geometryIdentity('google',a,b,{});assert.notEqual(durable,R.geometryIdentity('google',b,a,{}));assert.notEqual(durable,R.geometryIdentity('google',a,b,{tolls:true}));assert.notEqual(durable,R.geometryIdentity('here',a,b,{}));assert.equal(durable,R.geometryIdentity('google',{...a,lat:a.lat+1e-8},b,{}),'insignificant projection rounding does not split saved access identities');
(async()=>{
 const store=new Map(),io={get:(k,ttl)=>{const r=store.get(k);return r&&Date.now()-r.at<ttl?r:null;},put:(k,v)=>store.set(k,structuredClone(v))};let reads=0;
 let cache=R.create(io);const read=async(_valid,start)=>{start();reads++;return value;};
 await Promise.all([cache.read(key,10000,()=>true,read),cache.read(key,10000,()=>true,read)]);assert.equal(reads,1);assert.equal(cache.stats().shared,1);
 cache=R.create(io);const v=await cache.read(key,10000,()=>true,read);assert.equal(reads,1,'a restart reuses directed access geometry');v.pts[0].lat=0;assert.equal((await cache.read(key,10000,()=>true,read)).pts[0].lat,34,'callers cannot poison cached geometry');
 store.get('rest-access-v1|'+key).at-=20000;await cache.read(key,10000,()=>true,read);assert.equal(reads,2,'expired access is fetched again');
 store.get('rest-access-v1|'+key).value.pts=null;await cache.read(key,10000,()=>true,read);assert.equal(reads,3,'malformed stored data is replaced rather than repeatedly failing');
 let release,valid=true;const shared=R.create({get:()=>null,put:()=>{}}),held=()=>new Promise(r=>release=r),one=shared.read(key,1000,()=>valid,held),two=shared.read(key,1000,()=>true,held);await Promise.resolve();valid=false;release(value);await assert.rejects(one,/cancel/);assert(await two,'a cancelled consumer does not cancel another consumer');
 let puts=0;cache=R.create({get:()=>null,put:()=>puts++});await assert.rejects(cache.read(key,1000,()=>true,async()=>{throw Error('HTTP 429');}));assert.equal(puts,0,'failures are never saved as access');
 await assert.rejects(cache.read(key,1000,()=>true,async()=>({...value,seconds:NaN})),/unavailable/);assert.equal(puts,0,'malformed service data is never cached as verified');
 const old=cache.read(key,1000,()=>true,held);await Promise.resolve();cache.clear();release(value);await assert.rejects(old,/cancel/);assert.equal(puts,0,'clearing the cache prevents late requests restoring stale data');
 const rows=Array.from({length:2900},(_,i)=>({id:i,leg:i%4,d:(i%4)*1000+1+Math.floor(i/4),offset:i%9})),ordered=R.order(rows,[1000,2000,3000,4000]);assert.equal(ordered.length,2900);assert.equal(new Set(ordered).size,2900);assert.deepEqual(ordered.slice(0,4).map(x=>x.leg),[0,1,2,3],'every leg gets early access results');
 // Virtual time tests fixed start spacing, retry-after and bounded retries without real waits.
 let clock=0,id=0,timers=new Map(),starts=[],attempt=0;const limiter=R.limiter({now:()=>clock,rate:6,max:2,readers:()=>50,setTimeout:(fn,ms)=>{timers.set(++id,{fn,at:clock+ms});return id;},clearTimeout:k=>timers.delete(k)});
 const jobs=Array.from({length:12},()=>limiter.run(async()=>{starts.push(clock);if(attempt++===2)throw Object.assign(Error('HTTP 429'),{status:429,retryAfter:'2'});return true;}));
 async function tick(){for(let k=0;k<12;k++)await Promise.resolve();if(timers.size){const [key,t]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(key);clock=t.at;t.fn();}}
 for(let i=0;i<150;i++)await tick();await Promise.all(jobs);assert.equal(starts.length,13);assert(starts.every((s,i)=>!i||s-starts[i-1]>=1000/6-.001));assert(starts[3]-starts[2]>=2000,'server Retry-After pauses all queued reads');assert.equal(limiter.stats().retries,1);assert.equal(limiter.stats().readers,2,'the fixed concurrency limit wins over a high slider');
 console.log('Access restart/TTL/direction/time/settings identity, sharing/cancellation, failure/clear isolation, 2,900-site fairness and fixed rate/retry-after pacing passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
