const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');

(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});
 try{
  const page=await browser.newPage({viewport:{width:320,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route(/^https?:\/\//,route=>route.abort());
  await page.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);
  await require('./onboarding-ui')(page);
  await page.evaluate(()=>{
   const A=__app,car=Garage.car();
   Object.assign(car,{plug:'CCS',acKw:7.2,dcKw:150});
   A.S.trip.evChargers={dc:true,l2:false,l1:false};A.S.restChargerMode="ac";
   const pts=[{lat:34,lng:-92},{lat:34.1,lng:-92}],meters=Trip.hav(...pts)*1609.344;
   const model=Trip.buildRoute({distanceMeters:meters,duration:'600s',polyline:{encodedPolyline:Trip.encodePolyline(pts)},legs:[{distanceMeters:meters,duration:'600s',steps:[]}]},{});
   const route={stops:pts.map((point,i)=>({...point,label:i?'End':'Start'}))};
   const rows=['Level 2 plaza','DC plaza','Hookup only','Restricted plaza','Incompatible plaza','Outside radius'].map((name,i)=>{
    const d=model.totalMi*(i+1)/7;
    return {site:{...model.pointAt(d),name,id:'ntad:ev'+i,kind:'rest_area',source:'USDOT/BTS NTAD',amenities:{electric:true}},d,offset:0,leg:0};
   });
   const stations=rows.flatMap(({site},i)=>i===2?[]:[{id:'charger-'+i,name:'Inventory charger '+i,status:'E',lat:site.lat,lng:site.lng+(i===5?.005:.0016),restricted:i===3,dc:i===1?1:0,l2:i===1?0:1,plugs:[i===1?'J1772COMBO':i===4?'TESLA':'J1772']}]);
   const create=RestPlaces.create,clock=StopClock.create;
   RestPlaces.create=()=>({corridor:async()=>({sites:rows})});
   StopClock.create=()=>({load:async()=>{},get:()=> 'America/Chicago'});
   const depart=Date.parse('2030-11-13T02:00:00Z');
   window.__restClockAdvance=0;
   window.__restChargeReads=[];window.__stationRestReads=0;window.__chargerForecasts=[];window.__restWork=[];window.__chargerTaskLabels=[];A.S.restAtChargerTypes={dc:true};
   const upsert=Tasks.upsert;Tasks.upsert=(id,value)=>{if(id.startsWith('charger-rest')&&value.text)__chargerTaskLabels.push(value.text);return upsert(id,value);};
   const begin=Tasks.begin;Tasks.begin=(id,value)=>{if(id.startsWith('charger-rest'))__chargerTaskLabels.push(value.text);return begin(id,value);};
   A.S.trip.windowPlan={enabled:true,planningMode:'overnight',overnight:{arrivalStart:{kind:'clock',time:'20:05'},arrivalEnd:{kind:'clock',time:'21:30'},leaveStart:{kind:'clock',time:'06:00'},leaveEnd:{kind:'clock',time:'07:00'},minimum:30,preferred:60}};
   const ui=RestUI.init(A,{
    snapshot:()=>({model,route,depart:depart+__restClockAdvance,rollingDepart:true,kind:'ev',maxDetourMin:30}),arrival:d=>depart+__restClockAdvance+d/model.totalMi*3600000,
    restChargers:async(s,sites,f)=>{
     __restChargeReads.push(f.types);
     return {sites:RestPlaces.matchChargers(sites,stations,f.radius,st=>AltFuel.charging(st,car,f.types,['J1772COMBO','J1772']))};
    },
    chargerRestSites:async(s,group,types)=>{
     __stationRestReads++;
     __restWork.push('charger inventory');
     if(!types.dc)throw Error('DC station rest setting missing');
     return {sites:[.6,.02].map((fraction,i)=>{
      const d=model.totalMi*fraction;
      return {d,leg:0,offset:0,site:{...model.pointAt(d),id:'charger-rest:'+i,name:i?'Too early charger':'Direct DC charger',kind:'charging_station',restChargeLevel:'dc_fast',restChargeKw:120,restChargeTariff:{country:'US',source:'DOE AFDC',pricing:'$0.345/kWh'},source:'Fixture'}};
     })};
    },
    access:async site=>{if(site.kind!=='charging_station'){await new Promise(r=>setTimeout(r,40));__restWork.push('ordinary access done');}return {outSeconds:30,backSeconds:30};},
    tolerance:()=>15,forecast:async d=>{__chargerForecasts.push(d/model.totalMi);__restWork.push(d/model.totalMi===.6?'charger forecast':'ordinary forecast');return {seconds:600,baseSeconds:600,coverage:1};},
    addDraft:async(site,leg,d,settings)=>{window.__stationRestAdded={site,leg,settings};},
    call:async()=>({complete:true,places:[]})
   });
   RestPlaces.create=create;StopClock.create=clock;
   window.__openChargersAgain=()=>{if(window.__subClose)__subClose();ui.openLeg(0);};
   const host=document.createElement('div');host.innerHTML=ui.tile();document.body.appendChild(host);
   const close=A.subPage('Charging settings',RestSettings.chargingHtml(A),body=>RestSettings.bindCharging(A,body));
   document.querySelector('.sub-page .sub-back').onclick=()=>{close();ui.openLeg(0,{wait:true});};
  });
  assert(await page.isChecked('[data-rest-charger-type="l2"]'));
  assert(await page.isChecked('[data-rest-charger-type="l1"]'),'legacy AC selection migrates to both AC levels');
  assert(!await page.isChecked('[data-rest-complimentary="restNearAllowComplimentary"]'));
  await page.getByText('Resting at charging stops',{exact:true}).click();
  assert(!await page.isChecked('[data-rest-complimentary="restAtAllowComplimentary"]'));
  await page.check('[data-rest-complimentary="restAtAllowComplimentary"]');
  assert(!await page.isChecked('[data-rest-complimentary="restNearAllowComplimentary"]'),'the two opt-ins are independent');
  await page.uncheck('[data-rest-charger-type="l1"]');
  await page.focus('[data-rest-charger-radius]');await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('[data-rest-charger-distance]').innerText(),'275 m');
  await page.locator('.sub-page .sub-back').click();
  await page.waitForFunction(()=>__restChargeReads.some(f=>f.l2&&!f.dc&&!f.l1));
  await page.waitForSelector('[data-rest-row] .rest-charger');
  const rows=page.locator('[data-rest-row]');
  assert.equal(await rows.count(),1);
  assert.match(await rows.innerText(),/Level 2 plaza.*Level 2 nearby/s);
  const directions=new URL(await rows.getByRole('link',{name:'Check the drive to charger'}).getAttribute('href'));
  assert.notEqual(directions.searchParams.get('origin'),directions.searchParams.get('destination'));
  assert.equal(directions.searchParams.get('travelmode'),'driving');
  assert.deepEqual(await page.evaluate(()=>__app.S.trip.evChargers),{dc:true,l2:false,l1:false});
  assert.deepEqual(await page.evaluate(()=>__app.S.restChargerTypes),{dc:false,l2:true,l1:false});
  assert.equal(await page.evaluate(()=>__app.S.restChargerRadius),275);
  await page.waitForFunction(()=>__chargerForecasts.includes(.6));
  const work=await page.evaluate(()=>__restWork);
  assert(work.indexOf('ordinary access done')>=0&&work.indexOf('ordinary access done')<work.indexOf('charger inventory'));
  assert(work.indexOf('ordinary forecast')>=0&&work.lastIndexOf('ordinary forecast')<work.indexOf('charger inventory'));
  const labels=(await page.evaluate(()=>__chargerTaskLabels)).join('\n');
  assert.match(labels,/finding compatible chargers/);
  assert.match(labels,/Checking road access · 2 \/ 2/);
  assert.match(labels,/Charger rest departure forecasts/);
  await page.waitForFunction(()=>!Tasks.list().some(task=>task.id.startsWith('charger-rest')));
  const readsBeforeOpen=await page.evaluate(()=>{__restClockAdvance=65000;return __chargerForecasts.length;});
  await page.getByRole('button',{name:'Rest at a charging station'}).click();
  await page.getByRole('button',{name:'Add rest stop: Direct DC charger'}).waitFor();
  await page.waitForSelector('[data-rest-row] .rest-suggested');
  assert.equal(await page.getByText('Too early charger',{exact:true}).count(),0);
  assert(await page.getByRole('button',{name:'Show 1 earlier stop'}).isVisible(),'earlier options remain available alongside fitting chargers');
  assert(await page.evaluate(()=>!!(document.querySelector('[data-rest-alternative="earlier"]').compareDocumentPosition(document.querySelector('[data-rest-row]'))&Node.DOCUMENT_POSITION_FOLLOWING)));

  assert(await page.evaluate(()=>__chargerForecasts.includes(.6)&&!__chargerForecasts.includes(.02)));
  assert.equal(await page.evaluate(()=>__stationRestReads),1,'opening the directory reuses the background inventory');
  assert.equal(await page.evaluate(()=>__chargerForecasts.length),readsBeforeOpen,'opening a minute later reuses completed departure forecasts');
  assert.match(await page.locator('[data-rest-list]').innerText(),/at your own risk/);
  assert.equal(await rows.count(),1,'the separate charger list is independent of the nearby Level 2 requirement');
  await page.getByRole('button',{name:'Add rest stop: Direct DC charger'}).click();
  await page.waitForSelector('#restAddGo');
  assert.equal(await page.inputValue('#restChargeLevel'),'dc');
  assert.equal(await page.inputValue('#restCharge'),await page.inputValue('#restMin'));
  assert(await page.getByText(/Defaults to your minimum rest/).isVisible());
  await page.fill('#restMin','35');
  assert.equal(await page.inputValue('#restCharge'),'35');
  await page.fill('#restCharge','20');
  await page.fill('#restMin','40');
  assert.equal(await page.inputValue('#restCharge'),'20');
  assert.equal(await page.inputValue('#restChargePrice'),'0.345');
  assert(await page.getByText(/Published charger rate/).isVisible());
  await page.click('#restAddGo');
  assert.match(await page.locator('#restAddError').innerText(),/Confirm that this site allows/);
  await page.check('#restPermission');
  await page.fill('#restChargePrice','');
  await page.click('#restAddGo');
  assert.match(await page.locator('#restAddError').innerText(),/Enter the electricity price/);
  assert.equal(await page.evaluate(()=>window.__stationRestAdded),undefined);
  await page.fill('#restChargePrice','0');
  await page.click('#restAddGo');
  await page.waitForFunction(()=>window.__stationRestAdded);
  assert.equal(await page.evaluate(()=>__stationRestAdded.settings.chargeLevel),'dc');
  assert.equal(await page.evaluate(()=>__stationRestAdded.settings.chargeMinutes),20);
  assert.equal(await page.evaluate(()=>__stationRestAdded.settings.chargePrice),0);
  await page.evaluate(()=>{
   __app.S.trip.windowPlan.overnight={arrivalStart:{kind:'clock',time:'20:10'},arrivalEnd:{kind:'clock',time:'20:20'},leaveStart:{kind:'clock',time:'06:00'},leaveEnd:{kind:'clock',time:'07:00'},minimum:30,preferred:60};
   __openChargersAgain();
  });
  await page.getByRole('button',{name:'Rest at a charging station'}).click();
  await page.getByRole('button',{name:'Show 1 earlier stop'}).click();
  await page.getByRole('button',{name:'Add rest stop: Too early charger'}).waitFor();
  await page.getByRole('button',{name:'Show 1 later stop'}).click();
  await page.getByRole('button',{name:'Add rest stop: Direct DC charger'}).waitFor();
  assert.equal(await page.locator('[data-rest-exception]').count(),2);
  await page.getByRole('button',{name:'Add rest stop: Direct DC charger'}).click();
  assert(await page.getByText(/timing exception for this night only/).isVisible());
  assert.equal(await page.inputValue('#restMin'),'30');
  assert.equal(await page.inputValue('#restChargePrice'),'0.345');
  await page.evaluate(()=>{__stationRestAdded=null;});
  await page.check('#restPermission');await page.click('#restAddGo');
  await page.waitForFunction(()=>__stationRestAdded);
  assert.equal(await page.evaluate(()=>__stationRestAdded.settings.nightDate),'2030-11-12');
  await page.reload();
  await require('./onboarding-ui')(page);
  await page.evaluate(()=>{
   const A=__app,start=Date.parse('2030-11-12T11:00:00Z'),hour=3600000;
   const points=[{lat:34,lng:-92,label:'Origin'},{lat:35,lng:-92,label:'Destination'}],route={stops:points.slice()};
   const model=Trip.buildRoute({distanceMeters:112654,duration:'252000s',polyline:{encodedPolyline:Trip.encodePolyline(points)},legs:[{distanceMeters:112654,duration:'252000s',steps:[]}]},{});
   model.totalMi=70;model.legEnds=[70];
   A.S.trip.windowPlan={enabled:true,planningMode:'overnight',overnight:{start:'20:00',end:'08:00',minimum:360,preferred:480,arrivalEnd:{kind:'clock',time:'23:00'}}};
   A.S.restSources={ntad:{enabled:true},osm:{enabled:false},ridb:{enabled:false},rvparky:{enabled:false},campendium:{enabled:false}};
   A.S.restAtChargerTypes={};A.S.restChargerTypes={};A.S.restScreening=false;
   const sites=[10,24,34,48,58].map(d=>({d,offset:0,site:{...model.pointAt(d),id:'ntad:night-'+d,name:'Place '+d,kind:'rest_area',source:'DOT/BTS',price:0,hours:'24/7'}}));
   const create=RestPlaces.create,clock=StopClock.create;
   RestPlaces.create=()=>({corridor:async()=>({sites})});
   StopClock.create=()=>({load:async()=>{},get:()=> 'UTC'});
   window.__nightForecasts=[];window.__laterTraffic=[];let deadline=Infinity;
   const ui=RestUI.init(A,{
    snapshot:()=>({route,model,depart:start,kind:'gas',maxDetourMin:20}),
    arrival:d=>start+(d+(route.stops.length===3&&d>10?10:0))*hour,
    departure:i=>i?route.stops[i].rest.leaveAt:start,
    arrivalDeadline:()=>deadline,
    prefetchNightTraffic:async(s,i,depart,rests)=>{__laterTraffic.push(rests);return true;},
    tolerance:()=>10,forecast:async d=>{__nightForecasts.push(d);return {seconds:600,baseSeconds:600,coverage:1};},
    call:async()=>({complete:true,places:[]})
   });
   RestPlaces.create=create;StopClock.create=clock;
   const host=document.createElement('div');host.id='multi-night';document.body.appendChild(host);
   host.innerHTML=ui.tile();ui.bind(host);
   window.__openNight=()=>{if(window.__subClose)__subClose();host.innerHTML=ui.tile();ui.bind(host);ui.openLeg(0);};
   window.__selectFirstNight=()=>{
    route.stops.splice(1,0,{...sites[0].site,label:'First rest',rest:{site:sites[0].site,overnight:true,pendingTiming:true,nightStart:start+9*hour,nightArrivalEnd:start+12*hour,leaveAt:start+20*hour}});
    model.legEnds=[10,70];
    __openNight();
   };
   window.__confirmFirstNight=()=>{route.stops[1].rest.pendingTiming=false;__openNight();};
   window.__tightenNightDeadline=()=>{deadline=start+82*hour;__openNight();};
   window.__ordinaryExceptions=()=>{
    deadline=Infinity;
    A.S.trip.windowPlan.driveThroughNights={};
    A.S.trip.windowPlan.overnight={start:'21:15',end:'08:00',minimum:360,preferred:480,arrivalEnd:{kind:'clock',time:'21:30'}};
    __openNight();
   };
  });
  await page.locator('#multi-night [data-rest-need="0"]').click();
  await page.getByRole('heading',{name:'Night of 2030-11-12'}).waitFor();
  assert.deepEqual(await page.locator('[data-rest-row] [data-rest-add]').evaluateAll(rows=>rows.map(r=>r.getAttribute('aria-label'))),['Add rest stop: Place 10']);
  assert.match(await page.locator('.rest-dest').last().innerText(),/After rest planning/);
  await page.waitForFunction(()=>__nightForecasts.length>0);
  assert.deepEqual(await page.evaluate(()=>Array.from(new Set(__nightForecasts))),[10]);
  await page.waitForFunction(()=>__laterTraffic.length>0);
  assert((await page.evaluate(()=>__laterTraffic[0])).length>=2,'later traffic is warmed without exposing future sites');
  await page.evaluate(()=>__selectFirstNight());
  await page.getByRole('button',{name:'Set rest departure'}).waitFor();
  assert.equal(await page.locator('[data-rest-row]').count(),0);
  await page.evaluate(()=>__confirmFirstNight());
  await page.getByRole('heading',{name:'Night of 2030-11-13'}).waitFor();
  assert.deepEqual(await page.locator('[data-rest-row] [data-rest-add]').evaluateAll(rows=>rows.map(r=>r.getAttribute('aria-label'))),['Add rest stop: Place 24']);
  await page.check('[data-rest-drive-night="2030-11-13"]');
  await page.getByRole('heading',{name:'Night of 2030-11-14'}).waitFor();
  assert.deepEqual(await page.locator('[data-rest-row] [data-rest-add]').evaluateAll(rows=>rows.map(r=>r.getAttribute('aria-label'))),['Add rest stop: Place 48']);
  await page.check('[data-rest-drive-night="2030-11-14"]');
  assert.equal(await page.getByRole('heading',{name:/Night of 2030-11-/}).count(),0);
  assert.doesNotMatch(await page.locator('.rest-dest').last().innerText(),/After rest planning/);
  await page.uncheck('[data-rest-drive-night="2030-11-13"]');
  await page.getByRole('heading',{name:'Night of 2030-11-13'}).waitFor();
  assert.match(await page.locator('.rest-dest').last().innerText(),/After rest planning/);
  await page.evaluate(()=>__tightenNightDeadline());
  await page.getByText(/A rest would miss the arrival deadline/).first().waitFor();
  assert.equal(await page.getByRole('heading',{name:/Night of 2030-11-/}).count(),0);
  assert.equal(await page.locator('[data-rest-row]').count(),0);
  await page.evaluate(()=>__ordinaryExceptions());
  await page.getByRole('button',{name:'Show 1 earlier stop'}).click();
  const early=page.getByRole('button',{name:'Add rest stop: Place 24'});
  await early.waitFor();
  assert.equal(await early.getAttribute('data-rest-exception'),'earlier');
  assert.deepEqual(errors,[]);
  console.log('Rest-only Level 2 filter, cross-road directions, restricted and incompatible exclusions passed');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
