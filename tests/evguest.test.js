const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){const calls=[],cache=new Map(),S={evGuestApps:true,evPriceAgeHours:24},ctx={Map,Set,Date,Math,Number,JSON,Promise,Intl};ctx.window=ctx;
 ctx.__app={S,N:{fetchEvGuest(){}},KV:{get:(ns,k)=>cache.get(k),put:(ns,k,v)=>cache.set(k,{v})}};
 ctx.AltFuel={netGroup:st=>st.group,netEnabled:()=>true,compatiblePlugs:()=>['J1772COMBO']};
 ctx.__trip={call:async(fn,source,action,args)=>{calls.push([fn,source,action,args]);if(fn==='evGuestConfig')return {enabled:true,chargeway:true,evgo:true,plugshare:false};
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
 console.log('EV guest sources: opt-in, multi-source identity join, shared cache, ambiguous matches and native security gates passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
