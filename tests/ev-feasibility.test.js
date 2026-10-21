const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 for(const width of [320,448])for(const scenario of ['cached-prices','late-prices']){
  const p=await browser.newPage({viewport:{width,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route(/^https?:\/\//,r=>r.abort());
  await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
  await p.evaluate(scenario=>{
   const S=__app.S,car=DemoCars.create().find(c=>c.power==='ev');car.demoFuel={mode:'pct',pct:'80'};S.cars=[car];S.carId=car.id;S.setupDone=true;S.limitLookup=false;Garage.speedFn=()=>null;
   Object.assign(S.trip,{fuel:car.demoFuel,demoFuelCar:car.id,bufferMi:50,maxDetourMin:20,altCompare:false,tollCompare:false,departNow:true});
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
   if(scenario==='late-prices')EVPrices.annotate=async items=>{__pricePasses++;if(__pricePasses>1)items.forEach(x=>x.st.netPrice={rate:.4,uom:'kwh',fee:0,t:Date.now(),src:'chargepoint'});return {priced:__pricePasses>1?items.length:0,notes:[]};};
   const alts=[Object.assign(Trip.joinRoutes([outbound[sel[0]],back[sel[1]]]),{_sel:sel})],t=Date.now(),saved={route,alts,altSel:0,altSure:true,trip:{fuel:S.trip.fuel,altCompare:false,arrive:'buffer',evChargers:S.trip.evChargers},stations:{kind:'ev',official:[],google:[]},savedT:t};
   __app.KV.put('trips','trip|feasibility',saved);__app.KV.put('trips','index',[{id:'feasibility',title:'Generic feasibility fixture',t,mi:600}]);
  },scenario);
  await p.click('#btnTrip');await p.click('[data-hist="feasibility"]');await p.waitForFunction(()=>__trip.state().model&&!__trip.state().busy);await p.evaluate(()=>__trip.step(4));assert.equal(await p.locator('#tpS4 .spd-off-note').count(),0,'EV cruising speed does not warn about a missing Google key');await p.evaluate(()=>__trip.step(6));
  await p.waitForFunction(()=>__trip.state().evRecovery?.state==='done',null,{timeout:20000});
  assert.equal(await p.evaluate(()=>__trip.state().result.plan.ok),false,'the initial route cannot be planned');
  assert.equal(await p.evaluate(()=>__trip.state().evRecovery.usable),1,scenario+': the southern round trip must be suggested');
  assert.equal(await p.evaluate(()=>__websiteReads),0,'cached-only feasibility does not open pricing websites');
  const reads=await p.evaluate(()=>__discoveryReads),passes=await p.evaluate(()=>__pricePasses);
  await p.click('#tNext');await p.waitForSelector('[data-ev-replace]');assert.match(await p.locator('#tsResults').innerText(),/Routes that would work/i);
  await p.click('[data-ev-replace]');await p.waitForFunction(()=>__trip.state().step===5);
  assert.deepEqual(await p.evaluate(()=>__trip.state().route.legs.map(l=>l.sel)),[1,1]);
  await p.evaluate(()=>__trip.step(6));await p.waitForFunction(()=>__trip.state().result?.plan.ok&&!__trip.state().busy);
  assert((await p.evaluate(()=>__trip.state().result.plan.stops.length))>0,'the accepted recommendation really uses priced chargers');
  assert.equal(await p.evaluate(()=>__discoveryReads),reads,'acceptance does not rediscover stations');
  assert.equal(await p.evaluate(()=>__websiteReads),0,'acceptance does not open pricing websites');
  assert.equal(await p.evaluate(()=>__pricePasses),passes,'returning through Hazards reuses the completed price pass, not just positive prices');
  await p.evaluate(()=>__trip.step(8));assert.equal(await p.locator('.est-note').count(),0,'EV departure has no Google key warning');assert(!/Google Maps may pick|In Google Maps, pick/.test(await p.locator('#tpS8').innerText()));
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
   assert((await p.evaluate(()=>__pricePasses))>before,'automatic price-pass reuse expires after ten minutes');
  }
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await p.close();
 }
 console.log('Cached prices beyond 20 sites, late-learned primary-leg prices, full round-trip combinations, acceptance parity and no repeated discovery/web reads at 320/448px passed');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
