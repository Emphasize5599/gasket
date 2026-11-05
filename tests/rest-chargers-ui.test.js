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
   A.S.trip.evChargers={dc:true,l2:false,l1:false};
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
   window.__restChargeReads=[];
   const ui=RestUI.init(A,{
    snapshot:()=>({model,route,depart:Date.now(),kind:'ev',maxDetourMin:30}),arrival:()=>Date.now(),
    restChargers:async(s,sites,f)=>{
     __restChargeReads.push(f.mode);
     return {sites:RestPlaces.matchChargers(sites,stations,f.radius,st=>AltFuel.charging(st,car,f.types,['J1772COMBO','J1772']))};
    },
    call:async()=>({complete:true,places:[]})
   });
   RestPlaces.create=create;StopClock.create=clock;
   const host=document.createElement('div');host.innerHTML=ui.tile();document.body.appendChild(host);ui.bind(host);
   RestSettings.open(A,()=>ui.openLeg(0,{wait:true}));
  });
  await page.getByText('EV charging near rest stops',{exact:true}).click();
  await page.selectOption('[data-rest-charger-mode]','l2');
  await page.locator('.sub-page .sub-back').click();
  await page.waitForFunction(()=>__restChargeReads.includes('l2'));
  await page.waitForSelector('[data-rest-row] .rest-charger');
  const rows=page.locator('[data-rest-row]');
  assert.equal(await rows.count(),1);
  assert.match(await rows.innerText(),/Level 2 plaza.*Level 2 nearby/s);
  const directions=new URL(await rows.getByRole('link',{name:'Check the drive to charger'}).getAttribute('href'));
  assert.notEqual(directions.searchParams.get('origin'),directions.searchParams.get('destination'));
  assert.equal(directions.searchParams.get('travelmode'),'driving');
  assert.deepEqual(await page.evaluate(()=>__app.S.trip.evChargers),{dc:true,l2:false,l1:false});
  assert.equal(await page.evaluate(()=>__app.S.restChargerMode),'l2');
  assert.deepEqual(errors,[]);
  console.log('Rest-only Level 2 filter, cross-road directions, restricted and incompatible exclusions passed');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
