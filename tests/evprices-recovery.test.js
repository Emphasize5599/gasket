const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function boot(answer){
 const cache=new Map(),calls=[],checks=[],tasks=new Map(),c={console,Map,Set,Date,Math,JSON,Promise,Number,Object,Array,String,RegExp,Error,isFinite,encodeURIComponent,setTimeout:f=>{f();}};c.window=c;
 c.__app={S:{},KV:{get:(n,k)=>cache.get(k),put:(n,k,v)=>cache.set(k,{v})},showSiteCheck:(...a)=>checks.push(a)};
 c.Tasks={upsert:(k,v)=>tasks.set(k,v),remove:k=>tasks.delete(k)};
 c.__trip={call:async(...a)=>{calls.push(a);return answer(...a);}};
 for(const f of ['chargerdata','evprices'])vm.runInNewContext(fs.readFileSync('assets/web/'+f+'.js','utf8'),c);
 return {c,E:c.EVPrices,C:c.ChargerData,cache,calls,checks,tasks};
}
const station=()=>({st:{id:'fixture',network:'ChargePoint',netIds:{station:['USCPIL987654'],posts:['34567891']},country:'US'},dc:true,kw:50});
const wait=()=>new Promise(setImmediate);
(async()=>{
 let count=0,x=boot((fn,key,args)=>{assert.equal(key,'chargepoint');assert.match(JSON.parse(args).url,/\/987654$/);return ++count===1?{blocked:true}:{text:'Price Prices Set by Test Energy Rate $0.14 / kWh Service Fee $0.49 / session Taxes and Fees 6%'};});
 x.cache.set('cp-v1|3456789,34567891',{v:{none:true,missing:true}});
 let items=[station()],p=x.E.annotate(items,{make:'Example'});await wait();assert(x.E.isPaused());assert.equal(x.calls.length,1);assert(x.tasks.has('ev-price-check'));await wait();assert.equal(x.calls.length,1,'nothing advances while user check is pending');assert.equal(x.E.onVerified('walmart'),false);x.E.onVerified('chargepoint');await p;
 assert.equal(x.calls.length,2);assert.equal(items[0].st.netPrice.rate,.14);assert.equal(items[0].st.netPrice.fee,.49);assert.equal(x.C.tariff(items[0].st,.5,50).estimated,true);assert(!x.E.isPaused());assert(!x.tasks.has('ev-price-check'));
 const before=x.calls.length;await x.E.annotate([station()],{});assert.equal(x.calls.length,before,'successful result cached with corrected identity');
 x=boot(()=>({blocked:true}));p=x.E.annotate([station(),{...station(),st:{...station().st,id:'second'}}],{});await wait();x.E.dismissCheck();await p;assert.equal(x.calls.length,1,'dismissal stops this provider, not another request');assert.equal(x.cache.size,0,'restrictions never cached as missing/free');
 x=boot(()=>({blocked:true}));p=x.E.annotate([station()],{});await wait();x.E.cancel();await p;assert(!x.E.isPaused());assert.equal(x.calls.length,1);
 x=boot(()=>({error:'Page could not load',code:'network'}));await x.E.annotate([station()],{});assert.equal(x.cache.size,0,'transient errors are not cached as unavailable pages');
 for(const rate of [null,'',false,0,NaN])assert.equal(x.C.tariff({country:'US',netPrice:{rate,uom:'kwh'}},.5,50).price,.5,'unconfirmed zero/malformed rate cannot become free');
 assert.equal(x.C.tariff({country:'US',netPrice:{rate:0,free:true,uom:'kwh'}},.5,50).price,0);
 assert.equal(x.C.tariff({country:'US',source:'DOE AFDC',pricing:'Free'},.5,50).price,0,'explicit government Free note remains supported');
 assert.equal(x.E.parseChargePoint('Price Contact host Free mobile app'),null,'unrelated Free marketing is not free charging');
 const java=fs.readFileSync('src/com/bensanzone/fuelmap/MainActivity.java','utf8');assert.match(java,/__gasketChargePointHttpStatus/);assert.match(java,/verificationUrl = at/);
 console.log('Correct ChargePoint station identity, stale miss-cache replacement, visible check pause/retry/dismiss/cancel, fees and unknown-versus-free prices.');
})().catch(e=>{console.error(e);process.exitCode=1;});
