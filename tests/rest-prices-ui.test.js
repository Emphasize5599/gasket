const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 const p=await browser.newPage({viewport:{width:320,height:950}});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route(/^https?:\/\//,r=>r.abort());await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);
 await p.evaluate(()=>{
  const A=__app,points=[{lat:34,lng:-92},{lat:34.2,lng:-92}],m=Trip.buildRoute({distanceMeters:22240,duration:'1600s',polyline:{encodedPolyline:Trip.encodePolyline(points)},legs:[]},{city:30,hwy:40,comb:35}),r={stops:[points[0],points[1]]};
  A.S.restSources={campendium:{maxNightly:30},ntad:{enabled:false},osm:{enabled:false},ridb:{enabled:false},rvparky:{enabled:false}};
  const create=RestPlaces.create,clock=StopClock.create;
  RestPlaces.create=()=>({corridor:async()=>({sites:[{site:{id:'campendium:test',name:'Unverified campground',source:'Campendium',kind:'campground',lat:34.1,lng:-92,timeZone:'UTC',hours:'24/7',price:null,priceUnverified:true},d:m.totalMi/2,offset:0,leg:0}],cells:1,asked:0,failed:0})});
  StopClock.create=()=>({load:async()=>{},get:()=> 'UTC'});
  const ui=RestUI.init(A,{snapshot:()=>({model:m,route:r,depart:Date.now(),kind:'gas',maxDetourMin:30}),arrival:()=>Date.now(),access:async()=>({outSeconds:30,backSeconds:30}),addDraft:async site=>{window.__addedRest=site;},call:async()=>({complete:true,places:[]})});
  RestPlaces.create=create;StopClock.create=clock;
  const host=document.createElement('div');host.id='price-test';host.innerHTML=ui.tile();document.body.appendChild(host);ui.bind(host);
 });
 await p.waitForSelector('#price-test [data-rest-leg="0"]');await p.click('#price-test [data-rest-leg="0"]');await p.waitForSelector('[data-rest-price-hidden]');assert.equal(await p.locator('.rest-site').count(),0,'an unverifiable price is hidden even when no priced place fits');assert.equal(await p.locator('.rest-price-unverified').count(),0);assert.match(await p.innerText('[data-rest-price-hidden]'),/1 place hidden: price can’t be checked/);
 await p.evaluate(()=>{__app.S.restSources.campendium.maxNightly=null;window.__addedRest=null;});await p.click('[data-rest-retry]');await p.waitForSelector('[data-rest-add]');assert.equal(await p.locator('[data-rest-price-hidden]').count(),0,'no limit = nothing hidden for price');await p.click('[data-rest-add]');await p.waitForSelector('#restAddGo');assert.equal(await p.locator('#restPriceConfirmed').count(),0,'no budget does not require a price confirmation');await p.check('#restPermission');await p.click('#restAddGo');await p.waitForFunction(()=>window.__addedRest);assert.deepEqual(errors,[]);
 console.log('Unverifiable campsite prices are hidden whenever a limit is on, even when choices are sparse; no limit lists and adds them at 320px');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
