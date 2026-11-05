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
   window.__restChargeReads=[];window.__stationRestReads=0;A.S.restAtChargerTypes={dc:true};
   const ui=RestUI.init(A,{
    snapshot:()=>({model,route,depart:Date.now(),kind:'ev',maxDetourMin:30}),arrival:()=>Date.now(),
    restChargers:async(s,sites,f)=>{
     __restChargeReads.push(f.types);
     return {sites:RestPlaces.matchChargers(sites,stations,f.radius,st=>AltFuel.charging(st,car,f.types,['J1772COMBO','J1772']))};
    },
    chargerRestSites:async(s,group,types)=>{
     __stationRestReads++;
     if(!types.dc)throw Error('DC station rest setting missing');
     const d=model.totalMi*.6;
     return {sites:[{d,leg:0,offset:0,site:{...model.pointAt(d),id:'charger-rest:test',name:'Direct DC charger',kind:'charging_station',restChargeLevel:'dc_fast',restChargeKw:120,source:'Fixture'}}]};
    },
    access:async()=>({outSeconds:30,backSeconds:30}),
    addDraft:async(site,leg,d,settings)=>{window.__stationRestAdded={site,leg,settings};},
    call:async()=>({complete:true,places:[]})
   });
   RestPlaces.create=create;StopClock.create=clock;
   const host=document.createElement('div');host.innerHTML=ui.tile();document.body.appendChild(host);ui.bind(host);
   const close=A.subPage('Charging settings',RestSettings.chargingHtml(A),body=>RestSettings.bindCharging(A,body));
   document.querySelector('.sub-page .sub-back').onclick=()=>{close();ui.openLeg(0,{wait:true});};
  });
  assert(await page.isChecked('[data-rest-charger-type="l2"]'));
  assert(await page.isChecked('[data-rest-charger-type="l1"]'),'legacy AC selection migrates to both AC levels');
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
  assert.equal(await page.evaluate(()=>__stationRestReads),0,'charger directory reads start only when opened');
  await page.getByRole('button',{name:'Rest at a charging station'}).click();
  await page.getByRole('button',{name:'Add rest stop: Direct DC charger'}).waitFor();
  assert.match(await page.locator('[data-rest-list]').innerText(),/at your own risk/);
  assert.equal(await rows.count(),1,'the separate charger list is independent of the nearby Level 2 requirement');
  await page.getByRole('button',{name:'Add rest stop: Direct DC charger'}).click();
  await page.waitForSelector('#restAddGo');
  assert.equal(await page.inputValue('#restChargeLevel'),'dc');
  await page.fill('#restCharge','20');
  await page.fill('#restChargePrice','0.35');
  await page.click('#restAddGo');
  assert.match(await page.locator('#restAddError').innerText(),/Confirm that this site allows/);
  await page.check('#restPermission');await page.click('#restAddGo');
  await page.waitForFunction(()=>window.__stationRestAdded);
  assert.equal(await page.evaluate(()=>__stationRestAdded.settings.chargeLevel),'dc');
  assert.equal(await page.evaluate(()=>__stationRestAdded.settings.chargeMinutes),20);
  assert.deepEqual(errors,[]);
  console.log('Rest-only Level 2 filter, cross-road directions, restricted and incompatible exclusions passed');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
