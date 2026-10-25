const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(handler){const calls=[],cache=new Map(),S={evGuestApps:true,evPriceAgeHours:24},ctx={Map,Set,Date,Math,Number,JSON,Promise,Intl};ctx.window=ctx;
 ctx.__app={S,N:{fetchEvGuest(){}},KV:{get:(ns,k)=>cache.get(k),put:(ns,k,v)=>cache.set(k,{v})}};
 ctx.AltFuel={netGroup:st=>st.group,netEnabled:()=>true,compatiblePlugs:()=>['J1772COMBO']};
 ctx.__trip={call:async(fn,source,action,args)=>{calls.push([fn,source,action,args]);if(handler)return handler(fn,source,action,args);if(fn==='evGuestConfig')return {enabled:true,chargeway:true,evgo:true,plugshare:false};
  if(source==='ea'&&action==='near')return {body:JSON.stringify([{id:'site',coordinates:{latitude:35,longitude:-91}}])};
  if(source==='ea')return {body:JSON.stringify({coordinates:{latitude:35,longitude:-91},pricing:[{energy:.3,minPower:1,maxPower:350,timePeriod:'12am - 8am'},{energy:.5,minPower:1,maxPower:350,timePeriod:'8am - 12am'}],fixedFees:[{fee:0}],evses:[{id:'1',connectors:[{id:'1',standard:'IEC_62196_T1_COMBO'}]}]})};
  if(source==='chargeway'&&action==='near')return {body:JSON.stringify({results:[{id:'zone',nrel_id:1,latitude:35,longitude:-91,time_zone:'America/Chicago'}]})};throw Error('Unexpected request');}};
 for(const f of ['evtariffs','evguest'])vm.runInNewContext(fs.readFileSync('assets/web/'+f+'.js','utf8'),ctx);return {ctx,S,calls,cache,G:ctx.EVGuest};}
(async()=>{const z=setup(),item=()=>({st:{id:'afdc1',afdcId:1,lat:35,lng:-91,group:'ea',plugs:['J1772COMBO']},dc:true});
 let x=item();await z.G.annotate([x],{});assert.equal(x.st.tariffV2.offer.zone,'America/Chicago','merge exact DOE timezone with direct EA tariff');assert.equal(x.st.tariffV2.offer.zoneSource,'chargeway');assert.equal(x.st.units[0].charging_level,'dc_fast');assert.equal(x.st.netPrice.complete,true);
 const before=z.calls.filter(c=>c[0]==='fetchEvGuest').length;x=item();await z.G.annotate([x],{});assert.equal(z.calls.filter(c=>c[0]==='fetchEvGuest').length,before,'different vehicle/route reuses normalized cache');
 assert.equal(z.G.unique({lat:35,lng:-91},[{lat:35,lng:-91},{lat:35,lng:-91}],x=>x),null,'ambiguous collocated sites do not match');
 const off=setup();off.S.evGuestApps=false;await off.G.annotate([item()],{});assert.equal(off.calls.length,0,'opt-out makes zero calls');
 const native=fs.readFileSync('src/com/bensanzone/fuelmap/EvAppClient.java','utf8');assert.match(native,/setInstanceFollowRedirects\(false\)/);assert.match(native,/!prefs.getBoolean\("enabled",false\)/);assert.match(native,/grant_type=refresh_token/);assert.match(native,/AES\/GCM\/NoPadding/);assert.match(native,/Retry-After/);assert(!/idToken\s*=\s*"ey/.test(native));
 for(const nativeDenied of [false,true]){
  const denied=setup((fn,source,action)=>{
   if(fn==='evGuestConfig')return {enabled:true,chargeway:false,evgo:true,plugshare:true};
   if(source==='evgo')return nativeDenied?{status:200,blocked:true,authDenied:true,authRefreshed:true,error:'Denied'}:{status:200,body:JSON.stringify({errors:[{message:'Not Authorized'}]})};
   if(source==='plugshare'&&action==='near')return {body:JSON.stringify([{id:4,latitude:35,longitude:-91,stations:[{network_id:19}]}])};
   if(source==='plugshare')return {body:JSON.stringify({access:1,latitude:35,longitude:-91,stations:[{network_id:19,outlets:[{id:1,connector:13,is_dc:true,kilowatts:150,prices:[{currency:'USD',elements:[{price_components:[{type:'ENERGY',price:.3}]}]}]}]}]})};
   throw Error('Unexpected source '+source);
  });
  const stations=[1,2].map(i=>({st:{id:'evgo'+i,afdcId:i,lat:35,lng:-91,group:'evgo',plugs:['J1772COMBO']},dc:true}));
  const result=await denied.G.annotate(stations,{});
  assert.equal(denied.calls.filter(c=>c[1]==='evgo').length,1,'denied source pauses rather than repeating at every station');
  assert.equal(result.priced,2,'existing independent source still provides matching per-port tariffs');
  assert(stations.every(x=>x.st.tariffV2.source==='plugshare'));
  assert(result.notes.some(n=>n.includes('not a bot check')),'authentication failure is visible without a CAPTCHA claim');
 }
 assert.match(native,/if\(renew&&\(auth==null\|\|auth\.optString\("refresh"\)\.isEmpty\(\)\)\)throw/,'refresh cannot create a replacement identity');
 assert.match(native,/if\(out\.optBoolean\("blocked"\)\)return false/,'do not refresh on a protection block');
 assert.match(native,/if\(out\.optInt\("status"\)!=200\)return false/);
 assert.match(native,/if\(authenticationFailure\(out\)\)\s*\{\s*refused\.put/,'a second auth failure pauses instead of refreshing again');
 assert.equal((native.match(/token\(source,s,true\)/g)||[]).length,1,'exactly one refresh call site');
 // an answered "no matching published tariff" is remembered (0.0.264 log: 214 ChargePoint lookups again 54 min later); an error isn't
 const empty=setup((fn,source)=>{if(fn==='evGuestConfig')return {enabled:true,chargeway:false,evgo:false,plugshare:false};if(source==='chargepoint')return {status:200,body:JSON.stringify({stations:[{deviceId:'999',latitude:35,longitude:-91}]})};throw Error('Unexpected '+source);});
 empty.ctx.EVPrices={chargePointIds:()=>['123']};const cpItem=()=>({st:{id:'cp1',lat:35,lng:-91,group:'chargepoint',plugs:['J1772COMBO']},dc:true});
 const asks=()=>empty.calls.filter(c=>c[0]==='fetchEvGuest').length;
 await empty.G.annotate([cpItem()],{});assert.equal(asks(),1);await empty.G.annotate([cpItem()],{});assert.equal(asks(),1,'no-tariff answer reused, not asked again');
 const rec=[...empty.cache.entries()].find(e=>/chargepoint/.test(e[0]));rec[1].v.checked=Date.now()-7*3600e3;await empty.G.annotate([cpItem()],{});assert.equal(asks(),2,'a no-tariff answer is asked again after 6 h');
 await empty.G.annotate([cpItem()],{},null,true);assert.equal(asks(),3,'Update prices asks again');
 const flaky=setup((fn,source)=>{if(fn==='evGuestConfig')return {enabled:true,chargeway:true,evgo:false,plugshare:false};if(source==='chargeway')return {status:429,error:'Too many requests'};throw Error('Unexpected '+source);});
 const wm=()=>({st:{id:'wm1',afdcId:7,lat:35,lng:-91,group:'walmart',plugs:['J1772COMBO']},dc:true});
 await flaky.G.annotate([wm()],{});await flaky.G.annotate([wm()],{});assert.equal(flaky.calls.filter(c=>c[0]==='fetchEvGuest').length,2,'a lookup that hit an error is not remembered as "no tariff"');
 console.log('EV guest sources: cache, consent, identity joins, denied-source pause/fallback, bounded refresh, native security gates, no-tariff answers remembered 6 h (errors never) passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
