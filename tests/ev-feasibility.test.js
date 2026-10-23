const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 for(const width of [320,448])for(const scenario of ['cached-prices','late-prices','approved-projection']){
  const p=await browser.newPage({viewport:{width,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route(/^https?:\/\//,r=>r.abort());
  await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
  await p.evaluate(scenario=>{
   const S=__app.S,car=DemoCars.create().find(c=>c.power==='ev');car.demoFuel={mode:'pct',pct:'80'};S.cars=[car];S.carId=car.id;S.setupDone=true;S.limitLookup=false;Garage.speedFn=()=>null;
   Object.assign(S.trip,{fuel:car.demoFuel,demoFuelCar:car.id,bufferMi:50,maxDetourMin:20,altCompare:false,tollCompare:false,departNow:true});
   window.__limitReads=0;Limits.along=async m=>{__limitReads++;return {roads:[{name:'Geometry fixture',cls:'highway',from:0,to:m.totalMi,sections:[{from:0,to:m.totalMi,limit:60}]}],stats:{geometry:true}};};
   const weather=RouteWx.forRoute,hour=Math.floor(Date.now()/3600000)*3600000;RouteWx.forRoute=async(...args)=>Object.assign(await weather(...args),{temperatures:[{mi:0,hours:[[hour-3600000,20],[hour+7*86400000,20]]}]});
   const run=Planner.run;window.__energyContexts=[];Planner.run=function(o,c){if(o.propulsion)__energyContexts.push({limits:o.propulsionContext.limits.length,weather:o.propulsionContext.weather.length});return run.call(this,o,c);};
   const raw=(pts,mi,name)=>({description:name,distanceMeters:mi*1609.344,duration:Math.round(mi/60*3600)+'s',polyline:{encodedPolyline:Trip.encodePolyline(pts)},legs:[{distanceMeters:mi*1609.344,duration:Math.round(mi/60*3600)+'s'}]});
   const start={lat:35,lng:-92},end={lat:35,lng:-88},north=[start,{lat:36,lng:-90},end],south=[start,{lat:34,lng:-90},end];
   const outbound=[raw(north,300,'Northern outbound'),raw(south,220,'Southern outbound')],back=[raw(north.slice().reverse(),300,'Northern return'),raw(south.slice().reverse(),220,'Southern return')];
   const sel=scenario==='late-prices'?[1,0]:[0,0],route={stops:[{label:'Start',...start},{label:'Destination',...end},{label:'Home',...start}],legs:[{sel:sel[0],alts:outbound},{sel:sel[1],alts:back}]};
   const m=Trip.buildRoute(outbound[1],Garage.carModel()),rows=Array.from({length:22},(_,i)=>{
    const pt=i<20?{lat:40,lng:-100}:m.pointAt(i===20?60:160),id=800000+i;
    __app.KV.put('evprices','cp-v2|'+id,{rate:.4,uom:'kwh',fee:0});
    return {id,fuel_type_code:'ELEC',country:'US',station_name:'Fixture charger '+i,ev_network:'ChargePoint',ev_network_ids:{station:['USCPIL'+id],posts:[]},latitude:pt.lat,longitude:pt.lng,ev_dc_fast_num:4,ev_connector_types:['TESLA'],ev_charging_units:[{charging_level:'dc_fast',connectors:{TESLA:{port_count:4,power_kw:150}}}]};
   });
   S.trip.evChargers={dc:true,l2:false,l1:false,superchargers:false};window.__discoveryReads=0;window.__websiteReads=0;window.__pricePasses=0;
   __app.N.fetchStationRoute=(id)=>{__discoveryReads++;onNativeResult(id,{body:JSON.stringify({fuel_stations:rows})});};
   __app.N.siteRead=(id,site)=>{if(site==='chargepoint')__websiteReads++;onNativeResult(id,{missing:true});};
   window.__offRoutePriceReads=0;
   if(scenario==='late-prices')EVPrices.annotate=async items=>{__pricePasses++;if(__pricePasses>1)items.forEach(x=>x.st.netPrice={rate:.4,uom:'kwh',fee:0,t:Date.now(),src:'chargepoint'});return {priced:__pricePasses>1?items.length:0,notes:[]};};
   else {const annotate=EVPrices.annotate;EVPrices.annotate=async(...args)=>{__pricePasses++;__offRoutePriceReads+=args[0].filter(x=>x.st.lat===40).length;return annotate(...args);};}
   const alts=[Object.assign(Trip.joinRoutes([outbound[sel[0]],back[sel[1]]]),{_sel:sel})];
   if(scenario==='approved-projection')route.legs.forEach((l,i)=>{const swap=sel.slice();swap[i]=1;alts.push(Object.assign(Trip.joinRoutes(route.legs.map((l,j)=>l.alts[swap[j]])),{_sel:swap,_leg:i}));});
   const t=Date.now(),saved={route,alts,altSel:0,altSure:true,trip:{fuel:S.trip.fuel,altCompare:false,arrive:'buffer',evChargers:S.trip.evChargers},stations:{kind:'ev',official:[],google:[]},savedT:t};
   __app.KV.put('trips','trip|feasibility',saved);__app.KV.put('trips','index',[{id:'feasibility',title:'Generic feasibility fixture',t,mi:600}]);
  },scenario);
  await p.click('#btnTrip');await p.click('[data-hist="feasibility"]');await p.waitForFunction(()=>__trip.state().model&&!__trip.state().busy);await p.evaluate(()=>__trip.step(4));assert.equal(await p.locator('#tpS4 .spd-off-note').count(),0,'EV cruising speed does not warn about a missing Google key');
  if(scenario==='approved-projection')await p.evaluate(()=>{__app.S.trip.altCompare=true;const toggle=document.querySelector('#tAltCmp');if(toggle)toggle.checked=true;__trip.state().route.legs.forEach((l,i)=>l.alts.forEach(a=>__app.S.trip.routeChoices[RouteChoices.key(i,a)]={consider:true}));});
  await p.evaluate(()=>__trip.step(6));
  await p.waitForFunction(()=>__trip.state().evRecovery?.state==='done',null,{timeout:20000});
  assert.equal(await p.evaluate(()=>__trip.state().result.plan.ok),false,'the initial route cannot be planned');
  if(!await p.evaluate(()=>__trip.state().evRecovery.usable))console.log(await p.evaluate(()=>({recovery:__trip.state().evRecovery,reads:__discoveryReads,passes:__pricePasses,details:FLog.text().split('\n').filter((s,i,a)=>/Feasible route evaluated|Route corridor projection/.test(s)||i&&/Feasible route evaluated|Route corridor projection/.test(a[i-1])).slice(-18)})));assert.equal(await p.evaluate(()=>__trip.state().evRecovery.usable),1,scenario+': the southern round trip must be suggested');
  assert.equal(await p.evaluate(()=>__websiteReads),0,'cached-only feasibility does not open pricing websites');
  assert.equal(await p.evaluate(()=>__offRoutePriceReads),0,'off-corridor inventory never spends a website price lookup');
  if(scenario==='approved-projection')assert.equal(await p.evaluate(()=>__pricePasses),2,'primary and changed legs each enrich once; full-route reprojection never starts a third price pass');
  assert(await p.evaluate(()=>__energyContexts.every(x=>x.limits>0&&x.weather>0)),'primary and recovery plans both include real per-leg limits and hourly weather, even without turn instructions or a gasoline speed function');
  const reads=await p.evaluate(()=>__discoveryReads),passes=await p.evaluate(()=>__pricePasses);
  await p.click('#tNext');await p.waitForSelector('[data-ev-replace]');assert.match(await p.locator('#tsResults').innerText(),/Routes that would work/i);
  await p.click('[data-ev-replace]');await p.waitForFunction(()=>__trip.state().step===5);
  assert(await p.evaluate(()=>__trip.state().result?.plan.ok),'the hazard review must retain the accepted, validated plan');
  await p.evaluate(()=>window.__acceptedPlan=__trip.state().result.plan);
  assert.deepEqual(await p.evaluate(()=>__trip.state().route.legs.map(l=>l.sel)),[1,1]);
  await p.evaluate(()=>__trip.step(6));await p.waitForFunction(()=>__trip.state().result?.plan.ok&&!__trip.state().busy);
  assert((await p.evaluate(()=>__trip.state().result.plan.stops.length))>0,'the accepted recommendation really uses priced chargers');
  assert(await p.evaluate(()=>__trip.state().result.plan===__acceptedPlan),'acceptance does not silently throw away and rebuild the validated plan');
  assert.equal(await p.evaluate(()=>__discoveryReads),reads,'acceptance does not rediscover stations');
  assert.equal(await p.evaluate(()=>__websiteReads),0,'acceptance does not open pricing websites');
  assert.equal(await p.evaluate(()=>__pricePasses),passes,'returning through Hazards reuses the completed price pass, not just positive prices');
  await p.evaluate(()=>__trip.step(__trip.steps.DEPART));assert.equal(await p.locator('.est-note').count(),0,'EV departure has no Google key warning');assert(!/Google Maps may pick|In Google Maps, pick/.test(await p.locator('#tpS9').innerText()));
  assert.equal(await p.locator('.dep-facts > div').first().locator('b').innerText(),'440');
  await p.click('[data-depart-scope="leg"]');assert.equal(await p.locator('.dep-facts > div').first().locator('b').innerText(),'220');
  await p.selectOption('#tDepartLeg','1');assert.match(await p.locator('.kpis.four').innerText(),/leg cost/);assert.equal(await p.locator('#tDepartLeg').inputValue(),'1');
  await p.click('[data-depart-scope="trip"]');assert.equal(await p.locator('.dep-facts > div').first().locator('b').innerText(),'440');
  await p.addStyleTag({content:'html{font-size:130%}'});await p.click('[data-depart-scope="leg"]');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'per-leg summaries fit enlarged text too');
  if(scenario==='late-prices'){
   await p.evaluate(()=>__trip.step(6));await p.waitForFunction(()=>!__trip.state().busy);
   let before=await p.evaluate(()=>__pricePasses);await p.evaluate(()=>__trip.find(true));await p.waitForFunction(()=>__trip.state().result?.plan.ok&&!__trip.state().busy);
   assert((await p.evaluate(()=>__pricePasses))>before,'explicit refresh bypasses completed-price-pass reuse');
   before=await p.evaluate(()=>__pricePasses);await p.evaluate(()=>{const now=Date.now;Date.now=()=>now()+11*60e3;__trip.find();});await p.waitForFunction(()=>__trip.state().result?.plan.ok&&!__trip.state().busy);
   assert.equal(await p.evaluate(()=>__pricePasses),before,'saved route prices survive the ten-minute in-memory TTL; only explicit refresh rereads websites');
  }
  if(scenario==='approved-projection'){
   const saved=await p.evaluate(()=>{const index=__app.KV.get('trips','index').v,id=index[0].id;return {S:JSON.parse(JSON.stringify(__app.S)),id,index,record:__app.KV.get('trips','trip|'+id).v};});
   assert(saved.record.stations.google.length>=3,'acceptance retains the previously searched alternatives');
   await p.reload();await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
   await p.evaluate(saved=>{Object.assign(__app.S,saved.S);__app.S.trip.altCompare=false;__app.S.limitLookup=false;Garage.speedFn=()=>null;__app.KV.put('trips','index',saved.index);__app.KV.put('trips','trip|'+saved.id,saved.record);window.__discoveryReads=0;window.__pricePasses=0;AltFuel.alongRoute=async()=>{__discoveryReads++;return [];};EVPrices.annotate=async()=>{__pricePasses++;return {priced:0,notes:[]};};Limits.along=async m=>({roads:[{name:'Fixture',from:0,to:m.totalMi,sections:[{from:0,to:m.totalMi,limit:60}]}]});const wx=RouteWx.forRoute,h=Math.floor(Date.now()/3600000)*3600000;RouteWx.forRoute=async(...a)=>Object.assign(await wx(...a),{temperatures:[{mi:0,hours:[[h-3600000,20],[h+7*86400000,20]]}]});},saved);
   await p.click('#btnTrip');await p.click('[data-hist="'+saved.id+'"]');await p.waitForFunction(()=>__trip.state().model&&!__trip.state().busy);await p.evaluate(()=>__trip.step(6));await p.waitForFunction(()=>__trip.state().result&&!__trip.state().busy);
   assert(await p.evaluate(()=>__trip.state().result.plan.ok),'cold reopen plans using station tariffs stored with the trip');
   const originalTimes=new Map(saved.record.stations.google.flatMap(g=>g.list).filter(s=>s.netPrice).map(s=>[s.id,s.netPrice.t]));
   const reopenedTimes=await p.evaluate(()=>__trip.state().result.cands.map(c=>[c.station.id,c.station.netPrice?.t]));assert(reopenedTimes.length>0);assert(reopenedTimes.every(([id,t])=>originalTimes.get(id)===t),'reuse must not make old price timestamps look freshly checked');
   assert.equal(await p.evaluate(()=>__discoveryReads),0,'cold reopen does not rediscover covered routes');assert.equal(await p.evaluate(()=>__pricePasses),0,'cold reopen does not read pricing websites');
   assert(await p.evaluate(()=>__app.KV.get('trips','trip|'+__app.KV.get('trips','index').v[0].id).v.stations.google.length>=3),'saving only the chosen route keeps alternative inventories');
   await p.waitForSelector('[data-energy-pick]');assert.match(await p.locator('.energy-chart').textContent(),/kWh \/ 100 miles/);assert.match(await p.locator('[data-energy-summary]').innerText(),/trip energy/);assert.equal(await p.locator('button[data-energy-speed]').count(),2,'separate lowest-energy and lowest-cost choices');
   await p.locator('button[data-energy-speed]').last().click();assert.match(await p.locator('[data-energy-summary]').innerText(),/versus/);assert.equal(await p.evaluate(()=>__pricePasses),0,'graph trials do not refresh prices');
   assert(await p.locator('.energy-choices button').evaluateAll(bs=>bs.every(b=>b.scrollHeight<=b.clientHeight+1)),'choice labels wrap without clipping at enlarged font size');
   if(width===320)await p.locator('[data-trip-speed]').screenshot({path:'build/energy-graph-244.png'});
   await p.evaluate(()=>{__app.S.trip.altCompare=true;const toggle=document.querySelector('#tAltCmp');if(toggle)toggle.checked=true;__trip.state().route.legs.forEach((l,i)=>l.alts.forEach(a=>__app.S.trip.routeChoices[RouteChoices.key(i,a)]={consider:true}));__trip.find();});await p.waitForFunction(()=>__trip.state().result&&!__trip.state().busy);
   assert.equal(await p.evaluate(()=>__discoveryReads),0,'reapproved alternatives reuse their own saved coverage after a cold reopen');assert.equal(await p.evaluate(()=>__pricePasses),0,'saved alternative prices do not trigger website refresh');
   await p.evaluate(()=>{__app.S.trip.maxDetourMin=30;__trip.find();});await p.waitForFunction(()=>!__trip.state().busy);assert.equal(await p.evaluate(()=>__discoveryReads),0,'initial discovery covers 30 minutes so increasing the limit needs no rescan');assert.equal(await p.evaluate(()=>__pricePasses),0,'raising the detour limit does not refresh prices');
   await p.evaluate(()=>__trip.step(4));assert.equal(await p.locator('#tMaxMin').getAttribute('step'),'0.1');assert.equal(await p.locator('#tMaxMin').getAttribute('min'),'1');assert.equal(await p.locator('#tMaxMin').getAttribute('max'),'30');assert.match(await p.locator('label:has(#tMaxMin)').innerText(),/1.0–30.0/);
   await p.fill('#tMaxMin','7.3');await p.evaluate(()=>__trip.step(6));await p.waitForFunction(()=>!__trip.state().busy);assert.equal(await p.evaluate(()=>__app.S.trip.maxDetourMin),7.3,'tenths of a minute survive collection');
   await p.evaluate(()=>{const kv=__app.KV;window.__beforeIndex=JSON.stringify(kv.get('trips','index'));window.__beforeRecord=JSON.stringify(kv.get('trips','trip|'+kv.get('trips','index').v[0].id));window.__realPut=kv.put;window.__failedWrites=0;kv.put=function(ns,k,v){if(ns==='trips'&&k.startsWith('trip|')){__failedWrites++;return false;}return __realPut(ns,k,v);};__trip.find();});await p.waitForFunction(()=>!__trip.state().busy);
   assert(await p.evaluate(()=>__failedWrites>0),'fixture exercises a failed trip write');assert(await p.evaluate(()=>JSON.stringify(__app.KV.get('trips','index'))===__beforeIndex),'failed writes never advertise a newly saved trip');assert(await p.evaluate(()=>JSON.stringify(__app.KV.get('trips','trip|'+__app.KV.get('trips','index').v[0].id))===__beforeRecord),'last good trip remains intact on failure');assert(await p.evaluate(()=>/Saved-trip record write failed/.test(FLog.text())),'write failures are logged instead of a false save-success message');await p.evaluate(()=>__app.KV.put=__realPut);
  }
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await p.close();
 }
 console.log('Cached prices beyond 20 sites, late-learned primary-leg prices, full round-trip combinations, acceptance parity and no repeated discovery/web reads at 320/448px passed');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
