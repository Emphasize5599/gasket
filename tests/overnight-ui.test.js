const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){const p=await browser.newPage({viewport:{width,height:950},timezoneId:'UTC'}),errors=[];p.on('pageerror',e=>errors.push(e.stack));p.setDefaultTimeout(15000);await p.route(/^https?:\/\//,r=>r.abort());await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
await p.evaluate(width=>{const A=__app,S=A.S;S.hereTraffic=false;S.googleTraffic=true;S.walmartPlus=false;S.limitLookup=false;S.restSources={osm:{enabled:false},ridb:{enabled:false}};S.cars.forEach(c=>c.tires={aired:Date.now(),spare:{kind:'none'}});const original=A.N.fetchJson;A.N.fetchJson=(id,u)=>{if(u.includes('timezone=auto')){const count=new URL(u).searchParams.get('latitude').split(',').length;setTimeout(()=>onNativeResult(id,{body:JSON.stringify(count===1?{timezone:'UTC'}:Array.from({length:count},()=>({timezone:'UTC'})))}),0);}else original(id,u);};A.N.fetchGoogleTraffic=(id,q)=>{const v=[...q.matchAll(/!3d(-?[\d.]+)!4d(-?[\d.]+)/g)],a={lat:+v[0][1],lng:+v[0][2]},b={lat:+v[1][1],lng:+v[1][2]},meters=Trip.hav(a,b)*1609.344,seconds=window.__slowAccess?2400:meters/1609.344/40*3600,clock=+/!3j(\d+)/.exec(q)[1],r=[],t=[];r[0]=[];r[0][1]='Access road';r[0][2]=[meters];r[0][10]=[[seconds],null,3,null,[seconds,seconds]];r[3]=[[[0,0],[meters,seconds]]];t[1]=[r];t[7]=[[[Math.round(a.lat*1e7),Math.round((b.lat-a.lat)*1e7)],[Math.round(a.lng*1e7),Math.round((b.lng-a.lng)*1e7)]]];t[11]='!8j'+clock+'!3e0';setTimeout(()=>onNativeResult(id,{body:JSON.stringify([t])}),0);};
const points=[{lat:34,lng:-92},{lat:34.2,lng:-92}],raw={description:'Selected road',distanceMeters:Trip.hav(...points)*1609.344,duration:width===448?'144000s':'72000s',polyline:{encodedPolyline:Trip.encodePolyline(points)},legs:[{duration:width===448?'144000s':'72000s',distanceMeters:Trip.hav(...points)*1609.344,steps:[]}]},date=new Date(Date.now()+2*86400000).toISOString().slice(0,10),saved={route:{stops:[{...points[0],label:'Start'},{...points[1],label:'Destination'}],legs:[{sel:0,alts:[raw]}]},alts:[raw],altSel:0,altSure:true,trip:{returnTrip:false,backAuto:true,departNow:false,depart:date+'T08:00',from:'Start',to:'Destination',trafficForecast:false,windowPlan:{enabled:true,planningMode:'overnight',mode:width===320?'arrive':'depart',start:width===320?new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10)+'T12:00':date+'T08:00',end:width===320?new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10)+'T14:00':date+'T10:00',destinations:[{}],overnight:{start:'22:00',end:'08:00',minimum:360,preferred:480,overrides:[]}},fuel:{mode:'miles',miles:'180'},milesLeft:'180',bufferMi:20,minSave:0,tankPrice:4,altCompare:false,maxDetourMin:10},stations:{official:[],google:[],kind:'gas'},savedT:Date.now()};A.KV.put('restplaces','national',(width===448?[34.075,34.155]:[34.15]).map((lat,i)=>({id:'ntad:rest'+i,name:'Overnight campground '+i,lat,lng:-91.999,kind:'rest_area',parkingHours:'24/7',hours:'24/7',source:'Test rest inventory',amenities:{}})));A.KV.put('trips','trip|overnight-test',saved);A.KV.put('trips','index',[{id:'overnight-test',t:saved.savedT,mi:14,n:2}]);},width);
await p.click('#btnTrip');await p.click('[data-hist="overnight-test"]');await p.waitForFunction(()=>__trip.state().model&&!__trip.state().busy);await p.evaluate(()=>__trip.step(10));assert.equal(await p.inputValue('#twPlanningMode'),'overnight');await p.click('#twConfigure');await p.waitForSelector('#twSchedule .ws-drive');assert(await p.locator('#twScheduleCard').isVisible());assert(await p.locator('#twSchedule').evaluate(el=>[...el.querySelectorAll('.ws-track')].some(track=>{const bar=track.querySelector('.ws-drive'),green=track.querySelector('.ws-h-start'),blue=[...track.querySelectorAll('.ws-h-ds,.ws-h-de,.ws-h-as,.ws-h-ae')];if(!bar||!green||!blue.length)return false;const bounds=bar.getBoundingClientRect();return green.getBoundingClientRect().bottom<=bounds.top&&blue.every(handle=>handle.getBoundingClientRect().top>=bounds.bottom);})),'green handles are above the bar and blue handles below it');assert(await p.locator('#twSchedule').evaluate(el=>[...el.querySelectorAll('.ws-track')].some(track=>{const road=track.querySelector('.ws-drive'),window=track.querySelector('.ws-departure,.ws-arrival');if(!road||!window)return false;const a=road.getBoundingClientRect(),b=window.getBoundingClientRect();return a.top===b.top&&a.height===b.height&&getComputedStyle(road).backgroundColor!==getComputedStyle(window).backgroundColor;})),'driving and windows share a translucent track');if(width===448){const start=p.locator('[data-ws-leg="0"][data-ws-edge="start"]').first();const previous=await start.getAttribute('aria-label');await start.press('ArrowRight');assert.notEqual(await start.getAttribute('aria-label'),previous,'keyboard moves the example');assert.equal(+await start.getAttribute('data-ws-at')%900000,0,'keyboard snaps to a quarter hour');assert.equal(await p.locator('#twUseExampleDeadline').count(),0);const edge=id=>p.locator('[data-ws-leg="0"][data-ws-edge="'+id+'"]').first();const earliest=await edge('ds').getAttribute('data-ws-at');await edge('ds').press('ArrowRight');await edge('ds').press('ArrowRight');assert(+await edge('ds').getAttribute('data-ws-at')>+earliest,'blue handle can reach the green departure');assert(await p.isDisabled('#twSave'));assert.match(await p.innerText('#twError'),/must start after its earliest departure/);await edge('ds').press('ArrowLeft');await edge('ds').press('ArrowLeft');const deadline=p.locator('#twFinalEnd');await edge('ae').press('ArrowRight');assert(await deadline.inputValue(),'the deadline handle updates the exact local field');assert(await p.isEnabled('#twSave'));}
assert(await p.locator('#twPlannerTip').evaluate(tip=>{
 const planner=document.querySelector('#twPlanner'),itinerary=document.querySelector('#twScheduleCard');
 return tip.classList.contains('tipbox')&&/finer changes/.test(tip.textContent)&&tip.nextElementSibling===planner&&planner.nextElementSibling===itinerary&&itinerary.querySelector('h3').textContent==='Visual itinerary';
}),'the tip and editable windows precede the Visual itinerary');
if(width===448){
 const moved=await p.evaluate(()=>{
  const ids=['twDepartStart','twDepartEnd','twFinalStart','twFinalEnd'],fields=ids.map(id=>document.getElementById(id)),old=fields.map(el=>el.value);
  const edge=id=>Number(document.querySelector('[data-ws-leg="0"][data-ws-edge="'+id+'"]')?.dataset.wsAt);
  function set(el,value){el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}
  const day=new Date(Date.now()+45*86400000).toISOString().slice(0,10);
  fields.forEach(el=>set(el,''));
  set(fields[0],day+'T09:02');set(fields[1],day+'T12:00');
  const expected=WindowClock.parse(fields[0].value,fields[0].dataset.timeZone),start=edge('start');
  set(fields[0],day+'T10:07');
  const edited=WindowClock.parse(fields[0].value,fields[0].dataset.timeZone),later=edge('start'),bound=edge('ds');
  fields.forEach(el=>set(el,''));
  fields.forEach((el,i)=>set(el,old[i]));
  return {expected,start,edited,later,bound};
 });
 assert(moved.start>moved.expected&&moved.start-moved.expected<=300000,'a departure window months ahead positions the leg');
 assert.equal(moved.bound,moved.edited,'blue handle matches the typed minute');
 assert(moved.later>moved.edited&&moved.later>moved.start,'re-editing the form moves the green block');
}

if(width===448){
 const edge=id=>p.locator('[data-ws-leg="0"][data-ws-edge="'+id+'"]').first();
 const earliest=+await edge('ds').getAttribute('data-ws-at'),latest=+await edge('de').getAttribute('data-ws-at');
 const saved=await p.inputValue('#twDepartEnd');
 await edge('de').scrollIntoViewIfNeeded();
 const size=await edge('de').boundingBox(),scale=await edge('de').evaluate(el=>{
  const strip=el.closest('.ws-strip');
  return (+strip.dataset.wsTo-+strip.dataset.wsFrom)/el.closest('.ws-track').getBoundingClientRect().width;
 });
 const x=size.x+size.width/2,y=size.y+size.height/2;
 await p.mouse.move(x,y);await p.mouse.down();
 await p.mouse.move(x+(earliest-900000-latest)/scale,y,{steps:4});await p.mouse.up();
 assert.equal(+await edge('de').getAttribute('data-ws-at'),earliest,'the latest handle stops at the earliest handle');
 assert.equal(+await edge('ds').getAttribute('data-ws-at'),earliest,'dragging one end preserves the other');
 assert(await p.isDisabled('#twSave'));
 assert.match(await p.innerText('#twError'),/starts after its latest departure/);
 await p.locator('#twDepartEnd').evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},saved);
 assert(await p.isEnabled('#twSave'));
}

const layout=await p.locator('#twSchedule').evaluate(el=>{
 const strips=[...el.querySelectorAll('.ws-strip')];
 const hourly=strips.every(s=>[...s.querySelectorAll('[data-ws-tick]')].every((tick,i)=>+tick.dataset.wsTick===+s.dataset.wsFrom+i*3600000));
 const arrivalOnly=strips.filter(s=>s.querySelector('.ws-h-as,.ws-h-ae')&&!s.querySelector('.ws-h-ds,.ws-h-de'));
 return {hourly,arrivalOnly:arrivalOnly.length,close:arrivalOnly.every(s=>[...s.querySelectorAll('.ws-h-as,.ws-h-ae')].every(a=>a.offsetTop===47&&!a.classList.contains('ws-h-extra')))};
});
assert(layout.hourly,'every strip uses hourly ticks');
assert(layout.arrivalOnly>0&&layout.close,'arrival-only rows put blue handles directly below the bar');
if(process.env.GASKET_SCREENSHOTS){await p.locator('#twScheduleCard').screenshot({path:path.join(process.env.GASKET_SCREENSHOTS,'window-schedule-'+width+'.png')});}assert(await p.locator('#onSettings').evaluate(e=>!!(e.compareDocumentPosition(document.querySelector('#twJourney'))&Node.DOCUMENT_POSITION_FOLLOWING)),'nightly preferences precede chronology');let skippedNight;
if(width===448){
 await p.locator('#twFinalEnd').evaluate(e=>{e.value=WindowClock.wall(Date.now()+6*86400000,'UTC');e.dispatchEvent(new Event('input',{bubbles:true}));});
 const rests=p.locator('[data-ws-skip="1"]');
 await rests.last().waitFor();
 assert.equal(await rests.count(),2,'the fixture has two estimated rests');
 const edge=id=>p.locator('[data-ws-leg="0"][data-ws-edge="'+id+'"]').first();
 const setArrival=at=>p.locator('#twFinalStart').evaluate((el,t)=>{
  el.value=t==null?'':WindowClock.wall(t,el.dataset.timeZone);
  el.dispatchEvent(new Event('input',{bubbles:true}));
 },at);
 await p.locator('#twDepartEnd').evaluate(el=>{el.value='';el.dispatchEvent(new Event('input',{bubbles:true}));});
 const start=+await edge('start').getAttribute('data-ws-at'),arrival=+await edge('end').getAttribute('data-ws-at');
 await setArrival(arrival);
 const firstDate=await rests.first().getAttribute('data-ws-night'),first=p.locator('[data-ws-night="'+firstDate+'"][data-ws-skip="1"]');
 const firstPosition=await first.getAttribute('style');
 skippedNight=await rests.last().getAttribute('data-ws-night');
 const remove=p.locator('[data-ws-night="'+skippedNight+'"][data-ws-skip="1"]');
 const restore=p.locator('[data-ws-night="'+skippedNight+'"][data-ws-skip="0"]');
 await remove.click();await restore.waitFor();
 assert.equal(+await edge('start').getAttribute('data-ws-at'),start,'removing a later rest keeps departure anchored');
 assert.equal(await first.getAttribute('style'),firstPosition,'the earlier rest keeps its position');
 assert.equal(await rests.count(),1);
 assert(+await edge('end').getAttribute('data-ws-at')<arrival);
 assert(await p.isDisabled('#twSave'),'an early arrival is flagged instead of moving departure');
 assert.match(await p.innerText('#twError'),/ends before its earliest arrival/);
 assert(!await p.evaluate(()=>__app.S.trip.windowPlan.driveThroughNights),'drive-through stays a draft before saving');
 await restore.click();await remove.waitFor();
 assert.equal(+await edge('start').getAttribute('data-ws-at'),start);
 assert.equal(+await edge('end').getAttribute('data-ws-at'),arrival);
 assert.equal(await rests.count(),2);
 await setArrival(null);
 await remove.click();await restore.waitFor();
}

let savedWait,__dt;
if(width===448){
 const local=await p.evaluate(()=>{
  const start=+document.querySelector('[data-ws-leg="0"][data-ws-edge="start"]').dataset.wsAt;
  const zone=document.getElementById('twDepartStart').dataset.timeZone;
  return {start,from:WindowClock.wall(start-15*60000,zone).slice(11),to:WindowClock.wall(start+45*60000,zone).slice(11)};
 });
 await p.click('#twNlAdd');
 await p.fill('[data-nl-from]',local.from);
 await p.fill('[data-nl-to]',local.to);
 const skip=p.locator('[data-ws-wait][data-ws-skip="1"]'),restore=p.locator('[data-ws-wait][data-ws-skip="0"]');
 await skip.waitFor();
 savedWait=JSON.parse(await skip.getAttribute('data-ws-wait'))[0];
 await skip.click();
 assert.equal(await p.locator('.ws-bar.ws-wait').count(),0,'skipping removes the wait');
 assert(!await p.evaluate(()=>__app.S.trip.windowPlan.noLeaveSkips),'the change stays a draft');
 await restore.click();await skip.waitFor();
 await skip.click();await restore.waitFor();
 assert.equal(+await p.locator('[data-ws-leg="0"][data-ws-edge="start"]').first().getAttribute('data-ws-at'),local.start,'skipping does not move the start handle');
}
await p.selectOption('#onStartKind','dusk');assert(await p.locator('#onStart').evaluate(e=>e.classList.contains('hidden')));await p.selectOption('#onStartKind','clock');assert(!await p.locator('#onStart').evaluate(e=>e.classList.contains('hidden')));assert.equal(await p.locator('[data-rest-solar]').count(),4);await p.fill('#onMin','9');await p.fill('#onPref','8');assert(await p.isDisabled('#twSave'));assert.match(await p.innerText('#twError'),/preferred/i);await p.fill('#onMin','6');await p.locator('#onAddNight').evaluate(e=>e.closest('details').open=true);await p.click('#onAddNight');const row=p.locator('[data-on-night]');await row.locator('[data-on-date]').fill('2030-11-02');await p.fill('#on0Min','5');await p.fill('#on0Pref','7');let deadlineNight=null;if(await p.locator('.ws-problems').count()){assert(await p.isDisabled('#twSave'),'a rest that does not fit blocks Save');assert.match(await p.innerText('#twError'),/no room to rest on the night of/);const fix=p.locator('.ws-problems [data-ws-night]').first();deadlineNight=await fix.getAttribute('data-ws-night');await fix.click();await p.waitForFunction(()=>!document.querySelector('.ws-problems'));}await p.click('#twSave');if(deadlineNight)assert(Object.values(__dt=await p.evaluate(()=>__app.S.trip.windowPlan.driveThroughNights||{})).some(v=>v.includes(deadlineNight)),'the drive-through night is saved');assert.equal(await p.evaluate(()=>__app.S.trip.windowPlan.overnight.overrides[0].minimum),300);if(savedWait)assert.deepEqual(await p.evaluate(()=>{const route=__trip.state().route;return __app.S.trip.windowPlan.noLeaveSkips[TripStops.nightKey(route,TripStops.groups(route)[0])];}),[savedWait],'Save windows retains the skipped wait for the original leg');if(skippedNight)assert.deepEqual(await p.evaluate(()=>{const route=__trip.state().route,key=TripStops.nightKey(route,TripStops.groups(route)[0]);return __app.S.trip.windowPlan.driveThroughNights[key];}),[skippedNight],'Stops reads the same saved drive-through night');assert.equal(await p.locator('#twOvernight').count(),0,'no separate overnight approval step');assert.match(await p.innerText('#tpBody'),/Rest stops uses these nightly hours/);if(width===320)assert(!await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
await p.click('#tNext');await p.waitForFunction(()=>__trip.state().step===4);assert.equal(await p.locator('.sub-page').count(),0,'Route does not open an overnight rest chooser');await p.click('#tNext');await p.waitForSelector('#twYes');assert.match(await p.innerText('#twReview'),/clear conditions/,'overnight mode goes straight to normal road and hazard screening');assert.equal(await p.evaluate(()=>__trip.state().route.stops.length),2,'no rests are inserted before Stops');assert.deepEqual(errors,[]);await p.close();}console.log('Overnight preferences and nightly overrides save; Route no longer requires choosing rests (they are picked in Stops) at 320/448.');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
